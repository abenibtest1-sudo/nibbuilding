
"use server";

import nodemailer from "nodemailer";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string; // Add optional 'from' field
}

// SMTP configuration is now built dynamically
async function getTransporter() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    console.error("❌ SMTP user or password is not configured in environment variables.");
    return null;
  }

  try {
    const smtpConfig = {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    };

    return nodemailer.createTransport(smtpConfig);
  } catch (error) {
    console.error(
      "❌ Failed to create transporter:",
      error,
    );
    return null;
  }
}

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const transporter = await getTransporter();

  if (!transporter) {
    const errorMsg =
      "Email service is not configured correctly (check SMTP environment variables).";
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  const defaultFrom = process.env.SMTP_FROM || process.env.SMTP_USER;

  const mailOptions = {
    from: from || defaultFrom, // Use provided 'from' or fallback to default
    to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error: any) {
    console.error(`❌ Failed to send email to ${to}:`, error);
    return {
      success: false,
      error:
        error.message || "An unknown error occurred while sending the email.",
    };
  }
}
