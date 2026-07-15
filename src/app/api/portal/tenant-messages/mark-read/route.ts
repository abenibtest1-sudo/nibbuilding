import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  // Tenants are not allowed to mark messages as read. Admins must mark messages via the admin interface.
  return NextResponse.json(
    { success: false, error: "Forbidden" },
    { status: 403 },
  );
}
