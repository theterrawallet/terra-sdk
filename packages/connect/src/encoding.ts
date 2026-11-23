/** Byte and number encodings used by the connectors. Dependency-free. */

export type Hex = `0x${string}`;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!];
  return out;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    let carry = B58.indexOf(s[i]!);
    if (carry < 0) throw new Error("Invalid base58 string.");
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i]!;
  return out;
}

export function bytesToBase64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToHex(u8: Uint8Array): Hex {
  let s = "0x";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}

export const utf8ToHex = (text: string): Hex => bytesToHex(new TextEncoder().encode(text));

export const isHex = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v);

/** A JSON-RPC quantity ("0x1a") from a bigint, a safe integer, or a decimal/hex string. */
export function toQuantity(v: bigint | number | string): Hex {
  if (typeof v === "string") {
    if (isHex(v)) return v;
    if (!/^\d+$/.test(v)) throw new TypeError(`Not a number: ${v.slice(0, 40)}`);
    v = BigInt(v);
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new TypeError("Numbers must be non-negative safe integers. Use a bigint.");
    v = BigInt(v);
  }
  if (v < 0n) throw new TypeError("Quantities cannot be negative.");
  return `0x${v.toString(16)}`;
}

/** JSON.stringify that writes bigints as decimal strings (EIP-712 uint values). */
export const stringifyJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
