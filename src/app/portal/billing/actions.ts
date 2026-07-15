"use server";

import { databaseService } from "@/lib/services/databaseService";
import type { Bill as BillPrisma, User, Role, Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import {
  GENERIC_AUTH_ERROR,
  GENERIC_NEUTRAL_ERROR,
} from "@/lib/security/messages";
import crypto from "crypto";
import { cookies } from "next/headers";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  differenceInUtcDays,
  isAfterUtcDay,
  toUtcStartOfDay,
} from "@/lib/utils";

function calculateIndividualPenalty(
  billAmount: number,
  daysOverdue: number,
  building: Prisma.BuildingGetPayload<{
    include: { penaltyPolicyTiers: true };
  }>,
  space: Prisma.SpaceGetPayload<{}>,
): number {
  if (
    daysOverdue <= 0 ||
    !building.penaltyPolicyTiers ||
    building.penaltyPolicyTiers.length === 0
  ) {
    return 0;
  }

  const allTiers = building.penaltyPolicyTiers;

  const spaceSpecificTiers = allTiers.filter(
    (t) =>
      t.scope === "SpecificSpaces" &&
      t.applicableSpaceIdNames?.includes(space.spaceIdName),
  );

  const floorSpecificTiers = allTiers.filter(
    (t) => t.scope === "Floor" && t.applicableFloor === space.floor,
  );

  const buildingWideTiers = allTiers.filter((t) => t.scope === "Building");

  let applicableTiers: typeof allTiers = [];
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
  const oneTimeFeesApplied = new Set<string>();

  for (let day = 1; day <= daysOverdue; day++) {
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
        if (!oneTimeFeesApplied.has(tierForDay.id)) {
          totalPenalty += dailyFee;
          oneTimeFeesApplied.add(tierForDay.id);
        }
      }
    }
  }

  return parseFloat(totalPenalty.toFixed(2));
}

async function getCurrentUser(): Promise<(User & { roles: Role[] }) | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (session?.userId) {
    const user = await databaseService.getUserById(session.userId, {
      roles: true,
    });
    if (user) return user;
  }

  return null;
}

export async function getBillingInfoForPhoneNumberAction(phone: string) {
  try {
    const normalizePhoneVariants = (raw: string) => {
      const trimmed = (raw ?? "").trim();
      if (!trimmed) return [] as string[];

      const variants = new Set<string>();
      variants.add(trimmed);

      // Normalize MSISDN ("2519...") to local ("09...")
      if (trimmed.startsWith("251") && trimmed.length >= 12) {
        variants.add("0" + trimmed.substring(3));
      }

      // Normalize local ("09...") to MSISDN ("2519...")
      if (trimmed.startsWith("0") && trimmed.length >= 10) {
        variants.add("251" + trimmed.substring(1));
      }

      return Array.from(variants);
    };

    const phoneVariants = normalizePhoneVariants(phone);
    if (phoneVariants.length === 0) {
      return { success: false, error: GENERIC_NEUTRAL_ERROR };
    }

    let tenant = null;
    for (const p of phoneVariants) {
      tenant = await databaseService.findTenantByEmailOrPhone(null, p);
      if (tenant) break;
    }
    if (!tenant) return { success: false, error: "User not found!" };

    const agreementsRaw = await databaseService.getAllAgreements({
      where: {
        tenantId: tenant.id,
        status: "Active", // Only fetch active agreements
      },
      include: {
        space: {
          include: {
            building: {
              include: {
                penaltyPolicyTiers: true,
              },
            },
          },
        },
        bills: {
          where: {
            // Treat any non-paid / not-finalized state as outstanding.
            status: { in: ["Pending", "Overdue", "PendingVerification"] },
          },
          orderBy: {
            billDate: "asc",
          },
        },
      },
    });

    // We only care about agreements that have outstanding bills
    const agreementsWithBills = agreementsRaw.filter(
      (ag) => ag.bills.length > 0,
    );

    if (agreementsWithBills.length === 0) {
      return {
        success: true,
        agreements: [],
        message: "You have no outstanding bills. Thank you!",
      };
    }

    // Helper to derive penalty amount from totalAmount when not explicitly stored
    const derivePenaltyAmount = (bill: any, utilityTotal: number) => {
      const stored = Number(bill.penaltyAmount ?? 0);
      if (stored > 0) return stored;
      const derived = Math.max(
        0,
        Number(bill.totalAmount) - Number(bill.rentAmount) - utilityTotal,
      );
      return derived;
    };

    // Serialize the data for the client
    const agreements = agreementsWithBills.map((agreement) => {
      const bills = agreement.bills.map((bill) => {
        let utilityBreakdown: any[] = [];
        if (typeof bill.utilityBreakdown === "string") {
          try {
            const parsed = JSON.parse(bill.utilityBreakdown);
            if (Array.isArray(parsed)) utilityBreakdown = parsed;
          } catch {}
        } else if (Array.isArray(bill.utilityBreakdown)) {
          utilityBreakdown = bill.utilityBreakdown;
        }

        let currentStatus = bill.status;
        const today = new Date();
        const dueDate = bill.dueDate;

        if (bill.status === "Pending" && isAfterUtcDay(today, dueDate)) {
          currentStatus = "Overdue";
        }

        let penalty = Number(bill.penaltyAmount ?? 0);

        if (
          currentStatus === "Overdue" &&
          bill.status !== "Paid" &&
          agreement.space &&
          agreement.space.building
        ) {
          const daysOverdue = differenceInUtcDays(today, dueDate);
          if (daysOverdue > 0) {
            const calculatedPenalty = calculateIndividualPenalty(
              Number(bill.rentAmount),
              daysOverdue,
              agreement.space.building as any,
              agreement.space as any,
            );
            if (calculatedPenalty > penalty) {
              penalty = calculatedPenalty;
            }
          }
        }

        const rentAmt = Number(bill.rentAmount);
        const utilityTotal = utilityBreakdown.reduce(
          (sum, util) => sum + Number(util.amount || 0),
          0,
        );
        const billTotal = Number(bill.totalAmount);

        // Derive penalty from totalAmount if not explicitly stored
        if (penalty === 0 && billTotal > rentAmt + utilityTotal) {
          penalty = billTotal - rentAmt - utilityTotal;
        }

        const baseAmount = rentAmt + utilityTotal;
        const totalAmount = baseAmount + penalty;

        return {
          ...bill,
          status: currentStatus,
          rentAmount: rentAmt,
          totalAmount: parseFloat(totalAmount.toFixed(2)),
          penaltyAmount: parseFloat(penalty.toFixed(2)),
          utilityBreakdown,
        };
      });

      return {
        ...agreement,
        bills,
        monthlyRentalPrice: Number(agreement.monthlyRentalPrice),
        space: agreement.space
          ? {
              ...agreement.space,
              area: Number(agreement.space.area),
              monthlyRentalPrice: Number(agreement.space.monthlyRentalPrice),
              utilityProrationShare: Number(
                agreement.space.utilityProrationShare,
              ),
              building: agreement.space.building,
            }
          : null,
      };
    });

    return { success: true, agreements };
  } catch (error: any) {
    console.error("Error in getBillingInfoForPhoneNumberAction:", error);
    return { success: false, error: "Failed to retrieve billing information." };
  }
}

interface PaymentInitiationResult {
  success: boolean;
  message?: string;
  error?: string;
  paymentToken?: string;
}

export async function initiatePaymentAction(
  billIds: string[],
  amount: number,
  agreementId: string,
  nibToken: string,
): Promise<PaymentInitiationResult> {
  const NIB_PAYMENT_URL = process.env.NIB_PAYMENT_URL;
  const NIB_PAYMENT_KEY = process.env.NIB_PAYMENT_KEY;
  const COMPANY_NAME = process.env.NIB_COMPANY_NAME || "BUILDING";
  const CALLBACK_URL = `${process.env.NEXT_PUBLIC_BASE_URL}/api/portal/payment-callback`;

  if (!NIB_PAYMENT_URL || !NIB_PAYMENT_KEY) {
    console.error(
      "Server Configuration Error: NIB payment environment variables are not set.",
    );
    return {
      success: false,
      error: "Payment service is not configured. Please contact support.",
    };
  }

  if (!nibToken) {
    return {
      success: false,
      error:
        "Portal session token not found. Please re-enter from the Mini App.",
    };
  }

  try {
    const agreement = await databaseService.getAgreementById(agreementId, {
      space: { include: { building: true } },
    });
    if (!agreement || !agreement.space?.building?.accountNumber) {
      return {
        success: false,
        error: "Building account information is missing for this agreement.",
      };
    }
    const ACCOUNT_NO = agreement.space.building.accountNumber;

    const transactionId = crypto.randomUUID();
    const transactionTime = format(new Date(), "yyyyMMddHHmmss");

    const signatureString = [
      `accountNo=${ACCOUNT_NO}`,
      `amount=${amount}`,
      `callBackURL=${CALLBACK_URL}`,
      `companyName=${COMPANY_NAME}`,
      `Key=${NIB_PAYMENT_KEY}`,
      `token=${nibToken}`,
      `transactionId=${transactionId}`,
      `transactionTime=${transactionTime}`,
    ].join("&");

    const signature = crypto
      .createHash("sha256")
      .update(signatureString, "utf8")
      .digest("hex");

    const payload = {
      accountNo: ACCOUNT_NO,
      amount: String(amount),
      callBackURL: CALLBACK_URL,
      companyName: COMPANY_NAME,
      token: nibToken,
      transactionId: transactionId,
      transactionTime: transactionTime,
      signature: signature,
    };

    const response = await fetch(NIB_PAYMENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nibToken}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (!response.ok || !responseData.token) {
      console.error("NIB API Error:", responseData);
      return {
        success: false,
        error:
          responseData.message ||
          `Payment initiation failed with status ${response.status}.`,
      };
    }

    // On successful initiation, update the bills with a reference to this transaction group
    await prisma.bill.updateMany({
      where: { id: { in: billIds } },
      data: {
        tenantPaymentNotes: `Payment initiated with NIB Super App. Group Transaction Ref: ${transactionId}`,
      },
    });

    return {
      success: true,
      message: "Payment initiated successfully.",
      paymentToken: responseData.token,
    };
  } catch (error) {
    console.error("initiatePaymentAction uncaught error:", error);
    return {
      success: false,
      error: "An unexpected error occurred while initiating payment.",
    };
  }
}

export async function getBillStatusAction(billIds: string[]) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return { status: "Error", error: GENERIC_AUTH_ERROR };

    const bills = await databaseService.getAllBills({
      where: { id: { in: billIds } },
    });
    if (!bills.length) return { status: "Error", error: "Bills not found." };

    if (bills.every((b) => b.status === "Paid")) return { status: "Paid" };

    return { status: "Pending" };
  } catch (e: any) {
    return { status: "Error", error: e.message };
  }
}
