
import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { UserCircle, Loader2 } from 'lucide-react';
import { AdminProfileClientPage } from './client-page';
import { getUserAndManagedIds } from '@/lib/actions/server-helpers';

export const dynamic = 'force-dynamic';

export default async function AdminProfilePage() {
  // We can add a permission check here if needed in the future,
  // but for now, any authenticated admin/portal user can see their own profile.
  await getUserAndManagedIds(); // This will enforce authentication

  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="My Profile"
        icon={UserCircle}
        description="View your account details and manage your password."
      />
      <Suspense fallback={<div className="flex justify-center items-center h-[50vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
        <AdminProfileClientPage />
      </Suspense>
    </div>
  );
}
