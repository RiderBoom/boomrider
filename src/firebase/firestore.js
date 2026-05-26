import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs, addDoc,
  serverTimestamp, query, orderBy, limit, where,
  runTransaction, onSnapshot,
} from 'firebase/firestore';
import { db } from './config';

// ─── helper: strip base64 images ก่อน save (ป้องกัน quota exceeded) ────────
// IMPORTANT: ต้องรองรับ Array — ห้ามแปลง array เป็น plain object
const stripImages = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  // ── Array: map แต่ละ element แยก ห้าม spread เพราะจะกลายเป็น {0:x, 1:y} ──
  if (Array.isArray(obj)) return obj.map(item => stripImages(item));
  // ── Object: สร้าง copy แล้ว recurse แต่ละ key ──────────────────────────
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string' && out[k].startsWith('data:image')) {
      out[k] = out[k].substring(0, 100) + '...[image]';
    } else if (out[k] !== null && typeof out[k] === 'object') {
      out[k] = stripImages(out[k]);
    }
  }
  return out;
};

// ─── safe localStorage write ─────────────────────────────────────────────────
export const safeLocalSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // QuotaExceededError — strip images and retry
    try {
      const stripped = Array.isArray(value)
        ? value.map(stripImages)
        : stripImages(value);
      localStorage.setItem(key, JSON.stringify(stripped));
    } catch {}
  }
};

// ===== Orders ================================================================

export const saveOrder = async (order) => {
  if (!order?.id) return;
  // strip base64 images (pickupPhoto, deliveryPhoto อาจมีขนาด > 1MB ทำให้ Firestore reject)
  // รูปต้นฉบับยังอยู่ใน local state เพื่อแสดงผลใน UI ของไรเดอร์ได้ปกติ
  const stripped = stripImages(order);
  try {
    await setDoc(doc(db, 'orders', String(order.id)), {
      ...stripped,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[saveOrder] Firestore error:', err?.code, err?.message);
  }
};

/**
 * ── Partial Order Status Update (updateDoc) ─────────────────────────────────
 * ใช้ updateDoc เพื่ออัปเดตเฉพาะ status fields — ปลอดภัยกว่า saveOrder เพราะ:
 * 1) ไม่ส่ง riderLocation ที่อาจมี undefined/NaN จาก real-time simulation
 * 2) ใช้ updateDoc (partial merge) แทน setDoc (full replace)
 * 3) ลด document size ที่ส่งไป Firestore อย่างมาก
 * @param {string} orderId
 * @param {object} fields — เฉพาะ fields ที่ต้องการเปลี่ยน (เช่น status, riderId, completedAt)
 */
export const updateOrderStatusInDB = async (orderId, fields) => {
  if (!orderId) return;
  try {
    await updateDoc(doc(db, 'orders', String(orderId)), {
      ...stripImages(fields),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[updateOrderStatusInDB]', err?.code, err?.message);
  }
};

export const loadAllOrders = async () => {
  try {
    const q = query(collection(db, 'orders'), orderBy('updatedAt', 'desc'), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
  } catch { return []; }
};

/**
 * ── Atomic Order Acceptance (First-come, first-served) ─────────────────────
 * ใช้ Firestore Transaction เพื่อรับ order แบบ atomic:
 * - ถ้า order ยัง ready_to_pickup และไม่มี riderId → รับสำเร็จ
 * - ถ้ามีไรเดอร์อื่นรับไปก่อน → throw 'ORDER_ALREADY_TAKEN'
 * @returns {Promise<object>} — order data ที่อัปเดตแล้ว
 */
export const acceptOrderTransaction = async (orderId, riderId, riderLocation, riderUid) => {
  const orderRef = doc(db, 'orders', String(orderId));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('ORDER_NOT_FOUND');

    const data = snap.data();

    // ตรวจสอบว่ายังไม่มีใครรับ
    if (data.status !== 'ready_to_pickup' || data.riderId) {
      throw new Error('ORDER_ALREADY_TAKEN');
    }

    // Atomically claim the order
    // riderUid = Firebase UID ทำให้ Firestore rules อนุญาต update ต่อจากนี้
    tx.update(orderRef, {
      status:        'rider_accepted',
      riderId,
      riderUid:      riderUid || null,
      riderLocation: riderLocation || data.pickupLocation || null,
      updatedAt:     serverTimestamp(),
    });

    return { ...data, status: 'rider_accepted', riderId, riderUid, riderLocation };
  });
};

/**
 * ── Real-time Orders Subscription ──────────────────────────────────────────
 * Subscribe to Firestore orders ด้วย onSnapshot — ทุก device อัปเดต real-time
 * ต้องการ Firestore Rules: allow read: if isAuth();
 * @param {function} callback — รับ array ของ orders ทุกครั้งที่มีการเปลี่ยนแปลง
 * @param {function} [onError] — optional error handler
 * @returns {function} unsubscribe — เรียกเพื่อยกเลิก subscription
 */
export const subscribeToOrders = (callback, onError) => {
  const q = query(collection(db, 'orders'), orderBy('updatedAt', 'desc'), limit(200));
  return onSnapshot(q, (snap) => {
    const orders = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
    callback(orders);
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToOrders] Firestore error:', err.code, err.message);
    if (onError) onError(err);
  });
};

// ===== App Config =============================================================

export const saveAppConfig = async (config) => {
  try {
    await setDoc(doc(db, 'system', 'config'), { ...config, updatedAt: serverTimestamp() });
  } catch {}
};

export const loadAppConfig = async () => {
  try {
    const snap = await getDoc(doc(db, 'system', 'config'));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
};

// ===== Restaurants ============================================================

export const saveRestaurant = async (restaurant) => {
  if (!restaurant?.id) return;
  try {
    await setDoc(doc(db, 'restaurants', String(restaurant.id)), {
      ...restaurant,
      updatedAt: serverTimestamp(),
    });
  } catch {}
};

export const deleteRestaurantFromDB = async (id) => {
  try { await deleteDoc(doc(db, 'restaurants', String(id))); } catch {}
};

export const loadRestaurants = async () => {
  try {
    const snap = await getDocs(collection(db, 'restaurants'));
    return snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
  } catch { return null; }
};

// ===== Menu Items =============================================================

export const saveMenuItems = async (restaurantId, items) => {
  if (!restaurantId) return;
  try {
    await setDoc(doc(db, 'menu_items', String(restaurantId)), {
      items,
      updatedAt: serverTimestamp(),
    });
  } catch {}
};

export const loadMenuItems = async () => {
  try {
    const snap = await getDocs(collection(db, 'menu_items'));
    const result = {};
    snap.docs.forEach(d => {
      result[d.id] = d.data().items || [];
    });
    return result;
  } catch { return null; }
};

// ===== Pending Requests =======================================================

export const savePendingRequest = async (req) => {
  if (!req?.id) return;
  const ref = doc(db, 'pending_requests', String(req.id));
  try {
    // ลองเก็บรูปเต็มก่อน (Admin จะได้เห็นรูปบัตรฯ / สลิป)
    await setDoc(ref, { ...req, updatedAt: serverTimestamp() });
  } catch {
    // ถ้า document เกิน 1 MB → strip แล้ว retry
    try {
      await setDoc(ref, {
        ...req,
        data: stripImages(req.data),
        _hasImages: true,
        updatedAt: serverTimestamp(),
      });
    } catch {}
  }
};

export const deletePendingRequest = async (id) => {
  try { await deleteDoc(doc(db, 'pending_requests', String(id))); } catch {}
};

export const loadPendingRequests = async () => {
  try {
    const q = query(collection(db, 'pending_requests'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
  } catch { return null; }
};

/**
 * ── Real-time Pending Requests Subscription ────────────────────────────────
 * Subscribe to Firestore pending_requests ด้วย onSnapshot
 * ทำให้ทุก device เห็นการเปลี่ยนแปลงทันทีเมื่อ Admin อนุมัติ/ปฏิเสธ
 * @param {function} callback — รับ array ของ requests ทุกครั้งที่มีการเปลี่ยนแปลง
 * @param {function} [onError]
 * @returns {function} unsubscribe
 */
export const subscribeToPendingRequests = (callback, onError) => {
  const q = query(collection(db, 'pending_requests'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const requests = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
    callback(requests);
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToPendingRequests]', err.code, err.message);
    if (onError) onError(err);
  });
};

// ===== User Profiles ==========================================================

export const saveUserProfile = async (userId, data) => {
  if (!userId) return;
  try {
    await setDoc(doc(db, 'users', userId), {
      ...stripImages(data),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch {}
};

export const loadUserProfile = async (userId) => {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
};

export const checkEmailExists = async (email) => {
  try {
    const q = query(collection(db, 'users'), where('email', '==', email), limit(1));
    const snap = await getDocs(q);
    return !snap.empty;
  } catch { return false; }
};

// ===== Wallets ================================================================

/**
 * ── Credit Wallet ใน Firestore โดยตรง (atomic read-then-write) ─────────────
 * ใช้เมื่อต้องการอัปเดต wallet ของ user อื่น (เช่น Admin คืนเงิน, ส่ง income)
 * โดยไม่ต้องรอ useEffect ของ user นั้น login อยู่
 * Admin มีสิทธิ์ write ได้ตาม Firestore rules (isAdmin())
 * @param {string} userId
 * @param {number} amount — บวก = เพิ่มยอด, ลบ = ลดยอด
 * @param {string} desc   — รายการ
 */
export const creditWalletInDB = async (userId, amount, desc) => {
  if (!userId || !amount) return;
  const ref = doc(db, 'wallets', userId);
  try {
    const snap = await getDoc(ref);
    const cur = snap.exists() ? snap.data() : { balance: 0, history: [] };
    const newBalance = (cur.balance || 0) + amount;
    const entry = {
      id: String(Date.now()),
      type: amount > 0 ? 'deposit' : 'withdraw',
      amount,
      date: new Date().toLocaleString('th-TH'),
      desc,
    };
    const newHistory = [entry, ...(cur.history || [])].slice(0, 200);
    await setDoc(ref, {
      balance: newBalance,
      history: newHistory,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return newBalance;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[creditWalletInDB]', err?.code, err?.message);
    return null;
  }
};

export const saveWallet = async (userId, balance, history) => {
  if (!userId) return;
  try {
    await setDoc(doc(db, 'wallets', userId), {
      balance,
      history: (history || []).slice(0, 200),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch {}
};

export const loadWallet = async (userId) => {
  try {
    const snap = await getDoc(doc(db, 'wallets', userId));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
};

// ===== Riders ================================================================

export const saveRider = async (rider) => {
  if (!rider?.id) return;
  try {
    await setDoc(doc(db, 'riders', String(rider.id)), {
      ...rider,
      updatedAt: serverTimestamp(),
    });
  } catch {}
};

export const updateRiderLocation = async (riderId, location) => {
  if (!riderId || !location) return;
  try {
    await updateDoc(doc(db, 'riders', String(riderId)), {
      location,
      updatedAt: serverTimestamp(),
    });
  } catch {}
};

export const loadRiders = async () => {
  try {
    const snap = await getDocs(collection(db, 'riders'));
    return snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
  } catch { return null; }
};

export const deleteRiderFromDB = async (id) => {
  try { await deleteDoc(doc(db, 'riders', String(id))); } catch {}
};
