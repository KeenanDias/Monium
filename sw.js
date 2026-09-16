/* Monium service worker.

   Deliberately minimal. The only reason it exists is that iOS won't treat the
   page as installable without one, and an over-eager cache would mean people
   keep seeing an old build after a deploy.

   Bump CACHE on every release that changes a shell file. */
const CACHE = "monium-v1";

const SHELL = [
  "/app.html",
  "/manifest.json",
  "/css/app.css",
  "/js/config.js",
  "/js/supabase.js",
  "/js/api.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  // addAll fails the whole install if any one file 404s, so tolerate misses
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GETs are cacheable, and financial data must never be served stale -
  // let API and auth traffic go straight to the network, untouched.
  if (
    req.method !== "GET" ||
    req.url.includes("execute-api") ||
    req.url.includes("supabase") ||
    req.url.includes("plaid.com")
  ) {
    return;
  }

  // Network-first: always try for fresh code, fall back to cache when offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("/app.html"))
      )
  );
});
