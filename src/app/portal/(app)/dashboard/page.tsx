
import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { LayoutDashboard, Loader2 } from 'lucide-react';
import { getTenantPortalDashboardDataAction } from '../../dashboard/actions';
import { TenantDashboardClientPage } from '../../dashboard/client-page';

export const dynamic = 'force-dynamic';

async function TenantDashboardDataFetcher() {
  const portalData = await getTenantPortalDashboardDataAction();
  return <TenantDashboardClientPage initialData={portalData} />;
}

export default async function TenantDashboardPage() {
  return (
    <>
      <PageHeader
        title="My Dashboard"
        icon={LayoutDashboard}
        description="Welcome! Here is an overview of your agreements and bills."
      />
      <Suspense fallback={<div className="flex justify-center items-center h-[50vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
        <TenantDashboardDataFetcher />
      </Suspense>
    </>
  );
}
