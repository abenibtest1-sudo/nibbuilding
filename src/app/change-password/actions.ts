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
  newPassword: z.string().min(6, "New password must be at least 6 characters."),
});

export async function changePasswordAction(
  values: z.infer<typeof changePasswordSchema>,
): Promise<{ success: boolean; error?: string }> {
  const rc = await cookies();
  const token = rc.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const sessionUser = await verifySession(token);
  if (!sessionUser) {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  // This action should only work if the user is in a "force change" state.
  if (!sessionUser.forceChangePass) {
    throw new Error("This action is only for initial password setup.");
  }

  const validatedData = changePasswordSchema.safeParse(values);
  if (!validatedData.success) {
    throw new Error("Invalid data provided.");
  }
  const { newPassword } = validatedData.data;

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
    // On network/API error, fail open (allow change) — server owners may
    // choose to change this behavior to fail closed.
  }

  const user = await databaseService.getUserById(sessionUser.userId);
  if (!user || !user.tempPassword) {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  await databaseService.updateUser(user.id, {
    password: hashedNewPassword,
    tempPassword: null, // Clear the temporary password after successful change
  });

  // Invalidate the user's session to force a re-login with the new password
  const cookieNames = getSessionCookieNames();
  cookieNames.forEach((name) => {
    rc.set(name, "", { expires: new Date(0), path: "/" });
  });

  return { success: true };
}
