export const dynamic = "force-dynamic";

// Main form interaction is client-side, but data fetching for props is server-side.

import { Suspense } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { databaseService } from "@/lib/services/databaseService";
import type {
  Tenant,
  Space,
  Prisma,
  User,
  Role,
  AgreementTemplate,
} from "@prisma/client"; // For server-side fetching
import { GenerateAgreementClientPage } from "./client-page"; // Import the new client component
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { getBillDateConfigurationsForBuildings } from "@/lib/application-settings";

// This is an async Server Component responsible for fetching data
async function GenerateAgreementDataFetcher() {
  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);
  const hasAssignedBuildingScope =
    Array.isArray(managedBuildingIds) && managedBuildingIds.length > 0;

  // For generating agreements, limit visible tenants for non-superadmins
  // to tenants that either were created by the current user, whose
  // rented space belongs to one of the buildings the user manages, or
  // who have agreements for spaces in the buildings the user manages.
  const tenantWhereClause: Prisma.TenantWhereInput = canSeeAllBuildings
    ? {}
    : hasAssignedBuildingScope
      ? {
          OR: [
            { createdById: currentUser.id },
            { buildingId: { in: managedBuildingIds } },
            { rentedSpace: { is: { buildingId: { in: managedBuildingIds } } } },
            {
              agreements: {
                some: {
                  OR: [
                    { buildingId: { in: managedBuildingIds } },
                    { space: { buildingId: { in: managedBuildingIds } } },
                  ],
                },
              },
            },
            {
              buildingStatuses: {
                some: { buildingId: { in: managedBuildingIds } },
              },
            },
          ],
        }
      : { createdById: currentUser.id };

  const spaceWhereClause: Prisma.SpaceWhereInput = {
    isOccupied: false,
    ...(!canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? { buildingId: { in: managedBuildingIds } }
        : { createdById: currentUser.id }
      : {}),
  };

  // Strict scoping: for non-superadmins only allow templates that are
  // explicitly tied to one of the buildings the user manages. If the user
  // does not manage any buildings, they will receive an empty list.
  const agreementTemplateWhere: Prisma.AgreementTemplateWhereInput =
    !canSeeAllBuildings
      ? hasAssignedBuildingScope
        ? {
            OR: [
              { createdById: currentUser.id },
              { buildingId: { in: managedBuildingIds } },
            ],
          }
        : { createdById: currentUser.id }
      : {};

  const tenants = await databaseService.getAllTenants({
    where: tenantWhereClause,
    orderBy: { name: "asc" },
    include: {
      rentedSpace: true,
      agreements: { include: { space: true } },
      buildingStatuses: true,
    },
  });
  const availableSpaces = await databaseService.getAllSpaces({
    where: spaceWhereClause,
    orderBy: [{ buildingName: "asc" }, { spaceIdName: "asc" }],
  });
  const agreementTemplates = await databaseService.getAllAgreementTemplates({
    where: agreementTemplateWhere,
    orderBy: { name: "asc" },
  });

  // Serialize dates and Decimal fields before passing to client component
  const serializableTenants = (tenants as any).map((t: any) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt?.toISOString() || t.createdAt.toISOString(), // Fallback for updatedAt
    rentedSpace: t.rentedSpace
      ? {
          ...t.rentedSpace,
          area: Number(t.rentedSpace.area),
          utilityProrationShare: Number(t.rentedSpace.utilityProrationShare),
          monthlyRentalPrice: Number(t.rentedSpace.monthlyRentalPrice),
          createdAt: t.rentedSpace.createdAt.toISOString(),
          updatedAt:
            t.rentedSpace.updatedAt?.toISOString() ||
            t.rentedSpace.createdAt.toISOString(),
        }
      : null,
    agreements: t.agreements
      ? (t.agreements as any[]).map((ag: any) => ({
          ...ag,
          monthlyRentalPrice: Number(ag.monthlyRentalPrice),
          initialPaymentAmount: ag.initialPaymentAmount
            ? Number(ag.initialPaymentAmount)
            : null,
          startDate: ag.startDate?.toISOString() || null,
          endDate: ag.endDate?.toISOString() || null,
          nextPaymentDueDate: ag.nextPaymentDueDate?.toISOString() || null,
          createdAt: ag.createdAt?.toISOString() || null,
          updatedAt:
            ag.updatedAt?.toISOString() || ag.createdAt?.toISOString() || null,
          initialPaymentDate: ag.initialPaymentDate?.toISOString() || null,
          space: ag.space
            ? {
                ...ag.space,
                area: Number(ag.space.area),
                utilityProrationShare: Number(ag.space.utilityProrationShare),
                monthlyRentalPrice: Number(ag.space.monthlyRentalPrice),
                createdAt: ag.space.createdAt?.toISOString() || null,
                updatedAt:
                  ag.space.updatedAt?.toISOString() ||
                  ag.space.createdAt?.toISOString() ||
                  null,
              }
            : null,
        }))
      : [],
  }));
  const serializableSpaces = availableSpaces.map((s) => ({
    ...s,
    area: Number(s.area),
    utilityProrationShare: Number(s.utilityProrationShare),
    monthlyRentalPrice: Number(s.monthlyRentalPrice),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt?.toISOString() || s.createdAt.toISOString(), // Fallback for updatedAt
  }));
  const billDateConfigurationByBuilding =
    await getBillDateConfigurationsForBuildings(
      availableSpaces.map((space) => space.buildingId),
    );

  const visibleBuildingIds = canSeeAllBuildings
    ? undefined
    : Array.from(new Set(availableSpaces.map((space) => space.buildingId)));

  return (
    <GenerateAgreementClientPage
      tenants={serializableTenants}
      availableSpaces={serializableSpaces}
      agreementTemplates={agreementTemplates}
      billDateConfigurationByBuilding={billDateConfigurationByBuilding}
      managedBuildingIds={visibleBuildingIds}
      currentBuildingId={
        visibleBuildingIds && visibleBuildingIds.length > 0
          ? visibleBuildingIds[0]
          : undefined
      }
    />
  );
}

// Server Component to fetch initial data
export default function GenerateAgreementPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Generate Rental Agreement"
        description="Select a template, tenant, and space, then generate and save the complete record."
        actions={
          <Link href="/admin/agreements" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Agreements
            </Button>
          </Link>
        }
      />
      <Suspense
        fallback={
          <div className="flex justify-center items-center h-[50vh]">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </div>
        }
      >
        <GenerateAgreementDataFetcher />
      </Suspense>
    </div>
  );
}
