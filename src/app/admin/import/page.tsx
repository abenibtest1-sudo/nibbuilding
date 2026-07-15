
import { Suspense } from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { UploadCloud, Loader2 } from 'lucide-react';
import { getAgreementTemplatesForImportAction } from './actions';
import { ImportClientPage } from './client-page';

export const dynamic = 'force-dynamic';

async function ImportDataFetcher() {
  const agreementTemplates = await getAgreementTemplatesForImportAction();
  return <ImportClientPage agreementTemplates={agreementTemplates} />;
}

export default async function ImportPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Import Data"
        icon={UploadCloud}
        description="Bulk import buildings, spaces, tenants, and agreements from an Excel file."
      />
      <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
        <ImportDataFetcher />
      </Suspense>
    </div>
  );
}
