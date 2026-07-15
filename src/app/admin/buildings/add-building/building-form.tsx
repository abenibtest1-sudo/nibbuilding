"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PlusCircle,
  Trash2,
  MapPin,
  Banknote as BanknoteIcon,
  Layers,
  HomeIcon,
  Loader2,
  EyeOff,
  Clock,
  User,
  Check,
  Search,
  Hash,
} from "lucide-react";
import type {
  PenaltyTier as PenaltyTierTypePrisma,
  Prisma,
  User as UserPrisma,
} from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import {
  createBuildingAction,
  updateBuildingAction,
  getMyChangeRequestForBuilding,
} from "../actions";
import { usePermissions } from "@/contexts/PermissionContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { z } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const penaltyRuleSchema = z
  .object({
    id: z.string(),
    dbId: z.string().optional(),
    fromDay: z.coerce.number().min(1, "Must be at least 1"),
    toDay: z.coerce.number().optional().nullable(),
    penaltyType: z.enum(["Fixed", "Percentage"]),
    frequency: z.enum(["OneTime", "Daily"]),
    feeValue: z.coerce.number().min(0, "Cannot be negative"),
    scope: z.enum(["Building", "Floor", "SpecificSpaces"]),
    applicableFloor: z.string().optional().nullable(),
    applicableSpaceIdNamesStr: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      // If 'To Day' is left empty, it coerces to 0. Treat this as valid (ongoing).
      // Also check for null/undefined for programmatic cases.
      if (data.toDay === 0 || data.toDay == null) {
        return true;
      }
      // If 'To Day' has a value, it must be greater than or equal to 'From Day'.
      return data.fromDay <= data.toDay;
    },
    {
      message: "'To Day' must be greater than or equal to 'From Day'",
      path: ["toDay"],
    },
  );

const BRANCH_DISTRICT_FORMAT_REGEX = /^[^()]+ \([^()]+\)$/;

const buildingFormSchema = z.object({
  name: z.string().min(2, "Building name must be at least 2 characters."),
  address: z.string().min(5, "Address must be at least 5 characters."),
  branchName: z
    .string()
    .trim()
    .min(1, "Branch / District is required.")
    .max(100)
    .regex(
      BRANCH_DISTRICT_FORMAT_REGEX,
      "Use the format: Branch Name (District Name).",
    ),
  ownerName: z.string().max(200).optional().nullable(),
  ownerAddress: z.string().max(300).optional().nullable(),
  ownerPhone: z
    .string()
    .regex(/^09\d{8}$/, "Phone must start with '09' followed by 8 digits."),
  ownerEmail: z.string().email("Invalid email address").optional().nullable(),
  accountNumber: z
    .string()
    .regex(
      /^(7\d{12}|ETB\d{5})$/,
      "Account number must start with '7' and be 13 digits, or 'ETB' followed by 5 digits.",
    ),
  penaltyRules: z.array(penaltyRuleSchema).optional(),
});

type BuildingFormValues = z.infer<typeof buildingFormSchema>;

interface BuildingUpsertFormInternalProps {
  initialBuildingData?: {
    id: string;
    name: string;
    address: string | null;
    branchName?: string | null;
    ownerName?: string | null;
    ownerPhone?: string | null;
    ownerEmail?: string | null;
    accountNumber: string;
    penaltyPolicyTiers: PenaltyTierTypePrisma[];
    managers: { id: string }[];
    createdAt: string;
  } | null;
  allUsers?: UserPrisma[];
  formMode: "add" | "edit";
  currentUserId: string;
}

export function BuildingUpsertFormInternal({
  initialBuildingData,
  allUsers = [],
  formMode,
  currentUserId,
}: BuildingUpsertFormInternalProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { hasPermission, isSuperAdmin, handleApiCall } = usePermissions();

  const isViewOnlyMode = searchParams.get("view") === "true";

  let canManageThisForm: boolean;
  if (formMode === "add") {
    canManageThisForm = isSuperAdmin || hasPermission("building:create");
  } else {
    canManageThisForm = isSuperAdmin || hasPermission("building:edit");
  }
  if (isViewOnlyMode) {
    canManageThisForm = false;
  }

  const [selectedManagerIds, setSelectedManagerIds] = useState<Set<string>>(
    new Set(),
  );
  const [myChangeRequest, setMyChangeRequest] = useState<any | null>(null);
  const [managerSearchTerm, setManagerSearchTerm] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<BuildingFormValues>({
    resolver: zodResolver(buildingFormSchema),
    defaultValues: {
      name: "",
      address: "",
      branchName: "",
      ownerName: "",
      ownerAddress: "",
      ownerPhone: "",
      ownerEmail: "",
      accountNumber: "",
      penaltyRules: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "penaltyRules",
  });

  useEffect(() => {
    if (initialBuildingData) {
      const uiRules: z.infer<typeof penaltyRuleSchema>[] = (
        initialBuildingData.penaltyPolicyTiers || []
      )
        .map((tier) => ({
          id: tier.id,
          dbId: tier.id,
          fromDay: tier.fromDay,
          toDay: tier.toDay ?? undefined,
          penaltyType: tier.penaltyType as "Fixed" | "Percentage",
          frequency: tier.frequency as "OneTime" | "Daily",
          feeValue: Number(tier.feeValue),
          scope: tier.scope as "Building" | "Floor" | "SpecificSpaces",
          applicableFloor: tier.applicableFloor || "",
          applicableSpaceIdNamesStr:
            tier.applicableSpaceIdNames?.join(", ") || "",
        }))
        .sort((a, b) => a.fromDay - b.fromDay);

      form.reset({
        name: initialBuildingData.name,
        address: initialBuildingData.address || "",
        branchName: (initialBuildingData as any).branchName || "",
        ownerName: (initialBuildingData as any).ownerName || "",
        ownerAddress: (initialBuildingData as any).ownerAddress || "",
        ownerPhone: (initialBuildingData as any).ownerPhone || "",
        ownerEmail: (initialBuildingData as any).ownerEmail || "",
        accountNumber: initialBuildingData.accountNumber || "",
        penaltyRules: uiRules,
      });

      setSelectedManagerIds(
        new Set(initialBuildingData.managers.map((m) => m.id)),
      );
    } else {
      form.reset({
        name: "",
        address: "",
        branchName: "",
        ownerName: "",
        ownerAddress: "",
        ownerPhone: "",
        ownerEmail: "",
        accountNumber: "",
        penaltyRules: [],
      });
      setSelectedManagerIds(new Set());
    }
  }, [initialBuildingData, form]);

  useEffect(() => {
    if (formMode !== "edit" || !initialBuildingData?.id) return;
    let mounted = true;
    (async () => {
      try {
        const res = await handleApiCall(() =>
          getMyChangeRequestForBuilding(initialBuildingData.id),
        );
        if (!mounted) return;
        if (res && res.success) {
          setMyChangeRequest(res.changeRequest);
        }
      } catch (err) {
        // ignore - permissions or network handled by handleApiCall
      }
    })();
    return () => {
      mounted = false;
    };
  }, [initialBuildingData?.id, formMode, handleApiCall]);

  const handleManagerToggle = (userId: string) => {
    if (!canManageThisForm) return;
    setSelectedManagerIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const filteredManagers = allUsers.filter(
    (user) =>
      (user.name || `${user.firstName} ${user.lastName}`)
        .toLowerCase()
        .includes(managerSearchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(managerSearchTerm.toLowerCase()),
  );

  const handleAddUIPenaltyRule = () => {
    if (!canManageThisForm) return;
    append({
      id: crypto.randomUUID(),
      scope: "Building",
      penaltyType: "Fixed",
      frequency: "OneTime",
      feeValue: 0,
      fromDay: 1,
      toDay: undefined,
    });
  };

  const handleFormSubmit = async (values: BuildingFormValues) => {
    if (!canManageThisForm) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);

    const finalPenaltyTiersCreateInput: Prisma.PenaltyTierCreateWithoutBuildingInput[] =
      (values.penaltyRules || []).map((uiRule) => ({
        fromDay: uiRule.fromDay!,
        // This is the fix: if toDay is 0 (from empty input), send null to the DB.
        toDay: uiRule.toDay === 0 ? null : uiRule.toDay,
        penaltyType: uiRule.penaltyType,
        frequency: uiRule.frequency,
        feeValue: Number(uiRule.feeValue!),
        scope: uiRule.scope,
        applicableFloor:
          uiRule.scope === "Floor" ? uiRule.applicableFloor?.trim() : undefined,
        applicableSpaceIdNames:
          uiRule.scope === "SpecificSpaces"
            ? uiRule.applicableSpaceIdNamesStr
                ?.split(",")
                .map((s) => s.trim())
                .filter((s) => s)
            : [],
      }));

    let result;
    if (formMode === "add") {
      const buildingCreateInput: Prisma.BuildingCreateInput = {
        name: values.name.trim(),
        address: values.address.trim(),
        branchName: values.branchName.trim(),
        ownerName: values.ownerName ? values.ownerName.trim() : undefined,
        ownerAddress: values.ownerAddress
          ? values.ownerAddress.trim()
          : undefined,
        ownerPhone: values.ownerPhone ? values.ownerPhone.trim() : undefined,
        ownerEmail: values.ownerEmail ? values.ownerEmail.trim() : undefined,
        accountNumber: values.accountNumber.trim(),
        penaltyPolicyTiers: {
          create: finalPenaltyTiersCreateInput,
        },
      };
      result = await handleApiCall(() =>
        createBuildingAction(buildingCreateInput),
      );
    } else {
      const buildingUpdateInput: Prisma.BuildingUpdateInput = {
        name: values.name.trim(),
        address: values.address.trim(),
        branchName: values.branchName.trim(),
        ownerName: values.ownerName ? values.ownerName.trim() : undefined,
        ownerAddress: values.ownerAddress
          ? values.ownerAddress.trim()
          : undefined,
        ownerPhone: values.ownerPhone ? values.ownerPhone.trim() : undefined,
        ownerEmail: values.ownerEmail ? values.ownerEmail.trim() : undefined,
        accountNumber: values.accountNumber.trim(),
        penaltyPolicyTiers: {
          deleteMany: {},
          create: finalPenaltyTiersCreateInput,
        },
      };
      const managerIds = Array.from(selectedManagerIds);
      result = await handleApiCall(() =>
        updateBuildingAction(
          initialBuildingData?.id!,
          buildingUpdateInput,
          managerIds,
        ),
      );
    }

    if (!result) {
      // API call was handled by context
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    if (result.success) {
      toast({
        title: `Building ${formMode === "add" ? "Added" : "Updated"}`,
        description: `${result.building?.name} has been saved.`,
      });
      router.push("/admin/buildings");
      router.refresh();
    } else {
      toast({
        title: `Error ${formMode === "add" ? "Adding" : "Updating"} Building`,
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const canViewPage =
    isSuperAdmin ||
    hasPermission("building:view") ||
    hasPermission("building:create") ||
    hasPermission("building:edit");

  if (!canViewPage) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center">
            <EyeOff className="mr-2" />
            Access Denied
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>Access Denied</p>
        </CardContent>
        <CardFooter>
          <Button onClick={() => router.back()} variant="outline">
            Go Back
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleFormSubmit)}>
          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            {isViewOnlyMode && (
              <div className="p-3 bg-yellow-50 border border-yellow-300 text-yellow-700 text-sm rounded-md flex items-center md:col-span-2">
                <EyeOff className="h-5 w-5 mr-2 shrink-0" />
                You are in view-only mode. Editing is disabled.
              </div>
            )}
            {myChangeRequest?.status === "Rejected" &&
              myChangeRequest.rejectionReason && (
                <div className="p-3 bg-red-50 border border-red-300 text-red-700 text-sm rounded-md flex items-start md:col-span-2">
                  <div className="mr-3">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">Change Request Rejected</div>
                    <div className="text-sm mt-1">
                      {myChangeRequest.rejectionReason}
                    </div>
                  </div>
                </div>
              )}
            <div className="space-y-6">
              <div className="space-y-4 border-b pb-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Name<span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Building Name"
                          {...field}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Account Number
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="7************ or ETB*****"
                          {...field}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Address<span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Building Address"
                          rows={2}
                          {...field}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branchName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Branch / District
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Bole Branch (Addis Ababa District)"
                          {...field}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Format: Branch Name (District Name)
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-4 border-b pb-6">
                <FormField
                  control={form.control}
                  name="ownerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Building Owner Name
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Owner full name"
                          {...field}
                          value={field.value ?? ""}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ownerPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Building Owner Phone
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Building Owner Phone"
                          {...field}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ownerEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Building Owner Email{" "}
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Building Owner Email"
                          {...field}
                          value={field.value ?? ""}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ownerAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center text-sm font-medium">
                        Building Owner Address (optional)
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Owner address"
                          rows={2}
                          {...field}
                          value={field.value ?? ""}
                          disabled={isSaving || !canManageThisForm}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-foreground">
                  Late Fee Penalty Rules
                </h3>
                {canManageThisForm && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddUIPenaltyRule}
                    disabled={isSaving}
                  >
                    <PlusCircle className="mr-1.5 h-4 w-4" /> Add Rule
                  </Button>
                )}
              </div>
              <CardDescription>
                Define sequential penalty rules. For the last rule in a group,
                leave "To Day" blank for an indefinite period.
              </CardDescription>
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  No penalty rules defined.{" "}
                  {canManageThisForm ? 'Click "Add Rule" to begin.' : ""}
                </p>
              )}

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {fields.map((field, index) => (
                  <Card
                    key={field.id}
                    className="p-4 bg-secondary/30 shadow-sm"
                  >
                    <CardHeader className="p-0 pb-3">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-md font-medium">
                          Rule {index + 1}
                        </CardTitle>
                        {canManageThisForm && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            disabled={isSaving}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.fromDay`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <Clock className="mr-1 h-3 w-3" />
                                From Day
                                <span className="text-destructive ml-1">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  placeholder="e.g., 1"
                                  {...field}
                                  className="text-sm h-9"
                                  disabled={isSaving || !canManageThisForm}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.toDay`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <Clock className="mr-1 h-3 w-3" />
                                To Day
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min={form.getValues(
                                    `penaltyRules.${index}.fromDay`,
                                  )}
                                  placeholder="e.g., 5"
                                  {...field}
                                  value={field.value ?? ""}
                                  className="text-sm h-9"
                                  disabled={isSaving || !canManageThisForm}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.penaltyType`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <BanknoteIcon className="mr-1 h-3 w-3" />
                                Penalty Type
                                <span className="text-destructive ml-1">*</span>
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                disabled={isSaving || !canManageThisForm}
                              >
                                <FormControl>
                                  <SelectTrigger className="text-sm h-9">
                                    <SelectValue placeholder="Select penalty type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Fixed">
                                    Fixed Amount
                                  </SelectItem>
                                  <SelectItem value="Percentage">
                                    Percentage
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.frequency`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <Clock className="mr-1 h-3 w-3" />
                                Frequency
                                <span className="text-destructive ml-1">*</span>
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                disabled={isSaving || !canManageThisForm}
                              >
                                <FormControl>
                                  <SelectTrigger className="text-sm h-9">
                                    <SelectValue placeholder="Select frequency" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="OneTime">
                                    One-time
                                  </SelectItem>
                                  <SelectItem value="Daily">Daily</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-1">
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.feeValue`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <BanknoteIcon className="mr-1 h-3 w-3" />
                                Fee Value
                                <span className="text-destructive ml-1">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="e.g., 50 or 2.5"
                                  {...field}
                                  className="text-sm h-9"
                                  disabled={isSaving || !canManageThisForm}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.scope`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <Layers className="mr-1 h-3 w-3" />
                                Scope
                                <span className="text-destructive ml-1">*</span>
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                disabled={isSaving || !canManageThisForm}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select scope" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Building">
                                    Entire Building
                                  </SelectItem>
                                  <SelectItem value="Floor">
                                    Specific Floor
                                  </SelectItem>
                                  <SelectItem value="SpecificSpaces">
                                    Specific Space(s)
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {form.watch(`penaltyRules.${index}.scope`) ===
                          "Floor" && (
                          <FormField
                            control={form.control}
                            name={`penaltyRules.${index}.applicableFloor`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">
                                  Floor Name
                                  <span className="text-destructive ml-1">
                                    *
                                  </span>
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="Floor Name"
                                    {...field}
                                    value={field.value ?? ""}
                                    className="h-9"
                                    disabled={isSaving || !canManageThisForm}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                      {form.watch(`penaltyRules.${index}.scope`) ===
                        "SpecificSpaces" && (
                        <FormField
                          control={form.control}
                          name={`penaltyRules.${index}.applicableSpaceIdNamesStr`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs flex items-center">
                                <HomeIcon className="mr-1 h-3 w-3" />
                                Space ID Names (comma-separated)
                                <span className="text-destructive ml-1">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Space ID, e.g., Unit 10A, Office 202B"
                                  {...field}
                                  value={field.value ?? ""}
                                  className="h-9"
                                  disabled={isSaving || !canManageThisForm}
                                />
                              </FormControl>
                              <FormMessage />
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Enter exact 'Space ID/Name' from Spaces page.
                              </p>
                            </FormItem>
                          )}
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t p-6 flex justify-end">
            {canManageThisForm && (
              <Button
                type="submit"
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {isSaving
                  ? "Saving..."
                  : formMode === "add"
                    ? "Add Building"
                    : "Save Changes"}
              </Button>
            )}
            {isViewOnlyMode && !canManageThisForm && (
              <p className="text-sm text-muted-foreground">
                Viewing details. No edit permission.
              </p>
            )}
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
