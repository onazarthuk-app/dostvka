// The Logistics · Доставка — service worker
// 1) програма відкривається без інтернету  2) push-сповіщення через Firebase Cloud Messaging
const CACHE = "tl-v1";
const CORE = ["./", "index.html", "manifest.webmanifest", "favicon.ico", "favicon-32.png", "favicon-16.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"];

try {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
  );
  firebase.initializeApp({
    apiKey: "AIzaSyB9Um5j6A1TlrTheFkkT4z6PgZF4RWZcJE",
    authDomain: "dostavka-ed553.firebaseapp.com",
    databaseURL: "https://dostavka-ed553-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "dostavka-ed553",
    storageBucket: "dostavka-ed553.firebasestorage.app",
    messagingSenderId: "751957678408",
    appId: "1:751957678408:web:5d2b2faf507d16691a7b7d"
  });
  firebase.messaging();   // повідомлення з полем notification показуються автоматично
} catch (e) { /* без мережі при першому встановленні — push підключиться пізніше */ }

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // база, вхід і карти — завжди напряму
  if (/firebaseio\.com|firebasedatabase\.app|identitytoolkit|securetoken|tile\.openstreetmap/.test(url.hostname + url.pathname)) return;

  // сама сторінка: спершу мережа (щоб отримати оновлення), без мережі — збережена копія
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("index.html", cp)); return r; })
        .catch(() => caches.match("index.html").then(r => r || caches.match("./")))
    );
    return;
  }
  // бібліотеки, шрифти, іконки: з кешу, у фоні оновлюємо
  const cacheable = url.origin === self.location.origin || /gstatic\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname);
  if (!cacheable) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => {
      if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const c = list.find(w => "focus" in w);
    return c ? c.focus() : self.clients.openWindow("./");
  }));
});
