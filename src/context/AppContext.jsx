import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  INITIAL_CONFIG, INITIAL_RESTAURANTS, INITIAL_RIDERS, INITIAL_MENU_ITEMS,
  USER_LOCATION, ADMIN_EMAIL,
} from '../constants';
import { generateId, getDistanceFromLatLonInKm, playNotificationSound, formatDateTime, r2, safeLocalSet } from '../utils';

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
  const [isDataLoading, setIsDataLoading] = useState(false);

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
    const ms = walletClearedAt instanceof Date ? walletClearedAt.getTime() : 0;
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
  const isAdmin = !!ADMIN_EMAIL && currentUser?.email === ADMIN_EMAIL;

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
  const prevOrdersRef          = React.useRef([]);
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
    const queue = JSON.parse(localStorage.getItem('boomrider_admin_notifs') || '[]');
    queue.unshift(notif);
    localStorage.setItem('boomrider_admin_notifs', JSON.stringify(queue.slice(0, 50)));
    if (isAdmin) notifySystem(title, message, type);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Role grant ---
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
    seenOrderIdsRef,
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

  // ── Admin notifications: localStorage polling ──────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
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
    const withAdmin = ADMIN_EMAIL && currentUser?.email === ADMIN_EMAIL
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
      const mergedRoles = ADMIN_EMAIL && (user.email === ADMIN_EMAIL || user.profile?.email === ADMIN_EMAIL)
        ? [...new Set([...latestRoles, 'admin'])]
        : latestRoles;
      setCurrentUser({ ...user, roles: mergedRoles });
      setIsLoggedIn(true);
      setUserProfile(user.profile);
      setTempProfile(user.profile);
      setUserRoles(mergedRoles);
      const gw = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}')[user.id];
      setUserWallet(r2(gw?.balance ?? user.wallet ?? 0));
      setWalletAllEntries(gw?.history ?? user.walletHistory ?? []);
      setUserAddresses(user.addresses || []);
    }

  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── In-app order notifications (replaces Firestore subscription callbacks) ──
  useEffect(() => {
    const prev = prevOrdersRef.current;
    const uid = currentUser?.id;
    if (!uid || prev.length === 0) {
      prevOrdersRef.current = orders;
      return;
    }
    const prevMap = new Map(prev.map(o => [o.id, o]));

    const myShop = restaurants.find(r => r.ownerId === uid);
    if (myShop) {
      const newMerchantOrders = orders.filter(o =>
        o.status === 'pending' && o.restaurantId === myShop.id && !prevMap.has(o.id),
      );
      if (newMerchantOrders.length > 0) {
        setMerchantTab('orders');
        playNotificationSound('order');
        notifySystem('🛎️ ออเดอร์ใหม่เข้าร้าน!', `มี ${newMerchantOrders.length} ออเดอร์ใหม่รอยืนยัน`, 'warning');
      }
    }

    if (userRoles.includes('rider')) {
      const newJobs = orders.filter(o =>
        o.status === 'ready_to_pickup' && !o.riderId && !prevMap.has(o.id),
      );
      if (newJobs.length > 0) {
        setRiderTab('jobs');
        playNotificationSound('order');
        const first = newJobs[0];
        const dest = first.type === 'parcel'
          ? `📦 ${first.pickup || ''} → ${first.dropoff || ''}`
          : `🍔 ${first.restaurantName || 'ร้านค้า'} ฿${first.deliveryFee ?? 0}`;
        notifySystem('🛵 มีงานใหม่!', newJobs.length === 1 ? dest : `${newJobs.length} งานใหม่ — ${dest}`, 'warning');
      }
    }

    const justCompleted = orders.filter(o => {
      const p = prevMap.get(o.id);
      return o.status === 'completed' && o.customerId === uid && p && p.status !== 'completed';
    });
    if (justCompleted.length > 0) {
      playNotificationSound('order');
      const label = justCompleted[0].type === 'parcel' ? 'พัสดุ' : 'อาหาร';
      notifySystem(`✅ จัดส่ง${label}สำเร็จ!`, `ออเดอร์ #${justCompleted[0].id.slice(-8)} ถึงมือคุณแล้ว 🎉`, 'success');
    }

    const justCancelled = orders.filter(o => {
      const p = prevMap.get(o.id);
      return o.status === 'cancelled' && o.customerId === uid && p && p.status !== 'cancelled';
    });
    if (justCancelled.length > 0) {
      const reason = justCancelled[0].cancelReason ? `: ${justCancelled[0].cancelReason}` : '';
      notifySystem('❌ ออเดอร์ถูกยกเลิก', `#${justCancelled[0].id.slice(-8)}${reason}`, 'error');
    }

    prevOrdersRef.current = orders;
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setChats(prev => ({ ...prev, [activeChat.id]: [...(prev[activeChat.id] || []), newMessage] }));
  };

  const deleteChat = (chatId) => {
    setChats(prev => {
      const next = { ...prev };
      delete next[chatId];
      try { localStorage.setItem('boomrider_chats', JSON.stringify(next)); } catch {}
      return next;
    });
    if (activeChat?.id === chatId) setActiveChat(null);
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

  const handleSaveProfile = useCallback(() => {
    setUserProfile({ ...tempProfile });
    setProfileSubView('main');
    notifySystem('สำเร็จ', 'บันทึกข้อมูลโปรไฟล์เรียบร้อย', 'success');
  }, [tempProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Merchant Management ---
  const handleUpdateShopLocation = useCallback((restaurantId, location) => {
    if (!restaurantId || !location) return;
    setRestaurants(prev => prev.map(r => r.id === restaurantId ? { ...r, location } : r));
    notifySystem('📍 บันทึกที่ตั้งร้านแล้ว', 'ลูกค้าและไรเดอร์ในรัศมีจะเห็นร้านคุณได้ถูกต้อง', 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleShopStatus = (restaurantId) => {
    setRestaurants(prev => prev.map(r => {
      if (r.id !== restaurantId) return r;
      const newStatus = r.status === 'open' ? 'closed' : 'open';
      notifySystem('สถานะร้าน', `ร้านค้า ${newStatus === 'open' ? 'เปิด' : 'ปิด'} แล้ว`, 'info');
      return { ...r, status: newStatus };
    }));
  };

  const handleAddMenuItem = (restaurantId, newItem) => {
    setMenuItems(prev => ({
      ...prev,
      [restaurantId]: [...(prev[restaurantId] || []), { ...newItem, id: generateId(), available: true }],
    }));
    notifySystem('สำเร็จ', 'เพิ่มเมนูเรียบร้อย', 'success');
  };

  const handleEditMenuItem = (restaurantId, itemId, updatedItem) => {
    setMenuItems(prev => ({
      ...prev,
      [restaurantId]: (prev[restaurantId] || []).map(item => item.id === itemId ? { ...item, ...updatedItem } : item),
    }));
    notifySystem('สำเร็จ', 'แก้ไขเมนูเรียบร้อย', 'success');
  };

  const handleDeleteMenuItem = (restaurantId, itemId) => {
    if (!window.confirm('ยืนยันการลบเมนูนี้?')) return;
    setMenuItems(prev => ({
      ...prev,
      [restaurantId]: (prev[restaurantId] || []).filter(item => item.id !== itemId),
    }));
    notifySystem('สำเร็จ', 'ลบเมนูเรียบร้อย', 'success');
  };

  const handleToggleItemAvailability = (restaurantId, itemId) => {
    setMenuItems(prev => ({
      ...prev,
      [restaurantId]: (prev[restaurantId] || []).map(item => item.id === itemId ? { ...item, available: !item.available } : item),
    }));
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
  const updateRiderWorkingLocation = useCallback((riderId, location) => {
    if (!riderId || !location) return;
    setRiders(prev => prev.map(r => r.id === riderId ? { ...r, location } : r));
  }, []);

  // --- Manual role/pending sync ---
  const syncRoles = useCallback(() => {
    const uid = currentUser?.id || userProfile?.id;
    if (!uid) return;
    const allRoles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    const latest   = allRoles[uid];
    if (latest && latest.length > 0) {
      const withAdmin = ADMIN_EMAIL && currentUser?.email === ADMIN_EMAIL ? [...new Set([...latest, 'admin'])] : latest;
      setUserRoles(withAdmin);
    }
    const savedPending = JSON.parse(localStorage.getItem('boomrider_pending_requests') || '[]');
    setPendingRequests(savedPending);
    notifySystem('อัปเดต', 'โหลดข้อมูลล่าสุดแล้ว', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auth Functions ---
  const handleLogin = () => {
    if (!loginForm.phone && !loginForm.email) return notifySystem('ผิดพลาด', 'กรุณากรอกเบอร์โทรหรืออีเมล', 'error');
    if (!loginForm.password) return notifySystem('ผิดพลาด', 'กรุณากรอกรหัสผ่าน', 'error');
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const user  = users.find(u => (u.phone === loginForm.phone && loginForm.phone) || (u.email === loginForm.email && loginForm.email));
    if (!user || user.password !== loginForm.password) return notifySystem('ผิดพลาด', 'เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง', 'error');
    if (user.banned) return notifySystem('ผิดพลาด', 'บัญชีนี้ถูกระงับการใช้งาน', 'error');
    const allRolesLocal  = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    const finalRoles = allRolesLocal[user.profile?.id || user.id] || allRolesLocal[user.id] || user.roles || ['customer'];
    const updatedUser = { ...user, roles: finalRoles };
    localStorage.setItem('boomrider_user', JSON.stringify(updatedUser));
    setCurrentUser(updatedUser); setIsLoggedIn(true); setUserProfile(user.profile); setTempProfile(user.profile);
    setUserRoles(finalRoles); setUserWallet(r2(user.wallet)); setWalletAllEntries(user.walletHistory ?? []); setUserAddresses(user.addresses);
    notifySystem('สำเร็จ', 'เข้าสู่ระบบเรียบร้อย!', 'success');
  };

  const handleLoginWithGoogle = () => {
    notifySystem('แจ้งเตือน', 'ขณะนี้ระบบรองรับเฉพาะการล็อกอินด้วยเบอร์โทร/อีเมล', 'warning');
  };

  const handleRegister = () => {
    if (!registerForm.name) return notifySystem('ผิดพลาด', 'กรุณากรอกชื่อ-นามสกุล', 'error');
    if (!registerForm.phone && !registerForm.email) return notifySystem('ผิดพลาด', 'กรุณากรอกเบอร์โทรหรืออีเมล', 'error');
    if (!registerForm.password) return notifySystem('ผิดพลาด', 'กรุณากรอกรหัสผ่าน', 'error');
    if (registerForm.password.length < 6) return notifySystem('ผิดพลาด', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
    if (registerForm.password !== registerForm.confirmPassword) return notifySystem('ผิดพลาด', 'รหัสผ่านไม่ตรงกัน', 'error');
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
    setUserRoles(newUser.roles); setUserWallet(r2(newUser.wallet)); setWalletAllEntries(newUser.walletHistory ?? []); setUserAddresses(newUser.addresses);
    notifySystem('สำเร็จ', 'สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ', 'success');
  };

  const handleLogout = () => {
    lastChatCountsRef.current = {};
    chatSubInitializedRef.current = false;
    prevOrdersRef.current = [];
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
    setActiveRole('customer');
    setActiveTab('home');
    setProfileSubView('main');
  };

  // --- Clear wallet history ---
  const clearWalletHistory = useCallback(() => {
    setWalletAllEntries([]);
    setWalletClearedAt(new Date());
    try {
      const wallets = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}');
      const uid = currentUser?.id || userProfile?.id;
      if (uid && wallets[uid]) {
        wallets[uid] = { ...wallets[uid], history: [] };
        localStorage.setItem('boomrider_wallets', JSON.stringify(wallets));
      }
    } catch {}
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    globalWallets, setGlobalWallets,

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
