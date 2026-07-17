/* eslint-disable no-restricted-globals */

// Bump this string on every real deploy that should force a fresh cache.
// It doesn't need to match your app version exactly — it's purely a cache
// name, so any change here invalidates everything cached under the old
// name and forces a fresh fetch of every file.
const CACHE_VERSION = "ncbc-ball-v1";
const CACHE_NAME = "app-shell-" + CACHE_VERSION;

// Only cache the app shell itself — index.html plus whatever JS/CSS it
// references. We intentionally do NOT try to precache a fixed list of
// hashed bundle filenames here, since those change every deploy and this
// file would need updating every time too. Instead, we cache-on-fetch:
// whatever the browser successfully loads gets stored, and future offline
// loads serve from that cache.
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Only handle GET requests for our own origin — never intercept
  // Firestore's own network calls, since those need to reach the real
  // network (or fail fast) for Firestore's own offline handling to work
  // correctly. This service worker is strictly for the app SHELL, not
  // the live data inside it.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      // Network-first: always try the real network so a fresh deploy is
      // picked up immediately when online. Only fall back to whatever was
      // last cached if the network request genuinely fails (offline).
      fetch(req)
        .then(res => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cache.match(req).then(cached => cached || cache.match("/index.html")))
    )
  );
});