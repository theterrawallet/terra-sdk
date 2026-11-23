import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Window } from "happy-dom";
import { installDom, type InstalledDom } from "../../../scripts/test-dom.js";
import { createTerraConnect } from "../src/client.js";
import { TerraError } from "../src/errors.js";
import type { TerraState } from "../src/types.js";
import { ADDRESS, fakeInjectedWallet, tick } from "./fakes.js";

let dom: InstalledDom<Window>;
beforeEach(() => {
  dom = installDom(Window);
});
afterEach(async () => {
  await dom.restore();
});

const opts = { discoveryTimeoutMs: 30, autoReconnect: false } as const;

describe("connect through the injected wallet (EIP-6963)", () => {
  it("connects, tracks state, emits events and remembers the connection", async () => {
    const wallet = fakeInjectedWallet(window);
    const terra = createTerraConnect(opts);
    const statuses: string[] = [];
    terra.subscribe((s: TerraState) => statuses.push(s.status));
    let connectEvent: unknown;
    terra.on("connect", (r) => (connectEvent = r));

    const res = await terra.connect();
    assert.deepEqual(res, { address: ADDRESS, chainId: 1, connector: "injected" });
    assert.deepEqual(statuses, ["connecting", "connected"]);
    assert.deepEqual(connectEvent, res);
    assert.equal(terra.getState().address, ADDRESS);
    assert.deepEqual(JSON.parse(localStorage.getItem("terra-connect")!), { c: "injected" });
    assert.deepEqual(wallet.calls.map((c) => c.method), ["eth_requestAccounts", "eth_chainId"]);
  });

  it("shares one in-flight connection between concurrent calls", async () => {
    const wallet = fakeInjectedWallet(window);
    const terra = createTerraConnect(opts);
    const [a, b] = await Promise.all([terra.connect(), terra.connect()]);
    assert.deepEqual(a, b);
    assert.equal(wallet.calls.filter((c) => c.method === "eth_requestAccounts").length, 1);
  });

  it("maps a user rejection to a typed USER_REJECTED error", async () => {
    fakeInjectedWallet(window, { reject: true });
    const terra = createTerraConnect(opts);
    await assert.rejects(terra.connect(), (e: unknown) => e instanceof TerraError && e.code === "USER_REJECTED" && e.rpcCode === 4001);
    assert.equal(terra.getState().status, "disconnected");
    assert.equal(terra.getState().error?.code, "USER_REJECTED");
  });

  it("signMessage sends UTF-8 hex with the account; signTypedData and sendTransaction normalise values", async () => {
    const wallet = fakeInjectedWallet(window);
    const terra = createTerraConnect(opts);
    await terra.connect();
    await terra.signMessage("hello");
    assert.deepEqual(wallet.calls.at(-1), { method: "personal_sign", params: ["0x68656c6c6f", ADDRESS] });
    await terra.signMessage({ raw: "0xdeadbeef" });
    assert.deepEqual(wallet.calls.at(-1)?.params, ["0xdeadbeef", ADDRESS]);
    await terra.signTypedData({ domain: { chainId: 1 }, message: { amount: 10n ** 20n } });
    assert.deepEqual(wallet.calls.at(-1)?.params, [ADDRESS, '{"domain":{"chainId":1},"message":{"amount":"100000000000000000000"}}']);
    const hash = await terra.sendTransaction({ to: ADDRESS, value: 10n ** 18n, gas: 21000 });
    assert.equal(hash, `0x${"22".repeat(32)}`);
    assert.deepEqual(wallet.calls.at(-1)?.params, [{ from: ADDRESS, to: ADDRESS, value: "0xde0b6b3a7640000", gas: "0x5208" }]);
  });

  it("switchChain uses wallet_switchEthereumChain and adds the network when the wallet does not know it", async () => {
    const wallet = fakeInjectedWallet(window);
    const custom = { id: 4002, name: "Fantom Testnet", symbol: "FTM", decimals: 18, rpcUrls: ["https://rpc.testnet.fantom.network"], logo: "fantom" };
    const terra = createTerraConnect({ ...opts, chains: [1, 8453, custom] });
    await terra.connect();
    const changes: number[] = [];
    terra.on("chainChanged", (id) => changes.push(id));
    assert.equal(await terra.switchChain(8453), 8453);
    assert.equal(terra.getState().chainId, 8453);
    assert.equal(await terra.switchChain(4002), 4002);
    const methods = wallet.calls.map((c) => c.method);
    assert.ok(methods.includes("wallet_addEthereumChain"));
    assert.deepEqual(changes, [8453, 4002]);
  });

  it("drops the connection when the wallet removes every account", async () => {
    const wallet = fakeInjectedWallet(window);
    const terra = createTerraConnect(opts);
    await terra.connect();
    let disconnected = false;
    terra.on("disconnect", () => (disconnected = true));
    wallet.emit("accountsChanged", []);
    assert.equal(terra.getState().status, "disconnected");
    assert.ok(disconnected);
    assert.equal(localStorage.getItem("terra-connect"), null);
  });

  it("disconnect revokes the site's permission and detaches listeners", async () => {
    const wallet = fakeInjectedWallet(window);
    const terra = createTerraConnect(opts);
    await terra.connect();
    assert.equal(wallet.listenerCount("accountsChanged"), 1);
    await terra.disconnect();
    assert.equal(wallet.calls.at(-1)?.method, "wallet_revokePermissions");
    assert.equal(wallet.listenerCount("accountsChanged"), 0);
    assert.equal(terra.getState().status, "disconnected");
  });

  it("reconnects silently on the next page load (eth_accounts only, never a prompt)", async () => {
    const wallet = fakeInjectedWallet(window);
    wallet.authorize();
    localStorage.setItem("terra-connect", JSON.stringify({ c: "injected" }));
    const terra = createTerraConnect({ discoveryTimeoutMs: 30 });
    await tick(60);
    assert.equal(terra.getState().status, "connected");
    assert.ok(!wallet.calls.some((c) => c.method === "eth_requestAccounts"));
  });

  it("the EIP-1193 provider follows the connection", async () => {
    fakeInjectedWallet(window);
    const terra = createTerraConnect({ ...opts, chains: [8453] });
    const provider = terra.getProvider();
    assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
    assert.equal(await provider.request({ method: "eth_chainId" }), "0x2105");
    const seen: unknown[] = [];
    provider.on("accountsChanged", (a: unknown) => seen.push(a));
    assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [ADDRESS]);
    assert.equal(await provider.request({ method: "eth_chainId" }), "0x1");
  });

  it("the provider throws EIP-1193 errors with numeric codes (viem and wagmi map 4001 to a user rejection)", async () => {
    const wallet = fakeInjectedWallet(window);
    const terra = createTerraConnect(opts);
    await terra.connect();
    wallet.provider.rejectNext = true;
    await assert.rejects(terra.getProvider().request({ method: "eth_foo" }), (e: any) => e.code === 4200 && e.terraCode === "UNSUPPORTED_METHOD");
    await terra.disconnect();
    await assert.rejects(terra.getProvider().request({ method: "personal_sign", params: [] }), (e: any) => e.code === 4900);
  });
});

describe("when Terra Wallet is not in the page", () => {
  it("method injected fails with NOT_INSTALLED", async () => {
    const terra = createTerraConnect(opts);
    await assert.rejects(terra.connect({ method: "injected" }), (e: unknown) => (e as TerraError).code === "NOT_INSTALLED");
  });

  it("auto without a WalletConnect project id fails with WALLETCONNECT_UNAVAILABLE", async () => {
    const terra = createTerraConnect(opts);
    await assert.rejects(terra.connect(), (e: unknown) => (e as TerraError).code === "WALLETCONNECT_UNAVAILABLE");
    const d = await terra.detect();
    assert.deepEqual(d, { injected: false, solana: false, platform: "desktop", walletConnect: false });
  });

  it("calls that need a connection fail with NOT_CONNECTED", async () => {
    const terra = createTerraConnect(opts);
    await assert.rejects(terra.signMessage("x"), (e: unknown) => (e as TerraError).code === "NOT_CONNECTED");
    await assert.rejects(terra.switchChain(1), (e: unknown) => (e as TerraError).code === "NOT_CONNECTED");
  });
});
