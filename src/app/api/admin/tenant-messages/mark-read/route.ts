import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { markTenantMessageReadAction } from "@/app/admin/dashboard/actions";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body || {};
    if (!id)
      return NextResponse.json(
        { success: false, error: "Missing id" },
        { status: 400 },
      );

    const result = await markTenantMessageReadAction(id);
    if (!result.success)
      return NextResponse.json(
        { success: false, error: result.error || "Failed" },
        { status: 400 },
      );

    return NextResponse.json({
      success: true,
      readAt: result.readAt ?? new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("Mark read API error", e);
    return NextResponse.json(
      { success: false, error: e?.message || "Error" },
      { status: 500 },
    );
  }
}
