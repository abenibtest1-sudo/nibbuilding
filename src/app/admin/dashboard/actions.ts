"use server";

import { databaseService } from "@/lib/services/databaseService";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { getMonth, getYear, isAfter, addMonths } from "date-fns";
import type { Prisma, Building, Space, Agreement, Bill } from "@prisma/client";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// Define the types that will be serialized and sent to the client.
// This helps ensure data consistency and avoids sending oversized objects.
export interface ClientBuilding {
  id: string;
  name: string;
}

export interface ClientSpace {
  id: string;
  buildingId: string;
  isOccupied: boolean;
  area: number;
}

export interface ClientAgreement {
  id: string;
  tenantId: string;
  spaceId: string | null;
  startDate: string; // ISO string
  paymentTermMonths: number;
  tenant: { name: string } | null;
  space: { spaceIdName: string } | null;
  status?: string | null;
}

export interface ClientBill {
  agreementId: string;
  status: string;
  totalAmount: number;
  paymentDate: string | null; // ISO string
  billDate: string; // ISO string
}

export interface ClientUtility {
  buildingId: string;
  year: number;
  month: number;
  totalCost: number;
}

export interface ClientTenantMessage {
  id: string;
  tenantName: string;
  subject: string | null;
  body: string;
  createdAt: string; // ISO string
  readAt: string | null; // ISO string
}

export interface DashboardData {
  buildings: ClientBuilding[];
  spaces: ClientSpace[];
  agreements: ClientAgreement[];
  allBills: ClientBill[];
  allUtilities: ClientUtility[];
  tenantMessages: ClientTenantMessage[];
  error: string | null;
}

// This is the actual data-fetching function, kept private to this file.
export async function getDashboardDataAction(): Promise<DashboardData> {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

    const buildingWhere = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? { id: { in: managedBuildingIds } }
        : { createdById: currentUser.id };
    const spaceWhere = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? { buildingId: { in: managedBuildingIds } }
        : { createdById: currentUser.id };
    const agreementWhere = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? {
            OR: [
              { buildingId: { in: managedBuildingIds } },
              { space: { buildingId: { in: managedBuildingIds } } },
            ],
          }
        : { createdById: currentUser.id };
    const billWhere = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? {
            OR: [
              { agreement: { buildingId: { in: managedBuildingIds } } },
              {
                agreement: {
                  space: { buildingId: { in: managedBuildingIds } },
                },
              },
              { tenant: { buildingId: { in: managedBuildingIds } } },
            ],
          }
        : { agreement: { createdById: currentUser.id } };
    const utilitiesWhere = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? { buildingId: { in: managedBuildingIds } }
        : { createdById: currentUser.id };

    const tenantMessagesWhere = canSeeAllBuildings
      ? {}
      : hasAssignedBuildingScope
        ? { buildingId: { in: managedBuildingIds } }
        : { building: { createdById: currentUser.id } };

    const [
      buildingsData,
      spacesData,
      agreementsData,
      allBillsData,
      allUtilitiesRaw,
      tenantMessagesRaw,
    ] = await Promise.all([
      databaseService.getAllBuildings({
        where: buildingWhere,
        select: { id: true, name: true },
      }),
      databaseService.getAllSpaces({
        where: spaceWhere,
        select: { id: true, buildingId: true, isOccupied: true, area: true },
      }),
      databaseService.getAllAgreements({
        where: agreementWhere,
        select: {
          id: true,
          tenantId: true,
          spaceId: true,
          startDate: true,
          paymentTermMonths: true,
          status: true,
          tenant: { select: { name: true, status: true } },
          space: { select: { spaceIdName: true } },
        },
      }),
      databaseService.getAllBills({
        where: billWhere,
        select: {
          agreementId: true,
          status: true,
          totalAmount: true,
          paymentDate: true,
          billDate: true,
        },
      }),
      databaseService.getAllBuildingMonthlyUtilities({
        where: utilitiesWhere,
        include: { utilities: true },
      }),
      (prisma as any).tenantMessage.findMany({
        where: tenantMessagesWhere,
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          subject: true,
          body: true,
          createdAt: true,
          readAt: true,
          tenant: { select: { name: true } },
        },
      }),
    ]);

    const allUtilities = allUtilitiesRaw.map((u) => ({
      buildingId: u.buildingId,
      year: u.year,
      month: u.month,
      totalCost: Number(
        u.utilities.reduce((sum, item) => sum + Number(item.totalCost), 0),
      ),
    }));

    // Serialize dates for client components
    const agreements = agreementsData.map((a) => ({
      ...a,
      startDate: a.startDate.toISOString(),
      status: a.status,
    }));

    const allBills = allBillsData.map((b) => ({
      ...b,
      totalAmount: Number(b.totalAmount),
      billDate: b.billDate.toISOString(),
      paymentDate: b.paymentDate?.toISOString() || null,
    }));

    const spaces = spacesData.map((s) => ({
      ...s,
      area: Number(s.area),
    }));

    const tenantMessages = tenantMessagesRaw.map((m) => ({
      id: m.id,
      tenantName: m.tenant.name,
      subject: m.subject ?? null,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
    }));

    return {
      buildings: buildingsData,
      spaces,
      agreements,
      allBills,
      allUtilities,
      tenantMessages,
      error: null,
    };
  } catch (e) {
    console.error("Error fetching dashboard data:", e);
    return {
      buildings: [],
      spaces: [],
      agreements: [],
      allBills: [],
      allUtilities: [],
      tenantMessages: [],
      error: "Failed to load dashboard data.",
    };
  }
}

export async function markTenantMessageReadAction(
  messageId: string,
): Promise<{ success: boolean; error?: string; readAt?: string }> {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);

    const message = await (prisma as any).tenantMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        buildingId: true,
        readAt: true,
        building: { select: { createdById: true } },
      },
    });

    if (!message) {
      return { success: false, error: "Message not found." };
    }

    if (
      !canSeeAllBuildings &&
      message.building?.createdById !== currentUser.id
    ) {
      return { success: false, error: "Access denied." };
    }

    const readAt = message.readAt ?? new Date();

    await (prisma as any).tenantMessage.update({
      where: { id: messageId },
      data: { readAt },
    });

    return { success: true, readAt: readAt.toISOString() };
  } catch (e) {
    console.error("Error marking tenant message as read:", e);
    return { success: false, error: "Failed to mark as read." };
  }
}
