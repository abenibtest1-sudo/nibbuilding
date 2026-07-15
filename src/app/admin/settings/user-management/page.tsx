
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { Users as UsersIcon, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getUserManagementPageData } from './actions';
import { UserManagementClientPage, type ClientUserWithAssignments, type ClientRole, type ClientBuildingForAssignment } from './client-page';

// Helper function to serialize dates for client component props
const serializeDataForClient = (data: any) => {
  if (Array.isArray(data)) {
    return data.map(item => serializeDataForClient(item));
  }
  if (data && typeof data === 'object' && !(data instanceof Date)) {
    const result: any = {};
    for (const key in data) {
      if (data[key] instanceof Date) {
        result[key] = data[key].toISOString();
      } else {
        result[key] = serializeDataForClient(data[key]);
      }
    }
    return result;
  }
  return data;
};


async function UserManagementDataFetcher() {
  const { success, users, allRoles, allBuildings, error } = await getUserManagementPageData();

  if (!success) {
    // Handle error state, maybe show an error message component
    return <div className="text-destructive p-4">Error loading user management data: {error}</div>;
  }
  
  // Serialize data for the client
  const serializableUsers = serializeDataForClient(users) as ClientUserWithAssignments[];
  const serializableRoles = serializeDataForClient(allRoles) as ClientRole[];
  const serializableBuildings = serializeDataForClient(allBuildings) as ClientBuildingForAssignment[];

  return (
    <UserManagementClientPage
      initialUsers={serializableUsers}
      initialAllRoles={serializableRoles}
      initialAllBuildings={serializableBuildings}
    />
  );
}

export default function UserManagementServerPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="User Management"
        icon={UsersIcon}
        description="Assign roles and managed buildings to users."
        actions={
          <Link href="/admin/settings" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
            </Button>
          </Link>
        }
      />
      <Suspense fallback={<div className="flex justify-center items-center h-[50vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
        <UserManagementDataFetcher />
      </Suspense>
    </div>
  );
}
