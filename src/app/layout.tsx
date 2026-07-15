// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PermissionProvider } from "@/contexts/PermissionContext";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Nib Building Management",
  description: "A comprehensive building management solution.",
  icons: { icon: "/images/Nibtera.png" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const nonce = h.get("x-nonce") || "";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="icon"
          href="/images/Nibtera.png"
          type="image/png"
          sizes="any"
        />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />

        {/* Combined Google Fonts with nonce */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&display=swap"
          rel="stylesheet"
          nonce={nonce}
        />
      </head>

      <body className="font-body antialiased">
        <PermissionProvider>
          {children}
          <Toaster />
        </PermissionProvider>
      </body>
    </html>
  );
}
