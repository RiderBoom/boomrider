import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingInstance } from './config';

// VAPID key จาก Firebase Console > Cloud Messaging > Web Push certificates
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// ===== Request Notification Permission & Get FCM Token =====

export const requestNotificationPermission = async () => {
  const messaging = await getMessagingInstance();
  if (!messaging) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    return token;
  } catch (err) {
    console.warn('FCM token error:', err);
    return null;
  }
};

// ===== Foreground Message Listener =====

export const onForegroundMessage = async (callback) => {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    callback({
      title: payload.notification?.title || 'BoomRider',
      body:  payload.notification?.body  || '',
      data:  payload.data || {},
    });
  });
};

// ===== Save FCM Token to Firestore =====
// เรียกหลัง login สำเร็จ — เก็บ token ไว้ใน users/{userId} เพื่อให้
// Cloud Function onOrderCreated ดึงไปส่ง push notification ได้

export const saveFcmToken = async (userId, token) => {
  if (!token || !userId) return;
  try {
    // Lazy-import to avoid circular dep with config
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const { db } = await import('./config');
    await setDoc(
      doc(db, 'users', userId),
      { fcmToken: token, fcmUpdatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (_) {}
};
