# @terrawallet/pay-js

Open Terra Pay hosted checkout (`https://pay.terrawallet.us`) from any page.

```ts
import { TerraPay } from "@terrawallet/pay-js";

// paymentIntentId / checkoutUrl come from YOUR server (it creates the payment intent with the secret key).
TerraPay.open({
  checkoutUrl,                       // or paymentIntentId: "pi_...", or planId: "plan_..."
  publishableKey: "tw_test_pk_...",
  onSuccess: (r) => showThankYou(r), // UI only: fulfil from the webhook
  onCancel: () => {},
  onExpire: () => {},
});

TerraPay.mountSubscribeButton(document.querySelector("#subscribe")!, { planId: "plan_...", publishableKey: "tw_test_pk_..." });
```

Script tag: `dist/cdn/terra-pay.iife.js` (SRI hash in `dist/cdn/manifest.json`) exposes `window.TerraPay`.

## Modes

- `auto` (default): a popup on every device (a new tab on phones). Browser wallet extensions (Terra Wallet
  included) do not inject into iframes, and the hosted checkout does not allow framing yet (it sends
  `frame-ancestors 'none'` until per-merchant framing ships). A blocked popup falls back to the modal.
- `modal`: `<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-forms">` inside a closed shadow root
  and a native `<dialog>`, with a fixed "Secure checkout, pay.terrawallet.us" header. It loads only once the
  checkout allows framing for your origin.
- `popup`: a centred window, with an overlay on your page to bring it back or cancel.

If the checkout does not report `ready` within `readyTimeoutMs` (default 20 s), `onError` receives a
`CHECKOUT_ERROR` that says why: the frame was refused, your page is not https, or your origin is not on the
publishable key's allowed origins (dashboard, project settings). Messages go only to https pages.

Your own page must not send `Cross-Origin-Opener-Policy: same-origin` (use `same-origin-allow-popups`), otherwise
the browser cuts the link to the popup and the SDK sees an immediate cancel.

## Security

- Publishable keys only (`tw_test_pk_` / `tw_live_pk_` plus base64url). Anything containing `_sk_` (or starting
  with `sk_`) or `whsec_`, in any case, throws `SECRET_KEY_REFUSED` before anything is shown.
- `checkoutUrl` must be exactly on `https://pay.terrawallet.us` with a known path (`/c/pi_`, `/l/plink_`,
  `/i/inv_`, `/s/plan_`).
- A message is accepted only when `event.origin === "https://pay.terrawallet.us"`, `event.source` is the window or
  iframe this call opened, and `data.sid` is this call's random 128-bit session id. Fields are type-checked and
  copied; anything else is dropped. Once the checkout closes, the listener is gone.
- The iframe sandbox is the smallest set the checkout needs (scripts, its own origin for its API and Turnstile,
  popups for wallet and explorer links, forms for its transaction-hash form). It never gets
  `allow-top-navigation*`, `allow-popups-to-escape-sandbox` or `allow-modals`.
- The popup keeps `window.opener` (the checkout posts there, to your exact origin only). Its window name is random
  and unrelated to the session id.

## Checkout page contract (what pay.terrawallet.us implements)

The checkout page receives `?embed=modal|popup&pk=<publishable key>&sid=<session id>&origin=<merchant origin>`
(`theme=light|dark` optional). It must check `origin` against the project's allowed origins (and use
`frame-ancestors` for the modal) before posting, then post to `window.parent` (modal) or `window.opener` (popup)
with `targetOrigin` set to that origin:

```js
{ terraPay: 1, sid, type: "ready" }
{ terraPay: 1, sid, type: "resize", height: 640 }
{ terraPay: 1, sid, type: "success", status: "succeeded" | "processing", paymentIntentId, txHash, chain }
{ terraPay: 1, sid, type: "expire", paymentIntentId }
{ terraPay: 1, sid, type: "error", errorCode: "QUOTE_FAILED", errorMessage: "..." }
{ terraPay: 1, sid, type: "cancel" }   // the shopper cancelled
{ terraPay: 1, sid, type: "close" }    // the shopper pressed Done
```

The popup must not send `Cross-Origin-Opener-Policy: same-origin` (use `same-origin-allow-popups` or none),
otherwise the merchant page loses the window reference and sees an immediate cancel.
