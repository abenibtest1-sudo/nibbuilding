"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/custom/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building,
  Building2,
  FileText,
  Banknote,
  LayoutGrid,
  AlertCircle,
  User,
  Loader2,
} from "lucide-react";
import { BuildingFinancialCard } from "@/components/custom/BuildingFinancialCard";
import { DashboardChart } from "@/components/custom/DashboardChart";
import {
  getMonth,
  getYear,
  format,
  isAfter,
  addMonths,
  subMonths,
  isValid,
  parseISO,
} from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { OccupancyCard } from "@/components/custom/OccupancyCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { DashboardData } from "./actions";
import { getDashboardDataAction, markTenantMessageReadAction } from "./actions";
import { usePermissions } from "@/contexts/PermissionContext";
import { useRouter } from "next/navigation";
import Image from "next/image";

const StatCard = ({
  title,
  value,
  icon: Icon,
  description,
  trend,
  trendColor,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  description?: string;
  trend?: string;
  trendColor?: string;
}) => (
  <Card className="min-w-0 shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col min-h-[140px]">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">
        {title}
      </CardTitle>
      <Icon className="h-5 w-5 text-primary" />
    </CardHeader>
    <CardContent className="flex flex-col flex-grow justify-center">
      <div className="text-3xl lg:text-4xl font-bold font-headline text-foreground">
        {value}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground pt-1">{description}</p>
      )}
      {trend && (
        <p className={`text-xs pt-1 ${trendColor || "text-green-500"}`}>
          {trend}
        </p>
      )}
    </CardContent>
  </Card>
);

interface BuildingFinancialSummary {
  buildingId: string;
  buildingName: string;
  currentMonthExpenses: number;
  currentMonthIncomeCollected: number;
  currentMonthIncomePendingConfirmation: number;
  currentMonthIncomeToBeCollected: number;
}

export default function AdminDashboardPage() {
  const {
    currentUser,
    isLoading: isUserLoading,
    hasPermission,
    isSuperAdmin,
  } = usePermissions();
  const router = useRouter();
  const [today] = useState(new Date());

  const [allData, setAllData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);

  const [selectedYear, setSelectedYear] = useState(getYear(today));
  const [selectedMonth, setSelectedMonth] = useState(getMonth(today));
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("all");

  useEffect(() => {
    if (!isUserLoading && currentUser) {
      const isTenantOnly =
        currentUser.roles.length === 1 &&
        currentUser.roles[0].name === "TENANT";
      if (isTenantOnly) {
        router.replace("/portal/dashboard");
        return;
      }
      if (!isSuperAdmin && !hasPermission("dashboard:view")) {
        const navItems = [
          "/admin/buildings",
          "/admin/spaces",
          "/admin/tenants",
          "/admin/agreements",
          "/admin/billing",
        ];
        const firstAllowedPage = navItems.find((p) =>
          hasPermission((p.replace("/admin/", "") + ":view") as any),
        );
        router.replace(firstAllowedPage || "/login");
        return;
      }

      const fetchData = async () => {
        setIsLoading(true);
        const data = await getDashboardDataAction();

        if (data.error) {
          setError(data.error);
        } else {
          setAllData(data);
        }
        setIsLoading(false);
      };

      fetchData();
    }
  }, [isUserLoading, currentUser, router, isSuperAdmin, hasPermission]);

  const periodDescription = format(
    new Date(selectedYear, selectedMonth),
    "MMMM yyyy",
  );

  const filteredData = useMemo(() => {
    if (!allData) {
      return {
        stats: {
          totalBuildings: 0,
          totalSpaces: 0,
          totalTenants: 0,
          totalRevenueAllTime: "0.00 Birr",
          activeAgreements: 0,
        },
        financials: [],
      };
    }

    const spacesInSelectedBuildingIds =
      selectedBuildingId === "all"
        ? null
        : allData.spaces
            .filter((s) => s.buildingId === selectedBuildingId)
            .map((s) => s.id);

    const selectedBuildingAgreementIds =
      spacesInSelectedBuildingIds === null
        ? null
        : new Set(
            allData.agreements
              .filter(
                (ag) =>
                  ag.spaceId &&
                  spacesInSelectedBuildingIds.includes(ag.spaceId),
              )
              .map((ag) => ag.id),
          );

    // Count agreements that are Active and whose end date is in the future
    // and (if selected) belong to the chosen building.
    const activeAgreements = allData.agreements.filter((ag) => {
      if (
        spacesInSelectedBuildingIds &&
        (!ag.spaceId || !spacesInSelectedBuildingIds.includes(ag.spaceId))
      ) {
        return false;
      }
      if (ag.status && ag.status !== "Active") return false;
      const agreementEndDate = addMonths(
        parseISO(ag.startDate),
        ag.paymentTermMonths,
      );
      return isAfter(agreementEndDate, today);
    });

    // Count unique tenants that are Active (tenant.status === 'Active') and linked to active agreements
    const uniqueActiveTenantIds = new Set(
      activeAgreements
        .filter((ag) => ag.tenant && (ag.tenant as any).status === "Active")
        .map((ag) => ag.tenantId),
    );

    const paidBillsAllTime = allData.allBills.filter(
      (bill) =>
        bill.status === "Paid" &&
        (selectedBuildingAgreementIds === null ||
          selectedBuildingAgreementIds.has(bill.agreementId)),
    );
    const totalRevenueAllTime = paidBillsAllTime.reduce(
      (sum, bill) => sum + bill.totalAmount,
      0,
    );

    const stats = {
      totalBuildings: allData.buildings.length,
      totalSpaces: allData.spaces.length,
      totalTenants: uniqueActiveTenantIds.size,
      totalRevenueAllTime: `${totalRevenueAllTime.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} Birr`,
      activeAgreements: activeAgreements.length,
    };

    let financials: BuildingFinancialSummary[] = allData.buildings.map(
      (building) => {
        const buildingUtil = allData.allUtilities.find(
          (u) =>
            u.buildingId === building.id &&
            u.year === selectedYear &&
            u.month === selectedMonth,
        );
        const expenses = buildingUtil ? buildingUtil.totalCost : 0;

        const spacesInThisBuildingIds = allData.spaces
          .filter((s) => s.buildingId === building.id)
          .map((s) => s.id);
        const agreementIdsInBuilding = allData.agreements
          .filter(
            (ag) => ag.spaceId && spacesInThisBuildingIds.includes(ag.spaceId),
          )
          .map((ag) => ag.id);

        const billsForBuildingThisPeriod = allData.allBills.filter(
          (bill) =>
            agreementIdsInBuilding.includes(bill.agreementId) &&
            getYear(parseISO(bill.billDate)) === selectedYear &&
            getMonth(parseISO(bill.billDate)) === selectedMonth,
        );

        const incomeCollected = billsForBuildingThisPeriod
          .filter((b) => b.status === "Paid")
          .reduce((sum, b) => sum + b.totalAmount, 0);
        const incomePendingConfirmation = billsForBuildingThisPeriod
          .filter((b) => b.status === "PendingVerification")
          .reduce((sum, b) => sum + b.totalAmount, 0);
        const incomeToBeCollected = billsForBuildingThisPeriod
          .filter((b) => b.status === "Pending" || b.status === "Overdue")
          .reduce((sum, b) => sum + b.totalAmount, 0);

        return {
          buildingId: building.id,
          buildingName: building.name,
          currentMonthExpenses: expenses,
          currentMonthIncomeCollected: incomeCollected,
          currentMonthIncomePendingConfirmation: incomePendingConfirmation,
          currentMonthIncomeToBeCollected: incomeToBeCollected,
        };
      },
    );

    if (selectedBuildingId !== "all") {
      financials = financials.filter(
        (f) => f.buildingId === selectedBuildingId,
      );
    }

    return { stats, financials };
  }, [allData, selectedYear, selectedMonth, selectedBuildingId, today]);

  const chartData = useMemo(() => {
    if (!allData) return [];
    const data = [];

    const buildingSpaceIds =
      selectedBuildingId === "all"
        ? null
        : allData.spaces
            .filter((s) => s.buildingId === selectedBuildingId)
            .map((s) => s.id);

    const agreementIdsInBuilding =
      buildingSpaceIds === null
        ? null
        : allData.agreements
            .filter((ag) => ag.spaceId && buildingSpaceIds.includes(ag.spaceId))
            .map((ag) => ag.id);

    const allPaidBills = allData.allBills.filter((bill) => {
      if (bill.status !== "Paid") return false;
      if (!agreementIdsInBuilding) return true;
      return agreementIdsInBuilding.includes(bill.agreementId);
    });

    for (let i = 5; i >= 0; i--) {
      const date = subMonths(new Date(selectedYear, selectedMonth), i);
      const monthName = format(date, "MMM");
      const year = getYear(date);
      const month = getMonth(date);

      const monthlyRevenue = allPaidBills
        .filter((bill) => {
          if (!bill.paymentDate) return false;
          const paymentDate = parseISO(bill.paymentDate);
          return (
            getYear(paymentDate) === year && getMonth(paymentDate) === month
          );
        })
        .reduce((sum, bill) => sum + bill.totalAmount, 0);

      const monthlyExpenses = allData.allUtilities
        .filter((util) => {
          if (util.year !== year || util.month !== month) return false;
          if (selectedBuildingId === "all") return true;
          return util.buildingId === selectedBuildingId;
        })
        .reduce((sum, util) => sum + util.totalCost, 0);

      data.push({
        name: monthName,
        revenue: parseFloat(monthlyRevenue.toFixed(2)),
        expenses: parseFloat(monthlyExpenses.toFixed(2)),
      });
    }
    return data;
  }, [allData, selectedYear, selectedMonth, selectedBuildingId]);

  const recentActivities = useMemo(() => {
    if (!allData) return [];

    const buildingSpaceIds =
      selectedBuildingId === "all"
        ? null
        : allData.spaces
            .filter((s) => s.buildingId === selectedBuildingId)
            .map((s) => s.id);

    const agreementIdsInBuilding =
      buildingSpaceIds === null
        ? null
        : allData.agreements
            .filter((ag) => ag.spaceId && buildingSpaceIds.includes(ag.spaceId))
            .map((ag) => ag.id);

    return [...allData.allBills] // Create a mutable copy
      .filter((b) =>
        agreementIdsInBuilding
          ? agreementIdsInBuilding.includes(b.agreementId)
          : true,
      )
      .sort(
        (a, b) =>
          parseISO(b.billDate).getTime() - parseISO(a.billDate).getTime(),
      )
      .slice(0, 5)
      .map((bill) => {
        const agreement = allData.agreements.find(
          (ag) => ag.id === bill.agreementId,
        );
        const tenantName = agreement?.tenant?.name || "A tenant";
        const spaceName = agreement?.space?.spaceIdName || "a space";
        let actionText = "";
        let billDueDateFormatted = format(parseISO(bill.billDate), "PP");

        switch (bill.status) {
          case "Paid":
            actionText = `paid bill for ${spaceName}.`;
            break;
          case "Pending":
            actionText = `Bill generated for ${tenantName} for ${spaceName}, due ${billDueDateFormatted}.`;
            break;
          case "Overdue":
            actionText = `Bill for ${tenantName} (${spaceName}) is overdue since ${billDueDateFormatted}.`;
            break;
          case "PendingVerification":
            actionText = `${tenantName} submitted payment proof for ${spaceName}.`;
            break;
          default:
            actionText = `Activity related to bill ID ${bill.agreementId} for ${tenantName}.`;
        }

        return {
          user: bill.status === "PendingVerification" ? tenantName : "System",
          action: actionText,
          time: format(parseISO(bill.billDate), "PPp"),
          avatar: tenantName.substring(0, 2).toUpperCase(),
        };
      });
  }, [allData, selectedBuildingId]);

  const availableYears = useMemo(() => {
    if (!allData) return [getYear(new Date())];
    const years = new Set(
      allData.allBills.map((b) => getYear(parseISO(b.billDate))),
    );
    if (years.size === 0) return [getYear(new Date())];
    return Array.from(years).sort((a, b) => b - a);
  }, [allData]);

  if (isLoading || isUserLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fadeIn">
        <PageHeader
          title="Dashboard"
          icon={LayoutGrid}
          description="Overview of your rental properties and finances."
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle /> Error Loading Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Please try refreshing the page or contact support if the issue
              persists.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!allData) return null;

  return (
    <div className="animate-fadeIn min-w-0 space-y-6 md:space-y-8">
      <PageHeader
        title="Dashboard"
        icon={LayoutGrid}
        description="Overview of your rental properties and finances."
      />

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <Label htmlFor="building-select">Building</Label>
              <Select
                value={selectedBuildingId}
                onValueChange={(val) => setSelectedBuildingId(val)}
              >
                <SelectTrigger id="building-select" className="w-full">
                  <SelectValue placeholder="Select Building" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buildings</SelectItem>
                  {allData.buildings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 grid-cols-1 gap-4 md:gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Buildings"
          value={String(filteredData.stats.totalBuildings)}
          icon={Building}
          description="Number of managed buildings."
        />
        <OccupancyCard
          spaces={allData.spaces.map((space) => ({
            ...space,
            area: Number(space.area),
          }))}
          buildings={allData.buildings}
        />
        <StatCard
          title="Active Tenants"
          value={String(filteredData.stats.totalTenants)}
          icon={User}
          description="Currently active tenants."
        />
        <StatCard
          title="Active Agreements"
          value={String(filteredData.stats.activeAgreements)}
          icon={FileText}
          description="Currently active leases."
        />
        <Card className="min-w-0 shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col min-h-[140px] sm:col-span-2 xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue (All Time)
            </CardTitle>
            <Banknote className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="flex flex-col flex-grow justify-center">
            <div className="text-3xl lg:text-4xl font-bold font-headline text-foreground">
              {filteredData.stats.totalRevenueAllTime}
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Paid revenue accumulated across all time.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Messages</CardTitle>
          <CardDescription>
            Tenant messages moved to Messages page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Tenant messages are available from the Notifications bell or the
            full messages page.
          </p>
          <div className="mt-4">
            <a href="/admin/tenant-messages">
              <Button>View all messages</Button>
            </a>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="font-headline text-xl">
            Financial Snapshot
          </CardTitle>
          <CardDescription>
            Select a period to view financial summaries and charts for that
            month.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="month-select">Month</Label>
            <Select
              value={String(selectedMonth)}
              onValueChange={(val) => setSelectedMonth(Number(val))}
            >
              <SelectTrigger id="month-select" className="w-full">
                <SelectValue placeholder="Select Month" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {format(new Date(0, i), "MMMM")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="year-select">Year</Label>
            <Select
              value={String(selectedYear)}
              onValueChange={(val) => setSelectedYear(Number(val))}
            >
              <SelectTrigger id="year-select" className="w-full">
                <SelectValue placeholder="Select Year" />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0">
        <h2 className="text-2xl font-headline font-semibold mb-4 text-foreground">
          Building Financials ({periodDescription})
        </h2>
        {filteredData.financials.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <AlertCircle className="mx-auto h-10 w-10 mb-2" />
              No financial data to display for {periodDescription}. Ensure
              utilities for this period are entered and bills are generated.
            </CardContent>
          </Card>
        ) : (
          <Carousel
            opts={{ align: "start" }}
            className="w-full max-w-full min-w-0"
          >
            <CarouselContent className="py-4">
              {filteredData.financials.map((summary) => (
                <CarouselItem
                  key={summary.buildingId}
                  className="pl-4 md:basis-1/2 lg:basis-1/3"
                >
                  <BuildingFinancialCard
                    buildingName={summary.buildingName}
                    currentMonthExpenses={summary.currentMonthExpenses}
                    currentMonthIncomeCollected={
                      summary.currentMonthIncomeCollected
                    }
                    currentMonthIncomePendingConfirmation={
                      summary.currentMonthIncomePendingConfirmation
                    }
                    currentMonthIncomeToBeCollected={
                      summary.currentMonthIncomeToBeCollected
                    }
                    periodDescription={periodDescription}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="hidden sm:flex" />
            <CarouselNext className="hidden sm:flex" />
          </Carousel>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline text-xl">
              Monthly Overview (Last 6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[350px] min-w-0 p-2 sm:p-6">
            <DashboardChart data={chartData} />
          </CardContent>
        </Card>
        <Card className="min-w-0 shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline text-xl">
              Recent Activities
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent activities to display.
              </p>
            ) : (
              <ul className="space-y-3">
                {recentActivities.map((activity, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 p-3 rounded-md hover:bg-secondary/50 transition-colors"
                  >
                    <Avatar className="h-9 w-9 mt-0.5">
                      <AvatarFallback>{activity.avatar}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{activity.user}</span>{" "}
                        {activity.action}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activity.time}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
