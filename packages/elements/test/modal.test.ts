import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createTerraConnect, type TerraConnect } from "@terrawallet/connect";
import { ADDRESS, PAIRING_URI, fakeInjectedWallet, fakeSignClient, randomProjectId } from "../../connect/test/fakes.js";
import { setupDom, modalRoot, tick, type Env } from "./helpers.js";

let env: Env | undefined;
afterEach(async () => {
  const { closeWalletModal } = await import("../src/modal.js");
  closeWalletModal();
  await env?.restore();
  env = undefined;
});

async function load() {
  return import("../src/index.js");
}

const click = (root: ShadowRoot, sel: string) => (root.querySelector(sel) as HTMLElement).click();

describe("wallet modal", () => {
  it("is an accessible modal dialog: labelled, live region, focus inside, Escape closes and cancels", async () => {
    env = setupDom();
    const { connectWithModal } = await load();
    fakeInjectedWallet(window);
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false });
    const pending = connectWithModal(client);
    await tick(30);
    const root = modalRoot(env);
    const dialog = root.querySelector("dialog")!;
    assert.ok(dialog.open);
    assert.equal(root.getElementById("terra-title")?.textContent, "Connect Terra Wallet");
    assert.equal(dialog.getAttribute("aria-labelledby"), "terra-title");
    assert.ok(root.querySelector('[aria-live="polite"]'));
    assert.equal(root.activeElement?.getAttribute("data-key"), "injected", "focus starts on the detected wallet");
    assert.equal(root.querySelector(".pill")?.textContent, "Detected");

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await assert.rejects(pending, (e: unknown) => (e as { code?: string }).code === "USER_REJECTED");
    assert.equal(document.querySelector("terra-wallet-modal"), null);
  });

  it("traps Tab focus inside the dialog", async () => {
    env = setupDom();
    const { openWalletModal } = await load();
    fakeInjectedWallet(window);
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false });
    openWalletModal(client);
    await tick(30);
    const root = modalRoot(env);
    const items = [...root.querySelectorAll<HTMLElement>('.panel button:not([disabled]), .panel a[href]')];
    const dialog = root.querySelector("dialog")!;
    items.at(-1)!.focus();
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    assert.equal(root.activeElement, items[0]);
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(root.activeElement, items.at(-1));
  });

  it("connects through the detected extension and closes", async () => {
    env = setupDom();
    const { connectWithModal } = await load();
    fakeInjectedWallet(window);
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false });
    const pending = connectWithModal(client);
    await tick(30);
    click(modalRoot(env), '[data-key="injected"]');
    assert.deepEqual(await pending, { address: ADDRESS, chainId: 1, connector: "injected" });
    assert.equal(document.querySelector("terra-wallet-modal"), null);
  });

  it("without the extension on desktop, shows a WalletConnect QR code plus install links", async () => {
    env = setupDom();
    const { openWalletModal } = await load();
    const wc = fakeSignClient();
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false, walletConnectProjectId: randomProjectId(), walletConnect: { loader: wc.loader } });
    openWalletModal(client);
    await tick(60);
    const root = modalRoot(env);
    assert.equal(root.getElementById("terra-title")?.textContent, "Scan with Terra Wallet");
    const svg = root.querySelector(".qr svg")!;
    assert.ok(svg, "QR rendered");
    assert.equal(svg.getAttribute("role"), "img");
    assert.equal(client.getState().pairingUri, PAIRING_URI);
    const links = [...root.querySelectorAll<HTMLAnchorElement>("a.row")].map((a) => [a.href, a.rel]);
    assert.deepEqual(links.map((l) => new URL(l[0]!).host), ["chromewebstore.google.com", "play.google.com"]);
    assert.ok(links.every((l) => l[1] === "noopener noreferrer"));
    wc.state.approve(wc.session());
    await tick(20);
    assert.equal(client.getState().status, "connected");
    assert.equal(document.querySelector("terra-wallet-modal"), null);
  });

  it("on a phone, opens the app with the pairing deep link from a tap", async () => {
    env = setupDom({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", width: 390, maxTouchPoints: 5 });
    const { openWalletModal } = await load();
    const wc = fakeSignClient();
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false, deepLink: "manual", walletConnectProjectId: randomProjectId(), walletConnect: { loader: wc.loader } });
    openWalletModal(client);
    await tick(60);
    const root = modalRoot(env);
    const open = root.querySelector<HTMLButtonElement>('[data-key="open-app"]')!;
    assert.equal(open.disabled, false);
    open.click();
    assert.equal(location.href, `terrawallet://wc?uri=${encodeURIComponent(PAIRING_URI)}`);
    assert.match(root.querySelector('[data-key="get-ios"]')!.textContent!, /coming soon/);
  });

  it("warns when the requesting page is not https", async () => {
    env = setupDom({ url: "http://shop.example" });
    const { openWalletModal } = await load();
    openWalletModal(createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false }));
    await tick(30);
    const origin = modalRoot(env).querySelector(".origin")!;
    assert.ok(origin.classList.contains("warn"));
    assert.match(origin.textContent!, /not secure \(http\)/);
  });

  it("account view: shows the address, switches networks, and disconnects", async () => {
    env = setupDom();
    const { openWalletModal } = await load();
    const wallet = fakeInjectedWallet(window);
    const client: TerraConnect = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false, chains: [1, 8453] });
    await client.connect();
    openWalletModal(client);
    const root = modalRoot(env);
    assert.equal(root.getElementById("terra-title")?.textContent, "Terra Wallet");
    assert.match(root.querySelector(".addr")!.textContent!, /0xabab/);
    assert.equal(root.querySelector('[data-key="net-1"]')!.getAttribute("aria-current"), "true");
    click(root, '[data-key="net-8453"]');
    await tick(20);
    assert.equal(client.getState().chainId, 8453);
    assert.equal(root.querySelector('[data-key="net-8453"]')!.getAttribute("aria-current"), "true");
    click(root, '[data-key="disconnect"]');
    await tick(10);
    assert.equal(client.getState().status, "disconnected");
    assert.equal(wallet.calls.at(-1)?.method, "wallet_revokePermissions");
  });
});

describe("<terra-connect-button>", () => {
  it("reflects connection state and emits composed events", async () => {
    env = setupDom();
    const { defineTerraElements } = await load();
    defineTerraElements();
    fakeInjectedWallet(window);
    const client = createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false });
    const el = document.createElement("terra-connect-button") as HTMLElement & { client: TerraConnect };
    el.client = client;
    document.body.append(el);
    const events: string[] = [];
    document.addEventListener("terra-connect", (e) => events.push(`connect:${(e as CustomEvent).detail.address}`));
    const root = env.roots.get(el)!;
    assert.match(root.querySelector("button")!.textContent!, /Connect Terra Wallet/);
    await client.connect();
    assert.deepEqual(events, [`connect:${ADDRESS}`]);
    const chip = root.querySelector("button.chip")!;
    assert.match(chip.getAttribute("aria-label")!, /^Terra Wallet account 0xabab.*abab on Ethereum\. Open account$/);
  });
});
