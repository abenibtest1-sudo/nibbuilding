import { NextResponse } from "next/server";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { isSuperAdmin, managedBuildingIds } = await getUserAndManagedIds();

    const where: any = { readAt: null };
    if (!isSuperAdmin) {
      where.buildingId = { in: managedBuildingIds ?? [] };
    }

    const count = await (prisma as any).tenantMessage.count({ where });

    return NextResponse.json({ success: true, count });
  } catch (e: any) {
    console.error("Unread count error", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Error" },
      { status: 500 },
    );
  }
}
