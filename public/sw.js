/*
 * SDAK Church Manager service worker.
 *
 * - App assets (/_next/static, icons) are cache-first.
 * - Pages a user has opened (dashboard, members, ministries, families, /me)
 *   are network-first and kept for up to 7 days so they can be read offline.
 *   They hold personal data, so the cache is cleared on sign-out.
 * - API calls, server actions and RSC requests always go to the network.
 */
const VERSION = "v1";
const STATIC = `sdak-static-${VERSION}`;
const PAGES = "sdak-pages";
const OFFLINE_URL = "/offline";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 200;
const CACHEABLE = [/^\/dashboard$/, /^\/members(\/[^/]+(\/edit)?)?$/, /^\/ministries(\/[^/]+)?$/, /^\/families(\/[^/]+)?$/, /^\/me$/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE_URL, "/sda-logo.png", "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sdak-static-") && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-pages") event.waitUntil(caches.delete(PAGES));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k);
}

async function networkFirstPage(request, url) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected && CACHEABLE.some((re) => re.test(url.pathname))) {
      const headers = new Headers(res.headers);
      headers.set("x-sdak-cached-at", String(Date.now()));
      const body = await res.clone().blob();
      await cache.put(request, new Response(body, { status: res.status, statusText: res.statusText, headers }));
      trim(cache);
    }
    if (res.redirected && new URL(res.url).pathname.startsWith("/login")) await caches.delete(PAGES);
    return res;
  } catch {
    const hit = (await cache.match(request)) || (await cache.match(url.pathname, { ignoreSearch: true }));
    if (hit && Date.now() - Number(hit.headers.get("x-sdak-cached-at") || 0) < MAX_AGE_MS) return hit;
    return (await caches.match(OFFLINE_URL)) || new Response("Offline", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) c.put(request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (request.mode === "navigate") event.respondWith(networkFirstPage(request, url));
});
