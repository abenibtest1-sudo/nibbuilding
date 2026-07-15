
import React from 'react';
import { PageHeader } from '@/components/custom/PageHeader';
import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Building Management Solution",
  description: "A comprehensive building management solution.",
  icons: {
    icon: "/images/Nibtera.png",
  },
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Application Settings"
        icon={SettingsIcon}
        description="Manage users and other application configurations."
      />
      {/* Add navigation for sub-settings pages if needed in the future */}
      {/* 
      <nav className="mb-6">
        <Link href="/admin/settings/user-registration" className="mr-4 hover:underline">User Registration</Link>
        // Other settings links
      </nav>
      */}
      <div className="mt-6">
        {children}
      </div>
    </div>
  );
}
