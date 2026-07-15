
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';

export default function PaymentCancelPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md text-center p-6 shadow-lg animate-fadeIn border-t-4 border-yellow-500">
        <CardHeader>
          <Info className="mx-auto h-16 w-16 text-yellow-500" />
          <CardTitle className="mt-4 text-2xl font-bold font-headline">Payment Cancelled</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Your payment process has been cancelled. You can try again from your dashboard when you are ready.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/portal/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
