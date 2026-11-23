/** The terraWallet() connector against the real @wagmi/core 3 and viem. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { connect, createConfig, disconnect, getConnection, reconnect, signMessage, switchChain } from "@wagmi/core";
import { http } from "viem";
import { base, mainnet } from "viem/chains";
import { ADDRESS, fakeInjectedWallet } from "../../connect/test/fakes.js";
import { setupDom, type Env } from "../../elements/test/helpers.js";
import { terraWallet } from "../src/wagmi.js";

let env: Env;
beforeEach(() => {
  env = setupDom();
});
afterEach(async () => {
  await env.restore();
});

function makeConfig() {
  return createConfig({
    chains: [mainnet, base],
    connectors: [terraWallet({ modal: false, discoveryTimeoutMs: 10 })],
    transports: { [mainnet.id]: http(), [base.id]: http() },
    multiInjectedProviderDiscovery: false,
    storage: null,
  });
}

describe("wagmi connector", () => {
  it("connects, signs, switches chain and disconnects through wagmi actions", async () => {
    const wallet = fakeInjectedWallet(window);
    const config = makeConfig();
    const connector = config.connectors[0]!;
    assert.equal(connector.name, "Terra Wallet");
    assert.equal(connector.rdns, "com.terrawallet.app");

    const res = await connect(config, { connector });
    assert.deepEqual(res.accounts, [ADDRESS]);
    assert.equal(res.chainId, 1);
    assert.equal(getConnection(config).address, ADDRESS);
    assert.equal(getConnection(config).status, "connected");

    const sig = await signMessage(config, { message: "hello" });
    assert.equal(sig, `0x${"11".repeat(65)}`);
    const params = wallet.calls.find((c) => c.method === "personal_sign")?.params as string[];
    assert.equal(params[0], "0x68656c6c6f");
    assert.equal(params[1]!.toLowerCase(), ADDRESS); // viem passes the EIP-55 checksummed form

    const chain = await switchChain(config, { chainId: base.id });
    assert.equal(chain.id, base.id);
    assert.equal(getConnection(config).chainId, base.id);

    await disconnect(config);
    assert.equal(getConnection(config).status, "disconnected");
  });

  it("reports a user rejection as EIP-1193 code 4001", async () => {
    fakeInjectedWallet(window, { reject: true });
    const config = makeConfig();
    await assert.rejects(connect(config, { connector: config.connectors[0]! }), (e: any) => e.code === 4001 || e.cause?.code === 4001);
  });

  it("wagmi reconnect() restores the session silently", async () => {
    const wallet = fakeInjectedWallet(window);
    wallet.authorize();
    localStorage.setItem("terra-connect", JSON.stringify({ c: "injected" }));
    const config = makeConfig();
    await reconnect(config, { connectors: [config.connectors[0]!] });
    assert.equal(getConnection(config).address, ADDRESS);
    assert.ok(!wallet.calls.some((c) => c.method === "eth_requestAccounts"));
  });
});

describe("wagmi connector key handling", () => {
  it("refuses a secret key when the connector is created, before any config or connect", () => {
    for (const key of ["tw_live_sk_ABCDEFGH12345678", "whsec_ABCDEFGH12345678", "tw_test_pk_AAAA_sk_BBBBBBBBBBBB"]) {
      assert.throws(() => terraWallet({ publishableKey: key }), (e: unknown) => (e as { code?: string }).code === "SECRET_KEY_REFUSED" && !(e as Error).message.includes(key), key);
    }
    assert.equal(typeof terraWallet({ publishableKey: "tw_test_pk_Ab-_9xYzQ1w2E3r4T5y6U7i8O9p0-LkJhGfDsA_zXcVb" }), "function");
  });
});
