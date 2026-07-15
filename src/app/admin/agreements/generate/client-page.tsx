"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  User,
  Home,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Eye,
  CalendarClock,
  Sigma,
  Info,
  CalendarDays,
  EyeOff,
  Download,
} from "lucide-react";
import type {
  Space as SpacePrismaType,
  Tenant as TenantPrismaType,
  Agreement as AgreementPrismaType,
  AgreementTemplate,
} from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
import {
  createFullAgreementAction,
  type CreateFullAgreementData,
} from "../actions";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import Link from "next/link";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/contexts/PermissionContext";
import { jsPDF } from "jspdf";
import { calculateInitialNextBillingDate } from "@/lib/billing-schedule";

// Helper to create a safe filename
const sanitizeFilename = (name: string) => {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/_{2,}/g, "_");
};

// Client-side representation of Tenant and Space with serialized dates
interface ClientTenant extends Omit<
  TenantPrismaType,
  "createdAt" | "updatedAt"
> {
  createdAt: string;
  updatedAt: string;
  buildingStatuses?: { buildingId: string; status: string }[];
}
interface ClientSpace extends Omit<SpacePrismaType, "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt: string;
  // Convert Prisma Decimal fields to numbers for client usage
  area: number;
  utilityProrationShare: number;
  monthlyRentalPrice: number;
}

const agreementFormSchema = z
  .object({
    tenantId: z.string().min(1, { message: "Please select a tenant." }),
    selectedSpaceId: z.string().min(1, { message: "Please select a space." }),
    templateId: z
      .string()
      .min(1, { message: "Please select an agreement template." }),
    startDate: z.date({ required_error: "Agreement start date is required." }),
    paymentTermMonths: z.coerce
      .number()
      .int()
      .positive({
        message: "Payment term must be a positive number of months.",
      })
      .min(1, { message: "Term must be at least 1 month." }),
    initialPaymentMonths: z.coerce
      .number()
      .int()
      .positive({
        message: "Initial payment must be a positive number of months.",
      })
      .min(1, { message: "Initial payment must be at least 1 month." }),
    additionalTerms: z.string().optional(),
  })
  .refine((data) => data.initialPaymentMonths <= data.paymentTermMonths, {
    message: "Initial payment months cannot exceed total payment term months.",
    path: ["initialPaymentMonths"],
  });

type AgreementFormValues = z.infer<typeof agreementFormSchema>;

interface GenerateAgreementClientPageProps {
  tenants: ClientTenant[];
  availableSpaces: ClientSpace[];
  agreementTemplates: AgreementTemplate[];
  billDateConfigurationByBuilding: Record<string, number | null>;
  managedBuildingIds?: string[];
  currentBuildingId?: string;
}

export function GenerateAgreementClientPage({
  tenants,
  availableSpaces,
  agreementTemplates,
  billDateConfigurationByBuilding,
  managedBuildingIds,
  currentBuildingId,
}: GenerateAgreementClientPageProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [generatedAgreementText, setGeneratedAgreementText] = useState<
    string | null
  >(null);
  const [finalizedAgreement, setFinalizedAgreement] =
    useState<AgreementPrismaType | null>(null);
  const [validatedData, setValidatedData] =
    useState<AgreementFormValues | null>(null);
  const [finalizedSpace, setFinalizedSpace] = useState<ClientSpace | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const { isSuperAdmin, hasPermission } = usePermissions();

  const canCreateAgreements = isSuperAdmin || hasPermission("agreement:create");

  const form = useForm<AgreementFormValues>({
    resolver: zodResolver(agreementFormSchema),
    defaultValues: {
      tenantId: "",
      selectedSpaceId: "",
      templateId: "",
      startDate: new Date(),
      paymentTermMonths: 12,
      initialPaymentMonths: 1,
      additionalTerms: "",
    },
  });

  const selectedSpaceId = form.watch("selectedSpaceId");
  const initialPaymentMonths = form.watch("initialPaymentMonths");

  const selectedSpaceDetails = useMemo(() => {
    return availableSpaces.find((s) => s.id === selectedSpaceId);
  }, [selectedSpaceId, availableSpaces]);

  const calculatedInitialPaymentAmount = useMemo(() => {
    if (selectedSpaceDetails && initialPaymentMonths >= 0) {
      return (
        Number(selectedSpaceDetails.monthlyRentalPrice) * initialPaymentMonths
      );
    }
    return 0;
  }, [selectedSpaceDetails, initialPaymentMonths]);

  useEffect(() => setIsMounted(true), []);

  const generateAgreementTextFromTemplate = useCallback(
    (
      template: string,
      data: AgreementFormValues,
      tenant: ClientTenant,
      space: ClientSpace,
    ) => {
      const initialPaymentAmount = (
        Number(space.monthlyRentalPrice) * data.initialPaymentMonths
      ).toLocaleString();
      const billDateConfiguration =
        billDateConfigurationByBuilding[space.buildingId] ?? null;
      const nextScheduledBillingDate = calculateInitialNextBillingDate(
        data.startDate,
        billDateConfiguration,
      );
      const nextPaymentDueDate = format(nextScheduledBillingDate, "PPP");

      let processedText = template;
      const replacements: Record<string, string> = {
        "{{tenantName}}": tenant.name,
        "{{buildingName}}": space.buildingName,
        "{{spaceIdName}}": space.spaceIdName,
        "{{floor}}": space.floor,
        "{{area}}": String(space.area),
        "{{startDate}}": format(data.startDate, "PPP"),
        "{{paymentTermMonths}}": String(data.paymentTermMonths),
        "{{monthlyRent}}": Number(space.monthlyRentalPrice).toLocaleString(),
        "{{initialPaymentMonths}}": String(data.initialPaymentMonths),
        "{{initialPaymentAmount}}": initialPaymentAmount,
        "{{nextPaymentDueDate}}": nextPaymentDueDate,
        "{{additionalTerms}}":
          data.additionalTerms || "No additional terms specified.",
      };

      // Helper function to escape special regex characters
      const escapeRegExp = (string: string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
      };

      for (const key in replacements) {
        const regex = new RegExp(escapeRegExp(key), "g");
        processedText = processedText.replace(regex, replacements[key]);
      }

      return processedText;
    },
    [billDateConfigurationByBuilding],
  );

  const handlePreviewAgreement = (data: AgreementFormValues) => {
    if (!canCreateAgreements) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsPreviewing(true);
    setError(null);
    setGeneratedAgreementText(null);
    setFinalizedAgreement(null);
    setValidatedData(data);

    const selectedTenant = tenants.find((t) => t.id === data.tenantId);
    const selectedSpace = availableSpaces.find(
      (s) => s.id === data.selectedSpaceId,
    );
    const selectedTemplate = agreementTemplates.find(
      (t) => t.id === data.templateId,
    );

    if (!selectedTenant || !selectedSpace) {
      toast({
        title: "Error",
        description: "Selected tenant or space not found.",
        variant: "destructive",
      });
      setIsPreviewing(false);
      return;
    }

    if (!selectedTemplate) {
      toast({
        title: "Template Missing",
        description: "Please select an agreement template.",
        variant: "destructive",
      });
      setIsPreviewing(false);
      return;
    }

    const agreementText = generateAgreementTextFromTemplate(
      selectedTemplate.content,
      data,
      selectedTenant,
      selectedSpace,
    );

    setGeneratedAgreementText(agreementText.trim());
    toast({
      title: "Agreement Preview Generated!",
      description: "Review the text and proceed to save.",
    });
    setIsPreviewing(false);
  };

  const handleDownloadAgreement = () => {
    if (!generatedAgreementText) {
      toast({
        title: "Cannot Download",
        description: "No agreement text has been generated.",
        variant: "destructive",
      });
      return;
    }

    const doc = new jsPDF();
    doc.html(generatedAgreementText, {
      callback: function (doc) {
        const tenantName =
          tenants.find((t) => t.id === form.getValues().tenantId)?.name ||
          "Tenant";
        const safeTenantName = sanitizeFilename(tenantName);
        doc.save(`Draft-Agreement-${safeTenantName}.pdf`);
        toast({
          title: "Download Started",
          description: "Your draft agreement PDF is downloading.",
        });
      },
      x: 15,
      y: 15,
      width: 170,
      windowWidth: 650,
    });
  };

  const handleSaveFullAgreement = async () => {
    if (!canCreateAgreements) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    if (!generatedAgreementText) {
      toast({
        title: "Error",
        description: "No agreement text generated to save.",
        variant: "destructive",
      });
      return;
    }
    if (!validatedData) {
      toast({
        title: "Error",
        description:
          "Form data is not validated. Please preview the agreement again.",
        variant: "destructive",
      });
      return;
    }
    const formValues = validatedData;
    const selectedTenant = tenants.find((t) => t.id === formValues.tenantId);
    const selectedSpace = availableSpaces.find(
      (s) => s.id === formValues.selectedSpaceId,
    );

    if (!selectedTenant || !selectedSpace || !formValues.startDate) {
      toast({
        title: "Error",
        description:
          "Missing required details (tenant, space, or start date) to save agreement.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingToDb(true);
    setError(null);

    const agreementDataForDb: CreateFullAgreementData = {
      tenantId: selectedTenant.id,
      spaceId: selectedSpace.id,
      agreementTemplateId: formValues.templateId,
      agreementText: generatedAgreementText,
      startDate: format(formValues.startDate, "yyyy-MM-dd"),
      monthlyRentalPrice: Number(selectedSpace.monthlyRentalPrice),
      paymentTermMonths: formValues.paymentTermMonths,
      initialPaymentMonths: formValues.initialPaymentMonths,
      additionalTerms: formValues.additionalTerms,
    };

    const result = await createFullAgreementAction(agreementDataForDb);
    setIsSavingToDb(false);

    if (result.success && result.agreement) {
      setFinalizedAgreement(result.agreement as AgreementPrismaType);
      setFinalizedSpace(selectedSpace);
      toast({
        title: "Agreement Saved Successfully!",
        description: "The agreement is now active.",
      });
      setGeneratedAgreementText(null);
    } else {
      setError(result.error || "Failed to save agreement.");
      toast({
        title: "Save Failed",
        description: result.error || "An unknown error occurred.",
        variant: "destructive",
      });
    }
  };

  if (!isMounted) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!canCreateAgreements && isMounted) {
    return (
      <Card className="shadow-lg text-center py-12">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center justify-center">
            <EyeOff className="mr-2" />
            Access Denied
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>Access Denied</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">
            Agreement & Payment Details
          </CardTitle>
          <CardDescription>
            Fill form to create a new agreement and record initial payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handlePreviewAgreement)}
              className="space-y-6"
            >
              <FormField
                control={form.control}
                name="templateId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      <FileText className="mr-2 h-4 w-4 text-primary" />
                      Select Agreement Template
                      <span className="text-destructive ml-1">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={!canCreateAgreements}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a template" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {agreementTemplates.length > 0 ? (
                          agreementTemplates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-templates" disabled>
                            No templates found. Go to settings to create one.
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      <User className="mr-2 h-4 w-4 text-primary" />
                      Select Tenant
                      <span className="text-destructive ml-1">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={!canCreateAgreements}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose an existing tenant" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {tenants && tenants.length > 0 ? (
                          // Filter out tenants that are inactive for the current building
                          tenants
                            .filter((tenant) => {
                              // Check per-building status first for current building
                              const matchForCurrent =
                                tenant.buildingStatuses?.find(
                                  (bs) =>
                                    bs.buildingId ===
                                    (currentBuildingId || tenant.buildingId),
                                )?.status;

                              // If any managed building has an Inactive flag for this tenant,
                              // consider them inactive for selection.
                              const anyManagedInactive =
                                managedBuildingIds && tenant.buildingStatuses
                                  ? tenant.buildingStatuses.some(
                                      (bs) =>
                                        managedBuildingIds.includes(
                                          bs.buildingId,
                                        ) && bs.status === "Inactive",
                                    )
                                  : false;

                              const effectiveStatus =
                                matchForCurrent ??
                                (anyManagedInactive
                                  ? "Inactive"
                                  : tenant.status);
                              return effectiveStatus === "Active";
                            })
                            .map((tenant) => (
                              <SelectItem key={tenant.id} value={tenant.id}>
                                {tenant.name} ({tenant.email})
                              </SelectItem>
                            ))
                        ) : (
                          <SelectItem value="no-tenants" disabled>
                            No tenants found
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="selectedSpaceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      <Home className="mr-2 h-4 w-4 text-primary" />
                      Select Space
                      <span className="text-destructive ml-1">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={!canCreateAgreements}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose an available space" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableSpaces.length > 0 ? (
                          availableSpaces.map((space) => (
                            <SelectItem key={space.id} value={space.id}>
                              {space.spaceIdName} ({space.buildingName}) -{" "}
                              {Number(
                                space.monthlyRentalPrice,
                              ).toLocaleString()}{" "}
                              Birr
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-spaces" disabled>
                            No available spaces
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="flex items-center">
                      <CalendarDays className="mr-2 h-4 w-4 text-primary" />
                      Agreement Start Date
                      <span className="text-destructive ml-1">*</span>
                    </FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                            disabled={!canCreateAgreements}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="paymentTermMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        <CalendarClock className="mr-2 h-4 w-4 text-primary" />
                        Total Term (Months)
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Enter term in months"
                          {...field}
                          disabled={!canCreateAgreements}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="initialPaymentMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center">
                        <Sigma className="mr-2 h-4 w-4 text-primary" />
                        Initial Payment (Months)
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Enter initial payment in months"
                          {...field}
                          disabled={!canCreateAgreements}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {calculatedInitialPaymentAmount > 0 && (
                <div className="p-3 bg-secondary/50 rounded-md border border-border">
                  <Label className="font-semibold flex items-center text-foreground">
                    <Info className="mr-2 h-4 w-4 text-primary" />
                    Calculated Initial Payment Amount
                  </Label>
                  <p className="text-2xl font-bold text-primary mt-1">
                    {calculatedInitialPaymentAmount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    Birr
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ({initialPaymentMonths} month(s) upfront based on selected
                    space)
                  </p>
                </div>
              )}

              <FormField
                control={form.control}
                name="additionalTerms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional Terms</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={6} // adjust height as needed
                        placeholder="Enter additional terms..."
                        {...field}
                        disabled={
                          !canCreateAgreements || isSavingToDb || isPreviewing
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      These terms will be appended to the standard agreement
                      clauses.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={
                  isPreviewing ||
                  isSavingToDb ||
                  availableSpaces.length === 0 ||
                  tenants.length === 0 ||
                  !form.formState.isValid ||
                  !canCreateAgreements
                }
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isPreviewing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                    Generating...
                  </>
                ) : (
                  "Preview Agreement"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">
            Generated Agreement & Finalize
          </CardTitle>
          <CardDescription>
            Review the generated text. If satisfied, save the agreement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPreviewing && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              {" "}
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />{" "}
              <p>Generating text...</p>{" "}
            </div>
          )}
          {error && !isPreviewing && (
            <div className="flex flex-col items-center justify-center h-64 text-destructive-foreground bg-destructive/80 p-6 rounded-md">
              {" "}
              <AlertTriangle className="h-12 w-12 mb-4" />{" "}
              <p className="font-semibold text-lg">Error</p>{" "}
              <p className="text-sm text-center">{error}</p>{" "}
            </div>
          )}

          {generatedAgreementText &&
            !finalizedAgreement &&
            !isPreviewing &&
            !error && (
              <div className="space-y-4">
                <div className="flex items-center text-green-600 bg-green-50 p-3 rounded-md">
                  <CheckCircle className="h-5 w-5 mr-2" />
                  <p className="font-medium">Agreement text generated!</p>
                </div>
                <ScrollArea className="h-[300px] w-full rounded-md border p-4 bg-secondary/30">
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: generatedAgreementText }}
                  />
                </ScrollArea>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={handleSaveFullAgreement}
                    disabled={
                      isSavingToDb || isPreviewing || !canCreateAgreements
                    }
                    className="w-full"
                  >
                    {isSavingToDb ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                        Saving...
                      </>
                    ) : (
                      "Finalize & Save Agreement"
                    )}
                  </Button>
                  {(isSuperAdmin || hasPermission("agreement:download")) && (
                    <Button
                      onClick={handleDownloadAgreement}
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={isSavingToDb}
                    >
                      <Download className="mr-2 h-4 w-4" /> Download
                    </Button>
                  )}
                </div>
              </div>
            )}

          {finalizedAgreement && !error && (
            <div className="space-y-4">
              <div className="flex items-center text-green-600 bg-green-50 p-3 rounded-md border border-green-200">
                <CheckCircle className="h-5 w-5 mr-2" />
                <p className="font-medium">Agreement successfully saved!</p>
              </div>
              <p className="text-sm font-medium">
                Tenant:{" "}
                <span className="font-normal">
                  {tenants.find((t) => t.id === finalizedAgreement.tenantId)
                    ?.name || "N/A"}
                </span>
              </p>
              <p className="text-sm font-medium">
                Space:{" "}
                <span className="font-normal">
                  {finalizedSpace
                    ? `${finalizedSpace.spaceIdName} (${finalizedSpace.buildingName})`
                    : "N/A"}
                </span>
              </p>
              <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
                <Button
                  onClick={() => {
                    setFinalizedAgreement(null);
                    setValidatedData(null);
                    setFinalizedSpace(null);
                    form.reset();
                  }}
                  variant="outline"
                >
                  Create Another Agreement
                </Button>
                <Link
                  href={`/admin/agreements/${finalizedAgreement.id}`}
                  passHref
                >
                  <Button>
                    <Eye className="mr-2 h-4 w-4" /> View Saved Agreement
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {!generatedAgreementText &&
            !finalizedAgreement &&
            !isPreviewing &&
            !error && (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed border-border rounded-md p-6">
                <FileText className="h-12 w-12 mb-4" />
                <p className="font-semibold">
                  Agreement text preview will appear here.
                </p>
                <p className="text-sm text-center">
                  Fill form and click "Preview Agreement".
                </p>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
