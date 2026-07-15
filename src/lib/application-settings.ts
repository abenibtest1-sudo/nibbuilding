import "server-only";

import { prisma } from "@/lib/prisma";
import { databaseService } from "@/lib/services/databaseService";
import {
  calculateInitialNextBillingDate,
  calculateNextBillingDate,
  normalizeBillDateConfiguration,
} from "@/lib/billing-schedule";

const GLOBAL_BILL_DATE_CONFIGURATION_ID = "global";
const BUILDING_BILL_DATE_CONFIGURATION_PREFIX = "building:";

function getBuildingBillDateConfigurationId(buildingId: string) {
  return `${BUILDING_BILL_DATE_CONFIGURATION_PREFIX}${buildingId}`;
}

export async function getBillDateConfiguration(buildingId?: string | null) {
  const settingIds = buildingId
    ? [
        getBuildingBillDateConfigurationId(buildingId),
        GLOBAL_BILL_DATE_CONFIGURATION_ID,
      ]
    : [GLOBAL_BILL_DATE_CONFIGURATION_ID];
  const settings = await databaseService.getApplicationSettings(settingIds);
  const settingsById = new Map(
    settings.map((setting) => [setting.id, setting]),
  );

  if (buildingId) {
    const buildingSettingId = getBuildingBillDateConfigurationId(buildingId);
    if (settingsById.has(buildingSettingId)) {
      return normalizeBillDateConfiguration(
        settingsById.get(buildingSettingId)?.billDateConfiguration ?? null,
      );
    }
  }

  return normalizeBillDateConfiguration(
    settingsById.get(GLOBAL_BILL_DATE_CONFIGURATION_ID)
      ?.billDateConfiguration ?? null,
  );
}

export async function saveBillDateConfiguration(
  buildingId: string,
  billDateConfiguration: number | null,
) {
  const normalizedBillDateConfiguration = normalizeBillDateConfiguration(
    billDateConfiguration,
  );

  return databaseService.upsertApplicationSetting(
    getBuildingBillDateConfigurationId(buildingId),
    {
      billDateConfiguration: normalizedBillDateConfiguration,
    },
  );
}

export async function getBillDateConfigurationsForBuildings(
  buildingIds: string[],
) {
  const uniqueBuildingIds = Array.from(new Set(buildingIds.filter(Boolean)));

  if (uniqueBuildingIds.length === 0) {
    return {} as Record<string, number | null>;
  }

  const settingIds = [
    GLOBAL_BILL_DATE_CONFIGURATION_ID,
    ...uniqueBuildingIds.map(getBuildingBillDateConfigurationId),
  ];
  const settings = await databaseService.getApplicationSettings(settingIds);
  const settingsById = new Map(
    settings.map((setting) => [setting.id, setting]),
  );
  const globalBillDateConfiguration = normalizeBillDateConfiguration(
    settingsById.get(GLOBAL_BILL_DATE_CONFIGURATION_ID)
      ?.billDateConfiguration ?? null,
  );

  return Object.fromEntries(
    uniqueBuildingIds.map((buildingId) => {
      const buildingSettingId = getBuildingBillDateConfigurationId(buildingId);

      if (settingsById.has(buildingSettingId)) {
        return [
          buildingId,
          normalizeBillDateConfiguration(
            settingsById.get(buildingSettingId)?.billDateConfiguration ?? null,
          ),
        ];
      }

      return [buildingId, globalBillDateConfiguration];
    }),
  ) as Record<string, number | null>;
}

export async function syncAgreementNextPaymentDueDates(buildingId: string) {
  const billDateConfiguration = await getBillDateConfiguration(buildingId);
  const agreements = await prisma.agreement.findMany({
    where: {
      buildingId,
      status: { in: ["Pending", "Active", "Inactive"] },
    },
    select: {
      id: true,
      startDate: true,
      bills: {
        orderBy: { billDate: "desc" },
        take: 1,
        select: { billDate: true },
      },
    },
  });

  if (agreements.length === 0) {
    return;
  }

  await prisma.$transaction(
    agreements.map((agreement) => {
      const latestBillDate = agreement.bills[0]?.billDate ?? null;
      const nextPaymentDueDate = latestBillDate
        ? calculateNextBillingDate(latestBillDate, billDateConfiguration)
        : calculateInitialNextBillingDate(
            agreement.startDate,
            billDateConfiguration,
          );

      return prisma.agreement.update({
        where: { id: agreement.id },
        data: { nextPaymentDueDate },
      });
    }),
  );
}
