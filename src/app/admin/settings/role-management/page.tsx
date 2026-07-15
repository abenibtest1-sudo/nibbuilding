
import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { ShieldCheck, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getAllRolesAction } from './actions';
import { RoleManagementClientPage, type ClientRole } from './client-page';

export const dynamic = 'force-dynamic';

// Helper function to serialize dates for client component props
const serializeRolesForClient = (roles: any[]): ClientRole[] => {
  return roles.map(role => ({
    ...role,
    createdAt: role.createdAt ? role.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: role.updatedAt?.toISOString() || null,
  }));
};

async function RoleManagementDataFetcher() {
  const { success, roles, error } = await getAllRolesAction();

  if (!success) {
    return <div className="text-destructive p-4">Error loading roles data: {error}</div>;
  }
  
  const serializableRoles = serializeRolesForClient(roles || []);

  return <RoleManagementClientPage initialRoles={serializableRoles} />;
}

export default function RoleManagementServerPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Role Management"
        icon={ShieldCheck}
        description="Create, edit, and delete user roles and manage their permissions."
        actions={
          <Link href="/admin/settings" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
            </Button>
          </Link>
        }
      />
      <Suspense fallback={<div className="flex justify-center items-center h-[50vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
        <RoleManagementDataFetcher />
      </Suspense>
    </div>
  );
}
