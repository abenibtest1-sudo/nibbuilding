"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck,
  Edit,
  Trash2,
  PlusCircle,
  Loader2,
  AlertTriangle,
  BadgeAlert,
  ListChecks,
  EyeOff,
  ChevronDown,
  Eye,
  Search,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  getAllRolesAction,
  createRoleAction,
  updateRoleAction,
  deleteRoleAction,
  type RoleUpsertData,
} from "./actions";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import {
  ALL_RESOURCE_PERMISSIONS,
  type ResourcePermissionGroup,
} from "@/lib/types";
import { usePermissions } from "@/contexts/PermissionContext";
import { cn } from "@/lib/utils";
import { PaginationControls } from "@/components/custom/PaginationControls";

export interface ClientRole extends Omit<Role, "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt?: string | null;
}

const roleFormSchema = z.object({
  name: z
    .string()
    .min(2, "Role name must be at least 2 characters.")
    .max(50, "Role name cannot exceed 50 characters."),
  description: z
    .string()
    .max(255, "Description cannot exceed 255 characters.")
    .optional()
    .or(z.literal("")),
  permissions: z
    .array(z.string())
    .min(0, "Select at least one permission or none if applicable.")
    .optional()
    .default([]),
});

type RoleFormValues = z.infer<typeof roleFormSchema>;

interface RoleManagementClientPageProps {
  initialRoles: ClientRole[];
}

export function RoleManagementClientPage({
  initialRoles,
}: RoleManagementClientPageProps) {
  const { toast } = useToast();
  const [roles, setRoles] = useState<ClientRole[]>(initialRoles);
  const [isMounted, setIsMounted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [currentRoleForForm, setCurrentRoleForForm] =
    useState<ClientRole | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<ClientRole | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    hasPermission: contextHasPermission,
    isSuperAdmin,
    currentUser,
    isLoading,
  } = usePermissions();
  const canManageRoles =
    isSuperAdmin || contextHasPermission("settings:role_management:manage");
  const canViewRoles =
    isSuperAdmin ||
    contextHasPermission("settings:role_management:view") ||
    canManageRoles;

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: "", description: "", permissions: [] },
  });

  const selectedPermissions = form.watch("permissions");

  const availablePermissions = useMemo(() => {
    if (isSuperAdmin || !currentUser) {
      return ALL_RESOURCE_PERMISSIONS;
    }

    // Filter the permissions based on the current user's effective permissions
    return ALL_RESOURCE_PERMISSIONS.map((group) => {
      const filteredPermissions = group.permissions.filter((p) =>
        currentUser.effectivePermissions.includes(p.id),
      );
      return {
        ...group,
        permissions: filteredPermissions,
      };
    }).filter((group) => group.permissions.length > 0); // Only include groups that have at least one visible permission
  }, [isSuperAdmin, currentUser]);

  const displayedRoles = useMemo(() => {
    if (!searchQuery) return roles;
    const q = searchQuery.toLowerCase();
    return roles.filter((r) => {
      const name = (r.name || "").toLowerCase();
      const desc = (r.description || "").toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [roles, searchQuery]);

  const totalPages = Math.ceil(displayedRoles.length / itemsPerPage);
  const paginatedRoles = displayedRoles.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  useEffect(() => {
    setIsMounted(true);
    setRoles(initialRoles);
  }, [initialRoles]);

  const fetchRoles = async () => {
    const result = await getAllRolesAction();
    if (result.success && result.roles) {
      setRoles(result.roles as ClientRole[]);
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to refresh roles.",
        variant: "destructive",
      });
    }
  };

  const handleOpenAddForm = () => {
    if (!canManageRoles) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setFormMode("add");
    setCurrentRoleForForm(null);
    form.reset({ name: "", description: "", permissions: [] });
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (role: ClientRole) => {
    if (!canViewRoles) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setFormMode("edit");
    setCurrentRoleForForm(role);
    form.reset({
      name: role.name,
      description: role.description || "",
      permissions: role.permissions || [],
    });
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (values: RoleFormValues) => {
    if (!canManageRoles) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);

    const roleData: RoleUpsertData = {
      name: values.name.toUpperCase().replace(/\s+/g, "_"),
      description: values.description || undefined,
      permissions: values.permissions || [],
    };

    let result;
    if (formMode === "add") {
      result = await createRoleAction(roleData);
    } else if (currentRoleForForm?.id) {
      result = await updateRoleAction(currentRoleForForm.id, roleData);
    } else {
      toast({
        title: "Error",
        description: "Role ID missing for update.",
        variant: "destructive",
      });
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    if (result.success && result.role) {
      toast({
        title: "Success",
        description: `Role "${result.role.name}" ${
          formMode === "add" ? "created" : "updated"
        }.`,
      });
      setIsFormOpen(false);
      fetchRoles();
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to save role.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteRole = async () => {
    if (!roleToDelete) return;
    if (!canManageRoles) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    const result = await deleteRoleAction(roleToDelete.id);
    setIsSaving(false);
    if (result.success) {
      toast({
        title: "Role Deleted",
        description: `Role "${roleToDelete.name}" has been removed.`,
      });
      setRoleToDelete(null);
      fetchRoles();
    } else {
      toast({
        title: "Error Deleting Role",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleResourceGroupToggle = (
    group: ResourcePermissionGroup,
    isChecked: boolean,
  ) => {
    const currentPermissions = form.getValues("permissions") || [];
    const groupPermissionIds = group.permissions.map((p) => p.id);
    let newPermissions: string[];

    if (isChecked) {
      newPermissions = Array.from(
        new Set([...currentPermissions, ...groupPermissionIds]),
      );
    } else {
      newPermissions = currentPermissions.filter(
        (pId) => !groupPermissionIds.includes(pId),
      );
    }
    form.setValue("permissions", newPermissions, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const handlePermissionToggle = (permissionId: string, isChecked: boolean) => {
    const currentPermissions = form.getValues("permissions") || [];
    let newPermissions: string[];

    if (isChecked) {
      newPermissions = Array.from(
        new Set([...currentPermissions, permissionId]),
      );
    } else {
      newPermissions = currentPermissions.filter((pId) => pId !== permissionId);
    }
    form.setValue("permissions", newPermissions, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  // Wait for permissions to load to avoid transient Access Denied flashes
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isMounted && roles.length === 0 && !canViewRoles) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canViewRoles && isMounted) {
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
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="font-headline text-xl">Manage Roles</CardTitle>
          <CardDescription>
            Define user roles and their permissions within the application.
          </CardDescription>
        </div>
        {canManageRoles && (
          <Button onClick={handleOpenAddForm} disabled={isSaving}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add New Role
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search roles..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-8 h-9"
            />
          </div>
        </div>
        {displayedRoles.length === 0 && canViewRoles ? (
          <div className="text-center py-10 text-muted-foreground">
            <ShieldCheck className="mx-auto h-12 w-12 mb-4" />
            <p>
              No roles defined yet.{" "}
              {canManageRoles
                ? 'Click "Add New Role" to get started.'
                : "Contact an administrator to add roles."}
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Description
                    </TableHead>
                    <TableHead>Permissions Count</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRoles.map((role) => {
                    // Treat SUPER_ADMIN and TENANT as protected system roles
                    const isProtectedRole =
                      role.name === "SUPER_ADMIN" || role.name === "TENANT";
                    const canEditThisRole = canManageRoles && !isProtectedRole;
                    const canDeleteThisRole =
                      canManageRoles && !isProtectedRole;

                    return (
                      <TableRow key={role.id}>
                        <TableCell className="font-medium">
                          {role.name.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-xs truncate">
                          {role.description || "-"}
                        </TableCell>
                        <TableCell>
                          {role.name === "SUPER_ADMIN" ? (
                            <Badge variant="default" className="text-xs">
                              All
                            </Badge>
                          ) : role.permissions.length > 0 ? (
                            <Badge variant="secondary" className="text-xs">
                              {role.permissions.length} assigned
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              None
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEditForm(role)}
                            className="mr-1 h-8 w-8"
                            disabled={isSaving || !canEditThisRole}
                          >
                            {canEditThisRole ? (
                              <Edit className="h-4 w-4 text-blue-600" />
                            ) : (
                              <Eye className="h-4 w-4 text-blue-600" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRoleToDelete(role)}
                            className="h-8 w-8"
                            disabled={isSaving || !canDeleteThisRole}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              itemsPerPage={itemsPerPage}
              onItemsPerPageChange={handleItemsPerPageChange}
              className="mt-4"
            />
          </>
        )}
      </CardContent>

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) setCurrentRoleForForm(null);
          setIsFormOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-headline text-xl">
              {formMode === "add"
                ? "Add New Role"
                : canManageRoles
                  ? "Edit Role"
                  : "View Role Details"}
            </DialogTitle>
            <DialogDescription>
              {formMode === "add"
                ? "Create a new role and define its permissions."
                : canManageRoles
                  ? `Update the role "${currentRoleForForm?.name.replace(
                      /_/g,
                      " ",
                    )}".`
                  : `Viewing details for role "${currentRoleForForm?.name.replace(
                      /_/g,
                      " ",
                    )}".`}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleFormSubmit)}
              className="space-y-4 py-2 overflow-y-auto flex-grow pr-1"
            >
              <div>
                <FormLabel htmlFor="roleName">
                  Role Name<span className="text-destructive ml-1">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    id="roleName"
                    {...form.register("name")}
                    placeholder="Role Name"
                    className="mt-1"
                    disabled={
                      isSaving || !canManageRoles || formMode === "edit"
                    }
                  />
                </FormControl>
                <FormMessage>{form.formState.errors.name?.message}</FormMessage>
              </div>
              <div>
                <FormLabel htmlFor="roleDescription">
                  Description (Optional)
                </FormLabel>
                <FormControl>
                  <Textarea
                    id="roleDescription"
                    {...form.register("description")}
                    placeholder="Role description"
                    className="mt-1"
                    rows={2}
                    disabled={isSaving || !canManageRoles}
                  />
                </FormControl>
                <FormMessage>
                  {form.formState.errors.description?.message}
                </FormMessage>
              </div>

              <FormItem>
                <div className="mb-2">
                  <FormLabel className="text-base flex items-center">
                    <ListChecks className="mr-2 h-5 w-5 text-primary" />
                    Permissions
                  </FormLabel>
                  <p className="text-sm text-muted-foreground">
                    Select permissions for this role. Expand a section to see
                    individual permissions.
                  </p>
                </div>
                <Accordion type="multiple" className="w-full space-y-2">
                  {availablePermissions.map((group) => {
                    const groupPermissionIds = group.permissions.map(
                      (p) => p.id,
                    );
                    const selectedCount = groupPermissionIds.filter((pId) =>
                      selectedPermissions?.includes(pId),
                    ).length;
                    const isGroupChecked =
                      selectedCount === groupPermissionIds.length;
                    const isGroupIndeterminate =
                      !isGroupChecked && selectedCount > 0;

                    return (
                      <AccordionItem
                        value={group.resourceId}
                        key={group.resourceId}
                        className="border bg-background shadow-sm rounded-md overflow-hidden"
                      >
                        <AccordionPrimitive.Header className="flex w-full items-center px-4 py-3">
                          <Checkbox
                            id={`group-${group.resourceId}-checkbox`}
                            checked={isGroupChecked}
                            onCheckedChange={(checked) =>
                              handleResourceGroupToggle(group, !!checked)
                            }
                            data-indeterminate={
                              isGroupIndeterminate ? "true" : undefined
                            }
                            className="data-[state=checked]:bg-primary data-[indeterminate=true]:bg-primary/50 mr-4"
                            disabled={isSaving || !canManageRoles}
                            aria-label={`Select all permissions for ${group.resourceLabel}`}
                          />
                          <AccordionPrimitive.Trigger className="flex flex-1 items-center justify-between font-medium transition-all hover:no-underline [&[data-state=open]>svg]:rotate-180">
                            <span className="font-semibold text-base">
                              {group.resourceLabel}
                            </span>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  selectedCount > 0 ? "default" : "secondary"
                                }
                              >
                                {selectedCount} / {groupPermissionIds.length}
                              </Badge>
                              <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
                            </div>
                          </AccordionPrimitive.Trigger>
                        </AccordionPrimitive.Header>
                        <AccordionContent className="bg-muted/30 border-t">
                          <div className="p-6">
                            <div className="flex flex-row flex-wrap gap-x-6 gap-y-3">
                              {group.permissions.map((permission) => (
                                <FormItem
                                  key={permission.id}
                                  className="flex flex-row items-center space-x-2 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={selectedPermissions?.includes(
                                        permission.id,
                                      )}
                                      onCheckedChange={(checked) =>
                                        handlePermissionToggle(
                                          permission.id,
                                          !!checked,
                                        )
                                      }
                                      disabled={isSaving || !canManageRoles}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    {permission.label}
                                  </FormLabel>
                                </FormItem>
                              ))}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
                <FormMessage>
                  {form.formState.errors.permissions?.message}
                </FormMessage>
              </FormItem>

              <DialogFooter className="pt-4 mt-auto border-t">
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isSaving}>
                    Cancel
                  </Button>
                </DialogClose>
                {canManageRoles && (
                  <Button
                    type="submit"
                    disabled={isSaving || !canManageRoles}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {formMode === "add" ? "Create Role" : "Save Changes"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!roleToDelete}
        onOpenChange={(open) => {
          if (!open) setRoleToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <BadgeAlert className="text-destructive mr-2 h-5 w-5" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the role "
              {roleToDelete?.name.replace(/_/g, " ")}"? This action cannot be
              undone. Users currently assigned this role will lose its
              permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setRoleToDelete(null)}
              disabled={isSaving}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRole}
              className="bg-destructive hover:bg-destructive/90"
              disabled={isSaving || !canManageRoles}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}{" "}
              Delete Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
