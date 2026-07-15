export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import { FileText, Loader2 } from "lucide-react";
import { databaseService } from "@/lib/services/databaseService";
import type {
  Agreement as AgreementPrisma,
  Tenant,
  Space,
  User,
  Role,
  Prisma,
  AgreementStatus,
} from "@prisma/client";
import {
  AgreementsListClientPage,
  type AgreementWithRelations,
} from "./components"; // Import from new components file
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";

// This is now a Server Component
export default async function AgreementsListPage() {
  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);
  const hasAssignedBuildingScope =
    Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

  const whereClause: Prisma.AgreementWhereInput = canSeeAllBuildings
    ? {}
    : hasAssignedBuildingScope
      ? {
          OR: [
            { buildingId: { in: managedBuildingIds } },
            { space: { buildingId: { in: managedBuildingIds } } },
          ],
        }
      : { createdById: currentUser.id };

  const agreementsData = await databaseService.getAllAgreements({
    where: whereClause,
    include: {
      tenant: true,
      space: true,
      approvedBy: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const serializableAgreements = agreementsData.map((ag) => ({
    ...ag,
    monthlyRentalPrice: Number(ag.monthlyRentalPrice),
    initialPaymentAmount: ag.initialPaymentAmount
      ? Number(ag.initialPaymentAmount)
      : null,
    startDate: ag.startDate.toISOString(),
    nextPaymentDueDate: ag.nextPaymentDueDate.toISOString(),
    createdAt: ag.createdAt.toISOString(),
    updatedAt: ag.updatedAt?.toISOString() || ag.createdAt.toISOString(), // Safe serialization
    approvedBy: ag.approvedBy
      ? { id: ag.approvedBy.id, name: ag.approvedBy.name }
      : null,
    createdBy: ag.createdBy
      ? { id: ag.createdBy.id, name: ag.createdBy.name }
      : null,
    initialPaymentDate: ag.initialPaymentDate?.toISOString() || undefined,
    tenant: ag.tenant
      ? {
          ...ag.tenant,
          createdAt: ag.tenant.createdAt.toISOString(),
          updatedAt:
            ag.tenant.updatedAt?.toISOString() ||
            ag.tenant.createdAt.toISOString(), // Safe serialization
        }
      : null,
    space: ag.space
      ? {
          ...ag.space,
          area: Number(ag.space.area),
          utilityProrationShare: Number(ag.space.utilityProrationShare),
          monthlyRentalPrice: Number(ag.space.monthlyRentalPrice),
          createdAt: ag.space.createdAt.toISOString(),
          updatedAt:
            ag.space.updatedAt?.toISOString() ||
            ag.space.createdAt.toISOString(), // Safe serialization
        }
      : null,
  })) as AgreementWithRelations[];

  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-screen">
          <Loader2 className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      }
    >
      <AgreementsListClientPage initialAgreements={serializableAgreements} />
    </Suspense>
  );
}
