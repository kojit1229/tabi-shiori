// sw.js — アプリシェルのキャッシュ(tabi-shiori-v1)。更新時はバージョンを必ず+1する
const CACHE = "tabi-shiori-v1";
const ASSETS = [
  "./", "./index.html", "./css/base.css", "./css/components.css",
  "./js/app.js", "./js/store.js", "./js/github.js", "./js/sync.js",
  "./js/modal.js", "./js/ui-shelf.js", "./js/ui-itinerary.js",
  "./js/ui-packing.js", "./js/ui-settings.js", "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// アプリシェルはキャッシュ優先、API(api.github.com)は常にネットワーク直行
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
