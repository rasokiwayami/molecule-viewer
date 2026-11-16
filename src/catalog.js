import { parseSDF } from './sdf.js';
import { CONFIG, assetURL } from './config.js';
export const ALIASES = {
  'vitamin-c': ['アスコルビン酸', 'vitamin c'],
  adrenaline: ['エピネフリン'],
  oseltamivir: ['タミフル'],
  sucrose: ['砂糖', 'ショ糖'],
  glucose: ['ブドウ糖', '葡萄糖'],
  'acetic-acid': ['お酢', '酢'],
  ethanol: ['アルコール'],
  fullerene: ['フラーレン', 'c60'],
  'beta-carotene': ['ベータカロテン', 'ベータカロチン'],
  water: ['水分子'],
};
export function normalizeName(s) {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\sーｰ\-‐–・]/g, '');
}
const names = (item) => [item.ja, item.en, item.id, ...(ALIASES[item.id] || [])].map(normalizeName);
export function matchCatalog(items, query) {
  const q = normalizeName(query);
  if (!q) return items;
  return items
    .map((item, index) => {
      const ns = names(item);
      const rank = ns.some((n) => n === q)
        ? 0
        : ns.some((n) => n.startsWith(q))
          ? 1
          : ns.some((n) => n.includes(q))
            ? 2
            : 3;
      return { item, rank, index };
    })
    .filter((x) => x.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}
export const exactMatch = (items, query) =>
  items.find((item) => names(item).includes(normalizeName(query)));
export class SearchError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}
export const SEARCH_MESSAGES = {
  missing: '見つかりませんでした',
  structure: 'この物質には立体構造のデータがありません',
  network: '通信できませんでした',
};
async function get(url, signal, type = 'json') {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new SearchError(r.status === 404 ? 'missing' : 'network');
  return r[type]();
}
export async function loadCatalog() {
  return get(assetURL('data/index.json'));
}
const builtins = new Map(),
  external = new Map();
export async function loadBuiltin(item) {
  if (!builtins.has(item.id))
    builtins.set(
      item.id,
      get(assetURL(`data/${item.id}.sdf`), undefined, 'text')
        .then(parseSDF)
        .catch((e) => {
          builtins.delete(item.id);
          throw e;
        }),
    );
  return { ...item, structure: await builtins.get(item.id) };
}
const PUB = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
async function fromCID(cid, label, signal) {
  let sdf;
  try {
    sdf = await get(`${PUB}/compound/cid/${cid}/SDF?record_type=3d`, signal, 'text');
  } catch (e) {
    if (e.kind === 'missing') throw new SearchError('structure');
    throw e;
  }
  const data = await get(
    `${PUB}/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`,
    signal,
  );
  const p = data.PropertyTable?.Properties?.[0];
  if (!p) throw new SearchError('missing');
  let structure;
  try {
    structure = parseSDF(sdf);
  } catch {
    throw new SearchError('structure');
  }
  return {
    id: `cid-${cid}`,
    cid,
    ja: label,
    en: p.IUPACName || label,
    formula: p.MolecularFormula,
    weight: p.MolecularWeight,
    structure,
  };
}
export async function searchExternal(query) {
  const key = normalizeName(query);
  if (external.has(key)) return external.get(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.searchTimeout);
  const signal = controller.signal;
  try {
    let result;
    if (/^[\x20-\x7e]+$/.test(query)) {
      try {
        const ids = await get(
          `${PUB}/compound/name/${encodeURIComponent(query)}/cids/JSON`,
          signal,
        );
        result = await fromCID(ids.IdentifierList.CID[0], query, signal);
      } catch (e) {
        if (e.kind !== 'missing') throw e;
      }
    }
    if (!result) {
      const base = 'https://www.wikidata.org/w/api.php?origin=*&format=json';
      const found = await get(
        `${base}&action=wbsearchentities&language=ja&limit=5&search=${encodeURIComponent(query)}`,
        signal,
      );
      if (!found.search?.length) throw new SearchError('missing');
      const ids = found.search.map((x) => x.id).join('|');
      const data = await get(
        `${base}&action=wbgetentities&props=claims&ids=${encodeURIComponent(ids)}`,
        signal,
      );
      const cids = found.search
        .flatMap((x) =>
          (data.entities?.[x.id]?.claims?.P662 || []).map((c) => ({
            cid: c.mainsnak?.datavalue?.value,
            label: x.label,
          })),
        )
        .filter((x) => /^\d+$/.test(x.cid));
      if (!cids.length) throw new SearchError('missing');
      for (const c of cids) {
        try {
          result = await fromCID(c.cid, c.label, signal);
          break;
        } catch (e) {
          if (!['missing', 'structure'].includes(e.kind)) throw e;
        }
      }
      if (!result) throw new SearchError('structure');
    }
    external.set(key, result);
    return result;
  } catch (e) {
    throw e instanceof SearchError ? e : new SearchError('network');
  } finally {
    clearTimeout(timer);
  }
}
