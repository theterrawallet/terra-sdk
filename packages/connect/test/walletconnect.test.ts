import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Window } from "happy-dom";
import { installDom, type InstalledDom } from "../../../scripts/test-dom.js";
import { createTerraConnect } from "../src/client.js";
import { base58Encode } from "../src/encoding.js";
import { TerraError } from "../src/errors.js";
import { ADDRESS, PAIRING_URI, TOPIC, fakeSignClient, randomProjectId, tick } from "./fakes.js";

let dom: InstalledDom<Window> | undefined;
afterEach(async () => {
  await dom?.restore();
  dom = undefined;
});

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

function setup(opts: { userAgent?: string; deepLink?: "auto" | "manual" } = {}) {
  dom = installDom(Window, { userAgent: opts.userAgent });
  const wc = fakeSignClient();
  const terra = createTerraConnect({
    appName: "Shop",
    discoveryTimeoutMs: 20,
    autoReconnect: false,
    walletConnectProjectId: randomProjectId(),
    walletConnect: { loader: wc.loader },
    chains: [1, 8453],
    deepLink: opts.deepLink,
  });
  return { terra, wc };
}

describe("WalletConnect fallback (lazy sign client)", () => {
  it("pairs with a QR URI, asks only for optional namespaces, and connects", async () => {
    const { terra, wc } = setup();
    const uris: string[] = [];
    terra.on("display_uri", (u) => uris.push(u));
    const pending = terra.connect();
    await tick(40);
    assert.deepEqual(uris, [PAIRING_URI]);
    assert.equal(terra.getState().pairingUri, PAIRING_URI);
    assert.equal(wc.state.initOpts.metadata.name, "Shop");
    assert.equal(wc.state.initOpts.metadata.url, "https://shop.example");
    assert.equal(wc.state.namespaces.requiredNamespaces, undefined);
    assert.deepEqual(wc.state.namespaces.optionalNamespaces.eip155.chains, ["eip155:1", "eip155:8453"]);
    assert.ok(!wc.state.namespaces.optionalNamespaces.eip155.methods.includes("eth_sign"));

    const sol = base58Encode(new Uint8Array(32).fill(7));
    wc.state.approve(wc.session({ solana: sol }));
    assert.deepEqual(await pending, { address: ADDRESS, chainId: 1, connector: "walletconnect" });
    assert.equal(terra.getState().pairingUri, null);
    assert.equal(terra.getState().solanaAddress, sol);
  });

  it("routes wallet methods through the session with the CAIP-2 chain, switching approved chains locally", async () => {
    const { terra, wc } = setup();
    const pending = terra.connect();
    await tick(40);
    wc.state.approve(wc.session());
    await pending;
    wc.state.respond = () => `0x${"11".repeat(65)}`;
    await terra.signMessage("hi");
    assert.equal(wc.state.requests[0].chainId, "eip155:1");
    assert.equal(wc.state.requests[0].topic, TOPIC);
    assert.deepEqual(wc.state.requests[0].request, { method: "personal_sign", params: ["0x6869", ADDRESS] });
    assert.equal(await terra.switchChain(8453), 8453);
    assert.equal(wc.state.requests.length, 1, "approved chain switches without a wallet prompt");
    await terra.sendTransaction({ to: ADDRESS, value: 1n });
    assert.equal(wc.state.requests[1].chainId, "eip155:8453");
  });

  it("answers read-only calls from the network's public RPC, not the wallet", async () => {
    const { terra, wc } = setup();
    const pending = terra.connect();
    await tick(40);
    wc.state.approve(wc.session());
    await pending;
    const realFetch = globalThis.fetch;
    let body: any;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      body = { url, ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 });
    }) as typeof fetch;
    try {
      assert.equal(await terra.request({ method: "eth_blockNumber" }), "0x10");
      assert.equal(body.url, "https://ethereum-rpc.publicnode.com");
      assert.equal(body.method, "eth_blockNumber");
      assert.equal(wc.state.requests.length, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("disconnects when Terra Wallet deletes the session", async () => {
    const { terra, wc } = setup();
    const pending = terra.connect();
    await tick(40);
    wc.state.approve(wc.session());
    await pending;
    wc.client.emit("session_delete", { topic: TOPIC });
    assert.equal(terra.getState().status, "disconnected");
  });

  it("cancel() rejects at once, and a late approval is closed instead of silently connecting", async () => {
    const { terra, wc } = setup();
    const pending = terra.connect();
    await tick(40);
    terra.cancel();
    await assert.rejects(pending, (e: unknown) => e instanceof TerraError && e.code === "USER_REJECTED");
    wc.state.approve(wc.session());
    await tick(10);
    assert.equal(terra.getState().status, "disconnected");
    assert.equal(wc.state.disconnects.length, 1);
  });

  it("on Android it opens the app through an intent link, and wakes it for each request", async () => {
    const { terra, wc } = setup({ userAgent: ANDROID });
    const pending = terra.connect();
    await tick(40);
    assert.ok(location.href.startsWith("intent://wc?uri="), location.href);
    wc.state.approve(wc.session());
    await pending;
    wc.state.respond = () => `0x${"11".repeat(65)}`;
    await terra.signMessage("hi");
    assert.equal(location.href, `terrawallet://wc?requestId=1763884800123&sessionTopic=${TOPIC}`);
  });

  it("deepLink manual leaves opening the app to the UI", async () => {
    const { terra } = setup({ userAgent: ANDROID, deepLink: "manual" });
    void terra.connect().catch(() => {});
    await tick(40);
    assert.equal(location.href, "https://shop.example/");
    assert.equal(terra.getState().pairingUri, PAIRING_URI);
    terra.cancel();
  });

  it("restores a saved WalletConnect session without prompting", async () => {
    dom = installDom(Window);
    const wc = fakeSignClient();
    wc.state.sessions.push(wc.session({ chains: [8453] }));
    localStorage.setItem("terra-connect", JSON.stringify({ c: "walletconnect" }));
    const terra = createTerraConnect({ discoveryTimeoutMs: 20, walletConnectProjectId: randomProjectId(), walletConnect: { loader: wc.loader } });
    assert.equal(await terra.reconnect(), true);
    assert.equal(terra.getState().connector, "walletconnect");
    assert.equal(terra.getState().chainId, 8453);
  });
});

describe("WalletConnect metadata and telemetry", () => {
  it("turns WalletConnect's third-party telemetry off unless the app opts in", async () => {
    const { terra, wc } = setup();
    void terra.connect().catch(() => {});
    await tick(40);
    assert.equal(wc.state.initOpts.telemetryEnabled, false);
    terra.cancel();

    await dom?.restore();
    dom = installDom(Window);
    const wc2 = fakeSignClient();
    const opted = createTerraConnect({ discoveryTimeoutMs: 20, autoReconnect: false, walletConnectProjectId: randomProjectId(), walletConnect: { loader: wc2.loader, telemetry: true } });
    void opted.connect().catch(() => {});
    await tick(40);
    assert.equal(wc2.state.initOpts.telemetryEnabled, true);
    opted.cancel();
  });

  it("strips control and bidi-override characters from the name and description the wallet shows", async () => {
    dom = installDom(Window);
    const wc = fakeSignClient();
    const terra = createTerraConnect({
      appName: "\u202eGood Shop\u0007\n",
      appDescription: "Pays\u2066 fast\u0000",
      discoveryTimeoutMs: 20,
      autoReconnect: false,
      walletConnectProjectId: randomProjectId(),
      walletConnect: { loader: wc.loader },
    });
    void terra.connect().catch(() => {});
    await tick(40);
    assert.equal(wc.state.initOpts.metadata.name, "Good Shop");
    assert.equal(wc.state.initOpts.metadata.description, "Pays fast");
    terra.cancel();
  });

  it("refuses non-http(s) app URLs and non-https icons before anything runs", () => {
    const bad: { appUrl?: string; appIcon?: string }[] = [
      { appUrl: "javascript:alert(1)" },
      { appUrl: "data:text/html,x" },
      { appUrl: "https://user:pw@shop.example" },
      { appUrl: "https://shop.example/\r\nx" },
      { appUrl: "/relative" },
      { appIcon: "http://shop.example/icon.png" },
      { appIcon: "javascript:alert(1)" },
      { appIcon: "data:image/svg+xml,<svg onload=alert(1)>" },
    ];
    for (const o of bad) assert.throws(() => createTerraConnect({ ...o, autoReconnect: false }), (e: unknown) => e instanceof TerraError && e.code === "INVALID_PARAMS", JSON.stringify(o));
    assert.doesNotThrow(() => createTerraConnect({ appUrl: "http://localhost:3000", appIcon: "https://shop.example/icon.png", autoReconnect: false }));
  });
});
