// Mizan service worker: shows review-inbox notifications and keeps the app icon's badge count.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const jobs = [
    self.registration.showNotification(String(data.title || "Mizan"), {
      body: String(data.body || "Something in Mizan needs your attention."),
      icon: "/icons/192",
      badge: "/icons/192",
      tag: "mizan-review",
      renotify: true,
      data: { url: typeof data.url === "string" ? data.url : "/app/review" },
    }),
  ];
  if (typeof data.count === "number" && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(data.count).catch(() => {}));
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever open pages of this app.
  const target = new URL(event.notification.data?.url || "/app/review", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : new URL("/app/review", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
