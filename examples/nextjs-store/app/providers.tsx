"use client";

import type { ReactNode } from "react";
import { TerraProvider } from "@terrawallet/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TerraProvider
      appName="Terra Demo Store"
      appIcon="https://terrawallet.us/icon.png"
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined}
      chains={[8453, 137, 1]}
      theme={{ mode: "auto", accent: "#0A5BFF", radius: 14 }}
    >
      {children}
    </TerraProvider>
  );
}
