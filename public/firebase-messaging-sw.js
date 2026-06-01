// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyDhLD7_h0EFJyY2cMfBHQGNckX7Jr-xysk',
  authDomain:        'boomrider-6b098.firebaseapp.com',
  projectId:         'boomrider-6b098',
  storageBucket:     'boomrider-6b098.firebasestorage.app',
  messagingSenderId: '495738557416',
  appId:             '1:495738557416:web:92ef59f5520af662a7ca5d',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, badge, image } = payload.notification || {};
  const data        = payload.data || {};
  const isNewOrder  = data.type === 'food' || data.type === 'parcel';
  const notifTitle  = title || 'BoomRider';

  const notifOptions = {
    body:      body  || 'มีการอัพเดทออเดอร์ของคุณ',
    icon:      icon  || '/icons/icon-192.png',
    badge:     badge || '/icons/badge-72.png',
    image,
    // Use a unique tag per order so each order shows its own notification
    tag:       data.orderId ? `order-${data.orderId}` : 'boomrider-bg',
    renotify:  true,
    // Pulse vibration for new orders: buzz–pause–buzz–pause–long buzz
    vibrate:   isNewOrder ? [200, 100, 200, 100, 400] : [200],
    data,
    actions: [
      { action: 'view',    title: '📋 ดูออเดอร์' },
      { action: 'dismiss', title: 'ปิด' },
    ],
  };
  self.registration.showNotification(notifTitle, notifOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
