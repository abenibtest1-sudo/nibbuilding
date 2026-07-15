import type React from 'react';
import AdminClientLayout from './admin-client-layout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Nib Building Management",
  description: "A comprehensive building management solution.",
  icons: {
    icon: "/images/Nibtera.png",
  },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
      <AdminClientLayout>{children}</AdminClientLayout>
  );
}
