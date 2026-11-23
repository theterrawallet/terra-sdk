# @terrawallet/connect

Connect any web app to Terra Wallet. Framework-free, zero runtime dependencies in the core (8.3 KB gzipped).
WalletConnect is loaded lazily, only when Terra Wallet is not in the page.

```ts
import { createTerraConnect } from "@terrawallet/connect";

const terra = createTerraConnect({
  appName: "My dApp",
  chains: [8453, 1],                          // Base first (the default network), then Ethereum
  walletConnectProjectId: "<reown project id>", // optional: QR code / app deep-link fallback
});

const { address, chainId } = await terra.connect();   // from a click
await terra.switchChain(8453);
const signature = await terra.signMessage("Sign in to My dApp");
const hash = await terra.sendTransaction({ to: "0x...", value: 10n ** 15n });
terra.subscribe((state) => console.log(state.status, state.address, state.chainId));
```

## Connection order

1. **Injected Terra Wallet** (browser extension, or the Terra Wallet app's in-app browser): EIP-6963 with rdns
   `com.terrawallet.app`, then a legacy `window.ethereum.isTerraWallet` fallback.
2. **Phones:** WalletConnect pairing opened in the app through `terrawallet://wc?uri=...` (Android uses an `intent:`
   URL that falls back to Google Play). `deepLink: "manual"` leaves the tap to your UI: listen for `display_uri`
   and call `openAppLink(buildPairingDeepLink(uri))` from a click.
3. **Desktop:** WalletConnect QR code (render `state.pairingUri`, or use the elements / React modal).

`connect({ method: "injected" | "walletconnect" })` forces one path.

## API

| Member | Notes |
|---|---|
| `connect(opts?)` | Resolves `{ address, chainId, connector }`. Concurrent calls share one request. |
| `cancel()` | Abandons a pending connection (rejects with `USER_REJECTED`; a late WalletConnect approval is closed). |
| `disconnect()` | Revokes the site's permission (`wallet_revokePermissions`) or deletes the WalletConnect session. |
| `reconnect()` | Silent restore (`eth_accounts` only, never a prompt). Runs automatically on load unless `autoReconnect: false`. |
| `request({ method, params })` | Any EIP-1193 call. Over WalletConnect, reads go to the network's public RPC. |
| `switchChain(id)` | `wallet_switchEthereumChain`, adding the network when the wallet answers 4902. |
| `signMessage(text \| bytes \| { raw })`, `signTypedData(data)`, `sendTransaction(tx)` | Bigints and numbers become hex quantities. |
| `getProvider()` | Stable EIP-1193 provider for viem, ethers or wagmi. Throws EIP-1193 errors with numeric `code`. |
| `solana.connect()`, `solana.signMessage()`, `solana.signTransaction()`, `solana.signAndSendTransaction()` | Wallet Standard when injected, WalletConnect otherwise. |
| `getState()`, `subscribe(fn)`, `on(event, fn)` | Events: `connect`, `disconnect`, `accountsChanged`, `chainChanged`, `display_uri`, `error`. |
| `detect()` | `{ injected, solana, platform, walletConnect }`. |

Also exported: `discoverEip6963`, `watchEip6963`, `discoverSolanaWallet`, `buildPairingDeepLink`,
`buildWakeDeepLink`, `openAppLink`, `isSafeAppLink`, `detectPlatform`, `assertPublishableKey`, `looksLikeSecretKey`,
`TERRA_CHAINS`, `TERRA_TESTNETS`.

## Errors

Everything rejects with `TerraError`: `code` (stable string such as `USER_REJECTED`, `UNRECOGNIZED_CHAIN`,
`NOT_INSTALLED`, `WALLETCONNECT_UNAVAILABLE`, `SECRET_KEY_REFUSED`), `rpcCode` (the EIP-1193 number) and `docUrl`.

## Security

- `publishableKey` accepts `tw_test_pk_` / `tw_live_pk_` only. Anything containing `_sk_` (or starting with `sk_`) or
  `whsec_`, in any case, throws `SECRET_KEY_REFUSED` and is never echoed: rotate it, it is already public.
- Deep links are built only from a validated WalletConnect v2 pairing URI. `openAppLink` navigates only to
  `terrawallet://` links, their Android `intent://` form (our scheme and package, one fragment) and `https://` pages;
  `javascript:`, `data:`, other schemes and anything with whitespace or control characters throw `INVALID_PARAMS`.
- WalletConnect metadata: `appUrl` must be an http(s) URL and `appIcon` an https URL; control and bidi-override
  characters are stripped from `appName` and `appDescription`, so the approval screen in Terra Wallet shows what
  you meant. WalletConnect's own usage telemetry is off unless you pass `walletConnect: { telemetry: true }`.
- Safe to create during server rendering; nothing touches `window` until a browser method runs.
