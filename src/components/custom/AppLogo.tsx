"use client";

import Image from "next/image";
import Link from "next/link";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function AppLogo() {
  const { isMobile, state: sidebarState } = useSidebar();
  const isCollapsed = !isMobile && sidebarState === "collapsed";

  return (
    <Link
      href="/admin/dashboard"
      className="flex items-center gap-2 text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors w-full"
    >
      <Image
        src="/images/NibLogo.png"
        alt="Building Management Solution Logo"
        width={40}
        height={40}
        className={cn(
          "h-10 w-10 object-contain transition-all duration-300 shrink-0",
          isCollapsed && "w-8 h-8",
        )}
      />
      <div
        className={cn(
          "transition-all duration-300",
          isCollapsed ? "opacity-0 w-0 hidden" : "opacity-100",
        )}
      >
        <h1
          className={cn(
            "font-headline text-base leading-tight font-bold text-sidebar-primary",
          )}
        >
          Building Management Solution
        </h1>
      </div>
    </Link>
  );
}
