"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
  Building as BuildingIcon,
  PlusCircle,
  Edit3,
  Trash2,
  MapPin,
  Clock,
  Banknote as BanknoteIcon,
  AlertTriangle,
  Layers,
  HomeIcon,
  Eye,
  EyeOff,
  Search,
  Hash,
  CheckCircle,
  XCircle,
  Download,
} from "lucide-react";
import type {
  Building as BuildingTypePrisma,
  PenaltyTier as PenaltyTierTypePrisma,
  BuildingStatus,
  User,
} from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
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
import { format } from "date-fns";
import { toggleBuildingStatusAction } from "./actions";
import {
  getChangeRequestPreview,
  getChangeRequestPreviewForBuilding,
  approveChangeRequestAction,
} from "./actions";
import { usePermissions } from "@/contexts/PermissionContext";
import { PaginationControls } from "@/components/custom/PaginationControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import XLSX from "xlsx-js-style";

const ALL_BRANCHES_VALUE = "__all_branches__";

const PREVIEW_FIELD_LABELS: Record<string, string> = {
  name: "Building Name",
  address: "Address",
  branchName: "Branch / District",
  ownerName: "Owner Name",
  ownerAddress: "Owner Address",
  ownerPhone: "Owner Phone",
  ownerEmail: "Owner Email",
  accountNumber: "Account Number",
  managers: "Assigned Managers",
  penaltyPolicyTiers: "Late Fee Policy",
};

const isEmptyPreviewValue = (value: any) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return Array.isArray(value) && value.length === 0;
};

const formatPreviewFieldLabel = (field: string) =>
  PREVIEW_FIELD_LABELS[field] ||
  field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();

const getPreviewChangeType = (before: any, after: any) => {
  if (isEmptyPreviewValue(before) && !isEmptyPreviewValue(after)) {
    return "Added";
  }

  if (!isEmptyPreviewValue(before) && isEmptyPreviewValue(after)) {
    return "Removed";
  }

  return "Updated";
};

const getPreviewBadgeVariant = (changeType: string) => {
  if (changeType === "Added") return "secondary" as const;
  if (changeType === "Removed") return "destructive" as const;
  return "outline" as const;
};

const normalizePreviewList = (value: any) => {
  if (Array.isArray(value)) return value;
  if (isEmptyPreviewValue(value)) return [];
  return [value];
};

const formatManagerLabel = (
  managerId: string,
  managerLabels: Record<string, string>,
) => managerLabels[managerId] || `User ${managerId.slice(0, 8)}`;

const renderEmptyPreviewValue = (message = "Not provided") => (
  <span className="text-sm italic text-muted-foreground">{message}</span>
);

const renderManagerPreviewValue = (
  value: any,
  managerLabels: Record<string, string>,
) => {
  const managerIds = normalizePreviewList(value).filter(Boolean);
  if (managerIds.length === 0) {
    return renderEmptyPreviewValue();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {managerIds.map((managerId) => (
        <Badge key={managerId} variant="outline" className="px-3 py-1">
          {formatManagerLabel(String(managerId), managerLabels)}
        </Badge>
      ))}
    </div>
  );
};

const renderPenaltyTierPreviewValue = (value: any) => {
  const tiers = normalizePreviewList(value).filter(Boolean);
  if (tiers.length === 0) {
    return renderEmptyPreviewValue("No late fee policy configured");
  }

  return (
    <div className="space-y-3">
      {tiers.map((tier: any, index: number) => {
        const feeLabel =
          tier.penaltyType === "Fixed"
            ? `${Number(tier.feeValue).toFixed(2)} Birr`
            : `${tier.feeValue}%`;

        return (
          <div
            key={`${tier.id || tier.scope || "tier"}-${index}`}
            className="rounded-lg border bg-background/80 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{tier.scope || "Policy"}</Badge>
              <span className="text-xs text-muted-foreground">
                {tier.fromDay}
                {tier.toDay ? ` - ${tier.toDay}` : "+"} days
              </span>
            </div>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div>Fee: {feeLabel}</div>
              <div>
                Frequency: {tier.frequency === "Daily" ? "Daily" : "One time"}
              </div>
              {tier.applicableFloor && <div>Floor: {tier.applicableFloor}</div>}
              {tier.applicableSpaceIdNames?.length > 0 && (
                <div>Spaces: {tier.applicableSpaceIdNames.join(", ")}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const renderPreviewValue = (
  field: string,
  value: any,
  managerLabels: Record<string, string>,
) => {
  if (field === "managers") {
    return renderManagerPreviewValue(value, managerLabels);
  }

  if (field === "penaltyPolicyTiers") {
    return renderPenaltyTierPreviewValue(value);
  }

  if (isEmptyPreviewValue(value)) {
    return renderEmptyPreviewValue();
  }

  if (typeof value === "boolean") {
    return <span className="text-sm font-medium">{value ? "Yes" : "No"}</span>;
  }

  if (typeof value === "number") {
    return <span className="text-sm font-medium">{value}</span>;
  }

  if (typeof value === "string") {
    return <p className="whitespace-pre-wrap text-sm leading-6">{value}</p>;
  }

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
};

export interface BuildingWithRelations extends Omit<
  BuildingTypePrisma,
  "createdAt" | "updatedAt"
> {
  penaltyPolicyTiers: PenaltyTierTypePrisma[];
  createdAt: string;
  updatedAt?: string | null;
  createdBy: User | null;
  approvedBy: User | null;
}

interface BuildingCardProps {
  building: BuildingWithRelations;
  onStatusToggle: (
    buildingId: string,
    newStatus: BuildingStatus,
    rejectionReason?: string,
  ) => void;
  canEdit: boolean;
  canApprove: boolean;
  canViewDetails: boolean;
}

function BuildingCard({
  building,
  onStatusToggle,
  canEdit,
  canApprove,
  canViewDetails,
}: BuildingCardProps) {
  const router = useRouter();
  const [showRejectionDialog, setShowRejectionDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const { handleApiCall } = usePermissions();
  const { toast } = useToast();
  const previewDiffs = previewData?.diffs || [];
  const previewManagerLabels = previewData?.managerLabels || {};
  const previewModeLabel = previewData?.isDirectBuildingPreview
    ? "New building submission"
    : "Requested updates";

  const policiesByScopeGroup: Record<string, PenaltyTierTypePrisma[]> = {};
  (building.penaltyPolicyTiers || []).forEach((tier) => {
    let key = tier.scope;
    if (tier.scope === "Floor" && tier.applicableFloor)
      key = `Floor: ${tier.applicableFloor}`;
    if (tier.scope === "SpecificSpaces" && tier.applicableSpaceIdNames?.length)
      key = `Spaces: ${tier.applicableSpaceIdNames.join(", ")}`;

    if (!policiesByScopeGroup[key]) policiesByScopeGroup[key] = [];
    policiesByScopeGroup[key].push(tier);
  });

  const getStatusBadgeVariant = (status: BuildingStatus) => {
    switch (status) {
      case "Active":
        return "secondary";
      case "Pending":
        return "default";
      case "Rejected":
        return "destructive";
      case "Inactive":
        return "outline";
      default:
        return "outline";
    }
  };

  const handleReject = () => {
    onStatusToggle(building.id, "Rejected", rejectionReason);
    setShowRejectionDialog(false);
  };

  return (
    <>
      <Card
        key={building.id}
        className="flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300 transform hover:-translate-y-1"
      >
        <CardHeader>
          <div className="flex justify-between items-start gap-2">
            <CardTitle className="font-headline text-xl mb-1">
              {building.name}
            </CardTitle>
            <Badge
              variant={getStatusBadgeVariant(building.status)}
              className="capitalize"
            >
              {building.status}
            </Badge>
          </div>
          <CardDescription className="text-sm flex flex-col gap-1">
            {building.address && (
              <span className="flex items-center">
                <MapPin className="mr-1.5 h-4 w-4 text-muted-foreground" />
                {building.address}
              </span>
            )}
            {(building as any).branchName && (
              <span className="flex items-center">
                <BuildingIcon className="mr-1.5 h-4 w-4 text-muted-foreground" />
                Branch / District: {(building as any).branchName}
              </span>
            )}
            {building.accountNumber && (
              <span className="flex items-center">
                <Hash className="mr-1.5 h-4 w-4 text-muted-foreground" />
                A/C: {building.accountNumber}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2 flex-grow">
          <p className="text-xs text-muted-foreground">
            Registered:{" "}
            {building.createdAt
              ? format(new Date(building.createdAt), "PP")
              : "N/A"}
          </p>
          {building.status === "Rejected" && building.rejectionReason && (
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive">
              <strong>Reason:</strong> {building.rejectionReason}
            </div>
          )}
          {Object.keys(policiesByScopeGroup).length > 0 ? (
            <div className="mt-2 pt-2 border-t border-border/50 space-y-2.5">
              <h5 className="text-xs font-semibold text-foreground mb-1">
                Late Fee Policies:
              </h5>
              {Object.entries(policiesByScopeGroup).map(
                ([scopeKey, tiersInGroup]) => (
                  <div
                    key={scopeKey}
                    className="p-1.5 bg-secondary/30 rounded-sm"
                  >
                    <p className="text-xs font-medium text-primary capitalize flex items-center">
                      {tiersInGroup[0].scope === "Building" && (
                        <BuildingIcon className="inline mr-1 h-3 w-3" />
                      )}
                      {tiersInGroup[0].scope === "Floor" && (
                        <Layers className="inline mr-1 h-3 w-3" />
                      )}
                      {tiersInGroup[0].scope === "SpecificSpaces" && (
                        <HomeIcon className="inline mr-1 h-3 w-3" />
                      )}
                      {scopeKey}
                    </p>
                    {tiersInGroup
                      .sort((a, b) => a.fromDay - b.fromDay)
                      .map((tier, index) => {
                        let tierDurationDesc = `Days ${tier.fromDay}`;
                        if (
                          tier.toDay !== null &&
                          tier.toDay !== undefined &&
                          tier.toDay > 0
                        ) {
                          tierDurationDesc += ` - ${tier.toDay}`;
                        } else {
                          tierDurationDesc += ` onwards`;
                        }
                        return (
                          <div
                            key={`${tier.id}-${index}`}
                            className="text-xs pl-2 py-0.5"
                          >
                            <p>
                              <Clock className="inline mr-1 h-3 w-3" />
                              {tierDurationDesc}
                            </p>
                            <p>
                              <BanknoteIcon className="inline mr-1 h-3 w-3" />
                              Fee:{" "}
                              {tier.penaltyType === "Fixed"
                                ? `${Number(tier.feeValue).toFixed(2)} Birr`
                                : `${tier.feeValue}%`}
                              {tier.frequency === "Daily" ? " daily" : ""}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic mt-2 pt-2 border-t border-border/50">
              No late fee policy set.
            </p>
          )}
        </CardContent>
        <CardFooter className="border-t pt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            {canEdit &&
              (building.status === "Active" ||
                building.status === "Inactive") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id={`status-switch-${building.id}`}
                        checked={building.status === "Active"}
                        onCheckedChange={(checked) =>
                          onStatusToggle(
                            building.id,
                            checked ? "Active" : "Inactive",
                          )
                        }
                        aria-label="Toggle building status"
                      />
                      <Label
                        htmlFor={`status-switch-${building.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        {building.status === "Active" ? "Active" : "Inactive"}
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
            {building.status === "Pending" && canApprove && (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowRejectionDialog(true)}
                >
                  <XCircle className="mr-1.5 h-4 w-4" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setPreviewLoading(true);
                    // Fetch pending change request for this building
                    const res = await handleApiCall(() =>
                      getChangeRequestPreviewForBuilding(building.id),
                    );
                    setPreviewLoading(false);
                    if (!res) return;
                    if (!res.success) {
                      toast({
                        title: "Preview failed",
                        description: res.error,
                        variant: "destructive",
                      });
                      return;
                    }
                    setPreviewData(res);
                    setShowPreviewDialog(true);
                  }}
                >
                  <Eye className="mr-1.5 h-4 w-4" /> Preview
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={async () => {
                    // Find pending change request for this building
                    const previewRes = await handleApiCall(() =>
                      getChangeRequestPreviewForBuilding(building.id),
                    );
                    if (!previewRes) return;
                    if (!previewRes.success) {
                      // Fallback: toggle status if no CR found
                      const toggleRes = await handleApiCall(() =>
                        toggleBuildingStatusAction(
                          building.id,
                          "Active" as any,
                        ),
                      );
                      if (toggleRes && toggleRes.success) {
                        toast({
                          title: "Approved",
                          description: "Building activated.",
                        });
                        router.refresh();
                      }
                      return;
                    }

                    const cr = previewRes.changeRequest;
                    if (!cr || !cr.id) {
                      const toggleRes = await handleApiCall(() =>
                        toggleBuildingStatusAction(
                          building.id,
                          "Active" as any,
                        ),
                      );
                      if (toggleRes && toggleRes.success) {
                        toast({
                          title: "Approved",
                          description: "Building activated.",
                        });
                        router.refresh();
                      } else if (toggleRes) {
                        toast({
                          title: "Approve failed",
                          description:
                            toggleRes.error || "Failed to activate building.",
                          variant: "destructive",
                        });
                      }
                      return;
                    }

                    const approveRes = await handleApiCall(() =>
                      approveChangeRequestAction(cr.id),
                    );
                    if (!approveRes) return;
                    if (approveRes.success) {
                      toast({
                        title: "Approved",
                        description: "Changes applied.",
                      });
                      router.refresh();
                    } else {
                      toast({
                        title: "Approve failed",
                        description: approveRes.error,
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  <CheckCircle className="mr-1.5 h-4 w-4" /> Approve
                </Button>
              </>
            )}

            {(building.status === "Active" ||
              building.status === "Inactive" ||
              building.status === "Rejected") &&
              (canEdit ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/admin/buildings/add-building?id=${building.id}`}
                      passHref
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Edit3 className="h-4 w-4 text-blue-600" />
                        <span className="sr-only">Edit Building</span>
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Edit Building</p>
                  </TooltipContent>
                </Tooltip>
              ) : canViewDetails ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/admin/buildings/add-building?id=${building.id}&view=true`}
                      passHref
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Eye className="h-4 w-4 text-blue-600" />
                        <span className="sr-only">View Building</span>
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View Building</p>
                  </TooltipContent>
                </Tooltip>
              ) : null)}
          </div>
        </CardFooter>
      </Card>
      <AlertDialog
        open={showRejectionDialog}
        onOpenChange={setShowRejectionDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Building</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this building. This will be
              visible to the creator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={!rejectionReason}
            >
              Confirm Rejection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <DialogTitle>Change Request Preview</DialogTitle>
                <DialogDescription>
                  Review the submitted building details in a simple before and
                  after view before approving.
                </DialogDescription>
              </div>
              <Badge
                variant={
                  previewData?.isDirectBuildingPreview ? "secondary" : "outline"
                }
                className="w-fit"
              >
                {previewModeLabel}
              </Badge>
            </div>
          </DialogHeader>
          <div className="mt-4 max-h-[68vh] overflow-auto pr-1 text-sm">
            {previewLoading && (
              <div className="rounded-lg border bg-muted/30 p-4 text-muted-foreground">
                Loading preview...
              </div>
            )}
            {!previewLoading && previewData && (
              <div className="space-y-4">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-base font-semibold text-foreground">
                        {previewData.building?.name || "Pending building"}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {previewData.isDirectBuildingPreview
                          ? "This building is waiting for approval. Review the submitted details below."
                          : "These changes were submitted for approval. Review the current and proposed values below."}
                      </div>
                    </div>
                    <Badge variant="outline" className="w-fit">
                      {previewDiffs.length}{" "}
                      {previewDiffs.length === 1 ? "change" : "changes"}
                    </Badge>
                  </div>
                </div>

                {previewDiffs.length > 0 ? (
                  <div className="space-y-4">
                    {previewDiffs.map((diff: any, index: number) => {
                      const changeType = getPreviewChangeType(
                        diff.before,
                        diff.after,
                      );

                      return (
                        <div
                          key={`${diff.field}-${index}`}
                          className="overflow-hidden rounded-xl border bg-card"
                        >
                          <div className="flex flex-col gap-2 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm font-semibold text-foreground">
                              {formatPreviewFieldLabel(diff.field)}
                            </div>
                            <Badge variant={getPreviewBadgeVariant(changeType)}>
                              {changeType}
                            </Badge>
                          </div>
                          <div className="grid gap-4 p-4 md:grid-cols-2">
                            <div className="rounded-lg border bg-background p-4">
                              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Current value
                              </div>
                              {renderPreviewValue(
                                diff.field,
                                diff.before,
                                previewManagerLabels,
                              )}
                            </div>
                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {previewData.isDirectBuildingPreview
                                  ? "Submitted value"
                                  : "Proposed value"}
                              </div>
                              {renderPreviewValue(
                                diff.field,
                                diff.after,
                                previewManagerLabels,
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
                    No visible differences were detected for this request.
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BuildingsClientPage({
  initialBuildings,
}: {
  initialBuildings: BuildingWithRelations[];
}) {
  const [buildings, setBuildings] =
    useState<BuildingWithRelations[]>(initialBuildings);
  const { toast } = useToast();
  const { hasPermission, isSuperAdmin, handleApiCall } = usePermissions();
  const router = useRouter();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(3);
  const [filterStatus, setFilterStatus] = useState<BuildingStatus | "All">(
    "All",
  );
  const [filterBranch, setFilterBranch] = useState(ALL_BRANCHES_VALUE);

  const canCreateBuildings = isSuperAdmin || hasPermission("building:create");
  const canEditBuildings = isSuperAdmin || hasPermission("building:edit");
  const canApproveBuildings = isSuperAdmin || hasPermission("building:approve");
  const canExportBuildings = isSuperAdmin || hasPermission("building:export");
  const canChangeStatus = isSuperAdmin || hasPermission("building:status");
  const canViewBuildings =
    isSuperAdmin ||
    hasPermission("building:view") ||
    canCreateBuildings ||
    canEditBuildings ||
    canChangeStatus ||
    canApproveBuildings;

  const branchOptions = Array.from(
    new Set(
      buildings
        .map((building) => ((building as any).branchName || "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const filteredBuildings = buildings.filter((building) => {
    const statusMatch =
      filterStatus === "All" || building.status === filterStatus;
    const branchName = ((building as any).branchName || "").trim();
    const branchMatch =
      filterBranch === ALL_BRANCHES_VALUE || branchName === filterBranch;
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const searchMatch =
      normalizedSearchTerm.length === 0 ||
      building.name.toLowerCase().includes(normalizedSearchTerm) ||
      (building.address &&
        building.address.toLowerCase().includes(normalizedSearchTerm)) ||
      branchName.toLowerCase().includes(normalizedSearchTerm);

    return statusMatch && branchMatch && searchMatch;
  });

  const totalPages = Math.ceil(filteredBuildings.length / itemsPerPage);

  useEffect(() => {
    setBuildings(
      initialBuildings.map((b) => ({
        ...b,
        createdAt: b.createdAt || new Date().toISOString(),
      })),
    );
  }, [initialBuildings]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus, filterBranch]);

  useEffect(() => {
    const newTotalPages = Math.ceil(filteredBuildings.length / itemsPerPage);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages);
    }
  }, [filteredBuildings.length, itemsPerPage, currentPage]);

  const paginatedBuildings = filteredBuildings.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  const handleToggleStatus = async (
    buildingId: string,
    newStatus: BuildingStatus,
    rejectionReason?: string,
  ) => {
    const result = await handleApiCall(() =>
      toggleBuildingStatusAction(buildingId, newStatus, rejectionReason),
    );
    if (!result) return;

    if (result.success) {
      toast({
        title: "Status Updated",
        description: `Building status set to ${newStatus}.`,
      });
      router.refresh();
    } else {
      toast({
        title: "Update Failed",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const exportToExcel = () => {
    const dataToExport = filteredBuildings.map((b) => ({
      "Building Name": b.name,
      Address: b.address,
      "Account Number": b.accountNumber,
      "Branch Name": (b as any).branchName || "",
      "Building Owner Name": (b as any).ownerName || "",
      "Building Owner Address": (b as any).ownerAddress || "",
      "Building Owner Phone": (b as any).ownerPhone || "",
      "Building Owner Email": (b as any).ownerEmail || "",
      "Occupied/Total Area (m²)": `${((b as any).occupiedAreaSum || 0).toFixed(
        2,
      )}/${((b as any).totalAreaSum || 0).toFixed(2)}`,
      "Available/Total Spaces": `${(b as any).availableSpacesCount || 0}/${
        (b as any).totalSpacesCount || 0
      }`,
      "Active/Total Tenants": `${(b as any).activeTenantsCount || 0}/${
        (b as any).totalTenantsCount || (b as any).totalTenants || 0
      }`,
      "Active/Total Agreements": `${(b as any).activeAgreementsCount || 0}/${
        (b as any).totalAgreementsCount || (b as any).totalAgreements || 0
      }`,
      Status: b.status,
      "Creation Date": format(new Date(b.createdAt), "yyyy-MM-dd HH:mm"),
      "Created By": b.createdBy?.name || "N/A",
      "Approved By": b.approvedBy?.name || "N/A",
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Buildings");
    XLSX.writeFile(workbook, "Buildings_Export.xlsx");
    toast({
      title: "Exporting",
      description: "Excel file download has started.",
    });
  };

  if (!canViewBuildings) {
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
        title="Manage Buildings"
        icon={BuildingIcon}
        description="Add, view, and edit buildings and their late fee penalty policies."
        actions={
          <div className="flex flex-col sm:flex-row gap-2">
            {canExportBuildings && (
              <Button onClick={exportToExcel} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
            )}
            {canCreateBuildings && (
              <Link href="/admin/buildings/add-building" passHref>
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <PlusCircle className="mr-2 h-5 w-5" /> Add New Building
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <Card className="mb-6 shadow-sm">
        <CardContent className="p-4 flex flex-col xl:flex-row gap-4 xl:items-center">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Filter buildings by name, address, or branch..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="branch-filter" className="whitespace-nowrap">
              Branch / District:
            </Label>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger id="branch-filter" className="w-full sm:w-[240px]">
                <SelectValue placeholder="All branches / districts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANCHES_VALUE}>
                  All branches / districts
                </SelectItem>
                {branchOptions.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                variant={filterStatus === "Pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Pending")}
              >
                Pending
              </Button>
              <Button
                variant={filterStatus === "Rejected" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Rejected")}
              >
                Rejected
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

      {filteredBuildings.length === 0 ? (
        <Card className="text-center py-12 shadow-sm">
          <CardContent>
            <BuildingIcon className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2 font-headline">
              {searchTerm ? "No Buildings Found" : "No Buildings Yet"}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? "No buildings match your search."
                : "Get started by adding your first building."}
            </p>
            {!searchTerm && canCreateBuildings && (
              <Link href="/admin/buildings/add-building" passHref>
                <Button>
                  <PlusCircle className="mr-2 h-5 w-5" /> Add Building
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {paginatedBuildings.map((building) => (
              <BuildingCard
                key={building.id}
                building={building}
                onStatusToggle={handleToggleStatus}
                canEdit={canEditBuildings || canChangeStatus}
                canApprove={canApproveBuildings}
                canViewDetails={canViewBuildings}
              />
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
