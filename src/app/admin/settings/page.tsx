"use client";

import React, { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  UserPlus,
  Users,
  ShieldCheck,
  Mail,
  KeyRound,
  FileText,
  UploadCloud,
  History,
  CalendarDays,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { usePermissions } from "@/contexts/PermissionContext";
import { useRouter } from "next/navigation";

// This page will act as a hub for different settings.
export default function SettingsPage() {
  const { hasAnyPermission, isSuperAdmin, isLoading } = usePermissions();
  const router = useRouter();

  const canManageUserRegistration =
    isSuperAdmin || hasAnyPermission(["settings:user_registration:manage"]);
  const canManageUserManagement =
    isSuperAdmin ||
    hasAnyPermission([
      "settings:user_management:view",
      "settings:user_management:assign",
    ]);
  const canManageRoleManagement =
    isSuperAdmin ||
    hasAnyPermission([
      "settings:role_management:view",
      "settings:role_management:manage",
    ]);
  const canManageBillDateConfiguration =
    isSuperAdmin || hasAnyPermission(["settings:application_settings:manage"]);
  const canManageAgreementTemplates =
    isSuperAdmin || hasAnyPermission(["settings:agreement_templates:manage"]);
  const canManageImport = isSuperAdmin || hasAnyPermission(["import:manage"]);
  const canViewAuditLog = isSuperAdmin || hasAnyPermission(["audit:view"]);

  const canViewAnySettings =
    canManageUserRegistration ||
    canManageUserManagement ||
    canManageRoleManagement ||
    canManageBillDateConfiguration ||
    canManageAgreementTemplates ||
    canManageImport ||
    canViewAuditLog;

  useEffect(() => {
    if (!isLoading && !canViewAnySettings) {
      router.replace(
        "/admin/dashboard?error=" + encodeURIComponent("Access Denied"),
      );
    }
  }, [canViewAnySettings, router, isLoading]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const settingCards = [
    {
      show: canManageUserRegistration,
      href: "/admin/settings/user-registration",
      title: "User Registration",
      description: "Register new users for the application.",
      details:
        "Create new accounts. New users are created without any roles by default.",
      icon: UserPlus,
      buttonText: "Go to User Registration",
    },
    {
      show: canManageUserManagement,
      href: "/admin/settings/user-management",
      title: "User Management",
      description: "Manage user roles and the buildings they are assigned to.",
      details:
        "Assign roles and buildings to users to control access and responsibilities.",
      icon: Users,
      buttonText: "Go to User Management",
    },
    {
      show: canManageRoleManagement,
      href: "/admin/settings/role-management",
      title: "Role Management",
      description: "Define roles and their permissions within the application.",
      details:
        "Create new roles, or edit existing ones to specify what actions users with that role can perform.",
      icon: ShieldCheck,
      buttonText: "Go to Role Management",
    },
    {
      show: canManageBillDateConfiguration,
      href: "/admin/settings/bill-date-configuration",
      title: "Bill Date Configuration",
      description:
        "Configure billing cycle lengths used when generating agreement bills for specific buildings.",
      details:
        "Select a building and set a value from 1 to 31 days, or leave it empty to use the default 30-day billing cycle.",
      icon: CalendarDays,
      buttonText: "Configure Bill Date",
    },
    {
      show: canManageAgreementTemplates,
      href: "/admin/settings/agreement-template",
      title: "Agreement Templates",
      description:
        "Manage reusable templates for generating new lease agreements.",
      details:
        "Create and edit standard agreement text. Use placeholders to automatically insert details during generation.",
      icon: FileText,
      buttonText: "Manage Templates",
    },
    {
      show: canManageImport,
      href: "/admin/import",
      title: "Import Data",
      description: "Bulk import spaces, tenants, and agreements.",
      details:
        "Use an Excel template to quickly upload multiple records into the system at once.",
      icon: UploadCloud,
      buttonText: "Go to Import Tool",
    },
    {
      show: canViewAuditLog,
      href: "/admin/audit-log",
      title: "Audit Log",
      description: "View a read-only log of all financial transactions.",
      details:
        "Review a detailed history of all recorded payments, including amounts, dates, and references.",
      icon: History,
      buttonText: "View Audit Log",
    },
  ];

  const availableCards = settingCards.filter((card) => card.show);

  return (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {availableCards.map((card) => (
        <Card key={card.href} className="flex flex-col">
          <CardHeader>
            <CardTitle className="font-headline">{card.title}</CardTitle>
            <CardDescription>{card.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <p className="text-sm text-muted-foreground mb-4">{card.details}</p>
          </CardContent>
          <CardFooter>
            <Link href={card.href} passHref>
              <Button>
                <card.icon className="mr-2 h-4 w-4" /> {card.buttonText}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
