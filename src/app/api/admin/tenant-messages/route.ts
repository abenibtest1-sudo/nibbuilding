import { NextResponse } from "next/server";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const pageSize = Number(url.searchParams.get("pageSize") || "10");
    const q = url.searchParams.get("q") || "";

    const { isSuperAdmin, managedBuildingIds } = await getUserAndManagedIds();

    const where: any = {};
    if (!isSuperAdmin) {
      where.buildingId = { in: managedBuildingIds ?? [] };
    }

    if (q) {
      where.OR = [
        { subject: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ];
    }

    const [messages, total] = await Promise.all([
      (prisma as any).tenantMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          tenant: { select: { name: true } },
          building: { select: { name: true } },
        },
      }),
      (prisma as any).tenantMessage.count({ where }),
    ]);

    const serialized = messages.map((m: any) => ({
      id: m.id,
      subject: m.subject ?? null,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
      tenantName: m.tenant?.name ?? null,
      buildingName: m.building?.name ?? null,
    }));

    return NextResponse.json({ success: true, messages: serialized, total });
  } catch (e: any) {
    console.error("Tenant messages list error", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Error" },
      { status: 500 },
    );
  }
}
