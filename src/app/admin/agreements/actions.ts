"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import {
  Prisma,
  type Agreement,
  AgreementStatus,
  type Building as BuildingPrismaOriginal,
} from "@prisma/client";
import { addMonths, parseISO } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  getUserAndManagedIds,
  getUserAndPermissions,
} from "@/lib/actions/server-helpers";
import { calculateInitialNextBillingDate } from "@/lib/billing-schedule";
import { getBillDateConfiguration } from "@/lib/application-settings";
import {
  toUtcStartOfDay,
  isAfterUtcDay,
  differenceInUtcDays,
} from "@/lib/utils";

export interface CreateFullAgreementData {
  // IDs for relations
  tenantId: string;
  spaceId: string;
  agreementTemplateId: string;

  // Details for the agreement itself
  agreementText: string;
  startDate: string; // ISO String from client
  monthlyRentalPrice: number; // From selected space
  paymentTermMonths: number;
  initialPaymentMonths: number;
  additionalTerms?: string | null;
}

function calculateIndividualPenalty(
  billAmount: number,
  daysOverdue: number,
  building: BuildingPrismaOriginal & {
    penaltyPolicyTiers: Prisma.PenaltyTierGetPayload<{}>[];
  },
  space: {
    floor: string;
    spaceIdName: string;
  },
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

export async function createFullAgreementAction(
  input: CreateFullAgreementData,
  options?: { bypassPermission?: boolean },
) {
  try {
    const { currentUser, isSuperAdmin, permissions, managedBuildingIds } =
      await getUserAndManagedIds();
    const canImport =
      isSuperAdmin ||
      permissions.has("import:manage") ||
      (managedBuildingIds && managedBuildingIds.length > 0);

    if (!isSuperAdmin && !permissions.has("agreement:create")) {
      if (!(options?.bypassPermission && canImport)) {
        return { success: false, error: "Access Denied" };
      }
    }

    const [tenantRecord, agreementTemplateRecord] = await Promise.all([
      databaseService.getTenantById(input.tenantId),
      databaseService.getAgreementTemplateById(input.agreementTemplateId),
    ]);

    if (!tenantRecord) {
      return { success: false, error: "Selected tenant not found." };
    }

    if (!agreementTemplateRecord) {
      return {
        success: false,
        error: "Selected agreement template not found.",
      };
    }

    // If the incoming start date is a date-only string (YYYY-MM-DD),
    // construct a UTC-midnight Date so storing it in the DB doesn't
    // shift it backward by the local timezone offset (e.g. 00:00 local
    // -> previous day 21:00 UTC). This ensures the first bill created
    // at agreement import has the same calendar date in the DB.
    let startDateObj: Date;
    const rawStart = String(input.startDate || "").trim();
    const dateOnlyMatch = /^\d{4}-\d{1,2}-\d{1,2}$/.test(rawStart);
    if (dateOnlyMatch) {
      const [y, m, d] = rawStart.split("-").map(Number);
      startDateObj = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    } else {
      startDateObj = parseISO(rawStart);
    }
    // Validate business rules: initial payment months must not exceed total term
    if (
      typeof input.initialPaymentMonths === "number" &&
      typeof input.paymentTermMonths === "number" &&
      input.initialPaymentMonths > input.paymentTermMonths
    ) {
      return {
        success: false,
        error:
          "Initial payment months cannot exceed total payment term months.",
      };
    }

    // Compute agreement end date based on initial prepaid months.
    const endDateObj = addMonths(startDateObj, input.paymentTermMonths);
    const initialMonths = input.initialPaymentMonths || 0;
    const initialPaymentAmount = input.monthlyRentalPrice * initialMonths;

    // Persist date-only strings (YYYY-MM-DD) to ensure the DB stores the
    // same calendar date regardless of timezone or column type.
    const toDateOnlyString = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const startDateForDb = toDateOnlyString(startDateObj);
    const initialPaymentDateForDb = toDateOnlyString(startDateObj);
    const endDateForDb = toDateOnlyString(endDateObj);

    // Prisma expects a Date object or full ISO-8601 date-time string for DateTime
    // fields. Construct Date objects at UTC-midnight so the stored calendar
    // date is consistent regardless of server TZ.
    const toUtcMidnight = (d: Date) =>
      new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0),
      );
    const startDateForDbDate = toUtcMidnight(startDateObj);
    const initialPaymentDateForDbDate = toUtcMidnight(startDateObj);
    const endDateForDbDate = toUtcMidnight(endDateObj);

    const newAgreementId = await prisma.$transaction(async (tx) => {
      // Determine the building for the selected space so we can attach
      // the agreement directly to that building.
      const spaceRecord = await tx.space.findUnique({
        where: { id: input.spaceId },
        select: {
          id: true,
          buildingId: true,
          status: true,
          isOccupied: true,
          floor: true,
          spaceIdName: true,
          utilityProrationShare: true,
        },
      });
      if (!spaceRecord) {
        throw new Error("Selected space not found.");
      }

      if (!isSuperAdmin && managedBuildingIds) {
        if (!managedBuildingIds.includes(spaceRecord.buildingId)) {
          throw new Error("Permission denied.");
        }
      }
      if (
        (spaceRecord as any).status &&
        (spaceRecord as any).status !== "Active"
      ) {
        throw new Error(
          "Selected space is not approved yet. Please wait for space approval before creating an agreement.",
        );
      }
      if (spaceRecord.isOccupied) {
        throw new Error("Selected space is already occupied.");
      }
      const billDateConfiguration = await getBillDateConfiguration(
        spaceRecord.buildingId,
      );
      // For the billing UI we want to show the next scheduled billing tick.
      // When an aggregated prepaid bill is created that covers multiple cycles,
      // the UI should still show the upcoming due date so users can generate
      // the next invoice (which may be prepaid/zero rent if still within the
      // prepaid window). The next due date follows the configured billing
      // cycle length when present, otherwise it follows the default 30-day
      // billing cycle.
      const nextPaymentDueDateObj = calculateInitialNextBillingDate(
        startDateObj,
        billDateConfiguration,
      );
      const nextPaymentDueForDbDate = toUtcMidnight(nextPaymentDueDateObj);
      const targetBuildingId = spaceRecord ? spaceRecord.buildingId : null;

      // Build the agreement creation payload, conditionally adding
      // the building relation when we have a building id.
      const agreementData: any = {
        agreementText: input.agreementText,
        startDate: startDateForDbDate,
        monthlyRentalPrice: input.monthlyRentalPrice,
        paymentTermMonths: input.paymentTermMonths,
        initialPaymentMonths: input.initialPaymentMonths,
        nextPaymentDueDate: nextPaymentDueForDbDate,
        endDate: endDateForDbDate,
        additionalTerms: input.additionalTerms,
        status: isSuperAdmin ? "Active" : "Pending",

        createdBy: { connect: { id: currentUser.id } },
        ...(isSuperAdmin
          ? { approvedBy: { connect: { id: currentUser.id } } }
          : {}),

        initialPaymentAmount: initialPaymentAmount,
        initialPaymentDate: initialPaymentDateForDbDate,

        tenant: { connect: { id: input.tenantId } },
        space: { connect: { id: input.spaceId } },
        agreementTemplate: { connect: { id: input.agreementTemplateId } },
      };

      if (targetBuildingId) {
        agreementData.building = { connect: { id: targetBuildingId } };
      }

      const agreement = await tx.agreement.create({ data: agreementData });

      // 2. If there are initial prepaid months, create a single aggregated
      // bill at agreement creation that covers `initialPaymentMonths`.
      // Subsequent monthly bills will still be generated each month; for
      // months covered by the prepaid amount the monthly rent portion will
      // be zero so utilities/penalties can still apply.
      const monthlyAmount = input.monthlyRentalPrice;
      const initialMonthsForCreation = initialMonths;

      if (initialMonthsForCreation > 0) {
        const initialAmount = monthlyAmount * initialMonthsForCreation;

        // Utilities on the first bill: only include if a utilities record exists
        // for the agreement start month (and it is Active).
        const utilityItemsForJson: { name: string; amount: number }[] = [];
        let totalUtilityCostForBill = 0;

        const utilityYear = startDateObj.getUTCFullYear();
        const utilityMonth = startDateObj.getUTCMonth();

        const monthlyBuildingUtilityData =
          await tx.buildingMonthlyUtilities.findFirst({
            where: {
              buildingId: spaceRecord.buildingId,
              year: utilityYear,
              month: utilityMonth,
            },
            include: { utilities: true },
          });

        if (
          monthlyBuildingUtilityData &&
          (monthlyBuildingUtilityData as any).status === "Active" &&
          monthlyBuildingUtilityData.utilities &&
          monthlyBuildingUtilityData.utilities.length > 0
        ) {
          const allUtilitiesForPeriod = monthlyBuildingUtilityData.utilities;

          for (const utilItem of allUtilitiesForPeriod) {
            let costForThisItem = 0;
            const utilTotalCost = Number((utilItem as any).totalCost);
            if (isNaN(utilTotalCost)) continue;

            if ((utilItem as any).appliesToScope === "Building") {
              const prorationShare = Number(spaceRecord.utilityProrationShare);
              if (!isNaN(prorationShare) && prorationShare > 0) {
                costForThisItem = utilTotalCost * prorationShare;
              }
            } else if (
              (utilItem as any).appliesToScope === "Floor" &&
              (utilItem as any).applicableFloor === spaceRecord.floor
            ) {
              let percentages: Record<string, number> = {};
              if (
                (utilItem as any).perSpaceAllocation &&
                typeof (utilItem as any).perSpaceAllocation === "string"
              ) {
                try {
                  percentages = JSON.parse(
                    (utilItem as any).perSpaceAllocation,
                  );
                } catch (e) {}
              }
              const spacePercentage = percentages[spaceRecord.id];
              if (spacePercentage && spacePercentage > 0) {
                costForThisItem = utilTotalCost * (spacePercentage / 100);
              }
            } else if ((utilItem as any).appliesToScope === "SpecificSpaces") {
              const applicable = (utilItem as any).applicableSpaceIdNames;
              if (
                Array.isArray(applicable) &&
                applicable.includes(spaceRecord.spaceIdName)
              ) {
                costForThisItem = utilTotalCost;
              }
            }

            if (costForThisItem > 0) {
              const roundedCost = parseFloat(costForThisItem.toFixed(2));
              utilityItemsForJson.push({
                name: (utilItem as any).name,
                amount: roundedCost,
              });
              totalUtilityCostForBill += roundedCost;
            }
          }
        }

        const utilityBreakdownJson =
          utilityItemsForJson.length > 0
            ? JSON.stringify(utilityItemsForJson)
            : Prisma.JsonNull;

        const buildingWithPenalties = await tx.building.findUnique({
          where: { id: spaceRecord.buildingId },
          include: { penaltyPolicyTiers: true },
        });

        const today = toUtcStartOfDay(new Date());
        const effectiveBillDate = toUtcStartOfDay(startDateObj);

        let initialPenalty = 0;

        if (buildingWithPenalties) {
          let daysOverdue = 0;

          if (isAfterUtcDay(today, effectiveBillDate)) {
            daysOverdue = differenceInUtcDays(today, effectiveBillDate);
          }

          initialPenalty = calculateIndividualPenalty(
            initialAmount, // rent portion
            daysOverdue, // correct overdue days
            buildingWithPenalties,
            spaceRecord,
          );
        }

        console.log("initialPenalty", initialPenalty);

        const totalAmount =
          initialAmount + totalUtilityCostForBill + initialPenalty;

        await tx.bill.create({
          data: {
            agreementId: agreement.id,
            tenantId: input.tenantId,
            billDate: startDateForDbDate,
            dueDate: startDateForDbDate,
            rentAmount: initialAmount,
            utilityBreakdown: utilityBreakdownJson,
            penaltyAmount: initialPenalty,
            totalAmount: totalAmount,
            status: "Pending",
            paymentDate: null,
            paymentMethod: null,
            paymentReference: null,
            adminVerifiedPayment: false,
            isPrepaid: true,
          },
        });
        // Keep the agreement pointing at the next scheduled billing date so
        // the billing page shows the upcoming due even when several months
        // are covered by the prepaid invoice.
        const nextDueAfterInitialBill = toUtcMidnight(nextPaymentDueDateObj);
        await tx.agreement.update({
          where: { id: agreement.id },
          data: { nextPaymentDueDate: nextDueAfterInitialBill },
        });
      }

      // 3. Update space to be occupied by this tenant
      await tx.space.update({
        where: { id: input.spaceId },
        data: {
          isOccupied: true,
        },
      });

      // 4. Update tenant's rentedSpaceId
      await tx.tenant.update({
        where: { id: input.tenantId },
        data: {
          rentedSpace: { connect: { id: input.spaceId } },
        },
      });

      return agreement.id;
    });

    // Re-fetch the agreement with all relations to ensure the returned object is complete
    const completeNewAgreement = await databaseService.getAgreementById(
      newAgreementId,
      // Include building so callers can see the explicit building attachment
      { tenant: true, space: true, building: true } as any,
    );

    if (!completeNewAgreement) {
      throw new Error("Failed to re-fetch the newly created agreement.");
    }

    revalidatePath("/admin/agreements");
    revalidatePath("/admin/spaces"); // Space occupancy changed
    revalidatePath("/admin/tenants"); // Tenant's rentedSpace changed
    revalidatePath("/admin/billing"); // Invalidate billing page data

    // Convert Decimal fields to numbers before returning
    const serializableAgreement = {
      ...completeNewAgreement,
      monthlyRentalPrice: Number(completeNewAgreement.monthlyRentalPrice),
      initialPaymentAmount: completeNewAgreement.initialPaymentAmount
        ? Number(completeNewAgreement.initialPaymentAmount)
        : null,
      buildingId: (completeNewAgreement as any).buildingId ?? null,
      building: (completeNewAgreement as any).building ?? null,
    };

    return { success: true, agreement: serializableAgreement };
  } catch (error: any) {
    console.error("Error creating agreement:", error);
    let errorMessage = "Failed to create agreement.";
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        errorMessage =
          "Failed to create agreement. A similar agreement might already exist or related data conflict (e.g. space already linked).";
      } else if (error.code === "P2025") {
        errorMessage =
          "Failed to create agreement. Tenant, Space, or Template not found.";
      }
    } else if (error.message) {
      errorMessage = error.message;
    }
    return { success: false, error: errorMessage };
  }
}

export async function setAgreementStatusAction(
  agreementId: string,
  newStatus: AgreementStatus,
  rejectionReason?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions, currentUser } =
      await getUserAndPermissions();

    if (newStatus === "Active" || newStatus === "Rejected") {
      if (!isSuperAdmin && !permissions.has("agreement:approve")) {
        return { success: false, error: "Access Denied" };
      }
    }

    const agreement = await prisma.agreement.findUnique({
      where: { id: agreementId },
      include: { bills: true },
    });
    if (!agreement) {
      return { success: false, error: "Agreement not found." };
    }

    if (agreement.status !== "Pending") {
      return {
        success: false,
        error: "Only Pending agreements can be approved or rejected.",
      };
    }

    if (newStatus === "Active") {
      await prisma.agreement.update({
        where: { id: agreementId },
        data: {
          status: "Active",
          rejectionReason: null,
          approvedBy: { connect: { id: currentUser.id } },
        },
      });
    }

    if (newStatus === "Rejected") {
      const hasPaidBill = agreement.bills.some((b) => b.status === "Paid");
      if (hasPaidBill) {
        return {
          success: false,
          error:
            "Cannot reject an agreement that already has a paid bill. Cancel it instead.",
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.agreement.update({
          where: { id: agreementId },
          data: {
            status: "Rejected",
            rejectionReason: rejectionReason || null,
            approvedBy: { connect: { id: currentUser.id } },
          },
        });

        if (agreement.spaceId) {
          await tx.space.update({
            where: { id: agreement.spaceId },
            data: { isOccupied: false },
          });
        }

        if (agreement.tenantId) {
          await tx.tenant.update({
            where: { id: agreement.tenantId },
            data: { rentedSpaceId: null },
          });
        }

        await tx.bill.deleteMany({
          where: { agreementId: agreementId, status: { not: "Paid" } },
        });
      });
    }

    revalidatePath("/admin/agreements");
    revalidatePath("/admin/spaces");
    revalidatePath("/admin/tenants");
    revalidatePath("/admin/billing");
    revalidatePath("/admin/dashboard");

    return { success: true };
  } catch (error: any) {
    console.error("Error changing agreement status:", error);
    return {
      success: false,
      error: error.message || `Failed to set agreement status to ${newStatus}.`,
    };
  }
}

export async function cancelAgreementAction(
  agreementId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions } = await getUserAndPermissions();
    if (
      !isSuperAdmin &&
      !permissions.has("agreement:cancel") &&
      !permissions.has("agreement:edit")
    ) {
      return { success: false, error: "Access Denied" };
    }

    const agreement = await databaseService.getAgreementById(agreementId);
    if (!agreement) {
      return { success: false, error: "Agreement not found." };
    }

    if (agreement.status === "Canceled") {
      return {
        success: false,
        error: "This agreement has already been canceled.",
      };
    }

    await prisma.$transaction(async (tx) => {
      // 1. Update the agreement status to 'Canceled'
      await tx.agreement.update({
        where: { id: agreementId },
        data: { status: "Canceled" },
      });

      // 2. Free up the space
      if (agreement.spaceId) {
        await tx.space.update({
          where: { id: agreement.spaceId },
          data: { isOccupied: false },
        });
      }

      // 3. Disconnect tenant from the space
      if (agreement.tenantId) {
        await tx.tenant.update({
          where: { id: agreement.tenantId },
          data: { rentedSpaceId: null },
        });
      }

      // 4. Delete all non-paid bills for this agreement
      await tx.bill.deleteMany({
        where: {
          agreementId: agreementId,
          status: { not: "Paid" },
        },
      });
    });

    revalidatePath("/admin/agreements");
    revalidatePath("/admin/spaces");
    revalidatePath("/admin/tenants");
    revalidatePath("/admin/billing");
    revalidatePath("/admin/dashboard");

    return { success: true };
  } catch (error: any) {
    console.error("Error cancelling agreement:", error);
    return {
      success: false,
      error: error.message || "Failed to cancel agreement.",
    };
  }
}
