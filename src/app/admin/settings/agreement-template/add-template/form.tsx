"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { Loader2, Save, Info, Clipboard, EyeOff } from "lucide-react";
import { upsertAgreementTemplateAction } from "../actions";
import type { AgreementTemplate } from "@prisma/client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AgreementTemplateSlateEditor,
  stripHtmlToTextLength,
} from "./slate-editor";

const templateFormSchema = z.object({
  name: z.string().min(3, "Template name must be at least 3 characters."),
  content: z.string().refine((val) => stripHtmlToTextLength(val) >= 50, {
    message: "Template content must be at least 50 characters.",
  }),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

interface AddTemplateFormProps {
  initialData?: AgreementTemplate | null;
}

export function AddTemplateForm({ initialData }: AddTemplateFormProps) {
  const { toast } = useToast();
  const { hasPermission, isLoading } = usePermissions();
  const canManageTemplates = hasPermission(
    "settings:agreement_templates:manage",
  );

  // Wait for permissions to load to avoid transient Access Denied flashes
  if (isLoading) {
    return (
      <Card className="shadow-lg">
        <CardContent>
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: initialData?.name || "",
      content: initialData?.content || "",
    },
  });

  const placeholders = [
    {
      label: "Tenant Name",
      value: "{{tenantName}}",
      description: "The full name of the tenant.",
    },
    {
      label: "Building Name",
      value: "{{buildingName}}",
      description: "The name of the building.",
    },
    {
      label: "Space ID/Name",
      value: "{{spaceIdName}}",
      description: 'The identifier for the rented space (e.g., "Unit 101").',
    },
    {
      label: "Floor",
      value: "{{floor}}",
      description: "The floor where the space is located.",
    },
    {
      label: "Area (sqm)",
      value: "{{area}}",
      description: "The total area of the space in square meters.",
    },
    {
      label: "Start Date",
      value: "{{startDate}}",
      description: "The official start date of the lease agreement.",
    },
    {
      label: "Term (Months)",
      value: "{{paymentTermMonths}}",
      description: "The total duration of the lease in months.",
    },
    {
      label: "Monthly Rent",
      value: "{{monthlyRent}}",
      description: "The amount of rent due each month.",
    },
    {
      label: "Initial Payment (Months)",
      value: "{{initialPaymentMonths}}",
      description: "The number of months paid upfront.",
    },
    {
      label: "Initial Payment Amount",
      value: "{{initialPaymentAmount}}",
      description: "The total upfront payment amount.",
    },
    {
      label: "Next Payment Due",
      value: "{{nextPaymentDueDate}}",
      description: "The date the next lease payment is due.",
    },
    {
      label: "Additional Terms",
      value: "{{additionalTerms}}",
      description: "Any extra clauses or terms added to the agreement.",
    },
  ];

  const handleFormSubmit = async (values: TemplateFormValues) => {
    setIsSaving(true);
    const result = await upsertAgreementTemplateAction({
      id: initialData?.id,
      ...values,
    });
    // The action now handles redirection, so we don't need to do much here.
    // We just handle the toast messages.
    setIsSaving(false);
    if (result?.error) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: `Template "${values.name}" has been saved.`,
      });
    }
  };

  if (!canManageTemplates) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <EyeOff /> Access Denied
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>Access Denied</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <Card className="md:col-span-2 shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)}>
            <CardContent className="p-6">
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Template Name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Content</FormLabel>
                      <FormControl>
                        <AgreementTemplateSlateEditor
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={
                            "Enter agreement template content here... Use placeholders from the right panel."
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-4">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Template
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      <div className="hidden md:block">
        <Card className="sticky top-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-md">
              <Info className="h-5 w-5 text-primary" />
              Available Placeholders
            </CardTitle>
            <CardDescription className="text-xs">
              Click to copy a placeholder to your clipboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <ScrollArea className="h-[50vh] w-full pr-2">
              <div className="space-y-2">
                {placeholders.map((p) => (
                  <div
                    key={p.value}
                    className="p-2 bg-secondary/30 rounded-md flex items-center justify-between gap-2"
                  >
                    <div>
                      <p className="font-semibold text-sm text-primary">
                        {p.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(p.value);
                        toast({
                          title: "Copied!",
                          description: `Placeholder ${p.value} copied.`,
                        });
                      }}
                    >
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
