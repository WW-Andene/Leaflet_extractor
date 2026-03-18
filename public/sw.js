// Minimal service worker for PWA install support
self.addEventListener("install", function() { self.skipWaiting(); });
self.addEventListener("activate", function(e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function(e) {
  // Pass through — no offline caching needed
  e.respondWith(fetch(e.request));
});
