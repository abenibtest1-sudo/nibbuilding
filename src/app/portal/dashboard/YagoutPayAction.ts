"use server";

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
    if (!currentUser) return { success: false, error: "Your session has expired. Please log in again." };

    // Pull the bill together with everything needed for the request
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      include: {
        agreement: {
          include: {
            tenant: true,
            space: { include: { building: true } },
          },
        },
      },
    });

    if (!bill || bill.agreement?.tenant?.userId !== currentUser.id) {
      return { success: false, error: "Bill not found or access denied." };
    }

    if (bill.status !== "Pending" && bill.status !== "Overdue") {
      return { success: false, error: `This bill is already "${bill.status}" and cannot be paid again.` };
    }

    const tenant = bill.agreement.tenant;
    const meId = process.env.YAGOUTPAY_MERCHANT_ID!;
    const agId = process.env.YAGOUTPAY_AGGREGATOR_ID ?? "yagout";
    const postUrl = process.env.YAGOUTPAY_POST_URL!;
    const successUrl = process.env.YAGOUTPAY_SUCCESS_URL!;
    const failureUrl = process.env.YAGOUTPAY_FAILURE_URL!;

    // Unique per attempt so Yagout doesn't reject a duplicate order_no
    const orderNo = `BILL-${bill.id}-${Date.now()}`.slice(0, 70);
    const amount = Number(bill.totalAmount).toFixed(2);

    const plaintext = buildMerchantRequestPlaintext({
      txn: {
        agId,
        meId,
        orderNo,
        amount,
        country: "ETH",
        currency: "ETB",
        txnType: "SALE",
        successUrl,
        failureUrl,
        channel: "WEB",
      },
      cust: {
        custName: tenant.name,
        emailId: tenant.email ?? "",
        mobileNo: (tenant.phone ?? "").replace(/\D/g, ""),
        isLoggedIn: "Y",
      },
      bill: {
        // fill in from tenant/building address fields if you store them
      },
    });

    const merchantRequest = yagoutEncrypt(plaintext);
    const hash = yagoutHash({ merchantId: meId, orderNo, amount, country: "ETH", currency: "ETB" });

    // Track the pending attempt so the callback can reconcile it
    await databaseService.updateBill(bill.id, {
      tenantPaymentNotes: `YagoutPay order_no=${orderNo}`,
    });


    

    return { success: true, postUrl, meId, merchantRequest, hash };
  } catch (error: any) {
    console.error("Error initiating YagoutPay payment:", error);
    return { success: false, error: "Failed to initiate payment. Please try again." };
  }
}