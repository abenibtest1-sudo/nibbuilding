"use server";
import "server-only";

import { verifySession, ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";
import { GENERIC_AUTH_ERROR } from "@/lib/security/messages";
import { databaseService } from "@/lib/services/databaseService";
import { setDataAccessScope } from "@/lib/data-access-scope";
import type { User, Role } from "@prisma/client";
import { redirect } from "next/navigation";
import type { CurrentUser } from "@/lib/types";
import { cookies } from "next/headers";

type UserWithRolesAndManagedBuildings = User & {
  roles: Role[];
  managedBuildings: Array<{ id: string }>;
};

function getAssignedManagedBuildingIds(
  currentUser: UserWithRolesAndManagedBuildings,
) {
  return currentUser.managedBuildings.map((building) => building.id);
}

function resolveManagedBuildingIds(
  currentUser: UserWithRolesAndManagedBuildings,
  isSuperAdmin: boolean,
) {
  if (isSuperAdmin || !!(currentUser as any).showAllBuildings) {
    return null;
  }

  return getAssignedManagedBuildingIds(currentUser);
}

function applyResolvedDataAccessScope(
  userId: string,
  isSuperAdmin: boolean,
  currentUser: UserWithRolesAndManagedBuildings,
) {
  setDataAccessScope({
    userId,
    isSuperAdmin,
    managedBuildingIds: resolveManagedBuildingIds(currentUser, isSuperAdmin),
    showAllBuildings: !!(currentUser as any).showAllBuildings,
    showAllUsers: !!(currentUser as any).showAllUsers,
  });
}

/**
 * A server-side helper to get the fully authenticated user object, their permissions,
 * and super admin status. Throws an error if the user is not authenticated.
 * @returns {Promise<{currentUser: User & { roles: Role[] }, isSuperAdmin: boolean, permissions: Set<string>}>}
 */
export async function getUserAndPermissions() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session?.userId) {
    // Instead of redirecting, which causes issues with server actions, we throw a generic auth error.
    throw new Error(GENERIC_AUTH_ERROR);
  }

  setDataAccessScope({
    userId: session.userId,
    isSuperAdmin: session.isSuperAdmin,
  });

  const currentUser = (await databaseService.getUserById(session.userId, {
    roles: true,
    managedBuildings: { select: { id: true } },
  })) as UserWithRolesAndManagedBuildings | null;

  if (!currentUser) {
    console.error(
      `CRITICAL: Authenticated user with id ${session.userId} not found in the database.`,
    );
    throw new Error(GENERIC_AUTH_ERROR);
  }

  if ((currentUser as any).status === "Inactive") {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  const isSuperAdmin = session.isSuperAdmin;
  applyResolvedDataAccessScope(session.userId, isSuperAdmin, currentUser);
  const permissions = new Set<string>(session.permissions);

  return { currentUser, isSuperAdmin, permissions };
}

/**
 * A server-side helper to get the current user and a list of building IDs they manage.
 * For super admins, managedBuildingIds will be `null` to signify unrestricted access.
 * For delegated all-building users, managedBuildingIds will also be `null`.
 * For all other users, the returned IDs come from their assigned managed buildings.
 * Throws an error if the user is not authenticated.
 * @returns {Promise<{currentUser: User, isSuperAdmin: boolean, managedBuildingIds: string[] | null}>}
 */
export async function getUserAndManagedIds() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session?.userId) {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  setDataAccessScope({
    userId: session.userId,
    isSuperAdmin: session.isSuperAdmin,
  });

  const currentUser = (await databaseService.getUserById(session.userId, {
    roles: true,
    managedBuildings: { select: { id: true } },
  })) as UserWithRolesAndManagedBuildings | null;

  if (!currentUser) {
    console.error(
      `CRITICAL: Authenticated user with id ${session.userId} not found in the database.`,
    );
    throw new Error(GENERIC_AUTH_ERROR);
  }

  if ((currentUser as any).status === "Inactive") {
    throw new Error(GENERIC_AUTH_ERROR);
  }

  const isSuperAdmin = session.isSuperAdmin;
  applyResolvedDataAccessScope(session.userId, isSuperAdmin, currentUser);
  const managedBuildingIds = resolveManagedBuildingIds(
    currentUser,
    isSuperAdmin,
  );

  const permissions = new Set<string>(session.permissions);

  return { currentUser, isSuperAdmin, managedBuildingIds, permissions };
}

/**
 * Redirects to a specified URL and appends an error message for the client to display as a toast.
 * @param {string} url - The URL to redirect to.
 * @param {string} message - The error message to display.
 */
export async function redirectWithToast(url: string, message: string) {
  const finalUrl = `${url}?error=${encodeURIComponent(message)}`;
  return redirect(finalUrl);
}

// This new server action replaces the /api/user/me endpoint
export async function getUserSessionAction(): Promise<{
  isSuccess: boolean;
  user: CurrentUser | null;
}> {
  try {
    const cookieStore = await cookies();
    const accessCookie = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME);
    const session = await verifySession(accessCookie?.value ?? "");

    if (!session?.userId) {
      return { isSuccess: false, user: null };
    }

    setDataAccessScope({
      userId: session.userId,
      isSuperAdmin: session.isSuperAdmin,
    });

    const localUser = (await databaseService.getUserById(session.userId, {
      roles: true,
      managedBuildings: { select: { id: true } },
    })) as UserWithRolesAndManagedBuildings | null;

    if (!localUser) {
      return { isSuccess: false, user: null };
    }

    if ((localUser as any).status === "Inactive") {
      return { isSuccess: false, user: null };
    }

    const effectivePermissions = session.permissions ?? [];
    applyResolvedDataAccessScope(
      session.userId,
      session.isSuperAdmin,
      localUser,
    );
    const managedBuildingIds = resolveManagedBuildingIds(
      localUser,
      session.isSuperAdmin,
    );
    const assignedManagedBuildingIds = getAssignedManagedBuildingIds(localUser);

    const constructedName = [localUser.firstName, localUser.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const displayName =
      localUser.name || constructedName || localUser.email || "User";

    const currentUserData: CurrentUser = {
      id: localUser.id,
      email: localUser.email,
      name: displayName,
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
      managedBuildingIds: assignedManagedBuildingIds,
      canSeeSuperAdminRoles: !!(localUser as any).canSeeSuperAdminRoles,
      canAssignBuildings: !!(localUser as any).canAssignBuildings,
      showAllBuildings: !!(localUser as any).showAllBuildings,
      showAllUsers: !!(localUser as any).showAllUsers,
      status: (localUser as any).status ?? "Active",
    };

    return { isSuccess: true, user: currentUserData };
  } catch (error) {
    console.error("Error in getUserSessionAction:", error);
    return { isSuccess: false, user: null };
  }
}
