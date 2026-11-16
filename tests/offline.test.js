import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

it('service worker caches the core, keeps hand downloads optional, and serves offline navigation', async () => {
  const handlers = {},
    stores = new Map(),
    downloads = [];
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      addAll: async (urls) => {
        for (const url of urls) {
          downloads.push(url);
          data.set(url, `cached:${url}`);
        }
      },
      add: async (url) => {
        downloads.push(url);
        data.set(url, `cached:${url}`);
      },
      match: async (request) => data.get(typeof request === 'string' ? request : request.url),
      put: async (request, response) => data.set(request.url, response),
    };
  };
  const caches = {
    open: async (name) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const scope = 'https://example.test/demo/';
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace('__VERSION__', 'test')
    .replace('__PRECACHE__', JSON.stringify(['index.html', 'data/index.json', 'data/water.sdf']))
    .replace('__HAND_ASSETS__', JSON.stringify(['mediapipe/hand_landmarker.task']));
  vm.runInNewContext(source, {
    URL,
    caches,
    self: {
      registration: { scope },
      location: { origin: 'https://example.test' },
      clients: { claim: async () => {} },
      addEventListener: (type, fn) => (handlers[type] = fn),
    },
    fetch: async () => {
      throw new Error('offline');
    },
  });
  async function lifetime(type, event = {}) {
    let pending;
    handlers[type]({ ...event, waitUntil: (p) => (pending = p) });
    await pending;
  }
  await lifetime('install');
  expect(downloads).toHaveLength(3);
  expect(downloads.some((url) => url.includes('mediapipe'))).toBe(false);
  stores.set('tenohira-/other/-old', new Map());
  await lifetime('activate');
  expect(stores.has('tenohira-/other/-old')).toBe(true);
  let response;
  handlers.fetch({
    request: { url: scope + '?m=water', method: 'GET', mode: 'navigate' },
    respondWith: (p) => (response = p),
  });
  expect(await response).toBe(`cached:${scope}index.html`);
  handlers.fetch({
    request: { url: scope + 'data/water.sdf', method: 'GET', mode: 'cors' },
    respondWith: (p) => (response = p),
  });
  expect(await response).toBe(`cached:${scope}data/water.sdf`);
  let intercepted = false;
  handlers.fetch({
    request: { url: 'https://pubchem.ncbi.nlm.nih.gov/example', method: 'GET' },
    respondWith: () => (intercepted = true),
  });
  expect(intercepted).toBe(false);
  await lifetime('message', { data: { type: 'CACHE_HANDS' } });
  expect(downloads.at(-1)).toBe(scope + 'mediapipe/hand_landmarker.task');
  await lifetime('message', { data: { type: 'CACHE_HANDS' } });
  expect(downloads).toHaveLength(4);
});
