/* Offline-Betrieb: Die App besteht nur aus statischen Dateien, deshalb reicht
   ein Cache, der beim Installieren gefüllt und bei jeder Version ersetzt wird.
   VERSION bei Änderungen an den Dateien hochzählen. */
const VERSION = "voco-v1";
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

// Netz zuerst, damit Änderungen sofort ankommen; offline greift der Cache.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
