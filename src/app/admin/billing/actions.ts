"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import {
  Prisma,
  type Agreement as AgreementPrismaOriginal,
  type Bill as BillPrismaOriginal,
  type Space as SpacePrismaOriginal,
  type Building as BuildingPrismaOriginal,
  type BuildingMonthlyUtilities as BuildingMonthlyUtilitiesPrisma,
  type PenaltyTier as PenaltyTierPrismaOriginal,
  type Tenant as TenantPrismaOriginal,
  type User,
  type Role,
} from "@prisma/client";
import {
  addMonths,
  getMonth,
  getYear,
  startOfDay,
  differenceInDays,
  isBefore,
  setMonth,
  setYear,
  parseISO,
  format,
  addDays,
  subMonths,
  isSameDay,
  isAfter,
} from "date-fns";
import type {
  SerializedBillingPageData,
  SerializedParsedUtilityItem,
} from "./page"; // Import serialized types from page.tsx for return type
import { cookies } from "next/headers";
import { getBillDateConfiguration } from "@/lib/application-settings";
import {
  calculateNextBillingDate,
  clampConfiguredBillingDate,
  DEFAULT_BILLING_CYCLE_DAYS,
} from "@/lib/billing-schedule";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { prisma } from "@/lib/prisma";
import {
  toUtcStartOfDay,
  isAfterUtcDay,
  differenceInUtcDays,
} from "@/lib/utils";

const EPOCH_ISO_STRING = new Date(0).toISOString();

/** Add months in UTC preserving the UTC day-of-month of the provided date. */
function addMonthsUTC(date: Date, monthsToAdd: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + monthsToAdd;
  const targetYear = Math.floor(month / 12) + year;
  const targetMonth = ((month % 12) + 12) % 12;
  const day = date.getUTCDate();
  // Clamp day to target month's length
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

type BillingBuildingRecord = BuildingPrismaOriginal & {
  penaltyPolicyTiers: PenaltyTierPrismaOriginal[];
};

type BillingAgreementRecord = AgreementPrismaOriginal & {
  tenant: TenantPrismaOriginal | null;
  space:
    | (SpacePrismaOriginal & {
        building?: BillingBuildingRecord | null;
      })
    | null;
};

type BillingAgreementWithBuildingRecord = AgreementPrismaOriginal & {
  tenant: TenantPrismaOriginal | null;
  space:
    | (SpacePrismaOriginal & {
        building: BillingBuildingRecord | null;
      })
    | null;
};

type BillWithAgreementRecord = BillPrismaOriginal & {
  agreement: BillingAgreementRecord | null;
};

type BillWithAgreementAndBuildingRecord = BillPrismaOriginal & {
  agreement: BillingAgreementWithBuildingRecord | null;
};

const toIsoString = (value: Date | null | undefined) =>
  value ? value.toISOString() : EPOCH_ISO_STRING;

function serializePenaltyTiers(
  penaltyPolicyTiers: PenaltyTierPrismaOriginal[] | null | undefined,
) {
  return (penaltyPolicyTiers || []).map((penaltyTier) => ({
    ...penaltyTier,
    feeValue: Number(penaltyTier.feeValue),
  }));
}

function serializeBuilding(building: BillingBuildingRecord | null | undefined) {
  if (!building) {
    return null;
  }

  return {
    ...building,
    status: building.status || "Active",
    createdAt: toIsoString(building.createdAt),
    updatedAt: toIsoString(building.updatedAt ?? building.createdAt),
    penaltyPolicyTiers: serializePenaltyTiers(building.penaltyPolicyTiers),
  };
}

function serializeTenant(tenant: TenantPrismaOriginal | null | undefined) {
  if (!tenant) {
    return null;
  }

  return {
    ...tenant,
    createdAt: toIsoString(tenant.createdAt),
    updatedAt: toIsoString(tenant.updatedAt ?? tenant.createdAt),
  };
}

function serializeSpace(
  space:
    | (SpacePrismaOriginal & {
        building?: BillingBuildingRecord | null;
      })
    | null
    | undefined,
) {
  if (!space) {
    return null;
  }

  return {
    ...space,
    area: Number(space.area),
    utilityProrationShare: Number(space.utilityProrationShare),
    monthlyRentalPrice: Number(space.monthlyRentalPrice),
    createdAt: toIsoString(space.createdAt),
    updatedAt: toIsoString(space.updatedAt ?? space.createdAt),
    building: serializeBuilding(space.building),
  };
}

function serializeAgreement(
  agreement: BillingAgreementRecord | null | undefined,
) {
  if (!agreement) {
    return null;
  }

  return {
    ...agreement,
    monthlyRentalPrice: Number(agreement.monthlyRentalPrice),
    initialPaymentAmount: agreement.initialPaymentAmount
      ? Number(agreement.initialPaymentAmount)
      : null,
    createdAt: toIsoString(agreement.createdAt),
    updatedAt: toIsoString(agreement.updatedAt ?? agreement.createdAt),
    startDate: toIsoString(agreement.startDate),
    nextPaymentDueDate: toIsoString(agreement.nextPaymentDueDate),
    initialPaymentDate: agreement.initialPaymentDate?.toISOString() || null,
    endDate: agreement.endDate?.toISOString() || null,
    tenant: serializeTenant(agreement.tenant),
    space: serializeSpace(agreement.space),
  };
}

function parseUtilityBreakdown(
  billId: string,
  rawUtilityData: unknown,
): SerializedParsedUtilityItem[] {
  if (typeof rawUtilityData === "string") {
    try {
      const jsonData = JSON.parse(rawUtilityData);
      if (Array.isArray(jsonData)) {
        return jsonData
          .filter(
            (item) =>
              typeof item.name === "string" && typeof item.amount === "number",
          )
          .map((item) => ({
            name: item.name,
            amount: item.amount,
            id: typeof item.id === "string" ? item.id : undefined,
          }));
      }
    } catch (error) {
      console.error(
        `Failed to parse utilityBreakdown JSON for bill ${billId}:`,
        error,
        rawUtilityData,
      );
    }

    return [];
  }

  if (Array.isArray(rawUtilityData)) {
    return rawUtilityData
      .filter(
        (item) =>
          typeof item.name === "string" && typeof item.amount === "number",
      )
      .map((item) => ({
        name: item.name,
        amount: item.amount,
        id: typeof item.id === "string" ? item.id : undefined,
      }));
  }

  return [];
}

type UtilityApplicableSpace = Pick<
  SpacePrismaOriginal,
  "id" | "floor" | "spaceIdName" | "utilityProrationShare"
>;

type UtilitySourceRecord = {
  id: string;
  name: string;
  totalCost: Prisma.Decimal | number;
  appliesToScope: string;
  applicableFloor?: string | null;
  applicableSpaceIdNames?: string[];
  perSpaceAllocation?: string | null;
};

type PricedUtilityItem = {
  id: string;
  name: string;
  amount: number;
};

export interface UpfrontBillUtilityOption {
  id: string;
  name: string;
  amount: number;
  selected: boolean;
}

export interface UpfrontBillUtilitySelectionData {
  billId: string;
  billStatus: BillPrismaOriginal["status"];
  tenantName: string;
  spaceName: string;
  buildingName: string;
  monthLabel: string;
  utilities: UpfrontBillUtilityOption[];
  utilityRecordStatus?: string;
  emptyStateMessage?: string;
}

function calculateUtilityAmountForSpace(
  utilityItem: UtilitySourceRecord,
  space: UtilityApplicableSpace,
): number {
  const utilTotalCost = Number(utilityItem.totalCost);
  if (isNaN(utilTotalCost) || utilTotalCost <= 0) {
    return 0;
  }

  if (utilityItem.appliesToScope === "Building") {
    const prorationShare = Number(space.utilityProrationShare);
    if (!isNaN(prorationShare) && prorationShare > 0) {
      return utilTotalCost * prorationShare;
    }
    return 0;
  }

  if (
    utilityItem.appliesToScope === "Floor" &&
    utilityItem.applicableFloor === space.floor
  ) {
    let percentages: Record<string, number> = {};
    if (utilityItem.perSpaceAllocation) {
      try {
        percentages = JSON.parse(utilityItem.perSpaceAllocation);
      } catch {
        percentages = {};
      }
    }

    const spacePercentage = percentages[space.id];
    if (spacePercentage && spacePercentage > 0) {
      return utilTotalCost * (spacePercentage / 100);
    }
    return 0;
  }

  if (
    utilityItem.appliesToScope === "SpecificSpaces" &&
    Array.isArray(utilityItem.applicableSpaceIdNames) &&
    utilityItem.applicableSpaceIdNames.includes(space.spaceIdName)
  ) {
    return utilTotalCost;
  }

  return 0;
}

function buildUtilityBreakdownForSpace(
  utilities: UtilitySourceRecord[],
  space: UtilityApplicableSpace,
): PricedUtilityItem[] {
  const applicableUtilities: PricedUtilityItem[] = [];

  for (const utilityItem of utilities) {
    const amount = calculateUtilityAmountForSpace(utilityItem, space);
    if (amount <= 0) {
      continue;
    }

    applicableUtilities.push({
      id: utilityItem.id,
      name: utilityItem.name,
      amount: parseFloat(amount.toFixed(2)),
    });
  }

  return applicableUtilities;
}

function isUtilitySelected(
  option: SerializedParsedUtilityItem,
  currentSelections: SerializedParsedUtilityItem[],
) {
  return currentSelections.some(
    (selection) =>
      (selection.id && option.id && selection.id === option.id) ||
      (selection.name === option.name && selection.amount === option.amount),
  );
}

function isFutureBillingMonth(date: Date) {
  const billMonthKey = date.toISOString().slice(0, 7);
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  return billMonthKey > currentMonthKey;
}

async function getEligibleUpfrontBillUtilityContext(
  billId: string,
  requireEditable = false,
) {
  const { isSuperAdmin, managedBuildingIds, permissions } =
    await getUserAndManagedIds();

  if (!isSuperAdmin && !permissions.has("billing:generate")) {
    throw new Error("Access Denied");
  }

  const bill = (await databaseService.getBillById(billId, {
    agreement: {
      include: {
        tenant: true,
        space: true,
      },
    },
  })) as BillWithAgreementRecord | null;

  if (!bill) {
    throw new Error("Bill not found.");
  }

  if (!bill.agreement?.space) {
    throw new Error("Agreement space details not found for this bill.");
  }

  if (
    !isSuperAdmin &&
    !managedBuildingIds?.includes(bill.agreement.space.buildingId)
  ) {
    throw new Error("Permission denied.");
  }

  if (!isFutureBillingMonth(bill.billDate)) {
    throw new Error(
      "Utilities can only be attached to bills generated upfront for future months.",
    );
  }

  return bill;
}

async function buildUpfrontBillUtilitySelectionData(
  billId: string,
  requireEditable = false,
): Promise<UpfrontBillUtilitySelectionData> {
  const bill = await getEligibleUpfrontBillUtilityContext(
    billId,
    requireEditable,
  );

  const currentSelections = parseUtilityBreakdown(
    bill.id,
    (bill as any).utilityBreakdown,
  );

  const monthLabel = format(bill.billDate, "MMMM yyyy");
  const monthlyUtilities =
    await databaseService.getBuildingMonthlyUtilitiesByBuildingMonthYear(
      bill.agreement!.space!.buildingId,
      getMonth(bill.billDate),
      getYear(bill.billDate),
      { utilities: true },
    );

  if (!monthlyUtilities) {
    return {
      billId: bill.id,
      billStatus: bill.status,
      tenantName: bill.agreement?.tenant?.name || "Unknown Tenant",
      spaceName: bill.agreement?.space?.spaceIdName || "Unknown Space",
      buildingName: bill.agreement?.space?.buildingName || "Unknown Building",
      monthLabel,
      utilities: [],
      emptyStateMessage: `No utilities were found for ${monthLabel}. Create that month's utilities first.`,
    };
  }

  if (
    monthlyUtilities.status === "Rejected" ||
    monthlyUtilities.status === "Inactive"
  ) {
    return {
      billId: bill.id,
      billStatus: bill.status,
      tenantName: bill.agreement?.tenant?.name || "Unknown Tenant",
      spaceName: bill.agreement?.space?.spaceIdName || "Unknown Space",
      buildingName: bill.agreement?.space?.buildingName || "Unknown Building",
      monthLabel,
      utilityRecordStatus: monthlyUtilities.status,
      utilities: [],
      emptyStateMessage: `Utilities for ${monthLabel} are ${monthlyUtilities.status.toLowerCase()} and cannot be attached to this bill.`,
    };
  }

  const selectableUtilities = buildUtilityBreakdownForSpace(
    monthlyUtilities.utilities as UtilitySourceRecord[],
    bill.agreement!.space!,
  );

  if (selectableUtilities.length === 0) {
    return {
      billId: bill.id,
      billStatus: bill.status,
      tenantName: bill.agreement?.tenant?.name || "Unknown Tenant",
      spaceName: bill.agreement?.space?.spaceIdName || "Unknown Space",
      buildingName: bill.agreement?.space?.buildingName || "Unknown Building",
      monthLabel,
      utilityRecordStatus: monthlyUtilities.status,
      utilities: [],
      emptyStateMessage:
        monthlyUtilities.utilities.length > 0
          ? `Utilities for ${monthLabel} exist, but none apply to ${bill.agreement?.space?.spaceIdName || "this space"} based on the space allocation rules.`
          : `No utility items were added for ${monthLabel}.`,
    };
  }

  return {
    billId: bill.id,
    billStatus: bill.status,
    tenantName: bill.agreement?.tenant?.name || "Unknown Tenant",
    spaceName: bill.agreement?.space?.spaceIdName || "Unknown Space",
    buildingName: bill.agreement?.space?.buildingName || "Unknown Building",
    monthLabel,
    utilityRecordStatus: monthlyUtilities.status,
    utilities: selectableUtilities.map((utilityItem) => ({
      ...utilityItem,
      selected: isUtilitySelected(utilityItem, currentSelections),
    })),
  };
}

function serializeUpfrontUtilityBill(bill: BillPrismaOriginal) {
  let parsedUtilityBreakdown: any[] = [];
  if (typeof bill.utilityBreakdown === "string") {
    try {
      parsedUtilityBreakdown = JSON.parse(bill.utilityBreakdown);
    } catch {
      parsedUtilityBreakdown = [];
    }
  } else if (Array.isArray(bill.utilityBreakdown)) {
    parsedUtilityBreakdown = bill.utilityBreakdown;
  }

  return {
    ...bill,
    rentAmount: Number(bill.rentAmount),
    penaltyAmount: Number(bill.penaltyAmount ?? 0),
    totalAmount: Number(bill.totalAmount),
    billDate: bill.billDate.toISOString(),
    dueDate: bill.dueDate.toISOString(),
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt?.toISOString() || bill.createdAt.toISOString(),
    paymentDate: bill.paymentDate?.toISOString() || null,
    utilityBreakdown: parsedUtilityBreakdown,
  };
}

export async function getBillingPageDataAction(): Promise<SerializedBillingPageData> {
  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);
  const hasAssignedBuildingScope =
    Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

  const agreementWhere: Prisma.AgreementWhereInput = {
    ...(!canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? {
            OR: [
              { buildingId: { in: managedBuildingIds } },
              { space: { buildingId: { in: managedBuildingIds } } },
            ],
          }
        : { createdById: currentUser.id }
      : {}),
  };

  const billWhere: Prisma.BillWhereInput = {
    ...(!canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? {
            OR: [
              { agreement: { buildingId: { in: managedBuildingIds } } },
              {
                agreement: {
                  space: { buildingId: { in: managedBuildingIds } },
                },
              },
              { tenant: { buildingId: { in: managedBuildingIds } } },
            ],
          }
        : { agreement: { createdById: currentUser.id } }
      : {}),
  };

  const [agreementsData, billsDataRaw] = await Promise.all([
    databaseService.getAllAgreements({
      where: agreementWhere,
      include: {
        tenant: true,
        space: {
          include: {
            building: { include: { penaltyPolicyTiers: true } },
          },
        },
      },
      orderBy: { tenant: { name: "asc" } },
    }),
    databaseService.getAllBills({
      where: billWhere,
      include: {
        agreement: {
          include: {
            tenant: true,
            space: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const serializedAgreements = agreementsData
    .map((agreement) => serializeAgreement(agreement as BillingAgreementRecord))
    .filter(
      (
        agreement,
      ): agreement is NonNullable<ReturnType<typeof serializeAgreement>> =>
        agreement !== null,
    ) as SerializedBillingPageData["agreements"];

  const serializedBills = (billsDataRaw as BillWithAgreementRecord[]).map(
    (billRaw) => {
      const parsedUtilityBreakdown = parseUtilityBreakdown(
        billRaw.id,
        (billRaw as any).utilityBreakdown,
      );
      const billCreatedAt = toIsoString(billRaw.createdAt);
      const billUpdatedAt = toIsoString(billRaw.updatedAt ?? billRaw.createdAt);
      const utilityTotal = parsedUtilityBreakdown.reduce(
        (sum, item) => sum + item.amount,
        0,
      );

      const explicitPenalty =
        billRaw.penaltyAmount !== null && billRaw.penaltyAmount !== undefined
          ? Number(billRaw.penaltyAmount)
          : null;
      const derivedPenalty = Math.max(
        0,
        Number(billRaw.totalAmount) - Number(billRaw.rentAmount) - utilityTotal,
      );
      const penaltyAmount =
        explicitPenalty !== null && explicitPenalty > 0
          ? explicitPenalty
          : derivedPenalty > 0
            ? derivedPenalty
            : 0;

      return {
        ...(billRaw as BillPrismaOriginal),
        rentAmount: Number(billRaw.rentAmount),
        penaltyAmount,
        totalAmount: Number(billRaw.totalAmount),
        createdAt: billCreatedAt,
        updatedAt: billUpdatedAt,
        billDate: billRaw.billDate
          ? billRaw.billDate.toISOString()
          : EPOCH_ISO_STRING,
        dueDate: billRaw.dueDate
          ? billRaw.dueDate.toISOString()
          : EPOCH_ISO_STRING,
        paymentDate: billRaw.paymentDate?.toISOString() || null,
        utilityBreakdown: parsedUtilityBreakdown,
        agreement: serializeAgreement(
          billRaw.agreement as BillingAgreementRecord | null,
        ),
      };
    },
  ) as SerializedBillingPageData["bills"];

  return {
    agreements: serializedAgreements,
    bills: serializedBills,
  };
}

function calculateIndividualPenalty(
  billAmount: number,
  daysOverdue: number,
  building: BuildingPrismaOriginal & {
    penaltyPolicyTiers: Prisma.PenaltyTierGetPayload<{}>[];
  },
  space: SpacePrismaOriginal,
): number {
  if (
    daysOverdue <= 0 ||
    !building.penaltyPolicyTiers ||
    building.penaltyPolicyTiers.length === 0
  ) {
    return 0;
  }

  const allTiers = building.penaltyPolicyTiers;

  // Prioritize rules: Specific Space > Floor > Building
  const spaceSpecificTiers = allTiers.filter(
    (t) =>
      t.scope === "SpecificSpaces" &&
      t.applicableSpaceIdNames?.includes(space.spaceIdName),
  );

  const floorSpecificTiers = allTiers.filter(
    (t) => t.scope === "Floor" && t.applicableFloor === space.floor,
  );

  const buildingWideTiers = allTiers.filter((t) => t.scope === "Building");

  let applicableTiers: Prisma.PenaltyTierGetPayload<{}>[] = [];
  if (spaceSpecificTiers.length > 0) {
    applicableTiers = spaceSpecificTiers;
  } else if (floorSpecificTiers.length > 0) {
    applicableTiers = floorSpecificTiers;
  } else {
    applicableTiers = buildingWideTiers;
  }

  if (applicableTiers.length === 0) return 0;

  const sortedTiers = [...applicableTiers].sort(
    (a, b) => a.fromDay - b.fromDay,
  );

  let totalPenalty = 0;
  const oneTimeFeesApplied = new Set<string>(); // Keep track of applied one-time fees to prevent re-application

  // Iterate through each overdue day
  for (let day = 1; day <= daysOverdue; day++) {
    // Find the tier that applies to the current day. If `toDay` is null, it applies indefinitely.
    const tierForDay = sortedTiers.find(
      (tier) =>
        day >= tier.fromDay &&
        (tier.toDay === null || tier.toDay === undefined || day <= tier.toDay),
    );

    if (tierForDay) {
      const feeValue = Number(tierForDay.feeValue);
      let dailyFee = 0;

      if (tierForDay.penaltyType === "Fixed") {
        dailyFee = feeValue;
      } else if (tierForDay.penaltyType === "Percentage") {
        dailyFee = billAmount * (feeValue / 100);
      }

      if (tierForDay.frequency === "Daily") {
        totalPenalty += dailyFee;
      } else if (tierForDay.frequency === "OneTime") {
        // Only add the one-time fee if it hasn't been added for this tier yet
        if (!oneTimeFeesApplied.has(tierForDay.id)) {
          totalPenalty += dailyFee; // dailyFee here is the one-time amount
          oneTimeFeesApplied.add(tierForDay.id);
        }
      }
    }
  }

  return parseFloat(totalPenalty.toFixed(2));
}

export async function generateBillAndUpdateAgreementAction(
  agreementId: string,
  targetBillDateStr: string,
) {
  try {
    const { isSuperAdmin, managedBuildingIds } = await getUserAndManagedIds();
    const targetBillDate = parseISO(`${targetBillDateStr}T00:00:00.000Z`);
    const today = toUtcStartOfDay(new Date());

    const agreement = await databaseService.getAgreementById(agreementId, {
      space: {
        include: {
          building: {
            include: {
              penaltyPolicyTiers: true,
              spaces: true,
            },
          },
        },
      },
      tenant: true,
    });
    if (!agreement) throw new Error("Agreement not found.");
    if (!agreement.space)
      throw new Error("Space details for agreement not found.");
    if (!agreement.space.building)
      throw new Error("Building details for space not found.");

    if (
      !isSuperAdmin &&
      !managedBuildingIds?.includes(agreement.space.buildingId)
    ) {
      return { success: false, error: "Permission denied." };
    }

    const billDateConfiguration = await getBillDateConfiguration(
      agreement.space.buildingId,
    );

    const targetDayStart = targetBillDate;
    const targetDayEnd = addDays(targetDayStart, 1);

    // If there is an aggregated prepaid bill for the target date (created
    // during import/creation and marked `isPrepaid`), advance the bill date
    // to the next configured billing cycle. This prevents the monthly bill
    // from colliding with the aggregated invoice and ensures the UI shows
    // the period after the aggregated prepayment.
    const prepaidBillsForTarget = await databaseService.getAllBills({
      where: {
        agreementId: agreement.id,
        billDate: { gte: targetDayStart, lt: targetDayEnd },
        isPrepaid: true,
      },
    });

    let effectiveBillDate = clampConfiguredBillingDate(
      targetBillDate,
      billDateConfiguration,
    );
    if (prepaidBillsForTarget.length > 0) {
      effectiveBillDate = calculateNextBillingDate(
        effectiveBillDate,
        billDateConfiguration,
      );
    }

    const effectiveDayStart = toUtcStartOfDay(effectiveBillDate);
    const effectiveDayEnd = addDays(effectiveDayStart, 1);

    const existingBill = await databaseService.getAllBills({
      where: {
        agreementId: agreement.id,
        billDate: { gte: effectiveDayStart, lt: effectiveDayEnd },
        AND: [{ isPrepaid: { not: true } }],
      },
    });

    if (existingBill.length > 0) {
      return {
        success: false,
        error: `A bill for ${format(effectiveBillDate, "PP")} for ${
          agreement.tenant?.name || "this tenant"
        } already exists (Status: ${existingBill[0].status}).`,
      };
    }

    // Prevent generating bills past the agreement's end date. If the
    // effective bill date is on or after the agreement end date, mark the
    // agreement Inactive (if still Active) and stop generation.
    if (agreement.endDate) {
      // Use UTC date-only string comparisons to avoid TZ drift and ensure the
      // agreement end date is treated inclusively regardless of server locale.
      const agreementEndYMD = (agreement.endDate as Date)
        .toISOString()
        .slice(0, 10);
      const effectiveYMD = effectiveBillDate.toISOString().slice(0, 10);
      // Allow billing on the agreement end date (inclusive). Only block when
      // the effective bill date is strictly after the agreement end date.
      if (effectiveYMD > agreementEndYMD) {
        // Mark agreement expired and free the space. Disconnect tenant from the space.
        if (agreement.status === "Active" || agreement.status === "Inactive") {
          await databaseService.updateAgreement(agreement.id, {
            status: "Expired",
          });
        }

        // Set space as vacant if present
        if (agreement.spaceId) {
          try {
            await databaseService.updateSpace(agreement.spaceId, {
              isOccupied: false,
            });
          } catch (e) {
            // ignore individual errors here
          }
        }

        // Disconnect tenant's rentedSpace if connected
        if (agreement.tenantId) {
          try {
            await databaseService.updateTenant(agreement.tenantId, {
              rentedSpace: { disconnect: true } as any,
            } as any);
          } catch (e) {
            // ignore
          }
        }

        revalidatePath("/admin/agreements");
        revalidatePath("/admin/spaces");

        return {
          success: false,
          error: `Agreement term has ended; cannot generate bill for ${format(
            effectiveBillDate,
            "MMMM yyyy",
          )}.`,
        };
      }
    }

    // --- Rent Calculation and Prepaid Handling ---
    // Use the effective bill date (which may have been shifted when a prepaid
    // aggregated invoice exists) for cycle-based calculations and utilities.
    let rentAmount = agreement.monthlyRentalPrice; // Assume full rent by default

    const billingCycleDays =
      billDateConfiguration || DEFAULT_BILLING_CYCLE_DAYS;
    const billingCyclesElapsed = Math.max(
      0,
      Math.floor(
        differenceInUtcDays(effectiveBillDate, agreement.startDate) /
          billingCycleDays,
      ),
    );

    // If the number of elapsed billing cycles is less than the number of months paid upfront,
    // the rent portion for that month's bill should be zero (prepaid). We still
    // create the bill (so utilities/penalties can be applied) but mark it with
    // `isPrepaid` so the UI can highlight it.
    const isWithinPrepaid =
      agreement.initialPaymentMonths > 0 &&
      billingCyclesElapsed < agreement.initialPaymentMonths;
    if (isWithinPrepaid) {
      rentAmount = new Prisma.Decimal(0);
    }
    // --- End Rent Calculation ---

    // Calculate Utility Costs
    const utilityItemsForJson: { name: string; amount: number }[] = [];
    let totalUtilityCostForBill = 0;

    const utilityYear = getYear(effectiveBillDate);
    const utilityMonth = getMonth(effectiveBillDate);

    const monthlyBuildingUtilityData =
      await databaseService.getBuildingMonthlyUtilitiesByBuildingMonthYear(
        agreement.space.building.id,
        utilityMonth,
        utilityYear,
        { utilities: true },
      );

    if (
      monthlyBuildingUtilityData &&
      (monthlyBuildingUtilityData as any).status === "Active" &&
      monthlyBuildingUtilityData.utilities &&
      monthlyBuildingUtilityData.utilities.length > 0
    ) {
      const allUtilitiesForPeriod = monthlyBuildingUtilityData.utilities;
      const space = agreement.space;

      for (const utilItem of allUtilitiesForPeriod) {
        let costForThisItem = 0;
        const utilTotalCost = Number(utilItem.totalCost);
        if (isNaN(utilTotalCost)) continue;

        if (utilItem.appliesToScope === "Building") {
          const prorationShare = Number(space.utilityProrationShare);
          if (!isNaN(prorationShare) && prorationShare > 0) {
            costForThisItem = utilTotalCost * prorationShare;
          }
        } else if (
          utilItem.appliesToScope === "Floor" &&
          utilItem.applicableFloor === space.floor
        ) {
          let percentages: Record<string, number> = {};
          if (
            utilItem.perSpaceAllocation &&
            typeof utilItem.perSpaceAllocation === "string"
          ) {
            try {
              percentages = JSON.parse(utilItem.perSpaceAllocation);
            } catch (e) {}
          }
          const spacePercentage = percentages[space.id];
          if (spacePercentage && spacePercentage > 0) {
            costForThisItem = utilTotalCost * (spacePercentage / 100);
          }
        } else if (utilItem.appliesToScope === "SpecificSpaces") {
          if (
            Array.isArray(utilItem.applicableSpaceIdNames) &&
            utilItem.applicableSpaceIdNames.includes(space.spaceIdName)
          ) {
            costForThisItem = utilTotalCost;
          }
        }

        if (costForThisItem > 0) {
          const roundedCost = parseFloat(costForThisItem.toFixed(2));
          utilityItemsForJson.push({
            name: utilItem.name,
            amount: roundedCost,
          });
          totalUtilityCostForBill += roundedCost;
        }
      }
    }

    let initialPenalty = 0;
    const dueDate = toUtcStartOfDay(effectiveBillDate);
    if (isAfterUtcDay(today, dueDate)) {
      const daysOverdue = differenceInUtcDays(today, dueDate);
      initialPenalty = calculateIndividualPenalty(
        Number(rentAmount),
        daysOverdue,
        agreement.space.building,
        agreement.space,
      );
    }

    const totalAmount =
      Number(rentAmount) + totalUtilityCostForBill + initialPenalty;

    const utilityBreakdownJson =
      utilityItemsForJson.length > 0
        ? JSON.stringify(utilityItemsForJson)
        : Prisma.JsonNull;

    const billCreateInput: Prisma.BillCreateInput = {
      agreement: { connect: { id: agreement.id } },
      tenant: { connect: { id: agreement.tenantId } },
      billDate: effectiveBillDate,
      dueDate: effectiveBillDate,
      rentAmount,
      utilityBreakdown: utilityBreakdownJson,
      penaltyAmount: initialPenalty,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      status:
        isAfterUtcDay(today, effectiveBillDate) && initialPenalty > 0
          ? "Overdue"
          : "Pending",
      isPrepaid: isWithinPrepaid ? true : undefined,
    };

    const newBill = await databaseService.createBill(billCreateInput);
    const newNextDue = calculateNextBillingDate(
      effectiveBillDate,
      billDateConfiguration,
    );
    await databaseService.updateAgreement(agreement.id, {
      nextPaymentDueDate: newNextDue,
    });

    // If the new next payment due date reaches or passes the agreement end
    // date, mark the agreement Expired and free the space/tenant link.
    if (agreement.endDate) {
      // Compare using UTC date-only strings to ensure inclusive end-date handling.
      const agreementEndYMD = (agreement.endDate as Date)
        .toISOString()
        .slice(0, 10);
      const newNextDueYMD = toUtcStartOfDay(newNextDue)
        .toISOString()
        .slice(0, 10);
      if (newNextDueYMD >= agreementEndYMD) {
        if (agreement.status === "Active" || agreement.status === "Inactive") {
          await databaseService.updateAgreement(agreement.id, {
            status: "Expired",
          });
        }
        if (agreement.spaceId) {
          try {
            await databaseService.updateSpace(agreement.spaceId, {
              isOccupied: false,
            });
          } catch (e) {}
        }
        if (agreement.tenantId) {
          try {
            await databaseService.updateTenant(agreement.tenantId, {
              rentedSpace: { disconnect: true } as any,
            } as any);
          } catch (e) {}
        }
        revalidatePath("/admin/agreements");
        revalidatePath("/admin/spaces");
      }
    }

    revalidatePath("/admin/billing");

    let parsedUtilityBreakdown: any[] = [];
    if (typeof newBill.utilityBreakdown === "string") {
      try {
        parsedUtilityBreakdown = JSON.parse(newBill.utilityBreakdown);
      } catch (e) {
        /* ignore */
      }
    } else if (Array.isArray(newBill.utilityBreakdown)) {
      parsedUtilityBreakdown = newBill.utilityBreakdown;
    }

    const serializedBill = {
      ...newBill,
      rentAmount: Number(newBill.rentAmount),
      penaltyAmount: Number(newBill.penaltyAmount ?? 0),
      totalAmount: Number(newBill.totalAmount),
      billDate: newBill.billDate.toISOString(),
      dueDate: newBill.dueDate.toISOString(),
      createdAt: newBill.createdAt.toISOString(),
      updatedAt:
        newBill.updatedAt?.toISOString() || newBill.createdAt.toISOString(),
      paymentDate: newBill.paymentDate?.toISOString() || null,
      utilityBreakdown: parsedUtilityBreakdown,
      nextPaymentDueDate: newNextDue.toISOString(),
    };

    return { success: true, bill: serializedBill };
  } catch (error: any) {
    console.error("Error generating bill:", error);
    return {
      success: false,
      error: error.message || "Failed to generate bill.",
    };
  }
}

export async function recordPaymentOrVerificationAction(
  billId: string,
  paymentData: {
    paymentDate: string;
    paymentReference?: string | null;
    adminVerificationNotes?: string | null;
    paymentProofDataUri?: string | null;
  },
  actionType: "recordPayment" | "confirmVerification" | "rejectVerification",
) {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const bill = (await databaseService.getBillById(billId, {
      agreement: {
        include: {
          tenant: true,
          space: {
            include: {
              building: {
                include: {
                  penaltyPolicyTiers: true,
                  spaces: true,
                },
              },
            },
          },
        },
      },
    })) as BillWithAgreementAndBuildingRecord | null;
    if (!bill) throw new Error("Bill not found.");
    if (!bill.agreement?.space?.building)
      throw new Error("Building details for bill not found for penalty check.");

    if (
      !isSuperAdmin &&
      !managedBuildingIds?.includes(bill.agreement.space.buildingId)
    ) {
      return { success: false, error: "Permission denied." };
    }

    let utilityBreakdownItems: SerializedParsedUtilityItem[] = [];
    if (typeof (bill as any).utilityBreakdown === "string") {
      try {
        const parsed = JSON.parse((bill as any).utilityBreakdown);
        if (Array.isArray(parsed)) {
          utilityBreakdownItems = parsed
            .filter(
              (item) =>
                typeof item.name === "string" &&
                typeof item.amount === "number",
            )
            .map((item) => ({
              name: item.name,
              amount: item.amount,
              id: item.id,
            }));
        }
      } catch (e) {
        console.error(
          "Error parsing utilityBreakdown for penalty calculation in recordPayment:",
          e,
        );
      }
    } else if (Array.isArray((bill as any).utilityBreakdown)) {
      utilityBreakdownItems = ((bill as any).utilityBreakdown as any[])
        .filter(
          (item) =>
            typeof item.name === "string" && typeof item.amount === "number",
        )
        .map((item) => ({ name: item.name, amount: item.amount, id: item.id }));
    }

    const today = toUtcStartOfDay(new Date());
    let newStatus: BillPrismaOriginal["status"] = bill.status;
    const finalPaymentDate = paymentData.paymentDate
      ? parseISO(paymentData.paymentDate)
      : new Date();
    const finalPaymentDateUtc = toUtcStartOfDay(finalPaymentDate);
    const billDueDateUtc = toUtcStartOfDay(bill.dueDate);

    let currentPenalty = bill.penaltyAmount ? Number(bill.penaltyAmount) : 0;

    if (
      (isAfterUtcDay(finalPaymentDateUtc, billDueDateUtc) ||
        bill.status === "Overdue") &&
      actionType !== "rejectVerification"
    ) {
      const daysOverdue = differenceInUtcDays(
        finalPaymentDateUtc,
        billDueDateUtc,
      );
      if (daysOverdue > 0) {
        // Recalculate penalty on payment date
        currentPenalty = calculateIndividualPenalty(
          Number(bill.rentAmount),
          daysOverdue,
          bill.agreement.space.building,
          bill.agreement.space,
        );
      } else {
        currentPenalty = 0;
      }
    }

    const billUpdateData: Prisma.BillUpdateInput = {
      paymentReference: paymentData.paymentReference,
      adminVerificationNotes: paymentData.adminVerificationNotes,
      penaltyAmount: currentPenalty,
    };

    const baseAmount =
      Number(bill.rentAmount) +
      (utilityBreakdownItems.reduce((sum, util) => sum + util.amount, 0) || 0);
    billUpdateData.totalAmount = parseFloat(
      (baseAmount + (currentPenalty > 0 ? currentPenalty : 0)).toFixed(2),
    );

    if (
      actionType === "recordPayment" ||
      actionType === "confirmVerification"
    ) {
      newStatus = "Paid";
      billUpdateData.paymentDate = finalPaymentDate;
      billUpdateData.adminVerifiedPayment = true;
      billUpdateData.paymentMethod =
        actionType === "recordPayment" ? "Manual" : bill.paymentMethod;
      if (paymentData.paymentProofDataUri) {
        billUpdateData.paymentProofDataUri = paymentData.paymentProofDataUri;
      }
    } else if (actionType === "rejectVerification") {
      newStatus = isAfterUtcDay(today, billDueDateUtc) ? "Overdue" : "Pending";
      billUpdateData.adminVerifiedPayment = false; // Explicitly set to false
      billUpdateData.paymentDate = null;
      // Do not clear method or reference, keep them for history

      const rejectedBaseAmount =
        Number(bill.rentAmount) +
        (utilityBreakdownItems.reduce((sum, util) => sum + util.amount, 0) ||
          0);
      let rejectedPenalty = 0;
      if (newStatus === "Overdue") {
        const daysOverdueNow = differenceInUtcDays(today, billDueDateUtc);
        if (daysOverdueNow > 0) {
          rejectedPenalty = calculateIndividualPenalty(
            Number(bill.rentAmount),
            daysOverdueNow,
            bill.agreement.space.building,
            bill.agreement.space,
          );
          billUpdateData.penaltyAmount = rejectedPenalty;
        } else {
          billUpdateData.penaltyAmount = 0;
        }
      } else {
        billUpdateData.penaltyAmount = 0;
      }
      billUpdateData.totalAmount = parseFloat(
        (rejectedBaseAmount + rejectedPenalty).toFixed(2),
      );
    }

    billUpdateData.status = newStatus;
    const updatedBill = await databaseService.updateBill(
      billId,
      billUpdateData,
    );

    // --- Create Audit Log Entry on successful payment ---
    if (newStatus === "Paid" && bill.agreement?.space) {
      await prisma.auditLog.create({
        data: {
          actorId: currentUser.id,
          actorName: currentUser.name || currentUser.email,
          action: actionType,
          tenantId: bill.tenantId,
          tenantName: bill.agreement.tenant?.name || "N/A",
          buildingId: bill.agreement.space.buildingId,
          buildingName: bill.agreement.space.buildingName,
          spaceName: bill.agreement.space.spaceIdName,
          paymentDate: finalPaymentDate,
          rentAmount: bill.rentAmount,
          utilityAmount: utilityBreakdownItems.reduce(
            (sum, util) => sum + util.amount,
            0,
          ),
          penaltyAmount: currentPenalty,
          totalAmount: billUpdateData.totalAmount as number,
          transactionId: paymentData.paymentReference || bill.paymentReference,
          toAccountNumber: bill.agreement.space.building.accountNumber,
        },
      });
    }

    revalidatePath("/admin/billing");
    revalidatePath("/admin/audit-log");

    let parsedUtilityBreakdown: any[] = [];
    if (typeof updatedBill.utilityBreakdown === "string") {
      try {
        parsedUtilityBreakdown = JSON.parse(updatedBill.utilityBreakdown);
      } catch (e) {
        /* ignore */
      }
    } else if (Array.isArray(updatedBill.utilityBreakdown)) {
      parsedUtilityBreakdown = updatedBill.utilityBreakdown;
    }

    const serializedBill = {
      ...updatedBill,
      rentAmount: Number(updatedBill.rentAmount),
      penaltyAmount: updatedBill.penaltyAmount
        ? Number(updatedBill.penaltyAmount)
        : null,
      totalAmount: Number(updatedBill.totalAmount),
      billDate: updatedBill.billDate.toISOString(),
      dueDate: updatedBill.dueDate.toISOString(),
      createdAt: updatedBill.createdAt.toISOString(),
      updatedAt:
        updatedBill.updatedAt?.toISOString() ||
        updatedBill.createdAt.toISOString(),
      paymentDate: updatedBill.paymentDate?.toISOString() || null,
      utilityBreakdown: parsedUtilityBreakdown,
    };

    return { success: true, bill: serializedBill };
  } catch (error: any) {
    console.error(`Error in ${actionType}:`, error);
    return {
      success: false,
      error:
        error.message ||
        `Failed to ${actionType
          .replace("Verification", " verification")
          .toLowerCase()}.`,
    };
  }
}

export async function updateBillAdminDetailsAction(
  billId: string,
  data: {
    paymentReference?: string | null;
    paymentProofDataUri?: string | null;
    adminVerificationNotes?: string | null;
  },
) {
  try {
    const { isSuperAdmin, managedBuildingIds } = await getUserAndManagedIds();
    const bill = (await databaseService.getBillById(billId, {
      agreement: { include: { space: true } },
    })) as BillWithAgreementRecord | null;

    if (!bill) {
      return { success: false, error: "Bill not found." };
    }

    if (
      !isSuperAdmin &&
      (!bill.agreement?.space?.buildingId ||
        !managedBuildingIds?.includes(bill.agreement.space.buildingId))
    ) {
      return { success: false, error: "Permission denied." };
    }

    const updateData: Prisma.BillUpdateInput = {};
    if (data.paymentReference !== undefined) {
      updateData.paymentReference = data.paymentReference;
    }
    if (data.paymentProofDataUri !== undefined) {
      updateData.paymentProofDataUri = data.paymentProofDataUri;
    }
    if (data.adminVerificationNotes !== undefined) {
      updateData.adminVerificationNotes = data.adminVerificationNotes;
    }

    const updatedBill = await databaseService.updateBill(billId, updateData);

    revalidatePath("/admin/billing");

    // Serialize and return bill
    let parsedUtilityBreakdown: any[] = [];
    if (typeof updatedBill.utilityBreakdown === "string") {
      try {
        parsedUtilityBreakdown = JSON.parse(updatedBill.utilityBreakdown);
      } catch (e) {
        /* ignore */
      }
    } else if (Array.isArray(updatedBill.utilityBreakdown)) {
      parsedUtilityBreakdown = updatedBill.utilityBreakdown;
    }

    const serializedBill = {
      ...updatedBill,
      rentAmount: Number(updatedBill.rentAmount),
      penaltyAmount: Number(updatedBill.penaltyAmount ?? 0),
      totalAmount: Number(updatedBill.totalAmount),
      billDate: updatedBill.billDate.toISOString(),
      dueDate: updatedBill.dueDate.toISOString(),
      createdAt: updatedBill.createdAt.toISOString(),
      updatedAt:
        updatedBill.updatedAt?.toISOString() ||
        updatedBill.createdAt.toISOString(),
      paymentDate: updatedBill.paymentDate?.toISOString() || null,
      utilityBreakdown: parsedUtilityBreakdown,
    };

    return { success: true, bill: serializedBill };
  } catch (error: any) {
    console.error("Error updating bill details:", error);
    return {
      success: false,
      error: error.message || "Failed to update bill details.",
    };
  }
}

export async function getUpfrontBillUtilitySelectionAction(billId: string) {
  try {
    const data = await buildUpfrontBillUtilitySelectionData(billId);
    return { success: true, data };
  } catch (error: any) {
    console.error("Error fetching upfront bill utility selection:", error);
    return {
      success: false,
      error: error.message || "Failed to load utility options for this bill.",
    };
  }
}

export async function updateUpfrontBillUtilitiesAction(
  billId: string,
  selectedUtilityIds: string[],
) {
  try {
    const selectionData = await buildUpfrontBillUtilitySelectionData(billId);
    const selectedIds = new Set(selectedUtilityIds);
    const invalidSelection = selectedUtilityIds.some(
      (utilityId) =>
        !selectionData.utilities.some((item) => item.id === utilityId),
    );

    if (invalidSelection) {
      return {
        success: false,
        error:
          "One or more selected utilities are no longer available for this bill.",
      };
    }

    const selectedUtilities = selectionData.utilities
      .filter((utilityItem) => selectedIds.has(utilityItem.id))
      .map(({ id, name, amount }) => ({ id, name, amount }));

    const bill = await getEligibleUpfrontBillUtilityContext(billId);
    const penaltyAmount = Number(bill.penaltyAmount ?? 0);
    const totalUtilityAmount = selectedUtilities.reduce(
      (sum, utilityItem) => sum + utilityItem.amount,
      0,
    );

    const updateData: Prisma.BillUpdateInput = {
      utilityBreakdown: JSON.stringify(selectedUtilities),
    };

    if (bill.status !== "Paid") {
      updateData.totalAmount = parseFloat(
        (Number(bill.rentAmount) + penaltyAmount + totalUtilityAmount).toFixed(
          2,
        ),
      );
    }

    const updatedBill = await databaseService.updateBill(billId, updateData);

    revalidatePath("/admin/billing");
    revalidatePath("/admin/payments-overview");
    revalidatePath("/portal/billing");
    revalidatePath("/portal/dashboard");

    return { success: true, bill: serializeUpfrontUtilityBill(updatedBill) };
  } catch (error: any) {
    console.error("Error updating upfront bill utilities:", error);
    return {
      success: false,
      error: error.message || "Failed to update utilities for this bill.",
    };
  }
}

export async function generateUpfrontUtilityBillAction(billId: string) {
  try {
    const bill = await getEligibleUpfrontBillUtilityContext(billId);

    if (bill.status !== "Paid") {
      return {
        success: false,
        error:
          "Pay the original upfront bill first, then generate the utility bill for that month.",
      };
    }

    const selectionData = await buildUpfrontBillUtilitySelectionData(billId);
    const selectedUtilities = selectionData.utilities
      .filter((utilityItem) => utilityItem.selected)
      .map(({ id, name, amount }) => ({ id, name, amount }));

    if (selectedUtilities.length === 0) {
      return {
        success: false,
        error:
          "Select and save utilities that apply to this space first, then generate the utility bill for that month.",
      };
    }

    const billDayStart = toUtcStartOfDay(bill.billDate);
    const billDayEnd = addDays(billDayStart, 1);
    const totalUtilityAmount = parseFloat(
      selectedUtilities
        .reduce((sum, utilityItem) => sum + utilityItem.amount, 0)
        .toFixed(2),
    );

    const existingUtilityBill = await prisma.bill.findFirst({
      where: {
        agreementId: bill.agreementId,
        id: { not: bill.id },
        billDate: { gte: billDayStart, lt: billDayEnd },
        rentAmount: new Prisma.Decimal(0),
        AND: [{ isPrepaid: { not: true } }],
      },
      orderBy: { createdAt: "desc" },
    });

    if (
      existingUtilityBill &&
      (existingUtilityBill.status === "Paid" ||
        existingUtilityBill.status === "PendingVerification")
    ) {
      return {
        success: false,
        error:
          "A utility bill for this month already exists and has payment activity. It cannot be regenerated.",
      };
    }

    let generatedBill: BillPrismaOriginal;

    if (existingUtilityBill) {
      generatedBill = await prisma.bill.update({
        where: { id: existingUtilityBill.id },
        data: {
          utilityBreakdown: JSON.stringify(selectedUtilities),
          rentAmount: new Prisma.Decimal(0),
          penaltyAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(totalUtilityAmount),
          billDate: bill.billDate,
          dueDate: bill.dueDate,
          status: "Pending",
          paymentDate: null,
          paymentMethod: null,
          paymentReference: null,
          bankOrWalletName: null,
          paymentProofDataUri: null,
          tenantPaymentNotes: null,
          adminVerifiedPayment: false,
          adminVerificationNotes: null,
          isPrepaid: false,
        },
      });
    } else {
      generatedBill = await prisma.bill.create({
        data: {
          agreementId: bill.agreementId,
          tenantId: bill.tenantId,
          billDate: bill.billDate,
          dueDate: bill.dueDate,
          rentAmount: new Prisma.Decimal(0),
          utilityBreakdown: JSON.stringify(selectedUtilities),
          penaltyAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(totalUtilityAmount),
          status: "Pending",
          paymentDate: null,
          paymentMethod: null,
          paymentReference: null,
          bankOrWalletName: null,
          paymentProofDataUri: null,
          tenantPaymentNotes: null,
          adminVerifiedPayment: false,
          adminVerificationNotes: null,
          isPrepaid: false,
        },
      });
    }

    revalidatePath("/admin/billing");
    revalidatePath("/admin/payments-overview");
    revalidatePath("/portal/billing");
    revalidatePath("/portal/dashboard");

    return {
      success: true,
      bill: serializeUpfrontUtilityBill(generatedBill),
      mode: existingUtilityBill ? "updated" : "created",
    };
  } catch (error: any) {
    console.error("Error generating upfront utility bill:", error);
    return {
      success: false,
      error: error.message || "Failed to generate the utility bill.",
    };
  }
}
