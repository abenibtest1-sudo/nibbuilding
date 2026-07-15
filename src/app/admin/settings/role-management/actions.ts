"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import { Prisma, type User, type Role } from "@prisma/client";
import { cookies } from "next/headers";
import { getUserAndPermissions } from "@/lib/actions/server-helpers";
import { prisma } from "@/lib/prisma";

// Helper to get user and check for super admin status
async function getIsSuperAdmin() {
  const { isSuperAdmin } = await getUserAndPermissions();
  return isSuperAdmin;
}

export async function getAllRolesAction(): Promise<{
  success: boolean;
  roles?: Role[];
  error?: string;
}> {
  try {
    const { isSuperAdmin, currentUser } = await getUserAndPermissions();

    let whereClause: Prisma.RoleWhereInput = {};

    // Non-super-admins only see roles they created, plus the tenant role.
    if (!isSuperAdmin) {
      whereClause = {
        OR: [{ name: "TENANT" }, { createdById: currentUser.id }],
        name: { not: "SUPER_ADMIN" },
      };
    }

    const roles = await databaseService.getAllRoles({
      where: whereClause,
      orderBy: { name: "asc" },
    });
    return { success: true, roles };
  } catch (error: any) {
    console.error("Error fetching roles:", error);
    return { success: false, error: error.message || "Failed to fetch roles." };
  }
}

export interface RoleUpsertData {
  name: string;
  description?: string;
  permissions: string[];
}

export async function createRoleAction(
  data: RoleUpsertData,
): Promise<{ success: boolean; role?: Role; error?: string }> {
  try {
    const { currentUser, isSuperAdmin, permissions } =
      await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:role_management:manage")) {
      return { success: false, error: "Access Denied" };
    }

    const roleCreateInput: Prisma.RoleCreateInput = {
      ...data,
      createdBy: { connect: { id: currentUser.id } },
    };

    const newRole = await databaseService.createRole(roleCreateInput);
    revalidatePath("/admin/settings/role-management");
    revalidatePath("/admin/settings/user-management"); // Roles list might be used there
    return { success: true, role: newRole };
  } catch (error: any) {
    console.error("Error creating role:", error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: `A role with the name "${data.name}" already exists. Please use a unique name.`,
      };
    }
    return { success: false, error: error.message || "Failed to create role." };
  }
}

export async function updateRoleAction(
  id: string,
  data: RoleUpsertData,
): Promise<{ success: boolean; role?: Role; error?: string }> {
  try {
    const { currentUser, isSuperAdmin, permissions } =
      await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:role_management:manage")) {
      return { success: false, error: "Access Denied" };
    }

    if (!isSuperAdmin) {
      const existingRole = await prisma.role.findFirst({
        where: { id, createdById: currentUser.id },
        select: { id: true },
      });

      if (!existingRole) {
        return { success: false, error: "Access Denied" };
      }
    }

    const updatedRole = await databaseService.updateRole(id, data);
    revalidatePath("/admin/settings/role-management");
    revalidatePath("/admin/settings/user-management");
    return { success: true, role: updatedRole };
  } catch (error: any) {
    console.error("Error updating role:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return {
          success: false,
          error: `A role with the name "${data.name}" already exists. Please use a unique name.`,
        };
      }
      if (error.code === "P2025") {
        return { success: false, error: "Role not found for update." };
      }
    }
    return { success: false, error: error.message || "Failed to update role." };
  }
}

export async function deleteRoleAction(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions, currentUser } =
      await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("settings:role_management:manage")) {
      return { success: false, error: "Access Denied" };
    }

    if (!isSuperAdmin) {
      const existingRole = await prisma.role.findFirst({
        where: { id, createdById: currentUser.id },
        select: { id: true },
      });

      if (!existingRole) {
        return { success: false, error: "Access Denied" };
      }
    }

    const roleWithUsers = await prisma.role.findUnique({
      where: { id },
      select: { _count: { select: { users: true } } },
    });

    if ((roleWithUsers?._count.users ?? 0) > 0) {
      return {
        success: false,
        error:
          "Cannot delete role as it is currently assigned to one or more users. Please reassign users first.",
      };
    }
    await databaseService.deleteRole(id);
    revalidatePath("/admin/settings/role-management");
    revalidatePath("/admin/settings/user-management");
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting role:", error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { success: false, error: "Role not found for deletion." };
    }
    return { success: false, error: error.message || "Failed to delete role." };
  }
}
