/**
 * A QR encoder, written here rather than installed.
 *
 * The point of it is one screen: a guardian holds up a code and a student
 * scans it instead of typing twenty characters out loud. That is not worth a
 * dependency — a QR is a published layout, not a secret — and everything else
 * in this app is readable end to end. If this breaks, the reader can say so.
 *
 * Byte mode only, error correction level M, versions 1 to 10: a URL with a
 * pairing code in it is a few dozen bytes, and that is all this will ever be
 * asked to carry.
 *
 * Layout follows ISO/IEC 18004.
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Modules per side, including the quiet zone is *not* included. */
  size: number;
  /** Row-major; `true` is a dark module. */
  at(x: number, y: number): boolean;
  /** Plain rows, for tests and for rendering. */
  rows: boolean[][];
}

/** Total codewords per version, all error-correction levels. */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

interface LevelSpec {
  /** Error-correction codewords per block. */
  ecPerBlock: number;
  /** [blocks in group 1, blocks in group 2]. */
  blocks: [number, number];
}

/**
 * Level M, the usual choice: it recovers about 15% of the symbol. Enough for a
 * scuffed phone screen, without spending the space that level Q would.
 */
const LEVELS: Record<QrLevel, LevelSpec[]> = {
  L: [
    { ecPerBlock: 0, blocks: [0, 0] },
    { ecPerBlock: 7, blocks: [1, 0] },
    { ecPerBlock: 10, blocks: [1, 0] },
    { ecPerBlock: 15, blocks: [1, 0] },
    { ecPerBlock: 20, blocks: [1, 0] },
    { ecPerBlock: 26, blocks: [1, 0] },
    { ecPerBlock: 18, blocks: [2, 0] },
    { ecPerBlock: 20, blocks: [2, 0] },
    { ecPerBlock: 24, blocks: [2, 0] },
    { ecPerBlock: 30, blocks: [2, 0] },
    { ecPerBlock: 18, blocks: [2, 2] },
  ],
  M: [
    { ecPerBlock: 0, blocks: [0, 0] },
    { ecPerBlock: 10, blocks: [1, 0] },
    { ecPerBlock: 16, blocks: [1, 0] },
    { ecPerBlock: 26, blocks: [1, 0] },
    { ecPerBlock: 18, blocks: [2, 0] },
    { ecPerBlock: 24, blocks: [2, 0] },
    { ecPerBlock: 16, blocks: [4, 0] },
    { ecPerBlock: 18, blocks: [4, 0] },
    { ecPerBlock: 22, blocks: [2, 2] },
    { ecPerBlock: 22, blocks: [3, 2] },
    { ecPerBlock: 26, blocks: [4, 1] },
  ],
  Q: [
    { ecPerBlock: 0, blocks: [0, 0] },
    { ecPerBlock: 13, blocks: [1, 0] },
    { ecPerBlock: 22, blocks: [1, 0] },
    { ecPerBlock: 18, blocks: [2, 0] },
    { ecPerBlock: 26, blocks: [2, 0] },
    { ecPerBlock: 18, blocks: [2, 2] },
    { ecPerBlock: 24, blocks: [4, 0] },
    { ecPerBlock: 18, blocks: [2, 4] },
    { ecPerBlock: 22, blocks: [4, 4] },
    { ecPerBlock: 20, blocks: [4, 4] },
    { ecPerBlock: 24, blocks: [6, 2] },
  ],
  H: [
    { ecPerBlock: 0, blocks: [0, 0] },
    { ecPerBlock: 17, blocks: [1, 0] },
    { ecPerBlock: 28, blocks: [1, 0] },
    { ecPerBlock: 22, blocks: [2, 0] },
    { ecPerBlock: 16, blocks: [4, 0] },
    { ecPerBlock: 22, blocks: [2, 2] },
    { ecPerBlock: 28, blocks: [4, 0] },
    { ecPerBlock: 26, blocks: [4, 1] },
    { ecPerBlock: 26, blocks: [4, 2] },
    { ecPerBlock: 24, blocks: [4, 4] },
    { ecPerBlock: 28, blocks: [6, 2] },
  ],
};

/** Centres of the alignment patterns; version 1 has none. */
const ALIGNMENT = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const LEVEL_BITS: Record<QrLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/* ---------------------------------------------------------- Galois field */

/** GF(256) with the QR primitive polynomial x⁸ + x⁴ + x³ + x² + 1. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `count` error-correction codewords. */
function generator(count: number): number[] {
  let poly = [1];
  for (let i = 0; i < count; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= multiply(poly[j], 1);
      next[j + 1] ^= multiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder: the error-correction codewords for one block. */
function remainder(data: number[], ecCount: number): number[] {
  const gen = generator(ecCount);
  const out = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    for (let i = 0; i < ecCount; i += 1) out[i] ^= multiply(gen[i + 1], factor);
  }
  return out;
}

/* ------------------------------------------------------------- encoding */

function bytesOf(text: string): number[] {
  const utf8 = new TextEncoder().encode(text);
  return [...utf8];
}

function dataCodewords(version: number, level: QrLevel): number {
  const total = TOTAL_CODEWORDS[version];
  const spec = LEVELS[level][version];
  const ecTotal = spec.ecPerBlock * (spec.blocks[0] + spec.blocks[1]);
  return total - ecTotal;
}

/** Highest byte capacity for a version, in byte mode. */
function capacity(version: number, level: QrLevel): number {
  const bits = dataCodewords(version, level) * 8;
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((bits - 4 - countBits) / 8);
}

function chooseVersion(length: number, level: QrLevel): number {
  for (let version = 1; version <= 10; version += 1) {
    if (length <= capacity(version, level)) return version;
  }
  throw new Error('That is too much text for a QR code here.');
}

class BitBuffer {
  private bits: number[] = [];
  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
  get length(): number {
    return this.bits.length;
  }
  toArray(): number[] {
    return this.bits;
  }
}

function interleave(data: number[][], ec: number[][]): number[] {
  const out: number[] = [];
  const longestData = Math.max(...data.map((block) => block.length));
  for (let i = 0; i < longestData; i += 1) {
    for (const block of data) if (i < block.length) out.push(block[i]);
  }
  const longestEc = Math.max(...ec.map((block) => block.length));
  for (let i = 0; i < longestEc; i += 1) {
    for (const block of ec) if (i < block.length) out.push(block[i]);
  }
  return out;
}

function buildCodewords(bytes: number[], version: number, level: QrLevel): number[] {
  const buffer = new BitBuffer();
  buffer.push(0b0100, 4); // byte mode
  buffer.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.push(byte, 8);

  const totalBits = dataCodewords(version, level) * 8;
  // Terminator, then pad to a byte boundary, then the two pad codewords.
  buffer.push(0, Math.min(4, totalBits - buffer.length));
  while (buffer.length % 8 !== 0) buffer.push(0, 1);
  const pads = [0xec, 0x11];
  let index = 0;
  while (buffer.length < totalBits) {
    buffer.push(pads[index % 2], 8);
    index += 1;
  }

  const bits = buffer.toArray();
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  const spec = LEVELS[level][version];
  const [groupOne, groupTwo] = spec.blocks;
  const totalBlocks = groupOne + groupTwo;
  const dataTotal = dataCodewords(version, level);
  const shortLength = Math.floor(dataTotal / totalBlocks);
  // The last blocks carry one more codeword when it does not divide evenly.
  const longBlocks = dataTotal % totalBlocks;

  let offset = 0;
  for (let block = 0; block < totalBlocks; block += 1) {
    const length = shortLength + (block >= totalBlocks - longBlocks ? 1 : 0);
    const slice: number[] = [];
    for (let i = 0; i < length; i += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[offset + bit];
      offset += 8;
      slice.push(byte);
    }
    dataBlocks.push(slice);
    ecBlocks.push(remainder(slice, spec.ecPerBlock));
  }
  void groupTwo;
  return interleave(dataBlocks, ecBlocks);
}

/* --------------------------------------------------------------- layout */

type Grid = (boolean | null)[][];

function blank(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(grid: Grid, x: number, y: number): void {
  const size = grid.length;
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const row = y + dy;
      const col = x + dx;
      if (row < 0 || col < 0 || row >= size || col >= size) continue;
      // A finder is three rings: 7×7 dark, 5×5 light, 3×3 dark, inside a
      // one-module light separator.
      const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      grid[row][col] = inside ? ring !== 2 && ring <= 3 : false;
    }
  }
}

function placeAlignment(grid: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      grid[cy + dy][cx + dx] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
    }
  }
}

function functionPattern(size: number, version: number): Grid {
  const grid = blank(size);
  placeFinder(grid, 0, 0);
  placeFinder(grid, size - 7, 0);
  placeFinder(grid, 0, size - 7);

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    if (grid[6][i] === null) grid[6][i] = dark;
    if (grid[i][6] === null) grid[i][6] = dark;
  }

  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      // An alignment pattern would sit on top of a finder; those corners are
      // already occupied, so they are skipped.
      const overlapsFinder =
        (cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9);
      if (!overlapsFinder) placeAlignment(grid, cx, cy);
    }
  }

  // Format information areas, and the dark module below the top-left finder.
  for (let i = 0; i <= 8; i += 1) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i += 1) {
    grid[8][size - 1 - i] = false;
    grid[size - 1 - i][8] = false;
  }
  grid[size - 8][8] = true;

  // Version information, from version 7 up.
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      grid[Math.floor(i / 3)][(size - 11) + (i % 3)] = false;
      grid[(size - 11) + (i % 3)][Math.floor(i / 3)] = false;
    }
  }
  return grid;
}

/** `x` is the column and `y` the row, as the standard's mask formulas take them. */
const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x, _y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) === 0,
  (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0,
  (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

function placeData(grid: Grid, codewords: number[], mask: number): void {
  const size = grid.length;
  let bitIndex = 0;
  const total = codewords.length * 8;
  const nextBit = (): boolean => {
    const byte = codewords[bitIndex >>> 3];
    const bit = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
    bitIndex += 1;
    return bit;
  };
  // Columns in pairs, right to left. The walk is one continuous snake: it goes
  // up one pair, turns at the top, and comes down the next — it does not start
  // again at the bottom each time. The timing column at x = 6 is stepped over,
  // not written through.
  let row = size - 1;
  let direction = -1;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (;;) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = column - offset;
        if (grid[row][x] !== null) continue;
        if (bitIndex >= total) {
          // Remainder bits: the symbol has a few more modules than it has bits.
          // They are light, but the mask still applies to them.
          grid[row][x] = MASKS[mask](x, row);
          continue;
        }
        grid[row][x] = nextBit() !== MASKS[mask](x, row);
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;

  const lineScore = (line: boolean[]): number => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    // Rule 2: 2×2 blocks of one colour.
    return total;
  };

  for (let y = 0; y < size; y += 1) score += lineScore(grid[y]);
  for (let x = 0; x < size; x += 1) {
    const column = grid.map((row) => row[x]);
    score += lineScore(column);
  }

  // Rule 2: blocks of the same colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = grid[y][x];
      if (value === grid[y][x + 1] && value === grid[y + 1][x] && value === grid[y + 1][x + 1]) score += 3;
    }
  }

  // Rule 3: the finder's own rhythm appearing somewhere it should not —
  // 1:1:3:1:1 with four light modules on one side of it.
  const forward = [true, false, true, true, true, false, true, false, false, false, false];
  const backward = [false, false, false, false, true, false, true, true, true, false, true];
  const isRun = (get: (i: number) => boolean, pattern: boolean[]): boolean =>
    pattern.every((value, index) => get(index) === value);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x <= size - 11; x += 1) {
      if (isRun((i) => grid[y][x + i], forward)) score += 40;
      if (isRun((i) => grid[y][x + i], backward)) score += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y <= size - 11; y += 1) {
      if (isRun((i) => grid[y + i][x], forward)) score += 40;
      if (isRun((i) => grid[y + i][x], backward)) score += 40;
    }
  }

  // Rule 4: how far the balance of dark and light has drifted.
  let dark = 0;
  for (const row of grid) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** BCH(15,5) for the format information, masked with 0x5412. */
function formatBits(level: QrLevel, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (value & (1 << (i + 10))) value ^= 0x537 << i;
  }
  return ((data << 10) | value) ^ 0x5412;
}

/** BCH(18,6) for the version information, from version 7 up. */
function versionBits(version: number): number {
  let value = version << 12;
  for (let i = 5; i >= 0; i -= 1) {
    if (value & (1 << (i + 12))) value ^= 0x1f25 << i;
  }
  return (version << 12) | value;
}

/**
 * The 15 format bits are written twice — once down the column under the
 * top-left finder, once along the row beside it — so a symbol can still be
 * read when one corner is covered by a thumb.
 */
function writeFormat(grid: Grid, level: QrLevel, mask: number): void {
  const size = grid.length;
  const bits = formatBits(level, mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) grid[i][8] = bit(i);
    else if (i < 8) grid[i + 1][8] = bit(i); // row 6 is the timing pattern
    else grid[size - 15 + i][8] = bit(i);
  }
  for (let i = 0; i < 15; i += 1) {
    if (i < 8) grid[8][size - i - 1] = bit(i);
    else if (i < 9) grid[8][7] = bit(i); // column 6 is the timing pattern
    else grid[8][15 - i - 1] = bit(i);
  }
  grid[size - 8][8] = true; // the dark module: always set, part of the layout
}

function writeVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  const size = grid.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    grid[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
    grid[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
  }
}

/**
 * The symbol for one particular mask. `encodeQr` tries all eight and keeps the
 * calmest one; this builds a single one, which is what tests compare against.
 */
function build(text: string, level: QrLevel, version: number, mask: number): boolean[][] {
  const size = version * 4 + 17;
  const codewords = buildCodewords(bytesOf(text), version, level);
  const grid = functionPattern(size, version);
  placeData(grid, codewords, mask);
  writeFormat(grid, level, mask);
  writeVersion(grid, version);
  return grid.map((row) => row.map((cell) => cell === true));
}

/**
 * Encode text as a QR symbol. Throws rather than returning a symbol that will
 * not scan: a pairing code that silently fails to scan is worse than an honest
 * failure.
 *
 * `mask` is only for tests. Every mask is readable; the eight are tried and the
 * least busy one wins, so a symbol is not covered in patterns that a camera
 * could mistake for something structural.
 */
export function encodeQr(text: string, level: QrLevel = 'M', mask?: number): QrMatrix {
  const bytes = bytesOf(text);
  const version = chooseVersion(bytes.length, level);
  const size = version * 4 + 17;
  if (mask !== undefined) return finish(build(text, level, version, mask), size, version);

  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let candidate = 0; candidate < 8; candidate += 1) {
    const rows = build(text, level, version, candidate);
    const score = penalty(rows);
    if (score < bestScore) {
      bestScore = score;
      best = rows;
    }
  }
  return finish(best as boolean[][], size, version);
}

function finish(rows: boolean[][], size: number, version: number): QrMatrix {
  void version;
  return {
    size,
    rows,
    at: (x: number, y: number) => rows[y][x],
  };
}

/**
 * The symbol as an SVG path. A path rather than one rect per module: a
 * version 10 symbol is 57×57, and 3,249 elements is a lot of DOM for a picture.
 */
export function qrSvgPath(matrix: QrMatrix, quiet = 2): { path: string; viewBox: string } {
  const span = matrix.size + quiet * 2;
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.rows[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  return { path: parts.join(''), viewBox: `0 0 ${span} ${span}` };
}

/**
 * Two pieces of the encoder that the tests also check on their own, so a
 * failure says which part broke instead of only that the symbol is wrong.
 * `generator` is the Reed–Solomon divisor and `remainder` is the long division
 * that produces the error-correction codewords. Both are pure arithmetic with
 * no layout involved, so they are worth pinning down separately.
 */
export const internalsForTest = { generator, remainder };
