import { Suspense } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import { FileText, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getAgreementTemplateByIdAction } from "../actions";
import { AddTemplateForm } from "./form";

export const dynamic = "force-dynamic";

async function TemplateDataFetcher({ templateId }: { templateId?: string }) {
  if (templateId) {
    const { template, error } = await getAgreementTemplateByIdAction(
      templateId,
    );
    if (error) {
      return <p className="text-destructive">{error}</p>;
    }
    return <AddTemplateForm initialData={template} />;
  }
  return <AddTemplateForm />;
}

export default async function AddAgreementTemplatePage({
  searchParams,
}: {
  searchParams?: { id?: string } | Promise<{ id?: string }>;
}) {
  const resolvedSearchParams = await (searchParams as any);
  const templateId = resolvedSearchParams?.id;
  const pageTitle = templateId
    ? "Edit Agreement Template"
    : "Add New Agreement Template";

  return (
    <div className="animate-fadeIn">
      <PageHeader
        title={pageTitle}
        icon={FileText}
        description={
          templateId
            ? "Update the template name and content."
            : "Create a new reusable agreement template."
        }
        actions={
          <Link href="/admin/settings/agreement-template" passHref>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Templates
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
        <TemplateDataFetcher templateId={templateId} />
      </Suspense>
    </div>
  );
}
