/* Build replaces this manifest. Optional hand assets are cached on demand. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const HAND_ASSETS = __HAND_ASSETS__;
const scope = self.registration.scope;
const PREFIX = `tenohira-${new URL(scope).pathname}-`;
const CACHE = `${PREFIX}${VERSION}`;
const OPTIONAL = `${PREFIX}hands-v1`;
const local = (path) => new URL(path, scope).href;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(local))));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE && key !== OPTIONAL)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CACHE_HANDS')
    event.waitUntil(
      caches.open(OPTIONAL).then(async (cache) => {
        for (const path of HAND_ASSETS) {
          const url = local(path);
          if (!(await cache.match(url))) {
            try {
              await cache.add(url);
            } catch {
              /* Network or quota: the app remains usable. */
            }
          }
        }
      }),
    );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.href.startsWith(scope)
  )
    return;
  event.respondWith(
    (async () => {
      if (event.request.mode === 'navigate')
        return (await caches.open(CACHE))
          .match(local('index.html'))
          .then((hit) => hit || fetch(event.request));
      const optional = url.pathname.includes('/mediapipe/');
      const cache = await caches.open(optional ? OPTIONAL : CACHE);
      // Some servers answer with "Vary: Origin"; the precached copy is still the right one.
      const hit = await cache.match(event.request, { ignoreVary: true });
      if (hit) return hit;
      const response = await fetch(event.request);
      if (response.ok && optional) {
        try {
          await cache.put(event.request, response.clone());
        } catch {
          /* Optional cache may exceed storage quota. */
        }
      }
      return response;
    })(),
  );
});
