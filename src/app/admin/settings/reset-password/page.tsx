
'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Home } from 'lucide-react';
import Link from 'next/link';

function ResetPasswordDisabledPage() {
  const router = useRouter();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
        <CardTitle className="mt-4">Functionality Disabled</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-center text-muted-foreground">This password reset link is no longer active. User password resets are now handled by an administrator in the User Management settings.</p>
        <Button onClick={() => router.push('/admin/dashboard')} className="w-full mt-6">
            <Home className="mr-2 h-4 w-4" /> Go to Dashboard
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AdminResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordDisabledPage />
        </Suspense>
    )
}
