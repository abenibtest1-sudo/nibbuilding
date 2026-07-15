import { Suspense } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import { History, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getAuditLogDataAction } from "./actions";
import { AuditLogClientPage } from "./client-page";
import { getUserAndPermissions } from "@/lib/actions/server-helpers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function AuditLogDataFetcher() {
  const { permissions, isSuperAdmin } = await getUserAndPermissions();
  if (!isSuperAdmin && !permissions.has("audit:view")) {
    redirect("/admin/dashboard?error=" + encodeURIComponent("Access Denied"));
  }

  const data = await getAuditLogDataAction();
  return <AuditLogClientPage initialData={data} />;
}

export default function AuditLogPage() {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Audit Log"
        icon={History}
        description="A read-only log of all confirmed financial transactions in the system."
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
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        }
      >
        <AuditLogDataFetcher />
      </Suspense>
    </div>
  );
}
