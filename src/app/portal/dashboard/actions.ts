"use server";

import { databaseService } from "@/lib/services/databaseService";
import type {
  Agreement as AgreementPrisma,
  Bill as BillPrisma,
  Space as SpacePrisma,
  Building as BuildingPrisma,
  Tenant as TenantPrisma,
  PenaltyTier as PenaltyTierPrisma,
  User,
  Role,
} from "@prisma/client";
import { addMonths, isAfter, format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { cookies } from "next/headers";
// --- User Authentication Helper ---
// This function uses the project's custom JWT session verification.
async function getCurrentUser(): Promise<(User & { roles: Role[] }) | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (session?.userId) {
    const user = await databaseService.getUserById(session.userId, {
      roles: true,
    });
    if (user) return user;
  }
  return null;
}

// Define a simple structure for parsed utility items
interface ParsedUtilityItemForAction {
  id?: string;
  name: string;
  amount: number;
}

// Types that match the structure of data fetched with Prisma, including relations
export type PortalAgreementWithRelations = Omit<AgreementPrisma, "bills"> & {
  space: SpacePrisma & {
    building: BuildingPrisma & {
      penaltyPolicyTiers: PenaltyTierPrisma[];
      managers: User[]; // <-- Ensure managers are included
    };
  };
  tenant: TenantPrisma;
  bills: (Omit<
    BillPrisma,
    | "utilityBreakdown"
    | "rentAmount"
    | "penaltyAmount"
    | "totalAmount"
    | "billDate"
    | "dueDate"
    | "createdAt"
    | "updatedAt"
    | "paymentDate"
  > & {
    utilityBreakdown: ParsedUtilityItemForAction[];
    rentAmount: number;
    penaltyAmount: number | null;
    totalAmount: number;
    billDate: string;
    dueDate: string;
    createdAt: string;
    updatedAt: string;
    paymentDate: string | null;
  })[];
};

export interface TenantPortalData {
  agreements: PortalAgreementWithRelations[]; // Changed to an array
  messages?: {
    id: string;
    subject: string | null;
    body: string;
    createdAt: string;
    readAt: string | null;
    buildingName?: string | null;
  }[];
  error?: string;
}

export async function getTenantPortalDashboardDataAction(): Promise<TenantPortalData> {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return {
        agreements: [],
        error:
          "Your session is invalid or has expired. Please re-enter from the Mini App or login page.",
      };
    }

    // Find the tenant record associated with the logged-in user's email or phone number
    const associatedTenant = await databaseService.findTenantByEmailOrPhone(
      currentUser.email,
      currentUser.phoneNumber,
    );

    if (!associatedTenant) {
      console.error(
        `Portal Data Error: User '${currentUser.email}' is authenticated but not associated with any tenant record.`,
      );
      return {
        agreements: [],
        error:
          "Your user account is not associated with any tenant profile. Please contact property management.",
      };
    }

    const allAgreementsRaw = await databaseService.getAllAgreements({
      where: { tenantId: associatedTenant.id },
      include: {
        tenant: true,
        space: {
          include: {
            building: {
              include: {
                penaltyPolicyTiers: true,
                managers: true, // Fetch managers
              },
            },
          },
        },
        bills: {
          orderBy: { billDate: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Filter out disabled agreements before processing
    const enabledAgreements = allAgreementsRaw.filter(
      (ag) => ag.status !== "Canceled",
    );

    const processedAgreements = enabledAgreements.map((ag) => {
      const processedBills = ag.bills.map((rawBill) => {
        let parsedItems: ParsedUtilityItemForAction[] = [];
        const rawUtilityData = (rawBill as any).utilityBreakdown;

        if (typeof rawUtilityData === "string") {
          try {
            const jsonData = JSON.parse(rawUtilityData);
            if (Array.isArray(jsonData)) {
              parsedItems = jsonData
                .filter(
                  (item) =>
                    typeof item.name === "string" &&
                    typeof item.amount === "number",
                )
                .map((item) => ({
                  name: item.name,
                  amount: Number(item.amount), // Ensure number
                  id: typeof item.id === "string" ? item.id : undefined,
                }));
            }
          } catch (e) {
            console.error(
              `Portal Action: Failed to parse utilityBreakdown JSON for bill ${rawBill.id}:`,
              e,
            );
          }
        } else if (Array.isArray(rawUtilityData)) {
          parsedItems = rawUtilityData
            .filter(
              (item) =>
                typeof item.name === "string" &&
                typeof item.amount === "number",
            )
            .map((item) => ({
              name: item.name,
              amount: Number(item.amount), // Ensure number
              id: typeof item.id === "string" ? item.id : undefined,
            }));
        }

        const { utilityBreakdown: _originalScalarUtilityData, ...billData } =
          rawBill;

        // Serialize Decimal and Date fields in the bill
        const rentAmount = Number(billData.rentAmount);
        const totalAmount = Number(billData.totalAmount);
        const utilitySum = parsedItems.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        );

        // Derive penalty if not explicitly stored
        let penaltyAmount = billData.penaltyAmount
          ? Number(billData.penaltyAmount)
          : null;
        if (!penaltyAmount && totalAmount > rentAmount + utilitySum) {
          penaltyAmount = totalAmount - rentAmount - utilitySum;
        }

        return {
          ...billData,
          utilityBreakdown: parsedItems,
          rentAmount,
          penaltyAmount:
            penaltyAmount !== null && penaltyAmount > 0 ? penaltyAmount : null,
          totalAmount,
          billDate: billData.billDate.toISOString(),
          dueDate: billData.dueDate.toISOString(),
          createdAt: billData.createdAt.toISOString(),
          updatedAt: billData.updatedAt.toISOString(),
          paymentDate: billData.paymentDate
            ? billData.paymentDate.toISOString()
            : null,
        };
      });

      // Serialize Decimal and Date fields in the agreement and its relations
      return {
        ...ag,
        bills: processedBills,
        startDate: ag.startDate.toISOString(),
        createdAt: ag.createdAt.toISOString(),
        updatedAt: ag.updatedAt.toISOString(),
        nextPaymentDueDate: ag.nextPaymentDueDate.toISOString(),
        initialPaymentDate: ag.initialPaymentDate
          ? ag.initialPaymentDate.toISOString()
          : null,
        endDate: ag.endDate ? ag.endDate.toISOString() : null,
        monthlyRentalPrice: Number(ag.monthlyRentalPrice),
        initialPaymentAmount: ag.initialPaymentAmount
          ? Number(ag.initialPaymentAmount)
          : null,
        space: {
          ...ag.space,
          area: Number(ag.space.area),
          monthlyRentalPrice: Number(ag.space.monthlyRentalPrice),
          utilityProrationShare: Number(ag.space.utilityProrationShare),
          createdAt: ag.space.createdAt.toISOString(),
          updatedAt: ag.space.updatedAt.toISOString(),
          building: {
            ...ag.space.building,
            createdAt: ag.space.building.createdAt.toISOString(),
            updatedAt: ag.space.building.updatedAt.toISOString(),
            penaltyPolicyTiers: ag.space.building.penaltyPolicyTiers.map(
              (tier) => ({
                ...tier,
                feeValue: Number(tier.feeValue),
              }),
            ),
          },
        },
        tenant: {
          ...ag.tenant,
          createdAt: ag.tenant.createdAt.toISOString(),
          updatedAt: ag.tenant.updatedAt.toISOString(),
        },
      };
    });

    const activeAgreements = processedAgreements.filter((ag) => {
      const agreementEndDate = addMonths(
        new Date(ag.startDate),
        ag.paymentTermMonths,
      );
      return isAfter(agreementEndDate, new Date());
    });

    if (activeAgreements.length === 0) {
      return {
        agreements: [],
        messages: [],
        error: "You do not have any active agreements.",
      };
    }

    // Fetch tenant's sent messages so they can view message history from the portal
    const tenantMessagesRaw = await (prisma as any).tenantMessage.findMany({
      where: { tenantId: associatedTenant.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        body: true,
        createdAt: true,
        readAt: true,
        building: { select: { name: true } },
      },
    });

    const tenantMessages = tenantMessagesRaw.map((m: any) => ({
      id: m.id,
      subject: m.subject ?? null,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
      buildingName: m.building?.name ?? null,
    }));

    return {
      agreements: activeAgreements as unknown as PortalAgreementWithRelations[],
      messages: tenantMessages,
      error: undefined,
    };
  } catch (error: any) {
    console.error("Error fetching tenant portal data:", error);
    return {
      agreements: [],
      error: `Failed to fetch portal data: ${(error as Error).message}`,
    };
  }
}
