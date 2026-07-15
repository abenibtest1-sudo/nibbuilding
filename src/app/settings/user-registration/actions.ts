"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { GENERIC_NEUTRAL_ERROR } from "@/lib/security/messages";
import { sendEmail } from "@/lib/services/emailService";
import { getUserAndPermissions } from "@/lib/actions/server-helpers";
import bcrypt from "bcryptjs";

interface CreateUserAndAccountData {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
}

function generateTempPassword(length = 12): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const allChars = upper + lower + numbers + symbols;

  let password = "";
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);

  // Ensure at least one of each character type
  password += upper[randomValues[0] % upper.length];
  password += lower[randomValues[1] % lower.length];
  password += numbers[randomValues[2] % numbers.length];
  password += symbols[randomValues[3] % symbols.length];

  // Fill the rest of the password
  for (let i = 4; i < length; i++) {
    password += allChars[randomValues[i] % allChars.length];
  }

  // Shuffle the password to avoid predictable patterns
  return password
    .split("")
    .sort(
      () => 0.5 - crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
    )
    .join("");
}

export async function createUserAndAccountAction(
  data: CreateUserAndAccountData,
) {
  try {
    const { currentUser: adminUser } = await getUserAndPermissions();

    if (!adminUser) {
      return { success: false, error: GENERIC_NEUTRAL_ERROR };
    }

    const { firstName, lastName, phoneNumber, email } = data;

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: "insensitive" } },
          { phoneNumber: phoneNumber },
        ],
      },
    });

    if (existingUser) {
      return { success: false, error: GENERIC_NEUTRAL_ERROR };
    }

    const tempPassword = generateTempPassword();

    const userCreateInput: Prisma.UserCreateInput = {
      email: email,
      name: `${firstName} ${lastName}`.trim(),
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      password: null, // Set main password to null initially
      tempPassword: tempPassword,
      createdBy: { connect: { id: adminUser.id } },
    };

    const localUser = await prisma.user.create({ data: userCreateInput });

    // Send welcome email
    const emailHtml = `
      <h1>Welcome to Nib Building Management!</h1>
      <p>Hello ${firstName},</p>
      <p>A new staff account has been created for you by an administrator.</p>
      <p>Please contact your administrator to receive your temporary password and assigned role.</p>
      <p>You can access the portal here: <a href="${process.env.NEXTAUTH_URL}/login">${process.env.NEXTAUTH_URL}/login</a></p>
      <p><strong>Login Phone Number:</strong> ${phoneNumber}</p>
      <p>Thank you,</p>
      <p>The Management Team</p>
    `;

    await sendEmail({
      to: email,
      subject: "Your New Staff Account for Nib Building Management",
      html: emailHtml,
    });

    return {
      success: true,
      message:
        "User registered successfully. Please assign them a role in User Management.",
      user: localUser,
    };
  } catch (dbError: any) {
    console.error("Error creating user in local database:", dbError);
    if (
      dbError instanceof Prisma.PrismaClientKnownRequestError &&
      dbError.code === "P2002"
    ) {
      return { success: false, error: GENERIC_NEUTRAL_ERROR };
    }
    return {
      success: false,
      error: "Failed to create user due to a database error.",
    };
  }
}
