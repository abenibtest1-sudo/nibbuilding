// src/app/admin/payments-overview/actions.ts
"use server";

import { databaseService } from "@/lib/services/databaseService";
import type {
  Agreement as AgreementPrisma,
  Bill as BillPrisma,
  Space as SpacePrisma,
  Prisma,
} from "@prisma/client";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";

// Define a simple structure for parsed utility items
interface ParsedUtilityItem {
  id?: string;
  name: string;
  amount: number;
}

// Define the structure for the data needed by the Payments Overview page
// UtilityBreakdown is now an array of simple parsed items.
export type PaymentsOverviewAgreement = Prisma.AgreementGetPayload<{
  include: {
    tenant: true;
    space: {
      include: {
        building: {
          include: { penaltyPolicyTiers: true };
        };
      };
    };
  };
}>;

export type PaymentsOverviewBill = Omit<BillPrisma, "utilityBreakdown"> & {
  agreement: PaymentsOverviewAgreement;
  utilityBreakdown: ParsedUtilityItem[];
};

export interface PaymentsOverviewData {
  bills: PaymentsOverviewBill[];
  spaces: SpacePrisma[]; // For "Total Potential Monthly Revenue"
  agreements: PaymentsOverviewAgreement[];
}

export async function getPaymentsOverviewDataAction(): Promise<PaymentsOverviewData> {
  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);
  const hasAssignedBuildingScope =
    Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

  const billWhere: Prisma.BillWhereInput = !canSeeAllBuildings
    ? hasAssignedBuildingScope
      ? {
          OR: [
            { agreement: { buildingId: { in: managedBuildingIds } } },
            {
              agreement: { space: { buildingId: { in: managedBuildingIds } } },
            },
            { tenant: { buildingId: { in: managedBuildingIds } } },
          ],
        }
      : { agreement: { createdById: currentUser.id } }
    : {};
  const spaceWhere: Prisma.SpaceWhereInput = !canSeeAllBuildings
    ? hasAssignedBuildingScope
      ? { buildingId: { in: managedBuildingIds } }
      : { createdById: currentUser.id }
    : {};
  const agreementWhere: Prisma.AgreementWhereInput = !canSeeAllBuildings
    ? hasAssignedBuildingScope
      ? {
          OR: [
            { buildingId: { in: managedBuildingIds } },
            { space: { buildingId: { in: managedBuildingIds } } },
          ],
        }
      : { createdById: currentUser.id }
    : {};

  const [rawBills, spaces, agreements] = await Promise.all([
    databaseService.getAllBills({
      where: billWhere,
      include: {
        agreement: {
          include: {
            tenant: true,
            space: {
              include: {
                building: {
                  include: { penaltyPolicyTiers: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    databaseService.getAllSpaces({ where: spaceWhere }),
    databaseService.getAllAgreements({
      where: agreementWhere,
      include: {
        tenant: true,
        space: {
          include: {
            building: {
              include: { penaltyPolicyTiers: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const bills: PaymentsOverviewBill[] = rawBills.map((rawBill) => {
    let parsedUtilityBreakdown: ParsedUtilityItem[] = [];
    const rawUtilityData = (rawBill as any).utilityBreakdown;

    if (typeof rawUtilityData === "string") {
      try {
        const jsonData = JSON.parse(rawUtilityData);
        if (Array.isArray(jsonData)) {
          parsedUtilityBreakdown = jsonData
            .filter(
              (item) =>
                typeof item.name === "string" &&
                typeof item.amount === "number",
            )
            .map((item) => ({
              name: item.name,
              amount: item.amount,
              id: typeof item.id === "string" ? item.id : undefined,
            }));
        }
      } catch (e) {
        console.error(
          `Failed to parse utilityBreakdown JSON for bill ${rawBill.id}:`,
          e,
          rawUtilityData,
        );
      }
    } else if (Array.isArray(rawUtilityData)) {
      parsedUtilityBreakdown = rawUtilityData
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

    const {
      utilityBreakdown: _originalUtilityData,
      ...billWithoutOriginalUtility
    } = rawBill;

    return {
      ...billWithoutOriginalUtility,
      agreement: (rawBill as any).agreement,
      utilityBreakdown: parsedUtilityBreakdown,
    };
  }) as PaymentsOverviewBill[];

  return {
    bills,
    spaces,
    agreements: agreements as PaymentsOverviewAgreement[],
  };
}
