/**
 * Security headers for the store. Terra Pay checkout runs on https://pay.terrawallet.us (framed in a modal on
 * phones), WalletConnect talks to its relay, and the widgets draw official chain logos as data: images.
 * @type {import("next").NextConfig}
 */
const csp = [
  "frame-src https://pay.terrawallet.us https://verify.walletconnect.org https://verify.walletconnect.com",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "connect-src 'self' https://*.walletconnect.org wss://*.walletconnect.org https://*.walletconnect.com wss://*.walletconnect.com https://ethereum-rpc.publicnode.com https://mainnet.base.org https://polygon-bor-rpc.publicnode.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};
