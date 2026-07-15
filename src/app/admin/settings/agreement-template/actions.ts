"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import {
  getUserAndManagedIds,
  getUserAndPermissions,
} from "@/lib/actions/server-helpers";
import { AgreementTemplate, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function getAllAgreementTemplatesAction(): Promise<{
  success: boolean;
  templates?: AgreementTemplate[];
  error?: string;
}> {
  try {
    const { currentUser, isSuperAdmin, managedBuildingIds } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

    // For non-superadmins allow templates that were created by the current
    // user or are tied to buildings they manage. This ensures creators can
    // see templates they created even if they didn't attach them to a
    // managed building at creation time.
    const where: Prisma.AgreementTemplateWhereInput = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? {
            OR: [
              { createdById: currentUser.id },
              { buildingId: { in: managedBuildingIds } },
            ],
          }
        : { createdById: currentUser.id };

    const templates = await databaseService.getAllAgreementTemplates({
      where,
      orderBy: { name: "asc" },
    });
    return { success: true, templates };
  } catch (error: any) {
    console.error("Error fetching agreement templates:", error);
    return {
      success: false,
      error: "Failed to fetch templates from the database.",
    };
  }
}

export async function getAgreementTemplateByIdAction(id: string): Promise<{
  success: boolean;
  template?: AgreementTemplate | null;
  error?: string;
}> {
  try {
    await getUserAndManagedIds();
    const template = await databaseService.getAgreementTemplateById(id);
    return { success: true, template };
  } catch (error: any) {
    console.error(`Error fetching agreement template with id ${id}:`, error);
    return { success: false, error: `Failed to fetch template with id ${id}.` };
  }
}

export async function upsertAgreementTemplateAction(data: {
  id?: string;
  name: string;
  content: string;
  buildingId?: string | null;
}): Promise<{
  success: boolean;
  template?: AgreementTemplate;
  error?: string;
}> {
  try {
    // Use managed IDs helper so we know the caller's managed buildings
    const { currentUser, isSuperAdmin, permissions, managedBuildingIds } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;
    if (
      !isSuperAdmin &&
      !permissions.has("settings:agreement_templates:manage")
    ) {
      return { success: false, error: "Access Denied" };
    }

    if (data.buildingId) {
      const accessibleBuilding = await databaseService.getBuildingById(
        data.buildingId,
      );
      if (
        !accessibleBuilding ||
        (!canSeeAllBuildings &&
          (hasAssignedBuildingScope
            ? !managedBuildingIds.includes(accessibleBuilding.id)
            : accessibleBuilding.createdById !== currentUser.id))
      ) {
        return { success: false, error: "Permission denied." };
      }
    }

    const createData: Prisma.AgreementTemplateCreateInput = {
      name: data.name,
      content: data.content,
      createdBy: { connect: { id: currentUser.id } },
      building: data.buildingId
        ? { connect: { id: data.buildingId } }
        : undefined,
    };

    const updateData: Prisma.AgreementTemplateUpdateInput = {
      name: data.name,
      content: data.content,
      building: data.buildingId
        ? { connect: { id: data.buildingId } }
        : undefined,
    };

    if (data.id) {
      // Update
      await databaseService.updateAgreementTemplate(data.id, updateData);
      revalidatePath("/admin/settings/agreement-template");
    } else {
      // Create
      await databaseService.createAgreementTemplate(createData);
      revalidatePath("/admin/settings/agreement-template");
    }
  } catch (error: any) {
    console.error("Error upserting agreement template:", error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: `A template with the name "${data.name}" already exists.`,
      };
    }
    return { success: false, error: "Failed to save the template." };
  }

  // Redirect after successful operation
  redirect("/admin/settings/agreement-template");
}

export async function deleteAgreementTemplateAction(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { isSuperAdmin, permissions } = await getUserAndPermissions();
    if (
      !isSuperAdmin &&
      !permissions.has("settings:agreement_templates:manage")
    ) {
      return { success: false, error: "Access Denied" };
    }

    // Check if the template is used in any agreements
    const agreementCount = await prisma.agreement.count({
      where: { agreementTemplateId: id },
    });

    if (agreementCount > 0) {
      return {
        success: false,
        error: `Cannot delete template. It is currently in use by ${agreementCount} agreement(s).`,
      };
    }

    await databaseService.deleteAgreementTemplate(id);
    revalidatePath("/admin/agreements/generate");
    revalidatePath("/admin/settings/agreement-template");
    return { success: true };
  } catch (error: any) {
    console.error(`Error deleting agreement template with id ${id}:`, error);
    return {
      success: false,
      error: `Failed to delete template with id ${id}.`,
    };
  }
}
