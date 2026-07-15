export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Building as BuildingIconLucide,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { databaseService } from "@/lib/services/databaseService";
import {
  BuildingUpsertFormInternal,
  type BuildingUpsertFormInternalProps,
} from "./building-form";
import type { User, Role } from "@prisma/client";
import { getUserAndManagedIds } from "@/lib/actions/server-helpers";

// Data fetching component
async function BuildingDataFetcher({ buildingId }: { buildingId?: string }) {
  let initialBuildingDataSerializable: BuildingUpsertFormInternalProps["initialBuildingData"] =
    null;
  let formMode: "add" | "edit" = "add";
  let allUsers: User[] = [];

  const { currentUser } = await getUserAndManagedIds();
  const currentUserId = currentUser.id;

  if (buildingId) {
    let buildingToEdit = await databaseService.getBuildingById(buildingId, {
      penaltyPolicyTiers: true,
      managers: { select: { id: true } },
    });

    if (buildingToEdit) {
      const { isSuperAdmin, managedBuildingIds } = await getUserAndManagedIds();

      if (!isSuperAdmin) {
        if (!managedBuildingIds?.includes(buildingToEdit.id)) {
          buildingToEdit = null;
        }
      }
    }

    if (buildingToEdit) {
      formMode = "edit";
      initialBuildingDataSerializable = {
        id: buildingToEdit.id,
        name: buildingToEdit.name,
        address: buildingToEdit.address || "",
        ownerAddress: (buildingToEdit as any).ownerAddress || "",
        branchName: (buildingToEdit as any).branchName || "",
        ownerName: (buildingToEdit as any).ownerName || "",
        ownerPhone: (buildingToEdit as any).ownerPhone || "",
        ownerEmail: (buildingToEdit as any).ownerEmail || "",
        accountNumber: buildingToEdit.accountNumber,
        createdAt: buildingToEdit.createdAt.toISOString(),
        penaltyPolicyTiers: buildingToEdit.penaltyPolicyTiers.map((tier) => ({
          ...tier,
          feeValue: Number(tier.feeValue),
        })),
        managers: buildingToEdit.managers.map((m) => ({ id: m.id })),
      };
      allUsers = await databaseService.getAllUsers({
        orderBy: { name: "asc" },
      });
    }
  }

  return (
    <BuildingUpsertFormInternal
      initialBuildingData={initialBuildingDataSerializable}
      allUsers={allUsers}
      formMode={formMode}
      currentUserId={currentUserId}
    />
  );
}

// This is the main Server Component for the page
export default async function AddBuildingPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string }>;
}) {
  const params = await searchParams;
  const pageTitle = params?.id ? "Edit Building" : "Add New Building";

  return (
    <div className="animate-fadeIn">
      <PageHeader
        title={pageTitle}
        description="Define building details and late fee policies."
        actions={
          <Link href="/admin/buildings" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Buildings
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
        <BuildingDataFetcher buildingId={params?.id} />
      </Suspense>
    </div>
  );
}
