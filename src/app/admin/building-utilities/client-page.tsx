"use client";

import { useState, useEffect, useMemo } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusCircle,
  Trash2,
  Building as BuildingIconLucide,
  CalendarIcon,
  Banknote as BanknoteIcon,
  Layers,
  HomeIcon,
  Loader2,
  EyeOff,
  InfoIcon,
  Percent,
  AlertTriangle,
  Edit,
  Check,
  X,
  Search,
} from "lucide-react";
import type {
  Building as BuildingPrismaType,
  BuildingMonthlyUtilities as BuildingMonthlyUtilitiesPrismaType,
  Space as SpacePrismaType,
} from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
import {
  getYear,
  getMonth,
  format,
  setYear,
  setMonth,
  parseISO,
  subMonths,
} from "date-fns";
import {
  getBuildingUtilitiesAction,
  saveBuildingUtilitiesAction,
  getAllBuildingUtilitiesForListAction,
  deleteBuildingUtilitiesAction,
  setBuildingUtilitiesStatusAction,
  type BuildingUtilityItemInput,
} from "./actions";
import { usePermissions } from "@/contexts/PermissionContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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
import { PaginationControls } from "@/components/custom/PaginationControls";
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Client-safe types passed as props
interface ClientSpace extends Omit<
  SpacePrismaType,
  | "createdAt"
  | "updatedAt"
  | "area"
  | "utilityProrationShare"
  | "monthlyRentalPrice"
> {
  createdAt: string;
  updatedAt: string;
  area: number;
  utilityProrationShare: number;
  monthlyRentalPrice: number;
}
interface ClientBuilding extends Omit<
  BuildingPrismaType,
  "createdAt" | "updatedAt" | "spaces"
> {
  createdAt: string;
  updatedAt: string;
  spaces: ClientSpace[];
}
export interface ClientBuildingMonthlyUtilitiesPrismaType extends Omit<
  BuildingMonthlyUtilitiesPrismaType,
  "createdAt" | "updatedAt" | "utilities"
> {
  createdAt: string;
  updatedAt: string;
  utilities: {
    id: string;
    name: string;
    totalCost: number;
    appliesToScope: "Building" | "Floor" | "SpecificSpaces";
    applicableFloor: string | null;
    applicableSpaceIdNames: string[];
    perSpaceAllocation?: Record<string, number> | null;
    monthlyUtilitiesId: string;
  }[];
}

// Internal state type for a "logical" utility item in the UI
interface UIUtilityItem {
  uiId: string;
  id?: string; // DB id for updates
  name: string;
  appliesToScope: "Building" | "Floor" | "SpecificSpaces";
  totalCost?: number;
  applicableFloor?: string;
  perSpaceCosts?: { [spaceId: string]: number };
  perSpacePercentages?: { [spaceId: string]: number };
}

interface BuildingUtilitiesClientPageProps {
  initialBuildings: ClientBuilding[];
  initialUtilityRecords: ClientBuildingMonthlyUtilitiesPrismaType[];
}

export function BuildingUtilitiesClientPage({
  initialBuildings,
  initialUtilityRecords,
}: BuildingUtilitiesClientPageProps) {
  const [allUtilityRecords, setAllUtilityRecords] = useState<
    ClientBuildingMonthlyUtilitiesPrismaType[]
  >(initialUtilityRecords);
  const [registeredBuildings, setRegisteredBuildings] =
    useState<ClientBuilding[]>(initialBuildings);
  const [isMounted, setIsMounted] = useState(false);
  const { toast } = useToast();

  // Default to the current month for data entry
  const [defaultDate] = useState(() => new Date());

  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number>(() =>
    getYear(defaultDate),
  );
  const [selectedMonth, setSelectedMonth] = useState<number>(() =>
    getMonth(defaultDate),
  );

  const [currentUtilityItems, setCurrentUtilityItems] = useState<
    UIUtilityItem[]
  >([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [recordToDelete, setRecordToDelete] =
    useState<ClientBuildingMonthlyUtilitiesPrismaType | null>(null);
  const [utilityFilterTerm, setUtilityFilterTerm] = useState("");
  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [filterMonth, setFilterMonth] = useState<number | "all">("all");

  const { hasPermission, isSuperAdmin } = usePermissions();
  const canSaveUtilities =
    isSuperAdmin || hasPermission("building_utility:create");
  const canApproveUtilities =
    isSuperAdmin || hasPermission("building_utility:approve");
  const canEditUtilities =
    isSuperAdmin || hasPermission("building_utility:edit");
  const canDeleteUtilities =
    isSuperAdmin || hasPermission("building_utility:delete");
  const canViewUtilities =
    isSuperAdmin || hasPermission("building_utility:view") || canSaveUtilities;

  const isEditingExisting = currentUtilityItems.some((i) => Boolean(i.id));
  const canSaveOrEdit =
    isSuperAdmin || (isEditingExisting ? canEditUtilities : canSaveUtilities);

  const [recordsCurrentPage, setRecordsCurrentPage] = useState(1);
  const [recordsItemsPerPage, setRecordsItemsPerPage] = useState(5);

  const handleRecordsItemsPerPageChange = (newSize: number) => {
    setRecordsItemsPerPage(newSize);
    setRecordsCurrentPage(1);
  };

  useEffect(() => {
    setRecordsCurrentPage(1);
  }, [utilityFilterTerm, filterYear, filterMonth]);

  const filteredRecords = useMemo(() => {
    return allUtilityRecords.filter((record) => {
      const matchesSearchTerm = record.buildingName
        .toLowerCase()
        .includes(utilityFilterTerm.toLowerCase());
      const matchesYear = filterYear === "all" || record.year === filterYear;
      const matchesMonth =
        filterMonth === "all" || record.month === filterMonth;

      // If a year is selected, month filter can apply. If no year, month filter is ignored.
      if (filterYear === "all") {
        return matchesSearchTerm && matchesYear;
      }

      return matchesSearchTerm && matchesYear && matchesMonth;
    });
  }, [allUtilityRecords, utilityFilterTerm, filterYear, filterMonth]);

  const recordsTotalPages = Math.ceil(
    filteredRecords.length / recordsItemsPerPage,
  );

  const paginatedUtilityRecords = useMemo(() => {
    const sortedRecords = [...filteredRecords].sort((a, b) => {
      if (a.year !== b.year) {
        return b.year - a.year;
      }
      return b.month - a.month;
    });
    return sortedRecords.slice(
      (recordsCurrentPage - 1) * recordsItemsPerPage,
      recordsCurrentPage * recordsItemsPerPage,
    );
  }, [filteredRecords, recordsCurrentPage, recordsItemsPerPage]);

  const selectedBuilding = useMemo(() => {
    return registeredBuildings.find((b) => b.id === selectedBuildingId);
  }, [selectedBuildingId, registeredBuildings]);

  const uniqueFloors = useMemo(() => {
    if (!selectedBuilding) return [];
    const floors = selectedBuilding.spaces.map((s) => s.floor).filter(Boolean); // filter out null/empty floors
    // Sort numerically if possible, otherwise alphabetically
    return [...new Set(floors)].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [selectedBuilding]);

  const createEmptyItem = (): UIUtilityItem => ({
    uiId: crypto.randomUUID(),
    name: "",
    appliesToScope: "Building",
    totalCost: undefined,
    perSpaceCosts: {},
    perSpacePercentages: {},
  });

  useEffect(() => {
    setIsMounted(true);
    if (initialBuildings.length > 0 && !selectedBuildingId) {
      setSelectedBuildingId(initialBuildings[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBuildings]);

  useEffect(() => {
    if (
      isMounted &&
      selectedBuildingId &&
      selectedYear !== undefined &&
      selectedMonth !== undefined
    ) {
      const fetchUtilities = async () => {
        setIsLoadingData(true);
        const existingEntry = await getBuildingUtilitiesAction(
          selectedBuildingId,
          selectedYear,
          selectedMonth,
        );

        if (existingEntry?.utilities) {
          const uiItems: UIUtilityItem[] = existingEntry.utilities.map(
            (dbItem) => ({
              uiId: crypto.randomUUID(),
              id: dbItem.id,
              name: dbItem.name,
              appliesToScope: dbItem.appliesToScope,
              totalCost:
                dbItem.appliesToScope !== "SpecificSpaces"
                  ? Number(dbItem.totalCost)
                  : undefined,
              applicableFloor: dbItem.applicableFloor || undefined,
              perSpaceCosts:
                dbItem.appliesToScope === "SpecificSpaces"
                  ? {
                      [dbItem.applicableSpaceIdNames[0]]: Number(
                        dbItem.totalCost,
                      ),
                    }
                  : {},
              perSpacePercentages:
                dbItem.appliesToScope === "Floor"
                  ? dbItem.perSpaceAllocation || {}
                  : {},
            }),
          );

          // Group per-space-cost items by name
          const groupedItems = uiItems.reduce(
            (acc, item) => {
              if (item.appliesToScope === "SpecificSpaces") {
                const key = `${item.name}-SpecificSpaces`;
                if (!acc[key]) {
                  acc[key] = { ...item, perSpaceCosts: {} };
                }
                acc[key].perSpaceCosts = {
                  ...acc[key].perSpaceCosts,
                  ...item.perSpaceCosts,
                };
              } else {
                // Use a unique key for non-grouped items
                acc[item.id || item.uiId] = item;
              }
              return acc;
            },
            {} as Record<string, UIUtilityItem>,
          );

          setCurrentUtilityItems(
            Object.values(groupedItems).length > 0
              ? Object.values(groupedItems)
              : [createEmptyItem()],
          );
        } else {
          setCurrentUtilityItems([createEmptyItem()]);
        }
        setIsLoadingData(false);
      };
      fetchUtilities();
    } else if (isMounted) {
      setCurrentUtilityItems([createEmptyItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuildingId, selectedYear, selectedMonth, isMounted]);

  const refreshUtilityRecordsList = async () => {
    setIsLoadingData(true);
    const records = await getAllBuildingUtilitiesForListAction();

    setAllUtilityRecords(
      records.map((r) => {
        const totalCost = (r.utilities || []).reduce(
          (sum, util) => sum + util.totalCost,
          0,
        );
        return {
          ...r,
          totalCost: totalCost,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt?.toISOString() || r.createdAt.toISOString(),
          utilities: r.utilities.map((u) => ({ ...u })),
        };
      }) as ClientBuildingMonthlyUtilitiesPrismaType[],
    );

    setIsLoadingData(false);
  };

  const handleAddUtilityItem = () => {
    if (!canSaveOrEdit) return;
    setCurrentUtilityItems([...currentUtilityItems, createEmptyItem()]);
  };

  const handleRemoveUtilityItem = (uiIdToRemove: string) => {
    if (!canSaveOrEdit) return;
    setCurrentUtilityItems(
      currentUtilityItems.filter((item) => item.uiId !== uiIdToRemove),
    );
  };

  const handleUtilityItemChange = (
    uiIdToChange: string,
    field: keyof UIUtilityItem,
    value: any,
  ) => {
    if (!canSaveOrEdit) return;
    setCurrentUtilityItems((prevItems) =>
      prevItems.map((item) => {
        if (item.uiId !== uiIdToChange) return item;

        let updatedItem = { ...item, [field]: value };

        if (field === "appliesToScope") {
          updatedItem.totalCost = undefined;
          updatedItem.perSpaceCosts = {};
          updatedItem.perSpacePercentages = {};
          updatedItem.applicableFloor = "";
        }

        return updatedItem;
      }),
    );
  };

  const handlePerSpaceCostChange = (
    uiId: string,
    spaceIdName: string,
    costStr: string,
  ) => {
    if (!canSaveOrEdit) return;
    const cost = parseFloat(costStr);
    setCurrentUtilityItems((prev) =>
      prev.map((item) => {
        if (item.uiId !== uiId) return item;
        const newPerSpaceCosts = {
          ...item.perSpaceCosts,
          [spaceIdName]: isNaN(cost) ? 0 : cost,
        };
        return { ...item, perSpaceCosts: newPerSpaceCosts };
      }),
    );
  };

  const handlePerSpacePercentageChange = (
    uiId: string,
    spaceId: string,
    percentageStr: string,
  ) => {
    if (!canSaveUtilities) return;
    const percentage = parseFloat(percentageStr);
    setCurrentUtilityItems((prev) =>
      prev.map((item) => {
        if (item.uiId !== uiId) return item;
        const newPerSpacePercentages = {
          ...item.perSpacePercentages,
          [spaceId]: isNaN(percentage) ? 0 : percentage,
        };
        return { ...item, perSpacePercentages: newPerSpacePercentages };
      }),
    );
  };

  const handleSaveUtilities = async () => {
    if (!canSaveOrEdit) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    if (!selectedBuilding) {
      toast({
        title: "Error",
        description: "Please select a building.",
        variant: "destructive",
      });
      return;
    }

    const finalUtilityItemsForDb: BuildingUtilityItemInput[] = [];
    let validationFailed = false;

    for (const item of currentUtilityItems) {
      if (validationFailed) break;

      if (!item.name.trim()) {
        const hasCost =
          item.appliesToScope === "SpecificSpaces"
            ? Object.values(item.perSpaceCosts ?? {}).some((c) => c > 0)
            : item.totalCost && item.totalCost > 0;
        if (currentUtilityItems.length > 1 || hasCost) {
          toast({
            title: "Validation Error",
            description: `An unnamed utility item cannot be saved.`,
            variant: "destructive",
          });
          validationFailed = true;
        }
        continue;
      }

      const totalCostValue = item.totalCost;
      if (
        (item.appliesToScope === "Building" ||
          item.appliesToScope === "Floor") &&
        (totalCostValue === undefined || totalCostValue <= 0)
      ) {
        toast({
          title: "Validation Error",
          description: `Utility "${item.name}" must have a positive Total Cost.`,
          variant: "destructive",
        });
        validationFailed = true;
        continue;
      }

      if (item.appliesToScope === "Floor") {
        if (!item.applicableFloor) {
          toast({
            title: "Validation Error",
            description: `A floor must be selected for "${item.name}".`,
            variant: "destructive",
          });
          validationFailed = true;
          continue;
        }

        const percentageSum = Object.values(
          item.perSpacePercentages ?? {},
        ).reduce((sum, p) => sum + p, 0);
        if (percentageSum > 100) {
          toast({
            title: "Validation Error",
            description: `Total percentage for "${item.name}" on floor ${item.applicableFloor} exceeds 100%.`,
            variant: "destructive",
          });
          validationFailed = true;
          continue;
        }

        finalUtilityItemsForDb.push({
          id: item.id,
          name: item.name,
          totalCost: totalCostValue!,
          appliesToScope: item.appliesToScope,
          applicableFloor: item.applicableFloor,
          perSpacePercentages: item.perSpacePercentages,
        });
      } else if (item.appliesToScope === "SpecificSpaces") {
        const costs = item.perSpaceCosts || {};
        const costEntries = Object.entries(costs).filter(
          ([, cost]) => cost > 0,
        );
        if (costEntries.length === 0) {
          if (currentUtilityItems.length > 1 || item.name) {
            toast({
              title: "Validation Error",
              description: `At least one space must have a cost for "${item.name}".`,
              variant: "destructive",
            });
            validationFailed = true;
            continue;
          }
        }
        costEntries.forEach(([spaceIdName, cost]) => {
          finalUtilityItemsForDb.push({
            name: item.name,
            totalCost: cost,
            appliesToScope: "SpecificSpaces",
            applicableSpaceIdNames: [spaceIdName],
          });
        });
      } else {
        // Building scope
        finalUtilityItemsForDb.push({
          id: item.id,
          name: item.name,
          totalCost: totalCostValue!,
          appliesToScope: "Building",
        });
      }
    }

    if (validationFailed) {
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveBuildingUtilitiesAction(
        selectedBuilding.id,
        selectedBuilding.name,
        selectedYear,
        selectedMonth,
        finalUtilityItemsForDb,
      );

      if (result?.success) {
        toast({
          title: "Utilities Saved",
          description: `Utility costs for ${selectedBuilding.name} for ${format(
            setMonth(setYear(new Date(), selectedYear), selectedMonth),
            "MMMM yyyy",
          )} have been saved.`,
        });
        await refreshUtilityRecordsList();

        // Refetch the data for the current view to get the new IDs
        const updatedEntry = await getBuildingUtilitiesAction(
          selectedBuildingId,
          selectedYear,
          selectedMonth,
        );
        if (updatedEntry?.utilities) {
          const uiItems: UIUtilityItem[] = updatedEntry.utilities.map(
            (dbItem) => ({
              uiId: crypto.randomUUID(),
              id: dbItem.id,
              name: dbItem.name,
              appliesToScope: dbItem.appliesToScope,
              totalCost:
                dbItem.appliesToScope !== "SpecificSpaces"
                  ? Number(dbItem.totalCost)
                  : undefined,
              applicableFloor: dbItem.applicableFloor || undefined,
              perSpaceCosts:
                dbItem.appliesToScope === "SpecificSpaces"
                  ? {
                      [dbItem.applicableSpaceIdNames[0]]: Number(
                        dbItem.totalCost,
                      ),
                    }
                  : {},
              perSpacePercentages:
                dbItem.appliesToScope === "Floor"
                  ? dbItem.perSpaceAllocation || {}
                  : {},
            }),
          );

          const groupedItems = uiItems.reduce(
            (acc, item) => {
              if (item.appliesToScope === "SpecificSpaces") {
                const key = `${item.name}-SpecificSpaces`;
                if (!acc[key]) {
                  acc[key] = { ...item, perSpaceCosts: {} };
                }
                acc[key].perSpaceCosts = {
                  ...acc[key].perSpaceCosts,
                  ...item.perSpaceCosts,
                };
              } else {
                acc[item.id || item.uiId] = item;
              }
              return acc;
            },
            {} as Record<string, UIUtilityItem>,
          );

          setCurrentUtilityItems(
            Object.values(groupedItems).length > 0
              ? Object.values(groupedItems)
              : [createEmptyItem()],
          );
        }
      } else {
        toast({
          title: "Error Saving Utilities",
          description: result?.error || "An unknown server error occurred.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error during saveBuildingUtilitiesAction call:", error);
      toast({
        title: "Request Failed",
        description: "Could not communicate with the server to save utilities.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!recordToDelete || !canDeleteUtilities) return;
    setIsSaving(true);
    const result = await deleteBuildingUtilitiesAction(recordToDelete.id);
    setIsSaving(false);

    if (result.success) {
      toast({
        title: "Record Deleted",
        description: `Utility record for ${
          recordToDelete.buildingName
        } - ${format(
          setMonth(
            setYear(new Date(), recordToDelete.year),
            recordToDelete.month,
          ),
          "MMMM yyyy",
        )} has been removed.`,
      });
      setAllUtilityRecords((prev) =>
        prev.filter((r) => r.id !== recordToDelete.id),
      );
    } else {
      toast({
        title: "Error Deleting Record",
        description: result.error,
        variant: "destructive",
      });
    }
    setRecordToDelete(null);
  };

  const handleSetRecordStatus = async (
    recordId: string,
    status: "Active" | "Rejected",
  ) => {
    if (!canApproveUtilities) return;

    const rejectionReason =
      status === "Rejected"
        ? window.prompt("Rejection reason (optional):") || undefined
        : undefined;

    setIsSaving(true);
    const result = await setBuildingUtilitiesStatusAction(
      recordId,
      status as any,
      rejectionReason,
    );
    setIsSaving(false);

    if (result.success) {
      setAllUtilityRecords((prev) =>
        prev.map((r) =>
          r.id === recordId
            ? ({ ...r, status } as ClientBuildingMonthlyUtilitiesPrismaType)
            : r,
        ),
      );
      toast({
        title: "Status Updated",
        description:
          status === "Active" ? "Record approved." : "Record rejected.",
      });
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to update record status.",
        variant: "destructive",
      });
    }
  };

  const yearsForFilter = useMemo(() => {
    const years = new Set(allUtilityRecords.map((r) => r.year));
    return Array.from(years).sort((a, b) => b - a);
  }, [allUtilityRecords]);

  const monthsForFilter = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      value: i,
      label: format(new Date(0, i), "MMMM"),
    }));
  }, []);

  const yearsForEntry = Array.from(
    { length: 10 },
    (_, i) => getYear(new Date()) - 5 + i,
  );
  const monthsForEntry = Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: format(new Date(0, i), "MMMM"),
  }));

  const selectedBuildingName =
    registeredBuildings.find((b) => b.id === selectedBuildingId)?.name || "";

  if (!isMounted && registeredBuildings.length === 0 && !canViewUtilities) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!canViewUtilities && isMounted) {
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
    <TooltipProvider>
      <div className="animate-fadeIn">
        {registeredBuildings.length === 0 && isMounted && (
          <Card className="mb-6 bg-yellow-50 border-yellow-300">
            <CardHeader>
              <CardTitle className="text-yellow-700">
                No Buildings Registered
              </CardTitle>
              <CardDescription className="text-yellow-600">
                Please register buildings on the "Buildings" page first.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <AlertDialog
          open={!!recordToDelete}
          onOpenChange={(open) => {
            if (!open) setRecordToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <AlertTriangle className="text-destructive mr-2 h-5 w-5" />
                Confirm Deletion
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the utility record for{" "}
                {recordToDelete?.buildingName} for{" "}
                {recordToDelete
                  ? format(
                      setMonth(
                        setYear(new Date(), recordToDelete.year),
                        recordToDelete.month,
                      ),
                      "MMMM yyyy",
                    )
                  : ""}
                ? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setRecordToDelete(null)}
                disabled={isSaving}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive hover:bg-destructive/90"
                disabled={isSaving || !canSaveOrEdit}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}{" "}
                Delete Record
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline text-xl">
              Enter Utility Costs
            </CardTitle>
            <CardDescription>
              Select building and period, then input utility details. A bill due
              in a given month uses utilities from that same month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <Label
                  htmlFor="buildingName"
                  className="flex items-center mb-1"
                >
                  <BuildingIconLucide className="mr-2 h-4 w-4 text-primary" />
                  Building
                </Label>
                <Select
                  value={selectedBuildingId}
                  onValueChange={setSelectedBuildingId}
                  disabled={
                    registeredBuildings.length === 0 ||
                    isLoadingData ||
                    isSaving ||
                    !canSaveOrEdit
                  }
                >
                  <SelectTrigger id="buildingName">
                    <SelectValue placeholder="Select a building" />
                  </SelectTrigger>
                  <SelectContent>
                    {registeredBuildings.map((building) => (
                      <SelectItem key={building.id} value={building.id}>
                        {building.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="year" className="flex items-center mb-1">
                  <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                  Year
                </Label>
                <Select
                  value={String(selectedYear)}
                  onValueChange={(val) => setSelectedYear(Number(val))}
                  disabled={
                    registeredBuildings.length === 0 ||
                    isLoadingData ||
                    isSaving ||
                    !canSaveOrEdit
                  }
                >
                  <SelectTrigger id="year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearsForEntry.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="month" className="flex items-center mb-1">
                  <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                  Month
                </Label>
                <Select
                  value={String(selectedMonth)}
                  onValueChange={(val) => setSelectedMonth(Number(val))}
                  disabled={
                    registeredBuildings.length === 0 ||
                    isLoadingData ||
                    isSaving ||
                    !canSaveOrEdit
                  }
                >
                  <SelectTrigger id="month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthsForEntry.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedBuildingId && (
              <div className="space-y-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-lg text-foreground">
                    Utility Items for {selectedBuildingName} -{" "}
                    {format(
                      setMonth(
                        setYear(new Date(), selectedYear),
                        selectedMonth,
                      ),
                      "MMMM yyyy",
                    )}
                  </h3>
                  {canSaveOrEdit && (
                    <Button
                      variant="outline"
                      onClick={handleAddUtilityItem}
                      size="sm"
                      disabled={isLoadingData || isSaving}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" /> Add Item
                    </Button>
                  )}
                </div>
                {isLoadingData && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin h-6 w-6 text-primary" />
                  </div>
                )}
                {!isLoadingData &&
                  currentUtilityItems.map((item, index) => {
                    const spacesOnSelectedFloor =
                      selectedBuilding?.spaces.filter(
                        (s) => s.floor === item.applicableFloor,
                      ) || [];
                    const floorPercentageSum = Object.values(
                      item.perSpacePercentages ?? {},
                    ).reduce((sum, p) => sum + p, 0);

                    return (
                      <Card
                        key={item.uiId}
                        className="p-4 bg-secondary/30 shadow-sm"
                      >
                        <CardContent className="p-0 space-y-4">
                          <div className="flex justify-between items-start">
                            <Label className="text-base font-medium text-foreground">
                              Utility Item {index + 1}
                            </Label>
                            {canSaveOrEdit &&
                              currentUtilityItems.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    handleRemoveUtilityItem(item.uiId)
                                  }
                                  className="text-destructive hover:bg-destructive/10 h-7 w-7"
                                  disabled={isSaving}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            <div className="space-y-1.5">
                              <Label htmlFor={`utilityName-${item.uiId}`}>
                                Type
                              </Label>
                              <Input
                                id={`utilityName-${item.uiId}`}
                                placeholder="e.g., Electricity"
                                value={item.name}
                                onChange={(e) =>
                                  handleUtilityItemChange(
                                    item.uiId,
                                    "name",
                                    e.target.value,
                                  )
                                }
                                disabled={isSaving || !canSaveOrEdit}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label
                                htmlFor={`utilityScope-${item.uiId}`}
                                className="flex items-center"
                              >
                                <Layers className="mr-2 h-4 w-4 text-primary" />
                                Applies To
                              </Label>
                              <Select
                                value={item.appliesToScope}
                                onValueChange={(value) =>
                                  handleUtilityItemChange(
                                    item.uiId,
                                    "appliesToScope",
                                    value as UIUtilityItem["appliesToScope"],
                                  )
                                }
                                disabled={isSaving || !canSaveOrEdit}
                              >
                                <SelectTrigger id={`utilityScope-${item.uiId}`}>
                                  <SelectValue />
                                </SelectTrigger>
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
                            </div>
                          </div>

                          {item.appliesToScope !== "SpecificSpaces" && (
                            <div className="space-y-1.5">
                              <Label
                                htmlFor={`utilityCost-${item.uiId}`}
                                className="flex items-center"
                              >
                                <BanknoteIcon className="mr-1 h-3 w-3" />
                                Total Cost for {item.appliesToScope}
                              </Label>
                              <Input
                                id={`utilityCost-${item.uiId}`}
                                type="number"
                                placeholder="e.g., 500.00"
                                value={item.totalCost ?? ""}
                                onChange={(e) =>
                                  handleUtilityItemChange(
                                    item.uiId,
                                    "totalCost",
                                    parseFloat(e.target.value),
                                  )
                                }
                                disabled={isSaving || !canSaveOrEdit}
                              />
                              {item.appliesToScope === "Building" && (
                                <p className="text-xs text-muted-foreground">
                                  This cost will be prorated among all spaces
                                  based on their individual Proration Share %.
                                </p>
                              )}
                            </div>
                          )}

                          {item.appliesToScope === "Floor" && (
                            <div className="space-y-3 pt-2">
                              <div className="space-y-1.5">
                                <Label htmlFor={`applicableFloor-${item.uiId}`}>
                                  Floor
                                </Label>
                                <Select
                                  value={item.applicableFloor || ""}
                                  onValueChange={(value) =>
                                    handleUtilityItemChange(
                                      item.uiId,
                                      "applicableFloor",
                                      value,
                                    )
                                  }
                                  disabled={isSaving || !canSaveOrEdit}
                                >
                                  <SelectTrigger
                                    id={`applicableFloor-${item.uiId}`}
                                  >
                                    <SelectValue placeholder="Select a floor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {uniqueFloors.map((floor) => (
                                      <SelectItem key={floor} value={floor}>
                                        {floor}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              {item.applicableFloor && (
                                <div className="space-y-2 pt-2">
                                  <div className="flex justify-between items-center">
                                    <Label className="flex items-center text-sm font-medium">
                                      <Percent className="mr-2 h-4 w-4 text-primary" />
                                      Per-Space Percentage Allocation
                                    </Label>
                                    <Badge
                                      variant={
                                        floorPercentageSum > 100
                                          ? "destructive"
                                          : "secondary"
                                      }
                                    >
                                      {floorPercentageSum.toFixed(2)}% Total
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Assign a percentage of the floor's total
                                    cost to each space. The total cannot exceed
                                    100%.
                                  </p>
                                  <ScrollArea className="utility-space-scroll h-60 w-full rounded-md border p-2 bg-background">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 p-2">
                                      {spacesOnSelectedFloor.length > 0 ? (
                                        spacesOnSelectedFloor.map((space) => (
                                          <div
                                            key={space.id}
                                            className="flex items-center gap-2"
                                          >
                                            <Label
                                              htmlFor={`space-percentage-${item.uiId}-${space.id}`}
                                              className="flex-1 text-sm text-muted-foreground truncate"
                                              title={space.spaceIdName}
                                            >
                                              {space.spaceIdName}
                                            </Label>
                                            <Input
                                              id={`space-percentage-${item.uiId}-${space.id}`}
                                              type="number"
                                              placeholder="0"
                                              value={
                                                item.perSpacePercentages?.[
                                                  space.id
                                                ] || ""
                                              }
                                              onChange={(e) =>
                                                handlePerSpacePercentageChange(
                                                  item.uiId,
                                                  space.id,
                                                  e.target.value,
                                                )
                                              }
                                              className="w-24 h-8"
                                              disabled={
                                                isSaving || !canSaveUtilities
                                              }
                                            />
                                          </div>
                                        ))
                                      ) : (
                                        <p className="text-sm text-muted-foreground text-center col-span-2">
                                          No spaces found on this floor.
                                        </p>
                                      )}
                                    </div>
                                  </ScrollArea>
                                  {floorPercentageSum > 100 && (
                                    <p className="text-xs text-destructive flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />{" "}
                                      Total percentage exceeds 100%. Please
                                      correct before saving.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {item.appliesToScope === "SpecificSpaces" && (
                            <div className="space-y-2 pt-2">
                              <Label className="flex items-center text-sm font-medium">
                                <HomeIcon className="mr-2 h-4 w-4 text-primary" />
                                Per-Space Cost Allocation
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Enter the exact cost for each specific space.
                                Only spaces with a cost greater than zero will
                                be saved.
                              </p>
                              <ScrollArea className="utility-space-scroll h-60 w-full rounded-md border p-2 bg-background">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 p-2">
                                  {(selectedBuilding?.spaces ?? []).length >
                                  0 ? (
                                    selectedBuilding?.spaces.map((space) => (
                                      <div
                                        key={space.id}
                                        className="flex items-center gap-2"
                                      >
                                        <Label
                                          htmlFor={`space-cost-${item.uiId}-${space.id}`}
                                          className="flex-1 text-sm text-muted-foreground truncate"
                                          title={space.spaceIdName}
                                        >
                                          {space.spaceIdName}
                                        </Label>
                                        <Input
                                          id={`space-cost-${item.uiId}-${space.id}`}
                                          type="number"
                                          placeholder="0.00"
                                          value={
                                            item.perSpaceCosts?.[
                                              space.spaceIdName
                                            ] || ""
                                          }
                                          onChange={(e) =>
                                            handlePerSpaceCostChange(
                                              item.uiId,
                                              space.spaceIdName,
                                              e.target.value,
                                            )
                                          }
                                          className="w-28 h-8"
                                          disabled={isSaving || !canSaveOrEdit}
                                        />
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-muted-foreground text-center col-span-2">
                                      No spaces found in this building.
                                    </p>
                                  )}
                                </div>
                              </ScrollArea>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            )}
          </CardContent>
          {canSaveOrEdit && (
            <CardFooter className="border-t p-6">
              <Button
                onClick={handleSaveUtilities}
                disabled={
                  !selectedBuildingId ||
                  currentUtilityItems.length === 0 ||
                  registeredBuildings.length === 0 ||
                  isLoadingData ||
                  isSaving ||
                  !canSaveUtilities
                }
                className="w-full md:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save Utilities for{" "}
                {selectedBuildingName
                  ? `${selectedBuildingName} - ${format(
                      setMonth(
                        setYear(new Date(), selectedYear),
                        selectedMonth,
                      ),
                      "MMMM yyyy",
                    )}`
                  : "Selected Period"}
              </Button>
            </CardFooter>
          )}
        </Card>

        <Card className="mt-8 shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline text-xl">
              Saved Utility Records
            </CardTitle>
            <CardDescription>
              Overview of previously entered utility costs. Click the edit icon
              to load and modify a record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="utility-filter"
                  placeholder="Filter by building name..."
                  className="pl-10 h-9"
                  value={utilityFilterTerm}
                  onChange={(e) => setUtilityFilterTerm(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Select
                  value={String(filterYear)}
                  onValueChange={(val) => {
                    setFilterYear(val === "all" ? "all" : Number(val));
                    if (val === "all") setFilterMonth("all");
                  }}
                >
                  <SelectTrigger className="w-full sm:w-[120px] h-9">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Years</SelectItem>
                    {yearsForFilter.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(filterMonth)}
                  onValueChange={(val) =>
                    setFilterMonth(val === "all" ? "all" : Number(val))
                  }
                  disabled={filterYear === "all"}
                >
                  <SelectTrigger className="w-full sm:w-[150px] h-9">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Months</SelectItem>
                    {monthsForFilter.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLoadingData && filteredRecords.length === 0 && (
              <div className="flex justify-center py-4">
                <Loader2 className="animate-spin h-6 w-6 text-primary" />
              </div>
            )}
            {!isLoadingData && filteredRecords.length === 0 && (
              <p className="text-muted-foreground text-center py-4">
                {utilityFilterTerm || filterYear !== "all"
                  ? "No records match your filters."
                  : "No utility records saved yet."}
              </p>
            )}
            {filteredRecords.length > 0 && (
              <>
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Building</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
                        <TableHead className="hidden md:table-cell">
                          Created
                        </TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedUtilityRecords.map((entry) => {
                        const status =
                          ((entry as any).status as string) || "Active";
                        const totalCost = (entry.utilities || []).reduce(
                          (sum, util) => sum + util.totalCost,
                          0,
                        );
                        const itemNames = (entry.utilities || []).map(
                          (u) => u.name,
                        );
                        const firstItemName = itemNames[0] || "N/A";
                        const moreItemsCount = itemNames.length - 1;

                        return (
                          <TableRow key={entry.id}>
                            <TableCell className="font-medium">
                              {entry.buildingName}
                            </TableCell>
                            <TableCell>
                              {format(
                                setMonth(
                                  setYear(new Date(), entry.year),
                                  entry.month,
                                ),
                                "MMMM yyyy",
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  status === "Pending"
                                    ? "outline"
                                    : status === "Rejected"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="capitalize"
                              >
                                {status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="secondary"
                                    className="cursor-help"
                                  >
                                    {itemNames.length > 0
                                      ? firstItemName
                                      : "None"}
                                    {moreItemsCount > 0 &&
                                      ` (+${moreItemsCount})`}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="p-1 space-y-1">
                                    <p className="font-semibold">
                                      Utility Items:
                                    </p>
                                    <ul className="list-disc list-inside text-xs">
                                      {itemNames.map((name, i) => (
                                        <li key={i}>{name}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {totalCost.toFixed(2)} Birr
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-xs">
                              {format(parseISO(entry.createdAt), "PP")}
                            </TableCell>
                            <TableCell className="text-right">
                              {canApproveUtilities && status === "Pending" && (
                                <div className="inline-flex flex-col sm:flex-row items-center gap-2 justify-end">
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      handleSetRecordStatus(entry.id, "Active")
                                    }
                                    disabled={isSaving}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center px-3 py-1.5"
                                  >
                                    <Check className="mr-2 h-4 w-4" />
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      handleSetRecordStatus(
                                        entry.id,
                                        "Rejected",
                                      )
                                    }
                                    disabled={isSaving}
                                    className="bg-destructive hover:bg-destructive/90 text-white flex items-center px-3 py-1.5"
                                  >
                                    <X className="mr-2 h-4 w-4" />
                                    Reject
                                  </Button>
                                </div>
                              )}
                              {canEditUtilities && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setSelectedBuildingId(entry.buildingId);
                                    setSelectedYear(entry.year);
                                    setSelectedMonth(entry.month);
                                  }}
                                  className="h-8 w-8 text-blue-600 hover:text-blue-700"
                                >
                                  <Edit className="h-4 w-4" />
                                  <span className="sr-only">Edit Record</span>
                                </Button>
                              )}
                              {canDeleteUtilities && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setRecordToDelete(entry)}
                                  disabled={isSaving}
                                  className="h-8 w-8 text-destructive hover:text-destructive/80"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">Delete Record</span>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <PaginationControls
                  currentPage={recordsCurrentPage}
                  totalPages={recordsTotalPages}
                  onPageChange={setRecordsCurrentPage}
                  itemsPerPage={recordsItemsPerPage}
                  onItemsPerPageChange={handleRecordsItemsPerPageChange}
                  className="mt-4"
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
