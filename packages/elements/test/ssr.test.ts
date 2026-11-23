import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("server rendering", () => {
  it("imports without a DOM and defineTerraElements() is a no-op there", async () => {
    assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
    const mod = await import("../src/index.js");
    assert.doesNotThrow(() => mod.defineTerraElements());
    assert.equal(typeof mod.openWalletModal, "function");
  });
});
