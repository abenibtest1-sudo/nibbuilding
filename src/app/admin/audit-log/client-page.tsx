"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, History, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { PaginationControls } from "@/components/custom/PaginationControls";
import type { SerializedAuditLog } from "./actions";
import { usePermissions } from "@/contexts/PermissionContext";
import XLSX from "xlsx-js-style";

interface AuditLogClientPageProps {
  initialData: SerializedAuditLog[];
}

export function AuditLogClientPage({ initialData }: AuditLogClientPageProps) {
  const { hasPermission } = usePermissions();
  const [logs, setLogs] = useState<SerializedAuditLog[]>(initialData);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const canViewAudit = hasPermission("audit:view");

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (!searchTerm) return true;
      const lowerSearch = searchTerm.toLowerCase();
      return (
        log.tenantName?.toLowerCase().includes(lowerSearch) ||
        log.buildingName?.toLowerCase().includes(lowerSearch) ||
        log.spaceName?.toLowerCase().includes(lowerSearch) ||
        log.transactionId?.toLowerCase().includes(lowerSearch) ||
        log.actorName?.toLowerCase().includes(lowerSearch)
      );
    });
  }, [logs, searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  const visiblePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedLogs = filteredLogs.slice(
    (visiblePage - 1) * itemsPerPage,
    visiblePage * itemsPerPage,
  );

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1);
  };

  const exportToExcel = () => {
    const dataToExport = filteredLogs.map((log) => ({
      Date: format(new Date(log.paymentDate), "PPpp"),
      Building: log.buildingName,
      Space: log.spaceName,
      Tenant: log.tenantName,
      "Rent Amount": log.rentAmount,
      "Utility Amount": log.utilityAmount,
      "Penalty Amount": log.penaltyAmount,
      "Total Amount": log.totalAmount,
      "Transaction ID": log.transactionId,
      "To Account": log.toAccountNumber,
      "Recorded By": log.actorName,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "AuditLog");
    XLSX.writeFile(workbook, "Audit_Log_Export.xlsx");
  };

  if (!canViewAudit) {
    return (
      <Card className="shadow-lg text-center py-12">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center justify-center">
            <EyeOff className="mr-2" /> Access Denied
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>Access Denied</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="relative flex-grow w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by tenant, building, transaction..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button
            onClick={exportToExcel}
            variant="outline"
            size="sm"
            disabled={filteredLogs.length === 0}
          >
            <Download className="mr-2 h-4 w-4" /> Export to Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {paginatedLogs.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <History className="mx-auto h-12 w-12 mb-4" />
            <p>No audit log records found.</p>
          </div>
        ) : (
          <>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Building/Space</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      Rent
                    </TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      Utilities
                    </TableHead>
                    <TableHead className="hidden lg:table-cell text-right">
                      Penalty
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Transaction ID
                    </TableHead>
                    <TableHead className="hidden xl:table-cell">
                      Recorded By
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {format(new Date(log.paymentDate), "PP")}
                      </TableCell>
                      <TableCell>
                        <div>{log.buildingName}</div>
                        <div className="text-xs text-muted-foreground">
                          {log.spaceName}
                        </div>
                      </TableCell>
                      <TableCell>{log.tenantName}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {log.totalAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right text-sm">
                        {log.rentAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right text-sm">
                        {log.utilityAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right text-sm text-destructive">
                        {log.penaltyAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">
                        {log.transactionId || "N/A"}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs">
                        {log.actorName}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationControls
              currentPage={visiblePage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              itemsPerPage={itemsPerPage}
              onItemsPerPageChange={handleItemsPerPageChange}
              className="mt-4"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
