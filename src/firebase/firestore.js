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
 * Real-time subscription สำหรับ chats ทั้งหมด
 * Admin เห็นทุก chat, User เห็นเฉพาะของตัวเอง (Firestore rules ควบคุม)
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

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-WALLET SYSTEM
// wallet types: 'rider_credit' | 'rider_main' | 'shop_settlement' | 'admin_platform'
// ══════════════════════════════════════════════════════════════════════════════

// ─── internal helpers ─────────────────────────────────────────────────────────

/** อ่าน balance จาก sub-wallet field (backward compat สำหรับ admin) */
const _getSubBal = (walletData, walletType) => {
  if (walletType === 'admin_platform') {
    return walletData?.admin_platform?.balance ?? walletData?.balance ?? 0;
  }
  return walletData?.[walletType]?.balance ?? 0;
};

/**
 * คืน wallet document ที่อัปเดตแล้ว (immutable)
 * historyEntry = { id, date, desc, amount }
 */
const _applySubWallet = (walletData, walletType, newBalance, historyEntry) => {
  const existing = walletData?.[walletType] || { balance: 0, history: [] };
  const updatedSub = {
    ...existing,
    balance: newBalance,
    history: [historyEntry, ...(existing.history || [])].slice(0, 200),
  };
  const result = { ...walletData, [walletType]: updatedSub, updatedAt: serverTimestamp() };
  // backward compat: admin top-level balance/history mirrors admin_platform
  if (walletType === 'admin_platform') {
    result.balance = newBalance;
    result.history = updatedSub.history;
  }
  return result;
};

const _thNow = () =>
  new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

// ─── createTransactionLog ────────────────────────────────────────────────────

/**
 * เขียน 1 transaction log ไปที่ transactions/{autoId}
 * @returns {string} txId
 */
export const createTransactionLog = async (data) => {
  try {
    const ref  = doc(collection(db, 'transactions'));
    const txId = ref.id;
    await setDoc(ref, {
      transaction_id:     txId,
      order_id:           data.order_id           ?? null,
      user_id:            data.user_id             ?? null,
      shop_id:            data.shop_id             ?? null,
      target_wallet_type: data.target_wallet_type  ?? null,
      type:               data.type               ?? 'unknown',
      status:             data.status             ?? 'success',
      amount:             data.amount             ?? 0,
      balance_before:     data.balance_before      ?? null,
      balance_after:      data.balance_after       ?? null,
      bank_info:          data.bank_info           ?? null,
      description:        data.description         ?? '',
      timestamp:          serverTimestamp(),
    });
    return txId;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[createTransactionLog]', err?.code, err?.message);
    return null;
  }
};

// ─── loadTransactionLogs ─────────────────────────────────────────────────────

/**
 * โหลด transaction logs
 * @param {string|null} userId - null = ทั้งหมด (admin)
 * @param {number} limitCount
 */
export const loadTransactionLogs = async (userId = null, limitCount = 100) => {
  try {
    const col = collection(db, 'transactions');
    const q = userId
      ? query(col, where('user_id', '==', userId), orderBy('timestamp', 'desc'), limit(limitCount))
      : query(col, orderBy('timestamp', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (import.meta.env.DEV) console.error('[loadTransactionLogs]', err?.code, err?.message);
    return [];
  }
};

// ─── subscribeToTransactions ──────────────────────────────────────────────────

/**
 * Real-time subscription สำหรับ transactions collection
 * @param {string|null} userId - null = ทั้งหมด (admin)
 * @param {Function} callback
 * @param {number} limitCount
 * @returns unsubscribe function
 */
export const subscribeToTransactions = (userId = null, callback, limitCount = 200) => {
  try {
    const col = collection(db, 'transactions');
    const q = userId
      ? query(col, where('user_id', '==', userId), orderBy('timestamp', 'desc'), limit(limitCount))
      : query(col, orderBy('timestamp', 'desc'), limit(limitCount));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      if (import.meta.env.DEV) console.error('[subscribeToTransactions]', err?.code, err?.message);
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error('[subscribeToTransactions setup]', err?.code, err?.message);
    return () => {};
  }
};

// ─── creditWalletByType ───────────────────────────────────────────────────────

/**
 * Credit เงินเข้า sub-wallet ที่ระบุ (atomic runTransaction)
 * ใช้สำหรับ admin อนุมัติ topup
 * @returns {{ balance_before, balance_after }}
 */
export const creditWalletByType = async (userId, walletType, amount, desc = '') => {
  const walletRef = doc(db, 'wallets', userId);
  let balBefore = 0;
  let balAfter  = 0;
  await runTransaction(db, async (tx) => {
    const snap   = await tx.get(walletRef);
    const data   = snap.exists() ? snap.data() : {};
    balBefore    = _getSubBal(data, walletType);
    balAfter     = parseFloat((balBefore + amount).toFixed(2));
    const entry  = { id: `cr_${Date.now()}`, date: _thNow(), desc, amount };
    tx.set(walletRef, _applySubWallet(data, walletType, balAfter, entry), { merge: true });
  });
  return { balance_before: balBefore, balance_after: balAfter };
};

// ─── atomicOrderCompletion ───────────────────────────────────────────────────

/**
 * ทำธุรกรรมทั้งหมดในคราวเดียวเมื่อออเดอร์ถูก delivered:
 *  - rider_credit  -= riderGP
 *  - rider_main    += deliveryFee (earnings)
 *  - admin_platform += riderGP + merchantGP
 *  - shop_settlement += (foodTotal - promoDiscount) - merchantGP
 *
 * @param {{ order, riderUid, shopOwnerUid, adminUid, gpFood, gpDelivery }} p
 * @returns {{ riderGP, merchantGP, totalAdminGP, shopEarning }}
 */
export const atomicOrderCompletion = async ({
  order, riderUid, shopOwnerUid, adminUid, gpFood, gpDelivery,
}) => {
  const foodTotal     = order.foodTotal    ?? order.subtotal     ?? 0;
  const deliveryFee   = order.deliveryFee  ?? order.delivery     ?? 0;
  const promoDiscount = order.promoDiscount ?? order.discountAmount ?? 0;
  const adjFood       = Math.max(0, foodTotal - promoDiscount);

  const riderGP      = parseFloat((deliveryFee * ((gpDelivery ?? 15) / 100)).toFixed(2));
  const merchantGP   = parseFloat((adjFood     * ((gpFood     ?? 30) / 100)).toFixed(2));
  const totalAdminGP = parseFloat((riderGP + merchantGP).toFixed(2));
  const shopEarning  = parseFloat((adjFood - merchantGP).toFixed(2));

  const orderId    = order.id || order.orderId || '';
  const orderLabel = `#${orderId.slice(-6)}`;

  const riderRef = riderUid     ? doc(db, 'wallets', riderUid)     : null;
  const adminRef = adminUid     ? doc(db, 'wallets', adminUid)     : null;
  const shopRef  = shopOwnerUid ? doc(db, 'wallets', shopOwnerUid) : null;

  const bals = {};

  await runTransaction(db, async (tx) => {
    const [rSnap, aSnap, sSnap] = await Promise.all([
      riderRef ? tx.get(riderRef) : Promise.resolve(null),
      adminRef ? tx.get(adminRef) : Promise.resolve(null),
      shopRef  ? tx.get(shopRef)  : Promise.resolve(null),
    ]);

    const rData = rSnap?.exists() ? rSnap.data() : {};
    const aData = aSnap?.exists() ? aSnap.data() : {};
    const sData = sSnap?.exists() ? sSnap.data() : {};

    // ── Rider ────────────────────────────────────────────────────────────────
    // GP หัก: ดึงจาก rider_credit ก่อน ถ้าไม่พอ → หักจาก rider_main (ค่าส่งที่เพิ่งได้)
    // ไม่มีการบล็อก — ไรเดอร์รับงานได้เสมอ
    if (riderRef) {
      const creditBal    = _getSubBal(rData, 'rider_credit');
      const riderMainBal = _getSubBal(rData, 'rider_main');

      // GP ส่วนที่ดึงจาก rider_credit (เท่าที่มี)
      const gpFromCredit = parseFloat(Math.min(Math.max(0, creditBal), riderGP).toFixed(2));
      // GP ส่วนที่เหลือ → หักตรงจากค่าส่งที่ได้รับ (rider_main)
      const gpFromMain   = parseFloat((riderGP - gpFromCredit).toFixed(2));
      // รายได้สุทธิเข้า rider_main = ค่าส่งทั้งหมด − GP ที่หักจาก main
      const netMainEarning = parseFloat((deliveryFee - gpFromMain).toFixed(2));

      bals.riderCreditBefore = creditBal;
      bals.riderCreditAfter  = parseFloat((creditBal - gpFromCredit).toFixed(2));
      bals.riderMainBefore   = riderMainBal;
      bals.riderMainAfter    = parseFloat((riderMainBal + netMainEarning).toFixed(2));
      bals.gpFromCredit      = gpFromCredit;
      bals.gpFromMain        = gpFromMain;

      // สร้าง wallet entries — แสดงให้ชัดเจนว่า GP มาจากที่ไหน
      let upd = rData;
      if (gpFromCredit > 0) {
        upd = _applySubWallet(upd, 'rider_credit', bals.riderCreditAfter, {
          id: `rc_${Date.now()}`, date: _thNow(),
          desc: `GP หัก ${orderLabel} (จากเครดิต)`, amount: -gpFromCredit,
        });
      }
      const mainDesc = gpFromMain > 0
        ? `ค่าส่ง ${orderLabel} (หักGP ฿${gpFromMain} จากค่าส่ง)`
        : `ค่าส่ง ${orderLabel}`;
      upd = _applySubWallet(upd, 'rider_main', bals.riderMainAfter, {
        id: `rm_${Date.now()}`, date: _thNow(), desc: mainDesc, amount: netMainEarning,
      });
      tx.set(riderRef, upd, { merge: true });
    }

    // ── Admin ────────────────────────────────────────────────────────────────
    if (adminRef && totalAdminGP > 0) {
      bals.adminBefore = _getSubBal(aData, 'admin_platform');
      bals.adminAfter  = parseFloat((bals.adminBefore + totalAdminGP).toFixed(2));
      const upd = _applySubWallet(aData, 'admin_platform', bals.adminAfter, {
        id: `ap_${Date.now()}`, date: _thNow(),
        desc: `GP ${orderLabel} (ไรเดอร์ ฿${riderGP}+ร้าน ฿${merchantGP})`,
        amount: totalAdminGP,
      });
      tx.set(adminRef, upd, { merge: true });
    }

    // ── Shop ─────────────────────────────────────────────────────────────────
    if (shopRef && shopEarning > 0) {
      bals.shopBefore = _getSubBal(sData, 'shop_settlement');
      bals.shopAfter  = parseFloat((bals.shopBefore + shopEarning).toFixed(2));
      const upd = _applySubWallet(sData, 'shop_settlement', bals.shopAfter, {
        id: `ss_${Date.now()}`, date: _thNow(),
        desc: `รายได้ ${orderLabel} (หลังหัก GP ฿${merchantGP})`,
        amount: shopEarning,
      });
      tx.set(shopRef, upd, { merge: true });
    }
  });

  // ── Write transaction logs (after commit) ─────────────────────────────────
  const logs = [];
  if (riderUid) {
    // log การหัก GP จาก rider_credit (เฉพาะที่หักได้จริง)
    if ((bals.gpFromCredit ?? 0) > 0) logs.push(createTransactionLog({
      order_id: orderId, user_id: riderUid,
      target_wallet_type: 'rider_credit', type: 'platform_gp_deduct', status: 'success',
      amount: -(bals.gpFromCredit), balance_before: bals.riderCreditBefore, balance_after: bals.riderCreditAfter,
      description: `GP หัก (จากเครดิต) ${orderLabel}`,
    }));
    // log รายได้สุทธิเข้า rider_main (ค่าส่ง − GP ที่หักจาก main)
    if (deliveryFee > 0) logs.push(createTransactionLog({
      order_id: orderId, user_id: riderUid,
      target_wallet_type: 'rider_main', type: 'delivery_fee', status: 'success',
      amount: bals.riderMainAfter - bals.riderMainBefore,
      balance_before: bals.riderMainBefore, balance_after: bals.riderMainAfter,
      description: (bals.gpFromMain ?? 0) > 0
        ? `ค่าส่ง ${orderLabel} (หักGP ฿${bals.gpFromMain} จากค่าส่ง)`
        : `ค่าส่ง ${orderLabel}`,
    }));
  }
  if (adminUid && totalAdminGP > 0) logs.push(createTransactionLog({
    order_id: orderId, user_id: adminUid,
    target_wallet_type: 'admin_platform', type: 'platform_gp_deduct', status: 'success',
    amount: totalAdminGP, balance_before: bals.adminBefore, balance_after: bals.adminAfter,
    description: `GP ${orderLabel} (ไรเดอร์+ร้านค้า)`,
  }));
  if (shopOwnerUid && shopEarning > 0) logs.push(createTransactionLog({
    order_id: orderId, user_id: shopOwnerUid,
    shop_id: order.restaurantId || order.shopId || null,
    target_wallet_type: 'shop_settlement', type: 'shop_revenue', status: 'success',
    amount: shopEarning, balance_before: bals.shopBefore, balance_after: bals.shopAfter,
    description: `รายได้ ${orderLabel} (หลังหัก GP)`,
  }));

  await Promise.allSettled(logs);
  return { riderGP, merchantGP, totalAdminGP, shopEarning };
};

// ─── Deposit (Top-up) Flow ───────────────────────────────────────────────────

/**
 * สร้าง topup request ในสถานะ pending (user แจ้งโอน, รอ admin อนุมัติ)
 * @param {string} userId
 * @param {string} walletType
 * @param {number} amount
 * @param {Object} bankInfo  - { bank, accountName, accountNumber, slipUrl? }
 * @param {string} description
 * @returns {string} txId
 */
export const createDepositRequest = async (userId, walletType, amount, bankInfo = {}, description = '') => {
  try {
    const ref  = doc(collection(db, 'transactions'));
    const txId = ref.id;
    await setDoc(ref, {
      transaction_id: txId, order_id: null,
      user_id: userId, shop_id: null,
      target_wallet_type: walletType,
      type: 'topup', status: 'pending',
      amount, balance_before: null, balance_after: null,
      bank_info: bankInfo,
      description: description || `เติมเงิน ${walletType}`,
      timestamp: serverTimestamp(),
    });
    return txId;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[createDepositRequest]', err?.code, err?.message);
    return null;
  }
};

/**
 * Admin อนุมัติ topup: credit wallet + mark 'success'
 * @param {string} txId
 */
export const approveDeposit = async (txId) => {
  const txRef  = doc(db, 'transactions', txId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new Error('Transaction not found');
  const tx = txSnap.data();
  if (tx.status !== 'pending') throw new Error(`Cannot approve: status is '${tx.status}'`);

  const { balance_before, balance_after } = await creditWalletByType(
    tx.user_id, tx.target_wallet_type, tx.amount,
    tx.description || `อนุมัติ topup ฿${tx.amount}`,
  );
  await updateDoc(txRef, { status: 'success', balance_before, balance_after, approvedAt: serverTimestamp() });
};

/**
 * Admin ปฏิเสธ topup request
 * @param {string} txId
 */
export const rejectDeposit = async (txId) => {
  await updateDoc(doc(db, 'transactions', txId), {
    status: 'rejected', rejectedAt: serverTimestamp(),
  });
};

// ─── Withdrawal Flow ─────────────────────────────────────────────────────────

/**
 * User ขอถอนเงิน: หักเงินทันที + สร้าง pending_approval record
 * @param {string} userId
 * @param {string} walletType - 'rider_main' | 'shop_settlement'
 * @param {number} amount
 * @param {Object} bankInfo   - { bank, accountName, accountNumber }
 * @param {string} description
 * @returns {string} txId
 */
export const holdWithdrawal = async (userId, walletType, amount, bankInfo = {}, description = '') => {
  const walletRef = doc(db, 'wallets', userId);
  let balBefore = 0;
  let balAfter  = 0;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(walletRef);
    const data = snap.exists() ? snap.data() : {};
    balBefore  = _getSubBal(data, walletType);
    if (balBefore < amount) throw new Error(`INSUFFICIENT_BALANCE: need ฿${amount}, have ฿${balBefore}`);
    balAfter   = parseFloat((balBefore - amount).toFixed(2));
    const entry = {
      id: `wd_${Date.now()}`, date: _thNow(),
      desc: description || `รอถอนเงิน ฿${amount.toLocaleString()}`, amount: -amount,
    };
    tx.set(walletRef, _applySubWallet(data, walletType, balAfter, entry), { merge: true });
  });

  const ref  = doc(collection(db, 'transactions'));
  const txId = ref.id;
  await setDoc(ref, {
    transaction_id: txId, order_id: null,
    user_id: userId, shop_id: null,
    target_wallet_type: walletType,
    type: 'withdraw', status: 'pending_approval',
    amount, balance_before: balBefore, balance_after: balAfter,
    bank_info: bankInfo,
    description: description || `ถอนเงิน ${walletType}`,
    timestamp: serverTimestamp(),
  });
  return txId;
};

/**
 * Admin อนุมัติการถอนเงิน (เงินถูก hold แล้ว → แค่ mark success)
 * @param {string} txId
 */
export const approveWithdrawal = async (txId) => {
  const txRef  = doc(db, 'transactions', txId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new Error('Transaction not found');
  if (txSnap.data().status !== 'pending_approval')
    throw new Error(`Cannot approve: status is '${txSnap.data().status}'`);
  await updateDoc(txRef, { status: 'success', approvedAt: serverTimestamp() });
};

/**
 * Admin ปฏิเสธการถอนเงิน: คืนเงินกลับ wallet + mark rejected (atomic)
 * @param {string} txId
 */
export const rejectWithdrawal = async (txId) => {
  const txRef  = doc(db, 'transactions', txId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new Error('Transaction not found');
  const txData = txSnap.data();
  if (txData.status !== 'pending_approval')
    throw new Error(`Cannot reject: status is '${txData.status}'`);

  const { user_id: userId, target_wallet_type: walletType, amount } = txData;
  const walletRef = doc(db, 'wallets', userId);

  await runTransaction(db, async (tx) => {
    const snap   = await tx.get(walletRef);
    const data   = snap.exists() ? snap.data() : {};
    const curBal = _getSubBal(data, walletType);
    const newBal = parseFloat((curBal + amount).toFixed(2));
    const entry  = {
      id: `wr_${Date.now()}`, date: _thNow(),
      desc: `คืนเงินถอน (ไม่อนุมัติ) ฿${amount.toLocaleString()}`, amount,
    };
    tx.set(walletRef, _applySubWallet(data, walletType, newBal, entry), { merge: true });
    tx.update(txRef, { status: 'rejected', rejectedAt: serverTimestamp() });
  });
};

// ─── loadMultiWallet / subscribeToMultiWallet ─────────────────────────────────

/**
 * โหลด multi-wallet ของ user ครั้งเดียว
 * @returns {{ rider_credit, rider_main, shop_settlement, admin_platform, raw } | null}
 */
export const loadMultiWallet = async (userId) => {
  try {
    const snap = await getDoc(doc(db, 'wallets', userId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      rider_credit:    { balance: d.rider_credit?.balance    ?? 0, history: d.rider_credit?.history    ?? [] },
      rider_main:      { balance: d.rider_main?.balance      ?? 0, history: d.rider_main?.history      ?? [] },
      shop_settlement: { balance: d.shop_settlement?.balance ?? 0, history: d.shop_settlement?.history ?? [] },
      admin_platform:  { balance: d.admin_platform?.balance  ?? (d.balance ?? 0), history: d.admin_platform?.history ?? (d.history ?? []) },
      raw: d,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.error('[loadMultiWallet]', err?.code, err?.message);
    return null;
  }
};

/**
 * Real-time subscription สำหรับ multi-wallet ของ user
 * @param {string} userId
 * @param {Function} callback  receives { rider_credit, rider_main, shop_settlement, admin_platform }
 * @returns unsubscribe function
 */
export const subscribeToMultiWallet = (userId, callback) => {
  return onSnapshot(doc(db, 'wallets', userId), (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const d = snap.data();
    callback({
      rider_credit:    { balance: d.rider_credit?.balance    ?? 0, history: d.rider_credit?.history    ?? [] },
      rider_main:      { balance: d.rider_main?.balance      ?? 0, history: d.rider_main?.history      ?? [] },
      shop_settlement: { balance: d.shop_settlement?.balance ?? 0, history: d.shop_settlement?.history ?? [] },
      admin_platform:  { balance: d.admin_platform?.balance  ?? (d.balance ?? 0), history: d.admin_platform?.history ?? (d.history ?? []) },
      raw: d,
    });
  }, (err) => {
    if (import.meta.env.DEV) console.error('[subscribeToMultiWallet]', err?.code, err?.message);
  });
};
