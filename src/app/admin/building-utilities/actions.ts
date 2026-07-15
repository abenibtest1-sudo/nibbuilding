"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import {
  Prisma,
  type Building,
  type BuildingMonthlyUtilities,
  type User,
  type Role,
  type BuildingUtilityItem,
  type BuildingStatus,
} from "@prisma/client";
import { cookies } from "next/headers";
import {
  getUserAndManagedIds,
  getUserAndPermissions,
} from "@/lib/actions/server-helpers";
import { prisma } from "@/lib/prisma";

export async function getRegisteredBuildingsAction(): Promise<Building[]> {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

    const whereClause = !canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? { id: { in: managedBuildingIds }, status: "Active" as const }
        : { createdById: currentUser.id, status: "Active" as const }
      : { status: "Active" as const };

    return await databaseService.getAllBuildings({
      where: whereClause,
      orderBy: { name: "asc" },
      include: { spaces: { orderBy: { spaceIdName: "asc" } } },
    });
  } catch (error: any) {
    console.error("Error fetching buildings:", error);
    return [];
  }
}

export async function getBuildingUtilitiesAction(
  buildingId: string,
  year: number,
  month: number,
): Promise<
  | (BuildingMonthlyUtilities & {
      utilities: {
        totalCost: number;
        perSpaceAllocation?: Record<string, number> | null;
      }[];
    })
  | null
> {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;
    const building = await databaseService.getBuildingById(buildingId);
    if (!building) {
      return null;
    }
    if (
      !canSeeAllBuildings &&
      (hasAssignedBuildingScope
        ? !managedBuildingIds.includes(building.id)
        : building.createdById !== currentUser.id)
    ) {
      return null;
    }

    const utilities =
      await databaseService.getBuildingMonthlyUtilitiesByBuildingMonthYear(
        buildingId,
        month,
        year,
        {
          utilities: true,
        },
      );

    if (!utilities) return null;

    if (
      !canSeeAllBuildings &&
      (hasAssignedBuildingScope
        ? utilities.buildingId !== null &&
          !managedBuildingIds.includes(utilities.buildingId)
        : utilities.createdById !== currentUser.id)
    ) {
      return null;
    }

    // Serialize Decimal to number and parse JSON
    const serializableUtilities = {
      ...utilities,
      utilities: utilities.utilities.map((u) => ({
        ...u,
        totalCost: Number(u.totalCost),
        perSpaceAllocation:
          u.perSpaceAllocation && typeof u.perSpaceAllocation === "string"
            ? JSON.parse(u.perSpaceAllocation)
            : null,
      })),
    };

    return serializableUtilities as BuildingMonthlyUtilities & {
      utilities: {
        totalCost: number;
        perSpaceAllocation?: Record<string, number> | null;
      }[];
    };
  } catch (error: any) {
    console.error("Error fetching building utilities:", error);
    return null; // Return null on error
  }
}

export interface BuildingUtilityItemInput {
  id?: string; // Add optional ID for updates
  name: string;
  totalCost: number;
  appliesToScope: "Building" | "Floor" | "SpecificSpaces"; // Matches Prisma Enum
  applicableFloor?: string | null;
  applicableSpaceIdNames?: string[] | null;
  perSpacePercentages?: { [spaceId: string]: number };
}

export async function saveBuildingUtilitiesAction(
  buildingId: string,
  buildingName: string,
  year: number,
  month: number,
  utilityItems: BuildingUtilityItemInput[],
) {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser, permissions } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;
    const accessibleBuilding =
      await databaseService.getBuildingById(buildingId);
    if (!accessibleBuilding) {
      return { success: false, error: "Permission denied." };
    }

    if (
      !canSeeAllBuildings &&
      (hasAssignedBuildingScope
        ? !managedBuildingIds.includes(accessibleBuilding.id)
        : accessibleBuilding.createdById !== currentUser.id)
    ) {
      return { success: false, error: "Permission denied." };
    }

    if (!isSuperAdmin && !permissions.has("building_utility:create")) {
      return { success: false, error: "Access Denied" };
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1️⃣ Find existing parent or create it
      let monthlyUtil = await tx.buildingMonthlyUtilities.findUnique({
        where: { buildingId_year_month: { buildingId, year, month } },
        include: { utilities: true },
      });

      if (!monthlyUtil) {
        monthlyUtil = await tx.buildingMonthlyUtilities.create({
          data: {
            building: { connect: { id: buildingId } },
            buildingName,
            year,
            month,
            status: isSuperAdmin ? "Active" : "Pending",
            rejectionReason: null,
            createdBy: { connect: { id: currentUser.id } },
            ...(isSuperAdmin
              ? { approvedBy: { connect: { id: currentUser.id } } }
              : {}),
          },
          include: { utilities: true },
        });
      } else {
        // Any edit should return the record to Pending unless a Super Admin is saving.
        // Ensure the user has edit permission when updating existing records.
        if (!isSuperAdmin && !permissions.has("building_utility:edit")) {
          throw new Error("Access Denied");
        }
        await tx.buildingMonthlyUtilities.update({
          where: { id: monthlyUtil.id },
          data: isSuperAdmin
            ? {
                status: "Active",
                rejectionReason: null,
                approvedBy: { connect: { id: currentUser.id } },
              }
            : {
                status: "Pending",
                rejectionReason: null,
                approvedBy: { disconnect: true },
              },
        });
      }

      const clientItemIds = new Set(
        utilityItems.filter((i) => i.id).map((i) => i.id!),
      );
      const dbItemIds = new Set(monthlyUtil.utilities.map((i) => i.id));
      const itemIdsToDelete = [...dbItemIds].filter(
        (id) => !clientItemIds.has(id),
      );

      // 2️⃣ Delete removed items
      if (itemIdsToDelete.length > 0) {
        await tx.buildingUtilityItem.deleteMany({
          where: { id: { in: itemIdsToDelete } },
        });
      }

      // 3️⃣ Upsert utility items
      for (const item of utilityItems) {
        const dataPayload: Omit<
          Prisma.BuildingUtilityItemUncheckedCreateInput,
          "monthlyUtilitiesId"
        > = {
          name: item.name,
          totalCost: item.totalCost,
          appliesToScope: item.appliesToScope,
          applicableFloor:
            item.appliesToScope === "Floor" ? item.applicableFloor : null,
          applicableSpaceIdNames:
            item.appliesToScope === "SpecificSpaces"
              ? item.applicableSpaceIdNames || []
              : [],
          perSpaceAllocation: item.perSpacePercentages
            ? JSON.stringify(item.perSpacePercentages)
            : "",
        };

        if (item.id && dbItemIds.has(item.id)) {
          // Update existing
          await tx.buildingUtilityItem.update({
            where: { id: item.id },
            data: dataPayload,
          });
        } else {
          // Create new with nested connect
          await tx.buildingUtilityItem.create({
            data: {
              ...dataPayload,
              monthlyUtilities: {
                connect: { id: monthlyUtil.id },
              },
            },
          });
        }
      }

      // 4️⃣ Return final state
      return tx.buildingMonthlyUtilities.findUnique({
        where: { id: monthlyUtil.id },
        include: { utilities: true },
      });
    });

    revalidatePath("/admin/building-utilities");
    revalidatePath("/admin/billing");

    if (!result) throw new Error("Transaction failed.");

    // 5️⃣ Serialize decimals
    const serializableResult = {
      ...result,
      utilities: result.utilities.map((u) => ({
        ...u,
        totalCost: Number(u.totalCost),
        perSpaceAllocation: u.perSpaceAllocation
          ? JSON.parse(u.perSpaceAllocation)
          : null,
      })),
    };

    return { success: true, data: serializableResult };
  } catch (error: any) {
    console.error("Error saving building utilities:", error);
    return {
      success: false,
      error: error.message || "Failed to save utilities.",
    };
  }
}

export async function setBuildingUtilitiesStatusAction(
  monthlyUtilitiesId: string,
  newStatus: BuildingStatus,
  rejectionReason?: string,
) {
  try {
    const { isSuperAdmin, permissions, currentUser } =
      await getUserAndPermissions();

    if (newStatus === "Active" || newStatus === "Rejected") {
      if (!isSuperAdmin && !permissions.has("building_utility:approve")) {
        return { success: false, error: "Access Denied" };
      }
    }

    const existing =
      await databaseService.getBuildingMonthlyUtilitiesById(monthlyUtilitiesId);
    if (!existing) {
      return { success: false, error: "Utility record not found." };
    }

    const updateData: Prisma.BuildingMonthlyUtilitiesUpdateInput = {
      status: newStatus,
    };
    if (newStatus === "Active") {
      updateData.rejectionReason = null;
      updateData.approvedBy = { connect: { id: currentUser.id } };
    }
    if (newStatus === "Rejected") {
      updateData.rejectionReason = rejectionReason || null;
      updateData.approvedBy = { connect: { id: currentUser.id } };
    }

    await prisma.buildingMonthlyUtilities.update({
      where: { id: monthlyUtilitiesId },
      data: updateData,
    });

    revalidatePath("/admin/building-utilities");
    revalidatePath("/admin/billing");
    return { success: true };
  } catch (error: any) {
    console.error("Error changing building utilities status:", error);
    return {
      success: false,
      error: error.message || `Failed to set status to ${newStatus}.`,
    };
  }
}
export async function getAllBuildingUtilitiesForListAction(): Promise<
  (BuildingMonthlyUtilities & { utilities: { totalCost: number }[] })[]
> {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;
    const whereClause = !canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? { buildingId: { in: managedBuildingIds } }
        : { createdById: currentUser.id }
      : {};

    const records = await databaseService.getAllBuildingMonthlyUtilities({
      where: whereClause,
      include: { utilities: true, building: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Correctly serialize the Decimal values to numbers before returning
    const serializedRecords = records.map((record) => ({
      ...record,
      utilities: record.utilities.map((util) => ({
        ...util,
        totalCost: Number(util.totalCost),
      })),
    }));

    return serializedRecords as (BuildingMonthlyUtilities & {
      utilities: { totalCost: number }[];
    })[];
  } catch (error: any) {
    console.error("Error fetching all building utilities:", error);
    return [];
  }
}

export async function deleteBuildingUtilitiesAction(id: string) {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

    // Fetch the record first to check for ownership
    const recordToDelete =
      await databaseService.getBuildingMonthlyUtilitiesById(id);
    if (!recordToDelete) {
      return {
        success: false,
        error: "Utility record not found for deletion.",
      };
    }

    if (
      !canSeeAllBuildings &&
      (hasAssignedBuildingScope
        ? !!recordToDelete.buildingId &&
          !managedBuildingIds.includes(recordToDelete.buildingId)
        : recordToDelete.createdById !== currentUser.id)
    ) {
      return { success: false, error: "Permission denied." };
    }

    // Require explicit delete permission
    const { permissions } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("building_utility:delete")) {
      return { success: false, error: "Access Denied" };
    }

    await databaseService.deleteBuildingMonthlyUtilities(id);
    revalidatePath("/admin/building-utilities");
    revalidatePath("/admin/billing");
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting building utilities:", error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return {
        success: false,
        error: "Utility record not found for deletion.",
      };
    }
    return {
      success: false,
      error: error.message || "Failed to delete utility record.",
    };
  }
}
