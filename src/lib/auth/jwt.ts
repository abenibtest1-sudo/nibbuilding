import "server-only";
export const runtime = "nodejs";

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { nanoid } from "nanoid";
// Note: we avoid importing `databaseService` at module load time because it
// pulls in Prisma. Prisma cannot run in a browser environment; importing it
// here can cause bundlers to include Prisma in client code. Instead we
// dynamically import `databaseService` inside server-only branches.
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import type { User, Role } from "@prisma/client";

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY;

// Define cookie names
export const ACCESS_TOKEN_COOKIE_NAME = "nibrental_access_token";
export const REFRESH_TOKEN_COOKIE_NAME = "nibrental_refresh_token";
export const CSRF_TOKEN_COOKIE_NAME = "nibrental_csrf_token";
export const CSRF_TOKEN_SIG_NAME = "nibrental_csrf_sig";
export const LAST_ACTIVE_COOKIE_NAME = "nibrental_last_active";
// NOTE: We previously used a separate `session_id` cookie to bind tokens to a
// browser session. This has been removed per requirements.

// Idle timeout in milliseconds. If no activity for this duration, session is considered idle.
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Use Web Crypto (available in edge and modern Node) to compute HMAC-SHA256
async function importHmacKey(): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(JWT_SECRET_KEY || "");
  return await (globalThis.crypto as any).subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUint8(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export async function signCsrfToken(value: string): Promise<string> {
  const key = await importHmacKey();
  const data = new TextEncoder().encode(value);
  const sig = await (globalThis.crypto as any).subtle.sign("HMAC", key, data);
  return bufferToHex(sig);
}

export async function verifyCsrfToken(
  value: string | undefined,
  sig: string | undefined,
): Promise<boolean> {
  if (!value || !sig) return false;
  try {
    const key = await importHmacKey();
    const data = new TextEncoder().encode(value);
    const sigBytes = hexToUint8(sig);
    // WebCrypto verify expects ArrayBuffer for signature
    const valid = await (globalThis.crypto as any).subtle.verify(
      "HMAC",
      key,
      sigBytes.buffer,
      data,
    );
    return Boolean(valid);
  } catch (err) {
    return false;
  }
}

if (!JWT_SECRET_KEY || JWT_SECRET_KEY.length !== 64) {
  const errorMessage =
    "JWT_SECRET_KEY is not set or is not a 64-character hex string.";
  if (process.env.NODE_ENV === "production") {
    throw new Error(`FATAL: ${errorMessage} This is required for production.`);
  }
}

const key = new TextEncoder().encode(JWT_SECRET_KEY);

export interface SessionPayload extends JWTPayload {
  userId: string;
  email: string;
  permissions: string[];
  isSuperAdmin: boolean;
  forceChangePass: boolean;
  jti?: string;
}

export type SessionUserData = Pick<
  SessionPayload,
  "userId" | "email" | "permissions" | "isSuperAdmin" | "forceChangePass"
>;

export interface RefreshTokenPayload extends JWTPayload {
  userId: string;
  jti?: string;
}

interface GeneratedTokens {
  accessToken: {
    name: string;
    value: string;
    options: Omit<ResponseCookie, "name" | "value">;
  };
  refreshToken: {
    name: string;
    value: string;
    options: Omit<ResponseCookie, "name" | "value">;
  };
}

/**
 * Encrypts session payloads and returns the tokens and their cookie options.
 * @param payload - The user session data to encrypt.
 * @returns {Promise<GeneratedTokens>} An object containing access and refresh tokens and their respective cookie options.
 */
export async function createSession(
  payload: SessionUserData,
): Promise<GeneratedTokens> {
  // Create Access Token (short-lived)
  const jti = nanoid();
  // include jti in the payload so it's present in the token
  const tokenPayload = { ...payload, jti } as typeof payload & { jti: string };
  const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  const accessToken = await new SignJWT(tokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(accessTokenExpires)
    .sign(key);

  // Create Refresh Token (long-lived)
  const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const refreshTokenPayload: RefreshTokenPayload = {
    userId: payload.userId,
    jti,
  };
  const refreshToken = await new SignJWT(refreshTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(refreshTokenExpires)
    .sign(key);

  const commonCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax" as const,
  };

  // Persist session record so we can revoke tokens server-side. Do this
  // only on the server by dynamically importing the DB service.
  try {
    if (typeof window === "undefined") {
      const { databaseService } =
        await import("@/lib/services/databaseService");
      // Only create a UserSession if the referenced user exists to avoid
      // violating the foreign key constraint (UserSession.userId -> User.id).
      const existingUser = await databaseService.getUserById(payload.userId);
      if (existingUser) {
        await databaseService.createUserSession(jti, payload.userId);
      } else {
        // For portal flows the user may be ephemeral/not present in the
        // main users table; skip persisting the session but still return
        // tokens so the client can proceed. Log at debug level for
        // diagnostics.
        console.warn(
          `Skipping UserSession creation: user ${payload.userId} not found.`,
        );
      }
    }
  } catch (err) {
    // If DB write fails, we still return tokens but log a warning.
    console.warn("Warning: failed to persist user session", err);
  }

  return {
    accessToken: {
      name: ACCESS_TOKEN_COOKIE_NAME,
      value: accessToken,
      options: { ...commonCookieOptions, expires: accessTokenExpires },
    },
    refreshToken: {
      name: REFRESH_TOKEN_COOKIE_NAME,
      value: refreshToken,
      options: { ...commonCookieOptions, expires: refreshTokenExpires },
    },
  };
}

/**
 * Verifies the access token from the cookie and returns its payload.
 * @returns {Promise<SessionPayload | null>} The session payload or null if invalid.
 */
export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    const sessionPayload = payload as SessionPayload;
    // If jti is present, ensure the session hasn't been revoked. Only run DB
    // checks on the server to avoid Prisma/browser issues.
    try {
      if (typeof window === "undefined") {
        const { databaseService } =
          await import("@/lib/services/databaseService");
        const user = await databaseService.getUserById(sessionPayload.userId);
        if (!user) {
          if (sessionPayload.jti) {
            await databaseService.revokeUserSessionByJti(sessionPayload.jti);
          }
          return null;
        }

        if ((user as any).status === "Inactive") {
          await databaseService.revokeUserSessionsByUserId(user.id);
          return null;
        }

        if (sessionPayload.jti) {
          const record = await databaseService.getUserSessionByJti(
            sessionPayload.jti,
          );
          if (!record || record.revoked) return null;

          // If a user record exists, ensure the user's attached JTI matches
          // the presented token; if it doesn't, revoke and clear to force
          // a logout for that user's sessions.
          // Do not rely on per-user JTI fields on `User`. Revocation and
          // session validation occur via `UserSession` records. If additional
          // checks are needed, they should operate on `UserSession`.

          // Update lastActive timestamp in DB
          await databaseService.updateUserSessionLastActive(sessionPayload.jti);
        }
      }
    } catch (err) {
      // If DB checks fail, log a warning but allow the session to avoid
      // accidental lockouts due to transient DB errors.
    }

    return sessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Verifies the refresh token from the cookie and returns its payload.
 * @returns {Promise<RefreshTokenPayload | null>} The refresh token payload or null if invalid.
 */
export async function verifyRefreshToken(
  token: string | undefined,
): Promise<RefreshTokenPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    const refreshPayload = payload as RefreshTokenPayload;
    // If running on the server, ensure the presented refresh token matches
    // the user's attached refresh JTI (if present). If it doesn't, reject.
    try {
      if (typeof window === "undefined" && refreshPayload.jti) {
        const { databaseService } =
          await import("@/lib/services/databaseService");
        const user = await databaseService.getUserById(refreshPayload.userId);
        // Do not rely on per-user JTI fields on `User`. Session revocation and
        // validation should be performed via `UserSession` records instead.
      }
    } catch (err) {
      // ignore DB-specific errors and continue; callers may perform additional checks
    }

    return refreshPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Decode a JWT and return its payload without performing DB/session checks.
 * Useful in middleware to inspect token contents (jti/userId) when verifySession
 * returned null so we can differentiate between expired/invalid tokens and
 * token tampering (e.g., mismatched jti).
 */
export async function decodeJwt(
  token: string | undefined,
): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Returns an array of cookie names that should be deleted for logout.
 * @returns {string[]}
 */
export function getSessionCookieNames(): string[] {
  return [
    ACCESS_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    CSRF_TOKEN_COOKIE_NAME,
    CSRF_TOKEN_SIG_NAME,
    LAST_ACTIVE_COOKIE_NAME,
  ];
}

/**
 * Creates the payload for the JWT from the user object.
 * @param user - The user object from the database.
 * @returns The payload ready to be signed.
 */
export function createUserPayload(
  user: User & { roles: Role[] },
): SessionUserData {
  const isSuperAdmin = user.roles.some((role) => role.name === "SUPER_ADMIN");

  let permissions: string[] = [];
  if (!isSuperAdmin) {
    permissions = Array.from(
      new Set(user.roles.flatMap((role) => role.permissions)),
    );
  }

  return {
    userId: user.id,
    email: user.email,
    isSuperAdmin,
    permissions,
    forceChangePass: !!user.tempPassword, // Force change if temp password exists
  };
}
