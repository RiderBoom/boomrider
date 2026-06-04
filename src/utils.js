// ===== Utility Functions =====

export const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/** ปัดเศษทศนิยม 2 ตำแหน่ง — ป้องกัน floating-point artifact ในยอดกระเป๋าเงิน */
export const r2 = (n) => Math.round((n ?? 0) * 100) / 100;

const _pad = n => String(n).padStart(2, '0');
const _fmt = (d) => `${_pad(d.getDate())}/${_pad(d.getMonth()+1)}/${d.getFullYear()} ${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;

export const formatDateTime = () => _fmt(new Date());
export const formatDateTimeFromMs = (ms) => _fmt(new Date(Number(ms)));

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
 * เล่นเสียงแจ้งเตือนผ่าน Web Audio API (ไม่ต้องใช้ไฟล์เสียง)
 * @param {'order'|'rider'|'success'} type
 */
export const playNotificationSound = (type = 'order') => {
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
  } catch {}
};

export const deg2rad = (deg) => deg * (Math.PI / 180);

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
