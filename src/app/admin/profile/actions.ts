"use server";

import { databaseService } from "@/lib/services/databaseService";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  verifySession,
  getSessionCookieNames,
  ACCESS_TOKEN_COOKIE_NAME,
} from "@/lib/auth/jwt";
import { cookies } from "next/headers";
import { GENERIC_AUTH_ERROR } from "@/lib/security/messages";
import { isPwnedPassword } from "@/lib/security/pwned";

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});

export async function changePassword(
  values: z.infer<typeof changePasswordSchema>,
): Promise<{ success: boolean; error?: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const sessionUser = await verifySession(token);
  if (!sessionUser) {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  const validatedData = changePasswordSchema.safeParse(values);
  if (!validatedData.success) {
    throw new Error("Invalid data provided.");
  }
  const { currentPassword, newPassword } = validatedData.data;

  const user = await databaseService.getUserById(sessionUser.userId);
  if (!user) {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  // If user has a temp password, currentPassword validation is skipped.
  // But if they have a main password, we must validate it.
  if (user.password) {
    const passwordsMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordsMatch) {
      throw new Error(GENERIC_AUTH_ERROR);
    }
  }

  // Check against HaveIBeenPwned (k-anonymity). If pwned, reject.
  try {
    const { pwned } = await isPwnedPassword(newPassword);
    if (pwned) {
      return {
        success: false,
        error:
          "The selected password is commonly used and does not meet our security standards. Please choose a more secure option.",
      };
    }
  } catch (e) {
    // Fail open on API/network error
  }

  const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  await databaseService.updateUser(user.id, {
    password: hashedNewPassword,
    tempPassword: null, // Clear any temporary password
  });

  // Invalidate the user's session by deleting the cookie
  const cookieNames = getSessionCookieNames();
  cookieNames.forEach((name) => {
    cookieStore.set(name, "", { expires: new Date(0), path: "/" });
  });

  return { success: true };
}
