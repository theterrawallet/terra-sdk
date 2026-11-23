# Changelog

All five packages share one version. Format: [Keep a Changelog](https://keepachangelog.com), versions follow
[Semantic Versioning](https://semver.org) (before 1.0, a minor version may change APIs).

## 0.1.0

First public release, early access. The Terra API is in test mode.

### Added

- `@terrawallet/connect`: finds Terra Wallet through EIP-6963 (rdns `com.terrawallet.app`) and the Solana Wallet
  Standard, with a lazily loaded WalletConnect v2 fallback (QR code on desktop, `terrawallet://` app link on phones,
  an Android intent link that falls back to Google Play). Account and network state, `request`, `switchChain`,
  `signMessage`, `signTypedData`, `sendTransaction`, Solana signing, a stable EIP-1193 provider and typed errors.
  8.3 KB gzipped core, no runtime dependencies in the core.
- `@terrawallet/react`: `<TerraProvider>`, `<ConnectButton/>`, `<WalletModal/>`, hooks (`useAccount`, `useConnect`,
  `useSendTransaction` and more) and a wagmi connector (`@terrawallet/react/wagmi`, wagmi 2.17+ and 3.x).
- `@terrawallet/elements`: `<terra-connect-button>` and `<terra-pay-button>` in closed Shadow DOM, light, dark or
  auto themes with validated accent, radius and font, an accessible wallet modal, and CDN builds (IIFE and ESM) with
  an SRI manifest and a separately pinned WalletConnect add-on.
- `@terrawallet/pay-js`: `TerraPay.open()` for the hosted checkout on `https://pay.terrawallet.us` (a popup by
  default, or a sandboxed modal), `subscribe`, `mountButton` and `mountSubscribeButton`, with messages accepted only
  from the checkout origin, the opened window and the call's session id.
- `@terrawallet/server`: a typed client for payment intents, payment links, invoices, plans, subscriptions and
  webhook endpoints, with idempotency keys reused across retries, retries with backoff and jitter, timeouts and typed
  errors; `verifyWebhook` and `safeVerifyWebhook` (constant time, replay window, secret rotation).
- Examples: a Next.js store, a plain HTML page under a strict CSP with Trusted Types, and a Node.js webhook receiver.

### Security

- Browser packages refuse secret keys (`_sk_` or `whsec_` anywhere) and accept publishable keys in the format the API
  mints (base64url).
- The server client sends the key only over https (plain http only to localhost), confines request paths to the
  base URL, redacts keys from every error and never logs.
- Releases are published only by `release.yml` through npm trusted publishing with provenance, after approval.
