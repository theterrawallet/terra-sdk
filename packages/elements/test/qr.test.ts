/**
 * Cross-checks the QR encoder against the reference implementation (Project Nayuki's qrcodegen, as embedded in
 * qrcode.react), module for module, for WalletConnect-style URIs and edge sizes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { encodeQr, type Ecc } from "../src/qr.js";

function reference(value: string, level: Ecc): boolean[][] {
  const html = renderToStaticMarkup(createElement(QRCodeSVG, { value, level, marginSize: 0, boostLevel: true }));
  const n = Number(/viewBox="0 0 (\d+) \1"/.exec(html)![1]);
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const paths = [...html.matchAll(/<path[^>]*d="([^"]+)"/g)].map((m) => m[1]!);
  const d = paths.find((p) => p.includes("v1H"))!;
  for (const m of d.matchAll(/M(\d+)[ ,](\d+) ?h(\d+)v1H\d+z/g)) {
    const [x, y, len] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < len; i++) grid[y]![x + i] = true;
  }
  return grid;
}

const TOPIC = "7f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a1908";
const SYM = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CASES: [string, Ecc][] = [
  [`wc:${TOPIC}@2?expiryTimestamp=1763885100&relay-protocol=irn&symKey=${SYM}`, "Q"],
  [`wc:${TOPIC}@2?expiryTimestamp=1763885100&methods=wc_sessionAuthenticate&relay-protocol=irn&symKey=${SYM}`, "Q"],
  [`wc:${TOPIC}@2?relay-protocol=irn&symKey=${SYM}`, "M"],
  ["https://terrawallet.us", "L"],
  ["hello", "H"],
  ["x".repeat(600), "M"],
  ["Terra Wallet ✓ ünïcödé", "Q"],
];

describe("QR encoder matches the reference implementation", () => {
  for (const [text, level] of CASES) {
    it(`${level}: ${text.slice(0, 48)}${text.length > 48 ? "..." : ""} (${text.length} chars)`, () => {
      const ours = encodeQr(text, level);
      const ref = reference(text, level);
      assert.equal(ours.size, ref.length, "same version");
      assert.deepEqual(ours.modules, ref);
    });
  }

  it("refuses data that does not fit version 40", () => {
    assert.throws(() => encodeQr("x".repeat(3000), "H"), RangeError);
  });
});
