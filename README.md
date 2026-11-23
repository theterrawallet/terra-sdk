<p align="center">
  <a href="https://terrawallet.us">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/terra-wallet-logo-white.png">
      <img src=".github/assets/terra-wallet-logo.png" alt="Terra Wallet" width="360">
    </picture>
  </a>
</p>

<h1 align="center">Terra Wallet SDK</h1>

<p align="center">
  Connect Terra Wallet and accept crypto payments with Terra Pay, on any site or app.
</p>

<p align="center">
  <a href="https://terrawallet.us">Website</a> ·
  <a href="https://developers.terrawallet.us">Developers</a> ·
  <a href="https://developers.terrawallet.us/docs">Docs</a> ·
  <a href="https://x.com/terrawalletapp">X</a> ·
  <a href="https://t.me/terrawalletapp">Telegram</a> ·
  <a href="https://github.com/theterrawallet">GitHub</a>
</p>

> **Early access.** The Terra API is in test mode: use test keys (`tw_test_pk_...`, `tw_test_sk_...`) and testnets.
> Live mode opens later and will be announced on https://developers.terrawallet.us. APIs may still change before 1.0.

## What is in this repo

Five small packages that share one visual language (the Terra Wallet browser extension's) and use open standards
first. Install only what you need.

| Package | What it does |
|---|---|
| [`@terrawallet/connect`](./packages/connect) | Framework-free core. Finds Terra Wallet in the page (EIP-6963, Solana Wallet Standard), falls back to an app deep link on phones or a WalletConnect v2 QR code on desktop (loaded lazily), keeps account and network state, and signs and sends. Zero runtime dependencies in the core, 8.3 KB gzipped. |
| [`@terrawallet/react`](./packages/react) | `<TerraProvider>`, `<ConnectButton/>`, `<WalletModal/>`, hooks, and a wagmi connector at `@terrawallet/react/wagmi`. |
| [`@terrawallet/elements`](./packages/elements) | Web Components `<terra-connect-button>` and `<terra-pay-button>` in a closed Shadow DOM, for any site (plain HTML, WordPress, Webflow). One `<script>` tag with an SRI hash, or an ES module. |
| [`@terrawallet/pay-js`](./packages/pay-js) | `TerraPay.open()` for the hosted checkout on `https://pay.terrawallet.us`, with origin-checked callbacks, and a subscribe button. |
| [`@terrawallet/server`](./packages/server) | Typed Node.js client for the Terra Pay `/v1` API (idempotency, retries, timeouts, typed errors) and `verifyWebhook`. Zero dependencies. |

Examples live in [`examples/`](./examples): a Next.js store, a plain HTML page, and a Node.js webhook receiver.

## Quick start (5 minutes)

**1. Get test keys.** Create a project on https://dashboard.terrawallet.us, add your site's origin to its allowed
origins, and create a secret key (server only) and a publishable key (browser).

**2. Create a payment on your server** with the secret key.

```bash
npm install @terrawallet/server
```

```ts
import { Terra } from "@terrawallet/server";

const terra = new Terra(process.env.TERRA_SECRET_KEY); // tw_test_sk_...

const pi = await terra.paymentIntents.create(
  { amount: "25.00", currency: "USD", accepted_assets: [{ chain: "base", symbol: "USDC" }], metadata: { order_id: "1042" } },
  { idempotencyKey: "order-1042" }, // derive it from your order id: a retry can never create a second payment
);
// Send pi.id (or pi.checkout_url) to the browser.
```

**3. Open checkout in the browser** with the publishable key.

```bash
npm install @terrawallet/pay-js
```

```ts
import { TerraPay } from "@terrawallet/pay-js";

payButton.addEventListener("click", () => {
  TerraPay.open({
    paymentIntentId: pi.id,
    publishableKey: "tw_test_pk_...",
    onSuccess: () => showThankYou(), // UI only: fulfil from the webhook below
  });
});
```

Or with no build step at all:

```html
<script src="https://cdn.jsdelivr.net/npm/@terrawallet/elements@0.1.0/dist/cdn/terra-elements.iife.js"
        integrity="sha384-<from dist/cdn/manifest.json>" crossorigin="anonymous" defer></script>

<terra-pay-button payment-intent="pi_..." publishable-key="tw_test_pk_..."></terra-pay-button>
```

**4. Fulfil the order from the webhook**, verified over the raw body.

```ts
import { verifyWebhook } from "@terrawallet/server";

export async function POST(req: Request) {
  const event = verifyWebhook(await req.text(), req.headers.get("terra-signature"), process.env.TERRA_WEBHOOK_SECRET!);
  if (event.type === "payment_intent.succeeded") {
    // mark the order paid (once per event.id)
  }
  return Response.json({ received: true });
}
```

**5. Connect a wallet** (optional, for dApps).

```tsx
import { TerraProvider, ConnectButton } from "@terrawallet/react";

<TerraProvider appName="My dApp" chains={[8453, 1]} walletConnectProjectId="<reown project id>">
  <ConnectButton />
</TerraProvider>;
```

The WalletConnect project id (free at https://cloud.reown.com) is needed only for the QR code and phone fallback.
Each package README has the full API.

## Security model

- **Keys stay where they belong.** Browser packages accept publishable keys only and refuse anything containing
  `_sk_` or `whsec_` with `SECRET_KEY_REFUSED`, without echoing it (rotate such a key: it is already public). The
  server package refuses publishable keys, refuses to run in a browser, sends the key only over https, never logs,
  and redacts keys from every error.
- **No double charges.** Every create sends one `Idempotency-Key` and reuses it on every retry (timeouts, 5xx,
  `IDEMPOTENCY_IN_PROGRESS`); errors carry the key so your own retry can reuse it.
- **Checkout messages are trusted only from `https://pay.terrawallet.us`**, from the exact window or frame the SDK
  opened, carrying that call's random session id, with every field type-checked. The embedded checkout runs in a
  minimal sandbox that can never navigate your page.
- **No eval, no remote code, no HTML from data.** Every node is built with `createElement` and `textContent`. Widgets
  render in closed Shadow DOM; the modal is a native `<dialog>` in the top layer, so page CSS cannot cover or restyle
  the requesting-origin line or the recovery-phrase warning. Links go only to `terrawallet://` or https.
- **CSP and Trusted Types.** Works under `script-src 'self'` with `require-trusted-types-for 'script'` and
  `trusted-types terra-sdk`. The CDN bundle loads exactly one file (the WalletConnect add-on) through that policy,
  with an SRI hash baked in at build time.
- **Webhooks** are verified in constant time over the raw body, with a replay window and several signatures during a
  secret rotation; `safeVerifyWebhook` never throws for malformed input.
- **Supply chain.** Exact dependency versions and a lockfile; no dependency install scripts run (CI fails if one
  appears); the connect core has no runtime dependencies and loads `@walletconnect/sign-client` only when needed;
  no source maps; CycloneDX SBOMs in every package; secret scanning and audits in CI.
- **Releases** are published only by this repo's release workflow, after the owner's approval, through npm trusted
  publishing with provenance. No npm token exists. Verify with `npm audit signatures`. A Terra package published any
  other way is not ours.

Found a vulnerability? Please report it privately, see [SECURITY.md](./SECURITY.md).

## Develop

```bash
corepack enable            # pnpm 10.32.1, from package.json
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck && pnpm test
pnpm size                  # connect core budget: 15 KB gzipped
pnpm pack:check            # exactly what npm would receive
```

Node.js 22 or newer. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE), see [NOTICE](./NOTICE). "Terra Wallet", "Terra Pay" and the Terra Wallet logo are
trademarks of Terra Wallet; the license grants no right to use them. The optional WalletConnect add-on bundles
`@walletconnect/sign-client`, which keeps its own license.
