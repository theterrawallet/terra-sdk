# @terrawallet/elements

`<terra-connect-button>` and `<terra-pay-button>`: Web Components for any site (plain HTML, WordPress, Webflow,
any framework). Closed Shadow DOM, the Terra Wallet extension's look, light, dark or auto.

## Script tag

```html
<script src="https://<cdn>/<version>/terra-elements.iife.js"
        integrity="sha384-<terra-elements.iife.js in manifest.json>" crossorigin="anonymous"
        data-app-name="My shop" data-chains="8453,1" data-project-id="<reown project id>" defer></script>

<terra-connect-button theme="auto"></terra-connect-button>
<terra-pay-button payment-intent="pi_..." publishable-key="tw_test_pk_..."></terra-pay-button>
<terra-pay-button plan="plan_..." publishable-key="tw_test_pk_..." label="Subscribe"></terra-pay-button>
```

`window.TerraElements` exposes `configure()`, `getDefaultClient()`, `openWalletModal()`, `TerraPay` and more.

## npm

```ts
import { configure, defineTerraElements } from "@terrawallet/elements";
configure({ appName: "My shop", walletConnectProjectId: "<reown project id>", chains: [8453, 1] });
defineTerraElements();
// or: import "@terrawallet/elements/auto";
```

## Attributes

| Element | Attributes |
|---|---|
| both | `theme` (`light`, `dark`, `auto`), `accent` (`#rgb`, `#rrggbb`, `rgb()`), `radius` (0 to 24 or `none`, `sm`, `md`, `lg`), `font`, `size` (`sm`, `md`, `lg`), `block`, `label` |
| `terra-connect-button` | `project-id`, `app-name`, `chains`, `publishable-key` (read when the first element creates the page client); property `client` to pass your own `TerraConnect` |
| `terra-pay-button` | `payment-intent` or `checkout-url` or `plan`, `publishable-key`, `mode` (`auto`, `popup`, `modal`) |

CSS custom properties work too: `terra-connect-button { --terra-accent: #FF0066; --terra-radius: 20px; }`.
Every value is validated; the text colour on the accent is chosen for WCAG AA contrast (or the accent is darkened).

Events (bubbling, composed): `terra-connect`, `terra-disconnect`, `terra-chain-changed`, `terra-account-changed`,
`terra-error`, `terra-pay-ready`, `terra-pay-success`, `terra-pay-cancel`, `terra-pay-expire`, `terra-pay-error`,
`terra-pay-close`.

## What partners cannot change

The requesting origin (with an http warning), the recovery-phrase warning and the "Secure checkout on
pay.terrawallet.us" line are fixed. The shadow roots are closed, no `::part` is exposed, and the modal is a native
`<dialog>` in the top layer.

## Accessibility

Modal: `role=dialog` with label and description, focus moved in and trapped, Escape closes, focus returns to the
trigger, `aria-live` announcements, visible focus rings checked for 3:1 contrast, reduced motion respected.
Mobile-first: a bottom sheet on phones, a centred card from 641 px.

## CSP

Works under `script-src 'self'` plus `require-trusted-types-for 'script'; trusted-types terra-sdk`. Allow
`img-src data:`, `frame-src https://pay.terrawallet.us https://verify.walletconnect.org https://verify.walletconnect.com`,
and the WalletConnect relay in `connect-src` (`https://*.walletconnect.org wss://*.walletconnect.org`, same for
`.com`) if you use the QR fallback.

## CDN files

`dist/cdn/terra-elements.iife.js`, `terra-elements.esm.js`, the lazy `terra-walletconnect.iife.js` add-on (loaded
only for the QR / deep-link fallback, with its SRI hash baked into the main files), `manifest.json` (SRI hashes) and
`sbom.cdx.json`. No source maps.

