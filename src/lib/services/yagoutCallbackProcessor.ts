import { prisma } from "@/lib/prisma";
import { differenceInUtcDays, toUtcStartOfDay } from "@/lib/utils";
import {
  safeDecrypt,
  verifyYagoutHash,
  parseTxnResponse,
  parsePgDetails,
} from "@/lib/services/yagoutPayService";

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
/**
 * Processes a decoded YagoutPay Aggregator-Hosted (Non-Seamless) callback.
 * Expects form fields: me_id, txn_response, pg_details, other_details, hash.
 */
export async function processYagoutCallback(formData: FormData): Promise<YagoutCallbackResult> {
  const txnResponseEnc = formData.get("txn_response")?.toString();
  const pgDetailsEnc = formData.get("pg_details")?.toString();
  const otherDetailsEnc = formData.get("other_details")?.toString();
  const hashEnc = formData.get("hash")?.toString();

  // 1. Basic Validation
  if (!txnResponseEnc) {
    console.error("YagoutPay callback:  txn_response.");
    return { status: 400, body: { message: "Missing required callback fields." } };
  }

  // 2. Decrypt Transaction Response
  const decryptedTxn = safeDecrypt(txnResponseEnc);
  if (!decryptedTxn) {
    console.error("YagoutPay callback: failed to decrypt txn_response.");
    return { status: 400, body: { message: "Unable to decrypt callback payload." } };
  }
  const txn = parseTxnResponse(decryptedTxn);



  // 3. Extract Bill ID from udf_1 (within other_details)
  let billId: string | null = null;
  if (otherDetailsEnc) {
    const decryptedOther = safeDecrypt(otherDetailsEnc);
    if (decryptedOther) {
      // udf_1 is the first index in the pipe-separated other_details section
      billId = decryptedOther.split("|")[0];
    }
  }
  console.log("################ YAGOUT CALLBACK billid #################");
  console.log(JSON.stringify(billId, null, 2));
  console.log("#######################################################");


  if (!billId) {
    console.error("YagoutPay callback: could not extract bill id from udf_1.", { orderNo: txn.orderNo });
    return { status: 200, body: { message: "Callback acknowledged, no bill reference found." } };
  }

  // 4. Integrity Check: Verify Hash
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
  }

  // 5. Merchant ID Check
  // if (txn.meId !== meId) {
  //   console.error("YagoutPay callback: merchant ID mismatch.", { formMeId: meId, decryptedMeId: txn.meId });
  //   return { status: 401, body: { message: "Merchant ID mismatch." } };
  // }

  // 6. Fetch Bill from Database
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

  // 7. Handle Transaction Status
  const isSuccess = txn.status?.toLowerCase() === "successful";

  if (!isSuccess) {
    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        tenantPaymentNotes: `YagoutPay attempt failed: ${txn.resMessage} (ref: ${txn.pgRef || "n/a"})`,
      },
    });
    return { status: 200, body: { message: "Callback acknowledged, transaction not successful." } };
  }

  // 8. Avoid Double Processing (Idempotency)
  if (bill.status === "Paid" && bill.paymentReference === (txn.pgRef || txn.agRef)) {
    return { status: 200, body: { message: "Callback acknowledged, already processed." } };
  }

  // 9. Process Successful Payment
  const pgDetails = pgDetailsEnc ? safeDecrypt(pgDetailsEnc) : null;
  const pgName = pgDetails ? parsePgDetails(pgDetails).pgName : "YagoutPay";

  const utilityAmount = parseUtilityAmount(bill.utilityBreakdown);
  let penaltyAmount = Number(bill.penaltyAmount ?? 0);
  const paymentDate = new Date();

  // Recalculate Penalty based on current payment date
  const billDueDateUtc = toUtcStartOfDay(bill.dueDate);
  const paymentDateUtc = toUtcStartOfDay(paymentDate);
  const daysOverdue = differenceInUtcDays(paymentDateUtc, billDueDateUtc);

  if (bill.agreement.space.building?.penaltyPolicyTiers?.length > 0 && daysOverdue > 0) {
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

  // 10. Update Bill and Create Audit Log
  await prisma.$transaction([
    prisma.bill.update({
      where: { id: bill.id },
      data: {
        status: "Paid",
        paymentDate,
        paymentReference: txn.pgRef || txn.agRef,
        paymentMethod: "YagoutPay",
        adminVerifiedPayment: true,
        adminVerificationNotes: `Paid via YagoutPay. Ref: ${txn.pgRef || txn.agRef}. Gateway: ${pgName}.`,
        penaltyAmount,
        totalAmount,
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "payment",
        actorId: bill.agreement.tenant?.userId ?? null,
        actorName: bill.agreement.tenant?.name || "System",
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
    }),

    prisma.yagoutPayment.update({
      where: { orderNo: txn.orderNo },
      data: {
        status: txn.status.toUpperCase(), // SUCCESSFUL or FAILED
        agRef: txn.agRef,
        pgRef: txn.pgRef,
        resCode: txn.resCode,
        resMessage: txn.resMessage,
        rawResponse: txn // Save the whole object for the audit trail
      }
    })

  ]);





  console.log(`Db save: ${bill.id},${txn.status.toUpperCase()},${txn.agRef},${txn.pgRef}`);
  console.log(await prisma.yagoutPayment.findMany())
  return { status: 200, body: { message: "Payment confirmed and bill updated." } };
}