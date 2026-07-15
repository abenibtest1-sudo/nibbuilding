import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const session = await verifySession(token);
    if (!session?.userId)
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );

    const user = await databaseService.getUserById(session.userId);
    if (!user)
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );

    const associatedTenant = await databaseService.findTenantByEmailOrPhone(
      user.email,
      user.phoneNumber,
    );
    if (!associatedTenant)
      return NextResponse.json({ success: true, count: 0 });

    const count = await (prisma as any).tenantMessage.count({
      where: { tenantId: associatedTenant.id, readAt: null },
    });

    return NextResponse.json({ success: true, count });
  } catch (e: any) {
    console.error("Portal unread count error", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Error" },
      { status: 500 },
    );
  }
}
