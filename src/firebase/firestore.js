import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs, addDoc,
  serverTimestamp, query, orderBy, limit, where, Timestamp,
  runTransaction, onSnapshot,
  increment, arrayUnion,
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

// ดึงเฉพาะ orders ใน 30 วันล่าสุด — ลด Firestore reads เมื่อ collection ขยายใหญ่
const thirtyDaysAgo = () => Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

export const loadAllOrders = async () => {
  try {
    const q = query(
      collection(db, 'orders'),
      where('updatedAt', '>=', thirtyDaysAgo()),
      orderBy('updatedAt', 'desc'),
      limit(500),
    );
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
  const q = query(
    collection(db, 'orders'),
    where('updatedAt', '>=', thirtyDaysAgo()),
    orderBy('updatedAt', 'desc'),
    limit(500),
  );
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
      return data;
    });
  } catch { return null; }
};

export const subscribeToRestaurants = (callback) => {
  return onSnapshot(collection(db, 'restaurants'), (snap) => {
    const list = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
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
    date: new Date().toLocaleString('th-TH'),
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

export const subscribeToRiders = (callback) => {
  return onSnapshot(collection(db, 'riders'), (snap) => {
    const list = snap.docs.map(d => {
      const data = d.data();
      if (data.updatedAt?.toDate) delete data.updatedAt;
      return data;
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

