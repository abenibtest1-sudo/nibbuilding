import { NextResponse, type NextRequest } from "next/server";
import {
  getSessionCookieNames,
  ACCESS_TOKEN_COOKIE_NAME,
} from "@/lib/auth/jwt";
import { verifySession } from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";

export async function POST(request: NextRequest) {
  const response = NextResponse.json(
    { message: "Logout successful" },
    { status: 200 },
  );

  // Clear all session-related cookies
  const cookieNames = getSessionCookieNames();
  cookieNames.forEach((name) => {
    // Setting a cookie with an expiration date in the past effectively deletes it.
    response.cookies.set(name, "", { expires: new Date(0), path: "/" });
  });

  // Revoke the access token server-side so it cannot be reused.
  try {
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const payload = await verifySession(accessToken);
    if (payload && payload.jti) {
      await databaseService.revokeUserSessionByJti(payload.jti);
    }
  } catch (err) {
    // don't block logout on DB errors, but log for diagnostics
    console.warn("Warning: failed to revoke session on logout", err);
  }

  return response;
}
