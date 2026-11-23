import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ConnectButton, TerraProvider, useAccount } from "../src/index.js";

function Status() {
  const { status, address } = useAccount();
  return createElement("p", { id: "s" }, `${status}:${address ?? "none"}`);
}

describe("server rendering", () => {
  it("renders without a DOM: disconnected state and the custom element tag with its theme attributes", () => {
    assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
    const html = renderToString(
      createElement(TerraProvider, { appName: "Shop", theme: { mode: "dark", accent: "#0A5BFF" } }, createElement(ConnectButton, { size: "lg" }), createElement(Status)),
    );
    assert.match(html, /<terra-connect-button[^>]*theme="dark"/);
    assert.match(html, /accent="#0A5BFF"/);
    assert.match(html, /size="lg"/);
    assert.match(html, /disconnected:none/);
  });

  it("refuses a secret key passed as publishableKey", () => {
    assert.throws(
      () => renderToString(createElement(TerraProvider, { publishableKey: "tw_live_sk_ABCDEFGH12345678" }, null)),
      (e: unknown) => (e as { code?: string }).code === "SECRET_KEY_REFUSED",
    );
  });
});
