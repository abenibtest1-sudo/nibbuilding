import { NextResponse, type NextRequest } from "next/server";
import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { databaseService } from "@/lib/services/databaseService";
import {
  GENERIC_AUTH_ERROR,
  GENERIC_NEUTRAL_ERROR,
} from "@/lib/security/messages";
import type { CurrentUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const session = await verifySession(token);

  if (!session?.userId) {
    return NextResponse.json(
      { isSuccess: false, errors: [GENERIC_AUTH_ERROR] },
      { status: 401 },
    );
  }

  try {
    const localUser = await databaseService.getUserById(session.userId, {
      roles: true,
      managedBuildings: { select: { id: true } },
    });

    if (!localUser) {
      return NextResponse.json(
        { isSuccess: false, errors: [GENERIC_AUTH_ERROR] },
        { status: 404 },
      );
    }

    const effectivePermissions = session.permissions ?? [];

    const currentUserData: CurrentUser = {
      id: localUser.id,
      email: localUser.email,
      name:
        localUser.name || `${localUser.firstName} ${localUser.lastName}`.trim(),
      firstName: localUser.firstName,
      lastName: localUser.lastName,
      phoneNumber: localUser.phoneNumber,
      nibBranch: (localUser as any).nibBranch ?? null,
      roles: localUser.roles.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: role.permissions || [],
      })),
      effectivePermissions,
      managedBuildingIds: localUser.managedBuildings.map(
        (building) => building.id,
      ),
      canSeeSuperAdminRoles: !!(localUser as any).canSeeSuperAdminRoles,
      canAssignBuildings: !!(localUser as any).canAssignBuildings,
      showAllBuildings: !!(localUser as any).showAllBuildings,
      showAllUsers: !!(localUser as any).showAllUsers,
      status: (localUser as any).status ?? "Active",
    };

    return NextResponse.json({ isSuccess: true, user: currentUserData });
  } catch (dbError: any) {
    console.error("Database error in /api/user/me:", dbError.message);
    console.error("Database error in /api/user/me:", dbError.message);
    return NextResponse.json(
      { isSuccess: false, errors: [GENERIC_NEUTRAL_ERROR] },
      { status: 500 },
    );
  }
}
