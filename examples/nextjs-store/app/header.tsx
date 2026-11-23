"use client";

import { ConnectButton, useAccount } from "@terrawallet/react";

export function Header() {
  const { isConnected, chain } = useAccount();
  return (
    <header className="header">
      <strong className="brand">Terra Demo Store</strong>
      <div className="header-right">
        {isConnected && chain ? <span className="muted">{chain.name}</span> : null}
        <ConnectButton size="sm" />
      </div>
    </header>
  );
}
