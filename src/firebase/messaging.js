import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingInstance } from './config';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

const LS_TOKEN    = 'boomrider_fcm_token';
const LS_TOKEN_TS = 'boomrider_fcm_token_ts';
const REFRESH_MS  = 7 * 24 * 60 * 60 * 1000; // 7 วัน

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
    if (import.meta.env.DEV) console.warn('[FCM] token error:', err?.code);
    return null;
  }
};

// ===== Save FCM Token to Firestore =====

export const saveFcmToken = async (userId, token) => {
  if (!token || !userId) return;
  try {
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const { db } = await import('./config');
    await setDoc(
      doc(db, 'users', userId),
      { fcmToken: token, fcmUpdatedAt: serverTimestamp() },
      { merge: true },
    );
    // บันทึก timestamp ล่าสุดที่ save ลง Firestore
    localStorage.setItem(LS_TOKEN,    token);
    localStorage.setItem(LS_TOKEN_TS, String(Date.now()));
  } catch (_) {}
};

// ===== Auto-refresh FCM Token =====
// เรียกได้บ่อย — จะ skip ถ้า token ยังไม่ถึง 7 วัน และไม่ได้เปลี่ยน
// ไม่ขอ permission ซ้ำ — เรียกเฉพาะเมื่อ permission เป็น 'granted' อยู่แล้ว

export const refreshFcmTokenIfNeeded = async (userId) => {
  if (!userId) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const lastTs    = parseInt(localStorage.getItem(LS_TOKEN_TS) || '0', 10);
  const lastToken = localStorage.getItem(LS_TOKEN) || '';
  const now       = Date.now();

  // ยังไม่ถึง 7 วัน และมี token เก่าอยู่แล้ว → skip
  if (lastTs && lastToken && (now - lastTs) < REFRESH_MS) return;

  const messaging = await getMessagingInstance();
  if (!messaging) return;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return;

    // token เปลี่ยน หรือ ยังไม่เคย save → save ลง Firestore
    if (token !== lastToken) {
      await saveFcmToken(userId, token);
    } else {
      // token เหมือนเดิม — แค่ update timestamp ใน localStorage
      localStorage.setItem(LS_TOKEN_TS, String(now));
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[FCM] refresh failed:', err?.code);
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
