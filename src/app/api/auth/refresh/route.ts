import { NextResponse, type NextRequest } from "next/server";
import {
  verifyRefreshToken,
  createSession,
  createUserPayload,
  REFRESH_TOKEN_COOKIE_NAME,
  LAST_ACTIVE_COOKIE_NAME,
} from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";
import { GENERIC_AUTH_ERROR } from "@/lib/security/messages";

export async function POST(request: NextRequest) {
  const refreshTokenFromCookie = request.cookies.get(
    REFRESH_TOKEN_COOKIE_NAME,
  )?.value;
  const refreshTokenPayload = await verifyRefreshToken(refreshTokenFromCookie);

  if (!refreshTokenPayload) {
    return NextResponse.json(
      { message: "Unauthorized. Invalid refresh token." },
      { status: 401 },
    );
  }

  // Ensure the session referenced by the refresh token is still active (not revoked).
  try {
    if (refreshTokenPayload.jti) {
      const sessionRecord = await databaseService.getUserSessionByJti(
        refreshTokenPayload.jti,
      );
      if (!sessionRecord || sessionRecord.revoked) {
        return NextResponse.json(
          { message: "Unauthorized. Session revoked." },
          { status: 401 },
        );
      }
    }
  } catch (err) {
    console.warn(
      "Warning: failed to validate refresh token jti against DB",
      err,
    );
  }

  // Token is valid, get fresh user data to create a new session
  const user = await databaseService.getUserById(refreshTokenPayload.userId, {
    roles: true,
  });

  if (!user) {
    return NextResponse.json({ message: GENERIC_AUTH_ERROR }, { status: 404 });
  }

  if ((user as any).status === "Inactive") {
    await databaseService.revokeUserSessionsByUserId(user.id);
    return NextResponse.json(
      {
        message:
          "Unauthorized. Your account is inactive. Please contact an administrator.",
      },
      { status: 403 },
    );
  }

  // Create a new session (which includes a new access token and a new refresh token)
  const newSessionPayload = createUserPayload(user);
  const { accessToken, refreshToken } = await createSession(newSessionPayload);

  // Revoke the old session referenced by the incoming refresh token (rotation)
  try {
    if (refreshTokenPayload.jti) {
      await databaseService.revokeUserSessionByJti(refreshTokenPayload.jti);
    }
  } catch (err) {
    console.warn("Warning: failed to revoke old session during refresh", err);
  }

  const response = NextResponse.json(
    { message: "Session refreshed successfully." },
    { status: 200 },
  );

  // Set the new cookies
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

  // Update last-active timestamp when refreshing session
  response.cookies.set(LAST_ACTIVE_COOKIE_NAME, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    expires: accessToken.options.expires,
  });

  return response;
}
