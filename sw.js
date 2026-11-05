/* App shell cache: the screens open even without internet; data always comes from the server. */
const V = "minzo-shell-v12";
const SHELL = ["./", "index.html", "css/app.css", "css/live.css", "js/config.js", "js/app.js", "js/mzprint.js", "js/mzpdf.js", "js/ops1.js", "js/ops2.js", "js/ops3.js", "js/ops4.js", "js/vendor/qrcode.js", "js/vendor/supabase.js", "js/vendor/xlsx.full.min.js", "icon.svg", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;           // Supabase & fonts go to the network
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
