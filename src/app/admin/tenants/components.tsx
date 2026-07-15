"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/custom/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Users,
  PlusCircle,
  Mail,
  Phone,
  BedDouble,
  Trash2,
  Edit3,
  AlertTriangle,
  UserSquare,
  Hash,
  PhoneIncoming,
  Contact,
  Eye,
  Loader2,
  EyeOff,
  Search,
  Lock,
  Info,
  Clipboard,
  CheckCircle,
  SearchCheck,
  UserCheck,
  UserX,
  Download,
} from "lucide-react";
import type {
  Tenant as TenantTypePrisma,
  Space as SpaceTypePrisma,
  Agreement as AgreementTypePrisma,
  Prisma,
  TenantStatus,
  AgreementStatus,
} from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  createTenantAction,
  updateTenantAction,
  findUserByPhoneAction,
  toggleTenantStatusAction,
  attachTenantToCurrentUserAction,
} from "./actions";
import { format, isAfter, addMonths, parseISO } from "date-fns";
import { usePermissions } from "@/contexts/PermissionContext";
import { PaginationControls } from "@/components/custom/PaginationControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import XLSX from "xlsx-js-style";

// Client-side specific types ensuring dates are strings
export interface ClientSpace
  extends Omit<SpaceTypePrisma, "createdAt" | "updatedAt" | "tenantId"> {
  createdAt: string;
  updatedAt: string;
  tenantId?: string | null;
}

export interface ClientAgreement
  extends Omit<
    AgreementTypePrisma,
    | "startDate"
    | "endDate"
    | "nextPaymentDueDate"
    | "createdAt"
    | "updatedAt"
    | "initialPaymentDate"
    | "space"
    | "disabledAgreements"
  > {
  startDate: string;
  endDate?: string | null;
  nextPaymentDueDate: string;
  createdAt: string;
  updatedAt: string;
  initialPaymentDate?: string | null;
  space: ClientSpace | null;
  status: AgreementStatus;
}

export interface TenantWithRelations
  extends Omit<
    TenantTypePrisma,
    "createdAt" | "updatedAt" | "rentedSpace" | "agreements"
  > {
  createdAt: string;
  updatedAt: string;
  status: TenantStatus;
  rentedSpace: ClientSpace | null;
  agreements: ClientAgreement[];
  buildingStatuses?: { buildingId: string; status: TenantStatus }[];
}
export interface SpaceWithTenant
  extends Omit<SpaceTypePrisma, "createdAt" | "updatedAt" | "tenant"> {
  createdAt: string;
  updatedAt: string;
  tenant:
    | (Omit<TenantTypePrisma, "createdAt" | "updatedAt" | "rentedSpaceId"> & {
        createdAt: string;
        updatedAt: string;
        rentedSpaceId?: string | null;
      })
    | null;
}

const phoneRegex = /^(09|07)\d{8}$/;
const phoneErrorMessage =
  "Phone number must start with 09 or 07 and be 10 digits long (e.g., 0912345678).";

const tenantFormSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Tenant name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  phone: z.string().regex(phoneRegex, { message: phoneErrorMessage }),
  alternativePhone: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((val) => !val || phoneRegex.test(val), {
      message: phoneErrorMessage,
    }),
  nationalId: z
    .string()
    .length(16, { message: "National ID must be exactly 16 digits." })
    .regex(/^\d+$/, { message: "National ID must only contain digits." }),
  representativeName: z.string().optional().or(z.literal("")),
  representativePhone: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((val) => !val || phoneRegex.test(val), {
      message: phoneErrorMessage,
    }),
});

type TenantFormValues = z.infer<typeof tenantFormSchema>;

export function TenantsClientPage({
  initialTenants,
  initialSpaces,
  initialAgreements,
  currentBuildingId,
  managedBuildingIds,
}: {
  initialTenants: TenantWithRelations[];
  initialSpaces: SpaceWithTenant[];
  initialAgreements: ClientAgreement[];
  currentBuildingId?: string | undefined;
  managedBuildingIds?: string[] | undefined;
}) {
  const [tenants, setTenantsState] =
    useState<TenantWithRelations[]>(initialTenants);
  const [spaces, setSpacesState] = useState<SpaceWithTenant[]>(initialSpaces);
  const [agreements, setAgreementsState] =
    useState<ClientAgreement[]>(initialAgreements);

  const [isMounted, setIsMounted] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [currentTenantForForm, setCurrentTenantForForm] =
    useState<TenantWithRelations | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null,
  );
  const [searchPhone, setSearchPhone] = useState("");
  const [isUserFound, setIsUserFound] = useState(false);
  // When a tenant record already exists in the DB for the searched phone,
  // we store it here and display its details in the form in read-only mode.
  const [foundExistingTenant, setFoundExistingTenant] =
    useState<TenantWithRelations | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<TenantStatus | "All">(
    "Active",
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(3);

  const { hasPermission, isSuperAdmin, currentUser, handleApiCall } =
    usePermissions();
  const canCreateTenants = isSuperAdmin || hasPermission("tenant:create");
  const canEditTenants = isSuperAdmin || hasPermission("tenant:edit");
  const canChangeStatus = isSuperAdmin || hasPermission("tenant:status");
  const canExportTenants = isSuperAdmin || hasPermission("tenant:export");
  const canViewTenants =
    isSuperAdmin ||
    hasPermission("tenant:view") ||
    canCreateTenants ||
    canEditTenants ||
    canChangeStatus;

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      alternativePhone: "",
      nationalId: "",
      representativeName: "",
      representativePhone: "",
    },
  });

  const filteredTenants = tenants.filter((tenant) => {
    const matchForCurrent = tenant.buildingStatuses?.find(
      (bs) =>
        bs.buildingId === (currentBuildingId ?? tenant.rentedSpace?.buildingId),
    )?.status;

    const anyManagedInactive =
      managedBuildingIds && tenant.buildingStatuses
        ? tenant.buildingStatuses.some(
            (bs) =>
              managedBuildingIds.includes(bs.buildingId) &&
              bs.status === "Inactive",
          )
        : false;

    const effectiveStatus =
      matchForCurrent ??
      (anyManagedInactive ? ("Inactive" as TenantStatus) : tenant.status);

    if (filterStatus !== "All" && effectiveStatus !== filterStatus) {
      return false;
    }

    const searchMatch =
      !searchTerm ||
      tenant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tenant.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tenant.phone && tenant.phone.includes(searchTerm));

    return searchMatch;
  });

  const totalPages = Math.ceil(filteredTenants.length / itemsPerPage);

  useEffect(() => {
    setIsMounted(true);
    setTenantsState(initialTenants);
    setSpacesState(initialSpaces);
    setAgreementsState(initialAgreements);
  }, [initialTenants, initialSpaces, initialAgreements]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus]);

  useEffect(() => {
    const newTotalPages = Math.ceil(filteredTenants.length / itemsPerPage);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages);
    }
  }, [filteredTenants.length, itemsPerPage, currentPage]);

  const paginatedTenants = filteredTenants.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  const getSpaceDetails = (space: ClientSpace | null | undefined): string => {
    if (!space) return "No space assigned";
    return `${space.spaceIdName}, ${space.buildingName}`;
  };

  const handleOpenAddForm = () => {
    if (!canCreateTenants) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setFormMode("add");
    setCurrentTenantForForm(null);
    setGeneratedPassword(null);
    setSearchPhone("");
    setIsUserFound(false);
    setFoundExistingTenant(null);
    form.reset({
      name: "",
      email: "",
      phone: "",
      alternativePhone: "",
      nationalId: "",
      representativeName: "",
      representativePhone: "",
    });
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (tenant: TenantWithRelations) => {
    if (!canEditTenants && !canViewTenants) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setFormMode("edit");
    setGeneratedPassword(null);
    setCurrentTenantForForm(tenant);
    setIsUserFound(false);
    setFoundExistingTenant(null);
    form.reset({
      name: tenant.name,
      email: tenant.email,
      phone: tenant.phone || "",
      alternativePhone: tenant.alternativePhone || "",
      nationalId: tenant.nationalId || "",
      representativeName: tenant.representativeName || "",
      representativePhone: tenant.representativePhone || "",
    });
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (values: TenantFormValues) => {
    // If an existing tenant was found, attach it server-side to the current
    // user (set createdBy) so it persists and remains visible after refresh.
    if (foundExistingTenant) {
      const result = await handleApiCall(() =>
        attachTenantToCurrentUserAction(foundExistingTenant.id),
      );
      if (result && result.success) {
        // Update UI optimistically and refresh server state
        setTenantsState((prev) => {
          if (prev.some((t) => t.id === result.tenant.id)) return prev;
          const prepared = {
            ...result.tenant,
            createdAt: result.tenant.createdAt
              ? new Date(result.tenant.createdAt).toISOString()
              : new Date().toISOString(),
            updatedAt: result.tenant.updatedAt
              ? new Date(result.tenant.updatedAt).toISOString()
              : new Date().toISOString(),
            rentedSpace: null,
            agreements: [],
          } as TenantWithRelations;
          return [prepared, ...prev];
        });
        toast({
          title: "Tenant Attached",
          description: `${foundExistingTenant.name} is now attached to your account.`,
        });
        setFoundExistingTenant(null);
        setIsFormOpen(false);
        form.reset({ name: "", email: "", phone: "" });
        router.refresh();
        return;
      } else {
        toast({
          title: "Error",
          description: result?.error || "Failed to attach tenant.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }
    }
    if (
      (formMode === "add" && !canCreateTenants) ||
      (formMode === "edit" && !canEditTenants)
    ) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);

    let result;
    if (formMode === "add") {
      const createData = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        alternativePhone: values.alternativePhone || undefined,
        nationalId: values.nationalId || undefined,
        representativeName: values.representativeName || undefined,
        representativePhone: values.representativePhone || undefined,
      };
      result = await handleApiCall(() => createTenantAction(createData));
    } else if (currentTenantForForm?.id) {
      const updateData = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        alternativePhone: values.alternativePhone || undefined,
        nationalId: values.nationalId || undefined,
        representativeName: values.representativeName || undefined,
        representativePhone: values.representativePhone || undefined,
      };
      result = await handleApiCall(() =>
        updateTenantAction(
          currentTenantForForm.id,
          updateData as Prisma.TenantUpdateInput,
        ),
      );
    } else {
      toast({
        title: "Error",
        description: "Tenant ID missing for update.",
        variant: "destructive",
      });
      setIsSaving(false);
      return;
    }

    if (!result) {
      // API call was handled by context
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    if (result.success) {
      setIsFormOpen(false);
      let toastDescription = `${result.tenant?.name} has been ${
        formMode === "add" ? "added" : "updated"
      }.`;
      if (formMode === "add" && (result as any).tempPassword) {
        toastDescription = `A user account has been created for ${result.tenant?.name}. The temporary password is shown in the user list.`;
      } else if (formMode === "add" && (result as any).message) {
        toastDescription = (result as any).message;
      }

      toast({
        title: `Tenant ${formMode === "add" ? "Added" : "Updated"}`,
        description: toastDescription,
      });

      setCurrentTenantForForm(null);
      form.reset({ name: "", email: "", phone: "" });
      router.refresh();
    } else {
      toast({
        title: `Error ${formMode === "add" ? "Adding" : "Updating"} Tenant`,
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleToggleStatus = async (tenant: TenantWithRelations) => {
    const matchForCurrent = tenant.buildingStatuses?.find(
      (bs) =>
        bs.buildingId === (currentBuildingId ?? tenant.rentedSpace?.buildingId),
    )?.status;

    const anyManagedInactive =
      managedBuildingIds && tenant.buildingStatuses
        ? tenant.buildingStatuses.some(
            (bs) =>
              managedBuildingIds.includes(bs.buildingId) &&
              bs.status === "Inactive",
          )
        : false;

    const effectiveStatus =
      matchForCurrent ??
      (anyManagedInactive ? ("Inactive" as TenantStatus) : tenant.status);

    const newStatus = effectiveStatus === "Active" ? "Inactive" : "Active";

    const result = await handleApiCall(() =>
      toggleTenantStatusAction(
        tenant.id,
        newStatus === "Active",
        currentBuildingId ?? (tenant.rentedSpace?.buildingId || undefined),
      ),
    );

    if (result?.success) {
      // If server returned authoritative tenant data, merge it into local state
      if ((result as any).tenant) {
        const updated = (result as any).tenant as any;
        setTenantsState((prev) =>
          prev.map((t) => {
            if (t.id !== tenant.id) return t;

            const bs = (updated.buildingStatuses || []).map((s: any) => ({
              buildingId: s.buildingId,
              status: s.status as TenantStatus,
            }));

            return {
              ...t,
              status: updated.status || t.status,
              buildingStatuses: bs,
              rentedSpace: updated.rentedSpace
                ? {
                    ...t.rentedSpace,
                    buildingId: updated.rentedSpace.buildingId,
                    buildingName: updated.rentedSpace.buildingName,
                  }
                : t.rentedSpace,
            } as TenantWithRelations;
          }),
        );
      } else {
        // Fallback: optimistic update if no tenant payload provided
        setTenantsState((prev) =>
          prev.map((t) => {
            if (t.id !== tenant.id) return t;
            const bs = t.buildingStatuses ? [...t.buildingStatuses] : [];
            const targetBuildingId = tenant.rentedSpace?.buildingId;
            if (targetBuildingId) {
              const idx = bs.findIndex(
                (x) => x.buildingId === targetBuildingId,
              );
              if (idx >= 0)
                bs[idx] = {
                  buildingId: targetBuildingId,
                  status: newStatus as TenantStatus,
                };
              else
                bs.push({
                  buildingId: targetBuildingId,
                  status: newStatus as TenantStatus,
                });
              return { ...t, buildingStatuses: bs } as TenantWithRelations;
            }

            // Global toggle (no building) — update global status and all building statuses
            return {
              ...t,
              status: newStatus as TenantStatus,
              buildingStatuses: bs.map((x) => ({
                ...x,
                status: newStatus as TenantStatus,
              })),
            } as TenantWithRelations;
          }),
        );
      }

      toast({
        title: "Status Updated",
        description: tenant.rentedSpace?.buildingName
          ? `${tenant.name} is now ${newStatus} for ${tenant.rentedSpace.buildingName}.`
          : `${tenant.name} is now ${newStatus}.`,
      });

      // Refresh server data in background to ensure consistency
      router.refresh();
    } else if (result?.error) {
      toast({
        title: "Update Failed",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const findActiveAgreementForTenant = (
    tenantId: string,
  ): ClientAgreement | undefined => {
    return agreements.find((ag) => {
      if (ag.tenantId !== tenantId) return false;
      const agreementEndDate = addMonths(
        parseISO(ag.startDate),
        ag.paymentTermMonths,
      );
      return isAfter(agreementEndDate, new Date());
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Password copied to clipboard." });
  };

  const handleFindUser = async () => {
    if (!searchPhone) return;
    setIsSaving(true);
    const result = await handleApiCall(() =>
      findUserByPhoneAction(searchPhone),
    );
    if (!result) {
      setIsSaving(false);
      return;
    }
    setIsSaving(false);

    if (result.success && result.user) {
      toast({
        title: "User Found",
        description: "Tenant details have been auto-filled.",
      });
      // If the server returned an existing tenant record, populate the form
      // with tenant details but keep fields read-only and allow the user to
      // simply "select" (attach) that tenant to the UI on Save rather than
      // creating/updating it in the database. Otherwise prefill create form.
      // @ts-ignore - tenant may be appended by the server action when found
      const foundTenant = result.tenant;

      if (foundTenant && foundTenant.id) {
        const prepared: TenantWithRelations = {
          id: foundTenant.id,
          name: foundTenant.name,
          email: foundTenant.email,
          phone: foundTenant.phone,
          alternativePhone: foundTenant.alternativePhone || null,
          nationalId: foundTenant.nationalId || null,
          representativeName: foundTenant.representativeName || null,
          representativePhone: foundTenant.representativePhone || null,
          createdAt: new Date(foundTenant.createdAt).toISOString(),
          updatedAt: new Date(
            foundTenant.updatedAt || foundTenant.createdAt,
          ).toISOString(),
          status:
            (foundTenant.status as TenantStatus) || ("Active" as TenantStatus),
          rentedSpace: null,
          agreements: [],
          buildingStatuses: (foundTenant as any).buildingStatuses || [],
          // fill optional relationship fields with sensible defaults
          buildingId: (foundTenant as any).buildingId || null,
          userId: (foundTenant as any).userId || null,
          rentedSpaceId: (foundTenant as any).rentedSpaceId || null,
          createdById: (foundTenant as any).createdById || null,
        };

        setFoundExistingTenant(prepared);
        // Fill the form inputs (they will be disabled when foundExistingTenant is set)
        form.reset({
          name: prepared.name,
          email: prepared.email,
          phone: prepared.phone || searchPhone,
          alternativePhone: prepared.alternativePhone || "",
          nationalId: prepared.nationalId || "",
          representativeName: prepared.representativeName || "",
          representativePhone: prepared.representativePhone || "",
        });
        setFormMode("add");
        setIsUserFound(false);
      } else {
        form.reset({
          name: result.user.name,
          email: result.user.email,
          phone: searchPhone,
          alternativePhone: "",
          nationalId: result.user.nationalId || "",
          representativeName: "",
          representativePhone: "",
        });
        setIsUserFound(true);
        setFormMode("add");
        setCurrentTenantForForm(null);
        setFoundExistingTenant(null);
      }
    } else {
      toast({
        title: "Not Found",
        description: result.error,
        variant: "destructive",
      });
      setIsUserFound(false);
    }
  };

  const exportToExcel = () => {
    const dataToExport = filteredTenants.map((t) => {
      const asAny = t as unknown as Record<string, any>;

      return {
        "Tenant ID": t.id,
        Name: t.name,
        Email: t.email,
        Phone: t.phone,
        "Tenant Address": asAny.address || "",
        "National ID": t.nationalId,
        Status: t.status,
        "Created Date": new Date(t.createdAt).toLocaleString(),
        "Created By": asAny.createdBy?.name || "",
        "Rented Spaces":
          t.agreements
            .filter(
              (ag) =>
                ag.status === "Active" &&
                isAfter(
                  addMonths(parseISO(ag.startDate), ag.paymentTermMonths),
                  new Date(),
                ),
            )
            .map((ag) => ag.space?.spaceIdName)
            .join(", ") || "None",
        Representative: t.representativeName || "N/A",
        "Rep. Phone": t.representativePhone || "N/A",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tenants");
    XLSX.writeFile(workbook, "Tenants_Export.xlsx");
    toast({
      title: "Exporting",
      description: "Excel file download has started.",
    });
  };

  if (!isMounted) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!canViewTenants && isMounted) {
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
    <div className="animate-fadeIn">
      <PageHeader
        title="Manage Tenants"
        icon={Users}
        description="Add, view, and manage tenant information and their assigned spaces."
        actions={
          <div className="flex flex-col sm:flex-row gap-2">
            {canExportTenants && (
              <Button onClick={exportToExcel} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
            )}
            {canCreateTenants && (
              <Button
                onClick={handleOpenAddForm}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                size="sm"
                disabled={isSaving}
              >
                <PlusCircle className="mr-2 h-5 w-5" /> Add New Tenant
              </Button>
            )}
          </div>
        }
      />

      <Dialog
        open={isFormOpen}
        onOpenChange={(isOpen) => {
          setIsFormOpen(isOpen);
          if (!isOpen) {
            form.reset({ name: "", email: "", phone: "" });
            setCurrentTenantForForm(null);
            setGeneratedPassword(null);
            setIsUserFound(false);
            setFoundExistingTenant(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">
              {formMode === "add"
                ? "Add New Tenant"
                : canEditTenants
                ? "Edit Tenant"
                : "View Tenant"}
            </DialogTitle>
            <DialogDescription>
              {formMode === "add"
                ? "Enter details to create a tenant profile and a user account for the portal."
                : canEditTenants
                ? "Update the tenant's details."
                : "Viewing tenant details."}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleFormSubmit)}
              className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-2"
            >
              {formMode === "add" && (
                <div className="space-y-2 p-3 bg-secondary/30 border rounded-md">
                  <Label htmlFor="search-phone" className="font-medium">
                    Find Existing User
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="search-phone"
                      placeholder="Enter phone number to find user..."
                      value={searchPhone}
                      onChange={(e) => setSearchPhone(e.target.value)}
                      disabled={isSaving}
                    />
                    <Button
                      type="button"
                      onClick={handleFindUser}
                      disabled={isSaving || !searchPhone}
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <SearchCheck className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <UserSquare className="mr-2 h-4 w-4 text-primary" />
                      Name<span className="text-destructive ml-1">*</span>
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        placeholder="Full Name"
                        {...field}
                        disabled={
                          isSaving ||
                          isUserFound ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <Mail className="mr-2 h-4 w-4 text-primary" />
                      Email<span className="text-destructive ml-1">*</span>
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="Email Address"
                        {...field}
                        disabled={
                          isSaving ||
                          isUserFound ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <Phone className="mr-2 h-4 w-4 text-primary" />
                      Phone Number
                      <span className="text-destructive ml-1">*</span>
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="Phone Number"
                        {...field}
                        value={field.value ?? ""}
                        disabled={
                          isSaving ||
                          isUserFound ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="alternativePhone"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <PhoneIncoming className="mr-2 h-4 w-4 text-primary" />
                      Alternative Phone
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="Alternative Phone Number"
                        {...field}
                        value={field.value ?? ""}
                        disabled={
                          isSaving ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nationalId"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <Hash className="mr-2 h-4 w-4 text-primary" />
                      National ID Number
                      <span className="text-destructive ml-1">*</span>
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        placeholder="National ID Number"
                        {...field}
                        value={field.value ?? ""}
                        disabled={
                          isSaving ||
                          isUserFound ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="representativeName"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <Contact className="mr-2 h-4 w-4 text-primary" />
                      Representative Name
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        placeholder="Representative Name"
                        {...field}
                        value={field.value ?? ""}
                        disabled={
                          isSaving ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="representativePhone"
                render={({ field }) => (
                  <FormItem>
                    {" "}
                    <FormLabel className="flex items-center">
                      <Phone className="mr-2 h-4 w-4 text-primary" />
                      Representative Phone
                    </FormLabel>{" "}
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="Representative Phone Number"
                        {...field}
                        value={field.value ?? ""}
                        disabled={
                          isSaving ||
                          !!foundExistingTenant ||
                          (!canEditTenants && formMode === "edit")
                        }
                      />
                    </FormControl>{" "}
                    <FormMessage />{" "}
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isSaving}>
                    Cancel
                  </Button>
                </DialogClose>
                {((formMode === "add" && canCreateTenants) ||
                  (formMode === "edit" && canEditTenants)) && (
                  <Button
                    type="submit"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {foundExistingTenant
                      ? "Select Tenant"
                      : formMode === "add"
                      ? "Add Tenant"
                      : "Save Changes"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card className="mb-6 shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Filter by name, email, or phone..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="status-filter">Status:</Label>
            <div className="flex items-center space-x-2">
              <Button
                variant={filterStatus === "All" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("All")}
              >
                All
              </Button>
              <Button
                variant={filterStatus === "Active" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Active")}
              >
                Active
              </Button>
              <Button
                variant={filterStatus === "Inactive" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Inactive")}
              >
                Inactive
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredTenants.length === 0 && !isSaving && isMounted ? (
        <Card className="text-center py-12 shadow-sm">
          <CardContent>
            <Users className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2 font-headline">
              {searchTerm || filterStatus !== "Active"
                ? "No Tenants Found"
                : "No Active Tenants"}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? "No tenants match your search."
                : filterStatus === "Inactive"
                ? "There are no inactive tenants."
                : "Add tenants by clicking the button above."}
            </p>
            {!searchTerm && canCreateTenants && (
              <Button onClick={handleOpenAddForm} disabled={isSaving}>
                <PlusCircle className="mr-2 h-5 w-5" /> Add New Tenant
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {paginatedTenants.map((tenant) => {
              const matchForCurrent = tenant.buildingStatuses?.find(
                (bs) =>
                  bs.buildingId ===
                  (currentBuildingId ?? tenant.rentedSpace?.buildingId),
              )?.status;

              const anyManagedInactive =
                managedBuildingIds && tenant.buildingStatuses
                  ? tenant.buildingStatuses.some(
                      (bs) =>
                        managedBuildingIds.includes(bs.buildingId) &&
                        bs.status === "Inactive",
                    )
                  : false;

              const effectiveStatus =
                matchForCurrent ??
                (anyManagedInactive
                  ? ("Inactive" as TenantStatus)
                  : tenant.status);
              const activeAgreements = tenant.agreements.filter((ag) => {
                if (!ag.startDate || !ag.paymentTermMonths) return false;
                const agreementEndDate = addMonths(
                  parseISO(ag.startDate),
                  ag.paymentTermMonths,
                );
                return isAfter(agreementEndDate, new Date());
              });

              const rentedSpaces = [
                ...new Map(
                  activeAgreements
                    .map((ag) => ag.space)
                    .filter(Boolean)
                    .map((space) => [space!.id, space]),
                ).values(),
              ];

              const tenantActiveAgreement = findActiveAgreementForTenant(
                tenant.id,
              );

              const nameParts = tenant.name.split(" ");
              const initials =
                (nameParts[0]?.[0] || "") +
                (nameParts.length > 1
                  ? nameParts[nameParts.length - 1]?.[0] || ""
                  : "");

              return (
                <Card
                  key={tenant.id}
                  className="flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300 transform hover:-translate-y-1"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <Avatar>
                          <AvatarFallback>
                            {initials.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <CardTitle className="font-headline text-xl">
                            {tenant.name}
                          </CardTitle>
                          <CardDescription className="text-sm flex items-center">
                            <Mail className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            {tenant.email}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge
                        variant={
                          effectiveStatus === "Active"
                            ? "secondary"
                            : "destructive"
                        }
                        className="capitalize"
                      >
                        {effectiveStatus}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm flex-grow">
                    {tenant.phone && (
                      <div className="flex items-center text-muted-foreground">
                        <Phone className="mr-2 h-4 w-4 text-primary" /> Phone:{" "}
                        {tenant.phone}
                      </div>
                    )}
                    <div className="flex items-start">
                      <BedDouble className="mr-2 h-4 w-4 shrink-0 mt-1 text-primary" />
                      <div>
                        <span className="font-medium">Rented Spaces</span>
                        {rentedSpaces.length > 0 ? (
                          <ul className="list-none text-muted-foreground text-xs space-y-0.5 mt-1">
                            {rentedSpaces.map((space) => (
                              <li key={space!.id}>
                                {space!.spaceIdName}, {space!.buildingName}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">
                            No active spaces
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground pt-2">
                      Joined:{" "}
                      {tenant.createdAt
                        ? format(parseISO(tenant.createdAt), "PP")
                        : "N/A"}
                    </p>
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <div className="flex w-full flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        {canChangeStatus && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center space-x-2">
                                <Switch
                                  id={`status-switch-${tenant.id}`}
                                  checked={effectiveStatus === "Active"}
                                  onCheckedChange={() =>
                                    handleToggleStatus(tenant)
                                  }
                                  aria-label="Toggle tenant status"
                                />
                                <Label
                                  htmlFor={`status-switch-${tenant.id}`}
                                  className="text-xs text-muted-foreground"
                                >
                                  {effectiveStatus}
                                </Label>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Toggle Active/Inactive status</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {(canEditTenants || canViewTenants) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleOpenEditForm(tenant)}
                              >
                                {canEditTenants ? (
                                  <Edit3 className="h-4 w-4 text-blue-600" />
                                ) : (
                                  <Eye className="h-4 w-4 text-blue-600" />
                                )}
                                <span className="sr-only">
                                  {canEditTenants
                                    ? "Edit Tenant"
                                    : "View Tenant"}
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {canEditTenants ? "Edit Tenant" : "View Tenant"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            onItemsPerPageChange={handleItemsPerPageChange}
            className="mt-8"
          />
        </>
      )}
    </div>
  );
}
