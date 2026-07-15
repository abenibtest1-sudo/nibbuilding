"use client";

import { BillingClientPage } from "../billing/client-page";

interface Props {
  token: string;
  phone: string;
  
}

export function ConnectionSuccessPage({ token, phone }: Props) {
  // For SuperApp access, do NOT rely on local sessions or DB-backed jti checks.
  // We validate the bearer token on the server in /portal/connect and then
  // immediately render the billing form (phone input) here.
  return <BillingClientPage initialPhone={phone} nibToken={token} />;
}
