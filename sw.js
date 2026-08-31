/* Offline use: the app is nothing but static files, so a cache that is filled
   on install and replaced with every version is enough.
   Bump VERSION whenever the files change. */
const VERSION = "voco-v4";
const ASSETS = [
  ".",
  "index.html",
  "manifest.webmanifest",
  "src/style.css",
  "src/deck.js",
  "src/srs.js",
  "src/conjugate.js",
  "src/grammar.js",
  "src/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so changes arrive immediately; offline the cache steps in.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  /* Everything dynamic bypasses the cache - above all /api/stream.
     That one is an endless server-sent-events stream: cloning it and writing
     it to the cache reads a response that never ends. The connection then
     belongs to the service worker instead of the page, survives every reload
     and piles up on the server while the events sit in the buffer. */
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Only complete, same-origin responses are worth storing.
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
