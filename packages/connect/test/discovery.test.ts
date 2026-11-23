import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TERRA_RDNS, discoverEip6963, discoverSolanaWallet, findLegacyInjected, watchEip6963 } from "../src/discovery.js";

/** A fake wallet that answers eip6963:requestProvider like the Terra Wallet extension does. */
function fakeWallet(target: EventTarget, rdns: string, opts: { announceOnLoad?: boolean } = {}) {
  const provider = { request: async () => null, isTerraWallet: rdns === TERRA_RDNS };
  const info = { uuid: crypto.randomUUID(), name: rdns === TERRA_RDNS ? "Terra Wallet" : "Other", icon: "data:image/png;base64,AA==", rdns };
  const announce = () => target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  target.addEventListener("eip6963:requestProvider", announce);
  if (opts.announceOnLoad) announce();
  return { provider, announce };
}

describe("EIP-6963 discovery", () => {
  it("finds Terra Wallet by rdns and ignores other wallets", async () => {
    const target = new EventTarget();
    fakeWallet(target, "io.metamask");
    const terra = fakeWallet(target, TERRA_RDNS);
    fakeWallet(target, "com.coinbase.wallet");
    const found = await discoverEip6963({ target, timeoutMs: 50 });
    assert.ok(found);
    assert.equal(found.info.rdns, "com.terrawallet.app");
    assert.equal(found.provider, terra.provider);
  });

  it("resolves null after the timeout when Terra Wallet is not installed", async () => {
    const target = new EventTarget();
    fakeWallet(target, "io.metamask");
    const t0 = Date.now();
    assert.equal(await discoverEip6963({ target, timeoutMs: 40 }), null);
    assert.ok(Date.now() - t0 >= 35);
  });

  it("picks up a wallet that announces late (after the request)", async () => {
    const target = new EventTarget();
    const p = discoverEip6963({ target, timeoutMs: 500 });
    const late = { request: async () => 1 };
    setTimeout(() => {
      target.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "u", name: "Terra Wallet", icon: "", rdns: TERRA_RDNS }, provider: late } }),
      );
    }, 10);
    assert.equal((await p)?.provider, late);
  });

  it("rejects malformed announcements (no request function, wrong rdns type, null detail)", async () => {
    const target = new EventTarget();
    target.addEventListener("eip6963:requestProvider", () => {
      target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: null }));
      target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { rdns: TERRA_RDNS }, provider: {} } }));
      target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { rdns: [TERRA_RDNS] }, provider: { request() {} } } }));
    });
    assert.equal(await discoverEip6963({ target, timeoutMs: 30 }), null);
  });

  it("watchEip6963 deduplicates repeated announcements of the same provider", async () => {
    const target = new EventTarget();
    const wallet = fakeWallet(target, TERRA_RDNS);
    let calls = 0;
    const stop = watchEip6963(() => calls++, { target });
    wallet.announce();
    wallet.announce();
    stop();
    wallet.announce();
    assert.equal(calls, 1);
  });

  it("falls back to a legacy window.ethereum that says it is Terra Wallet", () => {
    const terra = { isTerraWallet: true, request: async () => null };
    assert.equal(findLegacyInjected({ ethereum: terra }), terra);
    assert.equal(findLegacyInjected({ ethereum: { providers: [{ isMetaMask: true, request() {} }, terra] } }), terra);
    assert.equal(findLegacyInjected({ ethereum: { isMetaMask: true, request() {} } }), null);
    assert.equal(findLegacyInjected({}), null);
  });
});

describe("Solana Wallet Standard discovery", () => {
  const terraSolana = () => ({
    version: "1.0.0",
    name: "Terra Wallet",
    icon: "data:image/png;base64,AA==",
    chains: ["solana:mainnet"],
    accounts: [],
    features: { "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [] }) } },
  });

  it("finds a wallet that registers when the app announces it is ready", async () => {
    const target = new EventTarget();
    const wallet = terraSolana();
    target.addEventListener("wallet-standard:app-ready", (e) => (e as CustomEvent).detail.register(wallet));
    assert.equal(await discoverSolanaWallet({ target, timeoutMs: 50 }), wallet);
  });

  it("finds a wallet that registers later through register-wallet", async () => {
    const target = new EventTarget();
    const wallet = terraSolana();
    const p = discoverSolanaWallet({ target, timeoutMs: 200 });
    target.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: ({ register }: { register: (w: unknown) => void }) => register(wallet) }));
    assert.equal(await p, wallet);
  });

  it("ignores other Solana wallets and Terra lookalikes without the connect feature", async () => {
    const target = new EventTarget();
    target.addEventListener("wallet-standard:app-ready", (e) => {
      const { register } = (e as CustomEvent).detail;
      register({ ...terraSolana(), name: "Phantom" });
      register({ ...terraSolana(), features: {} });
      register({ ...terraSolana(), chains: ["sui:mainnet"] });
    });
    assert.equal(await discoverSolanaWallet({ target, timeoutMs: 30 }), null);
  });
});
