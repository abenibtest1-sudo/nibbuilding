
import { Suspense } from 'react';
import { ConnectionErrorClientPage } from './client-page';
import { Loader2 } from 'lucide-react';

export default function ConnectionErrorPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center h-[80vh]"><Loader2 className="h-12 w-12 animate-spin text-primary"/></div>}>
      <ConnectionErrorClientPage />
    </Suspense>
  );
}
