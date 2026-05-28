import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  INITIAL_CONFIG, INITIAL_RESTAURANTS, INITIAL_RIDERS, INITIAL_MENU_ITEMS,
  USER_LOCATION, FIREBASE_ENABLED, ADMIN_UID,
} from '../constants';
import { generateId, getDistanceFromLatLonInKm, compressImage, playNotificationSound } from '../utils';
import {
  loginWithEmail, registerWithEmail, loginWithGoogle, logout as firebaseLogout, onAuthChange,
} from '../firebase/auth';
import { requestNotificationPermission, onForegroundMessage, saveFcmToken } from '../firebase/messaging';
import {
  saveOrder, updateOrderStatusInDB, saveAppConfig, loadAppConfig, loadAllOrders,
  saveWallet, loadWallet, creditWalletInDB, subscribeToWallet,
  saveRestaurant, loadRestaurants, deleteRestaurantFromDB,
  saveMenuItems, loadMenuItems,
  savePendingRequest, deletePendingRequest, loadPendingRequests, subscribeToPendingRequests,
  saveRider, loadRiders, deleteRiderFromDB, updateRiderLocation,
  saveChat, loadAllChats, subscribeToChats, deleteChatFromDB,
  saveUserProfile, loadUserProfile,
  safeLocalSet,
  acceptOrderTransaction, subscribeToOrders,
  atomicOrderCompletion,
} from '../firebase/firestore';
// (Firebase Storage ไม่ถูกใช้ — ใช้ compressImage + Firestore แทน)

const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ children }) {
  // --- Role & Navigation ---
  const [activeRole, setActiveRole] = useState('customer');
  const [adminTab, setAdminTab] = useState('dashboard');
  const [merchantTab, setMerchantTab] = useState('orders');
  const [riderTab, setRiderTab] = useState('jobs');
  const [activeTab, setActiveTab] = useState('home');
  const [profileSubView, setProfileSubView] = useState('main');
  const [serviceType, setServiceType] = useState('food');

  // --- Data State ---
  const [orders, setOrders] = useState([]);
  const [appConfig, setAppConfig] = useState(INITIAL_CONFIG);
  const [restaurants, setRestaurants] = useState(INITIAL_RESTAURANTS);
  const [riders, setRiders] = useState(INITIAL_RIDERS);
  const [menuItems, setMenuItems] = useState(INITIAL_MENU_ITEMS);
  const [pendingRequests, setPendingRequests] = useState([]);

  // --- Auth State ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ phone: '', email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ phone: '', email: '', password: '', confirmPassword: '', name: '' });
  const [authMode, setAuthMode] = useState('login');

  // --- User Profile State ---
  const [userProfile, setUserProfile] = useState({
    id: '',
    name: '',
    phone: '',
    email: '',
    location: USER_LOCATION,
  });
  const [userRoles, setUserRoles] = useState(['customer']);
  const [userAddresses, setUserAddresses] = useState([
    { id: 1, label: 'บ้าน', address: '123 คอนโดใจกลางเมือง', location: USER_LOCATION },
  ]);
  const [userWallet, setUserWallet] = useState(0);
  const [walletHistory, setWalletHistory] = useState([]);

  // --- Cart & Order State ---
  const [cart, setCart] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [parcelDetails, setParcelDetails] = useState({ pickup: '', dropoff: '', weight: '1', distance: 0, receiverName: '', receiverPhone: '' });
  const [paymentMethod, setPaymentMethod] = useState('wallet');

  // --- Form & Modal State ---
  const [newAddr, setNewAddr] = useState({ label: '', fullAddr: '', location: null });
  const [withdrawMode, setWithdrawMode] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBank, setWithdrawBank] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [withdrawName, setWithdrawName] = useState('');
  const [tempProfile, setTempProfile] = useState({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
  const [merchantRegForm, setMerchantRegForm] = useState({ shopName: '', category: 'Street Food', realName: '', idCard: '', phone: '', bankName: '', bankAccount: '', idCardImage: null, shopImage: null, location: null });
  const [riderRegForm, setRiderRegForm] = useState({ realName: '', vehicle: 'Motorcycle', idCard: '', phone: '', bankName: '', bankAccount: '', idCardImage: null, profileImage: null });
  const [editConfig, setEditConfig] = useState(INITIAL_CONFIG);
  const [isEditingMenu, setIsEditingMenu] = useState(null);
  const [editingShop, setEditingShop] = useState(null);
  const [shopEditForm, setShopEditForm] = useState({});
  const [editForm, setEditForm] = useState({ name: '', price: '', desc: '', image: '' });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedOrderToCancel, setSelectedOrderToCancel] = useState(null);
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedRequestToReject, setSelectedRequestToReject] = useState(null);
  const [riderJobPhotos, setRiderJobPhotos] = useState({});
  const [showProofModal, setShowProofModal] = useState(false);
  const [selectedProofOrder, setSelectedProofOrder] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);

  // --- TopUp Modal ---
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpSlip, setTopUpSlip] = useState(null);

  // --- Chat State ---
  const [activeChat, setActiveChat] = useState(null);
  const [chats, setChats] = useState(() => {
    try {
      const saved = localStorage.getItem('boomrider_chats');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  // --- Parcel Map State ---
  const [parcelMapTarget, setParcelMapTarget] = useState(null);
  const [parcelDistance, setParcelDistance] = useState(0);
  const [parcelEstimate, setParcelEstimate] = useState(0);

  // --- Toast State ---
  const [toasts, setToasts] = useState([]);

  // --- Admin Derived ---
  const isAdmin = !!ADMIN_UID && currentUser?.id === ADMIN_UID;

  // ── Refs สำหรับ notification ที่ต้องอ่านค่าปัจจุบันใน callback ───────────────
  // (ป้องกัน stale closure ใน onSnapshot)
  const restaurantsRef = React.useRef(INITIAL_RESTAURANTS);
  const currentUserRef = React.useRef(null);
  useEffect(() => { restaurantsRef.current = restaurants; }, [restaurants]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  // ── seenOrderIds — ป้องกัน notification ซ้ำ / false-positive ตอนโหลดครั้งแรก ──
  // ครั้งแรกที่ subscription fires → mark ทุก order ว่า "เห็นแล้ว" ไม่ต้อง notify
  // ครั้งถัดไป → notify เฉพาะ order ที่ id ไม่เคยเห็น
  const seenOrderIdsRef = React.useRef(new Set());
  const subInitializedRef = React.useRef(false);

  // ── กันกดสั่งซื้อซ้ำ (double-tap / race condition) ───────────────────────────
  const placingOrderRef = React.useRef(false);
  // ── ติดตาม orders ที่เพิ่งสร้างแต่ยังไม่ถูกยืนยันจาก Firestore ──────────────
  // ใช้เพื่อกันไม่ให้ orders เก่าใน localStorage ค้างอยู่ในรายการ
  const pendingLocalOrderIdsRef = React.useRef(new Set());
  // ── ติดตามจำนวนข้อความต่อ chatId เพื่อ detect "ข้อความใหม่" real-time ─────────
  const lastChatCountsRef = React.useRef({});
  // ── ป้องกัน notification ซ้ำตอน initial load ─────────────────────────────────
  const chatSubInitializedRef = React.useRef(false);
  // ── wallet subscription: flag บอกว่า setUserWallet มาจาก Firestore ────────────
  // ใช้ป้องกัน useEffect ไม่ให้เขียนยอดเก่ากลับ Firestore (write-back loop)
  const walletFromFirestoreRef = React.useRef(false);
  // ── กันไม่ให้ saveWallet เขียนยอดเก่าจาก localStorage ทับ Firestore ก่อน
  // subscription จะ fire ครั้งแรก (race condition ระหว่าง onAuthChange กับ subscribeToWallet)
  const walletSubscribedRef = React.useRef(false);
  const walletUnsubRef = React.useRef(null);

  // --- Global Wallet Store ---
  const [globalWallets, setGlobalWallets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('boomrider_wallets') || '{}'); } catch { return {}; }
  });

  // --- Global User Roles Store ---
  const [globalUserRoles, setGlobalUserRoles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}'); } catch { return {}; }
  });

  useEffect(() => {
    localStorage.setItem('boomrider_user_roles', JSON.stringify(globalUserRoles));
  }, [globalUserRoles]);

  const grantRole = (userId, role) => {
    setGlobalUserRoles(prev => {
      const cur = prev[userId] || ['customer'];
      if (cur.includes(role)) return prev;
      return { ...prev, [userId]: [...cur, role] };
    });
    if (currentUser?.id === userId || userProfile?.id === userId) {
      setUserRoles(prev => prev.includes(role) ? prev : [...prev, role]);
    }
  };

  useEffect(() => {
    localStorage.setItem('boomrider_wallets', JSON.stringify(globalWallets));
  }, [globalWallets]);

  const creditWallet = (userId, amount, desc) => {
    setGlobalWallets(prev => {
      const cur = prev[userId] || { balance: 0, history: [] };
      return {
        ...prev,
        [userId]: {
          balance: cur.balance + amount,
          history: [{ id: generateId(), type: amount > 0 ? 'deposit' : 'withdraw', amount, date: new Date().toLocaleString('th-TH'), desc }, ...cur.history],
        },
      };
    });
    if (currentUser?.id === userId) {
      setUserWallet(prev => prev + amount);
      setWalletHistory(prev => [{ id: generateId(), type: amount > 0 ? 'deposit' : 'withdraw', amount, date: new Date().toLocaleString('th-TH'), desc }, ...prev]);
    }
  };

  // --- Load from localStorage on mount ---
  useEffect(() => {
    const savedRestaurants = localStorage.getItem('boomrider_restaurants');
    if (savedRestaurants) { try { setRestaurants(JSON.parse(savedRestaurants)); } catch {} }
    const savedRiders = localStorage.getItem('boomrider_riders');
    if (savedRiders) { try { setRiders(JSON.parse(savedRiders)); } catch {} }
    const savedOrders = localStorage.getItem('boomrider_orders');
    if (savedOrders) { try { setOrders(JSON.parse(savedOrders)); } catch {} }
    const savedMenuItems = localStorage.getItem('boomrider_menu_items');
    if (savedMenuItems) { try { setMenuItems(JSON.parse(savedMenuItems)); } catch {} }
    const savedConfig = localStorage.getItem('boomrider_appconfig');
    if (savedConfig) { try { const c = JSON.parse(savedConfig); setAppConfig(c); setEditConfig(c); } catch {} }
    const savedPending = localStorage.getItem('boomrider_pending_requests');
    if (savedPending) { try { setPendingRequests(JSON.parse(savedPending)); } catch {} }
    if (FIREBASE_ENABLED) {
      // โหลด shared data จาก Firestore — ทุก device จะเห็นข้อมูลเดียวกัน
      Promise.all([
        loadAppConfig(),
        loadRestaurants(),
        loadMenuItems(),
        loadPendingRequests(),
        loadRiders(),
      ]).then(([cfg, cloudRestaurants, cloudMenus, cloudPending, cloudRiders]) => {
        if (cfg) { setAppConfig(cfg); setEditConfig(cfg); }
        if (cloudRestaurants && cloudRestaurants.length > 0) {
          setRestaurants(cloudRestaurants);
          safeLocalSet('boomrider_restaurants', cloudRestaurants);
        }
        if (cloudMenus && Object.keys(cloudMenus).length > 0) {
          setMenuItems(cloudMenus);
          safeLocalSet('boomrider_menu_items', cloudMenus);
        }
        // อัปเดตเสมอ (รวมถึงกรณี Admin อนุมัติหมดแล้ว = array ว่าง)
        if (cloudPending !== null) {
          setPendingRequests(cloudPending);
          safeLocalSet('boomrider_pending_requests', cloudPending);
        }
        if (cloudRiders && cloudRiders.length > 0) {
          setRiders(cloudRiders);
          safeLocalSet('boomrider_riders', cloudRiders);
        }
      }).catch(() => {});
    }
  }, []);

  // --- Admin notification ---
  const notifyAdmin = useCallback((title, message, type = 'warning') => {
    const notif = { id: Date.now(), title, message, type, at: new Date().toLocaleString('th-TH') };
    const queue = JSON.parse(localStorage.getItem('boomrider_admin_notifs') || '[]');
    queue.unshift(notif);
    localStorage.setItem('boomrider_admin_notifs', JSON.stringify(queue.slice(0, 50)));
    if (isAdmin) notifySystem(title, message, type);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Admin polling
  useEffect(() => {
    if (!isAdmin) return;
    const check = () => {
      const queue = JSON.parse(localStorage.getItem('boomrider_admin_notifs') || '[]');
      const last = parseInt(localStorage.getItem('boomrider_admin_last_check') || '0');
      const newNotifs = queue.filter(n => n.id > last);
      if (newNotifs.length > 0) {
        newNotifs.forEach(n => notifySystem(n.title, n.message, n.type));
        localStorage.setItem('boomrider_admin_last_check', String(Date.now()));
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  // --- Auto-save to localStorage (ใช้ safeLocalSet ป้องกัน QuotaExceededError) ---
  useEffect(() => { safeLocalSet('boomrider_restaurants', restaurants); }, [restaurants]);
  useEffect(() => { safeLocalSet('boomrider_riders', riders); }, [riders]);
  useEffect(() => { safeLocalSet('boomrider_orders', orders); }, [orders]);
  useEffect(() => { safeLocalSet('boomrider_menu_items', menuItems); }, [menuItems]);
  useEffect(() => { safeLocalSet('boomrider_appconfig', appConfig); }, [appConfig]);
  useEffect(() => { safeLocalSet('boomrider_pending_requests', pendingRequests); }, [pendingRequests]);

  // ── Fetch live wallet balances for users with pending withdraw/topup requests ──
  // Admin's globalWallets is a local cache; it won't have the correct balance of
  // other users unless we explicitly pull from Firestore when their requests arrive.
  useEffect(() => {
    if (!FIREBASE_ENABLED) return;
    const uids = [...new Set(
      pendingRequests
        .filter(r => r.type === 'withdraw' || r.type === 'topup')
        .map(r => r.userId)
        .filter(Boolean)
    )];
    if (!uids.length) return;
    uids.forEach(uid => {
      loadWallet(uid).then(w => {
        if (w != null) {
          setGlobalWallets(prev => ({
            ...prev,
            [uid]: { balance: w.balance ?? 0, history: w.history || [] },
          }));
        }
      }).catch(() => {});
    });
  }, [pendingRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grant merchant/rider role if user has a shop/rider entry (recovery mechanism)
  useEffect(() => {
    if (!isLoggedIn || !userProfile?.id) return;
    const uid = userProfile.id || currentUser?.id;
    if (!uid) return;
    if (restaurants.some(r => r.ownerId === uid) && !userRoles.includes('merchant')) {
      grantRole(uid, 'merchant');
    }
    if (riders.some(r => r.userId === uid) && !userRoles.includes('rider')) {
      grantRole(uid, 'rider');
    }
  }, [restaurants, riders, userProfile?.id, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync userRoles from globalUserRoles when it changes (catches cross-tab/session updates)
  useEffect(() => {
    if (!isLoggedIn) return;
    const uid = currentUser?.id || userProfile?.id;
    if (!uid) return;
    const latestRoles = globalUserRoles[uid];
    if (!latestRoles || latestRoles.length === 0) return;
    const withAdmin = ADMIN_UID && uid === ADMIN_UID
      ? [...new Set([...latestRoles, 'admin'])]
      : latestRoles;
    setUserRoles(prev => {
      if (withAdmin.length === prev.length && withAdmin.every(r => prev.includes(r))) return prev;
      return withAdmin;
    });
  }, [globalUserRoles, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auth Session Restore ---
  useEffect(() => {
    const savedUser = localStorage.getItem('boomrider_user');
    if (savedUser) {
      const user = JSON.parse(savedUser);
      const allRoles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
      const latestRoles = allRoles[user.id] || allRoles[user.profile?.id] || user.roles || ['customer'];
      const mergedRoles = ADMIN_UID && (user.id === ADMIN_UID || user.profile?.id === ADMIN_UID)
        ? [...new Set([...latestRoles, 'admin'])]
        : latestRoles;
      setCurrentUser({ ...user, roles: mergedRoles });
      setIsLoggedIn(true);
      setUserProfile(user.profile);
      setTempProfile(user.profile);
      setUserRoles(mergedRoles);
      const gw = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}')[user.id];
      setUserWallet(gw?.balance ?? user.wallet ?? 0);
      setWalletHistory(gw?.history ?? user.walletHistory ?? []);
      setUserAddresses(user.addresses || []);
    }

    if (FIREBASE_ENABLED) {
      const unsubscribe = onAuthChange(async (firebaseUser) => {
        if (!firebaseUser) {
          // ── Logout ────────────────────────────────────────────────────────
          const savedRaw = localStorage.getItem('boomrider_user');
          const saved = savedRaw ? JSON.parse(savedRaw) : null;
          if (saved && saved.id && saved.id.length > 20) {
            localStorage.removeItem('boomrider_user');
            setIsLoggedIn(false);
            setCurrentUser(null);
          }
          return;
        }

        // ── ดึง saved user จาก localStorage ──────────────────────────────
        const savedRaw = localStorage.getItem('boomrider_user');
        const saved = savedRaw ? JSON.parse(savedRaw) : null;
        const isExistingSession = saved?.id === firebaseUser.uid;

        if (!isExistingSession) {
          // ── Login ใหม่ — สร้าง/อัปเดต profile ────────────────────────
          // ใช้ตำแหน่งที่บันทึกไว้ใน localStorage (ถ้ามี) แทน USER_LOCATION
          const savedLocation = saved?.profile?.location
            || (() => {
              try { return JSON.parse(localStorage.getItem(`boomrider_loc_${firebaseUser.uid}`) || 'null'); } catch { return null; }
            })()
            || USER_LOCATION;

          const profile = {
            id:       firebaseUser.uid,
            name:     firebaseUser.displayName || saved?.profile?.name || firebaseUser.email || 'ผู้ใช้ใหม่',
            phone:    firebaseUser.phoneNumber  || saved?.profile?.phone || '',
            email:    firebaseUser.email || '',
            image:    firebaseUser.photoURL     || saved?.profile?.image || null,
            location: savedLocation,
          };
          const allRolesMap = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
          const storedRoles = allRolesMap[firebaseUser.uid] || saved?.roles || ['customer'];
          const baseRoles   = ADMIN_UID && firebaseUser.uid === ADMIN_UID
            ? [...new Set([...storedRoles, 'admin'])]
            : storedRoles;
          const newUser = {
            id: firebaseUser.uid,
            phone: firebaseUser.phoneNumber || '',
            email: firebaseUser.email || '',
            profile,
            roles:         baseRoles,
            wallet:        saved?.wallet !== undefined ? saved.wallet : 0,
            walletHistory: saved?.walletHistory || [],
            addresses:     saved?.addresses || [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
          };
          setCurrentUser(newUser);
          setIsLoggedIn(true);
          setUserProfile(profile);
          setTempProfile(profile);
          setUserRoles(baseRoles);
          localStorage.setItem('boomrider_user', JSON.stringify(newUser));
        } else {
          // ── Session เดิม (โหลดหน้าใหม่ / token refresh) ──────────────
          // โหลดตำแหน่งที่ปักหมุดไว้จาก Firestore + localStorage
          try {
            const cloudProfile = await loadUserProfile(firebaseUser.uid);
            if (cloudProfile?.location) {
              const loc = cloudProfile.location;
              setUserProfile(prev => ({ ...prev, location: loc }));
              // เก็บ snapshot ไว้ใน key เฉพาะตัว ป้องกัน overwrite
              localStorage.setItem(`boomrider_loc_${firebaseUser.uid}`, JSON.stringify(loc));
            }
          } catch (_) {}
        }

        // ── ALWAYS: cleanup subscription เก่าแล้วสร้างใหม่ ──────────────
        // (สำคัญ: ต้องทำทุกครั้ง ไม่ว่าจะ session ใหม่หรือเก่า
        //  ป้องกัน subscription หาย เมื่อ token refresh / page reload)
        if (window.__boomriderUnsubOrders) {
          window.__boomriderUnsubOrders();
          window.__boomriderUnsubOrders = null;
        }
        // reset seen-set สำหรับ subscription ใหม่
        seenOrderIdsRef.current = new Set();
        subInitializedRef.current = false;
        pendingLocalOrderIdsRef.current = new Set();

        // ── โหลด orders ครั้งแรก (ทันที) ────────────────────────────────
        // ใช้ STATUS_RANK merge เพื่อป้องกัน Firestore state เก่า override local completed orders
        try {
          const initialOrders = await loadAllOrders();
          if (initialOrders && initialOrders.length > 0) {
            const STATUS_RANK = {
              pending: 1, preparing: 2, ready_to_pickup: 3,
              rider_accepted: 4, picking_up: 5, delivering: 6,
              delivered: 7, completed: 8, cancelled: 9,
            };
            setOrders(prev => {
              const localMap = new Map(prev.map(o => [o.id, o]));
              const merged = initialOrders.map(co => {
                const lo = localMap.get(co.id);
                if (!lo) return co;
                const cloudRank = STATUS_RANK[co.status] ?? 0;
                const localRank = STATUS_RANK[lo.status] ?? 0;
                return localRank > cloudRank ? lo : co;
              });
              prev.forEach(lo => {
                if (!merged.find(co => co.id === lo.id)) {
                  if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
                }
              });
              const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
              deduped.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
              safeLocalSet('boomrider_orders', deduped);
              return deduped;
            });
          }
        } catch (_) {}

        // ── Subscribe real-time orders (onSnapshot) ──────────────────────
        const unsubOrders = subscribeToOrders(
          (cloudOrders) => {
            // ── ครั้งแรกที่ fires: mark ทุก order เป็น "เห็นแล้ว" ────────
            if (!subInitializedRef.current) {
              cloudOrders.forEach(co => {
                seenOrderIdsRef.current.add(co.id);
                // mark completed orders ที่มีอยู่แล้ว ไม่ต้องแจ้งเตือนซ้ำ
                if (co.status === 'completed') seenOrderIdsRef.current.add(`${co.id}_completed`);
              });
              subInitializedRef.current = true;
            } else {
              // ── ครั้งถัดไป: notify เฉพาะ order ใหม่จริงๆ ─────────────
              const uid     = currentUserRef.current?.id;
              const myShop  = uid ? restaurantsRef.current.find(r => r.ownerId === uid) : null;

              // แจ้งเตือนออเดอร์ใหม่เข้าร้าน
              if (myShop) {
                const newMerchantOrders = cloudOrders.filter(co =>
                  co.status === 'pending' &&
                  co.restaurantId === myShop.id &&
                  !seenOrderIdsRef.current.has(co.id),
                );
                if (newMerchantOrders.length > 0) {
                  playNotificationSound('order');
                  setTimeout(() => notifySystem(
                    '🛎️ ออเดอร์ใหม่เข้าร้าน!',
                    `มี ${newMerchantOrders.length} ออเดอร์ใหม่รอยืนยัน`,
                    'warning',
                  ), 0);
                }
              }

              // แจ้งเตือนงานใหม่สำหรับไรเดอร์
              const newJobs = cloudOrders.filter(co =>
                co.status === 'ready_to_pickup' &&
                !co.riderId &&
                !seenOrderIdsRef.current.has(co.id),
              );
              if (newJobs.length > 0) {
                playNotificationSound('rider');
                setTimeout(() => notifySystem(
                  '🔔 มีงานใหม่เข้า!',
                  `${newJobs.length} งานรอรับในบริเวณใกล้เคียง`,
                  'warning',
                ), 0);
              }

              // ── แจ้งเตือนลูกค้าว่าออเดอร์จัดส่งสำเร็จ ──────────────
              if (uid) {
                const justCompleted = cloudOrders.filter(co =>
                  co.status === 'completed' &&
                  co.customerId === uid &&
                  !seenOrderIdsRef.current.has(`${co.id}_completed`),
                );
                if (justCompleted.length > 0) {
                  justCompleted.forEach(co => seenOrderIdsRef.current.add(`${co.id}_completed`));
                  playNotificationSound('order');
                  const label = justCompleted[0].type === 'parcel' ? 'พัสดุ' : 'อาหาร';
                  setTimeout(() => notifySystem(
                    `✅ จัดส่ง${label}สำเร็จ!`,
                    `ออเดอร์ #${justCompleted[0].id.slice(-8)} ถึงมือคุณแล้ว 🎉`,
                    'success',
                  ), 0);
                }

                // ── แจ้งเตือนลูกค้าว่าออเดอร์ถูกยกเลิก ──────────────────
                const justCancelled = cloudOrders.filter(co =>
                  co.status === 'cancelled' &&
                  co.customerId === uid &&
                  !seenOrderIdsRef.current.has(`${co.id}_cancelled`),
                );
                if (justCancelled.length > 0) {
                  justCancelled.forEach(co => seenOrderIdsRef.current.add(`${co.id}_cancelled`));
                  const reason = justCancelled[0].cancelReason ? `: ${justCancelled[0].cancelReason}` : '';
                  setTimeout(() => notifySystem(
                    '❌ ออเดอร์ถูกยกเลิก',
                    `#${justCancelled[0].id.slice(-8)}${reason}`,
                    'error',
                  ), 0);
                }
              }

              // mark order ใหม่ทั้งหมดว่าเห็นแล้ว
              cloudOrders.forEach(co => seenOrderIdsRef.current.add(co.id));
            }

            // Merge cloud + local — prefer the more-advanced status (STATUS_RANK)
            const STATUS_RANK = {
              pending: 1, preparing: 2, ready_to_pickup: 3,
              rider_accepted: 4, picking_up: 5, delivering: 6,
              delivered: 7, completed: 8, cancelled: 9,
            };
            setOrders(prev => {
              const localMap = new Map(prev.map(o => [o.id, o]));
              // For each cloud order, keep local version if its status is more advanced
              const merged = cloudOrders.map(co => {
                const lo = localMap.get(co.id);
                if (lo) {
                  // Order confirmed by Firestore — remove from pending-local set
                  pendingLocalOrderIdsRef.current.delete(co.id);
                }
                if (!lo) return co;
                const cloudRank = STATUS_RANK[co.status] ?? 0;
                const localRank = STATUS_RANK[lo.status] ?? 0;
                return localRank > cloudRank ? lo : co;
              });
              // Append local-only orders — แต่เฉพาะที่เพิ่งสร้างในเซสชันนี้
              // (ป้องกัน orders เก่าจาก localStorage ค้างอยู่โดยที่ Firestore ไม่มี)
              prev.forEach(lo => {
                if (!merged.find(co => co.id === lo.id)) {
                  if (pendingLocalOrderIdsRef.current.has(lo.id)) {
                    merged.push(lo); // ยังรอ Firestore confirm
                  }
                  // orders อื่นที่ไม่อยู่ใน Firestore → ตัดทิ้ง
                }
              });
              // Deduplicate by id (safety net)
              const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
              deduped.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
              safeLocalSet('boomrider_orders', deduped);
              return deduped;
            });
          },
          async () => {
            try {
              const fallback = await loadAllOrders();
              if (fallback && fallback.length > 0) {
                const STATUS_RANK = {
                  pending: 1, preparing: 2, ready_to_pickup: 3,
                  rider_accepted: 4, picking_up: 5, delivering: 6,
                  delivered: 7, completed: 8, cancelled: 9,
                };
                setOrders(prev => {
                  const localMap = new Map(prev.map(o => [o.id, o]));
                  const merged = fallback.map(co => {
                    const lo = localMap.get(co.id);
                    if (!lo) return co;
                    const cloudRank = STATUS_RANK[co.status] ?? 0;
                    const localRank = STATUS_RANK[lo.status] ?? 0;
                    return localRank > cloudRank ? lo : co;
                  });
                  prev.forEach(lo => {
                    if (!merged.find(co => co.id === lo.id)) {
                      if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
                    }
                  });
                  const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
                  deduped.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
                  safeLocalSet('boomrider_orders', deduped);
                  return deduped;
                });
              }
            } catch (_) {}
          },
        );
        window.__boomriderUnsubOrders = unsubOrders;

        // ── Subscribe real-time pending_requests (onSnapshot) ────────────
        // Admin → ดูทุก request (ไม่กรอง)
        // Non-admin → กรองเฉพาะของตัวเอง ป้องกัน PERMISSION_DENIED
        // (Firestore security rules evaluate per-document → query คืน doc ของ user อื่น = denied ทั้ง query)
        if (window.__boomriderUnsubPending) {
          window.__boomriderUnsubPending();
          window.__boomriderUnsubPending = null;
        }
        const isFirebaseAdmin = ADMIN_UID && firebaseUser.uid === ADMIN_UID;
        const unsubPending = subscribeToPendingRequests(
          (cloudPending) => {
            setPendingRequests(cloudPending);
            safeLocalSet('boomrider_pending_requests', cloudPending);
          },
          undefined,
          isFirebaseAdmin ? null : firebaseUser.uid,
        );
        window.__boomriderUnsubPending = unsubPending;

        // ── Subscribe real-time chats (onSnapshot) ───────────────────────
        // ทำให้ Admin และลูกค้าส่ง/รับข้อความข้าม device ได้แบบ real-time
        if (window.__boomriderUnsubChats) {
          window.__boomriderUnsubChats();
          window.__boomriderUnsubChats = null;
        }
        // reset chat notification state ทุกครั้งที่ login ใหม่
        lastChatCountsRef.current = {};
        chatSubInitializedRef.current = false;

        // ── ใช้ firebaseUser.uid แทน uid (ซึ่งไม่ได้ประกาศใน scope นี้) ──────
        const fbUid = firebaseUser.uid;
        const isAdminSession = fbUid === ADMIN_UID;

        const unsubChats = subscribeToChats((cloudChats) => {
          // ── ตรวจหาข้อความใหม่ (ข้าม initial snapshot) ─────────────────
          if (!chatSubInitializedRef.current) {
            // initial load — บันทึกจำนวนข้อความปัจจุบันโดยไม่ notify
            Object.entries(cloudChats).forEach(([id, msgs]) => {
              lastChatCountsRef.current[id] = (msgs || []).length;
            });
            chatSubInitializedRef.current = true;
          } else {
            // subsequent updates — ตรวจหาข้อความใหม่
            Object.entries(cloudChats).forEach(([chatId, msgs]) => {
              if (!msgs || msgs.length === 0) return;
              const prevCount = lastChatCountsRef.current[chatId] || 0;
              if (msgs.length <= prevCount) return; // ไม่มีข้อความใหม่

              const newMsgs = msgs.slice(prevCount);
              lastChatCountsRef.current[chatId] = msgs.length;

              // ── Admin: แจ้งเตือนเมื่อลูกค้าส่งข้อความ support ──────────
              if (isAdminSession && chatId.startsWith('support-')) {
                const hasNewFromUser = newMsgs.some(m => m.sender !== 'admin');
                if (hasNewFromUser) {
                  const lastMsg = newMsgs.filter(m => m.sender !== 'admin').pop();
                  setTimeout(() => notifySystem(
                    '💬 ข้อความใหม่จากลูกค้า',
                    `${lastMsg.senderName || 'ลูกค้า'}: ${String(lastMsg.text || '').substring(0, 60)}`,
                    'info',
                  ), 0);
                }
              }

              // ── ลูกค้า: แจ้งเตือนเมื่อ Admin ตอบกลับ support chat ของตัวเอง ─
              if (!isAdminSession && chatId === `support-${fbUid}`) {
                const adminReply = newMsgs.find(m => m.sender === 'admin');
                if (adminReply) {
                  setTimeout(() => notifySystem(
                    '💬 เจ้าหน้าที่ตอบกลับแล้ว',
                    String(adminReply.text || '').substring(0, 60),
                    'info',
                  ), 0);
                }
              }
            });
          }

          // ── Cloud is source of truth — deleted chats must not resurface ──
          setChats(prev => {
            const merged = {};
            Object.entries(cloudChats).forEach(([id, msgs]) => {
              const local = prev[id] || [];
              merged[id] = local.length > msgs.length ? local : msgs;
            });
            try { localStorage.setItem('boomrider_chats', JSON.stringify(merged)); } catch {}
            return merged;
          });
        });
        window.__boomriderUnsubChats = unsubChats;

        // โหลด chats ครั้งแรก (เผื่อ onSnapshot ช้า)
        loadAllChats().then(cloudChats => {
          if (cloudChats && Object.keys(cloudChats).length > 0) {
            setChats(prev => {
              const merged = { ...prev, ...cloudChats };
              try { localStorage.setItem('boomrider_chats', JSON.stringify(merged)); } catch {}
              return merged;
            });
          }
        }).catch(() => {});

        // ── Subscribe wallet (real-time) ─────────────────────────────────
        // เมื่อ Admin อนุมัติ topup/withdraw → Firestore เปลี่ยน → callback นี้ fire ทันที
        if (walletUnsubRef.current) walletUnsubRef.current(); // cleanup ตัวเก่า
        walletSubscribedRef.current = false; // reset — ยัง subscribe ใหม่ไม่ fire
        if (FIREBASE_ENABLED) {
          walletUnsubRef.current = subscribeToWallet(firebaseUser.uid, (data) => {
            walletFromFirestoreRef.current = true;   // บอก useEffect ว่า "มาจาก Firestore"
            walletSubscribedRef.current = true;      // subscription fire แล้ว — saveWallet ทำได้
            setUserWallet(data.balance ?? 0);
            setWalletHistory(data.history ?? []);
          });
        } else {
          // Firebase ปิด → fallback โหลดครั้งเดียว
          try {
            const cloudWallet = await loadWallet(firebaseUser.uid);
            if (cloudWallet) {
              setUserWallet(cloudWallet.balance ?? 0);
              setWalletHistory(cloudWallet.history ?? []);
            }
          } catch (_) {}
        }

        try {
          const fcmToken = await requestNotificationPermission();
          if (fcmToken) await saveFcmToken(firebaseUser.uid, fcmToken);
        } catch (_) {}
      });
      onForegroundMessage((msg) => {
        notifySystem(msg.title, msg.body, 'info');
      });
      return () => unsubscribe();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save user data to localStorage on change
  useEffect(() => {
    if (isLoggedIn && currentUser) {
      const updatedUser = {
        ...currentUser,
        profile: userProfile,
        roles: userRoles,
        wallet: userWallet,
        walletHistory: walletHistory,
        addresses: userAddresses,
      };
      localStorage.setItem('boomrider_user', JSON.stringify(updatedUser));
      // ── Sync wallet ไป Firestore เฉพาะเมื่อ user เปลี่ยนยอดเอง ─────────────
      // walletFromFirestoreRef = true → ยอดมาจาก Firestore → ห้ามเขียนกลับ
      // walletSubscribedRef = false → subscription ยังไม่ fire → ห้ามเขียน (ป้องกัน stale localStorage ทับ Firestore)
      if (FIREBASE_ENABLED) {
        if (walletFromFirestoreRef.current) {
          walletFromFirestoreRef.current = false; // reset flag
        } else if (walletSubscribedRef.current) {
          saveWallet(currentUser.id, userWallet, walletHistory).catch(() => {});
        }
      }
    }
  }, [userProfile, userRoles, userWallet, walletHistory, userAddresses]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Toast / Notification ---
  const notifySystem = (title, message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
    try {
      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch {}
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // --- Real-time Rider Location Simulation ---
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prevOrders => prevOrders.map(order => {
        if (['rider_accepted', 'picking_up', 'delivering'].includes(order.status) && order.riderId) {
          const currentPos = order.riderLocation || order.pickupLocation || USER_LOCATION;
          const targetPos = ['delivering'].includes(order.status)
            ? (order.location || USER_LOCATION)
            : (order.pickupLocation || USER_LOCATION);
          const step = 0.05;
          const newLat = currentPos.lat + (targetPos.lat - currentPos.lat) * step;
          const newLng = currentPos.lng + (targetPos.lng - currentPos.lng) * step;
          let newX = currentPos.x;
          let newY = currentPos.y;
          if (currentPos.x !== undefined && targetPos.x !== undefined) {
            newX = currentPos.x + (targetPos.x - currentPos.x) * step;
            newY = currentPos.y + (targetPos.y - currentPos.y) * step;
          }
          return { ...order, riderLocation: { lat: newLat, lng: newLng, x: newX, y: newY } };
        }
        return order;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Update Parcel Estimate
  useEffect(() => {
    if (parcelDetails.pickupLocation && parcelDetails.dropoffLocation) {
      const d = getDistanceFromLatLonInKm(
        parcelDetails.pickupLocation.lat, parcelDetails.pickupLocation.lng,
        parcelDetails.dropoffLocation.lat, parcelDetails.dropoffLocation.lng,
      );
      setParcelDistance(d);
      setParcelEstimate(Math.ceil(appConfig.baseFee + (d * appConfig.perKmFee)));
    }
  }, [parcelDetails.pickupLocation, parcelDetails.dropoffLocation, appConfig]);

  // --- Chat ---
  // Persist chats to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem('boomrider_chats', JSON.stringify(chats)); } catch {}
  }, [chats]);

  const openChatWindow = (id, title, role) => {
    setChats(prev => prev[id] ? prev : { ...prev, [id]: [] });
    setActiveChat({ id, title, role });
  };
  const closeChatWindow = () => setActiveChat(null);

  const sendMessage = (text) => {
    if (!text.trim() || !activeChat) return;
    const newMessage = {
      text: text.trim(),
      sender: activeRole,
      senderName: activeRole === 'admin' ? 'เจ้าหน้าที่'
                : activeRole === 'rider'  ? 'ไรเดอร์'
                : activeRole === 'merchant' ? 'ร้านค้า'
                : userProfile?.name || 'ลูกค้า',
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };
    setChats(prev => {
      const updated = { ...prev, [activeChat.id]: [...(prev[activeChat.id] || []), newMessage] };
      // Sync to Firestore ทันทีที่ส่งข้อความ (ทำให้ cross-device ทำงานได้)
      if (FIREBASE_ENABLED) {
        saveChat(activeChat.id, updated[activeChat.id]).catch(() => {});
      }
      return updated;
    });
  };

  const deleteChat = (chatId) => {
    setChats(prev => {
      const next = { ...prev };
      delete next[chatId];
      try {
        localStorage.setItem('boomrider_chats', JSON.stringify(next));
      } catch {}
      return next;
    });
    if (activeChat?.id === chatId) setActiveChat(null);
    if (FIREBASE_ENABLED) deleteChatFromDB(chatId).catch(() => {});
  };

  // --- Location helpers ---
  const reverseGeocode = useCallback(async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=th`,
        { headers: { 'Accept-Language': 'th' } },
      );
      const data = await res.json();
      return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }, []);

  const handleMapLocationSelect = async (loc) => {
    setNewAddr(prev => ({ ...prev, location: loc, fullAddr: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` }));
    const addr = await reverseGeocode(loc.lat, loc.lng);
    setNewAddr(prev => ({ ...prev, location: loc, fullAddr: addr }));
  };

  const handleParcelMapSelect = async (loc) => {
    const addr = await reverseGeocode(loc.lat, loc.lng);
    if (parcelMapTarget === 'pickup') {
      setParcelDetails(prev => ({ ...prev, pickup: addr, pickupLocation: loc }));
    } else if (parcelMapTarget === 'dropoff') {
      setParcelDetails(prev => ({ ...prev, dropoff: addr, dropoffLocation: loc }));
    }
  };

  const getCurrentLocationForForm = () => {
    if (!navigator.geolocation) return notifySystem("ผิดพลาด", "Browser ไม่รองรับ GPS", "error");
    notifySystem("กำลังดึงพิกัด", "รอสักครู่...", "info");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
      setNewAddr(prev => ({ ...prev, location: loc }));
      const addr = await reverseGeocode(loc.lat, loc.lng);
      setNewAddr(prev => ({ ...prev, location: loc, fullAddr: addr }));
      notifySystem("สำเร็จ", "ดึงพิกัดปัจจุบันและที่อยู่เรียบร้อย!", "success");
    }, () => {
      notifySystem("ผิดพลาด", "ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS", "error");
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  /**
   * ดึง GPS ปัจจุบันแล้วเซ็ตเป็น pickup หรือ dropoff ในฟอร์มส่งพัสดุ
   * @param {'pickup'|'dropoff'} target
   */
  const getCurrentLocationForParcel = (target) => {
    if (!navigator.geolocation) return notifySystem("ผิดพลาด", "Browser ไม่รองรับ GPS", "error");
    notifySystem("กำลังดึงพิกัด", "กำลังหาตำแหน่งของคุณ...", "info");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
      const addr = await reverseGeocode(loc.lat, loc.lng);
      if (target === 'pickup') {
        setParcelDetails(prev => ({ ...prev, pickup: addr, pickupLocation: loc }));
        setParcelMapTarget('pickup');
      } else {
        setParcelDetails(prev => ({ ...prev, dropoff: addr, dropoffLocation: loc }));
        setParcelMapTarget('dropoff');
      }
      notifySystem("สำเร็จ", `ตั้ง${target === 'pickup' ? 'จุดรับ' : 'จุดส่ง'}เป็นตำแหน่งปัจจุบันแล้ว`, "success");
    }, () => {
      notifySystem("ผิดพลาด", "ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS", "error");
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  // --- Helpers ---
  const isPending = (type) => pendingRequests.some(r => r.type === type && r.userId === userProfile.id);
  // ตรวจว่า order นี้มีคำขอยกเลิกค้างอยู่ (ยังไม่ถูก Admin อนุมัติ/ปฏิเสธ)
  const hasPendingCancelRequest = (orderId) =>
    pendingRequests.some(r => r.type === 'cancel_order' && r.data?.orderId === orderId);
  const calculateDeliveryFee = (distance) => appConfig.baseFee + (Math.ceil(distance) * appConfig.perKmFee);
  const calculateFoodTotal = () => cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  // --- Cart ---
  const addToCart = (item, restaurantId, restaurantName, distance) => {
    if (!item.available) return notifySystem("ขออภัย", "เมนูนี้หมดแล้ว", "error");
    if (cart.length > 0 && cart[0].restaurantId !== restaurantId) {
      if (!window.confirm("คุณต้องการเริ่มออเดอร์ใหม่จากร้านนี้ใช่ไหม? (ตะกร้าเก่าจะถูกลบ)")) return;
      setCart([{ ...item, restaurantId, restaurantName, qty: 1, distance }]);
    } else {
      const existing = cart.find(c => c.id === item.id);
      if (existing) {
        setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      } else {
        setCart([...cart, { ...item, restaurantId, restaurantName, qty: 1, distance }]);
      }
      notifySystem("เพิ่มลงตะกร้า", `เพิ่ม ${item.name} แล้ว`, "success");
    }
  };

  // --- Wallet ---
  const processTransaction = (type, amount, description) => {
    setUserWallet(prev => prev + amount);
    setWalletHistory(prev => [{
      id: generateId(), type, amount,
      date: new Date().toLocaleString('th-TH'),
      desc: description,
    }, ...prev]);
  };

  // --- Order Placement ---
  const placeOrder = (promoDiscount = 0) => {
    // ── กัน double-tap / race condition ────────────────────────────────────────
    if (placingOrderRef.current || cart.length === 0) return;
    placingOrderRef.current = true;
    setTimeout(() => { placingOrderRef.current = false; }, 3000);

    const distance = cart[0].distance;
    const foodTotal = calculateFoodTotal();
    const deliveryFee = calculateDeliveryFee(distance);
    const grandTotal = Math.max(0, foodTotal + deliveryFee - (promoDiscount || 0));
    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
      placingOrderRef.current = false;
      return notifySystem("ยอดเงินไม่พอ", "กรุณาเติมเงินหรือเลือกชำระเงินสด", "error");
    }
    // ── หัก promoDiscount ออกจาก adminGP (Admin รับผิดชอบค่าส่วนลด) ─────────
    const adminGP = Math.max(0, (foodTotal * (appConfig.gpFood / 100)) + (deliveryFee * (appConfig.gpDelivery / 100)) - (promoDiscount || 0));
    const merchantIncome = foodTotal * (1 - (appConfig.gpFood / 100));
    const riderIncome = deliveryFee * (1 - (appConfig.gpDelivery / 100));
    // ── ใช้ generateId() แทน Math.random()*10000 — ป้องกัน ID ชน ───────────
    const newOrder = {
      id: `OD-${generateId()}`,
      type: 'food',
      items: cart,
      foodTotal,
      deliveryFee,
      promoDiscount: promoDiscount || 0,
      grandTotal,
      paymentMethod,
      distance,
      adminGP,
      merchantIncome,
      riderIncome,
      restaurantId: cart[0].restaurantId,
      restaurantName: cart[0].restaurantName,
      restaurantPhone: restaurants.find(r => r.id === cart[0].restaurantId)?.phone || '',
      // ── merchantUid = Firebase UID ของเจ้าของร้าน (ใช้ใน Firestore rules) ──
      merchantUid: restaurants.find(r => r.id === cart[0].restaurantId)?.ownerId || null,
      status: 'pending',
      customerName: userProfile.name,
      customerPhone: userProfile.phone,
      customerId: userProfile.id,
      address: userAddresses[0]?.address,
      location: userProfile.location || userAddresses[0]?.location || USER_LOCATION,
      pickupLocation: restaurants.find(r => r.id === cart[0].restaurantId)?.location || USER_LOCATION,
      timestamp: new Date().toLocaleString('th-TH'),
      riderId: null,
      riderUid: null,
      riderLocation: null,
      pickupPhoto: null,
      deliveryPhoto: null,
    };
    const restaurantName = cart[0]?.restaurantName || '';
    // ── mark as pending-local จนกว่า Firestore จะยืนยัน ─────────────────────
    pendingLocalOrderIdsRef.current.add(newOrder.id);
    // ── functional update — ป้องกัน stale closure overwrite orders ──────────
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
    setCart([]);
    if (paymentMethod === 'wallet') {
      processTransaction('payment', -grandTotal, `ชำระค่าอาหาร (${restaurantName})`);
    }
    if (FIREBASE_ENABLED) saveOrder(newOrder).catch(() => {});
    setPaymentMethod('wallet');
    notifySystem("สั่งซื้อสำเร็จ", "ออเดอร์ถูกส่งไปยังร้านค้าแล้ว", "success");
    notifyAdmin("🛍️ ออเดอร์ใหม่", `${userProfile.name} สั่งจาก ${restaurantName} ฿${grandTotal}`, "info");
    setTimeout(() => notifySystem("ร้านค้า", "มีออเดอร์ใหม่เข้ามา!", "warning"), 1000);
    setActiveTab('activity');
    setSelectedRestaurant(null);
  };

  const placeParcelOrder = () => {
    // ── กัน double-tap ─────────────────────────────────────────────────────
    if (placingOrderRef.current) return;
    // ── ตรวจสอบเฉพาะ text field — ไม่บังคับปักหมุด ──────────────────────
    if (!parcelDetails.pickup || !parcelDetails.dropoff) {
      return notifySystem("ข้อมูลไม่ครบ", "กรุณาระบุจุดรับและจุดส่ง", "error");
    }
    placingOrderRef.current = true;
    setTimeout(() => { placingOrderRef.current = false; }, 3000);

    // ── คำนวณค่าส่ง ─────────────────────────────────────────────────────
    // ถ้าปักหมุดทั้งสองจุด → คำนวณตามระยะจริง
    // ถ้าพิมพ์ที่อยู่อย่างเดียว → คิดค่า base fee อย่างเดียว
    const hasLocations = !!(parcelDetails.pickupLocation && parcelDetails.dropoffLocation);
    const distance  = hasLocations ? parcelDistance  : 0;
    const deliveryFee = hasLocations
      ? Math.max(parcelEstimate, appConfig.baseFee)
      : appConfig.baseFee;
    const grandTotal = deliveryFee;

    // ── ตรวจสอบ radius เฉพาะเมื่อรู้ระยะทางจริง ─────────────────────────
    if (hasLocations && distance > appConfig.appRadius) {
      placingOrderRef.current = false;
      return notifySystem("นอกพื้นที่", `ระยะทาง (${distance} กม.) เกินขอบเขตให้บริการ`, "error");
    }

    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
      placingOrderRef.current = false;
      return notifySystem("ยอดเงินไม่พอ", "กรุณาเติมเงินหรือเลือกชำระเงินสด", "error");
    }

    const adminGP    = deliveryFee * (appConfig.gpDelivery / 100);
    const riderIncome = deliveryFee * (1 - (appConfig.gpDelivery / 100));

    const newOrder = {
      id: `EX-${generateId()}`,
      type: 'parcel',
      pickup:         parcelDetails.pickup,
      dropoff:        parcelDetails.dropoff,
      location:       parcelDetails.dropoffLocation || userProfile.location,
      pickupLocation: parcelDetails.pickupLocation  || userProfile.location,
      distance,
      weight:         parcelDetails.weight,
      foodTotal:      0,
      deliveryFee,
      grandTotal,
      paymentMethod,
      adminGP,
      merchantIncome: 0,
      riderIncome,
      status:         'ready_to_pickup',
      customerName:   userProfile.name,
      customerPhone:  userProfile.phone,
      customerId:     userProfile.id || currentUser?.id,
      // ── ผู้รับ (receiver) ─────────────────────────────────────────────
      receiverName:   parcelDetails.receiverName  || '',
      receiverPhone:  parcelDetails.receiverPhone || '',
      timestamp:      new Date().toLocaleString('th-TH'),
      riderId:        null,
      riderUid:       null,    // ต้องมี field นี้เพื่อให้ Firestore rule ทำงาน
      riderLocation:  null,
      pickupPhoto:    null,
      deliveryPhoto:  null,
    };

    pendingLocalOrderIdsRef.current.add(newOrder.id);
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);

    if (paymentMethod === 'wallet') {
      processTransaction('payment', -grandTotal, 'ชำระค่าส่งพัสดุ');
    }
    if (FIREBASE_ENABLED) saveOrder(newOrder).catch(() => {});

    notifySystem("เรียกรถสำเร็จ", `ค่าส่ง ฿${grandTotal} — กำลังค้นหาไรเดอร์...`, "success");
    setTimeout(() => notifySystem("ไรเดอร์", "มีงานส่งพัสดุใหม่เข้ามา!", "warning"), 1000);

    setParcelDetails({ pickup: '', dropoff: '', weight: '1', distance: 0, pickupLocation: null, dropoffLocation: null, receiverName: '', receiverPhone: '' });
    setParcelMapTarget(null);
    setParcelEstimate(0);
    setParcelDistance(0);
    setPaymentMethod('wallet');
    setActiveTab('activity');
  };

  /**
   * รับงานแบบ first-come-first-served ผ่าน Firestore Transaction
   * - ถ้า order ยังว่าง → รับสำเร็จ, อัปเดต local state ทันที
   * - ถ้ามีไรเดอร์อื่นรับไปก่อน → แจ้งเตือน "งานถูกรับไปแล้ว"
   * @param {string} orderId
   * @param {string} riderId  — me.id (rider document id)
   * @param {object} riderLocation — { lat, lng } ตำแหน่งปัจจุบันของไรเดอร์
   * @returns {Promise<boolean>} — true ถ้ารับสำเร็จ
   */
  const acceptOrder = async (orderId, riderId, riderLocation) => {
    // ── Optimistic local check ──────────────────────────────────────────
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'ready_to_pickup' || order.riderId) {
      notifySystem('เสียใจด้วย', 'งานนี้ถูกรับไปแล้ว 😔', 'error');
      return false;
    }

    // ── riderUid = Firebase UID สำหรับ Firestore permission ──────────────
    // riderId = internal rider document id (ใช้ใน app logic)
    // riderUid = Firebase auth UID (ใช้ใน Firestore rules)
    const riderUid = currentUser?.id || null;
    // ── ดึงข้อมูลไรเดอร์เพื่อฝัง phone/name ลงใน order ──────────────────
    const riderInfo = riders.find(r => r.id === riderId);
    const riderPhone = riderInfo?.phone || '';
    const riderName  = riderInfo?.name  || '';

    if (FIREBASE_ENABLED) {
      // ── Atomic Firestore Transaction ────────────────────────────────────
      try {
        await acceptOrderTransaction(orderId, riderId, riderLocation, riderUid);

        // ── อัปเดต local state ทันที (ไม่รอ onSnapshot ซึ่งอาจช้า) ──────
        setOrders(prev => prev.map(o => {
          if (o.id !== orderId) return o;
          return { ...o, status: 'rider_accepted', riderId, riderUid, riderPhone, riderName, riderLocation: riderLocation || o.pickupLocation };
        }));
        // ── บันทึก riderPhone/riderName ลง Firestore ด้วย ─────────────────
        updateOrderStatusInDB(orderId, { riderPhone, riderName }).catch(() => {});

        notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย — ไปรับงานได้เลย', 'success');
        return true;
      } catch (err) {
        if (err.message === 'ORDER_ALREADY_TAKEN') {
          // อัปเดต local state ให้สะท้อนความจริง (งานถูกรับไปแล้ว)
          setOrders(prev => prev.filter(o => o.id !== orderId || o.status !== 'ready_to_pickup'));
          notifySystem('เสียใจด้วย', 'งานนี้ถูกไรเดอร์คนอื่นรับไปก่อน 😔', 'error');
        } else {
          notifySystem('เกิดข้อผิดพลาด', 'กรุณาลองใหม่อีกครั้ง', 'error');
        }
        return false;
      }
    } else {
      // ── Offline fallback (local state only) ─────────────────────────────
      setOrders(prev => prev.map(o => {
        if (o.id !== orderId) return o;
        return { ...o, status: 'rider_accepted', riderId, riderPhone, riderName };
      }));
      notifySystem('รับงานสำเร็จ! 🎉', 'ออกรับงานได้เลย', 'success');
      return true;
    }
  };

  const updateOrderStatus = (orderId, newStatus, actorId = null, extraData = {}) => {
    // ── ดึงข้อมูล order เก่าก่อน (สำหรับ notification + income + Firestore save) ──
    const targetOrder = orders.find(o => o.id === orderId);
    const prevStatus = targetOrder?.status;
    if (!targetOrder) return;

    // ── คำนวณ order ใหม่ (PURE — ไม่มี side effect) ─────────────────────────
    let finalOrder = { ...targetOrder, status: newStatus, ...extraData };
    if (newStatus === 'rider_accepted' && actorId) {
      finalOrder.riderId      = actorId;
      finalOrder.riderLocation = targetOrder.pickupLocation || null;
    }
    // 'delivered':
    //   food  → auto-complete ทันที (ไม่มี delivered state ใน UI)
    //   parcel → คงสถานะ 'delivered' ไว้ รอลูกค้ากด "ยืนยันรับสินค้า" ก่อน
    if (newStatus === 'delivered' && targetOrder?.type !== 'parcel') {
      finalOrder = { ...finalOrder, status: 'completed', completedAt: new Date().toISOString() };
    }
    // 'completed' (customer confirms parcel receipt) → เซ็ต completedAt
    if (newStatus === 'completed' && !finalOrder.completedAt) {
      finalOrder = { ...finalOrder, completedAt: new Date().toISOString() };
    }
    // ── backward compat: เติม riderUid ถ้าหาย (orders เก่าที่ accept ด้วย code เก่า) ──
    if (finalOrder.riderId && !finalOrder.riderUid) {
      finalOrder = { ...finalOrder, riderUid: currentUser?.id || null };
    }

    // ── Update state (PURE updater — ไม่มี side effect ใน callback นี้) ─────
    setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? finalOrder : o));

    // ── Save to Firestore นอก updater (side effect ที่ถูกที่) ──────────────
    // ใช้ updateOrderStatusInDB (updateDoc partial) แทน saveOrder (setDoc full replace) เพราะ:
    // - หลีกเลี่ยง riderLocation.x/y = undefined จาก real-time simulation ที่ทำให้ setDoc throw silently
    // - ลด bandwidth + latency (ส่งแค่ fields ที่เปลี่ยน)
    if (FIREBASE_ENABLED) {
      const dbFields = { status: finalOrder.status };
      if (finalOrder.riderId  != null) dbFields.riderId  = finalOrder.riderId;
      if (finalOrder.riderUid != null) dbFields.riderUid = finalOrder.riderUid;
      if (finalOrder.completedAt)      dbFields.completedAt = finalOrder.completedAt;
      if (finalOrder.cancelReason)     dbFields.cancelReason = finalOrder.cancelReason;
      // ส่งรูปสลิปไว้ใน Firestore (จะถูก strip โดย stripImages ใน updateOrderStatusInDB)
      if (extraData.pickupPhoto)       dbFields.pickupPhoto   = extraData.pickupPhoto;
      if (extraData.deliveryPhoto)     dbFields.deliveryPhoto = extraData.deliveryPhoto;
      updateOrderStatusInDB(orderId, dbFields).catch(() => {});
    }

    // ── Notifications หลัง setOrders — ปลอดภัย ไม่ crash React ──
    if (prevStatus !== newStatus) {
      if (newStatus === 'preparing')       notifySystem('อัปเดตสถานะ', `ร้านค้ารับออเดอร์ #${orderId} แล้ว`, 'info');
      if (newStatus === 'ready_to_pickup') notifySystem('ไรเดอร์', `ออเดอร์ #${orderId} พร้อมส่งแล้ว`, 'warning');
      if (newStatus === 'rider_accepted')  notifySystem('อัปเดตสถานะ', `ไรเดอร์รับงาน #${orderId} แล้ว`, 'success');
      if (newStatus === 'picking_up')      notifySystem('อัปเดตสถานะ', 'ไรเดอร์ถึงร้านค้า/จุดรับแล้ว', 'info');
      if (newStatus === 'delivering')      notifySystem('อัปเดตสถานะ', 'ไรเดอร์รับของแล้ว กำลังไปส่ง', 'info');
      if (newStatus === 'delivered')       notifySystem('ไรเดอร์ถึงที่หมาย! 📦', `กรุณายืนยันรับสินค้า #${orderId}`, 'success');
      if (newStatus === 'completed')       notifySystem('รับสินค้าแล้ว! 🎉', `ออเดอร์ #${orderId} เสร็จสิ้น`, 'success');
      if (newStatus === 'cancelled')       notifySystem('ยกเลิกออเดอร์', `ออเดอร์ #${orderId} ถูกยกเลิก`, 'error');
    }

    // ── ประมวลผล income หลัง setOrders (ใช้ข้อมูล order เก่าที่ดึงไว้ก่อนหน้า) ──
    // กัน double-credit: ทำงานเฉพาะเมื่อ status เปลี่ยนมาเป็น 'delivered' จริงๆ
    if (newStatus === 'delivered' && targetOrder && !['delivered', 'completed'].includes(prevStatus)) {
      // ── Multi-wallet atomic completion (Firestore) ────────────────────────
      if (FIREBASE_ENABLED && ADMIN_UID) {
        const restaurant   = targetOrder.type === 'food'
          ? restaurants.find(r => r.id === targetOrder.restaurantId)
          : null;
        const riderProfile = riders.find(r => r.id === targetOrder.riderId);
        const riderUid     = targetOrder.riderUid || riderProfile?.userId || null;
        const shopOwnerUid = restaurant?.ownerId || null;

        const shortId = targetOrder.id.slice(-6);
        const riderIncome  = typeof targetOrder.riderIncome    === 'number' ? targetOrder.riderIncome    : 0;
        const merchantIncome = typeof targetOrder.merchantIncome === 'number' ? targetOrder.merchantIncome : 0;
        const gpAmount     = typeof targetOrder.adminGP         === 'number' ? targetOrder.adminGP         : 0;

        // ── อัปเดต local state ทันทีสำหรับ user ที่ login อยู่บน device นี้ ──
        // ป้องกัน race condition ระหว่าง saveWallet กับ subscribeToWallet
        const myUidNow = userProfile.id || currentUser?.id;
        const isCashOrder = targetOrder.paymentMethod === 'cash';
        if (riderUid && riderUid === myUidNow) {
          if (!isCashOrder && riderIncome > 0) {
            // wallet: local optimistic update ก่อน subscribeToWallet ตามมา
            processTransaction('income', riderIncome, `ค่าส่ง ${targetOrder.restaurantName || 'พัสดุ'} #${shortId}`);
          }
          // cash: ไม่อัปเดต local state ที่นี่ — ปล่อยให้ atomicOrderCompletion → creditWalletInDB
          // → subscribeToWallet จัดการแทน เพราะถ้า processTransaction + saveWallet ทำงานพร้อม
          // creditWalletInDB จะเกิด double-deduction (หักสองรอบ)
        }
        // cash: ห้าม processTransaction สำหรับ merchant/admin เช่นเดียวกับ rider
        // เพราะ processTransaction → saveWallet (setDoc) อาจ race กับ creditWalletInDB (increment)
        // ทำให้ double-credit ถ้าอยู่บน device เดียวกัน — ปล่อยให้ subscribeToWallet จัดการแทน
        if (!isCashOrder && shopOwnerUid && shopOwnerUid === myUidNow && merchantIncome > 0) {
          processTransaction('income', merchantIncome, `รายได้ร้าน #${shortId}`);
        }
        if (!isCashOrder && ADMIN_UID && ADMIN_UID === myUidNow && gpAmount > 0) {
          processTransaction('income', gpAmount, `GP #${shortId}`);
        }

        // ── Firestore atomic write (ทุกกรณี — ใช้ increment/arrayUnion ไม่ต้อง read) ──
        atomicOrderCompletion({
          order:        targetOrder,
          riderUid,
          shopOwnerUid,
          adminUid:     ADMIN_UID,
          gpFood:       appConfig.gpFood,
          gpDelivery:   appConfig.gpDelivery,
        }).catch((err) => {
          if (import.meta.env.DEV) console.error('[atomicOrderCompletion]', err?.message);
        });
      } else {
        // ── Firebase ปิด → fallback (ใช้ creditWallet เพื่ออัปเดต globalWallets ด้วย) ──
        const shortId = targetOrder.id.slice(-6);
        // รายได้ไรเดอร์ — creditWallet อัปเดต globalWallets (ทุก user) ไม่ใช่แค่ user ที่ login
        if (targetOrder.riderId) {
          const riderProfile = riders.find(r => r.id === targetOrder.riderId);
          const riderUserId  = targetOrder.riderUid || riderProfile?.userId;
          const income = typeof targetOrder.riderIncome === 'number' ? targetOrder.riderIncome : 0;
          if (riderUserId && income > 0) {
            creditWallet(riderUserId, income, `ค่าส่ง ${targetOrder.restaurantName || 'พัสดุ'} #${shortId}`);
          }
        }
        // รายได้ร้านค้า — creditWallet ไม่ต้องเช็คว่า merchant login อยู่หรือเปล่า
        if (targetOrder.type === 'food') {
          const restaurant = restaurants.find(r => r.id === targetOrder.restaurantId);
          const shopUserId  = restaurant?.ownerId;
          const income = typeof targetOrder.merchantIncome === 'number' ? targetOrder.merchantIncome : 0;
          if (shopUserId && income > 0) {
            creditWallet(shopUserId, income, `รายได้ร้าน #${shortId}`);
          }
        }
        // Admin GP
        if (ADMIN_UID) {
          const gp = typeof targetOrder.adminGP === 'number' ? targetOrder.adminGP : 0;
          if (gp > 0) creditWallet(ADMIN_UID, gp, `GP #${shortId} (local)`);
        }
      }
    }
  };

  // --- Photo Handlers ---
  const handleRiderPhotoUpload = (orderId, type, event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setRiderJobPhotos(prev => ({ ...prev, [orderId]: { ...prev[orderId], [type]: reader.result } }));
        notifySystem("สำเร็จ", "อัปโหลดรูปภาพเรียบร้อย", "success");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProfilePhotoChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setTempProfile(prev => ({ ...prev, image: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handleShopPhotoChange = (restaurantId, event) => {
    const file = event.target.files[0];
    if (!file) return;

    notifySystem("กำลังประมวลผล", "กำลังบีบอัดรูปภาพ...", "info");

    // บีบอัด → 800×600 px, JPEG 75% ≈ 100–180 KB (เข้า Firestore 1 MB ได้สบาย)
    compressImage(file, 800, 600, 0.75)
      .then(compressed => {
        setRestaurants(prev => prev.map(r => {
          if (r.id === restaurantId) {
            const updated = { ...r, image: compressed };
            if (FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
            return updated;
          }
          return r;
        }));
        notifySystem("สำเร็จ", "อัปเดตรูปหน้าร้านเรียบร้อย", "success");
      })
      .catch(() => notifySystem("ผิดพลาด", "ไม่สามารถประมวลผลรูปภาพได้", "error"));
  };

  const handleRegistrationPhotoSelect = (event, setForm, field) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setForm(prev => ({ ...prev, [field]: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handleTopUpSlipSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setTopUpSlip(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleMenuPhotoSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setEditForm(prev => ({ ...prev, _imageUploading: true }));

    // บีบอัด → 400×400 px, JPEG 65% ≈ 25–50 KB ต่อเมนู
    // (รวม 20 เมนู × 50 KB = 1 MB — อยู่ในขีด Firestore พอดี)
    compressImage(file, 400, 400, 0.65)
      .then(compressed => {
        setEditForm(prev => ({ ...prev, image: compressed, _imageUploading: false }));
      })
      .catch(() => {
        setEditForm(prev => ({ ...prev, _imageUploading: false }));
        notifySystem("ผิดพลาด", "ไม่สามารถประมวลผลรูปภาพได้", "error");
      });
  };

  const openImagePreview = (url) => {
    setPreviewImageUrl(url);
    setShowImageModal(true);
  };

  const openProofModal = (order) => {
    setSelectedProofOrder(order);
    setShowProofModal(true);
  };

  // --- Merchant Management ---
  const handleUpdateShopLocation = useCallback((restaurantId, location) => {
    if (!restaurantId || !location) return;
    setRestaurants(prev => prev.map(r => {
      if (r.id !== restaurantId) return r;
      const updated = { ...r, location };
      if (FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
      return updated;
    }));
    notifySystem('📍 บันทึกที่ตั้งร้านแล้ว', 'ลูกค้าและไรเดอร์ในรัศมีจะเห็นร้านคุณได้ถูกต้อง', 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleShopStatus = (restaurantId) => {
    setRestaurants(prev => prev.map(r => {
      if (r.id === restaurantId) {
        const newStatus = r.status === 'open' ? 'closed' : 'open';
        const updated = { ...r, status: newStatus };
        // ── sync เปิด/ปิดร้านไป Firestore ให้ทุก device เห็นพร้อมกัน ──
        if (FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
        notifySystem("สถานะร้าน", `ร้านค้า ${newStatus === 'open' ? 'เปิด' : 'ปิด'} แล้ว`, "info");
        return updated;
      }
      return r;
    }));
  };

  const handleAddMenuItem = (restaurantId, newItem) => {
    const currentItems = menuItems[restaurantId] || [];
    const itemWithId = { ...newItem, id: generateId(), available: true };
    const updated = [...currentItems, itemWithId];
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
    notifySystem("สำเร็จ", "เพิ่มเมนูเรียบร้อย", "success");
  };

  const handleEditMenuItem = (restaurantId, itemId, updatedItem) => {
    const currentItems = menuItems[restaurantId] || [];
    const updated = currentItems.map(item => item.id === itemId ? { ...item, ...updatedItem } : item);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
    notifySystem("สำเร็จ", "แก้ไขเมนูเรียบร้อย", "success");
  };

  const handleDeleteMenuItem = (restaurantId, itemId) => {
    if (!window.confirm("ยืนยันการลบเมนูนี้?")) return;
    const currentItems = menuItems[restaurantId] || [];
    const updated = currentItems.filter(item => item.id !== itemId);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
    notifySystem("สำเร็จ", "ลบเมนูเรียบร้อย", "success");
  };

  const handleToggleItemAvailability = (restaurantId, itemId) => {
    const currentItems = menuItems[restaurantId] || [];
    const updated = currentItems.map(item => item.id === itemId ? { ...item, available: !item.available } : item);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
  };

  // --- Request Logic ---
  /**
   * requestTopUp — แจ้งเติมเงินกระเป๋าหลัก รอ Admin อนุมัติ
   */
  const requestTopUp = (amount, slipImage, _walletType = null, bankInfo = {}) => {
    const uid = userProfile.id || currentUser?.id || '';
    const newReq = {
      id: generateId(), type: 'topup',
      data: {
        amount,
        bank:          bankInfo.bank          || null,
        accountName:   bankInfo.accountName   || null,
        accountNumber: bankInfo.accountNumber || null,
        slipImage:     slipImage ? '✓ แนบสลิปแล้ว' : null,
      },
      _hasSlip: !!slipImage,
      userId: uid, user: userProfile.name || 'ผู้ใช้',
      timestamp: new Date().toLocaleString('th-TH'),
    };
    if (FIREBASE_ENABLED) {
      savePendingRequest({ ...newReq, data: { ...newReq.data, slipImage } }).catch(() => {});
    }
    setPendingRequests(prev => [newReq, ...prev]);
    setShowTopUpModal(false);
    setTopUpSlip(null);
    setWithdrawAmount('');
    notifySystem("ส่งคำขอแล้ว ✅", `แจ้งเติมกระเป๋าเงิน ฿${Number(amount).toLocaleString()} — รอ Admin อนุมัติ`, "success");
    notifyAdmin("💰 เติมเงินใหม่", `${userProfile.name || 'ผู้ใช้'} แจ้งเติม ฿${amount}`, "warning");
  };

  /**
   * requestWithdraw — แจ้งถอนเงินจากกระเป๋าหลัก รอ Admin อนุมัติ
   */
  const requestWithdraw = (amount, bankInfo, _walletType = null) => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return notifySystem("ผิดพลาด", "กรุณาระบุจำนวนเงิน", "error");
    const uid = userProfile.id || currentUser?.id || '';
    // หักยอดที่รอถอนอยู่ก่อน เพื่อป้องกันการยื่นขอซ้อนกัน
    const pendingWithdrawTotal = pendingRequests
      .filter(r => r.userId === uid && r.type === 'withdraw')
      .reduce((sum, r) => sum + (Number(r.data?.amount) || 0), 0);
    const effectiveBalance = userWallet - pendingWithdrawTotal;
    if (effectiveBalance < parsedAmount) {
      return notifySystem(
        "ผิดพลาด",
        pendingWithdrawTotal > 0
          ? `ยอดคงเหลือที่ถอนได้ ฿${effectiveBalance.toLocaleString()} (หักยอดรอถอน ฿${pendingWithdrawTotal.toLocaleString()} แล้ว)`
          : "ยอดเงินในกระเป๋าไม่เพียงพอ",
        "error",
      );
    }

    const bank          = bankInfo.bank          || bankInfo.bankName   || '';
    const accountName   = bankInfo.accountName   || bankInfo.name       || '';
    const accountNumber = bankInfo.accountNumber || bankInfo.account    || '';

    const newReq = {
      id: generateId(), type: 'withdraw',
      data: { amount: parsedAmount, bank, accountName, accountNumber,
              account: accountNumber, name: accountName },
      userId: uid, user: userProfile.name || 'ผู้ใช้',
      timestamp: new Date().toLocaleString('th-TH'),
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount(''); setWithdrawName('');
    setWithdrawMode(false);
    notifySystem("ส่งคำขอแล้ว ✅", `แจ้งถอนกระเป๋าเงิน ฿${parsedAmount.toLocaleString()} — รอ Admin อนุมัติ`, "success");
    notifyAdmin("💸 ถอนเงินใหม่", `${userProfile.name || 'ผู้ใช้'} แจ้งถอน ฿${parsedAmount}`, "warning");
  };

  const requestRegisterMerchant = async (data) => {
    if (!data.shopName || !data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
      return notifySystem("ข้อมูลไม่ครบ", "กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน", "error");
    }
    if (restaurants.some(r => r.ownerId === userProfile.id || r.ownerId === currentUser?.id)) {
      if (!userRoles.includes('merchant')) {
        grantRole(userProfile.id || currentUser?.id, 'merchant');
        notifySystem("อัปเดต", "พบร้านค้าในระบบ กำลังเปิดสิทธิ์ร้านค้าให้", "success");
      } else {
        notifySystem("ซ้ำซ้อน", "คุณมีร้านค้าอยู่แล้ว", "error");
      }
      return;
    }
    if (isPending('merchant_reg')) return notifySystem("รออนุมัติ", "คำขอสมัครร้านค้ากำลังรอการอนุมัติ", "info");
    const uid = userProfile.id || currentUser?.id || '';

    // ── แยกรูป base64 ออกจาก state (ป้องกัน JSON.stringify ขนาดใหญ่ → freeze/white screen) ──
    const { idCardImage, shopImage, ...dataNoImages } = data;
    // ── แนบตำแหน่งปัจจุบันของ Merchant ไปด้วย (Admin จะได้สร้างร้านที่ตำแหน่งถูกต้อง) ──
    const merchantLocation = data.location || userProfile.location || USER_LOCATION;
    const newReq = {
      id: generateId(), type: 'merchant_reg',
      data: {
        ...dataNoImages,
        location:    merchantLocation,
        idCardImage: idCardImage ? '✓ อัปโหลดบัตรประชาชนแล้ว' : null,
        shopImage:   shopImage   ? '✓ อัปโหลดรูปร้านแล้ว'       : null,
      },
      _hasImages: !!(idCardImage || shopImage),
      userId: uid, user: userProfile.name,
      timestamp: new Date().toLocaleString('th-TH'),
    };

    // ── ส่ง Firestore พร้อมรูปจริง (savePendingRequest จะ strip ให้อีกรอบ) ──
    if (FIREBASE_ENABLED) {
      savePendingRequest({ ...newReq, data: { ...data } }).catch(() => {});
    }

    // ── เก็บใน state โดยไม่มีรูป base64 (ปลอดภัย ไม่ freeze) ──
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem("สำเร็จ", "ส่งใบสมัครร้านค้าเรียบร้อย รอแอดมินอนุมัติ", "success");
    notifyAdmin("🏪 สมัครร้านค้าใหม่", `${userProfile.name} ส่งใบสมัครร้าน ${data.shopName}`, "warning");
  };

  const requestRegisterRider = async (data) => {
    if (!data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
      return notifySystem("ข้อมูลไม่ครบ", "กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน", "error");
    }
    if (isPending('rider_reg')) return notifySystem("รออนุมัติ", "คำขอสมัครไรเดอร์กำลังรอการอนุมัติ", "info");
    const uid = userProfile.id || currentUser?.id || '';

    // ── แยกรูป base64 ออกจาก state (ป้องกัน JSON.stringify ขนาดใหญ่ → freeze/white screen) ──
    const { idCardImage, profileImage, ...dataNoImages } = data;
    const newReq = {
      id: generateId(), type: 'rider_reg',
      data: {
        ...dataNoImages,
        idCardImage:   idCardImage   ? '✓ อัปโหลดบัตรประชาชนแล้ว' : null,
        profileImage:  profileImage  ? '✓ อัปโหลดรูปโปรไฟล์แล้ว'   : null,
      },
      _hasImages: !!(idCardImage || profileImage),
      userId: uid, user: userProfile.name,
      timestamp: new Date().toLocaleString('th-TH'),
    };

    // ── ส่ง Firestore พร้อมรูปจริง (savePendingRequest จะ strip ให้อีกรอบ) ──
    if (FIREBASE_ENABLED) {
      savePendingRequest({ ...newReq, data: { ...data } }).catch(() => {});
    }

    // ── เก็บใน state โดยไม่มีรูป base64 (ปลอดภัย ไม่ freeze) ──
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem("สำเร็จ", "ส่งใบสมัครไรเดอร์เรียบร้อย รอแอดมินอนุมัติ", "success");
    notifyAdmin("🛵 สมัครไรเดอร์ใหม่", `${userProfile.name} ส่งใบสมัคร`, "warning");
  };

  // --- อัปเดตตำแหน่งหลักของผู้ใช้ (userProfile.location) ---
  const handleUpdateUserLocation = useCallback(async (location) => {
    if (!location) return;
    const uid = currentUser?.id || userProfile?.id;
    setUserProfile(prev => ({ ...prev, location }));
    // persist ใน localStorage (2 key: บน user object และ key เฉพาะตัว)
    try {
      const saved = JSON.parse(localStorage.getItem('boomrider_user') || '{}');
      if (saved && typeof saved === 'object') {
        if (saved.profile) saved.profile.location = location;
        localStorage.setItem('boomrider_user', JSON.stringify(saved));
      }
      if (uid) localStorage.setItem(`boomrider_loc_${uid}`, JSON.stringify(location));
    } catch {}
    // sync ไป Firestore
    if (FIREBASE_ENABLED && uid) {
      saveUserProfile(uid, { location }).catch(() => {});
    }
    notifySystem('📍 บันทึกตำแหน่งแล้ว', 'ตำแหน่งหลักของคุณถูกอัปเดตเรียบร้อย', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAddress = (addr) => {
    const loc = addr.location || USER_LOCATION;
    setUserAddresses([...userAddresses, { id: generateId(), label: addr.label, address: addr.fullAddr, location: loc }]);
    notifySystem("สำเร็จ", "บันทึกที่อยู่เรียบร้อย", "success");
  };

  const handleUpdateAddress = useCallback(async (id, location, label, fullAddr) => {
    const addr = fullAddr || await reverseGeocode(location.lat, location.lng).catch(() => `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`);
    setUserAddresses(prev => prev.map(a =>
      a.id === id
        ? { ...a, location, address: addr, ...(label ? { label } : {}) }
        : a,
    ));
    notifySystem('📍 อัปเดตหมุดแล้ว', 'บันทึกตำแหน่งที่อยู่ใหม่เรียบร้อย', 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteAddress = (id) => setUserAddresses(userAddresses.filter(a => a.id !== id));

  // --- Promo Codes ---
  const [promoCodes, setPromoCodes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('boomrider_promo_codes') || '[]'); } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem('boomrider_promo_codes', JSON.stringify(promoCodes));
  }, [promoCodes]);

  const validatePromoCode = useCallback((code, orderTotal) => {
    const promo = promoCodes.find(p => p.code.toUpperCase() === code.toUpperCase() && p.active);
    if (!promo) return { valid: false, message: 'ไม่พบโค้ดส่วนลด' };
    if ((promo.usedCount || 0) >= promo.maxUses) return { valid: false, message: 'โค้ดนี้ถูกใช้ครบแล้ว' };
    if (promo.expiry && new Date(promo.expiry) < new Date()) return { valid: false, message: 'โค้ดหมดอายุแล้ว' };
    if (promo.minOrder && orderTotal < promo.minOrder) return { valid: false, message: `ยอดขั้นต่ำ ฿${promo.minOrder}` };
    const rawDiscount = promo.type === 'percent' ? (orderTotal * promo.value / 100) : promo.value;
    const discount = Math.min(rawDiscount, promo.maxDiscount || 9999);
    return { valid: true, discount: Math.round(discount), promo };
  }, [promoCodes]);

  const usePromoCode = useCallback((code) => {
    setPromoCodes(prev => prev.map(p =>
      p.code.toUpperCase() === code.toUpperCase()
        ? { ...p, usedCount: (p.usedCount || 0) + 1 }
        : p,
    ));
  }, []);

  const createPromoCode = useCallback((data) => {
    const newCode = {
      id: generateId(), ...data,
      code: data.code.toUpperCase(),
      usedCount: 0, active: true,
      createdAt: new Date().toISOString(),
    };
    setPromoCodes(prev => [newCode, ...prev]);
    notifySystem('สำเร็จ', `สร้างโค้ด "${data.code.toUpperCase()}" เรียบร้อย`, 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePromoCode = useCallback((id) => {
    setPromoCodes(prev => prev.map(p => p.id === id ? { ...p, active: !p.active } : p));
  }, []);

  const deletePromoCode = useCallback((id) => {
    setPromoCodes(prev => prev.filter(p => p.id !== id));
  }, []);

  // --- Admin manual wallet adjustment ---
  const adminAdjustWallet = useCallback((userId, amount, desc) => {
    creditWallet(userId, amount, `[Admin] ${desc}`);
    notifySystem('Admin', `ปรับยอด ${amount > 0 ? '+' : ''}฿${amount} ให้ผู้ใช้เรียบร้อย`, 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Admin ban user ---
  const adminBanUser = useCallback((userId) => {
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const updated = users.map(u => u.id === userId ? { ...u, banned: !u.banned } : u);
    localStorage.setItem('boomrider_users', JSON.stringify(updated));
    notifySystem('Admin', 'อัปเดตสถานะผู้ใช้เรียบร้อย', 'success');
  }, []);

  // --- Admin Logic ---
  const handleApproveRequest = async (req) => {
    if (req.type === 'topup') {
      const amt       = Number(req.data.amount);
      const topupDesc = `เติมเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`;
      creditWallet(req.userId, amt, topupDesc);
      if (FIREBASE_ENABLED) creditWalletInDB(req.userId, amt, topupDesc).catch(() => {});
      notifySystem("Admin ✅", `อนุมัติเติมเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, "success");

    } else if (req.type === 'withdraw') {
      const amt          = Number(req.data.amount);
      const withdrawDesc = `ถอนเงิน ฿${amt.toLocaleString()} (Admin อนุมัติ)`;
      // ดึงยอดปัจจุบันจาก Firestore ก่อนหัก
      let liveBalance = globalWallets[req.userId]?.balance ?? 0;
      if (FIREBASE_ENABLED) {
        try {
          const cloudWallet = await loadWallet(req.userId);
          if (cloudWallet != null) {
            liveBalance = cloudWallet.balance ?? 0;
            setGlobalWallets(prev => ({ ...prev, [req.userId]: { balance: liveBalance, history: cloudWallet.history || [] } }));
          }
        } catch (_) {}
      }
      if (liveBalance < amt) {
        return notifySystem("ผิดพลาด", `${req.user} มียอดเงินไม่พอ (มี ฿${liveBalance.toLocaleString()}, ต้องการ ฿${amt.toLocaleString()})`, "error");
      }
      creditWallet(req.userId, -amt, withdrawDesc);
      if (FIREBASE_ENABLED) creditWalletInDB(req.userId, -amt, withdrawDesc).catch(() => {});
      notifySystem("Admin ✅", `อนุมัติถอนเงิน ฿${amt.toLocaleString()} ให้ ${req.user}`, "success");
    } else if (req.type === 'merchant_reg') {
      const newId = `rest_${Date.now()}`;
      // ใช้ตำแหน่งที่ Merchant ส่งมาในคำขอ (req.data.location)
      // ถ้าไม่มี → ใช้ USER_LOCATION เป็น default (Merchant จะ set เองในหน้าร้าน)
      const newRest = {
        id: newId,
        ownerId: req.userId,
        name: req.data.shopName,
        phone: req.data.phone,
        rating: 5.0,
        time: "20-30 min",
        image: req.data.shopImage || "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=500&q=60",
        category: req.data.category,
        status: 'open',
        location: req.data.location || USER_LOCATION,
      };
      setRestaurants(prev => [newRest, ...prev]);
      grantRole(req.userId, 'merchant');
      setMenuItems(prev => ({ ...prev, [newId]: [] }));
      // Sync ร้านใหม่ไป Firestore ให้ทุก device เห็น
      if (FIREBASE_ENABLED) {
        saveRestaurant(newRest).catch(() => {});
        saveMenuItems(newId, []).catch(() => {});
      }
      notifySystem("Admin", "อนุมัติร้านค้าเรียบร้อย", "success");
    } else if (req.type === 'rider_reg') {
      const newId = `rider_${Date.now()}`;
      const newRider = { id: newId, userId: req.userId, name: req.data.realName, phone: req.data.phone, status: 'active', balance: 0, location: USER_LOCATION };
      setRiders(prev => [newRider, ...prev]);
      safeLocalSet('boomrider_riders', [newRider, ...riders]);
      grantRole(req.userId, 'rider');
      // บันทึกไรเดอร์ลง Firestore เพื่อให้ device ของไรเดอร์โหลดได้
      if (FIREBASE_ENABLED) saveRider(newRider).catch(() => {});
      notifySystem("Admin", "อนุมัติไรเดอร์เรียบร้อย", "success");
    } else if (req.type === 'cancel_order') {
      // ── ยกเลิก order + คืนเงิน (ถ้า wallet) ────────────────────────────
      const targetOrder = orders.find(o => o.id === req.data.orderId);
      const requestedBy = req.data.requestedBy;
      const roleName = requestedBy === 'rider' ? 'ไรเดอร์' : requestedBy === 'merchant' ? 'ร้านค้า' : 'ลูกค้า';
      const cancelReason = `${roleName}ขอยกเลิก: ${req.data.reason}`;
      if (targetOrder && !['cancelled', 'completed'].includes(targetOrder.status)) {
        const cancelledOrder = { ...targetOrder, status: 'cancelled', cancelReason };
        setOrders(prev => prev.map(o => o.id === req.data.orderId ? cancelledOrder : o));
        if (FIREBASE_ENABLED) updateOrderStatusInDB(req.data.orderId, {
          status: 'cancelled',
          cancelReason,
        }).catch(() => {});
      }
      // คืนเงินเฉพาะ wallet payment
      if (req.data.paymentMethod === 'wallet' && req.data.grandTotal > 0) {
        const refundDesc = `คืนเงิน: ยกเลิกออเดอร์ #${req.data.orderId.slice(-6)} (Admin อนุมัติ)`;
        // ── อัปเดต in-memory state ──────────────────────────────────────────
        creditWallet(req.userId, req.data.grandTotal, refundDesc);
        // ── sync เงินคืนไป Firestore ของ user ทันที ─────────────────────────
        if (FIREBASE_ENABLED) creditWalletInDB(req.userId, req.data.grandTotal, refundDesc).catch(() => {});
      }
      const refundNote = req.data.paymentMethod === 'wallet'
        ? ` — คืนเงิน ฿${(req.data.grandTotal || 0).toLocaleString()} แล้ว`
        : ' — ไม่มีการตัดเงิน';
      notifySystem("Admin", `อนุมัติยกเลิกออเดอร์ #${req.data.orderId.slice(-6)}${refundNote}`, "success");
    }
    // ลบ request ออกจาก Firestore ด้วย
    if (FIREBASE_ENABLED) deletePendingRequest(req.id).catch(() => {});
    setPendingRequests(prev => prev.filter(r => r.id !== req.id));
  };

  const initiateRejectRequest = (id) => {
    setSelectedRequestToReject(id);
    setShowRejectModal(true);
  };

  const confirmRejectRequest = () => {
    if (selectedRequestToReject) {
      const req = pendingRequests.find(r => r.id === selectedRequestToReject);
      if (FIREBASE_ENABLED) deletePendingRequest(selectedRequestToReject).catch(() => {});
      setPendingRequests(prev => prev.filter(r => r.id !== selectedRequestToReject));
      setShowRejectModal(false);
      setSelectedRequestToReject(null);
      if (req?.type === 'cancel_order') {
        notifySystem("Admin", `ปฏิเสธคำขอยกเลิก #${req.data.orderId.slice(-6)} — ออเดอร์ดำเนินต่อปกติ`, "info");
      } else {
        notifySystem("Admin", "ปฏิเสธคำขอเรียบร้อย", "info");
      }
    }
  };

  const initiateCancelOrder = (orderId) => {
    setSelectedOrderToCancel(orderId);
    setCancelReasonInput('');
    setShowCancelModal(true);
  };

  const confirmCancelOrder = () => {
    if (!selectedOrderToCancel) return;
    const orderId = selectedOrderToCancel;
    const reason = cancelReasonInput.trim() || "ร้านค้ายกเลิกออเดอร์";

    // ── ดึง order ก่อน update state ──────────────────────────────────────
    const order = orders.find(o => o.id === orderId);
    if (!order || ['cancelled', 'delivered', 'completed'].includes(order.status)) {
      setShowCancelModal(false);
      setSelectedOrderToCancel(null);
      return;
    }

    // ── สร้าง cancelled order object ─────────────────────────────────────
    const cancelledOrder = { ...order, status: 'cancelled', cancelReason: reason };

    // ── อัปเดต state (PURE updater) ──────────────────────────────────────
    setOrders(prev => prev.map(o => o.id === orderId ? cancelledOrder : o));

    // ── คืนเงินลูกค้า (wallet) — ใช้ creditWallet เพื่อให้เงินกลับไปถูก wallet ──
    if (order.paymentMethod === 'wallet' && order.grandTotal > 0) {
      const desc = `คืนเงิน: ยกเลิกออเดอร์ #${order.id.slice(-6)} (${reason})`;
      creditWallet(order.customerId, order.grandTotal, desc);
      // ── sync เงินคืนไป Firestore ของลูกค้าทันที ────────────────────────
      if (FIREBASE_ENABLED) creditWalletInDB(order.customerId, order.grandTotal, desc).catch(() => {});
    }

    // ── บันทึก Firestore (partial update) ────────────────────────────────
    if (FIREBASE_ENABLED) updateOrderStatusInDB(orderId, {
      status: 'cancelled',
      cancelReason: reason,
    }).catch(() => {});

    setShowCancelModal(false);
    setSelectedOrderToCancel(null);
    notifySystem("ยกเลิกออเดอร์แล้ว", `#${orderId.slice(-6)} — ${order.paymentMethod === 'wallet' ? `คืนเงิน ฿${order.grandTotal} ให้ลูกค้าแล้ว` : 'ไม่มีการตัดเงิน'}`, "info");
  };

  /**
   * ── ลูกค้าส่งคำขอยกเลิกออเดอร์ → Admin อนุมัติ ─────────────────────────────
   * ไม่ยกเลิกทันที — สร้าง pending_request type 'cancel_order' ให้ Admin ตรวจสอบ
   * Admin อนุมัติ → order cancelled + คืนเงิน (wallet)
   * Admin ปฏิเสธ → ลบ request, order ดำเนินต่อปกติ
   */
  const requestCancelOrder = (orderId, reason) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    // กัน double-submit
    if (hasPendingCancelRequest(orderId)) {
      return notifySystem('รออนุมัติ', 'คำขอยกเลิกของออเดอร์นี้กำลังรอ Admin อนุมัติอยู่แล้ว', 'info');
    }
    const uid = userProfile.id || currentUser?.id || '';
    const newReq = {
      id: generateId(),
      type: 'cancel_order',
      userId: uid,
      user: userProfile.name || 'ลูกค้า',
      timestamp: new Date().toLocaleString('th-TH'),
      data: {
        orderId:        order.id,
        orderType:      order.type,
        restaurantName: order.restaurantName || (order.type === 'parcel' ? 'ส่งพัสดุ' : '-'),
        grandTotal:     order.grandTotal || 0,
        paymentMethod:  order.paymentMethod,
        prevStatus:     order.status,
        reason:         reason?.trim() || 'ไม่ระบุเหตุผล',
      },
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('ส่งคำขอแล้ว ✅', 'คำขอยกเลิกส่งถึง Admin เรียบร้อย รอการอนุมัติ', 'info');
  };

  /**
   * ── Cancel request by Merchant or Rider → ส่งขอ Admin อนุมัติ ─────────────
   */
  const requestCancelByRole = (orderId, reason, role) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (hasPendingCancelRequest(orderId)) {
      return notifySystem('รออนุมัติ', 'คำขอยกเลิกกำลังรอ Admin อนุมัติอยู่แล้ว', 'info');
    }
    const roleName = role === 'merchant' ? 'ร้านค้า' : role === 'rider' ? 'ไรเดอร์' : 'ผู้ใช้';
    const newReq = {
      id: generateId(),
      type: 'cancel_order',
      userId: userProfile.id || currentUser?.uid || '',
      user: `${roleName}: ${userProfile.name || ''}`,
      timestamp: new Date().toLocaleString('th-TH'),
      data: {
        orderId:        order.id,
        orderType:      order.type,
        restaurantName: order.restaurantName || (order.type === 'parcel' ? 'ส่งพัสดุ' : '-'),
        grandTotal:     order.grandTotal || 0,
        paymentMethod:  order.paymentMethod,
        prevStatus:     order.status,
        reason:         reason?.trim() || 'ไม่ระบุเหตุผล',
        requestedBy:    role,
      },
    };
    if (FIREBASE_ENABLED) savePendingRequest(newReq).catch(() => {});
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('ส่งคำขอแล้ว ✅', 'ส่งคำขอยกเลิกถึง Admin เรียบร้อย รอการอนุมัติ', 'info');
  };

  /**
   * ── Force Refresh: โหลดข้อมูลใหม่จาก Firestore + STATUS_RANK merge ─────────
   * ใช้เป็น fallback เมื่อ onSnapshot disconnect (เช่น network ไม่ดีบนมือถือ)
   * หรือเมื่อ user กด "รีเฟรช" ด้วยตัวเอง
   */
  const forceRefresh = useCallback(async () => {
    if (!FIREBASE_ENABLED) {
      notifySystem('รีเฟรช', 'โหลดข้อมูลแล้ว (offline mode)', 'info');
      return;
    }
    try {
      const [freshOrders, freshPending] = await Promise.all([
        loadAllOrders(),
        loadPendingRequests(),
      ]);

      if (freshOrders && freshOrders.length > 0) {
        const STATUS_RANK = {
          pending: 1, preparing: 2, ready_to_pickup: 3,
          rider_accepted: 4, picking_up: 5, delivering: 6,
          delivered: 7, completed: 8, cancelled: 9,
        };
        setOrders(prev => {
          const localMap = new Map(prev.map(o => [o.id, o]));
          const merged = freshOrders.map(co => {
            const lo = localMap.get(co.id);
            if (!lo) return co;
            const cloudRank = STATUS_RANK[co.status] ?? 0;
            const localRank = STATUS_RANK[lo.status] ?? 0;
            return localRank > cloudRank ? lo : co;
          });
          prev.forEach(lo => {
            if (!merged.find(co => co.id === lo.id)) {
              if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
            }
          });
          const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
          deduped.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          safeLocalSet('boomrider_orders', deduped);
          return deduped;
        });
      }

      if (freshPending) {
        setPendingRequests(freshPending);
        safeLocalSet('boomrider_pending_requests', freshPending);
      }

      notifySystem('รีเฟรชแล้ว ✅', 'โหลดข้อมูลล่าสุดเรียบร้อย', 'success');
    } catch (_) {
      notifySystem('รีเฟรช', 'ไม่สามารถโหลดข้อมูลได้ตอนนี้', 'error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-refresh fallback (ทุก 60 วินาที) — ต้องอยู่หลัง forceRefresh เพื่อหลีก TDZ ---
  // ป้องกัน onSnapshot หลุดเงียบๆ บนมือถือที่ network ไม่เสถียร
  useEffect(() => {
    if (!FIREBASE_ENABLED) return;
    const timer = setInterval(() => {
      if (!document.hidden) forceRefresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveShopEdit = () => {
    let savedRest = null;
    setRestaurants(prev => prev.map(r => {
      if (r.id !== editingShop) return r;
      savedRest = { ...r, ...shopEditForm };
      return savedRest;
    }));
    // ── sync การแก้ไขข้อมูลร้านไป Firestore ────────────────────────────────
    if (FIREBASE_ENABLED && savedRest) saveRestaurant(savedRest).catch(() => {});
    setEditingShop(null);
    notifySystem("สำเร็จ", "บันทึกข้อมูลร้านค้าเรียบร้อย", "success");
  };

  const toggleRestaurantStatus = (id, action) => {
    setRestaurants(prev => prev.map(r => {
      if (r.id !== id) return r;
      let updated = r;
      if (action === 'toggle_open') updated = { ...r, status: r.status === 'open' ? 'closed' : 'open' };
      if (action === 'ban')         updated = { ...r, status: r.status === 'banned' ? 'open' : 'banned' };
      // ── sync สถานะร้าน (เปิด/ปิด/แบน) ไป Firestore ──────────────────────
      if (updated !== r && FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
      return updated;
    }));
  };

  const toggleRiderBan = (id) => {
    setRiders(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, status: r.status === 'banned' ? 'active' : 'banned' };
      // ── sync สถานะไรเดอร์ (active/banned) ไป Firestore ──────────────────
      if (FIREBASE_ENABLED) saveRider(updated).catch(() => {});
      return updated;
    }));
  };

  // --- ไรเดอร์อัปเดตจุดปฏิบัติงาน (ปักหมุดแผนที่) ---
  const updateRiderWorkingLocation = useCallback(async (riderId, location) => {
    if (!riderId || !location) return;
    setRiders(prev => prev.map(r => r.id === riderId ? { ...r, location } : r));
    if (FIREBASE_ENABLED) {
      updateRiderLocation(riderId, location).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Manual role/pending sync (for cross-session updates) ---
  const syncRoles = useCallback(async () => {
    const uid = currentUser?.id || userProfile?.id;
    if (!uid) return;
    const allRoles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    const latest = allRoles[uid];
    if (latest && latest.length > 0) {
      const withAdmin = ADMIN_UID && uid === ADMIN_UID ? [...new Set([...latest, 'admin'])] : latest;
      setUserRoles(withAdmin);
    }
    const savedPending = JSON.parse(localStorage.getItem('boomrider_pending_requests') || '[]');
    setPendingRequests(savedPending);
    // โหลดไรเดอร์จาก Firestore ใหม่ (ช่วยเมื่อ admin อนุมัติบน device อื่น)
    if (FIREBASE_ENABLED) {
      try {
        const cloudRiders = await loadRiders();
        if (cloudRiders && cloudRiders.length > 0) {
          setRiders(cloudRiders);
          safeLocalSet('boomrider_riders', cloudRiders);
        }
      } catch {}
    }
    notifySystem("อัปเดต", "โหลดข้อมูลล่าสุดแล้ว", "success");
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auth Functions ---
  const handleLogin = async () => {
    if (!loginForm.phone && !loginForm.email) return notifySystem("ผิดพลาด", "กรุณากรอกเบอร์โทรหรืออีเมล", "error");
    if (!loginForm.password) return notifySystem("ผิดพลาด", "กรุณากรอกรหัสผ่าน", "error");
    if (FIREBASE_ENABLED && loginForm.email) {
      try {
        const fbUser = await loginWithEmail(loginForm.email, loginForm.password);
        const savedRaw = localStorage.getItem('boomrider_user');
        const saved = savedRaw ? JSON.parse(savedRaw) : null;
        const profile = {
          id: fbUser.uid, name: fbUser.displayName || saved?.name || loginForm.email,
          phone: fbUser.phoneNumber || saved?.phone || '', email: fbUser.email || loginForm.email,
          image: fbUser.photoURL || saved?.profile?.image || null, location: USER_LOCATION,
        };
        const loginRoles = ADMIN_UID && fbUser.uid === ADMIN_UID ? ['customer', 'admin'] : (saved?.roles || ['customer']);
        const wallets = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}');
        const gw = wallets[fbUser.uid];
        const allRoles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
        const savedRoles = allRoles[fbUser.uid] || loginRoles;
        const finalRoles = ADMIN_UID && fbUser.uid === ADMIN_UID ? [...new Set([...savedRoles, 'admin'])] : savedRoles;
        const user = {
          id: fbUser.uid, name: profile.name, phone: profile.phone, email: profile.email,
          profile, roles: finalRoles,
          wallet: gw?.balance ?? saved?.wallet ?? 0,
          walletHistory: gw?.history ?? saved?.walletHistory ?? [],
          addresses: saved?.addresses || [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
        };
        localStorage.setItem('boomrider_user', JSON.stringify(user));
        setCurrentUser(user); setIsLoggedIn(true); setUserProfile(profile); setTempProfile(profile);
        setUserRoles(finalRoles); setUserWallet(user.wallet); setWalletHistory(user.walletHistory); setUserAddresses(user.addresses);
        notifySystem("สำเร็จ", "เข้าสู่ระบบเรียบร้อย!", "success");
        return;
      } catch (err) {
        const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
          : err.code === 'auth/user-not-found' ? 'ไม่พบบัญชีนี้ในระบบ'
          : err.code === 'auth/unauthorized-domain' ? 'Domain ยังไม่ได้รับอนุญาต กรุณาเพิ่ม domain ใน Firebase Console'
          : err.code === 'auth/too-many-requests' ? 'ลองใหม่ภายหลัง (ส่งคำขอมากเกินไป)'
          : (err.code || err.message || 'เกิดข้อผิดพลาด');
        return notifySystem("ผิดพลาด", msg, "error");
      }
    }
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const user = users.find(u => (u.phone === loginForm.phone && loginForm.phone) || (u.email === loginForm.email && loginForm.email));
    if (!user || user.password !== loginForm.password) return notifySystem("ผิดพลาด", "เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง", "error");
    const allRolesLocal = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    const localFinalRoles = allRolesLocal[user.profile?.id || user.id] || allRolesLocal[user.id] || user.roles || ['customer'];
    const updatedUser = { ...user, roles: localFinalRoles };
    localStorage.setItem('boomrider_user', JSON.stringify(updatedUser));
    setCurrentUser(updatedUser); setIsLoggedIn(true); setUserProfile(user.profile); setTempProfile(user.profile);
    setUserRoles(localFinalRoles); setUserWallet(user.wallet); setWalletHistory(user.walletHistory); setUserAddresses(user.addresses);
    notifySystem("สำเร็จ", "เข้าสู่ระบบเรียบร้อย!", "success");
  };

  const handleLoginWithGoogle = async () => {
    if (!FIREBASE_ENABLED) return notifySystem("แจ้งเตือน", "Firebase ยังไม่ได้ตั้งค่า", "warning");
    try {
      await loginWithGoogle();
      notifySystem("สำเร็จ", "เข้าสู่ระบบด้วย Google เรียบร้อย!", "success");
    } catch (err) {
      const code = err?.code || '';
      const msg =
        code === 'auth/unauthorized-domain'
          ? '🚫 Domain นี้ยังไม่ได้รับอนุญาต — ไปที่ Firebase Console › Authentication › Authorized domains แล้วเพิ่ม boomrider.vercel.app'
        : code === 'auth/popup-blocked'
          ? '🚫 Browser บล็อก Popup — กรุณาอนุญาต Popup สำหรับเว็บไซต์นี้แล้วลองใหม่'
        : code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'ยกเลิกการเข้าสู่ระบบ'
        : code === 'auth/network-request-failed'
          ? 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต'
        : (err.message || 'Google login ล้มเหลว');
      notifySystem("ผิดพลาด", msg, "error");
    }
  };

  const handleRegister = async () => {
    if (!registerForm.name) return notifySystem("ผิดพลาด", "กรุณากรอกชื่อ-นามสกุล", "error");
    if (FIREBASE_ENABLED && !registerForm.email) return notifySystem("ผิดพลาด", "กรุณากรอกอีเมล", "error");
    if (!FIREBASE_ENABLED && !registerForm.phone && !registerForm.email) return notifySystem("ผิดพลาด", "กรุณากรอกเบอร์โทรหรืออีเมล", "error");
    if (!registerForm.password) return notifySystem("ผิดพลาด", "กรุณากรอกรหัสผ่าน", "error");
    if (registerForm.password.length < 6) return notifySystem("ผิดพลาด", "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", "error");
    if (registerForm.password !== registerForm.confirmPassword) return notifySystem("ผิดพลาด", "รหัสผ่านไม่ตรงกัน", "error");
    if (FIREBASE_ENABLED && registerForm.email) {
      try {
        const fbUser = await registerWithEmail(registerForm.email, registerForm.password, registerForm.name);
        const profile = { id: fbUser.uid, name: registerForm.name, phone: registerForm.phone, email: registerForm.email, image: null, location: USER_LOCATION };
        const newUser = {
          id: fbUser.uid, name: registerForm.name, phone: registerForm.phone, email: registerForm.email,
          profile, roles: ['customer'], wallet: 0, walletHistory: [],
          addresses: [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
        };
        localStorage.setItem('boomrider_user', JSON.stringify(newUser));
        setCurrentUser(newUser); setIsLoggedIn(true); setUserProfile(profile); setTempProfile(profile);
        setUserRoles(['customer']); setUserWallet(0); setWalletHistory([]); setUserAddresses(newUser.addresses);
        notifySystem("สำเร็จ", "สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ", "success");
        return;
      } catch (err) {
        const msg = err.code === 'auth/email-already-in-use' ? 'อีเมลนี้ถูกใช้งานแล้ว — ลองเข้าสู่ระบบแทน'
          : err.code === 'auth/weak-password' ? 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
          : err.code === 'auth/unauthorized-domain' ? 'Domain ยังไม่ได้รับอนุญาต กรุณาเพิ่ม domain ใน Firebase Console'
          : err.code === 'auth/invalid-email' ? 'รูปแบบอีเมลไม่ถูกต้อง'
          : (err.code || err.message || 'เกิดข้อผิดพลาด');
        return notifySystem("ผิดพลาด", msg, "error");
      }
    }
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const existingUser = users.find(u => (u.phone === registerForm.phone && registerForm.phone) || (u.email === registerForm.email && registerForm.email));
    if (existingUser) return notifySystem("ผิดพลาด", "เบอร์โทรหรืออีเมลนี้ถูกใช้งานแล้ว", "error");
    const newUserId = generateId();
    const newUser = {
      id: newUserId, name: registerForm.name, phone: registerForm.phone, email: registerForm.email,
      password: registerForm.password,
      profile: { id: newUserId, name: registerForm.name, phone: registerForm.phone, email: registerForm.email, location: USER_LOCATION, image: null },
      roles: ['customer'], wallet: 0, walletHistory: [],
      addresses: [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    localStorage.setItem('boomrider_users', JSON.stringify(users));
    localStorage.setItem('boomrider_user', JSON.stringify(newUser));
    setCurrentUser(newUser); setIsLoggedIn(true); setUserProfile(newUser.profile); setTempProfile(newUser.profile);
    setUserRoles(newUser.roles); setUserWallet(newUser.wallet); setWalletHistory(newUser.walletHistory); setUserAddresses(newUser.addresses);
    notifySystem("สำเร็จ", "สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ", "success");
  };

  // Bug fix: reset to clean empty profile instead of hardcoded user
  const handleLogout = () => {
    // ยกเลิก real-time subscriptions ก่อน logout
    if (window.__boomriderUnsubOrders) {
      window.__boomriderUnsubOrders();
      window.__boomriderUnsubOrders = null;
    }
    if (window.__boomriderUnsubPending) {
      window.__boomriderUnsubPending();
      window.__boomriderUnsubPending = null;
    }
    if (window.__boomriderUnsubChats) {
      window.__boomriderUnsubChats();
      window.__boomriderUnsubChats = null;
    }
    lastChatCountsRef.current = {};
    chatSubInitializedRef.current = false;
    // ── cleanup wallet subscription ───────────────────────────────────────────
    if (walletUnsubRef.current) {
      walletUnsubRef.current();
      walletUnsubRef.current = null;
    }
    walletFromFirestoreRef.current = false;
    walletSubscribedRef.current = false;
    setIsLoggedIn(false);
    setCurrentUser(null);
    setUserProfile({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
    setTempProfile({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
    setUserRoles(['customer']);
    setUserWallet(0);
    setWalletHistory([]);
    setUserAddresses([]);
    localStorage.removeItem('boomrider_user');
    if (FIREBASE_ENABLED) firebaseLogout().catch(() => {});
    setActiveRole('customer');
    setActiveTab('home');
    setProfileSubView('main');
  };

  // --- Context Value ---
  const value = {
    // Navigation
    activeRole, setActiveRole,
    adminTab, setAdminTab,
    merchantTab, setMerchantTab,
    riderTab, setRiderTab,
    activeTab, setActiveTab,
    profileSubView, setProfileSubView,
    serviceType, setServiceType,

    // Data
    orders, setOrders,
    appConfig, setAppConfig,
    restaurants, setRestaurants,
    riders, setRiders,
    menuItems, setMenuItems,
    pendingRequests, setPendingRequests,

    // Auth
    isLoggedIn,
    currentUser,
    loginForm, setLoginForm,
    registerForm, setRegisterForm,
    authMode, setAuthMode,
    handleLogin,
    handleLoginWithGoogle,
    handleRegister,
    handleLogout,

    // User Profile
    userProfile, setUserProfile,
    userRoles, setUserRoles,
    userAddresses, setUserAddresses,
    userWallet, setUserWallet,
    walletHistory, setWalletHistory,
    tempProfile, setTempProfile,
    isAdmin,
    globalWallets,

    // Cart & Orders
    cart, setCart,
    selectedRestaurant, setSelectedRestaurant,
    parcelDetails, setParcelDetails,
    paymentMethod, setPaymentMethod,
    parcelMapTarget, setParcelMapTarget,
    parcelDistance, setParcelDistance,
    parcelEstimate, setParcelEstimate,
    addToCart,
    calculateFoodTotal,
    calculateDeliveryFee,
    placeOrder,
    placeParcelOrder,
    acceptOrder,
    updateOrderStatus,

    // Forms & Modals
    newAddr, setNewAddr,
    withdrawMode, setWithdrawMode,
    withdrawAmount, setWithdrawAmount,
    withdrawBank, setWithdrawBank,
    withdrawAccount, setWithdrawAccount,
    withdrawName, setWithdrawName,
    merchantRegForm, setMerchantRegForm,
    riderRegForm, setRiderRegForm,
    editConfig, setEditConfig,
    isEditingMenu, setIsEditingMenu,
    editingShop, setEditingShop,
    shopEditForm, setShopEditForm,
    editForm, setEditForm,
    showCancelModal, setShowCancelModal,
    selectedOrderToCancel, setSelectedOrderToCancel,
    cancelReasonInput, setCancelReasonInput,
    showRejectModal, setShowRejectModal,
    selectedRequestToReject, setSelectedRequestToReject,
    riderJobPhotos, setRiderJobPhotos,
    showProofModal, setShowProofModal,
    selectedProofOrder, setSelectedProofOrder,
    showImageModal, setShowImageModal,
    previewImageUrl, setPreviewImageUrl,
    showTopUpModal, setShowTopUpModal,
    topUpSlip, setTopUpSlip,

    // Chat
    activeChat, setActiveChat,
    chats, setChats,
    openChatWindow,
    closeChatWindow,
    sendMessage,
    deleteChat,

    // Toast
    toasts,
    notifySystem,
    removeToast,

    // Photo handlers
    handleRiderPhotoUpload,
    handleProfilePhotoChange,
    handleShopPhotoChange,
    handleRegistrationPhotoSelect,
    handleTopUpSlipSelect,
    handleMenuPhotoSelect,
    openImagePreview,
    openProofModal,

    // Merchant management
    handleUpdateShopLocation,
    handleToggleShopStatus,
    handleAddMenuItem,
    handleEditMenuItem,
    handleDeleteMenuItem,
    handleToggleItemAvailability,
    saveShopEdit,
    toggleRestaurantStatus,
    toggleRiderBan,

    // Address management
    handleUpdateUserLocation,
    handleAddAddress,
    handleUpdateAddress,
    handleDeleteAddress,
    getCurrentLocationForForm,
    getCurrentLocationForParcel,
    handleMapLocationSelect,
    handleParcelMapSelect,
    isPending,

    // Request logic
    requestTopUp,
    requestWithdraw,
    requestRegisterMerchant,
    requestRegisterRider,

    // Admin logic
    handleApproveRequest,
    initiateRejectRequest,
    confirmRejectRequest,
    initiateCancelOrder,
    confirmCancelOrder,
    requestCancelOrder,
    requestCancelByRole,
    hasPendingCancelRequest,
    forceRefresh,

    // Wallet
    processTransaction,
    creditWallet,
    grantRole,

    // Rider location
    updateRiderWorkingLocation,

    // Firebase flag
    FIREBASE_ENABLED,

    // Sync
    syncRoles,

    // Promo codes
    promoCodes, setPromoCodes,
    validatePromoCode, usePromoCode, createPromoCode, togglePromoCode, deletePromoCode,

    // Admin tools
    adminAdjustWallet, adminBanUser,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export default AppContext;
