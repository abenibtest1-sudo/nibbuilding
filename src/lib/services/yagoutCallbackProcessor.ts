import { prisma } from "@/lib/prisma";
import { differenceInUtcDays, toUtcStartOfDay } from "@/lib/utils";
import {
  safeDecrypt,
  verifyYagoutHash,
  parseTxnResponse,
  parsePgDetails,
} from "@/lib/services/yagoutpay";

function parseUtilityAmount(utilityBreakdown: unknown): number {
  if (typeof utilityBreakdown === "string") {
    try {
      const items = JSON.parse(utilityBreakdown);
      if (Array.isArray(items)) {
        return items.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
      }
    } catch {
      return 0;
    }
  }
  if (Array.isArray(utilityBreakdown)) {
    return utilityBreakdown.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
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
  if (daysOverdue <= 0 || !building.penaltyPolicyTiers || building.penaltyPolicyTiers.length === 0) {
    return 0;
  }

  const allTiers = building.penaltyPolicyTiers;
  const spaceSpecificTiers = allTiers.filter(
    (t) => t.scope === "SpecificSpaces" && t.applicableSpaceIdNames?.includes(space.spaceIdName || ""),
  );
  const floorSpecificTiers = allTiers.filter((t) => t.scope === "Floor" && t.applicableFloor === space.floor);
  const buildingWideTiers = allTiers.filter((t) => t.scope === "Building");

  let applicableTiers: typeof allTiers = [];
  if (spaceSpecificTiers.length > 0) applicableTiers = spaceSpecificTiers;
  else if (floorSpecificTiers.length > 0) applicableTiers = floorSpecificTiers;
  else applicableTiers = buildingWideTiers;

  if (applicableTiers.length === 0) return 0;

  const sortedTiers = [...applicableTiers].sort((a, b) => a.fromDay - b.fromDay);
  let totalPenalty = 0;
  const oneTimeFeesApplied = new Set<string>();

  for (let day = 1; day <= daysOverdue; day++) {
    const tierForDay = sortedTiers.find(
      (tier) => day >= tier.fromDay && (tier.toDay === null || tier.toDay === undefined || day <= tier.toDay),
    );
    if (!tierForDay) continue;

    const feeValue = Number(tierForDay.feeValue);
    let dailyFee = 0;
    if (tierForDay.penaltyType === "Fixed") dailyFee = feeValue;
    else if (tierForDay.penaltyType === "Percentage") dailyFee = billAmount * (feeValue / 100);

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

export interface YagoutCallbackResult {
  status: number;
  body: { message: string };
}

/**
 * Processes a decoded YagoutPay Aggregator-Hosted (Non-Seamless) callback.
 * Expects form fields: me_id (plain), txn_response, pg_details, other_details, hash — all
 * except me_id AES-256 encrypted per the integration doc.
 */
export async function processYagoutCallback(formData: FormData): Promise<YagoutCallbackResult> {
  const meId = formData.get("me_id")?.toString();
  const txnResponseEnc = formData.get("txn_response")?.toString();
  const pgDetailsEnc = formData.get("pg_details")?.toString();
  const hashEnc = formData.get("hash")?.toString();

  if (!meId || !txnResponseEnc) {
    console.error("YagoutPay callback: missing me_id or txn_response.", {
      hasMeId: !!meId,
      hasTxnResponse: !!txnResponseEnc,
    });
    return { status: 400, body: { message: "Missing required callback fields." } };
  }

  const decryptedTxn = safeDecrypt(txnResponseEnc);
  if (!decryptedTxn) {
    console.error("YagoutPay callback: failed to decrypt txn_response.");
    return { status: 400, body: { message: "Unable to decrypt callback payload." } };
  }

  const txn = parseTxnResponse(decryptedTxn);

  // --- Integrity check: recompute hash and compare against what Yagout sent ---
  if (hashEnc) {
    const hashValid = verifyYagoutHash(hashEnc, {
      merchantId: txn.meId,
      orderNo: txn.orderNo,
      amount: txn.amount,
      country: txn.country,
      currency: txn.currency,
    });
    if (!hashValid) {
      console.error("YagoutPay callback: hash verification failed.", { orderNo: txn.orderNo });
      return { status: 401, body: { message: "Callback signature verification failed." } };
    }
  } else {
    console.warn("YagoutPay callback: no hash present to verify — proceeding cautiously.", {
      orderNo: txn.orderNo,
    });
  }

  if (txn.meId !== meId) {
    console.error("YagoutPay callback: merchant ID mismatch.", { formMeId: meId, decryptedMeId: txn.meId });
    return { status: 401, body: { message: "Merchant ID mismatch." } };
  }

  // order_no was generated as `BILL-{billId}-{timestamp}` in initiatePaymentAction
  const orderParts = txn.orderNo.split("-");
  const billId = orderParts.length >= 2 ? orderParts[1] : null;

  if (!billId) {
    console.error("YagoutPay callback: could not extract bill id from order_no.", { orderNo: txn.orderNo });
    // Acknowledge so Yagout doesn't retry indefinitely on a malformed order_no we generated ourselves.
    return { status: 200, body: { message: "Callback acknowledged, unrecognized order format." } };
  }

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      agreement: {
        include: {
          tenant: true,
          space: { include: { building: { include: { penaltyPolicyTiers: true } } } },
        },
      },
    },
  });

  if (!bill || !bill.agreement?.space) {
    console.error("YagoutPay callback: no matching bill found.", { billId, orderNo: txn.orderNo });
    return { status: 200, body: { message: "Callback acknowledged, no matching bill found." } };
  }

  const isSuccess = txn.status?.toLowerCase() === "successful";

  if (!isSuccess) {
    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        tenantPaymentNotes: `YagoutPay attempt ${txn.status} — ${txn.resMessage} (ref: ${txn.pgRef || "n/a"})`,
      },
    });
    return { status: 200, body: { message: "Callback acknowledged, transaction not successful." } };
  }

  // Avoid double-processing if Yagout retries a callback for an already-paid bill.
  if (bill.status === "Paid" && bill.paymentReference === txn.pgRef) {
    return { status: 200, body: { message: "Callback acknowledged, already processed." } };
  }

  const pgDetails = pgDetailsEnc ? safeDecrypt(pgDetailsEnc) : null;
  const pgName = pgDetails ? parsePgDetails(pgDetails).pgName : "YagoutPay";

  const utilityAmount = parseUtilityAmount(bill.utilityBreakdown);
  let penaltyAmount = Number(bill.penaltyAmount ?? 0);
  const paymentDate = new Date();
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

  const totalAmount = parseFloat((Number(bill.rentAmount) + utilityAmount + penaltyAmount).toFixed(2));

  await prisma.bill.update({
    where: { id: bill.id },
    data: {
      status: "Paid",
      paymentDate,
      paymentReference: txn.pgRef || txn.agRef,
      paymentMethod: "YagoutPay",
      adminVerifiedPayment: true,
      adminVerificationNotes: `Payment confirmed via YagoutPay callback. Gateway: ${pgName}. Ag Ref: ${txn.agRef}. PG Ref: ${txn.pgRef}.`,
      penaltyAmount,
      totalAmount,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "payment",
      actorId: bill.agreement.tenant?.userId ?? null,
      actorName: bill.agreement.tenant?.name || "Unknown",
      tenantId: bill.tenantId,
      tenantName: bill.agreement.tenant?.name || "N/A",
      buildingId: bill.agreement.space.buildingId,
      buildingName: bill.agreement.space.buildingName,
      spaceName: bill.agreement.space.spaceIdName,
      paymentDate,
      rentAmount: bill.rentAmount,
      utilityAmount,
      penaltyAmount,
      totalAmount,
      transactionId: txn.pgRef || txn.agRef,
      toAccountNumber: bill.agreement.space.building.accountNumber,
    },
  });

  return { status: 200, body: { message: "Payment confirmed and bill updated." } };
}