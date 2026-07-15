
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function PaymentErrorPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md text-center p-6 shadow-lg animate-fadeIn border-t-4 border-destructive">
        <CardHeader>
          <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
          <CardTitle className="mt-4 text-2xl font-bold font-headline">Payment Failed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Unfortunately, we were unable to process your payment. Please try again or contact support if the issue persists.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/portal/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
