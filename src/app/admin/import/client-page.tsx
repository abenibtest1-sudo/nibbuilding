"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  UploadCloud,
  File,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  ListChecks,
  FileText,
  EyeOff,
} from "lucide-react";
import XLSX from "xlsx-js-style";
import { processImportAction } from "./actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePermissions } from "@/contexts/PermissionContext";

interface ImportClientPageProps {
  agreementTemplates: { id: string; name: string }[];
}

interface ImportSummary {
  createdCount: {
    spaces: number;
    tenants: number;
    agreements: number;
  };
  skippedCount: {
    spaces: number;
    tenants: number;
    agreements: number;
  };
  errors: string[];
}

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ROWS_PER_SHEET = 2000;

export function ImportClientPage({
  agreementTemplates,
}: ImportClientPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [agreementTemplateId, setAgreementTemplateId] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const { toast } = useToast();
  const { hasPermission, isSuperAdmin, managesBuildings } = usePermissions();
  const canManageImport =
    isSuperAdmin || hasPermission("import:manage") || managesBuildings;
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setFile(null); // Reset on new drop

      if (fileRejections.length > 0) {
        const firstRejection = fileRejections[0];
        const firstError = firstRejection.errors[0];

        if (firstError.code === "file-too-large") {
          toast({
            title: "File Too Large",
            description: `The file exceeds the maximum allowed size of ${MAX_FILE_SIZE_MB}MB.`,
            variant: "destructive",
          });
        } else if (firstError.code === "file-invalid-type") {
          toast({
            title: "Invalid File Type",
            description: "Please upload a valid .xlsx Excel file.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "File Error",
            description:
              firstError.message ||
              "The selected file could not be uploaded. Please try again.",
            variant: "destructive",
          });
        }
        return;
      }

      if (acceptedFiles.length > 0) {
        setFile(acceptedFiles[0]);
        toast({
          title: "File Selected",
          description: `${acceptedFiles[0].name} is ready for import.`,
        });
      }
    },
    [toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      [XLSX_MIME_TYPE]: [".xlsx"],
    },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE_BYTES,
  });

  const handleDownloadTemplate = () => {
    const spacesData = [
      [
        "buildingName",
        "spaceIdName",
        "floor",
        "area",
        "monthlyRentalPrice",
        "prorationShare",
      ],
      ["Century Mall", "Office 101", "1", 100, 100000, 15],
    ];
    const tenantsData = [
      [
        "name",
        "email",
        "phone",
        "alternativePhone (Optional)",
        "nationalId",
        "representativeName (Optional)",
        "representativePhone (Optional)",
      ],
      [
        "Robel Asaminew",
        "robel@example.com",
        "0912345677",
        "",
        "1234567890123456",
        "",
        "",
      ],
    ];
    const agreementsData = [
      [
        "tenantEmail",
        "buildingName",
        "spaceIdName",
        "startDate",
        "termMonths",
        "initialPaymentMonths",
        "additionalTerms (Optional)",
      ],
      [
        "robel@example.com",
        "Century Mall",
        "Office 101",
        "2025-12-22",
        12,
        1,
        "",
      ],
    ];

    const wb = XLSX.utils.book_new();
    const wsSpaces = XLSX.utils.aoa_to_sheet(spacesData);
    const wsTenants = XLSX.utils.aoa_to_sheet(tenantsData);
    const wsAgreements = XLSX.utils.aoa_to_sheet(agreementsData);

    XLSX.utils.book_append_sheet(wb, wsSpaces, "Spaces");
    XLSX.utils.book_append_sheet(wb, wsTenants, "Tenants");
    XLSX.utils.book_append_sheet(wb, wsAgreements, "Agreements");

    XLSX.writeFile(wb, "nibrental_Import_Template.xlsx");
  };

  const handleImport = async () => {
    if (!canManageImport) {
      toast({
        title: "Permission Denied",
        description: "Access Denied",
        variant: "destructive",
      });
      return;
    }
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select an Excel file to import.",
        variant: "destructive",
      });
      return;
    }
    if (!agreementTemplateId) {
      toast({
        title: "No template selected",
        description:
          "Please select an agreement template to use for generating agreements.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setImportSummary(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });

        // **Strict Sheet Name Validation**
        const requiredSheets = ["Spaces", "Tenants", "Agreements"];
        const missingSheets = requiredSheets.filter(
          (sheetName) => !workbook.SheetNames.includes(sheetName),
        );
        if (missingSheets.length > 0) {
          throw new Error(
            `The Excel file is missing required sheets: ${missingSheets.join(
              ", ",
            )}. Please use the template.`,
          );
        }

        const spacesRaw = XLSX.utils.sheet_to_json(workbook.Sheets["Spaces"]);
        const tenantsRaw = XLSX.utils.sheet_to_json(workbook.Sheets["Tenants"]);
        const agreementsRaw = XLSX.utils.sheet_to_json(
          workbook.Sheets["Agreements"],
          { raw: false, dateNF: "yyyy-mm-dd" },
        );

        // Row count validation
        if (spacesRaw.length > MAX_ROWS_PER_SHEET) {
          throw new Error(
            `The "Spaces" sheet has too many rows. The maximum allowed is ${MAX_ROWS_PER_SHEET}.`,
          );
        }
        if (tenantsRaw.length > MAX_ROWS_PER_SHEET) {
          throw new Error(
            `The "Tenants" sheet has too many rows. The maximum allowed is ${MAX_ROWS_PER_SHEET}.`,
          );
        }
        if (agreementsRaw.length > MAX_ROWS_PER_SHEET) {
          throw new Error(
            `The "Agreements" sheet has too many rows. The maximum allowed is ${MAX_ROWS_PER_SHEET}.`,
          );
        }

        const spaces = JSON.parse(JSON.stringify(spacesRaw));
        const tenants = JSON.parse(JSON.stringify(tenantsRaw));
        const agreements = JSON.parse(JSON.stringify(agreementsRaw));

        const result = await processImportAction({
          spaces,
          tenants,
          agreements,
          agreementTemplateId,
        });
        setImportSummary(result);

        if (result.success) {
          toast({
            title: "Import Successful",
            description:
              result.createdCount.agreements > 0
                ? "Your data has been processed. Imported agreements are now available under Pending status."
                : "Your data has been processed.",
          });
        } else {
          toast({
            title: "Import Completed with Errors",
            description:
              result.createdCount.agreements > 0
                ? "Some records could not be imported. Imported agreements are now available under Pending status. See summary for details."
                : "Some records could not be imported. See summary for details.",
            variant: "destructive",
          });
        }
      } catch (error: any) {
        toast({
          title: "Import Failed",
          description:
            error.message ||
            "Failed to read or process the Excel file. Ensure it is not corrupted and matches the template format.",
          variant: "destructive",
        });
        setImportSummary(null); // Clear summary on failure
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  if (!isMounted) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canManageImport) {
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

  if (agreementTemplates.length === 0) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <AlertCircle /> Prerequisite Missing
          </CardTitle>
          <CardDescription>
            You must have at least one Agreement Template before you can import
            data that includes agreements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p>
            Please go to Settings &gt; Agreement Templates to create your first
            template.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>1. Download & Prepare</CardTitle>
          <CardDescription>
            Download the Excel template and fill it with your data.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button
            onClick={handleDownloadTemplate}
            variant="outline"
            className="w-full"
          >
            <Download className="mr-2 h-4 w-4" /> Download Template
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            The template has three sheets: Spaces, Tenants, and Agreements.
            Please ensure buildings exist before importing spaces. Each sheet
            has a maximum limit of {MAX_ROWS_PER_SHEET} rows.
          </p>
        </CardContent>
        <CardHeader>
          <CardTitle>2. Select Agreement Template</CardTitle>
          <CardDescription>
            Choose the template to use for generating imported agreements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="agreementTemplate">Agreement Template</Label>
          <Select
            onValueChange={setAgreementTemplateId}
            value={agreementTemplateId}
          >
            <SelectTrigger id="agreementTemplate">
              <SelectValue placeholder="Select a template..." />
            </SelectTrigger>
            <SelectContent>
              {agreementTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
        <CardHeader>
          <CardTitle>3. Upload & Import</CardTitle>
          <CardDescription>
            Upload your completed Excel file to import the data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            {isDragActive ? (
              <p>Drop the file here ...</p>
            ) : (
              <p>Drag & drop your file here, or click to select</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              XLSX files only, max {MAX_FILE_SIZE_MB}MB.
            </p>
          </div>
          {file && (
            <div className="mt-4 p-3 border rounded-md flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{file.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                Remove
              </Button>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleImport}
            disabled={!file || !agreementTemplateId || isProcessing}
            className="w-full"
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="mr-2 h-4 w-4" />
            )}
            {isProcessing ? "Processing..." : "Import Data"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Import Summary</CardTitle>
          <CardDescription>
            Results of the last import process will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!importSummary && (
            <div className="text-center py-10 text-muted-foreground">
              <ListChecks className="mx-auto h-12 w-12 mb-4" />
              <p>Ready to import.</p>
            </div>
          )}
          {importSummary && (
            <div className="space-y-4">
              {importSummary.errors.length === 0 ? (
                <Alert
                  variant="default"
                  className="bg-green-50 border-green-200 text-green-800"
                >
                  <CheckCircle className="h-4 w-4 !text-green-800" />
                  <AlertTitle>Import Successful</AlertTitle>
                  <AlertDescription>
                    {importSummary.createdCount.agreements > 0
                      ? "All records were processed without critical errors. Imported agreements are now available under Pending status."
                      : "All records were processed without critical errors."}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Import Completed with Errors</AlertTitle>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-secondary/50">
                  <CardHeader className="p-3">
                    <CardTitle className="text-sm">Created</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 text-sm space-y-1">
                    <p>Spaces: {importSummary.createdCount.spaces}</p>
                    <p>Tenants: {importSummary.createdCount.tenants}</p>
                    <p>Agreements: {importSummary.createdCount.agreements}</p>
                  </CardContent>
                </Card>
                <Card className="bg-secondary/50">
                  <CardHeader className="p-3">
                    <CardTitle className="text-sm">
                      Skipped (Already Exist)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 text-sm space-y-1">
                    <p>Spaces: {importSummary.skippedCount.spaces}</p>
                    <p>Tenants: {importSummary.skippedCount.tenants}</p>
                    <p>Agreements: {importSummary.skippedCount.agreements}</p>
                  </CardContent>
                </Card>
              </div>

              {importSummary.createdCount.agreements > 0 && (
                <Alert className="border-primary/20 bg-primary/5 text-primary">
                  <AlertCircle className="h-4 w-4 !text-primary" />
                  <AlertTitle>Imported Agreements</AlertTitle>
                  <AlertDescription>
                    {importSummary.createdCount.agreements} imported agreement
                    {importSummary.createdCount.agreements === 1
                      ? " is"
                      : "s are"}{" "}
                    available on the Agreements page under Pending status.
                  </AlertDescription>
                </Alert>
              )}

              {importSummary.errors.length > 0 && (
                <div>
                  <h4 className="font-semibold text-destructive mb-2">
                    Errors:
                  </h4>
                  <ScrollArea className="h-48 w-full rounded-md border p-4 bg-destructive/10">
                    <ul className="space-y-2 text-xs text-destructive">
                      {importSummary.errors.map((error, index) => (
                        <li key={index}>- {error}</li>
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
