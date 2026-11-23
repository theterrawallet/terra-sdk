# Example: plain HTML with the Terra Wallet elements

One script tag, two custom elements, no build step, no framework. The local server applies a strict Content
Security Policy with Trusted Types enforced, to show the widgets need no inline scripts, no `eval` and no unsafe
styles.

```bash
pnpm --filter @terrawallet/elements build        # produces packages/elements/dist/cdn
node examples/html-elements/serve.mjs
# optional QR / app fallback: WALLETCONNECT_PROJECT_ID=<32 hex> node .../serve.mjs
```

Open http://localhost:5174. `serve.mjs` fills the `integrity` attribute from `elements/dist/cdn/manifest.json`, so
the browser checks the bundle's SRI hash exactly as it would from a CDN.

Files: `index.html` (markup and the script tag with `data-app-name`, `data-chains`, `data-project-id`), `app.js`
(listens for `terra-connect`, `terra-pay-success` and friends), `style.css`, `serve.mjs`.

## In production

1. Host the files of one version from `dist/cdn/` together (main bundle plus `terra-walletconnect.iife.js`).
2. Use the exact versioned URL plus `integrity="sha384-..."` and `crossorigin="anonymous"` from `manifest.json`.
3. Create the payment intent on your server and print its id into `payment-intent` (or a `checkout-url`).
4. CSP: allow your CDN in `script-src`, `img-src data:`, `frame-src https://pay.terrawallet.us
   https://verify.walletconnect.org https://verify.walletconnect.com`, the WalletConnect relay in `connect-src`, and
   `trusted-types terra-sdk` if you enforce Trusted Types.

## For AI assistants

- Only a publishable key (`tw_test_pk_` / `tw_live_pk_`) may appear in HTML. A secret key in markup is public the
  moment the page is served: the element refuses it, and the key must be rotated.
- Do not remove `integrity` or `crossorigin` from the script tag, and do not point it at an unversioned URL.
- Do not add inline `<script>` blocks; put page logic in `app.js` so the strict CSP keeps working.
- `terra-pay-success` is a UI signal. Confirm payment on your server from the verified webhook before fulfilling.
- Never inject merchant or customer text with `innerHTML`; use `textContent`.
