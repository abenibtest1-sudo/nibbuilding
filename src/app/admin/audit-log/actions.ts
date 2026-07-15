"use server";

import { databaseService } from "@/lib/services/databaseService";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import type { AuditLog, Prisma } from "@prisma/client";

export type SerializedAuditLog = Omit<
  AuditLog,
  | "createdAt"
  | "paymentDate"
  | "rentAmount"
  | "utilityAmount"
  | "penaltyAmount"
  | "totalAmount"
> & {
  createdAt: string;
  paymentDate: string;
  rentAmount: number;
  utilityAmount: number;
  penaltyAmount: number;
  totalAmount: number;
};

export async function getAuditLogDataAction(): Promise<SerializedAuditLog[]> {
  try {
    const { isSuperAdmin, managedBuildingIds, currentUser } =
      await getUserAndManagedIds();
    const canSeeAllBuildings =
      isSuperAdmin || !Array.isArray(managedBuildingIds);
    const hasAssignedBuildingScope =
      Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

    const whereClause: Prisma.AuditLogWhereInput = !canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? { buildingId: { in: managedBuildingIds } }
        : { actorId: currentUser.id }
      : {};

    const logs = await databaseService.getAllAuditLogs({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    // Serialize data before returning to the client
    return logs.map((log) => {
      const rentAmount = Number(log.rentAmount);
      const utilityAmount = Number(log.utilityAmount);
      const totalAmount = Number(log.totalAmount);
      const explicitPenalty =
        log.penaltyAmount !== null && log.penaltyAmount !== undefined
          ? Number(log.penaltyAmount)
          : null;
      const derivedPenalty = Math.max(
        0,
        totalAmount - rentAmount - utilityAmount,
      );

      return {
        ...log,
        createdAt: log.createdAt.toISOString(),
        paymentDate: log.paymentDate.toISOString(),
        rentAmount,
        utilityAmount,
        penaltyAmount:
          explicitPenalty !== null && explicitPenalty > 0
            ? explicitPenalty
            : derivedPenalty,
        totalAmount,
      };
    });
  } catch (error) {
    console.error("Error fetching audit log data:", error);
    return [];
  }
}
