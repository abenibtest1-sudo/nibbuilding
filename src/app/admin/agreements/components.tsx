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
  FileText,
  PlusCircle,
  Eye,
  Download,
  Search,
  AlertTriangle,
  Loader2,
  EyeOff,
  XCircle,
  CheckCircle2,
  PauseCircle,
} from "lucide-react";
import type {
  Agreement as AgreementPrisma,
  Tenant,
  Space,
  AgreementStatus,
} from "@prisma/client";
import { Input } from "@/components/ui/input";
import {
  addMonths,
  format,
  isBefore,
  subDays,
  isAfter,
  parseISO,
} from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PaginationControls } from "@/components/custom/PaginationControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toUtcStartOfDay, isAfterUtcDay } from "@/lib/utils";
import { jsPDF } from "jspdf";
import XLSX from "xlsx-js-style";
import { Label } from "@/components/ui/label";
import { cancelAgreementAction, setAgreementStatusAction } from "./actions";
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

// Helper to create a safe filename
const sanitizeFilename = (name: string) => {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/_{2,}/g, "_");
};

export interface AgreementWithRelations extends AgreementPrisma {
  tenant: Tenant | null;
  space: Space | null;
  createdAt: string;
  startDate: string;
  nextPaymentDueDate: string;
  initialPaymentDate?: string;
  status: AgreementStatus;
}

interface AgreementsListClientPageProps {
  initialAgreements: AgreementWithRelations[];
}

export function AgreementsListClientPage({
  initialAgreements,
}: AgreementsListClientPageProps) {
  const [agreements, setAgreements] =
    useState<AgreementWithRelations[]>(initialAgreements);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [today, setToday] = useState(toUtcStartOfDay(new Date()));
  const { toast } = useToast();
  const router = useRouter();

  const [agreementToCancel, setAgreementToCancel] =
    useState<AgreementWithRelations | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(3);
  const [filterStatus, setFilterStatus] = useState<
    "Pending" | "Active" | "Expired" | "Canceled" | "Inactive" | "Rejected"
  >("Active");

  const { hasPermission, isSuperAdmin } = usePermissions();
  const canCreateAgreements = isSuperAdmin || hasPermission("agreement:create");
  const canExportAgreements = isSuperAdmin || hasPermission("agreement:export");
  const canEditAgreements = isSuperAdmin || hasPermission("agreement:edit");
  const canCancelAgreements =
    isSuperAdmin ||
    hasPermission("agreement:cancel") ||
    hasPermission("agreement:edit");
  const canDownloadAgreements =
    isSuperAdmin || hasPermission("agreement:download");
  const canApproveAgreements =
    isSuperAdmin || hasPermission("agreement:approve");
  const canViewAgreements =
    isSuperAdmin ||
    hasPermission("agreement:view") ||
    canCreateAgreements ||
    canEditAgreements;

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    setIsMounted(true);
    setAgreements(initialAgreements.map((ag) => ({ ...ag })));
    setToday(toUtcStartOfDay(new Date()));
  }, [initialAgreements]);

  const filteredAgreements = agreements
    .filter((agreement) => {
      // Status filter logic
      const agreementEndDate = addMonths(
        parseISO(agreement.startDate),
        agreement.paymentTermMonths,
      );
      const isChronologicallyExpired = isBefore(agreementEndDate, today);

      let status: "Active" | "Expired" | "Canceled" | "Inactive";
      // Explicit Pending/Rejected should be reflected as-is.
      if (agreement.status === "Pending") {
        if (filterStatus !== "Pending") return false;
      }
      if (agreement.status === "Rejected") {
        if (filterStatus !== "Rejected") return false;
      }

      // Existing legacy filters
      if (agreement.status === "Canceled") {
        status = "Canceled";
      } else if (agreement.status === "Expired") {
        // Honor the stored DB status first — if the agreement record is
        // explicitly expired, reflect that immediately on the UI.
        status = "Expired";
      } else if (agreement.status === "Inactive") {
        status = "Inactive";
      } else if (isChronologicallyExpired) {
        status = "Expired";
      } else {
        status = "Active";
      }

      if (agreement.status !== "Pending" && agreement.status !== "Rejected") {
        if (filterStatus !== status) return false;
      }

      // Search term filter
      if (searchTerm) {
        return (
          agreement.tenant?.name
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          agreement.space?.spaceIdName
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          agreement.space?.buildingName
            .toLowerCase()
            .includes(searchTerm.toLowerCase())
        );
      }
      return true;
    })
    .sort(
      (a, b) =>
        parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime(),
    );

  const totalPages = Math.ceil(filteredAgreements.length / itemsPerPage);
  const paginatedAgreements = filteredAgreements.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus]);

  useEffect(() => {
    const newTotalPages = Math.ceil(agreements.length / itemsPerPage);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages);
    }
  }, [agreements.length, itemsPerPage, currentPage]);

  const isPaymentOverdue = (agreement: AgreementWithRelations): boolean => {
    if (!agreement.nextPaymentDueDate || agreement.status !== "Active")
      return false;
    const nextPaymentDate = toUtcStartOfDay(
      parseISO(agreement.nextPaymentDueDate),
    );
    const leaseEndDate = addMonths(
      parseISO(agreement.startDate),
      agreement.paymentTermMonths,
    );
    return (
      isAfterUtcDay(today, nextPaymentDate) &&
      isAfterUtcDay(leaseEndDate, today)
    );
  };

  const handleDownloadPdf = (agreementId: string) => {
    const agreement = agreements.find((a) => a.id === agreementId);
    if (!agreement) {
      toast({
        title: "Error",
        description: "Could not find agreement to download.",
        variant: "destructive",
      });
      return;
    }

    if (!agreement.agreementText) {
      toast({
        title: "Error",
        description: "Agreement text is empty and cannot be downloaded.",
        variant: "destructive",
      });
      return;
    }

    const doc = new jsPDF();

    doc.html(agreement.agreementText, {
      callback: function (doc) {
        const tenantName = agreement.tenant?.name || "UnknownTenant";
        const safeTenantName = sanitizeFilename(tenantName);
        doc.save(`Agreement-${safeTenantName}-${agreement.id}.pdf`);
        toast({
          title: "Download Started",
          description: "The agreement PDF is downloading.",
        });
      },
      x: 15,
      y: 15,
      width: 170,
      windowWidth: 650,
    });
  };

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      [
        "Space ID",
        "Floor",
        "Area",
        "Agreement Start Date",
        "Agreement Duration (months)",
        "Rent Price",
        "Initial Payment",
        "Tenant ID",
        "Tenant Full Name",
        "Tenant Phone",
        "Tenant National ID",
        "Tenant Email",
        "Representative Full Name",
        "Representative Phone",
        "Agreement Status",
        "Amendment Date",
        "Amended By",
      ],
    ];

    const rows = filteredAgreements.map((ag) => ({
      spaceId: ag.space?.spaceIdName || "",
      floor: ag.space?.floor || "",
      area: ag.space?.area || "",
      startDate: ag.startDate
        ? new Date(ag.startDate).toLocaleDateString()
        : "",
      duration: ag.paymentTermMonths,
      rentPrice: ag.monthlyRentalPrice,
      initialPayment: ag.initialPaymentAmount ?? "",
      tenantId: ag.tenant?.id || "",
      tenantFullName: ag.tenant?.name || "",
      tenantPhone: ag.tenant?.phone || "",
      tenantNationalId: (ag.tenant as any)?.nationalId || "",
      tenantEmail: ag.tenant?.email || "",
      repFullName: (ag.tenant as any)?.representativeName || "",
      repPhone: (ag.tenant as any)?.representativePhone || "",
      status: ag.status,
      amendmentDate: ag.updatedAt || "",
      amendedBy:
        (ag as any).approvedBy?.name || (ag as any).createdBy?.name || "",
    }));

    rows.forEach((r) => {
      wsData.push([
        r.spaceId,
        r.floor,
        r.area,
        r.startDate,
        r.duration,
        r.rentPrice,
        r.initialPayment,
        r.tenantId,
        r.tenantFullName,
        r.tenantPhone,
        r.tenantNationalId,
        r.tenantEmail,
        r.repFullName,
        r.repPhone,
        r.status,
        r.amendmentDate,
        r.amendedBy,
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Agreements");
    XLSX.writeFile(wb, `agreements_export_${new Date().toISOString()}.xlsx`);
    toast({
      title: "Export Started",
      description: "Agreements export is downloading.",
    });
  };

  const handleConfirmCancel = async () => {
    if (!agreementToCancel || !canCancelAgreements) return;
    setIsSaving(true);
    const result = await cancelAgreementAction(agreementToCancel.id);
    setIsSaving(false);
    if (result.success) {
      toast({
        title: "Agreement Canceled",
        description: `The agreement for ${agreementToCancel.tenant?.name} has been successfully canceled.`,
      });
      setAgreementToCancel(null);
      router.refresh();
    } else {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleSetAgreementStatus = async (
    agreementId: string,
    status: AgreementStatus,
  ) => {
    if (!canApproveAgreements) {
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
    const result = await setAgreementStatusAction(
      agreementId,
      status,
      rejectionReason,
    );
    setIsSaving(false);

    if (result.success) {
      toast({
        title: "Status Updated",
        description:
          status === "Active" ? "Agreement approved." : "Agreement rejected.",
      });
      router.refresh();
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to update agreement status.",
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

  if (!canViewAgreements && isMounted) {
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
        title="Rental Agreements"
        icon={FileText}
        description="Browse and manage all rental agreements."
        actions={
          <div className="flex items-center gap-2">
            {canCreateAgreements && (
              <Link href="/admin/agreements/generate" passHref>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  <PlusCircle className="mr-2 h-5 w-5" /> Create New Agreement
                </Button>
              </Link>
            )}
            {canExportAgreements && (
              <Button variant="outline" onClick={exportToExcel} size="sm">
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-6 shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Filter by tenant, space, or building..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="status-filter">Status:</Label>
            <div className="flex items-center space-x-2">
              <Button
                variant={filterStatus === "Pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Pending")}
              >
                Pending
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
              <Button
                variant={filterStatus === "Expired" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Expired")}
              >
                Expired
              </Button>
              <Button
                variant={filterStatus === "Canceled" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Canceled")}
              >
                Canceled
              </Button>
              <Button
                variant={filterStatus === "Rejected" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("Rejected")}
              >
                Rejected
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!agreementToCancel}
        onOpenChange={(open) => !open && setAgreementToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Are you sure you want to cancel this agreement?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will set the agreement status to 'Canceled', make the space
              vacant, and delete all unpaid bills. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>
              No, keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={isSaving}
              className="bg-destructive hover:bg-destructive/80"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Yes, Cancel Agreement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {filteredAgreements.length === 0 ? (
        <Card className="text-center py-12 shadow-sm">
          <CardContent>
            <FileText className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2 font-headline">
              No {filterStatus} Agreements Found
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? `No ${filterStatus.toLowerCase()} agreements match your search.`
                : `There are no ${filterStatus.toLowerCase()} agreements.`}
            </p>
            {!searchTerm &&
              canCreateAgreements &&
              filterStatus === "Active" && (
                <Link href="/admin/agreements/generate" passHref>
                  <Button>
                    <PlusCircle className="mr-2 h-5 w-5" /> Create Agreement
                  </Button>
                </Link>
              )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {paginatedAgreements.map((agreement) => {
              const overdue = isPaymentOverdue(agreement);
              const agreementEndDate = addMonths(
                parseISO(agreement.startDate),
                agreement.paymentTermMonths,
              );
              const isChronologicallyExpired = isBefore(
                agreementEndDate,
                today,
              );

              let status:
                | "Pending"
                | "Active"
                | "Expired"
                | "Canceled"
                | "Inactive"
                | "Rejected";
              let statusBadgeVariant:
                | "secondary"
                | "destructive"
                | "outline"
                | "default" = "secondary";

              if (agreement.status === "Pending") {
                status = "Pending";
                statusBadgeVariant = "outline";
              } else if (agreement.status === "Rejected") {
                status = "Rejected";
                statusBadgeVariant = "destructive";
              } else if (agreement.status === "Canceled") {
                status = "Canceled";
                statusBadgeVariant = "outline";
              } else if (agreement.status === "Expired") {
                status = "Expired";
                statusBadgeVariant = "destructive";
              } else if (agreement.status === "Inactive") {
                status = "Inactive";
                statusBadgeVariant = "default";
              } else if (isChronologicallyExpired) {
                status = "Expired";
                statusBadgeVariant = "destructive";
              } else {
                status = "Active";
              }

              const spaceDesc = agreement.space
                ? `${agreement.space.spaceIdName}, ${agreement.space.buildingName}`
                : "N/A";
              return (
                <Card
                  key={agreement.id}
                  className={`flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300 transform hover:-translate-y-1 ${
                    overdue && status === "Active"
                      ? "border-destructive border-2"
                      : ""
                  }`}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <CardTitle className="font-headline text-lg">
                        {agreement.tenant?.name || "N/A"}
                      </CardTitle>
                      <div className="flex flex-col items-end space-y-1">
                        {overdue && status === "Active" && (
                          <Badge
                            variant="destructive"
                            className="flex items-center"
                          >
                            <AlertTriangle className="mr-1 h-3 w-3" /> Payment
                            Overdue
                          </Badge>
                        )}
                        <Badge
                          variant={statusBadgeVariant}
                          className="capitalize"
                        >
                          {status}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription>{spaceDesc}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1.5">
                    <p>
                      <strong>Start Date:</strong>{" "}
                      {format(parseISO(agreement.startDate), "PP")}
                    </p>
                    <p>
                      <strong>End Date:</strong>{" "}
                      {format(agreementEndDate, "PP")}
                    </p>
                    <p>
                      <strong>Rent:</strong>{" "}
                      {Number(agreement.monthlyRentalPrice).toLocaleString()}{" "}
                      Birr/month
                    </p>
                    <p>
                      <strong>Term:</strong> {agreement.paymentTermMonths}{" "}
                      months
                    </p>
                    {status === "Active" && (
                      <p
                        className={`${
                          overdue ? "text-destructive font-semibold" : ""
                        }`}
                      >
                        <strong>Next Lease Payment:</strong>{" "}
                        {agreement.nextPaymentDueDate
                          ? format(parseISO(agreement.nextPaymentDueDate), "PP")
                          : "N/A"}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground pt-1">
                      Generated: {format(parseISO(agreement.createdAt), "PP")}
                    </p>
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <div className="flex w-full flex-wrap items-center justify-end gap-2">
                      {canApproveAgreements &&
                        agreement.status === "Pending" && (
                          <>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={() =>
                                handleSetAgreementStatus(agreement.id, "Active")
                              }
                              disabled={isSaving}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                handleSetAgreementStatus(
                                  agreement.id,
                                  "Rejected",
                                )
                              }
                              disabled={isSaving}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Reject
                            </Button>
                          </>
                        )}
                      {canViewAgreements && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={`/admin/agreements/${agreement.id}`}
                              passHref
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                              >
                                <Eye className="h-4 w-4 text-blue-600" />
                                <span className="sr-only">View Agreement</span>
                              </Button>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>View Agreement</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {canDownloadAgreements && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDownloadPdf(agreement.id)}
                            >
                              <Download className="h-4 w-4 text-green-600" />
                              <span className="sr-only">
                                Download Agreement
                              </span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Download Agreement</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {canCancelAgreements &&
                        (agreement.status === "Active" ||
                          agreement.status === "Inactive") && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => setAgreementToCancel(agreement)}
                                disabled={isSaving}
                              >
                                <XCircle className="h-4 w-4" />
                                <span className="sr-only">
                                  Cancel Agreement
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Cancel Agreement</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
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
