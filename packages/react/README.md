# @terrawallet/react

Terra Wallet for React 18 and 19: a provider, a connect button, a modal, hooks, and a wagmi connector.

```tsx
"use client";
import { TerraProvider, ConnectButton, useAccount, useSendTransaction } from "@terrawallet/react";

export function App() {
  return (
    <TerraProvider appName="My dApp" chains={[8453, 1]} walletConnectProjectId="<reown project id>"
                   theme={{ mode: "auto", accent: "#0A5BFF", radius: 14 }}>
      <ConnectButton />
      <Pay />
    </TerraProvider>
  );
}

function Pay() {
  const { address, chain, isConnected } = useAccount();
  const { sendTransaction, data: hash, isPending, error } = useSendTransaction();
  if (!isConnected) return null;
  return <button disabled={isPending} onClick={() => sendTransaction({ to: "0x...", value: 10n ** 15n })}>Send on {chain?.name}</button>;
}
```

- `<ConnectButton/>` and `<WalletModal open onOpenChange/>` render Terra's Web Components (closed Shadow DOM), so
  app CSS cannot break or restyle them. Theme with props (`theme`, `accent`, `radius`, `size`, `block`) or the
  provider's `theme`.
- Hooks: `useAccount`, `useChainId`, `useConnect` (opens the modal by default; `{ modal: false }` for headless),
  `useDisconnect`, `useSwitchChain`, `useSignMessage`, `useSignTypedData`, `useSendTransaction`, `useTerraModal`,
  `useTerraClient`, `useTerraState`. Action hooks return `x()` (errors kept in state) and `xAsync()` (rejects).
- Server rendering is safe (Next.js App Router: the entry is marked `"use client"`).
- A secret key passed as `publishableKey` throws.

## wagmi

```ts
import { createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";
import { terraWallet } from "@terrawallet/react/wagmi";

export const config = createConfig({
  chains: [base, mainnet],
  connectors: [terraWallet({ walletConnectProjectId: "<reown project id>" })],
  transports: { [base.id]: http(), [mainnet.id]: http() },
});
```

Tested against `@wagmi/core` 3.6.9 and viem 2.57 (connect, sign, switch chain, disconnect, reconnect, 4001 on
rejection). `terraWallet({ modal: false })` connects without the modal. No runtime dependency on wagmi.
