/* Offline-Betrieb: Die App besteht nur aus statischen Dateien, deshalb reicht
   ein Cache, der beim Installieren gefüllt und bei jeder Version ersetzt wird.
   VERSION bei Änderungen an den Dateien hochzählen. */
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

// Netz zuerst, damit Änderungen sofort ankommen; offline greift der Cache.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  /* Alles Dynamische geht am Cache vorbei – vor allem /api/stream.
     Das ist ein endloser Server-Sent-Events-Strom: ihn zu klonen und in den
     Cache zu schreiben liest eine Antwort, die nie endet. Die Verbindung
     gehört dann dem Service Worker statt der Seite, überlebt jedes Neuladen
     und sammelt sich beim Server an, während die Ereignisse im Puffer
     hängen bleiben. */
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Nur vollständige, eigene Antworten sind es wert, gespeichert zu werden.
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
