export const dynamic = "force-dynamic";

import { databaseService } from "@/lib/services/databaseService";
import { prisma } from "@/lib/prisma";
import type {
  Building as BuildingTypePrisma,
  PenaltyTier as PenaltyTierTypePrisma,
  User,
  Role,
  Prisma,
  BuildingStatus,
} from "@prisma/client";
import { BuildingsClientPage } from "./components"; // Import the new client component
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";

export interface BuildingWithRelations extends BuildingTypePrisma {
  penaltyPolicyTiers: PenaltyTierTypePrisma[];
  createdBy: User | null;
  approvedBy: User | null;
}

// This is now a Server Component fetching its own data.
export default async function BuildingsPage() {
  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);
  const hasAssignedBuildingScope =
    Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

  // Super admins and delegated all-building users see all buildings.
  // Building-assigned users see those buildings; otherwise fall back to
  // buildings they created.
  const whereClause: Prisma.BuildingWhereInput = canSeeAllBuildings
    ? {}
    : hasAssignedBuildingScope
      ? { id: { in: managedBuildingIds } }
      : { createdById: currentUser.id };

  const buildingsData = (await databaseService.getAllBuildings({
    where: whereClause,
    include: {
      penaltyPolicyTiers: true,
      createdBy: true,
      approvedBy: true,
    },
    orderBy: { createdAt: "desc" },
  })) as BuildingWithRelations[];

  const serializableBuildings = buildingsData.map((building) => ({
    ...building,
    createdAt: building.createdAt.toISOString(),
    penaltyPolicyTiers: building.penaltyPolicyTiers.map((tier) => ({
      ...tier,
      feeValue: Number(tier.feeValue),
    })),
  }));

  // Enrich each building with aggregated stats used by exports/UI
  const enrichedPromises = buildingsData.map(async (building) => {
    const [
      totalAreaRes,
      occupiedAreaRes,
      totalSpaces,
      occupiedSpacesCount,
      totalTenants,
      activeTenants,
      totalAgreements,
      activeAgreements,
    ] = await Promise.all([
      prisma.space.aggregate({
        _sum: { area: true },
        where: { buildingId: building.id },
      }),
      prisma.space.aggregate({
        _sum: { area: true },
        where: { buildingId: building.id, isOccupied: true },
      }),
      prisma.space.count({ where: { buildingId: building.id } }),
      prisma.space.count({
        where: { buildingId: building.id, isOccupied: true },
      }),
      prisma.tenant.count({ where: { buildingId: building.id } }),
      prisma.tenant.count({
        where: {
          agreements: {
            some: { space: { buildingId: building.id }, status: "Active" },
          },
        },
      }),
      prisma.agreement.count({ where: { space: { buildingId: building.id } } }),
      prisma.agreement.count({
        where: { space: { buildingId: building.id }, status: "Active" },
      }),
    ]);

    return {
      ...building,
      totalAreaSum: Number(totalAreaRes._sum.area ?? 0),
      occupiedAreaSum: Number(occupiedAreaRes._sum.area ?? 0),
      totalSpacesCount: totalSpaces,
      occupiedSpacesCount: occupiedSpacesCount,
      availableSpacesCount: Math.max(0, totalSpaces - occupiedSpacesCount),
      totalTenantsCount: totalTenants,
      activeTenantsCount: activeTenants,
      totalAgreementsCount: totalAgreements,
      activeAgreementsCount: activeAgreements,
    } as any;
  });

  const enrichedBuildingsData = await Promise.all(enrichedPromises);

  const serializableEnrichedBuildings = enrichedBuildingsData.map(
    (building) => ({
      ...building,
      createdAt: building.createdAt.toISOString(),
      updatedAt: building.updatedAt?.toISOString() || new Date().toISOString(),
      penaltyPolicyTiers:
        (building as any).penaltyPolicyTiers?.map((tier: any) => ({
          ...tier,
          feeValue: Number(tier.feeValue),
        })) || [],
    }),
  );

  return (
    <BuildingsClientPage initialBuildings={serializableEnrichedBuildings} />
  );
}
