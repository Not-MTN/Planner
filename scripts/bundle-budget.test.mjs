import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  chunkLabel,
  collectBundles,
  compressedSize,
  entryAssets,
  evaluateBudget,
  formatBytes,
  labelBundles,
  looksLikeChunkFile,
  readManifest,
  stripHash,
} from './bundle-budget.mjs';

/**
 * The budget decides whether a build is allowed to ship, so its rules are
 * pinned here: what counts as the entry bundle, how a chunk is named across
 * builds (the hash in the filename must not matter), and which of the three
 * rules fails on what.
 */

const KB = 1024;

function file(name, gzip, extra = {}) {
  return { path: `assets/${name}`, name, size: gzip * 3, gzip, ...extra };
}

function baseline(measured, limits = {}) {
  return { tolerancePercent: 10, limits, measured };
}

describe('bundle-budget', () => {
  it('prints sizes the way a person reads them', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1.5 * KB)).toBe('1.50 KB');
    expect(formatBytes(147 * KB)).toBe('147.0 KB');
  });

  it('strips the content hash from a filename, and leaves an unhashed one alone', () => {
    expect(stripHash('assets/index-C7nSr84o.js')).toBe('assets/index.js');
    expect(stripHash('assets/panels-C8t6c4lv.css')).toBe('assets/panels.css');
    expect(stripHash('assets/Site-D5IdTWiH.css')).toBe('assets/Site.css');
    expect(stripHash('sw.js')).toBe('sw.js');
    expect(stripHash('theme-init.js')).toBe('theme-init.js');
  });

  it('knows a chunk filename from a path someone wrote', () => {
    expect(looksLikeChunkFile('_AccountGate-UTJDnoKx.js')).toBe(true);
    expect(looksLikeChunkFile('assets/index-C7nSr84o.js')).toBe(true);
    expect(looksLikeChunkFile('src/views/AIView.tsx')).toBe(false);
    expect(looksLikeChunkFile('node_modules/@capacitor/app/dist/esm/index.js')).toBe(false);
  });

  it('drops Vite’s shared-chunk marker along with the hash', () => {
    expect(chunkLabel('_AccountGate-CgBmmE82.css')).toBe('AccountGate.css');
    expect(chunkLabel('index-C7iv8AS2.css')).toBe('index.css');
  });

  it('measures the compressed size, which is what a phone downloads', () => {
    const text = 'const answer = 42;'.repeat(400);
    const gzipped = compressedSize(Buffer.from(text));
    expect(gzipped).toBe(gzipSync(Buffer.from(text), { level: 9 }).length);
    expect(gzipped).toBeLessThan(Buffer.byteLength(text) / 4);
  });

  it('names chunks by where they came from, using the manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(join(dir, '.vite'));
    writeFileSync(
      join(dir, '.vite', 'manifest.json'),
      JSON.stringify({
        'src/views/AIView.tsx': { file: 'assets/AIView-4d1oq_L0.js', name: 'AIView', src: 'src/views/AIView.tsx' },
        '_AccountGate-UTJDnoKx.js': { file: 'assets/AccountGate-UTJDnoKx.js', name: 'AccountGate' },
        '_AccountGate-CgBmmE82.css': { file: 'assets/AccountGate-CgBmmE82.css' },
        'index.html': { file: 'assets/index-p7IXIv0r.js', src: 'index.html', isEntry: true, css: ['assets/index-C7iv8AS2.css'] },
      }),
    );
    const manifest = readManifest(dir);
    const labelled = labelBundles(
      [
        { path: 'assets/AIView-4d1oq_L0.js', name: 'assets/AIView-4d1oq_L0.js', size: 1, gzip: 1 },
        { path: 'assets/AccountGate-UTJDnoKx.js', name: 'assets/AccountGate-UTJDnoKx.js', size: 1, gzip: 1 },
        { path: 'assets/AccountGate-CgBmmE82.css', name: 'assets/AccountGate-CgBmmE82.css', size: 1, gzip: 1 },
        { path: 'assets/index-p7IXIv0r.js', name: 'assets/index-p7IXIv0r.js', size: 1, gzip: 1 },
        { path: 'sw.js', name: 'sw.js', size: 1, gzip: 1 },
      ],
      manifest,
    );
    expect(labelled.map((entry) => entry.name)).toEqual([
      'src/views/AIView.tsx',
      'AccountGate',
      'AccountGate.css',
      'index.html [entry]',
      'sw.js',
    ]);
  });

  it('falls back to hash-stripped names when there is no manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-manifest-'));
    expect(readManifest(dir).size).toBe(0);
    const labelled = labelBundles([{ path: 'assets/Site-D5IdTWiH.js', name: 'assets/Site-D5IdTWiH.js', size: 1, gzip: 1 }], readManifest(dir));
    expect(labelled[0].name).toBe('assets/Site.js');
  });

  it('finds the files index.html makes the browser fetch first', () => {
    const assets = entryAssets(
      '<script type="module" crossorigin src="/assets/index-abc123.js"></script>' +
        '<link rel="modulepreload" href="/assets/vendor-def456.js">' +
        '<link rel="stylesheet" href="/assets/index-ghi789.css">' +
        '<link rel="icon" href="/favicon.svg">',
    );
    expect([...assets].sort()).toEqual(['assets/index-abc123.js', 'assets/index-ghi789.css', 'assets/vendor-def456.js']);
  });

  it('does not repeat a file that is listed twice', () => {
    expect(entryAssets('<script src="/assets/a-aaa111.js"></script><link rel="stylesheet" href="./assets/a-aaa111.js">').size).toBe(1);
  });

  it('passes a build that matches its baseline', () => {
    const result = evaluateBudget({
      files: [file('index.js', 100 * KB), file('AIView.js', 20 * KB)],
      entry: new Set(['assets/index.js']),
      baseline: baseline({ 'index.js': 100 * KB, 'AIView.js': 20 * KB }, { totalGzipBytes: 200 * KB, entryGzipBytes: 120 * KB, chunkGzipBytes: 150 * KB }),
      tolerancePercent: 10,
    });
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.entryGzip).toBe(100 * KB);
    expect(result.totalGzip).toBe(120 * KB);
  });

  it('fails a chunk past the tolerance, naming both numbers and the fix', () => {
    const result = evaluateBudget({
      files: [file('index.js', 100 * KB), file('AIView.js', 25 * KB)],
      entry: new Set(['assets/index.js']),
      baseline: baseline({ 'index.js': 100 * KB, 'AIView.js': 20 * KB }, {}),
      tolerancePercent: 10,
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('AIView.js grew to 25.0 KB from 20.0 KB');
    expect(result.problems[0]).toContain('--update');
  });

  it('lets a chunk grow inside the tolerance', () => {
    const result = evaluateBudget({
      files: [file('index.js', 109 * KB)],
      entry: new Set(['assets/index.js']),
      baseline: baseline({ 'index.js': 100 * KB }, {}),
      tolerancePercent: 10,
    });
    expect(result.problems).toEqual([]);
  });

  it('enforces the entry, per-chunk and total caps regardless of the baseline', () => {
    const files = [file('index.js', 300 * KB), file('AIView.js', 200 * KB)];
    const result = evaluateBudget({
      files,
      entry: new Set(['assets/index.js']),
      baseline: baseline({}, { totalGzipBytes: 400 * KB, entryGzipBytes: 250 * KB, chunkGzipBytes: 150 * KB }),
      tolerancePercent: 10,
    });
    expect(result.problems).toHaveLength(3);
    expect(result.problems.join(' ')).toContain('over the 400.0 KB cap');
    expect(result.problems.join(' ')).toContain('over the 250.0 KB cap');
    expect(result.problems.join(' ')).toContain('over the 150.0 KB per-chunk cap');
  });

  it('reports a new chunk and a vanished one without failing either', () => {
    const result = evaluateBudget({
      files: [file('index.js', 100 * KB), file('NewView.js', 10 * KB)],
      entry: new Set(['assets/index.js']),
      baseline: baseline({ 'index.js': 100 * KB, 'OldView.js': 12 * KB }, {}),
      tolerancePercent: 10,
    });
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual(['new: NewView.js (10.0 KB)', 'gone: OldView.js (was 12.0 KB)']);
  });
});

describe('collectBundles', () => {
  it('weighs JavaScript and CSS, ignores maps, and skips a missing folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundles-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'a'.repeat(500));
    writeFileSync(join(dir, 'assets', 'index-abc123.js.map'), 'b'.repeat(5000));
    writeFileSync(join(dir, 'assets', 'index-abc123.css'), 'c'.repeat(200));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    const found = collectBundles(dir);
    expect(found.map((entry) => entry.path).sort()).toEqual(['assets/index-abc123.css', 'assets/index-abc123.js']);
    expect(found.find((entry) => entry.path.endsWith('.js')).size).toBe(500);
    expect(collectBundles(join(dir, 'nope'))).toEqual([]);
  });
});
