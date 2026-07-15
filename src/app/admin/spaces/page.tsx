export const dynamic = "force-dynamic";

import { databaseService } from "@/lib/services/databaseService";
import type {
  Space as SpaceTypePrisma,
  Building as BuildingTypePrisma,
  Prisma,
  User,
  Role,
  AgreementStatus,
} from "@prisma/client";
import { SpacesClientPage, type SpaceWithBuildingName } from "./components";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { addMonths, isAfter } from "date-fns";
import { prisma } from "@/lib/prisma";
import { toUtcStartOfDay, isAfterUtcDay } from "@/lib/utils";

type SpaceWithRelations = Prisma.SpaceGetPayload<{
  include: {
    building: true;
    agreements: true;
    createdBy: true;
  };
}>;

// This is the main Server Component for the page
export default async function SpacesPage() {
  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);
  const hasAssignedBuildingScope =
    Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

  // --- Automatic Space Vacating Logic ---
  // This logic now runs first to prevent race conditions.
  const today = toUtcStartOfDay(new Date());
  // Find agreements that are now expired but their spaces are still marked as occupied.
  const expiredAgreementsOnOccupiedSpaces = await prisma.agreement.findMany({
    where: {
      status: { notIn: ["Canceled", "Rejected"] }, // Exclude canceled/rejected agreements from this check
      space: {
        isOccupied: true,
        ...(!canSeeAllBuildings
          ? hasAssignedBuildingScope
            ? { buildingId: { in: managedBuildingIds } }
            : { createdById: currentUser.id }
          : {}),
      },
    },
    select: {
      id: true,
      startDate: true,
      paymentTermMonths: true,
      spaceId: true,
      tenantId: true, // Fetch tenantId to disconnect it
    },
  });

  const relationsToUpdate: { spaceId: string; tenantId: string }[] = [];
  for (const agreement of expiredAgreementsOnOccupiedSpaces) {
    if (agreement.spaceId && agreement.tenantId) {
      const agreementEndDate = addMonths(
        agreement.startDate,
        agreement.paymentTermMonths,
      );
      if (isAfterUtcDay(today, agreementEndDate)) {
        relationsToUpdate.push({
          spaceId: agreement.spaceId,
          tenantId: agreement.tenantId,
        });
      }
    }
  }

  // If we found any spaces to vacate, update them in a batch transaction.
  if (relationsToUpdate.length > 0) {
    const spaceIdsToVacate = [
      ...new Set(relationsToUpdate.map((r) => r.spaceId)),
    ];
    const tenantIdsToUpdate = [
      ...new Set(relationsToUpdate.map((r) => r.tenantId)),
    ];

    try {
      await prisma.$transaction([
        // Set the space as not occupied
        prisma.space.updateMany({
          where: { id: { in: spaceIdsToVacate } },
          data: { isOccupied: false },
        }),
        // Disconnect the tenant from their rented space
        prisma.tenant.updateMany({
          where: {
            id: { in: tenantIdsToUpdate },
            rentedSpaceId: { in: spaceIdsToVacate },
          },
          data: { rentedSpaceId: null },
        }),
      ]);
    } catch (e) {
      console.error("Error during automatic space vacating transaction:", e);
      // Log the error but don't block page render.
    }
  }
  // --- End Automatic Logic ---

  const spaceWhere: Prisma.SpaceWhereInput = canSeeAllBuildings
    ? {}
    : hasAssignedBuildingScope
      ? { buildingId: { in: managedBuildingIds } }
      : { createdById: currentUser.id };
  const buildingWhere: Prisma.BuildingWhereInput = canSeeAllBuildings
    ? {}
    : hasAssignedBuildingScope
      ? { id: { in: managedBuildingIds } }
      : { createdById: currentUser.id };

  const spacesData = (await databaseService.getAllSpaces({
    where: spaceWhere,
    include: {
      building: true,
      agreements: true,
      createdBy: true,
    },
    orderBy: { createdAt: "desc" },
  })) as SpaceWithRelations[];
  const buildingsData = await databaseService.getAllBuildings({
    where: buildingWhere,
    orderBy: { name: "asc" },
  });

  // Serialize dates and structure data for the client component
  const serializableSpaces = spacesData.map((space) => {
    let availabilityDate: string | null = null;
    if (space.isOccupied && space.agreements.length > 0) {
      const activeAgreements = space.agreements
        .filter(
          (ag) =>
            ag.status === "Active" &&
            isAfter(addMonths(ag.startDate, ag.paymentTermMonths), new Date()),
        )
        .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

      if (activeAgreements.length > 0) {
        const endDate = addMonths(
          activeAgreements[0].startDate,
          activeAgreements[0].paymentTermMonths,
        );
        availabilityDate = endDate.toISOString();
      }
    }

    return {
      ...space,
      area: Number(space.area),
      utilityProrationShare: Number(space.utilityProrationShare),
      monthlyRentalPrice: Number(space.monthlyRentalPrice),
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt?.toISOString() || new Date().toISOString(),
      buildingName: space.building.name,
      createdBy: space.createdBy
        ? { id: space.createdBy.id, name: space.createdBy.name }
        : null,
      availabilityDate,
      agreements: space.agreements.map((ag) => ({
        ...ag,
        monthlyRentalPrice: Number(ag.monthlyRentalPrice),
        initialPaymentAmount: ag.initialPaymentAmount
          ? Number(ag.initialPaymentAmount)
          : null,
      })),
    };
  }) as unknown as SpaceWithBuildingName[];

  const serializableBuildings = buildingsData.map((building) => ({
    ...building,
    createdAt: building.createdAt.toISOString(),
    updatedAt: building.updatedAt?.toISOString() || new Date().toISOString(),
    penaltyPolicyTiers: (building as any).penaltyPolicyTiers || [],
  })) as unknown as BuildingTypePrisma[];

  return (
    <SpacesClientPage
      initialSpaces={serializableSpaces}
      initialBuildings={serializableBuildings}
    />
  );
}
