import { BillingClientPage } from "./client-page";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; token?: string }>;
}) {
  const sp = await searchParams;
  const phone = sp.phone ?? "";
  const nibToken = sp.token ?? "";

  // Web portal usage may not provide a SuperApp token; still allow bill lookup.
  return <BillingClientPage initialPhone={phone} nibToken={nibToken} />;
}
