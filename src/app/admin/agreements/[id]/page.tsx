export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { databaseService } from "@/lib/services/databaseService";
import {
  ViewAgreementClientPage,
  type AgreementWithRelations,
} from "./client-page";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";
import { redirect } from "next/navigation";

// Server Component to fetch initial data
export default async function ViewAgreementPage({
  params,
}: {
  params: Promise<{ id?: string | string[] }>;
}) {
  const resolvedParams = await params;
  const rawId = resolvedParams?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) {
    redirect("/admin/agreements?error=Invalid%20agreement%20link");
  }

  const { isSuperAdmin, managedBuildingIds, currentUser } =
    await getUserAndManagedIds();
  const canSeeAllBuildings = isSuperAdmin || !Array.isArray(managedBuildingIds);

  let agreementData = await databaseService.getAgreementById(id, {
    tenant: true,
    space: true,
  });

  if (agreementData && !canSeeAllBuildings) {
    if (agreementData.createdById !== currentUser.id) {
      redirect(
        "/admin/agreements?error=" + encodeURIComponent("Access Denied"),
      );
    }
  }

  let serializableAgreement: AgreementWithRelations | null = null;
  if (agreementData) {
    const fallbackDate = new Date(0).toISOString();
    serializableAgreement = {
      ...agreementData,
      monthlyRentalPrice: Number(agreementData.monthlyRentalPrice),
      initialPaymentAmount: agreementData.initialPaymentAmount
        ? Number(agreementData.initialPaymentAmount)
        : null,
      startDate: agreementData.startDate?.toISOString() || fallbackDate,
      nextPaymentDueDate:
        agreementData.nextPaymentDueDate?.toISOString() || fallbackDate,
      createdAt: agreementData.createdAt?.toISOString() || fallbackDate,
      updatedAt:
        agreementData.updatedAt?.toISOString() ||
        agreementData.createdAt?.toISOString() ||
        fallbackDate,
      initialPaymentDate:
        agreementData.initialPaymentDate?.toISOString() || undefined,
      tenant: agreementData.tenant
        ? {
            ...agreementData.tenant,
            createdAt:
              agreementData.tenant.createdAt?.toISOString() || fallbackDate,
            updatedAt:
              agreementData.tenant.updatedAt?.toISOString() ||
              agreementData.tenant.createdAt?.toISOString() ||
              fallbackDate,
          }
        : null,
      space: agreementData.space
        ? {
            ...agreementData.space,
            area: Number(agreementData.space.area),
            utilityProrationShare: Number(
              agreementData.space.utilityProrationShare,
            ),
            monthlyRentalPrice: Number(agreementData.space.monthlyRentalPrice),
            createdAt:
              agreementData.space.createdAt?.toISOString() || fallbackDate,
            updatedAt:
              agreementData.space.updatedAt?.toISOString() ||
              agreementData.space.createdAt?.toISOString() ||
              fallbackDate,
          }
        : null,
    } as AgreementWithRelations;
  }

  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-screen">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      }
    >
      <ViewAgreementClientPage agreement={serializableAgreement} />
    </Suspense>
  );
}
