"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ClipboardList,
  Banknote,
  CalendarDays,
  CheckCircle,
  AlertTriangle,
  Info,
  User,
  HomeIcon,
  Landmark,
  Download,
  Building as BuildingIconLucide,
  UploadCloud,
  Loader2,
  EyeOff,
  Paperclip,
  Clock,
} from "lucide-react";
import type {
  PenaltyTier as PenaltyTierPrisma,
  Space as SpacePrismaOriginal,
  Bill as BillPrismaOriginal,
  Agreement as AgreementPrismaOriginal,
  Tenant as TenantPrismaOriginal,
  Building as BuildingPrismaTypeOriginal,
  UtilityBreakdownItem as UtilityBreakdownItemPrismaOriginal,
} from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  addMonths,
  endOfMonth,
  format,
  parseISO,
  isBefore,
  startOfMonth,
  startOfDay,
  getYear,
  getMonth,
  differenceInDays,
} from "date-fns";
import {
  formatDateOnlyUTC,
  toUtcStartOfDay,
  isAfterUtcDay,
  differenceInUtcDays,
} from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import XLSX from "xlsx-js-style";
import { usePermissions } from "@/contexts/PermissionContext";
import { PaginationControls } from "@/components/custom/PaginationControls";

// Client-side representation types, ensuring dates are strings (ISO format)
export interface ClientPenaltyTier extends Omit<
  PenaltyTierPrisma,
  "id" | "feeValue"
> {
  id?: string;
  feeValue: number;
}

export interface ClientBuilding extends Omit<
  BuildingPrismaTypeOriginal,
  "createdAt" | "updatedAt" | "penaltyPolicyTiers"
> {
  createdAt: string;
  updatedAt: string;
  penaltyPolicyTiers: ClientPenaltyTier[];
}

export interface ClientSpaceForAgreement extends Omit<
  SpacePrismaOriginal,
  | "createdAt"
  | "updatedAt"
  | "building"
  | "tenantId"
  | "buildingId"
  | "agreements"
  | "tenant"
  | "area"
  | "utilityProrationShare"
  | "monthlyRentalPrice"
> {
  createdAt: string;
  updatedAt: string;
  building: ClientBuilding;
  tenantId?: string | null;
  buildingId: string;
  area: number;
  utilityProrationShare: number;
  monthlyRentalPrice: number;
}
export interface ClientSpaceForPotentialRevenue extends Omit<
  SpacePrismaOriginal,
  | "createdAt"
  | "updatedAt"
  | "buildingId"
  | "tenantId"
  | "agreements"
  | "tenant"
  | "building"
  | "area"
  | "utilityProrationShare"
  | "monthlyRentalPrice"
> {
  createdAt: string;
  updatedAt: string;
  buildingId: string;
  tenantId?: string | null;
  area: number;
  utilityProrationShare: number;
  monthlyRentalPrice: number;
}

export interface ClientTenant extends Omit<
  TenantPrismaOriginal,
  "createdAt" | "updatedAt" | "rentedSpaceId" | "agreements" | "bills"
> {
  createdAt: string;
  updatedAt: string;
  rentedSpaceId?: string | null;
}

export interface ClientAgreementForBill extends Omit<
  AgreementPrismaOriginal,
  | "createdAt"
  | "updatedAt"
  | "startDate"
  | "nextPaymentDueDate"
  | "initialPaymentDate"
  | "endDate"
  | "tenant"
  | "space"
  | "bills"
  | "tenantId"
  | "spaceId"
  | "monthlyRentalPrice"
  | "initialPaymentAmount"
> {
  createdAt: string;
  updatedAt: string;
  startDate: string;
  nextPaymentDueDate: string;
  initialPaymentDate?: string | null;
  endDate?: string | null;
  tenant: ClientTenant;
  space: ClientSpaceForAgreement;
  tenantId: string;
  spaceId: string;
  monthlyRentalPrice: number;
  initialPaymentAmount: number | null;
}

export interface ClientUtilityBreakdownItem extends Omit<
  UtilityBreakdownItemPrismaOriginal,
  "id" | "billId"
> {
  id?: string;
  billId?: string;
}

export interface ClientBill extends Omit<
  BillPrismaOriginal,
  | "createdAt"
  | "updatedAt"
  | "billDate"
  | "dueDate"
  | "paymentDate"
  | "agreement"
  | "utilityBreakdown"
  | "tenantId"
  | "agreementId"
  | "rentAmount"
  | "penaltyAmount"
  | "totalAmount"
  | "paymentProofUrl"
> {
  createdAt: string;
  updatedAt: string;
  billDate: string;
  dueDate: string;
  paymentDate?: string | null;
  agreement: ClientAgreementForBill;
  utilityBreakdown: ClientUtilityBreakdownItem[];
  tenantId: string;
  agreementId: string;
  status: BillPrismaOriginal["status"];
  rentAmount: number;
  penaltyAmount: number | null;
  totalAmount: number;
  paymentProofDataUri?: string | null;
}

interface PaymentsOverviewClientPageProps {
  initialBills: ClientBill[];
  initialSpaces: ClientSpaceForPotentialRevenue[];
  initialAgreements: ClientAgreementForBill[];
}

export function PaymentsOverviewClientPage({
  initialBills,
  initialSpaces,
  initialAgreements,
}: PaymentsOverviewClientPageProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [today, setToday] = useState(new Date());
  const [summaryPeriodMode, setSummaryPeriodMode] = useState<
    "monthly" | "all-time"
  >("monthly");
  const [summaryMonth, setSummaryMonth] = useState<number>(today.getMonth());
  const [summaryYear, setSummaryYear] = useState<number>(today.getFullYear());

  const [startMonth, setStartMonth] = useState<number>(today.getMonth());
  const [startYear, setStartYear] = useState<number>(today.getFullYear());
  const [endMonth, setEndMonth] = useState<number>(today.getMonth());
  const [endYear, setEndYear] = useState<number>(today.getFullYear());

  const [bills, setBills] = useState<ClientBill[]>(initialBills);

  const { hasPermission, isSuperAdmin } = usePermissions();
  const canViewPage = isSuperAdmin || hasPermission("payment_overview:view");

  const [upcomingCurrentPage, setUpcomingCurrentPage] = useState(1);
  const [paidCurrentPage, setPaidCurrentPage] = useState(1);
  const [upcomingItemsPerPage, setUpcomingItemsPerPage] = useState(5);
  const [paidItemsPerPage, setPaidItemsPerPage] = useState(5);

  const handleUpcomingItemsPerPageChange = (newSize: number) => {
    setUpcomingItemsPerPage(newSize);
    setUpcomingCurrentPage(1);
  };

  const handlePaidItemsPerPageChange = (newSize: number) => {
    setPaidItemsPerPage(newSize);
    setPaidCurrentPage(1);
  };

  useEffect(() => {
    setIsMounted(true);
    setToday(new Date());
    setBills(initialBills);
  }, [initialBills]);

  useEffect(() => {
    setPaidCurrentPage(1);
  }, [startMonth, startYear, endMonth, endYear]);

  const calculatePenalty = useCallback(
    (bill: ClientBill, currentStatus: ClientBill["status"]): number => {
      const building = bill.agreement?.space?.building;
      if (
        !building ||
        !building.penaltyPolicyTiers ||
        building.penaltyPolicyTiers.length === 0
      ) {
        return 0;
      }

      const space = bill.agreement.space;
      const dueDate = parseISO(bill.dueDate);

      if (currentStatus !== "Overdue") return 0;

      const daysOverdue = differenceInUtcDays(today, dueDate);
      if (daysOverdue <= 0) return 0;

      let applicableTiersForScope: ClientPenaltyTier[] = [];
      const spaceSpecificTiers = building.penaltyPolicyTiers.filter(
        (t) =>
          t.scope === "SpecificSpaces" &&
          t.applicableSpaceIdNames?.includes(space.spaceIdName),
      );

      if (spaceSpecificTiers.length > 0) {
        applicableTiersForScope = spaceSpecificTiers;
      } else {
        const floorSpecificTiers = building.penaltyPolicyTiers.filter(
          (t) => t.scope === "Floor" && t.applicableFloor === space.floor,
        );
        if (floorSpecificTiers.length > 0) {
          applicableTiersForScope = floorSpecificTiers;
        } else {
          applicableTiersForScope = building.penaltyPolicyTiers.filter(
            (t) => t.scope === "Building",
          );
        }
      }

      if (applicableTiersForScope.length === 0) return 0;

      // Mirror server logic: iterate each overdue day and apply the tier
      // that is active for that day. This handles tier transitions over
      // time as well as multiple one-time fees that may apply on different
      // days.
      const sortedTiers = [...applicableTiersForScope].sort(
        (a, b) => a.fromDay - b.fromDay,
      );

      let totalPenalty = 0;
      const oneTimeApplied = new Set<string>();

      for (let day = 1; day <= daysOverdue; day++) {
        const tierForDay = sortedTiers.find(
          (tier) =>
            day >= tier.fromDay &&
            (tier.toDay === null ||
              tier.toDay === undefined ||
              day <= tier.toDay),
        );
        if (!tierForDay) continue;

        const feeValue = tierForDay.feeValue;
        let feeAmount = 0;
        if (tierForDay.penaltyType === "Fixed") {
          feeAmount = feeValue;
        } else if (tierForDay.penaltyType === "Percentage") {
          feeAmount = bill.rentAmount * (feeValue / 100);
        }

        if (tierForDay.frequency === "Daily") {
          totalPenalty += feeAmount;
        } else if (tierForDay.frequency === "OneTime") {
          if (!oneTimeApplied.has(tierForDay.id || "")) {
            totalPenalty += feeAmount;
            if (tierForDay.id) oneTimeApplied.add(tierForDay.id);
          }
        }
      }

      return parseFloat(totalPenalty.toFixed(2));
    },
    [today],
  );

  const processedBills = useMemo(() => {
    return bills
      .map((bill) => {
        let currentStatus = bill.status;
        if (
          bill.status === "Pending" &&
          isAfterUtcDay(today, parseISO(bill.dueDate))
        ) {
          currentStatus = "Overdue";
        }

        const penalty =
          currentStatus === "Overdue" && bill.status !== "Paid"
            ? calculatePenalty(bill, currentStatus)
            : bill.penaltyAmount || 0;

        const baseAmount =
          bill.rentAmount +
          (bill.utilityBreakdown || []).reduce(
            (sum, util) => sum + util.amount,
            0,
          );
        const newTotalAmount = baseAmount + penalty;

        return {
          ...bill,
          status: currentStatus,
          penaltyAmount: penalty > 0 ? penalty : null,
          totalAmount: parseFloat(newTotalAmount.toFixed(2)),
          tenantName: bill.agreement?.tenant?.name || "N/A",
          spaceDescription: bill.agreement?.space
            ? `${bill.agreement.space.spaceIdName}, ${
                bill.agreement.space.building?.name || "N/A"
              }`
            : "N/A",
        };
      })
      .sort(
        (a, b) =>
          parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime(),
      );
  }, [bills, today, calculatePenalty]);

  const upcomingAndPendingBills = useMemo(
    () =>
      processedBills.filter(
        (b) => b.status === "Pending" || b.status === "Overdue",
      ),
    [processedBills],
  );

  const paidBillsInSelectedPeriod = useMemo(() => {
    // compute inclusive start/end dates for the selected month range
    const rangeStart = startOfDay(new Date(startYear, startMonth, 1));
    // last day of end month:
    const rangeEnd = startOfDay(new Date(endYear, endMonth + 1, 0));

    return processedBills.filter((bill) => {
      if (bill.status !== "Paid" || !bill.paymentDate) return false;
      const paymentDateObj = parseISO(bill.paymentDate);
      return paymentDateObj >= rangeStart && paymentDateObj <= rangeEnd;
    });
  }, [processedBills, startMonth, startYear, endMonth, endYear]);

  // Pagination for all transactions
  const allTransactionsTotalPages = Math.ceil(
    processedBills.length / upcomingItemsPerPage,
  );
  const paginatedAllTransactions = processedBills.slice(
    (upcomingCurrentPage - 1) * upcomingItemsPerPage,
    upcomingCurrentPage * upcomingItemsPerPage,
  );

  // Pagination for paid bills
  const paidTotalPages = Math.ceil(
    paidBillsInSelectedPeriod.length / paidItemsPerPage,
  );
  const paginatedPaidBills = paidBillsInSelectedPeriod.slice(
    (paidCurrentPage - 1) * paidItemsPerPage,
    paidCurrentPage * paidItemsPerPage,
  );

  const summaryBillsForSelectedPeriod = useMemo(() => {
    if (summaryPeriodMode === "all-time") {
      return processedBills;
    }

    return processedBills.filter((bill) => {
      const billDate = parseISO(bill.billDate);
      return (
        getYear(billDate) === summaryYear && getMonth(billDate) === summaryMonth
      );
    });
  }, [processedBills, summaryMonth, summaryYear, summaryPeriodMode]);
  const unpaidBillsInSummaryPeriod = useMemo(
    () =>
      summaryPeriodMode === "all-time"
        ? upcomingAndPendingBills
        : summaryBillsForSelectedPeriod.filter(
            (bill) => bill.status === "Pending" || bill.status === "Overdue",
          ),
    [summaryPeriodMode, summaryBillsForSelectedPeriod, upcomingAndPendingBills],
  );
  const paidBillsInSummaryPeriod = useMemo(
    () =>
      summaryPeriodMode === "all-time"
        ? processedBills.filter((bill) => bill.status === "Paid")
        : summaryBillsForSelectedPeriod.filter(
            (bill) => bill.status === "Paid",
          ),
    [processedBills, summaryBillsForSelectedPeriod, summaryPeriodMode],
  );
  const summaryPeriodLabel = useMemo(
    () =>
      summaryPeriodMode === "all-time"
        ? "All Time"
        : format(new Date(summaryYear, summaryMonth), "MMMM yyyy"),
    [summaryMonth, summaryYear, summaryPeriodMode],
  );
  const summaryPotentialRevenueAgreements = useMemo(() => {
    if (summaryPeriodMode === "all-time") {
      return [];
    }

    const monthStart = startOfMonth(new Date(summaryYear, summaryMonth, 1));
    const monthEnd = endOfMonth(monthStart);

    return initialAgreements.filter((agreement) => {
      if (
        agreement.status === "Pending" ||
        agreement.status === "Rejected" ||
        agreement.status === "Canceled"
      ) {
        return false;
      }

      const agreementStart = startOfDay(parseISO(agreement.startDate));
      const agreementEnd = startOfDay(
        agreement.endDate
          ? parseISO(agreement.endDate)
          : addMonths(
              parseISO(agreement.startDate),
              agreement.paymentTermMonths,
            ),
      );

      return agreementStart <= monthEnd && agreementEnd >= monthStart;
    });
  }, [initialAgreements, summaryMonth, summaryYear, summaryPeriodMode]);
  const totalUnpaidForSummaryPeriod = useMemo(
    () =>
      unpaidBillsInSummaryPeriod.reduce(
        (sum, bill) => sum + bill.totalAmount,
        0,
      ),
    [unpaidBillsInSummaryPeriod],
  );
  const totalPaidForSummaryPeriod = useMemo(
    () =>
      paidBillsInSummaryPeriod.reduce((sum, bill) => sum + bill.totalAmount, 0),
    [paidBillsInSummaryPeriod],
  );
  const totalPaidSelectedPeriod = useMemo(
    () =>
      paidBillsInSelectedPeriod.reduce(
        (sum, bill) => sum + bill.totalAmount,
        0,
      ),
    [paidBillsInSelectedPeriod],
  );
  const totalPotentialRevenue = useMemo(() => {
    if (summaryPeriodMode === "all-time") {
      return initialSpaces.reduce(
        (sum, space) => sum + (space.monthlyRentalPrice || 0),
        0,
      );
    }

    return summaryPotentialRevenueAgreements.reduce(
      (sum, agreement) => sum + (agreement.monthlyRentalPrice || 0),
      0,
    );
  }, [initialSpaces, summaryPotentialRevenueAgreements, summaryPeriodMode]);

  const yearsForFilter = useMemo(
    () => Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i),
    [],
  );

  // Compute printable labels and normalize range (ensure start <= end)
  const computeRange = () => {
    const start = new Date(startYear, startMonth, 1);
    const end = new Date(endYear, endMonth, 1);
    if (start.getTime() > end.getTime()) {
      // swap
      return {
        startLabel: format(end, "MMMM yyyy"),
        endLabel: format(start, "MMMM yyyy"),
        startDate: startOfDay(new Date(end.getFullYear(), end.getMonth(), 1)),
        endDate: startOfDay(
          new Date(start.getFullYear(), start.getMonth() + 1, 0),
        ),
      };
    }
    return {
      startLabel: format(start, "MMMM yyyy"),
      endLabel: format(end, "MMMM yyyy"),
      startDate: startOfDay(new Date(start.getFullYear(), start.getMonth(), 1)),
      endDate: startOfDay(new Date(end.getFullYear(), end.getMonth() + 1, 0)),
    };
  };
  const { startLabel, endLabel } = computeRange();
  const rangeLabel = `${startLabel} — ${endLabel}`;
  const monthsForFilter = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i,
        label: format(new Date(0, i), "MMMM"),
      })),
    [],
  );

  const getStatusBadgeVariant = (
    status: ClientBill["status"],
  ): "default" | "destructive" | "secondary" | "outline" => {
    switch (status) {
      case "Paid":
        return "secondary";
      case "Pending":
        return "default";
      case "Overdue":
        return "destructive";
      case "PendingVerification":
        return "outline";
      default:
        return "default";
    }
  };

  const getStatusIcon = (status: ClientBill["status"]) => {
    switch (status) {
      case "Paid":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "Pending":
        return <Info className="h-4 w-4 text-yellow-600" />;
      case "Overdue":
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case "PendingVerification":
        return <Clock className="h-4 w-4 text-blue-600" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  const exportToExcel = (
    data: typeof processedBills,
    fileNamePrefix: string,
  ) => {
    if (!canViewPage) {
      // Double check permission before export
      // toast({ title: "Permission Denied", description: "Access Denied", variant: "destructive" });
      return;
    }
    const worksheetData = data.map((bill) => ({
      "Tenant Name": bill.tenantName,
      "Space Description": bill.spaceDescription,
      "Bill Date": formatDateOnlyUTC(bill.billDate),
      "Due Date": formatDateOnlyUTC(bill.dueDate),
      "Rent Amount": bill.rentAmount,
      "Utilities Amount": (bill.utilityBreakdown || []).reduce(
        (sum, util) => sum + util.amount,
        0,
      ),
      "Penalty Amount": bill.penaltyAmount || 0,
      "Total Amount": bill.totalAmount,
      Status: bill.status,
      "Payment Date": bill.paymentDate
        ? formatDateOnlyUTC(bill.paymentDate)
        : "N/A",
      "Payment Method": bill.paymentMethod || "N/A",
      Reference: bill.paymentReference || "N/A",
      Proof: bill.paymentProofDataUri ? "Yes" : "No",
      "Tenant Notes": bill.tenantPaymentNotes || "N/A",
      "Admin Notes": bill.adminVerificationNotes || "N/A",
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payments");
    XLSX.writeFile(
      workbook,
      `${fileNamePrefix}_${format(new Date(), "yyyy-MM-dd")}.xlsx`,
    );
  };

  if (!isMounted) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!canViewPage && isMounted) {
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
        title="Payments Overview"
        icon={ClipboardList}
        description="View all transactions. Analyze potential and collected revenue. Penalties are applied based on building policies."
      />

      <Card className="mb-6 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-headline">
            Summary Period
          </CardTitle>
          <CardDescription>
            Switch between a billing month summary and all-time totals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 lg:max-w-2xl">
            <div>
              <Label htmlFor="summary-period-mode">View</Label>
              <Select
                value={summaryPeriodMode}
                onValueChange={(value) =>
                  setSummaryPeriodMode(value as "monthly" | "all-time")
                }
              >
                <SelectTrigger id="summary-period-mode" className="mt-1 h-9">
                  <SelectValue placeholder="Select Summary View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Month and Year</SelectItem>
                  <SelectItem value="all-time">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {summaryPeriodMode === "monthly" ? (
              <>
                <div>
                  <Label htmlFor="summary-month-select">Month</Label>
                  <Select
                    value={String(summaryMonth)}
                    onValueChange={(value) => setSummaryMonth(Number(value))}
                  >
                    <SelectTrigger
                      id="summary-month-select"
                      className="mt-1 h-9"
                    >
                      <SelectValue placeholder="Select Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthsForFilter.map((month) => (
                        <SelectItem
                          key={month.value}
                          value={String(month.value)}
                        >
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="summary-year-select">Year</Label>
                  <Select
                    value={String(summaryYear)}
                    onValueChange={(value) => setSummaryYear(Number(value))}
                  >
                    <SelectTrigger
                      id="summary-year-select"
                      className="mt-1 h-9"
                    >
                      <SelectValue placeholder="Select Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {yearsForFilter.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <Card className="shadow-sm bg-secondary/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Unpaid ({summaryPeriodLabel})
            </CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {totalUnpaidForSummaryPeriod.toFixed(2)} Birr
            </div>
            <p className="text-xs text-muted-foreground">
              {unpaidBillsInSummaryPeriod.length} transactions (incl. Overdue)
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm bg-secondary/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Paid ({summaryPeriodLabel})
            </CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {totalPaidForSummaryPeriod.toFixed(2)} Birr
            </div>
            <p className="text-xs text-muted-foreground">
              {paidBillsInSummaryPeriod.length} transactions
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm bg-secondary/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Potential Monthly Revenue ({summaryPeriodLabel})
            </CardTitle>
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {totalPotentialRevenue.toFixed(2)} Birr
            </div>
            <p className="text-xs text-muted-foreground">
              {summaryPeriodMode === "all-time"
                ? `Based on ${initialSpaces.length} total spaces`
                : `Based on ${summaryPotentialRevenueAgreements.length} active agreements`}
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="mb-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
          <h2 className="text-2xl font-headline font-semibold text-foreground">
            All Transactions
          </h2>
          {processedBills.length > 0 && canViewPage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportToExcel(processedBills, "All_Transactions")}
            >
              <Download className="mr-2 h-4 w-4" /> Export All
            </Button>
          )}
        </div>
        {processedBills.length === 0 ? (
          <Card className="text-center py-10 shadow-sm">
            <CardContent>
              <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-3" />
              <h3 className="text-lg font-semibold font-headline">
                All Clear!
              </h3>
              <p className="text-muted-foreground">No transactions found.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="shadow-md">
              <CardContent className="p-0">
                <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tenant</TableHead>
                        <TableHead>Space</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="text-right">Utility</TableHead>
                        <TableHead className="text-right">Penalty</TableHead>
                        <TableHead className="text-right">Amount Due</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedAllTransactions.map((bill) => {
                        const utilityTotal = (
                          bill.utilityBreakdown || []
                        ).reduce((sum, util) => sum + util.amount, 0);
                        return (
                          <TableRow
                            key={bill.id}
                            className={
                              bill.status === "Paid"
                                ? "bg-green-500/5 hover:bg-green-500/10"
                                : ""
                            }
                          >
                            <TableCell className="font-medium">
                              {bill.tenantName || "N/A"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {bill.spaceDescription}
                            </TableCell>
                            <TableCell
                              className={
                                bill.status === "Overdue"
                                  ? "text-destructive font-semibold"
                                  : ""
                              }
                            >
                              {format(parseISO(bill.dueDate), "PP")}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground text-right whitespace-nowrap">
                              {utilityTotal > 0
                                ? `${utilityTotal.toFixed(2)} Birr`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-xs text-destructive text-right whitespace-nowrap">
                              {bill.penaltyAmount
                                ? `${bill.penaltyAmount.toFixed(2)} Birr`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-primary whitespace-nowrap">
                              {bill.totalAmount.toFixed(2)} Birr
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant={getStatusBadgeVariant(bill.status)}
                                className="capitalize"
                              >
                                {getStatusIcon(bill.status)}
                                <span className="ml-1">
                                  {bill.status.replace(
                                    "PendingVerification",
                                    "Verifying",
                                  )}
                                </span>
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <PaginationControls
              currentPage={upcomingCurrentPage}
              totalPages={allTransactionsTotalPages}
              onPageChange={setUpcomingCurrentPage}
              itemsPerPage={upcomingItemsPerPage}
              onItemsPerPageChange={handleUpcomingItemsPerPageChange}
              className="mt-4"
            />
          </>
        )}
      </section>

      <section>
        <div className="flex flex-col md:flex-row justify-between md:items-center mb-4 gap-4">
          <h2 className="text-2xl font-headline font-semibold text-foreground">
            Payment History (Paid & Verified)
          </h2>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end w-full sm:w-auto">
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
              <div className="flex-grow sm:flex-grow-0">
                <Label
                  htmlFor="start-month-select"
                  className="text-xs text-muted-foreground"
                >
                  From (Month)
                </Label>
                <Select
                  value={String(startMonth)}
                  onValueChange={(value) => setStartMonth(Number(value))}
                >
                  <SelectTrigger
                    id="start-month-select"
                    className="w-full sm:w-[150px] h-9 mt-1"
                  >
                    <SelectValue placeholder="Start Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {monthsForFilter.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-grow sm:flex-grow-0">
                <Label
                  htmlFor="start-year-select"
                  className="text-xs text-muted-foreground"
                >
                  Year
                </Label>
                <Select
                  value={String(startYear)}
                  onValueChange={(value) => setStartYear(Number(value))}
                >
                  <SelectTrigger
                    id="start-year-select"
                    className="w-full sm:w-[120px] h-9 mt-1"
                  >
                    <SelectValue placeholder="Start Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {yearsForFilter.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
              <div className="flex-grow sm:flex-grow-0">
                <Label
                  htmlFor="end-month-select"
                  className="text-xs text-muted-foreground"
                >
                  To (Month)
                </Label>
                <Select
                  value={String(endMonth)}
                  onValueChange={(value) => setEndMonth(Number(value))}
                >
                  <SelectTrigger
                    id="end-month-select"
                    className="w-full sm:w-[150px] h-9 mt-1"
                  >
                    <SelectValue placeholder="End Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {monthsForFilter.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-grow sm:flex-grow-0">
                <Label
                  htmlFor="end-year-select"
                  className="text-xs text-muted-foreground"
                >
                  Year
                </Label>
                <Select
                  value={String(endYear)}
                  onValueChange={(value) => setEndYear(Number(value))}
                >
                  <SelectTrigger
                    id="end-year-select"
                    className="w-full sm:w-[120px] h-9 mt-1"
                  >
                    <SelectValue placeholder="End Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {yearsForFilter.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {paidBillsInSelectedPeriod.length > 0 && canViewPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportToExcel(
                    paidBillsInSelectedPeriod,
                    `Payment_History_${startLabel.replace(
                      /\s+/g,
                      "_",
                    )}_to_${endLabel.replace(/\s+/g, "_")}`,
                  )
                }
                className="self-stretch sm:self-end h-9 w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
          </div>
        </div>

        {paidBillsInSelectedPeriod.length === 0 ? (
          <Card className="text-center py-10 shadow-sm">
            <CardContent>
              <Banknote className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
              <h3 className="text-lg font-semibold font-headline">
                No Payments Found
              </h3>
              <p className="text-muted-foreground">
                No payments recorded for {rangeLabel}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="shadow-md">
              <CardContent className="p-0">
                <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tenant</TableHead>
                        <TableHead className="hidden md:table-cell">
                          Space
                        </TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead className="hidden lg:table-cell">
                          Method
                        </TableHead>
                        <TableHead className="hidden xl:table-cell">
                          Proof
                        </TableHead>
                        <TableHead className="text-right">
                          Amount Paid
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedPaidBills.map((bill) => (
                        <TableRow key={bill.id}>
                          <TableCell className="font-medium">
                            {bill.tenantName || "N/A"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs">
                            {bill.spaceDescription}
                          </TableCell>
                          <TableCell>
                            {bill.paymentDate
                              ? format(parseISO(bill.paymentDate), "PP")
                              : "N/A"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs">
                            {bill.paymentMethod || "N/A"}
                          </TableCell>
                          <TableCell className="hidden xl:table-cell text-xs">
                            {bill.paymentProofDataUri ? (
                              <Button
                                asChild
                                variant="link"
                                size="sm"
                                className="p-0 h-auto"
                              >
                                <a
                                  href={bill.paymentProofDataUri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Paperclip className="mr-1 h-3 w-3" />
                                  View
                                </a>
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-green-600 whitespace-nowrap">
                            {bill.totalAmount.toFixed(2)} Birr
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <PaginationControls
              currentPage={paidCurrentPage}
              totalPages={paidTotalPages}
              onPageChange={setPaidCurrentPage}
              itemsPerPage={paidItemsPerPage}
              onItemsPerPageChange={handlePaidItemsPerPageChange}
              className="mt-4"
            />
          </>
        )}
      </section>
    </div>
  );
}
