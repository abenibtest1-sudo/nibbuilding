import { NextResponse, type NextRequest } from "next/server";
import { databaseService } from "@/lib/services/databaseService";
import bcrypt from "bcryptjs";
import {
  createSession,
  createUserPayload,
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_SIG_NAME,
  verifyCsrfToken,
  LAST_ACTIVE_COOKIE_NAME,
} from "@/lib/auth/jwt";
import { rateLimiter } from "@/lib/auth/rate-limiter";
import type { User, Role } from "@prisma/client";

async function checkRateLimit(identifier: string) {
  const { success, limit, remaining, reset } = await rateLimiter(identifier);
  return { success, limit, remaining, reset };
}

export async function POST(request: NextRequest) {
  // CSRF protection is now implicitly handled by the browser's SameSite cookie policy.
  // No need to check for a custom header.

  try {
    const body = await request.json();
    const { phone, password } = body;

    if (!phone || !password) {
      return NextResponse.json(
        { message: "Phone number and password are required." },
        { status: 400 },
      );
    }

    const ip =
      request.ip ?? request.headers.get("x-forwarded-for") ?? "127.0.0.1";

    // Rate limit by both IP and phone number
    const [ipLimit, phoneLimit] = await Promise.all([
      checkRateLimit(ip),
      checkRateLimit(phone),
    ]);

    if (!ipLimit.success || !phoneLimit.success) {
      const retryAfter = Math.ceil(
        (Math.max(ipLimit.reset, phoneLimit.reset) - Date.now()) / 1000,
      );
      return NextResponse.json(
        { message: `Too many requests. Try again in ${retryAfter} seconds.` },
        { status: 429 },
      );
    }

    const remainingAttempts = Math.min(ipLimit.remaining, phoneLimit.remaining);

    const user = await databaseService.findUserByPhoneNumber(phone, {
      roles: true,
      managedBuildings: true,
    });

    if (!user) {
      return NextResponse.json(
        {
          message: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
        },
        { status: 401 },
      );
    }

    let isValidPassword = false;
    let forceChangePass = false;

    if (user.tempPassword) {
      // Check against temporary password first
      isValidPassword = password === user.tempPassword;
      if (isValidPassword) {
        forceChangePass = true;
      }
    }

    if (!isValidPassword && user.password) {
      // If temp password didn't match (or didn't exist), check main password
      isValidPassword = await bcrypt.compare(password, user.password);
    }

    if (!isValidPassword) {
      return NextResponse.json(
        {
          message: `Invalid credentials. ${remainingAttempts} attempts remaining.`,
        },
        { status: 401 },
      );
    }

    if ((user as any).status === "Inactive") {
      return NextResponse.json(
        {
          message:
            "Login failed. Your account is inactive. Please contact an administrator.",
        },
        { status: 403 },
      );
    }

    // --- Building Status Check ---
    const isSuperAdmin = user.roles.some((role) => role.name === "SUPER_ADMIN");
    const isTenant = user.roles.some((role) => role.name === "TENANT");
    const managedBuildings = (user as any).showAllBuildings
      ? await databaseService.getAllBuildings()
      : (user.managedBuildings ?? []);

    if (!isSuperAdmin && !isTenant && managedBuildings.length > 0) {
      const allManagedBuildingsAreInactive = managedBuildings.every(
        (b) => b.status === "Inactive",
      );
      if (allManagedBuildingsAreInactive) {
        return NextResponse.json(
          {
            message:
              "Login failed. All buildings you manage are currently inactive.",
          },
          { status: 403 },
        );
      }
    }
    // --- End Building Status Check ---

    // On successful login, create the session (both access and refresh tokens)
    // Before authenticating, ensure the CSRF token present and valid. This defends
    // against cases where an attacker or a user tampers with both cookies client-side.
    const incomingCsrf = request.cookies.get(CSRF_TOKEN_COOKIE_NAME)?.value;
    const incomingSig = request.cookies.get(CSRF_TOKEN_SIG_NAME)?.value;
    const csrfValid = await verifyCsrfToken(incomingCsrf, incomingSig);
    if (!csrfValid) {
      return NextResponse.json(
        {
          message:
            "Your session has expired. Please refresh the page and try again.",
        },
        { status: 403 },
      );
    }

    const payload = createUserPayload(user as User & { roles: Role[] });
    payload.forceChangePass = forceChangePass; // Ensure flag is set correctly
    const { accessToken, refreshToken } = await createSession(payload);

    const response = NextResponse.json(
      { message: "Login successful" },
      { status: 200 },
    );

    // Set cookies on the response
    response.cookies.set(
      accessToken.name,
      accessToken.value,
      accessToken.options,
    );
    response.cookies.set(
      refreshToken.name,
      refreshToken.value,
      refreshToken.options,
    );

    // Initialize last-active timestamp so idle timeout starts now.
    response.cookies.set(LAST_ACTIVE_COOKIE_NAME, String(Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
      expires: accessToken.options.expires,
    });

    return response;
  } catch (error) {
    console.error("Login API Error:", error);
    return NextResponse.json(
      { message: "An internal server error occurred." },
      { status: 500 },
    );
  }
}
