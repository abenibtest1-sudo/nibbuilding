"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useState, useEffect } from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { AppLogo } from "@/components/custom/AppLogo";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Building2,
  Users,
  FileText,
  Banknote,
  LogOut,
  Settings,
  UserCircle,
  Wrench,
  ClipboardList,
  Building,
  ExternalLink,
  Loader2,
  EyeOff,
  Eye,
  LayoutGrid,
  UploadCloud,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { PermissionId } from "@/lib/types";
import Image from "next/image";
import { usePermissions } from "@/contexts/PermissionContext";
import NotificationBell from "@/components/custom/NotificationBell";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  permission: PermissionId;
}

const allNavItems: NavItem[] = [
  {
    href: "/admin/dashboard",
    label: "Dashboard",
    icon: LayoutGrid,
    permission: "dashboard:view",
  },
  {
    href: "/admin/buildings",
    label: "Buildings",
    icon: Building,
    permission: "building:view",
  },
  {
    href: "/admin/spaces",
    label: "Spaces",
    icon: Building2,
    permission: "space:view",
  },
  {
    href: "/admin/tenants",
    label: "Tenants",
    icon: Users,
    permission: "tenant:view",
  },
  {
    href: "/admin/agreements",
    label: "Agreements",
    icon: FileText,
    permission: "agreement:view",
  },
  {
    href: "/admin/building-utilities",
    label: "Building Utilities",
    icon: Wrench,
    permission: "building_utility:view",
  },
  {
    href: "/admin/billing",
    label: "Billing",
    icon: Banknote,
    permission: "billing:view",
  },
  {
    href: "/admin/payments-overview",
    label: "Payments Overview",
    icon: ClipboardList,
    permission: "payment_overview:view",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    permission: "settings:user_management:view",
  }, // Generic settings permission
];

function ActualAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { isMobile, state: sidebarState } = useSidebar();
  const { currentUser, hasPermission, isSuperAdmin, logout } = usePermissions();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      // If this is a settings route and the current user has any settings
      // permission, swallow the generic Access Denied banner because the
      // middleware may have redirected the user into a settings subpage
      // without an actual denial. Otherwise show the toast.
      const isSettingsRoute = pathname.startsWith("/admin/settings");
      const hasAnySettingsPermission =
        isSuperAdmin ||
        hasPermission("settings:user_management:view") ||
        hasPermission("settings:role_management:view") ||
        hasPermission("settings:application_settings:manage") ||
        hasPermission("settings:agreement_templates:manage") ||
        hasPermission("import:manage");

      if (!isSettingsRoute || !hasAnySettingsPermission) {
        toast({
          title: "Access Denied",
          description: decodeURIComponent(error),
          variant: "destructive",
        });
      }

      // Remove the error from the URL without reloading the page
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, pathname, router, toast]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    // The logout function handles redirection.
    setIsLoggingOut(false);
  };

  const userInitials =
    currentUser?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "AD";

  const availableNavItems = allNavItems.filter((item) => {
    // A special check for the generic settings link
    if (item.href === "/admin/settings") {
      return (
        isSuperAdmin ||
        hasPermission("settings:user_management:view") ||
        hasPermission("settings:role_management:view") ||
        hasPermission("settings:application_settings:manage") ||
        hasPermission("settings:user_registration:manage") ||
        hasPermission("settings:agreement_templates:manage") ||
        hasPermission("import:manage") ||
        hasPermission("audit:view")
      );
    }
    return isSuperAdmin || hasPermission(item.permission);
  });

  return (
    <>
      <Sidebar collapsible="icon" side="left" variant="sidebar">
        <SidebarHeader className="p-4 border-b border-sidebar-border">
          <div className="flex items-center justify-between">
            <AppLogo />
            <SidebarTrigger className="md:group-data-[state=expanded]/sidebar-wrapper:hidden" />
          </div>
        </SidebarHeader>
        <SidebarContent className="p-2">
          <SidebarMenu>
            {availableNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/admin/dashboard" &&
                  pathname.startsWith(item.href));

              const sidebarButtonContent = (
                <>
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span
                    className={cn(
                      "flex-1 min-w-0 text-base",
                      !isMobile && sidebarState === "collapsed"
                        ? "hidden"
                        : "truncate",
                    )}
                  >
                    {item.label}
                  </span>
                </>
              );

              const commonLinkProps = {
                href: item.href,
              };

              const sidebarMenuButtonProps = {
                isActive: isActive,
                className: cn("h-10"),
                size: "default" as const,
              };

              if (!isMobile && sidebarState === "collapsed") {
                return (
                  <SidebarMenuItem key={item.href}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link {...commonLinkProps}>
                          <SidebarMenuButton {...sidebarMenuButtonProps}>
                            {sidebarButtonContent}
                          </SidebarMenuButton>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="font-headline">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                );
              }
              return (
                <SidebarMenuItem key={item.href}>
                  <Link {...commonLinkProps}>
                    <SidebarMenuButton {...sidebarMenuButtonProps}>
                      {sidebarButtonContent}
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-4 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center group-data-[state=expanded]/sidebar-wrapper:justify-start group-data-[state=collapsed]/sidebar-wrapper:justify-center gap-2 w-full p-2 h-auto text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{userInitials}</AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "text-left",
                    "group-data-[state=collapsed]/sidebar-wrapper:hidden",
                  )}
                >
                  <p className="text-sm font-medium">
                    {currentUser?.name || "Admin User"}
                  </p>
                  <p className="text-xs text-sidebar-foreground/70">
                    {currentUser?.email || "admin@example.com"}
                  </p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push("/admin/profile")}>
                <UserCircle className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push("/admin/settings")}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleLogout} disabled={isLoggingOut}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>{isLoggingOut ? "Logging out..." : "Log out"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col transition-[margin-left] duration-300 ease-in-out md:ml-[var(--sidebar-width-icon)] group-data-[state=expanded]:md:ml-[var(--sidebar-width)]">
        <header className="flex h-[3.7rem] shrink-0 items-center border-b bg-background px-4 sm:px-6 lg:px-8">
          <SidebarTrigger className="md:hidden" />
          <SidebarTrigger className="hidden md:group-data-[state=collapsed]/sidebar-wrapper:flex" />
          <div className="ml-auto hidden md:flex items-center">
            <NotificationBell inline />
          </div>
        </header>
        <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </>
  );
}

export default function AdminClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated, logout } = usePermissions();
  const router = useRouter();

  useEffect(() => {
    // Only redirect when loading is finished. Use `logout()` to force a full-page
    // navigation so the `PermissionContext` remounts and the login form renders.
    if (!isLoading && !isAuthenticated) {
      // logout will clear client state and perform a hard redirect to /login
      logout();
    }
  }, [isAuthenticated, isLoading, router]);

  // While loading, or if not authenticated (and waiting for redirect), show a loader.
  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex justify-center items-center h-screen w-screen">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  // If authenticated, render the main layout
  return (
    <SidebarProvider defaultOpen>
      <TooltipProvider>
        <ActualAdminLayout>{children}</ActualAdminLayout>
      </TooltipProvider>
    </SidebarProvider>
  );
}
