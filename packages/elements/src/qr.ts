/**
 * QR Code encoder (ISO/IEC 18004), byte mode, versions 1 to 40, automatic mask selection. A compact port of
 * Project Nayuki's reference algorithm (MIT), verified module-for-module against it in test/qr.test.ts.
 * Only used for WalletConnect pairing codes, so it lives in the UI package and never in the connect core.
 */

export type Ecc = "L" | "M" | "Q" | "H";
const ECC_ORDINAL: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = [1, 0, 3, 2];

// prettier-ignore
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
// prettier-ignore
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const rawModules = (ver: number) => {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
};
const dataCodewords = (ver: number, e: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e]![ver]! * NUM_BLOCKS[e]![ver]!;

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j]! ^= r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    div.forEach((c, i) => (r[i]! ^= gfMul(c, f)));
  }
  return r;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export interface QrMatrix {
  size: number;
  version: number;
  ecc: Ecc;
  mask: number;
  /** modules[y][x]: true = dark */
  modules: boolean[][];
  /** Function patterns (finders, timing, alignment, format/version areas). */
  isFunction: boolean[][];
}

/** Encodes text (UTF-8, byte mode). `boost` raises the error correction level when it costs no extra size. */
export function encodeQr(text: string, ecc: Ecc = "M", opts: { boost?: boolean; minVersion?: number } = {}): QrMatrix {
  const data = new TextEncoder().encode(text);
  let e = ECC_ORDINAL[ecc];
  let ver = Math.max(1, opts.minVersion ?? 1);
  let used = 0;
  for (; ; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    used = 4 + ccBits + data.length * 8;
    if (data.length < 1 << ccBits && used <= dataCodewords(ver, e) * 8) break;
    if (ver >= 40) throw new RangeError("Data too long for a QR code.");
  }
  if (opts.boost !== false) for (let n = e + 1; n <= 3; n++) if (used <= dataCodewords(ver, n) * 8) e = n;

  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(data.length, ver <= 9 ? 8 : 16);
  for (const b of data) put(b, 8);
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setF = (x: number, y: number, dark: boolean) => {
    m[y]![x] = dark;
    fn[y]![x] = true;
  };

  // Function patterns
  for (let i = 0; i < size; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align: number[] = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
  }
  const na = align.length;
  for (let i = 0; i < na; i++)
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS[e]! << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6));
    setF(8, 8, bit(b, 7));
    setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setF(a, c, bit(b, i));
      setF(c, a, bit(b, i));
    }
  }

  // Error correction and interleaving
  const nb = NUM_BLOCKS[e]![ver]!;
  const eccLen = ECC_PER_BLOCK[e]![ver]!;
  const raw = Math.floor(rawModules(ver) / 8);
  const short = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = codewords.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
    k += dat.length;
    const ecw = rsRemainder(dat, div);
    if (i < short) dat.push(0);
    blocks.push(dat.concat(ecw));
  }
  const all: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) blocks.forEach((b, j) => (i !== shortLen - eccLen || j >= short) && all.push(b[i]!));

  // Place codewords in the zigzag
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y]![x] && idx < all.length * 8) {
          m[y]![x] = bit(all[idx >>> 3]!, 7 - (idx & 7));
          idx++;
        }
      }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let inv: boolean;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break; // prettier-ignore
          case 1: inv = y % 2 === 0; break; // prettier-ignore
          case 2: inv = x % 3 === 0; break; // prettier-ignore
          case 3: inv = (x + y) % 3 === 0; break; // prettier-ignore
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; // prettier-ignore
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break; // prettier-ignore
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break; // prettier-ignore
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; // prettier-ignore
        }
        if (!fn[y]![x] && inv) m[y]![x] = !m[y]![x];
      }
  };

  const penalty = () => {
    let score = 0;
    const addHistory = (run: number, h: number[]) => {
      if (h[0] === 0) run += size;
      h.pop();
      h.unshift(run);
    };
    const countPatterns = (h: number[]) => {
      const n = h[1]!;
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0]! >= n * 4 && h[6]! >= n ? 1 : 0) + (core && h[6]! >= n * 4 && h[0]! >= n ? 1 : 0);
    };
    const terminate = (color: boolean, run: number, h: number[]) => {
      if (color) {
        addHistory(run, h);
        run = 0;
      }
      addHistory(run + size, h);
      return countPatterns(h);
    };
    for (const horizontal of [true, false]) {
      for (let a = 0; a < size; a++) {
        let color = false;
        let run = 0;
        const h = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b++) {
          const v = horizontal ? m[a]![b]! : m[b]![a]!;
          if (v === color) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else {
            addHistory(run, h);
            if (!color) score += countPatterns(h) * 40;
            color = v;
            run = 1;
          }
        }
        score += terminate(color, run, h) * 40;
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const c = m[y]![x]!;
        if (c) dark++;
        if (x < size - 1 && y < size - 1 && c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    const total = size * size;
    return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  };

  let best = 0;
  let min = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const p = penalty();
    if (p < min) {
      min = p;
      best = mask;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { size, version: ver, ecc: (["L", "M", "Q", "H"] as const)[e]!, mask: best, modules: m, isFunction: fn };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Renders a QR code as one crisp SVG (no canvas), with rounded finder "eyes" and an optional centre logo on a
 * white plate. The modules under the plate are left out; error correction level Q leaves ample margin for it.
 */
export function renderQrSvg(text: string, opts: { size?: number; logo?: string; label?: string } = {}): SVGSVGElement {
  const qr = encodeQr(text, "Q");
  const n = qr.size;
  const quiet = 3;
  const dim = n + quiet * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${dim} ${dim}`);
  svg.setAttribute("width", String(opts.size ?? 232));
  svg.setAttribute("height", String(opts.size ?? 232));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", opts.label ?? "QR code");
  const add = (tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
    return el;
  };
  add("rect", { width: dim, height: dim, rx: 2.5, fill: "#fff" });
  const plate = opts.logo ? Math.max(7, Math.round(n * 0.2) | 1) : 0;
  const lo = Math.floor((n - plate) / 2);
  const hi = lo + plate;
  const inFinder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  let d = "";
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      const skip = (xx: number) => inFinder(xx, y) || (plate > 0 && xx >= lo && xx < hi && y >= lo && y < hi);
      if (!qr.modules[y]![x] || skip(x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < n && qr.modules[y]![x] && !skip(x)) x++;
      d += `M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`;
    }
  }
  add("path", { d, fill: "#0B1221", "shape-rendering": "crispEdges" });
  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    add("rect", { x: fx + quiet + 0.5, y: fy + quiet + 0.5, width: 6, height: 6, rx: 1.6, fill: "none", stroke: "#0B1221", "stroke-width": 1 });
    add("rect", { x: fx + quiet + 2, y: fy + quiet + 2, width: 3, height: 3, rx: 0.8, fill: "#0A5BFF" });
  }
  if (opts.logo) {
    const p = lo + quiet;
    add("rect", { x: p - 0.25, y: p - 0.25, width: plate + 0.5, height: plate + 0.5, rx: 1.8, fill: "#fff" });
    add("image", { href: opts.logo, x: p + 0.6, y: p + 0.6, width: plate - 1.2, height: plate - 1.2, preserveAspectRatio: "xMidYMid meet" });
  }
  return svg;
}
