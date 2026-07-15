import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_SIG_NAME,
  verifyCsrfToken,
} from "@/lib/auth/jwt";
import { LAST_ACTIVE_COOKIE_NAME } from "@/lib/auth/jwt";

export async function GET(request: NextRequest) {
  try {
    const cookie = request.cookies.get(CSRF_TOKEN_COOKIE_NAME)?.value;
    const sig = request.cookies.get(CSRF_TOKEN_SIG_NAME)?.value;
    const valid = await verifyCsrfToken(cookie, sig);
    const res = NextResponse.json({ csrfPresent: Boolean(valid) });
    if (valid) {
      // update last-active so the idle timeout extends when the client is active
      res.cookies.set(LAST_ACTIVE_COOKIE_NAME, String(Date.now()), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        sameSite: "lax",
      });
    }
    return res;
  } catch (err) {
    return NextResponse.json({ csrfPresent: false });
  }
}
