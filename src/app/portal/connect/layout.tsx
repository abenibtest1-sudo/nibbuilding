
import React from 'react';

// This layout doesn't need any special client-side logic.
// It just passes children through.
export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
