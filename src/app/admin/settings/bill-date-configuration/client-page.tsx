"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationControls } from "@/components/custom/PaginationControls";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EyeOff, Loader2 } from "lucide-react";

import type { BillDateConfigurationBuildingOption } from "./actions";
import { updateBillDateConfigurationAction } from "./actions";

interface BillDateConfigurationClientPageProps {
  initialBuildings: BillDateConfigurationBuildingOption[];
}

export function BillDateConfigurationClientPage({
  initialBuildings,
}: BillDateConfigurationClientPageProps) {
  const { toast } = useToast();
  const { hasPermission, isSuperAdmin, isLoading } = usePermissions();
  const [buildings, setBuildings] = useState(initialBuildings);
  const [selectedBuildingId, setSelectedBuildingId] = useState(
    initialBuildings[0]?.id ?? "",
  );
  const [billDateValue, setBillDateValue] = useState("");
  const [summarySearchTerm, setSummarySearchTerm] = useState("");
  const [summaryCurrentPage, setSummaryCurrentPage] = useState(1);
  const [summaryItemsPerPage, setSummaryItemsPerPage] = useState(5);
  const [isSaving, setIsSaving] = useState(false);

  const canManageBillDateConfiguration =
    isSuperAdmin || hasPermission("settings:application_settings:manage");

  const selectedBuilding = useMemo(
    () =>
      buildings.find((building) => building.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId],
  );

  useEffect(() => {
    setBuildings(initialBuildings);
    setSelectedBuildingId((currentSelectedBuildingId) => {
      if (
        currentSelectedBuildingId &&
        initialBuildings.some(
          (building) => building.id === currentSelectedBuildingId,
        )
      ) {
        return currentSelectedBuildingId;
      }

      return initialBuildings[0]?.id ?? "";
    });
  }, [initialBuildings]);

  useEffect(() => {
    setBillDateValue(selectedBuilding?.billDateConfiguration?.toString() ?? "");
  }, [selectedBuilding]);

  useEffect(() => {
    setSummaryCurrentPage(1);
  }, [buildings, summaryItemsPerPage, summarySearchTerm]);

  const filteredSummaryBuildings = useMemo(() => {
    const normalizedSearchTerm = summarySearchTerm.trim().toLowerCase();

    if (!normalizedSearchTerm) {
      return buildings;
    }

    return buildings.filter((building) => {
      const normalizedBillDateLabel =
        building.billDateConfiguration === null
          ? "default 30 days"
          : `${building.billDateConfiguration} days`;

      return [building.name, normalizedBillDateLabel].some((value) =>
        value.toLowerCase().includes(normalizedSearchTerm),
      );
    });
  }, [buildings, summarySearchTerm]);

  const summaryTotalPages = Math.max(
    1,
    Math.ceil(filteredSummaryBuildings.length / summaryItemsPerPage),
  );

  const paginatedSummaryBuildings = useMemo(() => {
    const startIndex = (summaryCurrentPage - 1) * summaryItemsPerPage;

    return filteredSummaryBuildings.slice(
      startIndex,
      startIndex + summaryItemsPerPage,
    );
  }, [filteredSummaryBuildings, summaryCurrentPage, summaryItemsPerPage]);

  const handleSave = async () => {
    if (!canManageBillDateConfiguration) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }

    if (!selectedBuildingId) {
      toast({
        title: "Building Required",
        description: "Please select a building.",
        variant: "destructive",
      });
      return;
    }

    const trimmedValue = billDateValue.trim();
    const parsedValue = trimmedValue === "" ? null : Number(trimmedValue);

    setIsSaving(true);
    const result = await updateBillDateConfigurationAction(
      selectedBuildingId,
      parsedValue,
    );
    setIsSaving(false);

    if (!result.success) {
      toast({
        title: "Save Failed",
        description: result.error,
        variant: "destructive",
      });
      return;
    }

    setBuildings((currentBuildings) =>
      currentBuildings.map((building) =>
        building.id === result.buildingId
          ? {
              ...building,
              billDateConfiguration: result.billDateConfiguration ?? null,
            }
          : building,
      ),
    );
    setBillDateValue(result.billDateConfiguration?.toString() ?? "");
    toast({ title: "Saved", description: result.message });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canManageBillDateConfiguration) {
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

  if (buildings.length === 0) {
    return (
      <Card className="max-w-2xl shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">
            Bill Date Configuration
          </CardTitle>
          <CardDescription>
            No accessible buildings were found for bill date configuration.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">
            Bill Date Configuration
          </CardTitle>
          <CardDescription>
            Set the number of days between agreement bills for the selected
            building. Leave this empty to fall back to the default 30-day
            billing cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="bill-date-building">Building</Label>
            <Select
              value={selectedBuildingId}
              onValueChange={setSelectedBuildingId}
              disabled={isSaving}
            >
              <SelectTrigger id="bill-date-building">
                <SelectValue placeholder="Select building" />
              </SelectTrigger>
              <SelectContent>
                {buildings.map((building) => (
                  <SelectItem key={building.id} value={building.id}>
                    {building.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bill-date-configuration">
              Billing Cycle Length (Days)
            </Label>
            <Input
              id="bill-date-configuration"
              type="number"
              min={1}
              max={31}
              step={1}
              inputMode="numeric"
              placeholder="Leave blank to use the 30-day default"
              value={billDateValue}
              onChange={(event) =>
                setBillDateValue(event.target.value.replace(/[^0-9]/g, ""))
              }
              disabled={isSaving}
            />
            <p className="text-sm text-muted-foreground">
              This setting applies only to {selectedBuilding?.name}. Example: if
              this is set to 31, an agreement that starts on January 1 will next
              bill on February 1. If this is blank, each next bill is scheduled
              30 days after the previous billing date.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">
            Building Bill Date Summary
          </CardTitle>
          <CardDescription>
            Review the current bill date setting for each accessible building.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bill-date-summary-search">Search Buildings</Label>
            <Input
              id="bill-date-summary-search"
              placeholder="Search by building name or bill cycle"
              value={summarySearchTerm}
              onChange={(event) => setSummarySearchTerm(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {paginatedSummaryBuildings.length} of{" "}
              {filteredSummaryBuildings.length} matching buildings
            </span>
            {summarySearchTerm.trim() ? (
              <span>{buildings.length} total buildings</span>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Building</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Billing Cycle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSummaryBuildings.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No buildings match your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSummaryBuildings.map((building) => (
                    <TableRow
                      key={building.id}
                      className={cn(
                        building.id === selectedBuildingId && "bg-primary/5",
                      )}
                    >
                      <TableCell className="font-medium">
                        {building.name}
                      </TableCell>
                      <TableCell>
                        {building.id === selectedBuildingId ? (
                          <Badge variant="outline">Currently Selected</Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            Available for configuration
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            building.billDateConfiguration === null
                              ? "secondary"
                              : "default"
                          }
                        >
                          {building.billDateConfiguration === null
                            ? "Default 30 Days"
                            : `${building.billDateConfiguration} Days`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <PaginationControls
            currentPage={summaryCurrentPage}
            totalPages={summaryTotalPages}
            onPageChange={setSummaryCurrentPage}
            itemsPerPage={summaryItemsPerPage}
            onItemsPerPageChange={setSummaryItemsPerPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
