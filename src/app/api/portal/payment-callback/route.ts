import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { differenceInUtcDays, toUtcStartOfDay } from "@/lib/utils";

const NIB_VALIDATE_TOKEN_URL = process.env.NIB_VALIDATE_TOKEN_URL;

// Helper to validate the Authorization token from NIB
async function validateNibToken(authHeader: string | null): Promise<boolean> {
  if (!NIB_VALIDATE_TOKEN_URL) {
    console.error("Callback Error: Token validation URL is not configured.");
    return false;
  }
  if (!authHeader) {
    console.error(
      "Callback Error: Authorization header missing from NIB callback.",
    );
    return false;
  }

  try {
    const externalResponse = await fetch(NIB_VALIDATE_TOKEN_URL, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
      cache: "no-store",
    });
    return externalResponse.ok;
  } catch (error) {
    console.error(
      "Callback Error: Network error during NIB token validation:",
      error,
    );
    return false;
  }
}

export async function POST(request: NextRequest) {
  // --- Step 1: Token Validation ---
  const authHeader = request.headers.get("Authorization");

  // Extract the token from the string like: Bearer {token: YOUR_TOKEN}
  const tokenMatch = authHeader?.match(/token:\s*(.+)\s*}/);
  const rawToken = tokenMatch?.[1];

  // Reconstruct the standard Bearer token format
  const fixedAuthHeader = rawToken ? `Bearer ${rawToken}` : null;

  if (!fixedAuthHeader) {
    console.error("Invalid Authorization header format on callback.");
    return NextResponse.json(
      { message: "Invalid auth header." },
      { status: 401 },
    );
  }

  const isTokenValid = await validateNibToken(fixedAuthHeader);
  if (!isTokenValid) {
    return NextResponse.json(
      { message: "Invalid or missing authorization token." },
      { status: 401 },
    );
  }

  let requestBody;
  try {
    requestBody = await request.json();
  } catch (e) {
    console.error("Callback Error: Invalid JSON in request body.", e);
    return NextResponse.json(
      { message: "Invalid request format." },
      { status: 400 },
    );
  }

  const { paidByNumber, txnRef, transactionId } = requestBody;

  if (!transactionId) {
    console.error(
      "Callback Error: Missing required fields (transactionId) in callback data.",
      requestBody,
    );
    return NextResponse.json(
      { message: "Missing required fields." },
      { status: 400 },
    );
  }

  function parseUtilityAmount(utilityBreakdown: unknown): number {
    if (typeof utilityBreakdown === "string") {
      try {
        const items = JSON.parse(utilityBreakdown);
        if (Array.isArray(items)) {
          return items.reduce(
            (sum, item) => sum + (Number(item?.amount) || 0),
            0,
          );
        }
      } catch {
        return 0;
      }
    }

    if (Array.isArray(utilityBreakdown)) {
      return utilityBreakdown.reduce(
        (sum, item) => sum + (Number(item?.amount) || 0),
        0,
      );
    }

    return 0;
  }

  function calculateIndividualPenalty(
    billAmount: number,
    daysOverdue: number,
    building: {
      penaltyPolicyTiers?: Array<{
        id: string;
        fromDay: number;
        toDay: number | null;
        penaltyType: string;
        feeValue: number | string;
        frequency: string;
        scope: string;
        applicableSpaceIdNames?: string[] | null;
        applicableFloor?: string | null;
      }>;
    },
    space: { spaceIdName?: string | null; floor?: string | null },
  ) {
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
        t.applicableSpaceIdNames?.includes(space.spaceIdName || ""),
    );
    const floorSpecificTiers = allTiers.filter(
      (t) => t.scope === "Floor" && t.applicableFloor === space.floor,
    );
    const buildingWideTiers = allTiers.filter((t) => t.scope === "Building");

    let applicableTiers = [] as typeof allTiers;
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
          (tier.toDay === null ||
            tier.toDay === undefined ||
            day <= tier.toDay),
      );

      if (!tierForDay) continue;
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

    return parseFloat(totalPenalty.toFixed(2));
  }

  // --- Step 2 & 3: Find Bills and Compare Signatures ---
  try {
    const bills = await prisma.bill.findMany({
      where: {
        tenantPaymentNotes: {
          contains: `Group Transaction Ref: ${txnRef}`,
        },
      },
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
    });

    if (bills.length === 0) {
      // Acknowledge to NIB that we received it, even if we can't find the bill, to prevent retries.
      return NextResponse.json(
        { message: "Callback acknowledged, no matching bills found." },
        { status: 200 },
      );
    }

    const payingUser = await prisma.user.findFirst({
      where: {
        phoneNumber: paidByNumber, // adjust if you use accountNumber instead
      },
    });

    // --- Step 4: Update Database ---
    const paymentDate = new Date();

    for (const bill of bills) {
      if (!bill.agreement?.space) continue;

      const utilityAmount = parseUtilityAmount(bill.utilityBreakdown);
      let penaltyAmount = Number(bill.penaltyAmount ?? 0);
      const billDueDateUtc = toUtcStartOfDay(bill.dueDate);
      const paymentDateUtc = toUtcStartOfDay(paymentDate);
      const daysOverdue = differenceInUtcDays(paymentDateUtc, billDueDateUtc);

      if (
        bill.agreement.space.building?.penaltyPolicyTiers &&
        bill.agreement.space.building.penaltyPolicyTiers.length > 0 &&
        daysOverdue > 0
      ) {
        const calculatedPenalty = calculateIndividualPenalty(
          Number(bill.rentAmount),
          daysOverdue,
          bill.agreement.space.building,
          bill.agreement.space,
        );

        if (calculatedPenalty > penaltyAmount) {
          penaltyAmount = calculatedPenalty;
        }
      }

      const totalAmount = parseFloat(
        (Number(bill.rentAmount) + utilityAmount + penaltyAmount).toFixed(2),
      );

      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          status: "Paid",
          paymentDate: paymentDate,
          paymentReference: transactionId,
          paymentMethod: "NIB_SuperApp",
          adminVerifiedPayment: true,
          adminVerificationNotes: `Payment confirmed via NIB callback. Paid by: ${paidByNumber}. NIB Transaction ID: ${transactionId}.`,
          penaltyAmount,
          totalAmount,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "payment",
          actorId: payingUser?.id ?? null,
          actorName: payingUser?.name ?? paidByNumber ?? "Unknown",
          tenantId: bill.tenantId,
          tenantName: bill.agreement.tenant?.name || "N/A",
          buildingId: bill.agreement.space.buildingId,
          buildingName: bill.agreement.space.buildingName,
          spaceName: bill.agreement.space.spaceIdName,
          paymentDate: paymentDate,
          rentAmount: bill.rentAmount,
          utilityAmount,
          penaltyAmount,
          totalAmount,
          transactionId: transactionId,
          toAccountNumber: bill.agreement.space.building.accountNumber,
        },
      });
    }

    // --- Step 6: Respond with 200 OK ---
    return NextResponse.json(
      { message: "Payment confirmed and all associated bills updated." },
      { status: 200 },
    );
  } catch (dbError: any) {
    console.error(
      "Callback DB Error: Failed to process bills after successful validation.",
      dbError,
    );

    return NextResponse.json(
      {
        message:
          "Callback acknowledged, but an internal processing error occurred.",
      },
      { status: 200 },
    );
  }
}
