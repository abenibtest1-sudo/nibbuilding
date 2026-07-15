"use client";

import React, { useState, useEffect } from "react";
import type { TenantPortalData, PortalAgreementWithRelations } from "./actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Info,
  Home,
  FileText,
  Banknote,
  Calendar,
  MessageSquare,
  Upload,
  Loader2,
  Paperclip,
  Eye,
  EyeOff,
  Download,
} from "lucide-react";
import {
  format,
  parseISO,
  isBefore,
  startOfDay,
  addMonths,
  isAfter,
} from "date-fns";
import { usePermissions } from "@/contexts/PermissionContext";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { submitPaymentProofAction } from "../actions";
import { useDropzone } from "react-dropzone";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { PaginationControls } from "@/components/custom/PaginationControls";
import jsPDF from "jspdf";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { initiatePaymentAction } from "./YagoutPayAction";

interface TenantDashboardClientPageProps {
  initialData: TenantPortalData;
}

const sanitizeFilename = (name: string) => {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/_{2,}/g, "_");
};

export function TenantDashboardClientPage({
  initialData,
}: TenantDashboardClientPageProps) {
  const { currentUser } = usePermissions();
  const router = useRouter();
  const { toast } = useToast();

  const [agreements, setAgreements] = useState(initialData.agreements || []);
  const [messages, setMessages] = useState(initialData.messages || []);
  const [error, setError] = useState(initialData.error || null);
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(
    null,
  );

  const [payingBillId, setPayingBillId] = useState<string | null>(null);

  const [isProofDialogOpen, setIsProofDialogOpen] = useState(false);
  const [selectedBillForProof, setSelectedBillForProof] = useState<any | null>(
    null,
  );
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [paymentNotes, setPaymentNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  // Sent messages are shown via header notification; dashboard no longer lists them

  useEffect(() => {
    if (initialData.agreements && initialData.agreements.length > 0) {
      setSelectedAgreementId(initialData.agreements[0].id);
    }
  }, [initialData.agreements]);

  const selectedAgreement = agreements.find(
    (ag) => ag.id === selectedAgreementId,
  );

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      if (acceptedFiles[0].size > 2 * 1024 * 1024) {
        // 2MB limit
        toast({
          title: "File too large",
          description: "Please upload a PDF file smaller than 2MB.",
          variant: "destructive",
        });
        return;
      }
      setProofFile(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
  });

  const handlePayNow = async (bill: any) => {
    setPayingBillId(bill.id);
    try {
      const result = await initiatePaymentAction(bill.id);
      if (!result.success || !result.postUrl) {
        toast({
          title: "Payment Failed to Start",
          description: result.error ?? "Please try again.",
          variant: "destructive",
        });
        return;
      }

      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.postUrl;
      form.style.display = "none";

      const addField = (name: string, value: string) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };

      addField("me_id", result.meId!);
      addField("merchant_request", result.merchantRequest!);
      addField("hash", result.hash!);

      document.body.appendChild(form);
      form.submit(); // full-page navigation to Yagout's checkout page
    } finally {
      setPayingBillId(null);
    }
  };

  const handleSubmitProof = async () => {
    if (!selectedBillForProof || !proofFile) return;

    setIsSubmitting(true);

    const reader = new FileReader();
    reader.readAsDataURL(proofFile);
    reader.onload = async () => {
      const base64DataUri = reader.result as string;

      const result = await submitPaymentProofAction({
        billId: selectedBillForProof.id,
        paymentProofDataUri: base64DataUri,
        notes: paymentNotes,
      });

      setIsSubmitting(false);

      if (result.success) {
        toast({
          title: "Success",
          description:
            "Your payment proof has been submitted for verification.",
        });
        setIsProofDialogOpen(false);
        setProofFile(null);
        setPaymentNotes("");
        window.location.reload();
      } else {
        toast({
          title: "Submission Failed",
          description: result.error,
          variant: "destructive",
        });
      }
    };
    reader.onerror = (error) => {
      console.error("Error reading file:", error);
      toast({
        title: "Error",
        description: "Could not process the uploaded file.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    };
  };

  const handleItemsPerPageChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1); // Reset to first page when items per page changes
  };

  // fetchMessages removed; messages are available via header notifications

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Paid":
        return (
          <Badge variant="secondary">
            <CheckCircle className="mr-1 h-3 w-3 text-green-600" />
            Paid
          </Badge>
        );
      case "Pending":
        return (
          <Badge variant="default">
            <Clock className="mr-1 h-3 w-3" />
            Pending
          </Badge>
        );
      case "Overdue":
        return (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" />
            Overdue
          </Badge>
        );
      case "PendingVerification":
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-600">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Verifying
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleDownloadAgreement = (agreement: PortalAgreementWithRelations) => {
    if (!agreement || !agreement.agreementText) {
      toast({
        title: "Cannot Download",
        description: "Agreement text is empty or not available.",
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
          description: "Your agreement PDF is downloading.",
        });
      },
      x: 15,
      y: 15,
      width: 170, // A4 width in mm minus margins
      windowWidth: 650, // An arbitrary number that works well for scaling
    });
  };


  if (error) {
    return (
      <Card className="w-full text-center py-10 border-destructive">
        <CardHeader>
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <CardTitle className="mt-4">An Error Occurred</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (agreements.length === 0) {
    return (
      <Card className="text-center py-10 shadow-sm">
        <CardContent>
          <Info className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold font-headline">
            No Active Agreements
          </h3>
          <p className="text-muted-foreground">
            There are no active agreements to display for your account.
          </p>
        </CardContent>
      </Card>
    );
  }

  const paginatedBills =
    selectedAgreement?.bills.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage,
    ) || [];
  const totalPages = selectedAgreement
    ? Math.ceil(selectedAgreement.bills.length / itemsPerPage)
    : 0;

  return (
    <div className="space-y-8">
      <Card className="shadow-lg">
        <CardHeader>
          <Label htmlFor="agreement-select">Select an Agreement</Label>
          <Select
            value={selectedAgreementId || ""}
            onValueChange={setSelectedAgreementId}
          >
            <SelectTrigger
              id="agreement-select"
              className="w-full md:w-1/2 lg:w-1/3"
            >
              <SelectValue placeholder="Choose an agreement..." />
            </SelectTrigger>
            <SelectContent>
              {agreements.map((ag) => (
                <SelectItem key={ag.id} value={ag.id}>
                  Agreement for {ag.space.spaceIdName} ({ag.space.building.name}
                  )
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
      </Card>

      {selectedAgreement ? (
        <Card className="shadow-lg animate-fadeIn">
          <CardHeader>
            <div className="flex flex-col md:flex-row justify-between items-start gap-4">
              <div>
                <CardTitle className="font-headline text-xl flex items-center gap-3">
                  <Home className="text-primary" />
                  Agreement for {selectedAgreement.space.spaceIdName}
                </CardTitle>
                <CardDescription>
                  Building: {selectedAgreement.space.building.name}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadAgreement(selectedAgreement)}
              >
                <Download className="mr-2 h-4 w-4" /> Download Agreement
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6 text-sm">
              <div className="p-3 bg-secondary/30 rounded-md">
                <p className="text-xs font-medium text-muted-foreground">
                  Start Date
                </p>
                <p className="font-semibold">
                  {format(parseISO(selectedAgreement.startDate), "PP")}
                </p>
              </div>
              <div className="p-3 bg-secondary/30 rounded-md">
                <p className="text-xs font-medium text-muted-foreground">
                  End Date
                </p>
                <p className="font-semibold">
                  {format(
                    addMonths(
                      parseISO(selectedAgreement.startDate),
                      selectedAgreement.paymentTermMonths,
                    ),
                    "PP",
                  )}
                </p>
              </div>
              <div className="p-3 bg-secondary/30 rounded-md">
                <p className="text-xs font-medium text-muted-foreground">
                  Term
                </p>
                <p className="font-semibold">
                  {selectedAgreement.paymentTermMonths} months
                </p>
              </div>
              <div className="p-3 bg-secondary/30 rounded-md">
                <p className="text-xs font-medium text-muted-foreground">
                  Monthly Rent
                </p>
                <p className="font-semibold">
                  {Number(
                    selectedAgreement.monthlyRentalPrice,
                  ).toLocaleString()}{" "}
                  Birr
                </p>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2 font-headline mt-4 border-t pt-4">
                Full Agreement Text
              </h3>
              <ScrollArea className="h-[250px] w-full rounded-md border p-4 bg-secondary/30">
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: selectedAgreement.agreementText,
                  }}
                />
              </ScrollArea>
            </div>

            <h3 className="font-semibold mb-2 mt-8 border-t pt-6">
              Billing History
            </h3>
            {selectedAgreement.bills.length > 0 ? (
              <>
                <div className="border rounded-lg overflow-hidden md:block hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bill Period</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">
                          Amount (Birr)
                        </TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedBills.map((bill) => {
                        const utilityTotal =
                          bill.utilityBreakdown?.reduce(
                            (sum, item) => sum + item.amount,
                            0,
                          ) || 0;
                        return (
                          <TableRow key={bill.id}>
                            <TableCell className="font-medium">
                              {format(parseISO(bill.billDate), "MMMM yyyy")}
                            </TableCell>
                            <TableCell>
                              {format(parseISO(bill.dueDate), "PP")}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(bill.status)}
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              <div className="font-semibold text-sm text-foreground">
                                {Number(bill.totalAmount).toLocaleString(
                                  undefined,
                                  { minimumFractionDigits: 2 },
                                )}
                              </div>
                              <div className="text-muted-foreground">
                                Rent:{" "}
                                {Number(bill.rentAmount).toLocaleString(
                                  undefined,
                                  { minimumFractionDigits: 2 },
                                )}
                              </div>
                              {utilityTotal > 0 && (
                                <div className="text-muted-foreground">
                                  Utility:{" "}
                                  {utilityTotal.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </div>
                              )}
                              {bill.penaltyAmount && bill.penaltyAmount > 0 && (
                                <div className="text-destructive font-medium">
                                  Penalty:{" "}
                                  {Number(bill.penaltyAmount).toLocaleString(
                                    undefined,
                                    { minimumFractionDigits: 2 },
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {(bill.status === "Pending" || bill.status === "Overdue") && (
                                <Button
                                  size="sm"
                                  className="w-full mt-4"
                                  disabled={payingBillId === bill.id}
                                  onClick={() => handlePayNow(bill)}
                                >

                                  Pay Now
                                </Button>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {(bill.status === "Pending" ||
                                bill.status === "Overdue") && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedBillForProof(bill);
                                      setIsProofDialogOpen(true);
                                    }}
                                  >
                                    <Upload className="mr-2 h-4 w-4" /> Submit
                                    Proof
                                  </Button>
                                )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-4">
                  {paginatedBills.map((bill) => {
                    const utilityTotal =
                      bill.utilityBreakdown?.reduce(
                        (sum, item) => sum + item.amount,
                        0,
                      ) || 0;
                    return (
                      <Card key={bill.id} className="border bg-secondary/30">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-center mb-3">
                            <div className="font-bold">
                              {format(parseISO(bill.billDate), "MMMM yyyy")}
                            </div>
                            {getStatusBadge(bill.status)}
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Due Date:
                              </span>{" "}
                              <span>
                                {format(parseISO(bill.dueDate), "PP")}
                              </span>
                            </div>
                            {Number(bill.rentAmount) > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Rent:
                                </span>{" "}
                                <span>
                                  {Number(bill.rentAmount).toLocaleString(
                                    undefined,
                                    { minimumFractionDigits: 2 },
                                  )}
                                </span>
                              </div>
                            )}
                            {utilityTotal > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Utilities:
                                </span>{" "}
                                <span>
                                  {utilityTotal.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                            )}
                            {bill.penaltyAmount && bill.penaltyAmount > 0 && (
                              <div className="flex justify-between text-destructive">
                                <span className="font-medium">Penalty:</span>{" "}
                                <span className="font-medium">
                                  {Number(bill.penaltyAmount).toLocaleString(
                                    undefined,
                                    { minimumFractionDigits: 2 },
                                  )}
                                </span>
                              </div>
                            )}
                            <div className="border-t my-2"></div>
                            <div className="flex justify-between font-bold text-base">
                              <span className="text-foreground">
                                Total Due:
                              </span>{" "}
                              <span className="text-primary">
                                {Number(bill.totalAmount).toLocaleString(
                                  undefined,
                                  { minimumFractionDigits: 2 },
                                )}{" "}
                                Birr
                              </span>
                            </div>
                          </div>

                          {(bill.status === "Pending" || bill.status === "Overdue") && (
                            <Button
                              size="sm"
                              className="w-full mt-4"
                              disabled={payingBillId === bill.id}
                              onClick={() => handlePayNow(bill)}
                            >
                              {payingBillId === bill.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Banknote className="mr-2 h-4 w-4" />
                              )}
                              Pay Now
                            </Button>
                          )}
                          {(bill.status === "Pending" ||
                            bill.status === "Overdue") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full mt-4"
                                onClick={() => {
                                  setSelectedBillForProof(bill);
                                  setIsProofDialogOpen(true);
                                }}
                              >
                                <Upload className="mr-2 h-4 w-4" /> Submit Payment
                                Proof
                              </Button>
                            )}
                        </CardContent>
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
                  className="mt-4"
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                No bills have been generated for this agreement yet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-center items-center h-64">
          <p className="text-muted-foreground">
            Please select an agreement to view details.
          </p>
        </div>
      )}
      {/* Sent Messages removed from dashboard; use header notification bell to view messages */}

      {/* Submit Proof Dialog */}
      <Dialog open={isProofDialogOpen} onOpenChange={setIsProofDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Payment Proof</DialogTitle>
            <DialogDescription>
              Upload a PDF of your payment receipt for bill from{" "}
              {selectedBillForProof &&
                format(parseISO(selectedBillForProof.billDate), "MMMM yyyy")}
              .
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div
              {...getRootProps()}
              className={`p-6 border-2 border-dashed rounded-lg cursor-pointer text-center ${isDragActive ? "border-primary bg-primary/10" : "border-border"
                }`}
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
              {proofFile ? (
                <p className="text-sm font-medium">{proofFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isDragActive
                    ? "Drop the file here"
                    : "Drag & drop a PDF file here, or click to select"}
                </p>
              )}
            </div>
            <Textarea
              placeholder="Add any notes for the administrator (optional)..."
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleSubmitProof}
              disabled={!proofFile || isSubmitting}
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit for Verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
