import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs, addDoc,
  serverTimestamp, query, orderBy, limit, where, Timestamp,
  runTransaction, onSnapshot, writeBatch,
  increment, arrayUnion,
} from 'firebase/firestore';
import { db } from './config';
import { formatDateTime } from '../utils';

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

// ── Time boundary helpers ────────────────────────────────────────────────────
const tsAgo = (ms) => Timestamp.fromDate(new Date(Date.now() - ms));
const thirtyDaysAgo  = () => tsAgo(30 * 24 * 60 * 60 * 1000);
const sevenDaysAgo   = () => tsAgo( 7 * 24 * 60 * 60 * 1000);
const twentyFourHAgo = () => tsAgo(     24 * 60 * 60 * 1000);

// ── Shared doc mapper (strips Firestore Timestamp from output) ───────────────
const mapOrderDocs = (docs) => docs.map(d => {
  const data = d.data();
  if (data.updatedAt?.toDate) delete data.updatedAt;
  return data;
});

// ── Legacy full-scan loader — ยังคงไว้สำหรับ Admin forceRefresh และ fallback ─
// ⚠️  Admin-only: ดึง 500 docs ทั้งหมด — อย่าเรียกจาก customer/rider/merchant
export const loadAllOrders = async () => {
  try {
    const q = query(
      collection(db, 'orders'),
      where('updatedAt', '>=', thirtyDaysAgo()),
      orderBy('updatedAt', 'desc'),
      limit(500),
    );
    const snap = await getDocs(q);
    return mapOrderDocs(snap.docs);
  } catch { return []; }
};

/**
 * ── Role-scoped One-time Orders Loader ─────────────────────────────────────
 * ใช้แทน loadAllOrders() สำหรับ non-admin — ลด reads >90%
 *
 * @param {{ role: 'customer'|'rider'|'merchant'|'admin', userId: string, shopId?: string }} scope
 * @returns {Promise<object[]>}
 */
export const loadOrdersByRole = async ({ role, userId, shopId = null }) => {
  const col = collection(db, 'orders');
  try {
    if (role === 'customer') {
      const snap = await getDocs(query(col,
        where('customerId', '==', userId),
        orderBy('updatedAt', 'desc'),
        limit(50),
      ));
      return mapOrderDocs(snap.docs);
    }

    if (role === 'merchant' && shopId) {
      const snap = await getDocs(query(col,
        where('restaurantId', '==', shopId),
        orderBy('updatedAt', 'desc'),
        limit(100),
      ));
      return mapOrderDocs(snap.docs);
    }

    if (role === 'rider') {
      const [snap1, snap2] = await Promise.all([
        getDocs(query(col,
          where('riderUid', '==', userId),
          where('updatedAt', '>=', sevenDaysAgo()),
          orderBy('updatedAt', 'desc'),
          limit(50),
        )),
        getDocs(query(col,
          where('status', '==', 'ready_to_pickup'),
          orderBy('updatedAt', 'desc'),
          limit(30),
        )),
      ]);
      const map = new Map();
      [...mapOrderDocs(snap1.docs), ...mapOrderDocs(snap2.docs)].forEach(o => map.set(o.id, o));
      return [...map.values()];
    }

    // admin — last 24 h, limit 200
    const snap = await getDocs(query(col,
      where('updatedAt', '>=', twentyFourHAgo()),
      orderBy('updatedAt', 'desc'),
      limit(200),
    ));
    return mapOrderDocs(snap.docs);
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
 * ── Role-based Real-time Orders Subscription ───────────────────────────────
 * Query scope แคบลงตาม role — ลด Firestore reads >90% เทียบกับ all-orders query
 *
 * ┌──────────────┬──────────────────────────────────────────────┬────────┐
 * │ role         │ query scope                                  │ limit  │
 * ├──────────────┼──────────────────────────────────────────────┼────────┤
 * │ customer     │ customerId == userId                         │ 50     │
 * │ merchant     │ restaurantId == shopId                       │ 100    │
 * │ rider        │ riderUid == userId (7d) ∪ status==ready (30) │ 50+30  │
 * │ admin        │ updatedAt >= 24h ago                         │ 200    │
 * └──────────────┴──────────────────────────────────────────────┴────────┘
 *
 * Required composite indexes (firestore.indexes.json):
 *   (customerId   ASC, updatedAt DESC)
 *   (restaurantId ASC, updatedAt DESC)
 *   (riderUid     ASC, updatedAt DESC)
 *   (status       ASC, updatedAt DESC)
 *
 * @param {{ role: 'customer'|'rider'|'merchant'|'admin', userId: string, shopId?: string }} scope
 * @param {function} callback  — (orders: object[]) => void
 * @param {function} [onError] — fallback เมื่อ subscription fail
 * @returns {function} unsubscribe — ยกเลิก subscription ทั้งหมด
 */
export const subscribeToOrders = ({ role, userId, shopId = null }, callback, onError) => {
  const col = collection(db, 'orders');
  const tag = `[subscribeToOrders:${role}]`;

  const errHandler = (err) => {
    if (import.meta.env.DEV) console.error(tag, err.code, err.message);
    onError?.(err);
  };

  // ── CUSTOMER ────────────────────────────────────────────────────────────────
  // Index: customerId ASC + updatedAt DESC
  if (role === 'customer') {
    return onSnapshot(
      query(col,
        where('customerId', '==', userId),
        orderBy('updatedAt', 'desc'),
        limit(50),
      ),
      (snap) => callback(mapOrderDocs(snap.docs)),
      errHandler,
    );
  }

  // ── MERCHANT ────────────────────────────────────────────────────────────────
  // Index: restaurantId ASC + updatedAt DESC
  if (role === 'merchant') {
    if (!shopId) {
      if (import.meta.env.DEV) console.warn(tag, 'shopId missing — falling back to customer scope');
      return subscribeToOrders({ role: 'customer', userId }, callback, onError);
    }
    return onSnapshot(
      query(col,
        where('restaurantId', '==', shopId),
        orderBy('updatedAt', 'desc'),
        limit(100),
      ),
      (snap) => callback(mapOrderDocs(snap.docs)),
      errHandler,
    );
  }

  // ── RIDER ────────────────────────────────────────────────────────────────────
  // 2 subscriptions merged:
  //   q1 — rider's own assigned orders (last 7 days)   Index: riderUid + updatedAt
  //   q2 — unassigned available jobs (ready_to_pickup)  Index: status  + updatedAt
  if (role === 'rider') {
    let ownOrders     = [];
    let availableJobs = [];
    let initialized   = false;

    const emit = () => {
      // merge + deduplicate by id; own orders win on conflict (have more fields)
      const map = new Map();
      availableJobs.forEach(o => map.set(o.id, o));
      ownOrders.forEach(o => map.set(o.id, o));
      callback([...map.values()]);
    };

    const unsub1 = onSnapshot(
      query(col,
        where('riderUid', '==', userId),
        where('updatedAt', '>=', sevenDaysAgo()),
        orderBy('updatedAt', 'desc'),
        limit(50),
      ),
      (snap) => { ownOrders = mapOrderDocs(snap.docs); if (initialized) emit(); },
      errHandler,
    );

    const unsub2 = onSnapshot(
      query(col,
        where('status', '==', 'ready_to_pickup'),
        orderBy('updatedAt', 'desc'),
        limit(30),
      ),
      (snap) => { availableJobs = mapOrderDocs(snap.docs); initialized = true; emit(); },
      errHandler,
    );

    return () => { unsub1(); unsub2(); };
  }

  // ── ADMIN (default) ─────────────────────────────────────────────────────────
  // Single-field range query — ไม่ต้องการ composite index (updatedAt มี auto index)
  return onSnapshot(
    query(col,
      where('updatedAt', '>=', twentyFourHAgo()),
      orderBy('updatedAt', 'desc'),
      limit(200),
    ),
    (snap) => callback(mapOrderDocs(snap.docs)),
    errHandler,
  );
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

export const subscribeToConfig = (callback) => {
  return onSnapshot(doc(db, 'system', 'config'), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.updatedAt?.toDate) delete data.updatedAt;
    callback(data);
  }, () => {});
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
      return { ...data, id: d.id };
    });
  } catch { return null; }
};

export const subscribeToRestaurants = (callback) => {
  return onSnapshot(collection(db, 'restaurants'), (snap) => {
    const list = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return { ...data, id: d.id };
    });
    callback(list);
  }, () => {});
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

export const subscribeToMenuItems = (callback) => {
  return onSnapshot(collection(db, 'menu_items'), (snap) => {
    const result = {};
    snap.docs.forEach(d => {
      result[d.id] = d.data().items || [];
    });
    callback(result);
  }, () => {});
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
 * @param {string|null} [userId] — กรอง userId เฉพาะ (null = ดูทั้งหมด สำหรับ Admin)
 *   ต้องส่ง userId สำหรับ non-admin เพื่อหลีกเลี่ยง PERMISSION_DENIED
 *   (Firestore rejects collection query ถ้า rule check รายการของ user อื่น)
 * @returns {function} unsubscribe
 */
export const subscribeToPendingRequests = (callback, onError, userId = null) => {
  // userId filter: ใช้ where อย่างเดียว (ไม่ใส่ orderBy) เพราะ where + orderBy
  // ต้องการ composite index ที่ไม่ได้สร้าง → query จะ fail silent
  // Admin (userId = null): orderBy updatedAt (single-field index สร้างอัตโนมัติ)
  const q = userId
    ? query(collection(db, 'pending_requests'), where('userId', '==', userId))
    : query(collection(db, 'pending_requests'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const requests = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
    });
    // sort client-side สำหรับ user-filtered results (ไม่มี orderBy)
    if (userId) {
      requests.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    }
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
  // ใช้ increment() + arrayUnion() เพื่อ:
  // 1) ไม่ต้อง getDoc ก่อน → ไม่ต้องการ READ permission บน wallet ของคนอื่น
  // 2) atomic — ไม่มี race condition แม้ write พร้อมกันหลายฝ่าย
  // 3) Firestore rule: allow write ถ้า balance เพิ่ม (ทุก auth user ทำได้) หรือ isOwner
  const entry = {
    id: `${userId.slice(-4)}_${Date.now()}`,
    type: amount > 0 ? 'deposit' : 'withdraw',
    amount,
    date: formatDateTime(),
    createdAtMs: Date.now(),
    desc,
  };
  try {
    await setDoc(ref, {
      balance:   increment(amount),
      history:   arrayUnion(entry),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
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

/**
 * สร้าง Firestore wallet document สำหรับ user ใหม่ (ถ้ายังไม่มี)
 * ใช้ merge:false เพื่อไม่ overwrite document ที่มีอยู่แล้ว
 */
export const initWalletIfNew = async (userId) => {
  if (!userId) return;
  try {
    const snap = await getDoc(doc(db, 'wallets', userId));
    if (!snap.exists()) {
      await setDoc(doc(db, 'wallets', userId), {
        balance: 0,
        history: [],
        updatedAt: serverTimestamp(),
      });
    }
  } catch {}
};

export const loadWallet = async (userId) => {
  try {
    const snap = await getDoc(doc(db, 'wallets', userId));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
};

/**
 * Real-time subscription บน wallet document ของ user
 * เมื่อ Admin เปลี่ยนยอด (อนุมัติ topup/withdraw) → callback จะถูกเรียกทันที
 * @param {string}   userId
 * @param {function} onUpdate  — รับ { balance, history }
 * @returns {function} unsubscribe
 */
export const subscribeToWallet = (userId, onUpdate) => {
  if (!userId) return () => {};
  const ref = doc(db, 'wallets', userId);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) onUpdate(snap.data());
  }, () => {}); // silent error fallback
};

/**
 * Real-time subscription บน wallets collection ทั้งหมด (สำหรับ Admin)
 * @param {function} onUpdate — รับ map { [userId]: { balance, history } }
 * @returns {function} unsubscribe
 */
export const subscribeToAllWallets = (onUpdate) => {
  const ref = collection(db, 'wallets');
  return onSnapshot(ref, (snap) => {
    const wallets = {};
    snap.forEach(d => { wallets[d.id] = d.data(); });
    onUpdate(wallets);
  }, () => {});
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

// อัปเดตตำแหน่งไรเดอร์ใน rider_locations/{riderUid} (แยกออกจาก orders เพื่อป้องกัน GPS fan-out)
export const upsertRiderLocation = async (riderUid, loc, orderId = null) => {
  if (!riderUid || !loc) return;
  try {
    await setDoc(doc(db, 'rider_locations', String(riderUid)), {
      lat: loc.lat,
      lng: loc.lng,
      orderId: orderId || null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch {}
};

export const subscribeToRiderLocation = (riderUid, callback) => {
  if (!riderUid) return () => {};
  return onSnapshot(
    doc(db, 'rider_locations', String(riderUid)),
    (snap) => callback(snap.exists() ? { lat: snap.data().lat, lng: snap.data().lng } : null),
    () => callback(null),
  );
};

export const loadRiders = async () => {
  try {
    const snap = await getDocs(collection(db, 'riders'));
    return snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return { ...data, id: d.id };
    });
  } catch { return null; }
};

export const subscribeToRiders = (callback) => {
  return onSnapshot(collection(db, 'riders'), (snap) => {
    const list = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return { ...data, id: d.id };
    });
    callback(list);
  }, () => {});
};

export const deleteRiderFromDB = async (id) => {
  try { await deleteDoc(doc(db, 'riders', String(id))); } catch {}
};

// ===== Chats ==================================================================

/**
 * บันทึก/อัปเดต messages ของ chat ลง Firestore
 * ใช้ merge:true เพื่อไม่เขียนทับ fields อื่น
 */
export const saveChat = async (chatId, messages) => {
  if (!chatId) return;
  try {
    await setDoc(doc(db, 'chats', String(chatId)), {
      messages: (messages || []).slice(-300), // เก็บสูงสุด 300 ข้อความ
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[saveChat]', err?.code, err?.message);
  }
};

export const deleteChatFromDB = async (chatId) => {
  if (!chatId) return;
  try { await deleteDoc(doc(db, 'chats', String(chatId))); } catch {}
};

/**
 * Append a single message to a chat document atomically (arrayUnion).
 * Safe for concurrent writes from different devices.
 * Only supports URL images — do NOT pass base64 strings (document size limit).
 */
export const appendChatMessage = async (chatId, message) => {
  if (!chatId || !message) return;
  try {
    await setDoc(doc(db, 'chats', String(chatId)), {
      messages: arrayUnion(message),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[appendChatMessage]', err?.code, err?.message);
  }
};

export const loadAllChats = async () => {
  try {
    const snap = await getDocs(collection(db, 'chats'));
    const result = {};
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.messages) result[d.id] = data.messages;
    });
    return result;
  } catch { return null; }
};

/**
 * Real-time subscription สำหรับ chats ทั้งหมด (Admin only)
 */
export const subscribeToChats = (callback, onError) => {
  const q = collection(db, 'chats');
  return onSnapshot(q, (snap) => {
    const allChats = {};
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.messages) allChats[d.id] = data.messages;
    });
    callback(allChats);
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToChats]', err.code, err.message);
    if (onError) onError(err);
  });
};

/**
 * Real-time subscription เฉพาะ support chat ของ user (non-admin)
 * ประหยัด Firestore reads: อ่านแค่ 1 document แทนที่จะอ่านทั้ง collection
 */
export const subscribeToSupportChat = (userId, callback, onError) => {
  if (!userId) return () => {};
  return onSnapshot(doc(db, 'chats', `support-${userId}`), (snap) => {
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    callback({ [`support-${userId}`]: msgs });
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToSupportChat]', err.code, err.message);
    if (onError) onError(err);
  });
};

// ══════════════════════════════════════════════════════════════════════════════
// ORDER COMPLETION — ใช้ creditWalletInDB (main wallet) สำหรับทุกฝ่าย
// ══════════════════════════════════════════════════════════════════════════════


// ─── atomicOrderCompletion ───────────────────────────────────────────────────

/**
 * เมื่อออเดอร์ถูก delivered: โอนรายได้เข้า main wallet ของทุกฝ่าย
 *
 * ── Wallet payment ──────────────────────────────────────────────────────────
 *  - Rider    wallet += riderEarning   (deliveryFee − riderGP)
 *  - Merchant wallet += shopEarning    (foodTotal − merchantGP)
 *  - Admin    wallet += totalAdminGP   (riderGP + merchantGP)
 *
 * ── Cash payment (เงินสด) ───────────────────────────────────────────────────
 *  ไรเดอร์รับเงินสด grandTotal จากลูกค้าแล้ว — เก็บ riderEarning ไว้เองในรูปเงินสด
 *  ต้องส่งคืน platform: shopEarning (อาหาร) + totalAdminGP (GP platform)
 *  เพื่อให้ยอดกระเป๋าสมดุล (ไม่มีเงินสร้างจากอากาศ):
 *  - Rider    wallet -= shopEarning         (อาหารที่เก็บแทนร้าน)
 *  - Rider    wallet -= totalAdminGP        (GP ที่เก็บแทน platform)
 *    รวม Rider debt = shopEarning + totalAdminGP = grandTotal − riderEarning
 *  - Merchant wallet += shopEarning         (platform บันทึกให้ร้านอัตโนมัติ)
 *  - Admin    wallet += totalAdminGP        (GP platform — มีเงิน Rider หนุนหลัง)
 *
 * @param {{ order, riderUid, shopOwnerUid, adminUid, gpFood, gpDelivery }} p
 * @returns {{ riderGP, merchantGP, totalAdminGP, shopEarning, riderEarning, isCash }}
 */
export const atomicOrderCompletion = async ({
  order, riderUid, shopOwnerUid, adminUid, gpFood, gpDelivery,
}) => {
  const isCash = order.paymentMethod === 'cash';

  // ── ใช้ค่าที่คำนวณไว้ในออเดอร์ (ตอนสั่ง) เป็นหลัก ────────────────────────
  // หลีกเลี่ยงการคำนวณซ้ำด้วย GP rate ปัจจุบัน (อาจเปลี่ยนจากตอนสั่ง)
  // และหลีกเลี่ยง promoDiscount split ที่ไม่ตรงกับ logic ตอนสั่ง (Admin ดูดส่วนลดเต็ม)
  const riderEarning = typeof order.riderIncome    === 'number' ? order.riderIncome    : (() => {
    const fee = order.deliveryFee ?? order.delivery ?? (order.type === 'parcel' ? order.grandTotal : 0) ?? 0;
    const gp  = parseFloat((fee * ((gpDelivery ?? 15) / 100)).toFixed(2));
    return parseFloat((fee - gp).toFixed(2));
  })();
  const shopEarning  = typeof order.merchantIncome === 'number' ? order.merchantIncome : (() => {
    const food = order.foodTotal ?? order.subtotal ?? 0;
    const gp   = parseFloat((food * ((gpFood ?? 30) / 100)).toFixed(2));
    return parseFloat((food - gp).toFixed(2));
  })();
  const totalAdminGP = typeof order.adminGP        === 'number' ? order.adminGP        : (() => {
    const fee  = order.deliveryFee ?? order.delivery ?? (order.type === 'parcel' ? order.grandTotal : 0) ?? 0;
    const food = order.foodTotal ?? order.subtotal ?? 0;
    const promo = order.promoDiscount ?? order.discountAmount ?? 0;
    return Math.max(0, parseFloat(((food * ((gpFood ?? 30) / 100)) + (fee * ((gpDelivery ?? 15) / 100)) - promo).toFixed(2)));
  })();

  const orderLabel = `#${(order.id || order.orderId || '').slice(-6)}`;

  const jobs = [];

  if (riderUid) {
    if (isCash) {
      // เงินสด: ไรเดอร์รับ grandTotal เป็นเงินสดจากลูกค้าแล้ว
      // ไรเดอร์เก็บ riderEarning ไว้เองในรูปเงินสด (ไม่ต้องบันทึกเข้า wallet)
      // ไรเดอร์ต้องส่งคืน platform: shopEarning (อาหาร) + totalAdminGP (GP)
      // → หัก debt ทั้งหมดจาก rider wallet เพื่อให้ยอด GP admin มีเงินหนุนหลังจริง
      if (shopEarning  > 0) jobs.push(creditWalletInDB(riderUid, -shopEarning,  `ส่งยอดอาหาร(สด) ${orderLabel}`));
      if (totalAdminGP > 0) jobs.push(creditWalletInDB(riderUid, -totalAdminGP, `GP(สด) ${orderLabel}`));
    } else {
      // Wallet: เครดิตค่าส่งปกติ
      if (riderEarning > 0) jobs.push(creditWalletInDB(riderUid, riderEarning, `ค่าส่ง ${orderLabel}`));
    }
  }

  // ร้านค้าและ Admin เหมือนกันทั้งสองกรณี
  if (shopEarning  > 0 && shopOwnerUid) jobs.push(creditWalletInDB(shopOwnerUid, shopEarning,  `รายได้ร้าน ${orderLabel}`));
  if (totalAdminGP > 0 && adminUid)     jobs.push(creditWalletInDB(adminUid,     totalAdminGP, `GP ${orderLabel}`));

  await Promise.allSettled(jobs);

  return { totalAdminGP, shopEarning, riderEarning, isCash };
};

// ===== Transaction Log =========================================================

/**
 * บันทึก transaction เข้า Firestore (immutable — ไม่มี update/delete)
 * ใช้ addDoc เพื่อให้ Firestore สร้าง ID อัตโนมัติ
 */
export const saveTransaction = async (tx) => {
  if (!tx?.type) return;
  try {
    await addDoc(collection(db, 'transactions'), {
      ...tx,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[saveTransaction]', err?.code, err?.message);
  }
};

/**
 * ดึง metadata ของ transaction log (clearedAt ล่าสุด)
 */
export const getTransactionLogMeta = async () => {
  try {
    const snap = await getDoc(doc(db, 'system', 'transaction_log'));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
};

/**
 * Real-time subscription สำหรับ transactions (Admin only)
 * @param {Timestamp|null} clearedAt — กรองเฉพาะ records หลัง clearedAt (null = ดูทั้งหมด)
 */
export const subscribeToTransactions = (clearedAt, callback, onError) => {
  const q = clearedAt
    ? query(collection(db, 'transactions'), where('createdAt', '>', clearedAt), orderBy('createdAt', 'desc'), limit(500))
    : query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(500));
  return onSnapshot(q, (snap) => {
    const txs = snap.docs.map(d => {
      const data = d.data();
      const ts = data.createdAt;
      return { ...data, _docId: d.id, createdAtMs: ts?.toDate ? ts.toDate().getTime() : 0 };
    });
    callback(txs);
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToTransactions]', err?.code, err?.message);
    if (onError) onError(err);
  });
};

/**
 * เคลียร์ transaction log — อัปเดต clearedAt = now (ไม่ลบ documents จริง)
 * ประหยัด Firestore quota + ป้องกัน race condition
 */
export const clearTransactionLog = async () => {
  try {
    await setDoc(doc(db, 'system', 'transaction_log'), {
      clearedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[clearTransactionLog]', err?.code, err?.message);
    return false;
  }
};

// ===== Wallet Entries (per-user history subcollection) =========================

/**
 * เพิ่ม entry ลงใน wallets/{userId}/entries subcollection
 * ใช้ addDoc — Firestore สร้าง ID อัตโนมัติ
 */
export const addWalletEntry = async (userId, entry) => {
  if (!userId || !entry?.type) return;
  try {
    await addDoc(collection(db, 'wallets', userId, 'entries'), {
      ...entry,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[addWalletEntry]', err?.code, err?.message);
  }
};

/**
 * Real-time subscription สำหรับ wallet entries ของ user
 * @param {string} userId
 * @param {function} callback — รับ array ของ entries
 */
export const subscribeToWalletEntries = (userId, callback, onError) => {
  if (!userId) return () => {};
  const q = query(
    collection(db, 'wallets', userId, 'entries'),
    orderBy('createdAt', 'desc'),
    limit(200),
  );
  return onSnapshot(q, (snap) => {
    const entries = snap.docs.map(d => {
      const data = d.data();
      const ts = data.createdAt;
      return { ...data, id: d.id, createdAtMs: ts?.toDate ? ts.toDate().getTime() : 0 };
    });
    callback(entries);
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToWalletEntries]', err?.code, err?.message);
    if (onError) onError(err);
  });
};

/**
 * โหลด wallet entries ของ user ครั้งเดียว (ใช้ใน Admin panel)
 */
export const loadWalletEntries = async (userId) => {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'wallets', userId, 'entries'),
      orderBy('createdAt', 'desc'),
      limit(200),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      const ts = data.createdAt;
      return { ...data, id: d.id, createdAtMs: ts?.toDate ? ts.toDate().getTime() : 0 };
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[loadWalletEntries]', err?.code, err?.message);
    return [];
  }
};

/**
 * เคลียร์ wallet history โดยอัปเดต historyClearedAt = now ใน wallet document
 * Entries ยังอยู่ใน Firestore แต่จะถูก filter ออกเมื่อ clearedAt > entry.createdAt
 */
export const clearWalletHistory = async (userId) => {
  if (!userId) return false;
  try {
    await setDoc(doc(db, 'wallets', userId), {
      historyClearedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[clearWalletHistory]', err?.code, err?.message);
    return false;
  }
};

/**
 * ONE-TIME MIGRATION — Admin เท่านั้น
 * อ่าน wallet ทุก document แล้วเขียน balance กลับเป็น Number ที่ปัดเศษ 2 ตำแหน่ง
 * แก้ปัญหา floating-point artifact (เช่น 496.39999999999986 → 496.40)
 * และ display artifact ที่อาจมี balance ซ้ำ
 */
export const fixAllWalletBalances = async () => {
  const snap = await getDocs(collection(db, 'wallets'));
  const results = [];
  for (const docSnap of snap.docs) {
    const raw = docSnap.data()?.balance;
    const parsed = typeof raw === 'number' ? raw
                 : typeof raw === 'string' ? parseFloat(raw)
                 : 0;
    const clean = isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
    try {
      await updateDoc(docSnap.ref, { balance: clean });
      results.push({ id: docSnap.id, before: raw, after: clean, ok: true });
    } catch (err) {
      results.push({ id: docSnap.id, before: raw, after: clean, ok: false, err: err?.code });
    }
  }
  return results;
};

// ══════════════════════════════════════════════════════════════════════════════
// USER PROFILE — real-time subscription + role & ban management
// ══════════════════════════════════════════════════════════════════════════════

/** Subscribe real-time ต่อ users/{userId} — ใช้ sync roles + banned ข้ามอุปกรณ์ */
export const subscribeToUserProfile = (userId, callback) => {
  if (!userId) return () => {};
  return onSnapshot(doc(db, 'users', userId), (snap) => {
    if (snap.exists()) callback(snap.data());
  }, () => {});
};

/** บันทึก roles ไปยัง users/{userId} (admin grant/revoke role) */
export const saveUserRoles = async (userId, roles) => {
  if (!userId) return;
  try {
    await setDoc(doc(db, 'users', userId), { roles, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[saveUserRoles]', err?.code);
  }
};

/** Admin: โหลด users ทั้งหมดจาก Firestore สำหรับแสดงรายชื่อใน Admin panel */
export const loadAllUsers = async () => {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (import.meta.env.DEV) console.error('[loadAllUsers]', err?.code);
    return [];
  }
};

/** Admin: ตั้งค่า banned status ใน users/{userId} */
export const setBanUser = async (userId, banned) => {
  if (!userId) return;
  try {
    await setDoc(doc(db, 'users', userId), { banned, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[setBanUser]', err?.code);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PROMO CODES — system/promo_codes (ทุกคนอ่านได้, admin เขียนได้)
// ══════════════════════════════════════════════════════════════════════════════

export const savePromoCodes = async (codes) => {
  try {
    await setDoc(doc(db, 'system', 'promo_codes'), { codes: codes || [], updatedAt: serverTimestamp() });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[savePromoCodes]', err?.code);
  }
};

export const subscribeToPromoCodes = (callback) => {
  return onSnapshot(doc(db, 'system', 'promo_codes'), (snap) => {
    callback(snap.exists() ? (snap.data().codes || []) : []);
  }, () => { callback([]); });
};

// ── Single order loader — used for availability pre-check before non-tx accept ─
export const loadOrder = async (orderId) => {
  try {
    const snap = await getDoc(doc(db, 'orders', String(orderId)));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
};

/**
 * cancelOrderBatch — atomic multi-collection cancel + refund
 * Combines order status update, wallet credit, wallet entry, and transaction log
 * into a single Firestore WriteBatch so partial failures are impossible.
 *
 * @param {string} orderId
 * @param {{ cancelReason, customerId, refundAmount, refundDesc }} opts
 */
export const cancelOrderBatch = async (orderId, {
  cancelReason = '',
  customerId   = null,
  refundAmount = 0,
  refundDesc   = '',
} = {}) => {
  const batch = writeBatch(db);

  batch.update(doc(db, 'orders', String(orderId)), {
    status: 'cancelled',
    cancelReason,
    updatedAt: serverTimestamp(),
  });

  if (customerId && refundAmount > 0) {
    const entry = {
      id:          `${customerId.slice(-4)}_${Date.now()}`,
      type:        'refund',
      amount:      refundAmount,
      date:        formatDateTime(),
      createdAtMs: Date.now(),
      desc:        refundDesc,
    };

    batch.set(doc(db, 'wallets', customerId), {
      balance:   increment(refundAmount),
      history:   arrayUnion(entry),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    batch.set(doc(collection(db, 'wallets', customerId, 'entries')), {
      type:      'refund',
      amount:    refundAmount,
      desc:      refundDesc,
      date:      entry.date,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(collection(db, 'transactions')), {
      type:      'wallet_refund',
      orderId,
      userId:    customerId,
      amount:    refundAmount,
      desc:      refundDesc,
      date:      entry.date,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
};

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN NOTIFICATIONS — admin_notifs collection (cross-device)
// ══════════════════════════════════════════════════════════════════════════════

/** เขียน notification ไป Firestore admin_notifs (fire-and-forget) */
export const saveAdminNotif = async (notif) => {
  try {
    await addDoc(collection(db, 'admin_notifs'), { ...notif, createdAt: serverTimestamp() });
  } catch {} // best-effort — ต้องไม่ block caller
};

/** Admin: subscribe real-time ต่อ admin_notifs — รับทุก notification ข้ามอุปกรณ์ */
export const subscribeToAdminNotifs = (callback) => {
  const q = query(collection(db, 'admin_notifs'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => {
      const data = d.data();
      const ts = data.createdAt;
      return { ...data, id: data.id ?? (ts?.toMillis ? ts.toMillis() : Date.now()) };
    }));
  }, () => {});
};

// ══════════════════════════════════════════════════════════════════════════════
// RATINGS — ratings/{orderId}
// ══════════════════════════════════════════════════════════════════════════════

/**
 * บันทึกคะแนนรีวิวหลังส่งสำเร็จ:
 * 1) เขียน ratings/{orderId}
 * 2) อัปเดต avg rating ของร้านและไรเดอร์ด้วย transaction
 * 3) mark orders/{orderId}.rated = true
 */
export const saveRating = async ({ orderId, customerId, restaurantId, riderId, restaurantRating, riderRating, comment }) => {
  try {
    await setDoc(doc(db, 'ratings', String(orderId)), {
      orderId: String(orderId),
      customerId: customerId || null,
      restaurantId: restaurantId || null,
      riderId: riderId || null,
      restaurantRating: restaurantRating || null,
      riderRating: riderRating || null,
      comment: comment || '',
      createdAt: serverTimestamp(),
    });

    if (restaurantId && restaurantRating) {
      const restRef = doc(db, 'restaurants', String(restaurantId));
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(restRef);
        if (!snap.exists()) return;
        const d = snap.data();
        const prevCount = d.ratingCount || 0;
        const count = prevCount + 1;
        const avg = parseFloat((((d.rating || 5) * prevCount + restaurantRating) / count).toFixed(1));
        tx.update(restRef, { rating: avg, ratingCount: count });
      });
    }

    if (riderId && riderRating) {
      const riderRef = doc(db, 'riders', String(riderId));
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(riderRef);
        if (!snap.exists()) return;
        const d = snap.data();
        const prevCount = d.ratingCount || 0;
        const count = prevCount + 1;
        const avg = parseFloat((((d.avgRating || 5) * prevCount + riderRating) / count).toFixed(1));
        tx.update(riderRef, { avgRating: avg, ratingCount: count });
      });
    }

    await updateDoc(doc(db, 'orders', String(orderId)), { rated: true, updatedAt: serverTimestamp() });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[saveRating]', err?.code, err?.message);
  }
};

