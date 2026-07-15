"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Building,
  Banknote,
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle,
} from "lucide-react";

interface BuildingFinancialCardProps {
  buildingName: string;
  currentMonthExpenses: number;
  currentMonthIncomeCollected: number;
  currentMonthIncomePendingConfirmation: number;
  currentMonthIncomeToBeCollected: number;
  periodDescription: string;
}

export function BuildingFinancialCard({
  buildingName,
  currentMonthExpenses,
  currentMonthIncomeCollected,
  currentMonthIncomePendingConfirmation,
  currentMonthIncomeToBeCollected,
  periodDescription,
}: BuildingFinancialCardProps) {
  const netCurrentMonth = currentMonthIncomeCollected - currentMonthExpenses;

  const formatCurrency = (amount: number) => {
    return (
      amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " Birr"
    );
  };

  return (
    <Card className="min-w-0 shadow-lg hover:shadow-xl transition-shadow duration-300 flex h-full w-full flex-col bg-white dark:bg-card">
      <CardHeader className="pb-4">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <Building className="h-5 w-5 text-primary" />
          <CardTitle className="min-w-0 break-words font-headline text-lg text-foreground">
            {buildingName}
          </CardTitle>
        </div>
        <CardDescription className="text-xs">
          Summary for {periodDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm flex-grow">
        {/* Expenses */}
        <div className="flex items-center justify-between rounded-md bg-red-100/60 px-3 py-2 dark:bg-red-900/30">
          <div className="flex min-w-0 items-center gap-2 font-medium text-red-700 dark:text-red-300">
            <Banknote className="h-4 w-4" />
            <span>Expenses:</span>
          </div>
          <span className="text-right font-semibold text-red-800 dark:text-red-200">
            {formatCurrency(currentMonthExpenses)}
          </span>
        </div>

        {/* Income Section */}
        <div className="space-y-2 pt-2">
          <p className="text-sm text-muted-foreground font-medium mb-2">
            Income:
          </p>
          {/* Collected */}
          <div className="flex items-center justify-between rounded-md bg-green-100/60 px-3 py-2 dark:bg-green-900/30">
            <div className="flex min-w-0 items-center gap-2 font-medium text-green-700 dark:text-green-300">
              <CheckCircle className="h-4 w-4" />
              <span>Collected:</span>
            </div>
            <span className="text-right font-semibold text-green-800 dark:text-green-200">
              {formatCurrency(currentMonthIncomeCollected)}
            </span>
          </div>
          {/* Pending */}
          <div className="flex items-center justify-between rounded-md bg-blue-100/60 px-3 py-2 dark:bg-blue-900/30">
            <div className="flex min-w-0 items-center gap-2 font-medium text-blue-700 dark:text-blue-300">
              <Clock className="h-4 w-4" />
              <span>Pending:</span>
            </div>
            <span className="text-right font-semibold text-blue-800 dark:text-blue-200">
              {formatCurrency(currentMonthIncomePendingConfirmation)}
            </span>
          </div>
          {/* Due */}
          <div className="flex items-center justify-between rounded-md bg-yellow-100/60 px-3 py-2 dark:bg-yellow-900/30">
            <div className="flex min-w-0 items-center gap-2 font-medium text-yellow-700 dark:text-yellow-400">
              <AlertCircle className="h-4 w-4" />
              <span>Due:</span>
            </div>
            <span className="text-right font-semibold text-yellow-800 dark:text-yellow-200">
              {formatCurrency(currentMonthIncomeToBeCollected)}
            </span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t mt-auto pt-4 pb-4">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp
              className={`h-5 w-5 ${netCurrentMonth >= 0 ? "text-green-600" : "text-destructive"}`}
            />
            <span className="text-sm font-semibold text-muted-foreground">
              Net:
            </span>
          </div>
          <span
            className={`text-right text-base font-bold ${netCurrentMonth >= 0 ? "text-green-700" : "text-destructive"}`}
          >
            {formatCurrency(netCurrentMonth)}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}
