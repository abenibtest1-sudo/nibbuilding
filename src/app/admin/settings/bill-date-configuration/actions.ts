"use server";

import { revalidatePath } from "next/cache";

import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { databaseService } from "@/lib/services/databaseService";
import { GENERIC_NEUTRAL_ERROR } from "@/lib/security/messages";
import { normalizeBillDateConfiguration } from "@/lib/billing-schedule";
import {
  getBillDateConfiguration,
  getBillDateConfigurationsForBuildings,
  saveBillDateConfiguration,
  syncAgreementNextPaymentDueDates,
} from "@/lib/application-settings";

export interface BillDateConfigurationBuildingOption {
  id: string;
  name: string;
  billDateConfiguration: number | null;
}

export async function getBillDateConfigurationAction() {
  try {
    const { isSuperAdmin, permissions, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;
    if (
      !isSuperAdmin &&
      !permissions.has("settings:application_settings:manage")
    ) {
      return {
        success: false,
        error: "Permission denied.",
        buildings: [] as BillDateConfigurationBuildingOption[],
      };
    }

    const buildings = await databaseService.getAllBuildings({
      where: canSeeAllBuildings
        ? undefined
        : hasAssignedBuildingScope
          ? { id: { in: managedBuildingIds } }
          : { createdById: currentUser.id },
      orderBy: { name: "asc" },
    });
    const billDateConfigurations = await getBillDateConfigurationsForBuildings(
      buildings.map((building) => building.id),
    );

    return {
      success: true,
      buildings: buildings.map((building) => ({
        id: building.id,
        name: building.name,
        billDateConfiguration: billDateConfigurations[building.id] ?? null,
      })),
    };
  } catch (error: any) {
    console.error("Error fetching bill date configuration:", error);
    return {
      success: false,
      error: GENERIC_NEUTRAL_ERROR,
      buildings: [] as BillDateConfigurationBuildingOption[],
    };
  }
}

export async function updateBillDateConfigurationAction(
  buildingId: string,
  rawBillDateConfiguration: number | null,
) {
  try {
    const { isSuperAdmin, permissions, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    if (
      !isSuperAdmin &&
      !permissions.has("settings:application_settings:manage")
    ) {
      return { success: false, error: "Permission denied." };
    }

    if (!buildingId) {
      return { success: false, error: "Please select a building." };
    }

    const building = await databaseService.getBuildingById(buildingId);
    if (
      !building ||
      (!canSeeAllBuildings && building.createdById !== currentUser.id)
    ) {
      return { success: false, error: "Building not found." };
    }

    const normalizedBillDateConfiguration =
      rawBillDateConfiguration === null
        ? null
        : normalizeBillDateConfiguration(rawBillDateConfiguration);

    if (
      rawBillDateConfiguration !== null &&
      normalizedBillDateConfiguration === null
    ) {
      return {
        success: false,
        error: "Bill date must be a whole number between 1 and 31.",
      };
    }

    await saveBillDateConfiguration(
      buildingId,
      normalizedBillDateConfiguration,
    );
    await syncAgreementNextPaymentDueDates(buildingId);

    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/bill-date-configuration");
    revalidatePath("/admin/agreements");
    revalidatePath("/admin/agreements/generate");
    revalidatePath("/admin/billing");

    return {
      success: true,
      message:
        normalizedBillDateConfiguration === null
          ? `Bill date configuration cleared for ${building.name}. The default 30-day billing cycle will now be used.`
          : `Bill date configuration saved successfully for ${building.name}.`,
      billDateConfiguration: await getBillDateConfiguration(buildingId),
      buildingId,
    };
  } catch (error: any) {
    console.error("Error updating bill date configuration:", error);
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
}
