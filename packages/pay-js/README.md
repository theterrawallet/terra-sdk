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

- `auto` (default): the modal on phones, a popup on desktops (browser wallet extensions, Terra Wallet included, do
  not inject into iframes, so a desktop checkout needs its own window). A blocked popup falls back to the modal.
- `modal`: `<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-forms">` inside a closed shadow root
  and a native `<dialog>`, with a fixed "Secure checkout, pay.terrawallet.us" header. The checkout lets a page frame
  it only after a server-side check: the publishable key must belong to the checkout's organization and your exact
  https origin must be on its project's allowed origins (dashboard, project settings). Then it sends
  `frame-ancestors <your origin>`; for anyone else it stays `frame-ancestors 'none'`. Inside the frame the checkout
  shows "Paying on <your site>" and accepts pay actions only from real taps or clicks.
- `popup`: a centred window (a new tab on phones), with an overlay on your page to bring it back or cancel.

If the checkout does not report `ready` within `readyTimeoutMs` (default 20 s), `onError` receives a
`CHECKOUT_ERROR` that says why: the frame was refused (your origin is not an allowed origin of the publishable key)
or your page is not https. A modal then offers the shopper "Continue in a new window", which opens the same session
in a popup (from the shopper's tap, because browsers block popups opened from a timer); `handle.mode` reports
`popup` from then on. Messages go only to https pages, and localhost origins work only with test-mode keys.

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
(`theme=light|dark` optional), each parameter exactly once. For `embed=modal` the checkout's Worker asks the API
(`GET /api/v1/checkout/:id/embed?origin=...`, the key in the Authorization header) and sends
`frame-ancestors <origin>` only when it says yes (`frame-ancestors 'none'` and `X-Frame-Options: DENY` otherwise).
The page checks `origin` the same way before posting, then posts to `window.parent` (modal) or `window.opener`
(popup) with `targetOrigin` set to that origin:

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
