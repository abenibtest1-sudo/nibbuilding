export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/custom/PageHeader";
import { Button } from "@/components/ui/button";

import { BillDateConfigurationClientPage } from "./client-page";
import { getBillDateConfigurationAction } from "./actions";

async function BillDateConfigurationDataFetcher() {
  const { success, buildings, error } = await getBillDateConfigurationAction();

  if (!success) {
    return (
      <div className="text-destructive p-4">
        Error loading bill date configuration: {error}
      </div>
    );
  }

  return <BillDateConfigurationClientPage initialBuildings={buildings} />;
}

export default function BillDateConfigurationPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Bill Date Configuration"
        icon={CalendarDays}
        description="Manage agreement billing schedules for specific buildings."
        actions={
          <Link href="/admin/settings" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
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
        <BillDateConfigurationDataFetcher />
      </Suspense>
    </div>
  );
}
