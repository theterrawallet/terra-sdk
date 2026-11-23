import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTerraConnect, type TerraConnect } from "@terrawallet/connect";
import { ADDRESS, fakeInjectedWallet } from "../../connect/test/fakes.js";
import { setupDom, tick, type Env } from "../../elements/test/helpers.js";
import { ConnectButton, TerraProvider, useAccount, useConnect, useSendTransaction, useSignMessage, useSwitchChain } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let env: Env;
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  env = setupDom();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await env.restore();
});

/** Renders `children` and exposes the latest hook results through `probe`. */
function harness<T>(client: TerraConnect, use: () => T, extra?: ReactNode) {
  const probe: { current: T | undefined } = { current: undefined };
  function Probe() {
    probe.current = use();
    return null;
  }
  return { probe, el: createElement(TerraProvider, { client }, createElement(Probe), extra) };
}

describe("hooks", () => {
  it("useConnect, useAccount, useSignMessage, useSwitchChain and useSendTransaction drive the wallet", async () => {
    const wallet = fakeInjectedWallet(window);
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false, chains: [1, 8453] });
    const { probe, el } = harness(client, () => ({ account: useAccount(), connect: useConnect({ modal: false }), sign: useSignMessage(), sw: useSwitchChain(), send: useSendTransaction() }));
    await act(async () => root.render(el));
    assert.equal(probe.current!.account.isDisconnected, true);

    await act(async () => {
      await probe.current!.connect.connectAsync();
    });
    assert.equal(probe.current!.account.address, ADDRESS);
    assert.equal(probe.current!.account.chain?.name, "Ethereum");

    await act(async () => {
      await probe.current!.sign.signMessageAsync({ message: "hello" });
    });
    assert.equal(probe.current!.sign.data, `0x${"11".repeat(65)}`);

    await act(async () => {
      await probe.current!.sw.switchChainAsync({ chainId: 8453 });
    });
    assert.equal(probe.current!.account.chainId, 8453);

    await act(async () => {
      await probe.current!.send.sendTransactionAsync({ to: ADDRESS, value: 1n });
    });
    assert.equal(probe.current!.send.data, `0x${"22".repeat(32)}`);
    assert.equal(wallet.calls.at(-1)?.method, "eth_sendTransaction");
  });

  it("keeps typed errors in state for the fire-and-forget variants", async () => {
    fakeInjectedWallet(window, { reject: true });
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false });
    const { probe, el } = harness(client, () => useConnect({ modal: false }));
    await act(async () => root.render(el));
    await act(async () => {
      probe.current!.connect();
      await tick(40);
    });
    assert.equal(probe.current!.error?.code, "USER_REJECTED");
    assert.equal(probe.current!.isError, true);
    assert.equal(probe.current!.isPending, false);
  });

  it("<ConnectButton/> renders the Web Component bound to the provider's client", async () => {
    fakeInjectedWallet(window);
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false });
    const connected: string[] = [];
    await act(async () => root.render(createElement(TerraProvider, { client, theme: { mode: "light" } }, createElement(ConnectButton, { onConnect: (r) => connected.push(r.address) }))));
    const host = container.querySelector("terra-connect-button")!;
    assert.equal(host.getAttribute("theme"), "light");
    await act(async () => {
      await client.connect();
    });
    const shadow = env.roots.get(host)!;
    assert.ok(shadow.querySelector("button.chip"), "shows the connected account chip");
    assert.deepEqual(connected, [ADDRESS]);
  });
});
