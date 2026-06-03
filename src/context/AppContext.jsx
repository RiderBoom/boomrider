import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  INITIAL_CONFIG, INITIAL_RESTAURANTS, INITIAL_RIDERS, INITIAL_MENU_ITEMS,
  USER_LOCATION, FIREBASE_ENABLED, ADMIN_UID,
} from '../constants';
import { generateId, getDistanceFromLatLonInKm, playNotificationSound, formatDateTime } from '../utils';
import {
  loginWithEmail, registerWithEmail, loginWithGoogle, logout as firebaseLogout, onAuthChange,
} from '../firebase/auth';
import { requestNotificationPermission, onForegroundMessage, saveFcmToken } from '../firebase/messaging';
import { deleteFile } from '../firebase/storage';
import {
  saveOrder, updateOrderStatusInDB, saveAppConfig, loadAppConfig, loadAllOrders, loadOrdersByRole,
  saveWallet, loadWallet, creditWalletInDB, subscribeToWallet, initWalletIfNew, subscribeToAllWallets,
  saveRestaurant, loadRestaurants, deleteRestaurantFromDB, subscribeToRestaurants,
  saveMenuItems, loadMenuItems, subscribeToMenuItems,
  deletePendingRequest, loadPendingRequests, subscribeToPendingRequests,
  saveRider, loadRiders, deleteRiderFromDB, updateRiderLocation, subscribeToRiders,
  saveChat, subscribeToChats, subscribeToSupportChat, deleteChatFromDB, appendChatMessage,
  saveUserProfile, loadUserProfile, subscribeToUserProfile, saveUserRoles, setBanUser,
  safeLocalSet,
  acceptOrderTransaction, subscribeToOrders,
  atomicOrderCompletion, subscribeToConfig,
  saveTransaction,
  addWalletEntry, subscribeToWalletEntries, clearWalletHistory,
  saveAdminNotif, subscribeToAdminNotifs,
  saveRating,
} from '../firebase/firestore';

import { useWalletActions }  from './hooks/useWalletActions';
import { useOrderActions }   from './hooks/useOrderActions';
import { useAdminActions }   from './hooks/useAdminActions';
import { usePhotoHandlers }  from './hooks/usePhotoHandlers';
import { useRegistration }   from './hooks/useRegistration';
import { usePromoActions }   from './hooks/usePromoActions';

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
  const [isDataLoading, setIsDataLoading] = useState(FIREBASE_ENABLED);

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

  // --- Rating Modal ---
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingOrderData, setRatingOrderData] = useState(null);

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
  const adminNotifsUnsubRef    = React.useRef(null);
  const gpsSessionRef          = React.useRef('');

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
    creditWallet, processTransaction, setUserWallet,
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

  // ── Photo handlers hook ─────────────────────────────────────────────────
  const {
    profileUploading,
    handleProfilePhotoChange, handleShopPhotoChange, handleRegistrationPhotoSelect,
    handleTopUpSlipSelect, handleMenuPhotoSelect, openImagePreview,
  } = usePhotoHandlers({
    currentUser, userProfile, restaurants, isEditingMenu,
    setTempProfile, setRestaurants, setEditForm, setTopUpSlip,
    setShowImageModal, setPreviewImageUrl,
    notifySystem,
  });

  // ── Registration hook ───────────────────────────────────────────────────
  const {
    merchantRegForm, setMerchantRegForm,
    riderRegForm, setRiderRegForm,
    requestRegisterMerchant, requestRegisterRider,
  } = useRegistration({
    currentUser, userProfile, userRoles,
    restaurants, isPending,
    setPendingRequests,
    grantRole,
    notifySystem, notifyAdmin,
  });

  // ── Promo actions hook ──────────────────────────────────────────────────
  const {
    promoCodes, setPromoCodes,
    validatePromoCode, usePromoCode, createPromoCode, togglePromoCode, deletePromoCode,
  } = usePromoActions({ notifySystem });

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

  // เมื่อ userProfile.image เปลี่ยนเป็น Storage URL → sync ลง Firestore ทันที
  useEffect(() => {
    if (!isLoggedIn || !FIREBASE_ENABLED) return;
    const uid = currentUser?.id || userProfile?.id;
    const img = userProfile?.image;
    if (!uid || !img || img.startsWith('data:')) return;
    saveUserProfile(uid, { image: img }).catch(() => {});
  }, [userProfile?.image]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Auto-capture GPS location on login ───────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) { gpsSessionRef.current = ''; return; }
    const uid = currentUser?.id;
    if (!uid || gpsSessionRef.current === uid) return;
    gpsSessionRef.current = uid;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserProfile(prev => ({ ...prev, location: loc }));
        try {
          const sv = JSON.parse(localStorage.getItem('boomrider_user') || '{}');
          if (sv?.profile) { sv.profile.location = loc; localStorage.setItem('boomrider_user', JSON.stringify(sv)); }
          if (uid) localStorage.setItem(`boomrider_loc_${uid}`, JSON.stringify(loc));
        } catch {}
        if (FIREBASE_ENABLED && uid) saveUserProfile(uid, { location: loc }).catch(() => {});
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json&accept-language=th`,
            { headers: { 'Accept-Language': 'th' } }
          );
          const d = await r.json();
          const parts = [d.address?.road, d.address?.neighbourhood || d.address?.suburb, d.address?.city || d.address?.town].filter(Boolean);
          const addr = parts.join(', ') || d.display_name?.split(',').slice(0, 3).join(',') || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
          notifySystem('📍 บันทึกตำแหน่งแล้ว', addr.substring(0, 60), 'success');
        } catch {
          notifySystem('📍 บันทึกตำแหน่งแล้ว', `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`, 'success');
        }
      },
      (err) => {
        if (err.code === 1) notifySystem('📍 ไม่สามารถดึงตำแหน่งได้', 'กรุณาอนุญาตสิทธิ์ GPS ในเบราว์เซอร์', 'warning');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
  }, [isLoggedIn, currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
          const [initialOrders, restData, ridersData, menuData, cfgData] = await Promise.all([
            loadAllOrders(),
            loadRestaurants(),
            loadRiders(),
            loadMenuItems(),
            loadAppConfig(),
          ]);

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

          if (Array.isArray(restData) && restData.length > 0) {
            setRestaurants(restData);
            safeLocalSet('boomrider_restaurants', restData);
          }
          if (Array.isArray(ridersData) && ridersData.length > 0) {
            setRiders(ridersData);
            safeLocalSet('boomrider_riders', ridersData);
          }
          if (menuData && Object.keys(menuData).length > 0) {
            setMenuItems(menuData);
            safeLocalSet('boomrider_menu_items', menuData);
          }
          if (cfgData && typeof cfgData === 'object') {
            const { updatedAt: _ts, ...cfg } = cfgData;
            setAppConfig(prev => ({ ...prev, ...cfg }));
            setEditConfig(prev => ({ ...prev, ...cfg }));
            safeLocalSet('boomrider_appconfig', cfg);
          }
        } catch (_) {}
        setIsDataLoading(false);

        // ── Role scope: คำนวณ query scope ครั้งเดียว ใช้ทั้ง subscription + fallback ──
        const _uid        = firebaseUser.uid;
        const _isAdmin    = !!(ADMIN_UID && _uid === ADMIN_UID);
        const _isRider    = !_isAdmin && baseRoles.includes('rider');
        const _isMerchant = !_isAdmin && !_isRider && baseRoles.includes('merchant');
        const _myShop     = _isMerchant
          ? (Array.isArray(restData) ? restData.find(r => r.ownerId === _uid) : null)
          : null;
        const orderScope = {
          role:   _isAdmin    ? 'admin'
                : _isRider    ? 'rider'
                : _isMerchant ? 'merchant'
                : 'customer',
          userId: _uid,
          shopId: _myShop?.id || null,
        };

        const unsubOrders = subscribeToOrders(
          orderScope,
          (cloudOrders) => {
            if (!subInitializedRef.current) {
              cloudOrders.forEach(co => {
                seenOrderIdsRef.current.add(co.id);
                if (co.status === 'completed') seenOrderIdsRef.current.add(`${co.id}_completed`);
              });
              subInitializedRef.current = true;
            } else {
              const uid      = currentUserRef.current?.id;
              const shopId   = (uid && restaurantsRef.current.find(r => r.ownerId === uid)?.id)
                             || (orderScope.role === 'merchant' ? orderScope.shopId : null);
              const myShop   = shopId ? { id: shopId } : null;

              if (myShop) {
                const newMerchantOrders = cloudOrders.filter(co =>
                  co.status === 'pending' && co.restaurantId === myShop.id && !seenOrderIdsRef.current.has(co.id),
                );
                if (newMerchantOrders.length > 0) {
                  playNotificationSound('order');
                  setTimeout(() => notifySystem('🛎️ ออเดอร์ใหม่เข้าร้าน!', `มี ${newMerchantOrders.length} ออเดอร์ใหม่รอยืนยัน`, 'warning'), 0);
                }
              }

              if (orderScope.role === 'rider') {
                const newJobs = cloudOrders.filter(co =>
                  co.status === 'ready_to_pickup' && !co.riderId && !seenOrderIdsRef.current.has(co.id),
                );
                if (newJobs.length > 0) {
                  playNotificationSound('rider');
                  setTimeout(() => notifySystem('🔔 มีงานใหม่เข้า!', `${newJobs.length} งานรอรับในบริเวณใกล้เคียง`, 'warning'), 0);
                }
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
              // ใช้ role-scoped fallback แทน loadAllOrders() — ลด reads เมื่อ sub reconnect
              const fallback = await loadOrdersByRole(orderScope);
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
      // foreground message listener — store unsubscribe to prevent multiple registrations
      let unsubForeground = () => {};
      onForegroundMessage((msg) => {
        notifySystem(msg.title, msg.body, 'info');
      }).then((unsub) => { unsubForeground = unsub || (() => {}); }).catch(() => {});

      return () => {
        unsubscribe();
        unsubForeground();
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

  // --- Real-time Rider Location Simulation (fallback: Firebase ปิดเท่านั้น) ---
  // เมื่อ FIREBASE_ENABLED = true ไรเดอร์จะส่ง GPS จริงผ่าน watchPosition → Firestore → onSnapshot
  useEffect(() => {
    if (FIREBASE_ENABLED) return;
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
          return { ...order, riderLocation: { lat: newLat, lng: newLng } };
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

  const handleSaveProfile = useCallback(async () => {
    const uid = currentUser?.id || userProfile?.id;
    setUserProfile({ ...tempProfile });
    setProfileSubView('main');
    notifySystem('สำเร็จ', 'บันทึกข้อมูลโปรไฟล์เรียบร้อย', 'success');
    if (FIREBASE_ENABLED && uid) {
      saveUserProfile(uid, {
        name:  tempProfile.name  || '',
        phone: tempProfile.phone || '',
        email: tempProfile.email || '',
        ...(tempProfile.image && !tempProfile.image.startsWith('data:')
          ? { image: tempProfile.image } : {}),
      }).catch(() => {});
    }
  }, [tempProfile, currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (FIREBASE_ENABLED) {
      saveMenuItems(restaurantId, updated).catch(() => {});
      deleteFile(`menus/${restaurantId}/${itemId}.jpg`);
    }
    notifySystem('สำเร็จ', 'ลบเมนูเรียบร้อย', 'success');
  };

  const handleToggleItemAvailability = (restaurantId, itemId) => {
    const currentItems = menuItems[restaurantId] || [];
    const updated = currentItems.map(item => item.id === itemId ? { ...item, available: !item.available } : item);
    setMenuItems(prev => ({ ...prev, [restaurantId]: updated }));
    if (FIREBASE_ENABLED) saveMenuItems(restaurantId, updated).catch(() => {});
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

  // --- Rating ---
  const openRatingModal = useCallback((order) => {
    setRatingOrderData(order);
    setShowRatingModal(true);
  }, []);

  const submitRating = useCallback(async ({ orderId, restaurantId, riderId, restaurantRating, riderRating, comment }) => {
    const uid = currentUser?.id || userProfile?.id;

    if (restaurantId && restaurantRating) {
      setRestaurants(prev => prev.map(r => {
        if (r.id !== restaurantId) return r;
        const prevCount = r.ratingCount || 0;
        const count = prevCount + 1;
        const avg = parseFloat((((r.rating || 5) * prevCount + restaurantRating) / count).toFixed(1));
        return { ...r, rating: avg, ratingCount: count };
      }));
    }
    if (riderId && riderRating) {
      setRiders(prev => prev.map(r => {
        if (r.id !== riderId) return r;
        const prevCount = r.ratingCount || 0;
        const count = prevCount + 1;
        const avg = parseFloat((((r.avgRating || 5) * prevCount + riderRating) / count).toFixed(1));
        return { ...r, avgRating: avg, ratingCount: count };
      }));
    }
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, rated: true } : o));

    if (FIREBASE_ENABLED) {
      saveRating({ orderId, customerId: uid, restaurantId, riderId, restaurantRating, riderRating, comment }).catch(() => {});
    }

    setShowRatingModal(false);
    setRatingOrderData(null);
    notifySystem('ขอบคุณ! 🌟', 'บันทึกรีวิวของคุณแล้ว', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    showRatingModal, setShowRatingModal,
    ratingOrderData,
    openRatingModal,
    submitRating,

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
    handleSaveProfile,
    profileUploading,

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
    isDataLoading,

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
