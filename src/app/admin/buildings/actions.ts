"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import { Prisma, type User, type Role, BuildingStatus } from "@prisma/client";
import { cookies } from "next/headers";
import { getUserAndPermissions } from "@/lib/actions/server-helpers";
import { prisma } from "@/lib/prisma";

export async function createBuildingAction(
  data: Omit<Prisma.BuildingCreateInput, "createdBy" | "approvedBy">,
) {
  try {
    const { currentUser, isSuperAdmin, permissions } =
      await getUserAndPermissions();
    if (!currentUser) {
      return { success: false, error: "User session not found." };
    }

    // A user who creates a building should automatically be a manager of it.
    // Additionally, when a non-super-admin Maker creates a building, we
    // auto-assign all users who have the "building:approve" permission
    // (the Checkers) as managers so they can approve/manage the building.
    const managerConnect: { id: string }[] = [{ id: currentUser.id }];

    if (!isSuperAdmin) {
      try {
        const approvers = await prisma.user.findMany({
          where: {
            roles: {
              some: {
                permissions: { has: "building:approve" },
              },
            },
          },
          select: { id: true },
        });
        for (const a of approvers) {
          if (a.id !== currentUser.id) managerConnect.push({ id: a.id });
        }
      } catch (err) {
        // If the lookup fails for any reason, fall back to assigning only the creator.
        console.error("Error fetching approvers for building assignment:", err);
      }
    }

    const buildingCreateInput: Prisma.BuildingCreateInput = {
      ...data,
      status: isSuperAdmin ? "Active" : "Pending", // Auto-approve for Super Admins
      createdBy: {
        connect: { id: currentUser.id },
      },
      managers: {
        connect: managerConnect,
      },
      ...(isSuperAdmin && { approvedBy: { connect: { id: currentUser.id } } }),
    };

    const newBuilding =
      await databaseService.createBuilding(buildingCreateInput);
    revalidatePath("/admin/buildings");
    return { success: true, building: newBuilding };
  } catch (error: any) {
    console.error("Error creating building:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = (error.meta?.target as string[]) || [];
        if (target.includes("name")) {
          return {
            success: false,
            error:
              "A building with this name already exists. Please use a unique name.",
          };
        }
        return {
          success: false,
          error:
            "A building with this name or other unique field already exists.",
        };
      }
    }
    return {
      success: false,
      error: error.message || "Failed to create building.",
    };
  }
}

export async function updateBuildingAction(
  id: string,
  data: Prisma.BuildingUpdateInput,
  managerIds?: string[],
) {
  try {
    // If the updater is the building's creator and has the "Create (Maker)" role,
    // we must not apply the edited data directly. Instead, create a ChangeRequest
    // containing the proposed changes, set the building to Pending, and clear
    // its approvedBy so an approver must review and apply the changes.
    const { currentUser, isSuperAdmin, permissions } =
      await getUserAndPermissions();
    try {
      const existing = await databaseService.getBuildingById(id, {
        createdBy: true,
      } as any);
      const isCreator = existing && existing.createdBy?.id === currentUser.id;
      const hasCreate =
        permissions.has("building:create") ||
        currentUser.roles?.some((r: any) => r.name === "Create (Maker)");
      const hasApprove =
        permissions.has("building:approve") ||
        currentUser.roles?.some((r: any) => r.name === "Approve (Checker)");

      // Maker-only creators (have create but NOT approve) must submit changes
      // as a ChangeRequest. This prevents them from directly editing any building.
      const isMakerOnly =
        isCreator && !isSuperAdmin && hasCreate && !hasApprove;

      if (existing && isMakerOnly) {
        // Build change request payload. Include the proposed `data` and any managerIds.
        const crPayload = {
          data: data as any,
          managerIds: managerIds ?? undefined,
        };

        // Create change request record
        const cr = await databaseService.createChangeRequest({
          resourceType: "Building",
          resourceId: id,
          payload: crPayload as any,
          requestedBy: { connect: { id: currentUser.id } },
        } as any);

        // Set building to Pending and disconnect approvedBy so approver must act.
        const pendingUpdate: Prisma.BuildingUpdateInput = {
          status: "Pending",
          approvedBy: { disconnect: true },
        } as any;

        // If managerIds not provided, auto-connect approvers as managers so they can approve.
        if (managerIds === undefined) {
          try {
            const approvers = await prisma.user.findMany({
              where: {
                roles: { some: { permissions: { has: "building:approve" } } },
              },
              select: { id: true },
            });
            const managerConnect: { id: string }[] = [{ id: currentUser.id }];
            for (const a of approvers) {
              if (a.id !== currentUser.id) managerConnect.push({ id: a.id });
            }
            pendingUpdate.managers = { connect: managerConnect } as any;
          } catch (err) {
            console.error(
              "Error fetching approvers for manager auto-connect:",
              err,
            );
          }
        }

        const updatedBuilding = await databaseService.updateBuilding(
          id,
          pendingUpdate,
        );
        revalidatePath("/admin/buildings");
        revalidatePath(`/admin/buildings/add-building?id=${id}`);
        revalidatePath("/admin/settings/user-management");
        return { success: true, changeRequest: cr, building: updatedBuilding };
      }
    } catch (err) {
      // lookup failed — fall through to normal update attempt
    }

    // Normal update path applies when the updater is not a creator-maker or when
    // the creator-maker rule does not apply.
    if (managerIds !== undefined) {
      data.managers = {
        set: managerIds.map((id) => ({ id })),
      };
    }

    const updatedBuilding = await databaseService.updateBuilding(id, data);
    revalidatePath("/admin/buildings");
    revalidatePath(`/admin/buildings/add-building?id=${id}`);
    revalidatePath("/admin/settings/user-management");
    return { success: true, building: updatedBuilding };
  } catch (error: any) {
    console.error("Error updating building:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return {
          success: false,
          error: "Failed to update building. Record not found.",
        };
      }
      if (error.code === "P2002") {
        const target = (error.meta?.target as string[]) || [];
        if (target.includes("name")) {
          return {
            success: false,
            error:
              "A building with this name already exists. Please use a unique name.",
          };
        }
        return {
          success: false,
          error: "This building's name conflicts with an existing building.",
        };
      }
    }
    return {
      success: false,
      error: error.message || "Failed to update building.",
    };
  }
}

export async function approveChangeRequestAction(changeRequestId: string) {
  try {
    const { permissions, isSuperAdmin, currentUser } =
      await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("building:approve")) {
      return { success: false, error: "Access Denied" };
    }

    const cr = await databaseService.getChangeRequestById(changeRequestId);
    if (!cr) return { success: false, error: "Change request not found." };
    if (cr.resourceType !== "Building")
      return { success: false, error: "Unsupported change request type." };

    const payload = cr.payload || {};
    const proposedData = payload.data || {};
    const managerIds: string[] | undefined = payload.managerIds;

    // Build a safe update payload for the building based on the stored CR payload.
    const updateData: any = { ...(proposedData as any) };
    if (managerIds !== undefined) {
      updateData.managers = { set: managerIds.map((id) => ({ id })) } as any;
    }
    updateData.status = "Active";
    updateData.approvedBy = { connect: { id: currentUser.id } } as any;
    updateData.rejectionReason = null;

    // Apply both the building update and CR status change in a single transaction
    // to ensure atomicity.
    const [updatedBuilding, updatedCR] = await prisma.$transaction([
      prisma.building.update({
        where: { id: cr.resourceId },
        data: updateData,
      }),
      prisma.changeRequest.update({
        where: { id: changeRequestId },
        data: {
          status: "Approved",
          reviewedBy: { connect: { id: currentUser.id } },
          reviewedAt: new Date(),
        },
      }),
    ]);

    revalidatePath("/admin/buildings");
    revalidatePath(`/admin/buildings/add-building?id=${cr.resourceId}`);

    return { success: true, building: updatedBuilding };
  } catch (error: any) {
    console.error("Error approving change request:", error);
    return {
      success: false,
      error: error.message || "Failed to approve change request.",
    };
  }
}

async function buildManagerLabelMap(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) {
    return {} as Record<string, string>;
  }

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true, name: true, email: true },
  });

  return users.reduce(
    (accumulator, user) => {
      accumulator[user.id] = user.name?.trim() || user.email;
      return accumulator;
    },
    {} as Record<string, string>,
  );
}

export async function getChangeRequestPreview(changeRequestId: string) {
  try {
    const { permissions, isSuperAdmin } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("building:approve")) {
      return { success: false, error: "Access Denied" };
    }

    const cr = await databaseService.getChangeRequestById(changeRequestId);
    if (!cr) return { success: false, error: "Change request not found." };
    if (cr.resourceType !== "Building")
      return { success: false, error: "Unsupported change request type." };

    const building = await databaseService.getBuildingById(cr.resourceId, {
      managers: true,
      penaltyPolicyTiers: true,
    } as any);

    const payload = cr.payload || {};
    const proposedData = payload.data || {};

    const diffs: Array<{ field: string; before: any; after: any }> = [];

    // Compare primitive/top-level fields
    const buildingObj = (building || {}) as any;
    const keys = new Set<string>([
      ...Object.keys(buildingObj).filter(
        (k) => k !== "managers" && k !== "penaltyPolicyTiers",
      ),
      ...Object.keys(proposedData),
    ]);

    for (const key of keys) {
      const before = buildingObj[key];
      const after = (proposedData as any)[key];
      if (typeof before === "undefined" && typeof after === "undefined")
        continue;
      // Simple deep-insensitive compare via JSON stringify
      try {
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          diffs.push({ field: key, before, after });
        }
      } catch (e) {
        if (before !== after) diffs.push({ field: key, before, after });
      }
    }

    // Managers difference (payload may carry managerIds separately)
    const beforeManagerIds = (building?.managers || []).map((m: any) => m.id);
    const afterManagerIds: string[] | undefined = payload.managerIds;
    const managerLabels = await buildManagerLabelMap([
      ...beforeManagerIds,
      ...(afterManagerIds || []),
    ]);
    if (typeof afterManagerIds !== "undefined") {
      const a = [...beforeManagerIds].sort();
      const b = [...afterManagerIds].slice().sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs.push({
          field: "managers",
          before: beforeManagerIds,
          after: afterManagerIds,
        });
      }
    }

    // Penalty tiers: show proposed create list vs existing
    const beforeTiers = (building as any)?.penaltyPolicyTiers || [];
    const afterTiersRaw = (proposedData as any)?.penaltyPolicyTiers;
    if (typeof afterTiersRaw !== "undefined") {
      let afterTiersNormalized: any[] = [];
      if (Array.isArray(afterTiersRaw)) {
        afterTiersNormalized = afterTiersRaw;
      } else if (afterTiersRaw && typeof afterTiersRaw === "object") {
        if (Array.isArray((afterTiersRaw as any).create)) {
          afterTiersNormalized = (afterTiersRaw as any).create;
        } else if (Array.isArray((afterTiersRaw as any).set)) {
          afterTiersNormalized = (afterTiersRaw as any).set;
        } else {
          afterTiersNormalized = [];
        }
      }
      if (
        JSON.stringify(beforeTiers) !== JSON.stringify(afterTiersNormalized)
      ) {
        diffs.push({
          field: "penaltyPolicyTiers",
          before: beforeTiers,
          after: afterTiersNormalized,
        });
      }
    }

    return { success: true, changeRequest: cr, building, diffs, managerLabels };
  } catch (error: any) {
    console.error("Error fetching change request preview:", error);
    return {
      success: false,
      error: error?.message || "Failed to fetch preview.",
    };
  }
}

export async function getChangeRequestPreviewForBuilding(buildingId: string) {
  try {
    const { permissions, isSuperAdmin } = await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("building:approve")) {
      return { success: false, error: "Access Denied" };
    }

    const list = await databaseService.listChangeRequests({
      where: {
        resourceType: "Building",
        resourceId: buildingId,
        status: "Pending",
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    } as any);
    const cr = list && list.length > 0 ? list[0] : null;

    const targetBuildingId = cr?.resourceId ?? buildingId;
    const building = await databaseService.getBuildingById(targetBuildingId, {
      managers: true,
      penaltyPolicyTiers: true,
    } as any);

    if (!building) {
      return { success: false, error: "Building not found." };
    }

    if (!cr) {
      if (building.status !== "Pending") {
        return { success: false, error: "Change request not found." };
      }

      const directPreviewFields = [
        "name",
        "address",
        "branchName",
        "ownerName",
        "ownerAddress",
        "ownerPhone",
        "ownerEmail",
        "accountNumber",
      ] as const;

      const diffs: Array<{ field: string; before: any; after: any }> = [];
      const proposedFlat: Record<string, any> = {};

      for (const field of directPreviewFields) {
        const value = (building as any)[field];
        if (value !== null && value !== undefined && value !== "") {
          proposedFlat[field] = value;
          diffs.push({ field, before: null, after: value });
        }
      }

      const managerIds = (building.managers || []).map(
        (manager: any) => manager.id,
      );
      const managerLabels = await buildManagerLabelMap(managerIds);
      proposedFlat.managers = managerIds;
      diffs.push({ field: "managers", before: [], after: managerIds });

      const penaltyPolicyTiers = (building as any).penaltyPolicyTiers || [];
      proposedFlat.penaltyPolicyTiers = penaltyPolicyTiers;
      diffs.push({
        field: "penaltyPolicyTiers",
        before: [],
        after: penaltyPolicyTiers,
      });

      return {
        success: true,
        changeRequest: null,
        building,
        diffs,
        managerLabels,
        proposed: proposedFlat,
        isDirectBuildingPreview: true,
      };
    }

    const payload = cr.payload || {};
    const proposedData = payload.data || {};

    const diffs: Array<{ field: string; before: any; after: any }> = [];

    // Flatten the proposed payload into a predictable shape that mirrors the
    // edit form fields so we can show every submitted value in the preview.
    const buildingObj = (building || {}) as any;
    const proposedFlat: any = {};

    const formFields = [
      "name",
      "address",
      "branchName",
      "ownerName",
      "ownerAddress",
      "ownerPhone",
      "ownerEmail",
      "accountNumber",
    ];

    for (const f of formFields) {
      if ((proposedData as any).hasOwnProperty(f)) {
        proposedFlat[f] = (proposedData as any)[f];
      }
    }

    // Normalize managers (may be provided as separate managerIds in payload)
    const beforeManagerIds = (building?.managers || []).map((m: any) => m.id);
    const afterManagerIds: string[] | undefined =
      payload.managerIds ??
      (proposedData as any)?.managers?.set?.map((m: any) => m.id);
    const managerLabels = await buildManagerLabelMap([
      ...beforeManagerIds,
      ...(afterManagerIds || []),
    ]);
    if (typeof afterManagerIds !== "undefined") {
      proposedFlat.managers = afterManagerIds;
    }

    // Normalize penalty tiers to an array of tier objects
    const beforeTiers = (building as any)?.penaltyPolicyTiers || [];
    const afterTiersRaw = (proposedData as any)?.penaltyPolicyTiers;
    let afterTiersNormalized: any[] | undefined = undefined;
    if (typeof afterTiersRaw !== "undefined") {
      if (Array.isArray(afterTiersRaw)) {
        afterTiersNormalized = afterTiersRaw;
      } else if (afterTiersRaw && typeof afterTiersRaw === "object") {
        if (Array.isArray((afterTiersRaw as any).create)) {
          afterTiersNormalized = (afterTiersRaw as any).create;
        } else if (Array.isArray((afterTiersRaw as any).set)) {
          afterTiersNormalized = (afterTiersRaw as any).set;
        } else {
          afterTiersNormalized = [];
        }
      } else {
        afterTiersNormalized = [];
      }
      proposedFlat.penaltyPolicyTiers = afterTiersNormalized;
    }

    // Build diffs for each submitted field so approvers see all changed values
    for (const key of Object.keys(proposedFlat)) {
      const before = key === "managers" ? beforeManagerIds : buildingObj[key];
      const after = proposedFlat[key];
      diffs.push({ field: key, before, after });
    }

    return {
      success: true,
      changeRequest: cr,
      building,
      diffs,
      managerLabels,
      proposed: proposedFlat,
      isDirectBuildingPreview: false,
    };
  } catch (error: any) {
    console.error("Error fetching change request preview for building:", error);
    return {
      success: false,
      error: error?.message || "Failed to fetch preview.",
    };
  }
}

export async function getMyChangeRequestForBuilding(buildingId: string) {
  try {
    const { currentUser, isSuperAdmin, permissions } =
      await getUserAndPermissions();

    const list = await databaseService.listChangeRequests({
      where: { resourceType: "Building", resourceId: buildingId },
      orderBy: { createdAt: "desc" },
      take: 1,
    } as any);
    const cr = list && list.length > 0 ? list[0] : null;
    if (!cr) return { success: false, error: "Change request not found." };

    if (
      !isSuperAdmin &&
      cr.requestedById !== currentUser.id &&
      !permissions.has("building:approve")
    ) {
      return { success: false, error: "Access Denied" };
    }

    return { success: true, changeRequest: cr };
  } catch (error: any) {
    console.error("Error fetching user's change request for building:", error);
    return {
      success: false,
      error: error?.message || "Failed to fetch change request.",
    };
  }
}

export async function rejectChangeRequestAction(
  changeRequestId: string,
  reason?: string,
) {
  try {
    const { permissions, isSuperAdmin, currentUser } =
      await getUserAndPermissions();
    if (!isSuperAdmin && !permissions.has("building:approve")) {
      return { success: false, error: "Access Denied" };
    }

    const cr = await databaseService.getChangeRequestById(changeRequestId);
    if (!cr) return { success: false, error: "Change request not found." };
    if (cr.resourceType !== "Building")
      return { success: false, error: "Unsupported change request type." };

    // Mark CR rejected and record reviewer + reason. Do NOT change the
    // building's status. Only the proposed changes are rejected; the
    // building remains in its current state. The rejectionReason is stored
    // on the ChangeRequest so the creator can view the justification.
    await databaseService.updateChangeRequest(changeRequestId, {
      status: "Rejected" as any,
      rejectionReason: reason as any,
      reviewedBy: { connect: { id: currentUser.id } } as any,
      reviewedAt: new Date() as any,
    } as any);

    // Revalidate relevant admin pages so UI reflects CR status change.
    revalidatePath("/admin/buildings");
    revalidatePath(`/admin/buildings/add-building?id=${cr.resourceId}`);

    return { success: true };
  } catch (error: any) {
    console.error("Error rejecting change request:", error);
    return {
      success: false,
      error: error.message || "Failed to reject change request.",
    };
  }
}

export async function toggleBuildingStatusAction(
  buildingId: string,
  newStatus: BuildingStatus,
  rejectionReason?: string,
) {
  try {
    const { permissions, isSuperAdmin, currentUser } =
      await getUserAndPermissions();
    if (newStatus === "Active" || newStatus === "Rejected") {
      if (
        !isSuperAdmin &&
        !permissions.has("building:approve") &&
        !permissions.has("building:status")
      ) {
        return { success: false, error: "Access Denied" };
      }
    }

    if (newStatus === "Inactive") {
      if (
        !isSuperAdmin &&
        !permissions.has("building:edit") &&
        !permissions.has("building:status")
      ) {
        return { success: false, error: "Access Denied" };
      }
      const buildingWithSpaces = await databaseService.getBuildingById(
        buildingId,
        { spaces: { where: { isOccupied: true }, take: 1 } },
      );
      if (buildingWithSpaces && buildingWithSpaces.spaces.length > 0) {
        return {
          success: false,
          error:
            "Cannot deactivate a building with occupied spaces. Please ensure all spaces are vacant first.",
        };
      }
    }

    const updateData: Prisma.BuildingUpdateInput = { status: newStatus };
    if (newStatus === "Active") {
      updateData.approvedBy = { connect: { id: currentUser.id } };
      updateData.rejectionReason = null;
    }
    if (newStatus === "Rejected") {
      updateData.rejectionReason = rejectionReason;
    }

    const updatedBuilding = await databaseService.updateBuilding(
      buildingId,
      updateData,
    );
    revalidatePath("/admin/buildings");
    return { success: true, building: updatedBuilding };
  } catch (error: any) {
    console.error(`Error changing building status for ${buildingId}:`, error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { success: false, error: "Building not found." };
    }
    return {
      success: false,
      error: `Failed to set building status to ${newStatus}.`,
    };
  }
}
