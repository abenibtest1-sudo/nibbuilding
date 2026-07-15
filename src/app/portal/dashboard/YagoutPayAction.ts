"use server";

import { randomBytes } from "crypto";
import { yagoutEncrypt, yagoutHash, buildMerchantRequestPlaintext } from "@/lib/services/yagoutPayService";
import { prisma } from "@/lib/prisma";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";
import { cookies } from "next/headers";

async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session?.userId) return null;
  return databaseService.getUserById(session.userId);
}

export interface InitiatePaymentResult {
  success: boolean;
  error?: string;
  postUrl?: string;
  meId?: string;
  merchantRequest?: string;
  hash?: string;
}

export async function initiatePaymentAction(billId: string): Promise<InitiatePaymentResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return { success: false, error: "Your session has expired." };

    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { agreement: { include: { tenant: true } } },
    });

    if (!bill || bill.agreement?.tenant?.userId !== currentUser.id) {
      return { success: false, error: "Bill not found or access denied." };
    }

    const meId = process.env.YAGOUTPAY_MERCHANT_ID!;
    
    // --- UPDATED ORDER NO GENERATION ---
    const orderNo = "ORDER_" + randomBytes(4).toString("hex");
    const amount = Number(bill.totalAmount).toFixed(2);

    await prisma.yagoutPayment.create({
  data: {
    orderNo: orderNo,
    meId: meId,
    billId: bill.id,
    amount: amount,
    status: "PENDING"
  }
});

    const plaintext = buildMerchantRequestPlaintext({
      txn: {
        agId: process.env.YAGOUTPAY_AGGREGATOR_ID ?? "yagout",
        meId,
        orderNo,
        amount,
        country: "ETH",
        currency: "ETB",
        txnType: "SALE",
        successUrl: process.env.YAGOUTPAY_SUCCESS_URL!,
        failureUrl: process.env.YAGOUTPAY_FAILURE_URL!,
        channel: "WEB",
      },
      cust: {
        custName: bill.agreement.tenant.name,
        emailId: bill.agreement.tenant.email ?? "",
        mobileNo: (bill.agreement.tenant.phone ?? "").replace(/\D/g, ""),
        isLoggedIn: "Y",
      },
      udf1: bill.id, // --- ATTACH BILL ID HERE ---
    });

    const merchantRequest = yagoutEncrypt(plaintext);
    const hash = yagoutHash({ merchantId: meId, orderNo, amount, country: "ETH", currency: "ETB" });

    await databaseService.updateBill(bill.id, {
      tenantPaymentNotes: `YagoutPay order_no=${orderNo}`,
    });

    return { success: true, postUrl: process.env.YAGOUTPAY_POST_URL!, meId, merchantRequest, hash };
  } catch (error: any) {
    console.error("Error initiating YagoutPay payment:", error);
    return { success: false, error: "Failed to initiate payment." };
  }
}