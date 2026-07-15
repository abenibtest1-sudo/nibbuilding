import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const pageSize = Number(url.searchParams.get("pageSize") || "5");
    const q = url.searchParams.get("q") || "";

    const cookieStore = await cookies();
    const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const session = await verifySession(token);
    if (!session?.userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

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
    if (!associatedTenant) {
      return NextResponse.json(
        { success: false, error: "No associated tenant found" },
        { status: 404 },
      );
    }

    const where: any = { tenantId: associatedTenant.id };
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
        include: { building: { select: { name: true } } },
      }),
      (prisma as any).tenantMessage.count({ where }),
    ]);

    const serialized = messages.map((m: any) => ({
      id: m.id,
      subject: m.subject ?? null,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
      buildingName: m.building?.name ?? null,
    }));

    return NextResponse.json({ success: true, messages: serialized, total });
  } catch (e: any) {
    console.error("Portal tenant messages list error", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Error" },
      { status: 500 },
    );
  }
}
