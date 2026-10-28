/* Static fallback Service Worker for Firebase Cloud Messaging (overridden dynamically by /firebase-messaging-sw.js server route) */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'Finesteride Recur 1Mg Admin', body: event.data.text() } };
  }
  const notification = payload.notification || payload.data || {};
  const title = notification.title || 'Finesteride Recur 1Mg Admin Alert';
  const options = {
    body: notification.body || 'New pharmacy administrative update received.',
    data: payload.data || {},
    tag: notification.tag || 'pharmacy-admin-push',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return undefined;
    })
  );
});
