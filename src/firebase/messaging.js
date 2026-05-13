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

// ===== Save FCM Token to user profile =====
// เรียกหลัง login สำเร็จ เพื่อ store token สำหรับส่ง push notification

export const saveFcmToken = async (userId, token) => {
  if (!token || !userId) return;
  // When Firestore is added: save token to users/{userId}/fcmToken
  // For now: store in localStorage as fallback
  try {
    const existing = JSON.parse(localStorage.getItem('boomrider_fcm_tokens') || '{}');
    existing[userId] = token;
    localStorage.setItem('boomrider_fcm_tokens', JSON.stringify(existing));
  } catch (_) {}
};
