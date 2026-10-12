const CACHE = "fx-journal-v1";
const CORE = [
  "./",
  "./index.html",
  "./login.html",
  "./db.html",
  "./style.css",
  "./login.css",
  "./app.js",
  "./auth.js",
  "./login.js",
  "./favicon.svg",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFont(url) {
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const hit = (await caches.match(req)) || (await caches.match("./index.html")) || (await caches.match("./login.html"));
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) {
    fetch(req).then((res) => {
      if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res));
    }).catch(() => {});
    return hit;
  }
  const res = await fetch(req);
  if (res && res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.endsWith("/server.js") || url.pathname.endsWith("/.env")) return;

  if (isFont(url)) {
    e.respondWith(cacheFirst(req).catch(() => caches.match(req)));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(cacheFirst(req));
});
