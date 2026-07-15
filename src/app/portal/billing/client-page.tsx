"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CheckCircle,
  Phone,
  Loader2,
  Banknote,
  AlertCircle,
  Info,
  RefreshCw,
  AlertOctagon,
  FileText,
  Calendar,
  ChevronDown,
  Building,
  List,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  getBillingInfoForPhoneNumberAction,
  initiatePaymentAction,
  getBillStatusAction,
} from "./actions";
import type { Bill, Agreement, Space } from "@prisma/client";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";

// --- Type Definitions ---
interface BillInfo extends Omit<
  Bill,
  "utilityBreakdown" | "rentAmount" | "totalAmount" | "penaltyAmount"
> {
  utilityBreakdown: { name: string; amount: number }[];
  rentAmount: number;
  totalAmount: number;
  penaltyAmount: number;
}

interface AgreementInfo extends Omit<
  Agreement,
  "bills" | "space" | "monthlyRentalPrice"
> {
  bills: BillInfo[];
  monthlyRentalPrice: number;
  space: (Space & { building: { name: string; accountNumber: string } }) | null;
}

interface BillingInfo {
  agreements: AgreementInfo[];
  message: string | null;
}

interface MyJsChannel {
  postMessage(message: any): void;
}

declare global {
  interface Window {
    myJsChannel?: MyJsChannel;
  }
}

// --- Main Component ---
export function BillingClientPage({
  initialPhone,
  nibToken,
}: {
  initialPhone: string;
  nibToken: string;
}) {
  const normalizePhone = (p: string) => {
    if (!p) return "";
    return p.startsWith("251") && p.length >= 12 ? "0" + p.substring(3) : p;
  };

  const [phone, setPhone] = useState(normalizePhone(initialPhone));
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleGetBillingInfo = async () => {
    setIsLoading(true);
    setBillingInfo(null);
    setSelectedAgreementId(null);
    setError(null);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setIsPolling(false);

    const result = await getBillingInfoForPhoneNumberAction(phone);

    if (result.success) {
      setBillingInfo({
        agreements: result.agreements ?? [],
        message: result.message ?? null,
      });
      if (result.agreements && result.agreements.length === 1) {
        setSelectedAgreementId(result.agreements[0].id);
      }
    } else {
      setError(result.error || "An unknown error occurred.");
    }

    setIsLoading(false);
  };

  const selectedAgreement = useMemo(() => {
    if (!selectedAgreementId || !billingInfo?.agreements) return null;
    return billingInfo.agreements.find((ag) => ag.id === selectedAgreementId);
  }, [selectedAgreementId, billingInfo]);

  const totalAmountForSelectedAgreement = useMemo(() => {
    return (
      selectedAgreement?.bills.reduce(
        (sum, bill) => sum + bill.totalAmount,
        0,
      ) ?? 0
    );
  }, [selectedAgreement]);

  const handlePayNow = async () => {
    if (!selectedAgreement || !totalAmountForSelectedAgreement) {
      toast({
        title: "Error",
        description: "No agreement or amount to pay.",
        variant: "destructive",
      });
      return;
    }

    const billIds = selectedAgreement.bills.map((b) => b.id);
    setIsLoading(true);
    const result = await initiatePaymentAction(
      billIds,
      totalAmountForSelectedAgreement,
      selectedAgreement.id,
      nibToken,
    );

    if (result.success && result.paymentToken) {
      toast({
        title: "Action Required",
        description: "Please complete the payment in your NIB SuperApp.",
      });
      if (window.myJsChannel?.postMessage) {
        window.myJsChannel.postMessage({ token: result.paymentToken });
      } else {
        console.error("NIB Super App channel (window.myJsChannel) not found.");
        setError(
          "Could not communicate with the payment app. Please try again.",
        );
      }
    } else {
      toast({
        title: "Payment Failed",
        description: result.error,
        variant: "destructive",
      });
    }
    setIsLoading(false);
  };

  const startPolling = (billIds: string[]) => {
    setIsPolling(true);
    let pollCount = 0;
    const maxPolls = 60; // 5 minutes

    pollIntervalRef.current = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setIsPolling(false);
        setError(
          "Payment status check timed out. Please check your transaction history later.",
        );
        return;
      }

      const statusResult = await getBillStatusAction(billIds);
      if (statusResult.status === "Paid") {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setIsPolling(false);
        setBillingInfo({ agreements: [], message: "Payment was successful!" });
        setSelectedAgreementId(null);
      }
    }, 5000);
  };

  return (
    <div className="flex justify-center items-start min-h-[80vh] bg-background pt-8 sm:pt-16">
      <Card className="w-full max-w-lg shadow-2xl animate-fadeIn border-t-4 border-primary">
        <CardHeader className="text-center">
          <CardTitle className="font-headline text-2xl mt-2">
            Pay Your Bills
          </CardTitle>
          <CardDescription className="px-4">
            Confirm your phone number to fetch your outstanding bills and
            agreements.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {/* Phone Number Input */}
          <div className="space-y-2">
            <Label
              htmlFor="phone"
              className="flex items-center text-muted-foreground"
            >
              <Phone className="mr-2 h-4 w-4" />
              Enter your phone number
            </Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your phone number"
                className="text-lg h-12 flex-grow"
                disabled={isLoading || isPolling}
              />
              <Button
                onClick={handleGetBillingInfo}
                disabled={isLoading || isPolling || !phone}
                className="h-12 text-base px-6"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Get Info"
                )}
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertOctagon className="h-5 w-5 shrink-0" /> <p>{error}</p>
            </div>
          )}

          {isPolling && (
            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg animate-pulse space-y-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
              <p className="font-semibold text-primary">
                Awaiting Payment Confirmation...
              </p>
              <p className="text-sm text-muted-foreground">
                Please complete the transaction in the NIB app. This page will
                update automatically.
              </p>
            </div>
          )}

          {/* Step 2 & 3: Display Agreements and Bills */}
          {!isPolling && billingInfo && (
            <div className="mt-6 space-y-4 animate-fadeIn">
              {billingInfo.message && (
                <div className="flex flex-col items-center gap-3 text-green-700 py-4 p-4 bg-green-500/10 border rounded-lg">
                  <CheckCircle className="h-10 w-10 shrink-0" />
                  <p className="font-medium text-lg text-center">
                    {billingInfo.message}
                  </p>
                </div>
              )}

              {billingInfo.agreements.length > 0 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Select an agreement to pay for</Label>
                    <Select
                      value={selectedAgreementId || ""}
                      onValueChange={setSelectedAgreementId}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Choose an agreement..." />
                      </SelectTrigger>
                      <SelectContent>
                        {billingInfo.agreements.map((ag) => (
                          <SelectItem key={ag.id} value={ag.id}>
                            {ag.space?.spaceIdName}, {ag.space?.building.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedAgreement && (
                    <div className="p-4 bg-secondary/40 border rounded-lg space-y-4">
                      <h3 className="font-semibold text-lg text-foreground">
                        Bills for {selectedAgreement.space?.spaceIdName}
                      </h3>
                      <Accordion type="single" collapsible className="w-full">
                        {selectedAgreement.bills.map((bill) => (
                          <AccordionItem
                            value={bill.id}
                            key={bill.id}
                            className="border-b"
                          >
                            <AccordionTrigger className="font-medium hover:no-underline text-base">
                              <div className="flex justify-between w-full items-center pr-4">
                                <span>
                                  Bill for {format(bill.billDate, "MMM yyyy")}
                                </span>
                                <span className="font-semibold text-foreground">
                                  {bill.totalAmount.toFixed(2)} Birr
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pt-2 pb-4 bg-background/50 rounded-b-md">
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span>Rent:</span>{" "}
                                  <span>{bill.rentAmount.toFixed(2)}</span>
                                </div>
                                {(bill.utilityBreakdown || []).length > 0 && (
                                  <div className="pl-4 border-l-2 border-primary/50 py-1 space-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">
                                        Utilities:
                                      </span>
                                    </div>
                                    {(bill.utilityBreakdown || []).map(
                                      (item, index) => (
                                        <div
                                          key={index}
                                          className="flex justify-between text-muted-foreground pl-2 text-xs"
                                        >
                                          <span>- {item.name}</span>
                                          <span>{item.amount.toFixed(2)}</span>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                                {bill.penaltyAmount > 0 && (
                                  <div className="flex justify-between text-destructive font-medium">
                                    <span>Penalty:</span>{" "}
                                    <span>{bill.penaltyAmount.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="border-t my-2"></div>
                                <div className="flex justify-between font-bold text-base">
                                  <span>Total:</span>{" "}
                                  <span>{bill.totalAmount.toFixed(2)}</span>
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>

                      <div className="border-t pt-4">
                        <p className="text-sm text-muted-foreground">
                          Total to Pay for this Agreement
                        </p>
                        <p className="text-4xl font-bold font-headline text-primary flex items-baseline gap-2">
                          <Banknote className="h-8 w-8" />
                          {totalAmountForSelectedAgreement.toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                          <span className="text-2xl text-muted-foreground font-medium">
                            Birr
                          </span>
                        </p>
                      </div>
                      <Button
                        onClick={handlePayNow}
                        className="w-full h-12 text-lg"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : null}
                        Pay Total Amount
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
