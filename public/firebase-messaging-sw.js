// Firebase Cloud Messaging Service Worker
// ไฟล์นี้ต้องอยู่ที่ root ของ public เพื่อให้ Firebase หาเจอ

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ใส่ config เดียวกับ src/firebase/config.js
firebase.initializeApp({
  apiKey:            self.__FIREBASE_API_KEY__            || '',
  authDomain:        self.__FIREBASE_AUTH_DOMAIN__        || '',
  projectId:         self.__FIREBASE_PROJECT_ID__         || '',
  storageBucket:     self.__FIREBASE_STORAGE_BUCKET__     || '',
  messagingSenderId: self.__FIREBASE_MESSAGING_SENDER_ID__ || '',
  appId:             self.__FIREBASE_APP_ID__             || '',
});

const messaging = firebase.messaging();

// Background message handler
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, badge, image } = payload.notification || {};
  const notifTitle = title || 'BoomRider';
  const notifOptions = {
    body:  body  || 'มีการอัพเดทออเดอร์ของคุณ',
    icon:  icon  || '/icons/icon-192.png',
    badge: badge || '/icons/badge-72.png',
    image,
    tag: 'boomrider-bg',
    renotify: true,
    data: payload.data || {},
    actions: [
      { action: 'view', title: 'ดูออเดอร์' },
      { action: 'dismiss', title: 'ปิด' },
    ],
  };

  self.registration.showNotification(notifTitle, notifOptions);
});

// Notification click
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
