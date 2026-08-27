// ===== Utility Functions =====

export const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** ปัดเศษทศนิยม 2 ตำแหน่ง — ป้องกัน floating-point artifact ในยอดกระเป๋าเงิน */
export const r2 = (n) => Math.round((n ?? 0) * 100) / 100;

const _pad = n => String(n).padStart(2, '0');
const _fmt = (d) => `${_pad(d.getDate())}/${_pad(d.getMonth()+1)}/${d.getFullYear()} ${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;

export const formatDateTime = () => _fmt(new Date());
export const formatDateTimeFromMs = (ms) => _fmt(new Date(Number(ms)));

/**
 * แปลงค่าวันที่ในรูปแบบต่างๆ (number ms, ISO string, DD/MM/YYYY HH:mm:ss string) เป็น epoch milliseconds (ms)
 * @param {any} dateVal
 * @returns {number} epoch ms หรือ NaN หากไม่สามารถแปลงได้
 */
export const parseDateMs = (dateVal) => {
  if (dateVal === null || dateVal === undefined || dateVal === '') return NaN;
  if (typeof dateVal === 'number') return dateVal;
  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    const parts = trimmed.split(' ');
    if (parts.length >= 1) {
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        const [d, m, y] = dateParts.map(Number);
        if (d > 0 && d <= 31 && m > 0 && m <= 12 && y >= 2000) {
          let hh = 0, mm = 0, ss = 0;
          if (parts[1]) {
            const timeParts = parts[1].split(':').map(Number);
            hh = timeParts[0] || 0;
            mm = timeParts[1] || 0;
            ss = timeParts[2] || 0;
          }
          return new Date(y, m - 1, d, hh, mm, ss).getTime();
        }
      }
    }
    const isoFormatted = trimmed.includes(' ') && !trimmed.includes('T') ? trimmed.replace(' ', 'T') : trimmed;
    const parsedIso = new Date(isoFormatted).getTime();
    if (!isNaN(parsedIso)) return parsedIso;
  }
  const t = new Date(dateVal).getTime();
  if (!isNaN(t)) return t;
  return NaN;
};

/**
 * ตรวจสอบว่าวันที่สองค่าเป็นวันเดียวกันใน Local Timezone หรือไม่
 * @param {any} dateVal1
 * @param {any} dateVal2
 * @returns {boolean}
 */
export const isSameDay = (dateVal1, dateVal2) => {
  const ms1 = parseDateMs(dateVal1);
  const ms2 = parseDateMs(dateVal2);
  if (isNaN(ms1) || isNaN(ms2)) return false;
  const d1 = new Date(ms1);
  const d2 = new Date(ms2);
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
};

/**
 * บีบอัดรูปภาพผ่าน Canvas ก่อนเก็บ — คืนค่า base64 ขนาดเล็ก
 * @param {File} file         — ไฟล์รูปจาก <input type="file">
 * @param {number} maxWidth   — ความกว้างสูงสุด (px)
 * @param {number} maxHeight  — ความสูงสูงสุด (px)
 * @param {number} quality    — คุณภาพ JPEG 0–1
 * @returns {Promise<string>} — base64 data URL ที่บีบแล้ว
 */
export const compressImage = (file, maxWidth = 800, maxHeight = 600, quality = 0.75) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // คำนวณขนาดใหม่โดยรักษา aspect ratio
      let w = img.width;
      let h = img.height;
      if (w > maxWidth)  { h = Math.round(h * maxWidth / w);  w = maxWidth; }
      if (h > maxHeight) { w = Math.round(w * maxHeight / h); h = maxHeight; }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = reject;
    img.src = objectUrl;
  });

/**
 * สั่งให้เครื่องสั่นตาม pattern (รองรับมือถือ)
 * @param {number[]} pattern
 */
export const vibrateDevice = (pattern = [300, 100, 300, 100, 400]) => {
  try {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch { void 0; }
};

/**
 * เล่นเสียงแจ้งเตือนผ่าน Web Audio API (ไม่ต้องใช้ไฟล์เสียง) พร้อมสั่นเครื่อง
 * @param {'order'|'rider'|'success'} type
 */
export const playNotificationSound = (type = 'order') => {
  vibrateDevice(type === 'rider' || type === 'order' ? [400, 150, 400, 150, 600] : [200, 100, 200]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const patterns = {
      order:   [{ f: 880, d: 0.12 }, { f: 0, d: 0.04 }, { f: 880, d: 0.12 }, { f: 0, d: 0.04 }, { f: 1100, d: 0.2 }],
      rider:   [{ f: 660, d: 0.1 }, { f: 880, d: 0.1 }, { f: 1100, d: 0.15 }],
      success: [{ f: 523, d: 0.1 }, { f: 659, d: 0.1 }, { f: 784, d: 0.18 }],
    };
    const notes = patterns[type] || patterns.order;
    let t = ctx.currentTime + 0.05;
    notes.forEach(({ f, d }) => {
      if (f === 0) { t += d; return; }
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = f;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t);
      osc.stop(t + d);
      t += d + 0.02;
    });
  } catch { void 0; }
};

export const hashPassword = async (plain) => {
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(plain + 'br26'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return plain;
  }
};

export const deg2rad = (deg) => deg * (Math.PI / 180);

export const safeLocalSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    try {
      const stripped = JSON.parse(JSON.stringify(value, (k, v) =>
        typeof v === 'string' && v.startsWith('data:') ? '[image]' : v,
      ));
      localStorage.setItem(key, JSON.stringify(stripped));
    } catch { void 0; }
  }
};

const _NOTIF_SOUND_KEY = 'boomrider_merchant_notif_sound';

export const getMerchantNotifSound = () => {
  try { return localStorage.getItem(_NOTIF_SOUND_KEY); } catch { return null; }
};

export const setMerchantNotifSound = (base64OrNull) => {
  try {
    if (base64OrNull) localStorage.setItem(_NOTIF_SOUND_KEY, base64OrNull);
    else localStorage.removeItem(_NOTIF_SOUND_KEY);
  } catch { void 0; }
};

export const playOrderNotificationSound = () => {
  vibrateDevice([500, 150, 500, 150, 800]);
  try {
    const custom = getMerchantNotifSound();
    if (custom) {
      const audio = new Audio(custom);
      audio.volume = 1.0;
      audio.play().catch(() => playNotificationSound('order'));
      return;
    }
  } catch { void 0; }
  playNotificationSound('order');
};

export const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return parseFloat(d.toFixed(2));
};

/**
 * ติดตั้งและตั้งค่า Native Push Notifications สำหรับ Capacitor (Android/iOS)
 */
export const initPushNotifications = async () => {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;

    const { PushNotifications } = await import('@capacitor/push-notifications');

    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive === 'granted') {
      await PushNotifications.register();
    }

    PushNotifications.addListener('registration', (token) => {
      console.log('Push Registration Token:', token.value);
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('Push Registration Error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Push Notification Received:', notification);
      playOrderNotificationSound();
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('Push Notification Action Performed:', notification);
    });
  } catch (err) {
    console.error('Failed to initialize push notifications:', err);
  }
};
