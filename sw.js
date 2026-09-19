// Second Brain service worker: the app shell and notes are network-first (fresh when online,
// cached for offline); past-paper pages and fonts/libraries are cache-first.
const VERSION = "0429e2563bdb";
const SHELL = `sb-shell-${VERSION}`, PAPERS = "sb-papers-v1", LIBS = "sb-libs-v1";
const PRECACHE = ["./", "index.html", "data.bin", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
const LIB_URLS = ["https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js", "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js", "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Geist:wght@400;500;600&family=Unbounded:wght@500;600&display=swap"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(PRECACHE);
    const libs = await caches.open(LIBS);
    for (const url of LIB_URLS) {
      try {
        if (await libs.match(url)) continue;
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) continue;
        await libs.put(url, res.clone());
        if (url.includes("fonts.googleapis.com")) {
          const css = await res.text();
          const files = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
          await Promise.all(files.map(f => fetch(f, { mode: "cors" }).then(r => r.ok && libs.put(f, r)).catch(() => {})));
        }
      } catch (e) { /* offline during install: picked up on the next visit */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("sb-shell-") && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000))]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(url.pathname.includes("/papers/") ? cacheFirst(req, PAPERS) : networkFirst(req));
  } else if (/(^|\.)(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    event.respondWith(cacheFirst(req, LIBS));
  }
});
