/* eslint-disable no-restricted-globals */
// JF Effect — Web Push handlers.
// Loaded by the Workbox-generated /sw.js via `importScripts: ['/push-sw.js']`
// so we share ONE service worker with the offline shell.

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: event.data && event.data.text() }; }

  const title = payload.title || 'JF Effect';
  const opts = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || undefined,        // collapses same-tag notifications
    renotify: !!payload.renotify,
    requireInteraction: !!payload.requireInteraction,
    data: { url: payload.url || '/', ...(payload.data || {}) },
    actions: payload.actions || [],
    silent: !!payload.silent,
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    // Best-effort app icon badge update (supported on installed PWAs)
    try {
      if (typeof payload.badgeCount === 'number' && 'setAppBadge' in self.navigator) {
        await self.navigator.setAppBadge(payload.badgeCount);
      }
    } catch {}
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus an existing tab if we already have one
    for (const client of allClients) {
      try {
        const u = new URL(client.url);
        if (u.origin === self.location.origin) {
          await client.focus();
          try { client.navigate(url); } catch {}
          return;
        }
      } catch {}
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Browser rotated the endpoint. Tell our backend so it can clean up.
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.getSubscription();
      await fetch('/api/public/push/subscription-change', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          oldEndpoint: event.oldSubscription && event.oldSubscription.endpoint,
          newSubscription: sub ? sub.toJSON() : null,
        }),
        keepalive: true,
      });
    } catch {}
  })());
});