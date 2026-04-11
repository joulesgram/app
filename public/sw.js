/// <reference lib="webworker" />

// Bumped from v1 so the activate handler actually clears out the old cache,
// which contained stale HTML navigation responses (including user-specific
// /feed and /photo HTML, plus any 4xx/5xx that v1 happily stored).
const CACHE_NAME = "joulegram-v2";

// Only precache the manifest. Precaching "/" in v1 baked a stale home page
// into the cache on install, which could then be served after a deploy with
// references to chunk hashes that no longer exist.
const PRECACHE_URLS = ["/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up old caches (including joulegram-v1 on upgrade)
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip cross-origin requests (user photos on a CDN, Google Fonts, etc.)
  if (url.origin !== self.location.origin) return;

  // Never intercept HTML page navigations. v1 cached every navigation
  // response, which meant a single bad response (5xx, auth redirect,
  // stale HTML pointing at chunk hashes that no longer exist) could
  // get pinned in the cache and served to the user later. For a
  // dynamic, auth-gated app like Joulegram the browser's own navigation
  // handling is strictly safer.
  if (request.mode === "navigate") return;

  // Skip API routes, admin, and Next.js RSC payloads. RSC payloads are
  // fetched at the same URL as the page but with an RSC header or a
  // ?_rsc= query param, so we check both.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/admin")) return;
  if (request.headers.get("RSC") === "1") return;
  if (url.searchParams.has("_rsc")) return;

  // Cache-first for immutable assets: Next.js content-hashed bundles
  // and the PWA icon set. Hashed /_next/static/* URLs are safe by
  // construction (new hash = new URL). /icons/* only changes on deploy,
  // and a stale icon isn't a correctness issue.
  const isHashedNextAsset = url.pathname.startsWith("/_next/static/");
  const isPwaIcon = url.pathname.startsWith("/icons/");
  if (!isHashedNextAsset && !isPwaIcon) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful, same-origin, full responses. v1 would
        // happily cache a 500 and keep returning it forever.
        if (
          response &&
          response.ok &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .catch(() => {
              // Cache writes are best-effort; swallow quota errors.
            });
        }
        return response;
      });
    })
  );
});
