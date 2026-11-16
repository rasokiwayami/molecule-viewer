import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSDF } from '../src/sdf.js';
import { matchCatalog, exactMatch, normalizeName, searchExternal } from '../src/catalog.js';
import { BLURBS } from '../src/blurbs.js';
import { NOTES } from '../src/notes.js';
import { OneEuroFilter, pinchState } from '../src/hands.js';
const catalog = JSON.parse(readFileSync(new URL('../public/data/index.json', import.meta.url)));
const load = (id) =>
  parseSDF(readFileSync(new URL(`../public/data/${id}.sdf`, import.meta.url), 'utf8'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('SDF', () => {
  it('caffeine has 24 atoms and 25 bonds', () => {
    const m = load('caffeine');
    expect(m.atoms).toHaveLength(24);
    expect(m.bonds).toHaveLength(25);
  });
  it('fullerene has 60 atoms, 90 bonds, 30 double bonds', () => {
    const m = load('fullerene');
    expect(m.atoms).toHaveLength(60);
    expect(m.bonds).toHaveLength(90);
    expect(m.bonds.filter((b) => b.order === 2)).toHaveLength(30);
  });
  it('all 40 structures and blurbs are present', () => {
    expect(catalog).toHaveLength(40);
    for (const c of catalog) {
      expect(load(c.id).atoms.length).toBeGreaterThan(0);
      expect(BLURBS[c.id]).toBeTruthy();
      expect(NOTES[c.id]).toHaveLength(2);
    }
  });
  it('rejects unsupported, truncated and corrupt records', () => {
    expect(() => parseSDF('bad')).toThrow();
    const source = readFileSync(new URL('../public/data/caffeine.sdf', import.meta.url), 'utf8');
    expect(() => parseSDF(source.replace('V2000', 'V3000'))).toThrow();
    expect(() => parseSDF(source.split('\n').slice(0, 6).join('\n'))).toThrow();
  });
});
describe('names', () => {
  it.each([
    ['かふぇいん', 'caffeine'],
    ['カフェイン', 'caffeine'],
    ['caffeine', 'caffeine'],
    ['ＣＡＦＦＥＩＮＥ', 'caffeine'],
    ['ビタミンc', 'vitamin-c'],
    ['タミフル', 'oseltamivir'],
    ['アスコルビン酸', 'vitamin-c'],
    ['アルコール', 'ethanol'],
    ['ぶどう糖', 'glucose'],
  ])('%s resolves to %s', (q, id) => {
    expect(matchCatalog(catalog, q)[0]?.id).toBe(id);
    expect(exactMatch(catalog, q)?.id).toBe(id);
  });
  it('normalizes kana, long vowels and spaces', () => {
    expect(normalizeName('えた のーる')).toBe(normalizeName('エタノル'));
    expect(matchCatalog(catalog, 'フェイン')[0].id).toBe('caffeine');
  });
  it('does not match unrelated input', () => expect(matchCatalog(catalog, 'zzzz')).toEqual([]));
});
describe('external failure paths', () => {
  it('reports offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(searchExternal('offline-test')).rejects.toMatchObject({ kind: 'network' });
  });
  it('reports absent 3D separately', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ IdentifierList: { CID: [1] } })))
        .mockResolvedValueOnce(new Response('', { status: 404 })),
    );
    await expect(searchExternal('salt-test')).rejects.toMatchObject({ kind: 'structure' });
  });
  it('reports no name match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ search: [] }))));
    await expect(searchExternal('存在しない物質')).rejects.toMatchObject({ kind: 'missing' });
  });
  it('aborts at five seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url, { signal }) =>
          new Promise((resolve, reject) =>
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const pending = expect(searchExternal('timeout-test')).rejects.toMatchObject({
      kind: 'network',
    });
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  });
});
describe('gesture stability', () => {
  it('uses hysteresis', () => {
    expect(pinchState(0.24, false)).toBe(true);
    expect(pinchState(0.3, false)).toBe(false);
    expect(pinchState(0.3, true)).toBe(true);
    expect(pinchState(0.36, true)).toBe(false);
  });
  it('starts the filter at the observed position', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.5, 0)).toBe(0.5);
    expect(f.filter(0.8, 50)).toBeGreaterThan(0.5);
    expect(f.value).toBeLessThan(0.8);
  });
});

describe('external success paths', () => {
  it('reuses the fetched structure for the same normalized name', async () => {
    const sdf = readFileSync(new URL('../public/data/water.sdf', import.meta.url), 'utf8');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ IdentifierList: { CID: [962] } })))
      .mockResolvedValueOnce(new Response(sdf))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            PropertyTable: {
              Properties: [
                { MolecularFormula: 'H2O', MolecularWeight: '18.015', IUPACName: 'water' },
              ],
            },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const first = await searchExternal('unique-test-water');
    const second = await searchExternal('UNIQUE TEST WATER');
    expect(first.structure.atoms).toHaveLength(3);
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('follows a Japanese Wikidata result through its P662 CID', async () => {
    const sdf = readFileSync(new URL('../public/data/water.sdf', import.meta.url), 'utf8');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ search: [{ id: 'Q1', label: '試験用の水' }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: { Q1: { claims: { P662: [{ mainsnak: { datavalue: { value: '962' } } }] } } },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(sdf))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            PropertyTable: {
              Properties: [
                { MolecularFormula: 'H2O', MolecularWeight: '18.015', IUPACName: 'water' },
              ],
            },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const item = await searchExternal('試験用の水');
    expect(item.cid).toBe('962');
    expect(fetch.mock.calls[0][0]).toContain('language=ja');
    expect(fetch.mock.calls[0][0]).toContain('origin=*');
  });
});
