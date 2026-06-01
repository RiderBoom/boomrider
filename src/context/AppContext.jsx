import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  INITIAL_CONFIG, INITIAL_RESTAURANTS, INITIAL_RIDERS, INITIAL_MENU_ITEMS,
  USER_LOCATION, FIREBASE_ENABLED, ADMIN_UID,
} from '../constants';
import { generateId, getDistanceFromLatLonInKm, compressImage, playNotificationSound, formatDateTime } from '../utils';
import {
  loginWithEmail, registerWithEmail, loginWithGoogle, logout as firebaseLogout, onAuthChange,
} from '../firebase/auth';
import { requestNotificationPermission, onForegroundMessage, saveFcmToken } from '../firebase/messaging';
import {
  saveOrder, updateOrderStatusInDB, saveAppConfig, loadAppConfig, loadAllOrders,
  saveWallet, loadWallet, creditWalletInDB, subscribeToWallet, initWalletIfNew, subscribeToAllWallets,
  saveRestaurant, loadRestaurants, deleteRestaurantFromDB, subscribeToRestaurants,
  saveMenuItems, loadMenuItems, subscribeToMenuItems,
  savePendingRequest, deletePendingRequest, loadPendingRequests, subscribeToPendingRequests,
  saveRider, loadRiders, deleteRiderFromDB, updateRiderLocation, subscribeToRiders,
  saveChat, subscribeToChats, subscribeToSupportChat, deleteChatFromDB, appendChatMessage,
  saveUserProfile, loadUserProfile, subscribeToUserProfile, saveUserRoles, setBanUser,
  safeLocalSet,
  acceptOrderTransaction, subscribeToOrders,
  atomicOrderCompletion, subscribeToConfig,
  saveTransaction,
  addWalletEntry, subscribeToWalletEntries, clearWalletHistory,
  savePromoCodes, subscribeToPromoCodes,
  saveAdminNotif, subscribeToAdminNotifs,
} from '../firebase/firestore';

import { useWalletActions } from './hooks/useWalletActions';
import { useOrderActions }  from './hooks/useOrderActions';
import { useAdminActions }  from './hooks/useAdminActions';

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
    id: '', name: '', phone: '', email: '', location: USER_LOCATION,
  });
  const [userRoles, setUserRoles] = useState(['customer']);
  const [userAddresses, setUserAddresses] = useState([
    { id: 1, label: 'บ้าน', address: '123 คอนโดใจกลางเมือง', location: USER_LOCATION },
  ]);
  const [userWallet, setUserWallet] = useState(0);
  const [walletAllEntries, setWalletAllEntries] = useState([]);
  const [walletClearedAt, setWalletClearedAt] = useState(null);
  const walletHistory = useMemo(() => {
    if (!walletClearedAt) return walletAllEntries;
    const ms = walletClearedAt?.toMillis ? walletClearedAt.toMillis() : 0;
    return walletAllEntries.filter(e => (e.createdAtMs || 0) > ms);
  }, [walletAllEntries, walletClearedAt]);

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

  // --- Refs ---
  const restaurantsRef = React.useRef(INITIAL_RESTAURANTS);
  const currentUserRef = React.useRef(null);
  useEffect(() => { restaurantsRef.current = restaurants; }, [restaurants]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  const seenOrderIdsRef        = React.useRef(new Set());
  const subInitializedRef      = React.useRef(false);
  const placingOrderRef        = React.useRef(false);
  const pendingLocalOrderIdsRef = React.useRef(new Set());
  const lastChatCountsRef      = React.useRef({});
  const chatSubInitializedRef  = React.useRef(false);
  const walletFromFirestoreRef = React.useRef(false);
  const walletSubscribedRef    = React.useRef(false);
  const walletUnsubRef         = React.useRef(null);
  const walletEntriesUnsubRef  = React.useRef(null);
  const allWalletsUnsubRef     = React.useRef(null);
  const userProfileUnsubRef    = React.useRef(null);
  const promoUnsubRef          = React.useRef(null);
  const adminNotifsUnsubRef    = React.useRef(null);

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

  useEffect(() => {
    localStorage.setItem('boomrider_wallets', JSON.stringify(globalWallets));
  }, [globalWallets]);

  // --- Toast / Notification ---
  const notifySystem = (title, message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch {}
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // --- Admin notification ---
  const notifyAdmin = useCallback((title, message, type = 'warning') => {
    const notif = { id: Date.now(), title, message, type, at: formatDateTime() };
    if (FIREBASE_ENABLED) saveAdminNotif(notif).catch(() => {});
    if (!FIREBASE_ENABLED) {
      const queue = JSON.parse(localStorage.getItem('boomrider_admin_notifs') || '[]');
      queue.unshift(notif);
      localStorage.setItem('boomrider_admin_notifs', JSON.stringify(queue.slice(0, 50)));
    }
    if (isAdmin) notifySystem(title, message, type);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Role grant ---
  const grantRole = (userId, role) => {
    setGlobalUserRoles(prev => {
      const cur = prev[userId] || ['customer'];
      if (cur.includes(role)) return prev;
      const next = [...cur, role];
      if (FIREBASE_ENABLED) saveUserRoles(userId, next).catch(() => {});
      return { ...prev, [userId]: next };
    });
    if (currentUser?.id === userId || userProfile?.id === userId) {
      setUserRoles(prev => prev.includes(role) ? prev : [...prev, role]);
    }
  };

  // ── Wallet hook ─────────────────────────────────────────────────────────────
  const { creditWallet, processTransaction, requestTopUp, requestWithdraw, adminAdjustWallet } = useWalletActions({
    currentUser, currentUserRef,
    userProfile, userWallet, pendingRequests,
    setUserWallet, setWalletAllEntries, setGlobalWallets, setPendingRequests,
    setShowTopUpModal, setTopUpSlip,
    setWithdrawAmount, setWithdrawBank, setWithdrawAccount, setWithdrawName, setWithdrawMode,
    notifySystem, notifyAdmin,
  });

  // ── Order hook ──────────────────────────────────────────────────────────────
  const {
    calculateDeliveryFee, calculateFoodTotal, isPending, hasPendingCancelRequest,
    addToCart, placeOrder, placeParcelOrder, acceptOrder, updateOrderStatus,
    initiateCancelOrder, confirmCancelOrder, requestCancelOrder, requestCancelByRole,
    forceRefresh,
  } = useOrderActions({
    orders, setOrders,
    cart, setCart,
    restaurants, riders, appConfig,
    currentUser, userProfile, userAddresses, userWallet,
    parcelDetails, setParcelDetails,
    parcelDistance, parcelEstimate,
    paymentMethod, setPaymentMethod,
    pendingRequests, setPendingRequests,
    selectedOrderToCancel, setSelectedOrderToCancel,
    cancelReasonInput, setCancelReasonInput,
    setShowCancelModal,
    setSelectedRestaurant, setActiveTab,
    setParcelMapTarget, setParcelEstimate, setParcelDistance,
    placingOrderRef, pendingLocalOrderIdsRef,
    creditWallet, processTransaction,
    notifySystem, notifyAdmin,
  });

  // ── Admin hook ──────────────────────────────────────────────────────────────
  const {
    handleApproveRequest, initiateRejectRequest, confirmRejectRequest,
    adminBanUser, toggleRestaurantStatus, toggleRiderBan, saveShopEdit,
  } = useAdminActions({
    orders, setOrders,
    riders, setRiders,
    restaurants, setRestaurants,
    menuItems, setMenuItems,
    pendingRequests, setPendingRequests,
    globalWallets, setGlobalWallets,
    editingShop, shopEditForm, setEditingShop,
    selectedRequestToReject, setSelectedRequestToReject,
    setShowRejectModal,
    creditWallet, grantRole,
    notifySystem,
  });

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
  }, []);

  // ── Admin: subscribe to all wallets (real-time) ──────────────────────────
  useEffect(() => {
    if (!FIREBASE_ENABLED || !isAdmin) {
      if (allWalletsUnsubRef.current) { allWalletsUnsubRef.current(); allWalletsUnsubRef.current = null; }
      return;
    }
    if (allWalletsUnsubRef.current) allWalletsUnsubRef.current();
    allWalletsUnsubRef.current = subscribeToAllWallets((wallets) => {
      setGlobalWallets(wallets);
    });
    return () => {
      if (allWalletsUnsubRef.current) { allWalletsUnsubRef.current(); allWalletsUnsubRef.current = null; }
    };
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Admin notifications: Firestore or localStorage polling ──────────────
  useEffect(() => {
    if (!isAdmin) {
      if (adminNotifsUnsubRef.current) { adminNotifsUnsubRef.current(); adminNotifsUnsubRef.current = null; }
      return;
    }
    if (FIREBASE_ENABLED) {
      const loginTs = Date.now();
      let seenMax = loginTs;
      adminNotifsUnsubRef.current = subscribeToAdminNotifs((notifs) => {
        const fresh = notifs.filter(n => n.id > seenMax);
        if (fresh.length > 0) {
          fresh.forEach(n => notifySystem(n.title || 'แจ้งเตือน', n.message || '', n.type || 'warning'));
          seenMax = Math.max(seenMax, ...fresh.map(n => n.id));
        }
      });
      return () => { if (adminNotifsUnsubRef.current) { adminNotifsUnsubRef.current(); adminNotifsUnsubRef.current = null; } };
    }
    const check = () => {
      const queue = JSON.parse(localStorage.getItem('boomrider_admin_notifs') || '[]');
      const last  = parseInt(localStorage.getItem('boomrider_admin_last_check') || '0');
      const newNotifs = queue.filter(n => n.id > last);
      if (newNotifs.length > 0) {
        newNotifs.forEach(n => notifySystem(n.title, n.message, n.type));
        localStorage.setItem('boomrider_admin_last_check', String(Date.now()));
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Promo Codes: subscribe from Firestore ────────────────────────────────
  useEffect(() => {
    if (!FIREBASE_ENABLED) return;
    const unsub = subscribeToPromoCodes((codes) => {
      if (codes.length > 0) {
        setPromoCodes(codes);
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('boomrider_promo_codes') || '[]');
          if (local.length > 0) savePromoCodes(local).catch(() => {});
        } catch {}
      }
    });
    promoUnsubRef.current = unsub;
    return () => { unsub(); promoUnsubRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-save to localStorage ---
  useEffect(() => { safeLocalSet('boomrider_restaurants', restaurants); }, [restaurants]);
  useEffect(() => { safeLocalSet('boomrider_riders', riders); }, [riders]);
  useEffect(() => { safeLocalSet('boomrider_orders', orders); }, [orders]);
  useEffect(() => { safeLocalSet('boomrider_menu_items', menuItems); }, [menuItems]);
  useEffect(() => { safeLocalSet('boomrider_appconfig', appConfig); }, [appConfig]);
  useEffect(() => { safeLocalSet('boomrider_pending_requests', pendingRequests); }, [pendingRequests]);

  // ── Fetch live wallet balances for users with pending requests ──────────
  useEffect(() => {
    if (!FIREBASE_ENABLED) return;
    const uids = [...new Set(
      pendingRequests
        .filter(r => r.type === 'withdraw' || r.type === 'topup')
        .map(r => r.userId)
        .filter(Boolean),
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

  // Auto-grant merchant/rider role (recovery mechanism)
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

  // Sync userRoles from globalUserRoles when it changes
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
      setWalletAllEntries(gw?.history ?? user.walletHistory ?? []);
      setUserAddresses(user.addresses || []);
    }

    if (FIREBASE_ENABLED) {
      const unsubscribe = onAuthChange(async (firebaseUser) => {
        if (!firebaseUser) {
          const savedRaw = localStorage.getItem('boomrider_user');
          const saved = savedRaw ? JSON.parse(savedRaw) : null;
          if (saved && saved.id && saved.id.length > 20) {
            localStorage.removeItem('boomrider_user');
            setIsLoggedIn(false);
            setCurrentUser(null);
          }
          return;
        }

        const savedRaw = localStorage.getItem('boomrider_user');
        const saved = savedRaw ? JSON.parse(savedRaw) : null;
        const isExistingSession = saved?.id === firebaseUser.uid;

        if (!isExistingSession) {
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
          const allRolesMap  = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
          const storedRoles  = allRolesMap[firebaseUser.uid] || saved?.roles || ['customer'];
          const baseRoles    = ADMIN_UID && firebaseUser.uid === ADMIN_UID
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
          if (FIREBASE_ENABLED) initWalletIfNew(firebaseUser.uid).catch(() => {});
        } else {
          try {
            const cloudProfile = await loadUserProfile(firebaseUser.uid);
            if (cloudProfile?.location) {
              const loc = cloudProfile.location;
              setUserProfile(prev => ({ ...prev, location: loc }));
              localStorage.setItem(`boomrider_loc_${firebaseUser.uid}`, JSON.stringify(loc));
            }
          } catch (_) {}
        }

        // ── Cleanup & restart order subscription ────────────────────────────
        if (window.__boomriderUnsubOrders) {
          window.__boomriderUnsubOrders();
          window.__boomriderUnsubOrders = null;
        }
        seenOrderIdsRef.current = new Set();
        subInitializedRef.current = false;
        pendingLocalOrderIdsRef.current = new Set();

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
                return (STATUS_RANK[lo.status] ?? 0) > (STATUS_RANK[co.status] ?? 0) ? lo : co;
              });
              prev.forEach(lo => {
                if (!merged.find(co => co.id === lo.id)) {
                  if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
                }
              });
              const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
              deduped.sort((a, b) => {
                const tsA = parseInt((a.id || '').split('-')[0], 10) || 0;
                const tsB = parseInt((b.id || '').split('-')[0], 10) || 0;
                return tsB - tsA;
              });
              safeLocalSet('boomrider_orders', deduped);
              return deduped;
            });
          }
        } catch (_) {}

        const unsubOrders = subscribeToOrders(
          (cloudOrders) => {
            if (!subInitializedRef.current) {
              cloudOrders.forEach(co => {
                seenOrderIdsRef.current.add(co.id);
                if (co.status === 'completed') seenOrderIdsRef.current.add(`${co.id}_completed`);
              });
              subInitializedRef.current = true;
            } else {
              const uid    = currentUserRef.current?.id;
              const myShop = uid ? restaurantsRef.current.find(r => r.ownerId === uid) : null;

              if (myShop) {
                const newMerchantOrders = cloudOrders.filter(co =>
                  co.status === 'pending' && co.restaurantId === myShop.id && !seenOrderIdsRef.current.has(co.id),
                );
                if (newMerchantOrders.length > 0) {
                  playNotificationSound('order');
                  setTimeout(() => notifySystem('🛎️ ออเดอร์ใหม่เข้าร้าน!', `มี ${newMerchantOrders.length} ออเดอร์ใหม่รอยืนยัน`, 'warning'), 0);
                }
              }

              const newJobs = cloudOrders.filter(co =>
                co.status === 'ready_to_pickup' && !co.riderId && !seenOrderIdsRef.current.has(co.id),
              );
              if (newJobs.length > 0) {
                playNotificationSound('rider');
                setTimeout(() => notifySystem('🔔 มีงานใหม่เข้า!', `${newJobs.length} งานรอรับในบริเวณใกล้เคียง`, 'warning'), 0);
              }

              if (uid) {
                const justCompleted = cloudOrders.filter(co =>
                  co.status === 'completed' && co.customerId === uid && !seenOrderIdsRef.current.has(`${co.id}_completed`),
                );
                if (justCompleted.length > 0) {
                  justCompleted.forEach(co => seenOrderIdsRef.current.add(`${co.id}_completed`));
                  playNotificationSound('order');
                  const label = justCompleted[0].type === 'parcel' ? 'พัสดุ' : 'อาหาร';
                  setTimeout(() => notifySystem(`✅ จัดส่ง${label}สำเร็จ!`, `ออเดอร์ #${justCompleted[0].id.slice(-8)} ถึงมือคุณแล้ว 🎉`, 'success'), 0);
                }

                const justCancelled = cloudOrders.filter(co =>
                  co.status === 'cancelled' && co.customerId === uid && !seenOrderIdsRef.current.has(`${co.id}_cancelled`),
                );
                if (justCancelled.length > 0) {
                  justCancelled.forEach(co => seenOrderIdsRef.current.add(`${co.id}_cancelled`));
                  const reason = justCancelled[0].cancelReason ? `: ${justCancelled[0].cancelReason}` : '';
                  setTimeout(() => notifySystem('❌ ออเดอร์ถูกยกเลิก', `#${justCancelled[0].id.slice(-8)}${reason}`, 'error'), 0);
                }
              }

              cloudOrders.forEach(co => seenOrderIdsRef.current.add(co.id));
            }

            const STATUS_RANK = {
              pending: 1, preparing: 2, ready_to_pickup: 3,
              rider_accepted: 4, picking_up: 5, delivering: 6,
              delivered: 7, completed: 8, cancelled: 9,
            };
            setOrders(prev => {
              const localMap = new Map(prev.map(o => [o.id, o]));
              const merged = cloudOrders.map(co => {
                const lo = localMap.get(co.id);
                if (lo) pendingLocalOrderIdsRef.current.delete(co.id);
                if (!lo) return co;
                return (STATUS_RANK[lo.status] ?? 0) > (STATUS_RANK[co.status] ?? 0) ? lo : co;
              });
              prev.forEach(lo => {
                if (!merged.find(co => co.id === lo.id)) {
                  if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
                }
              });
              const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
              deduped.sort((a, b) => {
                const tsA = parseInt((a.id || '').split('-')[0], 10) || 0;
                const tsB = parseInt((b.id || '').split('-')[0], 10) || 0;
                return tsB - tsA;
              });
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
                    return (STATUS_RANK[lo.status] ?? 0) > (STATUS_RANK[co.status] ?? 0) ? lo : co;
                  });
                  prev.forEach(lo => {
                    if (!merged.find(co => co.id === lo.id)) {
                      if (pendingLocalOrderIdsRef.current.has(lo.id)) merged.push(lo);
                    }
                  });
                  const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
                  deduped.sort((a, b) => {
                const tsA = parseInt((a.id || '').split('-')[0], 10) || 0;
                const tsB = parseInt((b.id || '').split('-')[0], 10) || 0;
                return tsB - tsA;
              });
                  safeLocalSet('boomrider_orders', deduped);
                  return deduped;
                });
              }
            } catch (_) {}
          },
        );
        window.__boomriderUnsubOrders = unsubOrders;

        // ── Subscribe real-time pending_requests ─────────────────────────────
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

        // ── Subscribe real-time chats ─────────────────────────────────────────
        if (window.__boomriderUnsubChats) {
          window.__boomriderUnsubChats();
          window.__boomriderUnsubChats = null;
        }
        lastChatCountsRef.current = {};
        chatSubInitializedRef.current = false;

        const fbUid        = firebaseUser.uid;
        const isAdminSession = fbUid === ADMIN_UID;

        const handleChatUpdate = (chatUpdate, replaceAll) => {
          if (!chatSubInitializedRef.current) {
            Object.entries(chatUpdate).forEach(([id, msgs]) => {
              lastChatCountsRef.current[id] = (msgs || []).length;
            });
            chatSubInitializedRef.current = true;
          } else {
            Object.entries(chatUpdate).forEach(([chatId, msgs]) => {
              if (!msgs || msgs.length === 0) return;
              const prevCount = lastChatCountsRef.current[chatId] || 0;
              if (msgs.length <= prevCount) return;
              const newMsgs = msgs.slice(prevCount);
              lastChatCountsRef.current[chatId] = msgs.length;

              if (isAdminSession && chatId.startsWith('support-')) {
                const hasNewFromUser = newMsgs.some(m => m.sender !== 'admin');
                if (hasNewFromUser) {
                  const lastMsg = newMsgs.filter(m => m.sender !== 'admin').pop();
                  setTimeout(() => notifySystem('💬 ข้อความใหม่จากลูกค้า', `${lastMsg.senderName || 'ลูกค้า'}: ${String(lastMsg.text || '').substring(0, 60)}`, 'info'), 0);
                }
              }

              if (!isAdminSession && chatId === `support-${fbUid}`) {
                const adminReply = newMsgs.find(m => m.sender === 'admin');
                if (adminReply) {
                  setTimeout(() => notifySystem('💬 เจ้าหน้าที่ตอบกลับแล้ว', String(adminReply.text || '').substring(0, 60), 'info'), 0);
                }
              }
            });
          }

          setChats(prev => {
            const base = replaceAll ? {} : { ...prev };
            Object.entries(chatUpdate).forEach(([id, msgs]) => {
              const local = prev[id] || [];
              base[id] = local.length > msgs.length ? local : msgs;
            });
            try { localStorage.setItem('boomrider_chats', JSON.stringify(base)); } catch {}
            return base;
          });
        };

        if (isAdminSession) {
          window.__boomriderUnsubChats = subscribeToChats(
            (cloudChats) => handleChatUpdate(cloudChats, true),
          );
        } else {
          window.__boomriderUnsubChats = subscribeToSupportChat(
            fbUid,
            (chatUpdate) => handleChatUpdate(chatUpdate, false),
          );
        }

        // ── Subscribe real-time shared data ──────────────────────────────────
        if (window.__boomriderUnsubShared) {
          window.__boomriderUnsubShared.forEach(fn => fn());
          window.__boomriderUnsubShared = null;
        }
        const unsubRestaurants = subscribeToRestaurants((list) => {
          setRestaurants(list);
          safeLocalSet('boomrider_restaurants', list);
        });
        const unsubRiders = subscribeToRiders((list) => {
          setRiders(list);
          safeLocalSet('boomrider_riders', list);
        });
        const unsubMenuItems = subscribeToMenuItems((menus) => {
          if (Object.keys(menus).length > 0) {
            setMenuItems(menus);
            safeLocalSet('boomrider_menu_items', menus);
          }
        });
        const unsubConfig = subscribeToConfig((cfg) => {
          setAppConfig(cfg);
          safeLocalSet('boomrider_appconfig', cfg);
        });
        window.__boomriderUnsubShared = [unsubRestaurants, unsubRiders, unsubMenuItems, unsubConfig];

        // ── Subscribe wallet (real-time) ─────────────────────────────────────
        if (walletUnsubRef.current) walletUnsubRef.current();
        if (walletEntriesUnsubRef.current) walletEntriesUnsubRef.current();
        walletSubscribedRef.current = false;
        if (FIREBASE_ENABLED) {
          walletUnsubRef.current = subscribeToWallet(firebaseUser.uid, (data) => {
            walletFromFirestoreRef.current = true;
            walletSubscribedRef.current = true;
            setUserWallet(data.balance ?? 0);
            setWalletClearedAt(data.historyClearedAt || null);
          });
          walletEntriesUnsubRef.current = subscribeToWalletEntries(firebaseUser.uid, (entries) => {
            setWalletAllEntries(entries);
          });
          if (userProfileUnsubRef.current) userProfileUnsubRef.current();
          userProfileUnsubRef.current = subscribeToUserProfile(firebaseUser.uid, (data) => {
            if (data.roles?.length) {
              const merged = ADMIN_UID && firebaseUser.uid === ADMIN_UID
                ? [...new Set([...data.roles, 'admin'])]
                : data.roles;
              setUserRoles(merged);
              setGlobalUserRoles(p => ({ ...p, [firebaseUser.uid]: merged }));
            }
            if (data.banned && !(ADMIN_UID && firebaseUser.uid === ADMIN_UID)) {
              firebaseLogout().then(() => notifySystem('บัญชีถูกระงับ', 'บัญชีของคุณถูกระงับการใช้งาน', 'error')).catch(() => {});
            }
          });
          saveUserProfile(firebaseUser.uid, {
            name:  firebaseUser.displayName || saved?.profile?.name || '',
            email: firebaseUser.email || '',
            phone: firebaseUser.phoneNumber || saved?.profile?.phone || '',
          }).catch(() => {});
        } else {
          try {
            const cloudWallet = await loadWallet(firebaseUser.uid);
            if (cloudWallet) {
              setUserWallet(cloudWallet.balance ?? 0);
              setWalletAllEntries(cloudWallet.history ?? []);
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
      return () => {
        unsubscribe();
        if (window.__boomriderUnsubOrders)  { window.__boomriderUnsubOrders();  window.__boomriderUnsubOrders  = null; }
        if (window.__boomriderUnsubPending) { window.__boomriderUnsubPending(); window.__boomriderUnsubPending = null; }
        if (window.__boomriderUnsubChats)   { window.__boomriderUnsubChats();   window.__boomriderUnsubChats   = null; }
        if (window.__boomriderUnsubShared)  { window.__boomriderUnsubShared.forEach(fn => fn()); window.__boomriderUnsubShared = null; }
        if (walletUnsubRef.current)         { walletUnsubRef.current();         walletUnsubRef.current         = null; }
        if (walletEntriesUnsubRef.current)  { walletEntriesUnsubRef.current();  walletEntriesUnsubRef.current  = null; }
      };
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
      if (FIREBASE_ENABLED && walletFromFirestoreRef.current) {
        walletFromFirestoreRef.current = false;
      }
    }
  }, [userProfile, userRoles, userWallet, walletHistory, userAddresses]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Real-time Rider Location Simulation ---
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prevOrders => prevOrders.map(order => {
        if (['rider_accepted', 'picking_up', 'delivering'].includes(order.status) && order.riderId) {
          const currentPos = order.riderLocation || order.pickupLocation || USER_LOCATION;
          const targetPos  = ['delivering'].includes(order.status)
            ? (order.location || USER_LOCATION)
            : (order.pickupLocation || USER_LOCATION);
          const step   = 0.05;
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
      senderName: activeRole === 'admin'    ? 'เจ้าหน้าที่'
                : activeRole === 'rider'    ? 'ไรเดอร์'
                : activeRole === 'merchant' ? 'ร้านค้า'
                : userProfile?.name || 'ลูกค้า',
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };
    setChats(prev => {
      const updated = { ...prev, [activeChat.id]: [...(prev[activeChat.id] || []), newMessage] };
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
      try { localStorage.setItem('boomrider_chats', JSON.stringify(next)); } catch {}
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
    if (!navigator.geolocation) return notifySystem('ผิดพลาด', 'Browser ไม่รองรับ GPS', 'error');
    notifySystem('กำลังดึงพิกัด', 'รอสักครู่...', 'info');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
      setNewAddr(prev => ({ ...prev, location: loc }));
      const addr = await reverseGeocode(loc.lat, loc.lng);
      setNewAddr(prev => ({ ...prev, location: loc, fullAddr: addr }));
      notifySystem('สำเร็จ', 'ดึงพิกัดปัจจุบันและที่อยู่เรียบร้อย!', 'success');
    }, () => {
      notifySystem('ผิดพลาด', 'ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS', 'error');
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const getCurrentLocationForParcel = (target) => {
    if (!navigator.geolocation) return notifySystem('ผิดพลาด', 'Browser ไม่รองรับ GPS', 'error');
    notifySystem('กำลังดึงพิกัด', 'กำลังหาตำแหน่งของคุณ...', 'info');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const loc  = { lat: position.coords.latitude, lng: position.coords.longitude };
      const addr = await reverseGeocode(loc.lat, loc.lng);
      if (target === 'pickup') {
        setParcelDetails(prev => ({ ...prev, pickup: addr, pickupLocation: loc }));
        setParcelMapTarget('pickup');
      } else {
        setParcelDetails(prev => ({ ...prev, dropoff: addr, dropoffLocation: loc }));
        setParcelMapTarget('dropoff');
      }
      notifySystem('สำเร็จ', `ตั้ง${target === 'pickup' ? 'จุดรับ' : 'จุดส่ง'}เป็นตำแหน่งปัจจุบันแล้ว`, 'success');
    }, () => {
      notifySystem('ผิดพลาด', 'ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS', 'error');
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  // --- Photo handlers ---
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
    notifySystem('กำลังประมวลผล', 'กำลังบีบอัดรูปภาพ...', 'info');
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
        notifySystem('สำเร็จ', 'อัปเดตรูปหน้าร้านเรียบร้อย', 'success');
      })
      .catch(() => notifySystem('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้', 'error'));
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
    if (!file) return;
    compressImage(file, 1024, 1400, 0.8)
      .then(compressed => setTopUpSlip(compressed))
      .catch(() => {
        const reader = new FileReader();
        reader.onloadend = () => setTopUpSlip(reader.result);
        reader.readAsDataURL(file);
      });
  };

  const handleMenuPhotoSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setEditForm(prev => ({ ...prev, _imageUploading: true }));
    compressImage(file, 400, 400, 0.65)
      .then(compressed => {
        setEditForm(prev => ({ ...prev, image: compressed, _imageUploading: false }));
      })
      .catch(() => {
        setEditForm(prev => ({ ...prev, _imageUploading: false }));
        notifySystem('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้', 'error');
      });
  };

  const openImagePreview = (url) => {
    setPreviewImageUrl(url);
    setShowImageModal(true);
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
        if (FIREBASE_ENABLED) saveRestaurant(updated).catch(() => {});
        notifySystem('สถานะร้าน', `ร้านค้า ${newStatus === 'open' ? 'เปิด' : 'ปิด'} แล้ว`, 'info');
        return updated;
      }
      return r;
    }));
  };

  const handleAddMenuItem = (restaurantId, newItem) => {
    const currentItems = menuItems[restaurantId] || [];
    const itemWithId   = { ...newItem, id: generateId(), available: true };
    const updated      = [...currentItems, itemWithId];
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
    notifySystem('สำเร็จ', 'เพิ่มเมนูเรียบร้อย', 'success');
  };

  const handleEditMenuItem = (restaurantId, itemId, updatedItem) => {
    const currentItems = menuItems[restaurantId] || [];
    const updated      = currentItems.map(item => item.id === itemId ? { ...item, ...updatedItem } : item);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
    notifySystem('สำเร็จ', 'แก้ไขเมนูเรียบร้อย', 'success');
  };

  const handleDeleteMenuItem = (restaurantId, itemId) => {
    if (!window.confirm('ยืนยันการลบเมนูนี้?')) return;
    const currentItems = menuItems[restaurantId] || [];
    const updated      = currentItems.filter(item => item.id !== itemId);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
    notifySystem('สำเร็จ', 'ลบเมนูเรียบร้อย', 'success');
  };

  const handleToggleItemAvailability = (restaurantId, itemId) => {
    const currentItems = menuItems[restaurantId] || [];
    const updated = currentItems.map(item => item.id === itemId ? { ...item, available: !item.available } : item);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
  };

  const requestRegisterMerchant = async (data) => {
    if (!data.shopName || !data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน', 'error');
    }
    if (restaurants.some(r => r.ownerId === userProfile.id || r.ownerId === currentUser?.id)) {
      if (!userRoles.includes('merchant')) {
        grantRole(userProfile.id || currentUser?.id, 'merchant');
        notifySystem('อัปเดต', 'พบร้านค้าในระบบ กำลังเปิดสิทธิ์ร้านค้าให้', 'success');
      } else {
        notifySystem('ซ้ำซ้อน', 'คุณมีร้านค้าอยู่แล้ว', 'error');
      }
      return;
    }
    if (isPending('merchant_reg')) return notifySystem('รออนุมัติ', 'คำขอสมัครร้านค้ากำลังรอการอนุมัติ', 'info');
    const uid = userProfile.id || currentUser?.id || '';
    const { idCardImage, shopImage, ...dataNoImages } = data;
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
      timestamp: formatDateTime(),
    };
    if (FIREBASE_ENABLED) {
      savePendingRequest({ ...newReq, data: { ...data } }).catch(() => {});
    }
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('สำเร็จ', 'ส่งใบสมัครร้านค้าเรียบร้อย รอแอดมินอนุมัติ', 'success');
    notifyAdmin('🏪 สมัครร้านค้าใหม่', `${userProfile.name} ส่งใบสมัครร้าน ${data.shopName}`, 'warning');
  };

  const requestRegisterRider = async (data) => {
    if (!data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
      return notifySystem('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน', 'error');
    }
    if (isPending('rider_reg')) return notifySystem('รออนุมัติ', 'คำขอสมัครไรเดอร์กำลังรอการอนุมัติ', 'info');
    const uid = userProfile.id || currentUser?.id || '';
    const { idCardImage, profileImage, ...dataNoImages } = data;
    const newReq = {
      id: generateId(), type: 'rider_reg',
      data: {
        ...dataNoImages,
        idCardImage:  idCardImage  ? '✓ อัปโหลดบัตรประชาชนแล้ว' : null,
        profileImage: profileImage ? '✓ อัปโหลดรูปโปรไฟล์แล้ว'   : null,
      },
      _hasImages: !!(idCardImage || profileImage),
      userId: uid, user: userProfile.name,
      timestamp: formatDateTime(),
    };
    if (FIREBASE_ENABLED) {
      savePendingRequest({ ...newReq, data: { ...data } }).catch(() => {});
    }
    setPendingRequests(prev => [newReq, ...prev]);
    notifySystem('สำเร็จ', 'ส่งใบสมัครไรเดอร์เรียบร้อย รอแอดมินอนุมัติ', 'success');
    notifyAdmin('🛵 สมัครไรเดอร์ใหม่', `${userProfile.name} ส่งใบสมัคร`, 'warning');
  };

  // --- Address management ---
  const handleUpdateUserLocation = useCallback(async (location) => {
    if (!location) return;
    const uid = currentUser?.id || userProfile?.id;
    setUserProfile(prev => ({ ...prev, location }));
    try {
      const saved = JSON.parse(localStorage.getItem('boomrider_user') || '{}');
      if (saved && typeof saved === 'object') {
        if (saved.profile) saved.profile.location = location;
        localStorage.setItem('boomrider_user', JSON.stringify(saved));
      }
      if (uid) localStorage.setItem(`boomrider_loc_${uid}`, JSON.stringify(location));
    } catch {}
    if (FIREBASE_ENABLED && uid) {
      saveUserProfile(uid, { location }).catch(() => {});
    }
    notifySystem('📍 บันทึกตำแหน่งแล้ว', 'ตำแหน่งหลักของคุณถูกอัปเดตเรียบร้อย', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAddress = (addr) => {
    const loc = addr.location || USER_LOCATION;
    setUserAddresses([...userAddresses, { id: generateId(), label: addr.label, address: addr.fullAddr, location: loc }]);
    notifySystem('สำเร็จ', 'บันทึกที่อยู่เรียบร้อย', 'success');
  };

  const handleUpdateAddress = useCallback(async (id, location, label, fullAddr) => {
    const addr = fullAddr || await reverseGeocode(location.lat, location.lng).catch(() => `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`);
    setUserAddresses(prev => prev.map(a =>
      a.id === id ? { ...a, location, address: addr, ...(label ? { label } : {}) } : a,
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
    const discount    = Math.min(rawDiscount, promo.maxDiscount || 9999);
    return { valid: true, discount: Math.round(discount), promo };
  }, [promoCodes]);

  const usePromoCode = useCallback((code) => {
    setPromoCodes(prev => {
      const next = prev.map(p => p.code.toUpperCase() === code.toUpperCase() ? { ...p, usedCount: (p.usedCount || 0) + 1 } : p);
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
  }, []);

  const createPromoCode = useCallback((data) => {
    const newCode = {
      id: generateId(), ...data,
      code: data.code.toUpperCase(),
      usedCount: 0, active: true,
      createdAt: new Date().toISOString(),
    };
    setPromoCodes(prev => {
      const next = [newCode, ...prev];
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
    notifySystem('สำเร็จ', `สร้างโค้ด "${data.code.toUpperCase()}" เรียบร้อย`, 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePromoCode = useCallback((id) => {
    setPromoCodes(prev => {
      const next = prev.map(p => p.id === id ? { ...p, active: !p.active } : p);
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
  }, []);

  const deletePromoCode = useCallback((id) => {
    setPromoCodes(prev => {
      const next = prev.filter(p => p.id !== id);
      if (FIREBASE_ENABLED) savePromoCodes(next).catch(() => {});
      return next;
    });
  }, []);

  // --- Rider location update ---
  const updateRiderWorkingLocation = useCallback(async (riderId, location) => {
    if (!riderId || !location) return;
    setRiders(prev => prev.map(r => r.id === riderId ? { ...r, location } : r));
    if (FIREBASE_ENABLED) {
      updateRiderLocation(riderId, location).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Manual role/pending sync ---
  const syncRoles = useCallback(async () => {
    const uid = currentUser?.id || userProfile?.id;
    if (!uid) return;
    const allRoles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    const latest   = allRoles[uid];
    if (latest && latest.length > 0) {
      const withAdmin = ADMIN_UID && uid === ADMIN_UID ? [...new Set([...latest, 'admin'])] : latest;
      setUserRoles(withAdmin);
    }
    const savedPending = JSON.parse(localStorage.getItem('boomrider_pending_requests') || '[]');
    setPendingRequests(savedPending);
    if (FIREBASE_ENABLED) {
      try {
        const cloudRiders = await loadRiders();
        if (cloudRiders && cloudRiders.length > 0) {
          setRiders(cloudRiders);
          safeLocalSet('boomrider_riders', cloudRiders);
        }
      } catch {}
    }
    notifySystem('อัปเดต', 'โหลดข้อมูลล่าสุดแล้ว', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auth Functions ---
  const handleLogin = async () => {
    if (!loginForm.phone && !loginForm.email) return notifySystem('ผิดพลาด', 'กรุณากรอกเบอร์โทรหรืออีเมล', 'error');
    if (!loginForm.password) return notifySystem('ผิดพลาด', 'กรุณากรอกรหัสผ่าน', 'error');
    if (FIREBASE_ENABLED && loginForm.email) {
      try {
        const fbUser = await loginWithEmail(loginForm.email, loginForm.password);
        const savedRaw = localStorage.getItem('boomrider_user');
        const saved    = savedRaw ? JSON.parse(savedRaw) : null;
        const profile  = {
          id: fbUser.uid, name: fbUser.displayName || saved?.name || loginForm.email,
          phone: fbUser.phoneNumber || saved?.phone || '', email: fbUser.email || loginForm.email,
          image: fbUser.photoURL || saved?.profile?.image || null, location: USER_LOCATION,
        };
        const loginRoles = ADMIN_UID && fbUser.uid === ADMIN_UID ? ['customer', 'admin'] : (saved?.roles || ['customer']);
        const wallets    = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}');
        const gw         = wallets[fbUser.uid];
        const allRoles   = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
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
        setUserRoles(finalRoles); setUserWallet(user.wallet); setWalletAllEntries(user.walletHistory ?? []); setUserAddresses(user.addresses);
        notifySystem('สำเร็จ', 'เข้าสู่ระบบเรียบร้อย!', 'success');
        return;
      } catch (err) {
        const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
          : err.code === 'auth/user-not-found'       ? 'ไม่พบบัญชีนี้ในระบบ'
          : err.code === 'auth/unauthorized-domain'  ? 'Domain ยังไม่ได้รับอนุญาต กรุณาเพิ่ม domain ใน Firebase Console'
          : err.code === 'auth/too-many-requests'    ? 'ลองใหม่ภายหลัง (ส่งคำขอมากเกินไป)'
          : (err.code || err.message || 'เกิดข้อผิดพลาด');
        return notifySystem('ผิดพลาด', msg, 'error');
      }
    }
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const user  = users.find(u => (u.phone === loginForm.phone && loginForm.phone) || (u.email === loginForm.email && loginForm.email));
    if (!user || user.password !== loginForm.password) return notifySystem('ผิดพลาด', 'เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง', 'error');
    const allRolesLocal  = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    const localFinalRoles = allRolesLocal[user.profile?.id || user.id] || allRolesLocal[user.id] || user.roles || ['customer'];
    const updatedUser = { ...user, roles: localFinalRoles };
    localStorage.setItem('boomrider_user', JSON.stringify(updatedUser));
    setCurrentUser(updatedUser); setIsLoggedIn(true); setUserProfile(user.profile); setTempProfile(user.profile);
    setUserRoles(localFinalRoles); setUserWallet(user.wallet); setWalletAllEntries(user.walletHistory ?? []); setUserAddresses(user.addresses);
    notifySystem('สำเร็จ', 'เข้าสู่ระบบเรียบร้อย!', 'success');
  };

  const handleLoginWithGoogle = async () => {
    if (!FIREBASE_ENABLED) return notifySystem('แจ้งเตือน', 'Firebase ยังไม่ได้ตั้งค่า', 'warning');
    try {
      await loginWithGoogle();
      notifySystem('สำเร็จ', 'เข้าสู่ระบบด้วย Google เรียบร้อย!', 'success');
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
      notifySystem('ผิดพลาด', msg, 'error');
    }
  };

  const handleRegister = async () => {
    if (!registerForm.name) return notifySystem('ผิดพลาด', 'กรุณากรอกชื่อ-นามสกุล', 'error');
    if (FIREBASE_ENABLED && !registerForm.email) return notifySystem('ผิดพลาด', 'กรุณากรอกอีเมล', 'error');
    if (!FIREBASE_ENABLED && !registerForm.phone && !registerForm.email) return notifySystem('ผิดพลาด', 'กรุณากรอกเบอร์โทรหรืออีเมล', 'error');
    if (!registerForm.password) return notifySystem('ผิดพลาด', 'กรุณากรอกรหัสผ่าน', 'error');
    if (registerForm.password.length < 6) return notifySystem('ผิดพลาด', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
    if (registerForm.password !== registerForm.confirmPassword) return notifySystem('ผิดพลาด', 'รหัสผ่านไม่ตรงกัน', 'error');
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
        setUserRoles(['customer']); setUserWallet(0); setWalletAllEntries([]); setWalletClearedAt(null); setUserAddresses(newUser.addresses);
        notifySystem('สำเร็จ', 'สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ', 'success');
        return;
      } catch (err) {
        const msg = err.code === 'auth/email-already-in-use' ? 'อีเมลนี้ถูกใช้งานแล้ว — ลองเข้าสู่ระบบแทน'
          : err.code === 'auth/weak-password'       ? 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
          : err.code === 'auth/unauthorized-domain' ? 'Domain ยังไม่ได้รับอนุญาต กรุณาเพิ่ม domain ใน Firebase Console'
          : err.code === 'auth/invalid-email'       ? 'รูปแบบอีเมลไม่ถูกต้อง'
          : (err.code || err.message || 'เกิดข้อผิดพลาด');
        return notifySystem('ผิดพลาด', msg, 'error');
      }
    }
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const existingUser = users.find(u => (u.phone === registerForm.phone && registerForm.phone) || (u.email === registerForm.email && registerForm.email));
    if (existingUser) return notifySystem('ผิดพลาด', 'เบอร์โทรหรืออีเมลนี้ถูกใช้งานแล้ว', 'error');
    const newUserId = generateId();
    const newUser   = {
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
    setUserRoles(newUser.roles); setUserWallet(newUser.wallet); setWalletAllEntries(newUser.walletHistory ?? []); setUserAddresses(newUser.addresses);
    notifySystem('สำเร็จ', 'สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ', 'success');
  };

  const handleLogout = () => {
    if (window.__boomriderUnsubOrders)  { window.__boomriderUnsubOrders();  window.__boomriderUnsubOrders  = null; }
    if (window.__boomriderUnsubPending) { window.__boomriderUnsubPending(); window.__boomriderUnsubPending = null; }
    if (window.__boomriderUnsubChats)   { window.__boomriderUnsubChats();   window.__boomriderUnsubChats   = null; }
    lastChatCountsRef.current = {};
    chatSubInitializedRef.current = false;
    if (walletUnsubRef.current)        { walletUnsubRef.current();        walletUnsubRef.current        = null; }
    if (walletEntriesUnsubRef.current) { walletEntriesUnsubRef.current(); walletEntriesUnsubRef.current = null; }
    if (allWalletsUnsubRef.current)    { allWalletsUnsubRef.current();    allWalletsUnsubRef.current    = null; }
    if (userProfileUnsubRef.current)   { userProfileUnsubRef.current();   userProfileUnsubRef.current   = null; }
    if (adminNotifsUnsubRef.current)   { adminNotifsUnsubRef.current();   adminNotifsUnsubRef.current   = null; }
    walletFromFirestoreRef.current = false;
    walletSubscribedRef.current    = false;
    setIsLoggedIn(false);
    setCurrentUser(null);
    setUserProfile({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
    setTempProfile({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
    setUserRoles(['customer']);
    setUserWallet(0);
    setWalletAllEntries([]);
    setWalletClearedAt(null);
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
    walletHistory,
    clearWalletHistory,
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
    handleProfilePhotoChange,
    handleShopPhotoChange,
    handleRegistrationPhotoSelect,
    handleTopUpSlipSelect,
    handleMenuPhotoSelect,
    openImagePreview,

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
