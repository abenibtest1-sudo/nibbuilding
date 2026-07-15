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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  PlusCircle,
  MapPin,
  Maximize,
  Percent,
  Banknote,
  Trash2,
  Edit3,
  Loader2,
  EyeOff,
  Eye,
  Clock,
  Search,
  Download,
  CheckCircle,
  XCircle,
} from "lucide-react";
import type {
  Building as BuildingTypePrisma,
  Space as SpaceTypePrisma,
  Prisma,
} from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createSpaceAction,
  updateSpaceAction,
  deleteSpaceAction,
  toggleSpaceStatusAction,
} from "./actions";
import { usePermissions } from "@/contexts/PermissionContext";
import { PaginationControls } from "@/components/custom/PaginationControls";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import XLSX from "xlsx-js-style";
import { Badge } from "@/components/ui/badge";

const spaceFormSchema = z.object({
  buildingId: z.string().min(1, "Building is required."),
  spaceIdName: z.string().min(1, "Space ID/Name is required."),
  area: z.coerce.number().min(0.1, "Area must be a positive number."),
  floor: z.string().min(1, "Floor is required."),
  utilityProrationShare: z.coerce
    .number()
    .min(0, "Proration cannot be negative.")
    .max(100, "Proration cannot exceed 100%."),
  monthlyRentalPrice: z.coerce
    .number()
    .min(0, "Monthly rent must be a non-negative number."),
});

type SpaceFormValues = z.infer<typeof spaceFormSchema>;

export interface SpaceWithBuildingName extends SpaceTypePrisma {
  buildingName: string;
  createdAt: string;
  updatedAt: string;
  availabilityDate?: string | null;
}

export function SpacesClientPage({
  initialSpaces,
  initialBuildings,
}: {
  initialSpaces: SpaceWithBuildingName[];
  initialBuildings: BuildingTypePrisma[];
}) {
  const [spaces, setSpaces] = useState<SpaceWithBuildingName[]>(initialSpaces);
  const [buildings, setBuildings] =
    useState<BuildingTypePrisma[]>(initialBuildings);
  const [isMounted, setIsMounted] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [currentSpaceId, setCurrentSpaceId] = useState<string | null>(null);
  const [spaceToDelete, setSpaceToDelete] =
    useState<SpaceWithBuildingName | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterOccupancy, setFilterOccupancy] = useState<
    "All" | "Vacant" | "Occupied"
  >("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(3);

  const { hasPermission, isSuperAdmin, handleApiCall } = usePermissions();
  const canCreateSpaces = isSuperAdmin || hasPermission("space:create");
  const canEditSpaces = isSuperAdmin || hasPermission("space:edit");
  const canDeleteSpaces = isSuperAdmin || hasPermission("space:delete");
  const canViewSpaces =
    isSuperAdmin ||
    hasPermission("space:view") ||
    canCreateSpaces ||
    canEditSpaces ||
    canDeleteSpaces;
  const canExportSpaces = isSuperAdmin || hasPermission("space:export");
  const canApproveSpaces = isSuperAdmin || hasPermission("space:approve");

  const form = useForm<SpaceFormValues>({
    resolver: zodResolver(spaceFormSchema),
    defaultValues: {
      buildingId: "",
      spaceIdName: "",
      area: 0,
      floor: "",
      utilityProrationShare: 0,
      monthlyRentalPrice: 0,
    },
  });

  const filteredSpaces = spaces.filter((space) => {
    const searchMatch =
      !searchTerm ||
      space.spaceIdName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      space.buildingName.toLowerCase().includes(searchTerm.toLowerCase());

    const occupancyMatch =
      filterOccupancy === "All" ||
      (filterOccupancy === "Vacant" && !space.isOccupied) ||
      (filterOccupancy === "Occupied" && space.isOccupied);

    return searchMatch && occupancyMatch;
  });

  const totalPages = Math.ceil(filteredSpaces.length / itemsPerPage);

  useEffect(() => {
    setIsMounted(true);
    setSpaces(initialSpaces);
    setBuildings(initialBuildings);
  }, [initialSpaces, initialBuildings]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterOccupancy]);

  useEffect(() => {
    const newTotalPages = Math.ceil(filteredSpaces.length / itemsPerPage);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages);
    }
  }, [filteredSpaces.length, itemsPerPage, currentPage]);

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  const paginatedSpaces = filteredSpaces.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const handleFormSubmit = async (values: SpaceFormValues) => {
    if (
      (formMode === "add" && !canCreateSpaces) ||
      (formMode === "edit" && !canEditSpaces)
    ) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);

    const selectedBuilding = buildings.find((b) => b.id === values.buildingId);

    const spaceInputData = {
      buildingId: values.buildingId,
      buildingName: selectedBuilding?.name || "Unknown Building",
      spaceIdName: values.spaceIdName.trim(),
      area: values.area,
      floor: values.floor.trim(),
      utilityProrationShare: values.utilityProrationShare / 100, // Convert percentage to decimal
      monthlyRentalPrice: values.monthlyRentalPrice,
    };

    let result;
    if (formMode === "add") {
      result = await handleApiCall(() =>
        createSpaceAction(spaceInputData as Prisma.SpaceCreateInput),
      );
    } else {
      if (!currentSpaceId) {
        toast({
          title: "Error",
          description: "Space ID is missing for update.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }
      result = await handleApiCall(() =>
        updateSpaceAction(
          currentSpaceId,
          spaceInputData as Prisma.SpaceUpdateInput,
        ),
      );
    }

    if (!result) {
      // API call was handled by context (e.g. auth error)
      setIsSaving(false);
      return;
    }

    setIsSaving(false);

    if (result.success) {
      toast({
        title: `Space ${formMode === "add" ? "Added" : "Updated"}`,
        description: `${result.space?.spaceIdName} has been saved.`,
      });
      setIsFormOpen(false);
      form.reset();
      router.refresh();
    } else {
      toast({
        title: `Error ${formMode === "add" ? "Adding" : "Updating"} Space`,
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleSetSpaceStatus = async (
    spaceId: string,
    status: "Active" | "Rejected",
  ) => {
    if (!canApproveSpaces) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }

    const rejectionReason =
      status === "Rejected"
        ? window.prompt("Rejection reason (optional):") || undefined
        : undefined;

    setIsSaving(true);
    const result = await handleApiCall(() =>
      toggleSpaceStatusAction(spaceId, status as any, rejectionReason),
    );
    setIsSaving(false);

    if (!result) return;

    if (result.success) {
      toast({
        title: "Status Updated",
        description:
          status === "Active" ? "Space approved." : "Space rejected.",
      });
      router.refresh();
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to update space status.",
        variant: "destructive",
      });
    }
  };

  const openAddForm = () => {
    if (!canCreateSpaces) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    const activeBuildings = buildings.filter((b) => b.status === "Active");
    if (activeBuildings.length === 0) {
      toast({
        title: "No Active Buildings",
        description:
          "Please add and activate a building first before adding spaces.",
        variant: "destructive",
      });
      return;
    }
    setFormMode("add");
    setCurrentSpaceId(null);
    form.reset({ buildingId: activeBuildings[0]?.id || "" });
    setIsFormOpen(true);
  };

  const openEditForm = (space: SpaceWithBuildingName) => {
    if (!canEditSpaces && !canViewSpaces) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setFormMode("edit");
    setCurrentSpaceId(space.id);
    form.reset({
      buildingId: space.buildingId,
      spaceIdName: space.spaceIdName,
      area: Number(space.area),
      floor: space.floor,
      utilityProrationShare: Number(space.utilityProrationShare) * 100,
      monthlyRentalPrice: Number(space.monthlyRentalPrice),
    });
    setIsFormOpen(true);
  };

  const handleDeleteSpace = async () => {
    if (!spaceToDelete) return;
    if (!canDeleteSpaces) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    const result = await handleApiCall(() =>
      deleteSpaceAction(spaceToDelete.id),
    );
    if (!result) {
      // API call was handled by context
      setIsSaving(false);
      setSpaceToDelete(null);
      return;
    }
    setIsSaving(false);
    if (result.success) {
      toast({
        title: "Space Deleted",
        description: "The space has been removed.",
      });
      setSpaceToDelete(null);
      router.refresh();
    } else {
      toast({
        title: "Error Deleting Space",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const exportToExcel = () => {
    const dataToExport = filteredSpaces.map((s) => {
      // Some fields (category, createdBy, maintenance flag) may not exist on older schema
      const asAny = s as unknown as Record<string, any>;
      const spaceCategory = asAny.category || asAny.spaceCategory || "N/A";
      const createdBy = asAny.createdByName || asAny.createdBy || "N/A";
      const status = asAny.isUnderMaintenance
        ? "UnderMaintenance"
        : s.isOccupied
        ? "Occupied"
        : "Vacant";

      return {
        "Space ID": s.id,
        "Space Name": s.spaceIdName,
        Building: s.buildingName,
        Floor: s.floor,
        "Area (m²)": s.area,
        "Proration Rate (%)": (Number(s.utilityProrationShare) * 100).toFixed(
          2,
        ),
        "Monthly Rent (Birr)": Number(s.monthlyRentalPrice),
        "Created Date": s.createdAt || "",
        Status: status,
        "Created By":
          asAny.createdByName ||
          (asAny.createdBy && asAny.createdBy.name) ||
          createdBy,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Spaces");
    const fileName = `Spaces_Export_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
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

  if (!canViewSpaces && isMounted) {
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

  const activeBuildings = buildings.filter((b) => b.status === "Active");

  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Manage Spaces"
        icon={Building2}
        description="Add, view, and manage rental spaces."
        actions={
          <div className="flex flex-col sm:flex-row gap-2">
            {canExportSpaces && (
              <>
                <Button onClick={exportToExcel} variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
              </>
            )}
            {canCreateSpaces && (
              <Button
                onClick={openAddForm}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                size="sm"
                disabled={buildings.length === 0 || isSaving}
              >
                <PlusCircle className="mr-2 h-5 w-5" /> Add New Space
              </Button>
            )}
          </div>
        }
      />
      {activeBuildings.length === 0 && isMounted && (
        <Card className="mb-6 bg-yellow-50 border-yellow-300">
          <CardHeader>
            <CardTitle className="text-yellow-700">
              No Active Buildings Found
            </CardTitle>
            <CardDescription className="text-yellow-600">
              You need at least one active building before you can add spaces.
              Please go to the "Buildings" page to register or activate a
              building.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              {formMode === "add"
                ? "Add New Space"
                : canEditSpaces
                ? "Edit Space"
                : "View Space"}
            </DialogTitle>
            <DialogDescription>
              {formMode === "add"
                ? "Fill in the details for the rental space."
                : canEditSpaces
                ? "Update the space details."
                : "Viewing space details."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)}>
              <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
                <FormField
                  control={form.control}
                  name="buildingId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Building<span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={isSaving || !canCreateSpaces}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a building" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeBuildings.map((building) => (
                            <SelectItem key={building.id} value={building.id}>
                              {building.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="spaceIdName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Space ID/Name
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Office 101"
                          {...field}
                          disabled={isSaving || !canEditSpaces}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="area"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Area (m²)
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Area in square meters"
                          {...field}
                          disabled={isSaving || !canEditSpaces}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="floor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Floor<span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. 1st Floor, Ground"
                          {...field}
                          disabled={isSaving || !canEditSpaces}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="utilityProrationShare"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Proration Share (%)
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Utility proration share percentage"
                          {...field}
                          disabled={isSaving || !canEditSpaces}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthlyRentalPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Monthly Rent
                        <span className="text-destructive ml-1">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Monthly rental price"
                          {...field}
                          disabled={isSaving || !canEditSpaces}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isSaving}>
                    Cancel
                  </Button>
                </DialogClose>
                {((formMode === "add" && canCreateSpaces) ||
                  (formMode === "edit" && canEditSpaces)) && (
                  <Button
                    type="submit"
                    className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {formMode === "add" ? "Add Space" : "Save Changes"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!spaceToDelete}
        onOpenChange={(open) => {
          if (!open) setSpaceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              space "{spaceToDelete?.spaceIdName}". Ensure the space is not
              occupied and has no active agreements.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setSpaceToDelete(null)}
              disabled={isSaving}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSpace}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              disabled={isSaving || !canDeleteSpaces}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete Space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="mb-6 shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Filter by space name or building..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="status-filter">Status:</Label>
            <div className="flex items-center space-x-2">
              <Button
                variant={filterOccupancy === "All" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterOccupancy("All")}
              >
                All
              </Button>
              <Button
                variant={filterOccupancy === "Vacant" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterOccupancy("Vacant")}
              >
                Vacant
              </Button>
              <Button
                variant={filterOccupancy === "Occupied" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterOccupancy("Occupied")}
              >
                Occupied
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredSpaces.length === 0 && isMounted ? (
        <Card className="text-center py-12 shadow-sm">
          <CardContent>
            <Building2 className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2 font-headline">
              {searchTerm || filterOccupancy !== "All"
                ? "No Spaces Found"
                : "No Spaces Yet"}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm || filterOccupancy !== "All"
                ? "No spaces match your filters."
                : buildings.length > 0
                ? "Get started by adding your first rental space."
                : "Please add buildings first."}
            </p>
            {!searchTerm && buildings.length > 0 && canCreateSpaces && (
              <Button onClick={openAddForm} disabled={isSaving}>
                <PlusCircle className="mr-2 h-5 w-5" /> Add Space
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {paginatedSpaces.map((space) => (
              <Card
                key={space.id}
                className="flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300 transform hover:-translate-y-1"
              >
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                    <div>
                      <CardTitle className="font-headline text-xl mb-1">
                        {space.spaceIdName}
                      </CardTitle>
                      <CardDescription className="text-sm">
                        {space.buildingName}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-1 self-start sm:self-center">
                      <Badge
                        variant={space.isOccupied ? "destructive" : "secondary"}
                      >
                        {space.isOccupied ? "Occupied" : "Vacant"}
                      </Badge>
                      <Badge
                        variant={
                          (space as any).status === "Pending"
                            ? "outline"
                            : (space as any).status === "Rejected"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {((space as any).status as string) || "Active"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center">
                    <MapPin className="mr-2 h-4 w-4 text-primary" /> Floor:{" "}
                    {space.floor}
                  </div>
                  <div className="flex items-center">
                    <Maximize className="mr-2 h-4 w-4 text-primary" /> Area:{" "}
                    {space.area} m²
                  </div>
                  <div className="flex items-center">
                    <Percent className="mr-2 h-4 w-4 text-primary" /> Proration
                    Share:{" "}
                    {(Number(space.utilityProrationShare) * 100).toFixed(0)}%
                  </div>
                  <div className="flex items-center">
                    <Banknote className="mr-2 h-4 w-4 text-primary" /> Rent:{" "}
                    {Number(space.monthlyRentalPrice).toLocaleString()}{" "}
                    Birr/month
                  </div>
                  {space.isOccupied && space.availabilityDate && (
                    <div className="flex items-center text-blue-600 font-medium pt-3 border-t mt-3">
                      <Clock className="mr-2 h-4 w-4" />
                      <span>
                        Available{" "}
                        {formatDistanceToNow(parseISO(space.availabilityDate), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="border-t pt-4">
                  <div className="flex w-full flex-wrap items-center justify-end gap-2">
                    {canApproveSpaces &&
                      (space as any).status === "Pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              handleSetSpaceStatus(space.id, "Rejected")
                            }
                            disabled={isSaving || space.isOccupied}
                          >
                            <XCircle className="mr-1.5 h-4 w-4" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() =>
                              handleSetSpaceStatus(space.id, "Active")
                            }
                            disabled={isSaving || space.isOccupied}
                          >
                            <CheckCircle className="mr-1.5 h-4 w-4" /> Approve
                          </Button>
                        </>
                      )}
                    {(canEditSpaces || canViewSpaces) &&
                      (space as any).status !== "Pending" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditForm(space)}
                              disabled={isSaving}
                            >
                              {canEditSpaces ? (
                                <Edit3 className="h-4 w-4 text-blue-600" />
                              ) : (
                                <Eye className="h-4 w-4 text-blue-600" />
                              )}
                              <span className="sr-only">
                                {canEditSpaces ? "Edit Space" : "View Space"}
                              </span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{canEditSpaces ? "Edit Space" : "View Space"}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    {canDeleteSpaces && (space as any).status !== "Pending" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setSpaceToDelete(space)}
                            disabled={space.isOccupied || isSaving}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete Space</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Delete Space</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </CardFooter>
              </Card>
            ))}
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
