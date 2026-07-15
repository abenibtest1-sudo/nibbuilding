import { NextRequest, NextResponse } from "next/server";
import { processYagoutCallback } from "@/lib/services/yagoutCallbackProcessor";

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    console.error("YagoutPay callback: failed to parse form body.", e);
    return NextResponse.json({ message: "Invalid request format." }, { status: 400 });
  }

  const result = await processYagoutCallback(formData);

  const outcome = result.status === 200 && /confirmed/i.test(result.body.message) ? "success" : "pending";
  return NextResponse.redirect(new URL(`/portal/dashboard?payment=${outcome}`, request.url), { status: 303 });
}