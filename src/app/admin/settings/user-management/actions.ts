"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import { Prisma, type User, type Role } from "@prisma/client";
import { cookies, headers } from "next/headers";
import {
  getUserAndPermissions,
  getUserAndManagedIds,
} from "@/lib/actions/server-helpers";
import { applyOwnershipWhere } from "@/lib/data-access-scope";
import { GENERIC_NEUTRAL_ERROR } from "@/lib/security/messages";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const ADMIN_ACCESS_TOKEN_KEY = "nibrental_admin_access_token";

export async function getUserManagementPageData() {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const canAssignBuildings =
      isSuperAdmin || !!(currentUser as any).canAssignBuildings;
    const canSeeSuperAdminCreatedRoles =
      isSuperAdmin || !!(currentUser as any).canSeeSuperAdminRoles;
    const canShowAllUsers =
      !isSuperAdmin && !!(currentUser as any).showAllUsers;

    let userWhereClause: Prisma.UserWhereInput = {};

    // Non-superadmins can only see their own account and users they created.
    if (!isSuperAdmin) {
      userWhereClause = canShowAllUsers
        ? { roles: { none: { name: "SUPER_ADMIN" } } }
        : {
            AND: [
              {
                OR: [{ id: currentUser.id }, { createdById: currentUser.id }],
              },
              { roles: { none: { name: "SUPER_ADMIN" } } },
            ],
          };
    }

    const rawUsers = await prisma.user.findMany({
      where: userWhereClause,
      include: {
        roles: true,
        managedBuildings: true,
        createdBy: {
          select: {
            roles: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const users = rawUsers.map(({ createdBy, ...user }) => ({
      ...user,
      createdDirectlyBySuperAdmin:
        createdBy?.roles.some(
          (role: { name: string }) => role.name === "SUPER_ADMIN",
        ) ?? false,
    }));

    // Apply role filtering logic
    let roleWhereClause: Prisma.RoleWhereInput = {};
    if (!isSuperAdmin) {
      const delegatedRoleClauses: Prisma.RoleWhereInput[] = [
        { createdById: currentUser.id },
      ];

      if (canSeeSuperAdminCreatedRoles) {
        delegatedRoleClauses.push({
          createdBy: {
            roles: {
              some: { name: "SUPER_ADMIN" },
            },
          },
        });
      }

      roleWhereClause = {
        OR: [
          {
            AND: [
              { name: { notIn: ["SUPER_ADMIN"] } },
              { OR: delegatedRoleClauses },
            ],
          },
          {
            name: "TENANT",
          },
        ],
      };
    }
    const allRoles = await databaseService.getAllRoles({
      where: roleWhereClause,
      orderBy: { name: "asc" },
    });

    // Non-super-admins should only see the buildings they can manage to assign
    const buildingWhereClause: Prisma.BuildingWhereInput =
      !canSeeAllBuildings && !canAssignBuildings
        ? { createdById: currentUser.id }
        : {};
    const allBuildings = await databaseService.getAllBuildings({
      where: buildingWhereClause,
      orderBy: { name: "asc" },
    });

    return { success: true, users, allRoles, allBuildings };
  } catch (error: any) {
    console.error("Error fetching user management data:", error);
    return {
      success: false,
      error: GENERIC_NEUTRAL_ERROR,
      users: [],
      allRoles: [],
      allBuildings: [],
    };
  }
}

export async function updateUserAssignments(
  targetUserId: string,
  selectedRoleId: string | null,
  selectedManagedBuildingIds: string[],
  showAllBuildings?: boolean,
  seeSuperAdminRoles?: boolean,
  assignBuildings?: boolean,
  showAllUsers?: boolean,
  nibBranch?: string | null,
) {
  try {
    // Get the current user and managed building ids to enforce scoping.
    const { isSuperAdmin, permissions, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    if (!isSuperAdmin && !permissions.has("settings:user_management:assign")) {
      return { success: false, error: "Permission denied." };
    }

    const canAssignBuildings =
      isSuperAdmin || !!(currentUser as any).canAssignBuildings;
    const canSeeSuperAdminCreatedRoles =
      isSuperAdmin || !!(currentUser as any).canSeeSuperAdminRoles;
    const canGrantShowAllBuildings = isSuperAdmin;
    const shouldShowAllBuildings =
      canGrantShowAllBuildings && !!showAllBuildings;
    const shouldShowAllUsers = isSuperAdmin && !!showAllUsers;
    const assignableBuildingIds = isSuperAdmin
      ? null
      : (
          await prisma.building.findMany({
            where: canAssignBuildings
              ? undefined
              : { createdById: currentUser.id },
            select: { id: true },
          })
        ).map((building) => building.id);

    const updateData: Prisma.UserUpdateInput = {
      roles: selectedRoleId ? { set: [{ id: selectedRoleId }] } : { set: [] },
    };

    const targetUserContext = await prisma.user.findFirst({
      where: applyOwnershipWhere("User", {
        id: targetUserId,
      }) as Prisma.UserWhereInput,
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        managedBuildings: {
          select: {
            id: true,
          },
        },
        createdBy: {
          select: {
            roles: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!targetUserContext) {
      return { success: false, error: "Permission denied." };
    }

    const createdDirectlyBySuperAdmin =
      targetUserContext.createdBy?.roles.some(
        (role) => role.name === "SUPER_ADMIN",
      ) ?? false;
    const resolvedNibBranch = createdDirectlyBySuperAdmin
      ? nibBranch?.trim() || null
      : null;

    // If we are assigning a role, we may want to auto-assign buildings for makers.
    let rolePermissions: string[] = [];
    let targetUser: { email: string; phoneNumber: string } | null = null;
    if (selectedRoleId) {
      const roleWhere: Prisma.RoleWhereInput = isSuperAdmin
        ? { id: selectedRoleId }
        : {
            AND: [
              { id: selectedRoleId },
              { name: { not: "SUPER_ADMIN" } },
              {
                OR: [
                  { createdById: currentUser.id },
                  ...(canSeeSuperAdminCreatedRoles
                    ? [
                        {
                          createdBy: {
                            roles: {
                              some: { name: "SUPER_ADMIN" },
                            },
                          },
                        },
                      ]
                    : []),
                  { name: "TENANT" },
                ],
              },
            ],
          };

      const [role, user] = await Promise.all([
        prisma.role.findFirst({
          where: roleWhere,
          select: { permissions: true },
        }),
        Promise.resolve({
          email: targetUserContext.email,
          phoneNumber: targetUserContext.phoneNumber,
        }),
      ]);

      if (!role) {
        return { success: false, error: "Selected role is not available." };
      }

      if (!user) {
        return { success: false, error: "Target user not found." };
      }

      rolePermissions = role?.permissions ?? [];
      targetUser = user;
    }

    const isBuildingMaker = rolePermissions.includes("building:create");
    const isBuildingChecker = rolePermissions.includes("building:approve");
    const isMakerAndChecker = isBuildingMaker && isBuildingChecker;

    // If no buildings were explicitly selected and the assigned role has both maker & checker
    // permissions, default to ALL buildings.
    // Otherwise, for building makers, auto-assign buildings where the target user matches
    // the building owner.
    let resolvedManagedBuildingIds = selectedRoleId
      ? selectedManagedBuildingIds
      : [];
    if (selectedRoleId && resolvedManagedBuildingIds.length === 0) {
      if (isMakerAndChecker) {
        const all = await prisma.building.findMany({
          where: isSuperAdmin ? undefined : { createdById: currentUser.id },
          select: { id: true },
        });
        resolvedManagedBuildingIds = all.map((b) => b.id);
      } else if (isBuildingMaker && targetUser) {
        const matched = await prisma.building.findMany({
          where: {
            AND: [
              {
                OR: [
                  { ownerEmail: targetUser.email },
                  { ownerPhone: targetUser.phoneNumber },
                ],
              },
              ...(isSuperAdmin ? [] : [{ createdById: currentUser.id }]),
            ],
          },
          select: { id: true },
        });
        resolvedManagedBuildingIds = matched.map((b) => b.id);
      }
    }

    // If the caller is a super-admin they can explicitly set managed buildings.
    // For non-super-admins, when they assign a role to a user we automatically
    // assign the caller's managed buildings by default (or use the explicit
    // `selectedManagedBuildingIds` if provided).
    let finalManagedBuildingIds: string[] = [];
    if (canAssignBuildings) {
      if (!shouldShowAllBuildings) {
        // Non-super-admins can assign buildings within their visible scope and
        // keep buildings that are already assigned to the target user.
        if (!isSuperAdmin) {
          const allowed = new Set([
            ...(assignableBuildingIds ?? []),
            ...targetUserContext.managedBuildings.map(
              (building) => building.id,
            ),
          ]);
          const disallowed = resolvedManagedBuildingIds.filter(
            (id) => !allowed.has(id),
          );
          if (disallowed.length > 0) {
            return {
              success: false,
              error:
                "One or more selected buildings cannot be assigned to this user.",
            };
          }
        }

        finalManagedBuildingIds = resolvedManagedBuildingIds;
        updateData.managedBuildings = {
          set: resolvedManagedBuildingIds.map((id) => ({ id })),
        };
      } else {
        finalManagedBuildingIds = [];
        updateData.managedBuildings = { set: [] };
      }
    } else {
      // If a role is being assigned, attach the caller's managed buildings
      // unless an explicit list is provided.
      if (selectedRoleId) {
        const targetIds =
          resolvedManagedBuildingIds && resolvedManagedBuildingIds.length > 0
            ? resolvedManagedBuildingIds
            : (assignableBuildingIds ?? []);
        finalManagedBuildingIds = targetIds;
        updateData.managedBuildings = { set: targetIds.map((id) => ({ id })) };
      } else {
        // No role selected -> clear managed buildings for the target user
        finalManagedBuildingIds = [];
        updateData.managedBuildings = { set: [] };
      }
    }

    if (isSuperAdmin) {
      (updateData as any).showAllBuildings = shouldShowAllBuildings;
      (updateData as any).showAllUsers = shouldShowAllUsers;
      (updateData as any).nibBranch = resolvedNibBranch;

      if (typeof seeSuperAdminRoles !== "undefined") {
        (updateData as any).canSeeSuperAdminRoles = seeSuperAdminRoles;
      }
      if (typeof assignBuildings !== "undefined") {
        (updateData as any).canAssignBuildings = assignBuildings;
      }
    }

    // Non-super-admin callers are not allowed to set delegated flags.
    // Ignore any client-provided values for these flags unless caller is SUPER_ADMIN.

    await databaseService.updateUser(targetUserId, updateData);

    revalidatePath("/admin/settings/user-management");
    revalidatePath("/admin/buildings");
    return {
      success: true,
      message: "User assignments updated successfully.",
      assignedManagedBuildingIds: finalManagedBuildingIds,
      showAllBuildings: isSuperAdmin ? shouldShowAllBuildings : undefined,
      showAllUsers: isSuperAdmin ? shouldShowAllUsers : undefined,
      nibBranch: isSuperAdmin ? resolvedNibBranch : undefined,
    };
  } catch (error: any) {
    console.error("Error updating user assignments:", error);
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
}

export async function updateUserNamesAction(
  userId: string,
  data: {
    firstName: string;
    lastName: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:user_management:assign")) {
      return { success: false, error: "Permission denied." };
    }

    await databaseService.updateUser(userId, {
      firstName: data.firstName,
      lastName: data.lastName,
      name: `${data.firstName} ${data.lastName}`.trim(),
    });

    const localUserToUpdate = await databaseService.getUserById(userId);
    if (localUserToUpdate) {
      const tenantProfile = await databaseService.findTenantByEmailOrPhone(
        localUserToUpdate.email,
        localUserToUpdate.phoneNumber,
      );
      if (tenantProfile) {
        await databaseService.updateTenant(tenantProfile.id, {
          name: `${data.firstName} ${data.lastName}`.trim(),
        });
      }
    }

    revalidatePath("/admin/settings/user-management");
    return { success: true };
  } catch (error: any) {
    console.error("Error in updateUserNamesAction:", error);
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
}

export async function changeUserPhoneNumberAction(
  userId: string,
  newPhoneNumber: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:user_management:assign")) {
      return { success: false, error: "Permission denied." };
    }

    const userToUpdate = await databaseService.getUserById(userId);
    if (!userToUpdate) {
      return { success: false, error: GENERIC_NEUTRAL_ERROR };
    }

    await databaseService.updateUser(userId, {
      phoneNumber: newPhoneNumber,
    });

    const tenantProfile = await databaseService.findTenantByEmailOrPhone(
      null,
      userToUpdate.phoneNumber,
    );
    if (tenantProfile) {
      await databaseService.updateTenant(tenantProfile.id, {
        phone: newPhoneNumber,
      });
    }

    revalidatePath("/admin/settings/user-management");
    return { success: true };
  } catch (error: any) {
    console.error("Error in changeUserPhoneNumberAction:", error);
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
}

export async function changeUserEmailAction(
  userId: string,
  newEmail: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:user_management:assign")) {
      return { success: false, error: "Permission denied." };
    }

    // Check for existing user with the new email
    const existing = await databaseService.findUserByEmailOrPhone(
      newEmail,
      null,
    );
    if (existing && existing.id !== userId) {
      return {
        success: false,
        error: "Email is already in use by another user.",
      };
    }

    const userToUpdate = await databaseService.getUserById(userId);
    if (!userToUpdate) return { success: false, error: "User not found." };

    await databaseService.updateUser(userId, { email: newEmail });

    // If there's a tenant profile linked by the old email/phone, update it
    const tenantProfile = await databaseService.findTenantByEmailOrPhone(
      userToUpdate.email,
      userToUpdate.phoneNumber,
    );
    if (tenantProfile) {
      await databaseService.updateTenant(tenantProfile.id, { email: newEmail });
    }

    revalidatePath("/admin/settings/user-management");
    return { success: true };
  } catch (error: any) {
    console.error("Error in changeUserEmailAction:", error);
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
}

export async function updateUserStatusAction(
  userId: string,
  status: "Active" | "Inactive",
): Promise<{ success: boolean; error?: string; requiresLogout?: boolean }> {
  try {
    const { isSuperAdmin, permissions, currentUser } =
      await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:user_management:assign")) {
      return { success: false, error: "Permission denied." };
    }

    const userToUpdate = await databaseService.getUserById(userId);
    if (!userToUpdate) {
      return { success: false, error: "User not found." };
    }

    await databaseService.updateUser(userId, { status });

    if (status === "Inactive") {
      await databaseService.revokeUserSessionsByUserId(userId);
    }

    revalidatePath("/admin/settings/user-management");
    return {
      success: true,
      requiresLogout: currentUser.id === userId && status === "Inactive",
    };
  } catch (error: any) {
    console.error("Error in updateUserStatusAction:", error);
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
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

export async function resetUserPasswordAction(
  userId: string,
): Promise<{ success: boolean; tempPassword?: string; error?: string }> {
  try {
    const { isSuperAdmin, permissions } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:user_management:assign")) {
      return { success: false, error: "Permission denied." };
    }

    const tempPassword = generateTempPassword();

    await databaseService.updateUser(userId, {
      password: null, // Remove the main password
      tempPassword: tempPassword, // Store the plain temporary password
    });

    revalidatePath("/admin/settings/user-management");
    return { success: true, tempPassword };
  } catch (error: any) {
    console.error("Error resetting user password:", error);
    return { success: false, error: "Failed to reset password." };
  }
}
