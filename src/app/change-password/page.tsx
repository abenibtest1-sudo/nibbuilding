import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ChangePasswordClientPage } from "./client-page";
import { verifySession } from "@/lib/auth/jwt";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

async function ChangePasswordPageDataFetcher() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const session = await verifySession(token);

  // If a user who is NOT forced to change their password lands here, redirect them.
  // Or if there's no session at all, redirect to login.
  if (!session) {
    redirect("/login");
  }
  if (!session.forceChangePass) {
    redirect("/admin/dashboard");
  }

  return <ChangePasswordClientPage />;
}

export default function TenantChangePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md">
        <Suspense
          fallback={
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          }
        >
          <ChangePasswordPageDataFetcher />
        </Suspense>
      </div>
    </main>
  );
}
