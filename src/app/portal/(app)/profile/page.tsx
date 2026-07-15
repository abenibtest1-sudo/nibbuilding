
import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { UserCircle, Loader2, ArrowLeft } from 'lucide-react';
import { TenantProfileClientPage } from './client-page';
import { getTenantPortalDashboardDataAction } from '../../dashboard/actions'; // Assuming this action fetches the necessary data
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

async function TenantProfileDataFetcher() {
  // We fetch all agreements to find the tenant info.
  // The action will return all agreements for the user. We just need one.
  const portalData = await getTenantPortalDashboardDataAction();
  const tenant = portalData.agreements.length > 0 ? portalData.agreements[0].tenant : null;
  return <TenantProfileClientPage initialTenant={tenant} error={portalData.error} />;
}


export default function TenantProfilePage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="My Profile"
        icon={UserCircle}
        description="View your account details and manage your password."
        actions={
          <Link href="/portal/dashboard" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Button>
          </Link>
        }
      />
      <Suspense fallback={<div className="flex justify-center items-center h-[50vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
        <TenantProfileDataFetcher />
      </Suspense>
    </div>
  );
}
