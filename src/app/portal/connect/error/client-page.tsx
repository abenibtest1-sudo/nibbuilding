"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

export function ConnectionErrorClientPage() {
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  const errorMessage = useMemo(() => {
    switch (message) {
      case "token_invalid":
        return "The connection token is invalid or has expired. Please try accessing the portal from the NIB Super App again.";
      case "session_failed":
        return "There was a problem establishing your session. Please try again.";
      default:
        return "An unknown error occurred while trying to connect to the portal. Please try again later.";
    }
  }, [message]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md text-center p-6 shadow-lg animate-fadeIn border-t-4 border-destructive">
        <CardHeader>
          <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
          <CardTitle className="mt-4 text-2xl font-bold font-headline">
            Connection Failed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{errorMessage}</p>
        </CardContent>
      </Card>
    </div>
  );
}
