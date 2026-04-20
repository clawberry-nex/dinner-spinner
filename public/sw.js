// Minimal hand-rolled service worker for Dinner Spinner.
//
// Goals:
//   - Precache the app shell (spinner, /dishes, offline fallback, icons).
//   - Cache dish detail pages + /api/dishes/:id JSON on the way through,
//     so "recently viewed" dishes stay readable offline.
//   - Stale-while-revalidate for /_next/static immutable assets.
//
// Bump CACHE_VERSION whenever the precache list or strategy changes; the
// activate handler purges old caches.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `dinner-spinner-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `dinner-spinner-runtime-${CACHE_VERSION}`;
const STATIC_CACHE = `dinner-spinner-static-${CACHE_VERSION}`;

const SHELL_URLS = [
  "/",
  "/dishes",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Use addAll with { cache: "reload" } so we bypass HTTP cache on install.
      Promise.all(
        SHELL_URLS.map((url) =>
          fetch(url, { cache: "reload" })
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

function isSameOrigin(url) {
  return new URL(url, self.location.origin).origin === self.location.origin;
}

function isNavigation(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"))
  );
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
  return fresh;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached || network || fetch(request);
}

async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match("/offline");
    if (shell) return shell;
    return caches.match("/") || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!isSameOrigin(request.url)) return;

  const url = new URL(request.url);

  // Never cache the admin surface or auth endpoints.
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/auth")) {
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Dish JSON: /api/dishes and /api/dishes/:id — network-first, cache GETs.
  if (url.pathname.startsWith("/api/dishes")) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // Tag / pantry defaults: small, cacheable.
  if (
    url.pathname === "/api/tags" ||
    url.pathname === "/api/pantry-defaults" ||
    url.pathname === "/api/ingredient-names"
  ) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Fonts + other cacheable static assets.
  if (request.destination === "font" || request.destination === "image") {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
});
