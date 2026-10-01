// @vitest-environment node
/**
 * The QR encoder is ours, so it has to be checked against something that is
 * known to scan. `qrcode-generator` is only a dev dependency: it is the oracle
 * in these tests and never ships.
 *
 * Every mask produces a readable symbol, so the two implementations need not
 * choose the same one. What must agree is the symbol itself — the data, the
 * error correction, the layout, the format bits. So the reference's mask is
 * read back out of its own symbol, and ours is built with that mask forced.
 * If they are then identical module for module, the encoder is right.
 */
import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { encodeQr, internalsForTest, qrSvgPath } from './qr';

type Reference = { isDark: (row: number, col: number) => boolean; getModuleCount: () => number };

function reference(text: string, level: 'L' | 'M' | 'Q' | 'H'): boolean[][] {
  const qr = qrcode(0, level) as unknown as Reference & {
    addData(data: string, mode?: string): void;
    make(): void;
  };
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => qr.isDark(row, col)),
  );
}

/** Read the mask out of a symbol's format information, down column 8. */
function maskOf(rows: boolean[][]): number {
  const size = rows.length;
  let bits = 0;
  for (let i = 0; i < 15; i += 1) {
    const cell = i < 6 ? rows[i][8] : i < 8 ? rows[i + 1][8] : rows[size - 15 + i][8];
    if (cell) bits |= 1 << i;
  }
  const data = (bits ^ 0x5412) >>> 10;
  return data & 0b111;
}

function versionOf(size: number): number {
  return (size - 17) / 4;
}

const SAMPLES = [
  'plnr-abcd-efgh-ijkl',
  'https://planner.example/#/panels?invite=PLNR-ABCD-EFGH-IJKL',
  'A',
  'hello',
  'https://planner.example/#/panels?invite=PLNR-WXYZ-1234-9876&name=Sara',
  'x'.repeat(120),
];

describe('our QR encoder against a reference implementation', () => {
  for (const sample of SAMPLES) {
    it(`matches it module for module: ${sample.slice(0, 42)}`, () => {
      const expected = reference(sample, 'M');
      const size = expected.length;
      const version = versionOf(size);
      const mask = maskOf(expected);

      const ours = encodeQr(sample, 'M', mask);
      expect(ours.size).toBe(size);
      expect(ours.rows).toEqual(expected);
      expect(version).toBeGreaterThanOrEqual(1);
    });
  }

  it('agrees at every error-correction level', () => {
    const text = 'https://planner.example/#/panels?invite=PLNR-ABCD-EFGH-IJKL';
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const expected = reference(text, level);
      const ours = encodeQr(text, level, maskOf(expected));
      expect(ours.rows).toEqual(expected);
    }
  });
});

describe('the symbol itself', () => {
  it('carries the three finder patterns', () => {
    const { size, rows } = encodeQr('plnr-abcd-efgh-ijkl');
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(rows[oy + y][ox + x]).toBe(ring !== 2 && ring <= 3);
        }
      }
    }
  });

  it('alternates along both timing patterns', () => {
    const { size, rows } = encodeQr('plnr-abcd-efgh-ijkl');
    for (let i = 8; i < size - 8; i += 1) {
      expect(rows[6][i]).toBe(i % 2 === 0);
      expect(rows[i][6]).toBe(i % 2 === 0);
    }
  });

  it('sets the dark module below the top-left finder', () => {
    const { size, rows } = encodeQr('plnr-abcd-efgh-ijkl');
    expect(rows[size - 8][8]).toBe(true);
  });

  it('grows the symbol as the text grows, and never past version 10', () => {
    const sizes = [1, 10, 30, 60, 100, 150, 200].map((length) => encodeQr('x'.repeat(length)).size);
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(10 * 4 + 17);
  });

  it('refuses text it cannot carry instead of drawing something unscannable', () => {
    expect(() => encodeQr('x'.repeat(400))).toThrow();
  });

  it('handles characters outside ASCII', () => {
    // The oracle turns text into bytes one character at a time, so it can only
    // be handed bytes below 256. The text is therefore handed to the oracle as
    // the string of those same bytes, character for character — which is the
    // same byte stream our UTF-8 encoding must produce.
    const text = 'https://planner.example/#/panels?invite=PLNR-ABCD-EFGH-IJKL&n=سارا';
    const asBytes = Array.from(new TextEncoder().encode(text))
      .map((byte) => String.fromCharCode(byte))
      .join('');
    const expected = reference(asBytes, 'M');
    expect(encodeQr(text, 'M', maskOf(expected)).rows).toEqual(expected);
  });
});

/**
 * The error-correction arithmetic is pinned down against the worked example
 * from the specification, so it is checked even when the layout is right and
 * only the arithmetic is not.
 */
describe('the error correction', () => {
  it('builds the generator polynomial for ten codewords', () => {
    expect(internalsForTest.generator(10)).toEqual([1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
  });

  it('computes the codewords the specification gives as an example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(internalsForTest.remainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

describe('drawing it', () => {
  it('emits one path inside a view box with a quiet zone', () => {
    const { path, viewBox } = qrSvgPath(encodeQr('plnr-abcd-efgh-ijkl'), 4);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('h1v1h-1z');
    // Two modules of quiet zone on each side, as a scanner expects.
    const span = encodeQr('plnr-abcd-efgh-ijkl').size + 8;
    expect(viewBox).toBe(`0 0 ${span} ${span}`);
  });

  it('draws one square per dark module', () => {
    const matrix = encodeQr('plnr-abcd-efgh-ijkl');
    const { path } = qrSvgPath(matrix);
    const drawn = path.split('M').length - 1;
    const dark = matrix.rows.flat().filter(Boolean).length;
    expect(drawn).toBe(dark);
  });
});
