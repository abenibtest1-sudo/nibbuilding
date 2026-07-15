
export const dynamic = 'force-dynamic';

// Main page.tsx is now a Server Component by default (no "use client" at the top)

import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { Wrench, Loader2 } from 'lucide-react';
import { databaseService } from '@/lib/services/databaseService';
import type { Building as BuildingPrismaType, BuildingMonthlyUtilities as BuildingMonthlyUtilitiesPrismaType, Space as SpacePrismaType, Prisma } from '@prisma/client';
import { BuildingUtilitiesClientPage, type ClientBuildingMonthlyUtilitiesPrismaType } from './client-page'; // Import the new client component
import { getAllBuildingUtilitiesForListAction, getRegisteredBuildingsAction } from './actions';
import { parseISO } from 'date-fns';

// Define a client-safe Space type
interface ClientSpace extends Omit<SpacePrismaType, 'createdAt' | 'updatedAt' | 'area' | 'utilityProrationShare' | 'monthlyRentalPrice'> {
  createdAt: string;
  updatedAt: string;
  area: number;
  utilityProrationShare: number;
  monthlyRentalPrice: number;
}

// Define a client-safe Building type that includes spaces
interface ClientBuilding extends Omit<BuildingPrismaType, 'createdAt' | 'updatedAt' | 'spaces'> {
  createdAt: string;
  updatedAt: string;
  spaces: ClientSpace[];
}


// This is an async Server Component responsible for fetching data
async function BuildingUtilitiesDataFetcher() {
  const buildingsWithSpaces = await getRegisteredBuildingsAction();
  const initialRecordsRaw = await getAllBuildingUtilitiesForListAction();
  
  // Serialize dates and Decimals for client component props
  const serializableBuildings: ClientBuilding[] = buildingsWithSpaces.map(b => ({
    ...b,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt?.toISOString() || b.createdAt.toISOString(), // Safe serialization
    spaces: b.spaces.map(s => ({
      ...s,
      area: Number(s.area),
      utilityProrationShare: Number(s.utilityProrationShare),
      monthlyRentalPrice: Number(s.monthlyRentalPrice),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt?.toISOString() || s.createdAt.toISOString(),
    }))
  }));

  const serializableInitialRecords: ClientBuildingMonthlyUtilitiesPrismaType[] = initialRecordsRaw.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt?.toISOString() || r.createdAt.toISOString(), // Safe serialization
    utilities: r.utilities.map(u => ({...u, totalCost: Number(u.totalCost)}))
  }));

  return <BuildingUtilitiesClientPage initialBuildings={serializableBuildings} initialUtilityRecords={serializableInitialRecords} />;
}

// Server Component to fetch initial data
export default async function BuildingUtilitiesServerPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Manage Building Utilities"
        icon={Wrench}
        description="Enter monthly utility costs for each building. Define costs by scope: entire building, specific floors, or specific spaces."
      />
      <Suspense fallback={<div className="flex justify-center items-center h-[50vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
        <BuildingUtilitiesDataFetcher />
      </Suspense>
    </div>
  );
}
