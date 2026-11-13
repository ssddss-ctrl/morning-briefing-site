const CACHE = "morning-brief-v14-gita";
const STATIC = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./audio-player.js",
  "./missed.js",
  "./talk.js",
  "./talk-worklet.js",
  "./notify.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];
// GitHub Pages lets browsers reuse files for 10 minutes. Always revalidate instead,
// so a new version shows on the next open (unchanged files are a quick 304).
self.addEventListener("install", (e) => {
  self.skipWaiting(); // A new version takes over right away.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(STATIC.map((url) => new Request(url, { cache: "reload" })))),
  );
});
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (
    u.origin !== self.location.origin ||
    u.pathname.includes("/data/") ||
    u.pathname.includes("/audio_samples/") ||
    u.pathname.split("/").some((p) => p.startsWith("."))
  )
    return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((response) => {
        // Keep the offline copy current.
        if (response.ok) caches.open(CACHE).then((c) => c.put(e.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(e.request)),
  );
});

// Morning alert sent by the daily workflow after a new edition is published.
self.addEventListener("push", (e) => {
  let message = {};
  try {
    message = e.data ? e.data.json() : {};
  } catch {}
  e.waitUntil(
    self.registration.showNotification(message.title || "Your morning briefing is ready", {
      body: message.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: "morning-briefing",
      data: { url: message.url || self.registration.scope },
    }),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      return open ? open.focus().then((c) => c.navigate(url)) : clients.openWindow(url);
    }),
  );
});
