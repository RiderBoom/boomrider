import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  INITIAL_CONFIG, INITIAL_RESTAURANTS, INITIAL_RIDERS, INITIAL_MENU_ITEMS,
  USER_LOCATION, ADMIN_EMAIL,
} from '../constants';
import { generateId, getDistanceFromLatLonInKm, playNotificationSound, playOrderNotificationSound, formatDateTime, r2, safeLocalSet } from '../utils';
import { supabase } from '../lib/supabase';

import { useWalletActions }  from './hooks/useWalletActions';
import { useOrderActions }   from './hooks/useOrderActions';
import { useAdminActions }   from './hooks/useAdminActions';
import { usePhotoHandlers }  from './hooks/usePhotoHandlers';
import { useRegistration }   from './hooks/useRegistration';
import { usePromoActions }   from './hooks/usePromoActions';

const AppContext = createContext(null);

// Forward-only guard: never let polling/realtime regress an order's status
const ORDER_STATUS_RANK = { pending:0, preparing:1, ready_to_pickup:2, rider_accepted:3, picking_up:4, delivering:5, delivered:6, completed:7, cancelled:99 };
const canApplyOrderUpdate = (existing, incoming) => {
  if (!existing) return true;
  if (incoming.status === 'cancelled') return existing.status !== 'completed';
  return (ORDER_STATUS_RANK[incoming.status] ?? -1) >= (ORDER_STATUS_RANK[existing.status] ?? -1);
};

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
  const [isDataLoading, setIsDataLoading] = useState(true);

  // --- Auth State ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ phone: '', email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ phone: '', email: '', password: '', confirmPassword: '', name: '' });
  const [authMode, setAuthMode] = useState('login');
  const [authLoading, setAuthLoading] = useState(false);

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
  const [chats, setChats] = useState({});

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

  const seenOrderIdsRef         = React.useRef(new Set());
  const placingOrderRef         = React.useRef(false);
  const pendingLocalOrderIdsRef = React.useRef(new Set());
  const lastChatCountsRef       = React.useRef({});
  const prevOrdersRef           = React.useRef([]);
  const gpsSessionRef           = React.useRef('');
  const shownAdminNotifIds      = React.useRef(new Set());

  // --- Global Wallet Store (in-memory cache for all wallets) ---
  const [globalWallets, setGlobalWallets] = useState({});

  // --- Global User Roles Store ---
  const [globalUserRoles, setGlobalUserRoles] = useState({});

  // --- Toast / Notification ---
  const notifySystem = (title, message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
    playNotificationSound('order');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  };

  const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- Admin notification → Supabase insert ---
  const notifyAdmin = useCallback((title, message, type = 'warning') => {
    const id = Date.now();
    supabase.from('admin_notifs').insert({ id, title, message, type, at: formatDateTime() }).then(() => {});
    if (isAdmin) {
      shownAdminNotifIds.current.add(id);
      notifySystem(title, message, type);
    }
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Role grant ---
  const grantRole = useCallback((userId, role) => {
    setGlobalUserRoles(prev => {
      const cur = prev[userId] || ['customer'];
      if (cur.includes(role)) return prev;
      return { ...prev, [userId]: [...cur, role] };
    });
    if (currentUser?.id === userId || userProfile?.id === userId) {
      setUserRoles(prev => prev.includes(role) ? prev : [...prev, role]);
    }
    supabase.from('user_roles').upsert({ user_id: userId, role }).then(() => {});
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wallet hook ─────────────────────────────────────────────────────────────
  const { creditWallet, processTransaction, requestTopUp, requestWithdraw, adminAdjustWallet } = useWalletActions({
    currentUser, currentUserRef,
    userProfile, userWallet, pendingRequests,
    setUserWallet, setWalletAllEntries, setGlobalWallets, setPendingRequests,
    setShowTopUpModal, setTopUpSlip,
    setWithdrawAmount, setWithdrawBank, setWithdrawAccount, setWithdrawName, setWithdrawMode,
    notifySystem, notifyAdmin,
    supabase,
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
    supabase,
  });

  // ── Admin hook ──────────────────────────────────────────────────────────────
  const {
    handleApproveRequest, initiateRejectRequest, confirmRejectRequest,
    adminBanUser, toggleRestaurantStatus, toggleRiderBan, saveShopEdit, deleteRestaurant,
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
    supabase,
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
    supabase,
  });

  // ── Promo actions hook ──────────────────────────────────────────────────
  const {
    promoCodes, setPromoCodes,
    validatePromoCode, usePromoCode, createPromoCode, togglePromoCode, deletePromoCode,
  } = usePromoActions({ notifySystem, supabase });

  // ── Load app data from Supabase on mount ────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      setIsDataLoading(true);
      try {
        const [restsResult, menusResult, ridersResult, ordersResult, pendingResult, configResult, promosResult] = await Promise.all([
          supabase.from('restaurants').select('id, data'),
          supabase.from('menu_items').select('restaurant_id, items'),
          supabase.from('riders').select('id, data'),
          supabase.from('orders').select('id, data').order('created_at', { ascending: false }).limit(200),
          supabase.from('pending_requests').select('id, data'),
          supabase.from('app_config').select('data').eq('id', 1).single(),
          supabase.from('promo_codes').select('id, data'),
        ]);

        if (restsResult.data?.length) setRestaurants(restsResult.data.map(r => r.data));
        if (menusResult.data?.length) {
          const obj = {};
          menusResult.data.forEach(m => { obj[m.restaurant_id] = m.items; });
          setMenuItems(obj);
        }
        if (ridersResult.data?.length) setRiders(ridersResult.data.map(r => r.data));
        if (ordersResult.data?.length) setOrders(ordersResult.data.map(o => o.data));
        if (pendingResult.data?.length) setPendingRequests(pendingResult.data.map(r => r.data));
        if (configResult.data?.data) {
          setAppConfig(configResult.data.data);
          setEditConfig(configResult.data.data);
        }
        if (promosResult.data?.length) setPromoCodes(promosResult.data.map(p => p.data));
      } catch (e) {
        console.error('loadData error', e);
      } finally {
        setIsDataLoading(false);
        dataLoadedRef.current = true;
      }
    };
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Supabase Auth session + onAuthStateChange ───────────────────────────
  const loadUserSession = useCallback(async (authUser) => {
    try {
      const [profileResult, rolesResult, walletResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', authUser.id).single(),
        supabase.from('user_roles').select('role').eq('user_id', authUser.id),
        supabase.from('wallets').select('balance, history').eq('user_id', authUser.id).single(),
      ]);

      const profile = profileResult.data || {};
      const roles   = rolesResult.data?.map(r => r.role) || ['customer'];
      const wallet  = walletResult.data;

      const mergedRoles = ADMIN_EMAIL && authUser.email === ADMIN_EMAIL
        ? [...new Set([...roles, 'admin'])]
        : roles;

      const prof = {
        id: authUser.id,
        name: profile.name || '',
        phone: profile.phone || '',
        email: authUser.email || profile.email || '',
        location: profile.location || USER_LOCATION,
        image: profile.avatar || null,
      };

      setCurrentUser({ id: authUser.id, email: authUser.email, ...profile, roles: mergedRoles });
      setUserProfile(prof);
      setTempProfile(prof);
      setUserRoles(mergedRoles);
      setUserWallet(r2(wallet?.balance || 0));
      setWalletAllEntries(wallet?.history || []);
      setUserAddresses(profile.addresses || [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }]);
      setGlobalWallets(prev => ({
        ...prev,
        [authUser.id]: { balance: r2(wallet?.balance || 0), history: wallet?.history || [] },
      }));
    } catch (e) {
      console.error('loadUserSession error', e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setIsLoggedIn(true);
        loadUserSession(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setIsLoggedIn(true);
        await loadUserSession(session.user);
      } else {
        setIsLoggedIn(false);
        setCurrentUser(null);
        setUserProfile({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
        setTempProfile({ id: '', name: '', phone: '', email: '', location: USER_LOCATION });
        setUserRoles(['customer']);
        setUserWallet(0);
        setWalletAllEntries([]);
        setUserAddresses([]);
        setActiveRole('customer');
        setActiveTab('home');
        setProfileSubView('main');
        prevOrdersRef.current = [];
        lastChatCountsRef.current = {};
        gpsSessionRef.current = '';
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: Orders ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;
    const channel = supabase.channel('orders-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        const o = payload.new?.data;
        if (o) {
          setOrders(prev => prev.some(x => x.id === o.id) ? prev : [o, ...prev]);
        } else if (payload.new?.id) {
          const { data: row } = await supabase.from('orders').select('id, data').eq('id', payload.new.id).maybeSingle();
          if (row?.data) setOrders(prev => prev.some(x => x.id === row.data.id) ? prev : [row.data, ...prev]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload) => {
        const applyUpdate = (incoming) => {
          if (!incoming?.id) return;
          setOrders(prev => {
            const idx = prev.findIndex(x => x.id === incoming.id);
            if (idx === -1) return [...prev, incoming]; // order not yet in state — add it
            if (!canApplyOrderUpdate(prev[idx], incoming)) return prev;
            const next = [...prev];
            next[idx] = incoming;
            return next;
          });
        };
        const o = payload.new?.data;
        if (o) {
          applyUpdate(o);
        } else if (payload.new?.id) {
          // REPLICA IDENTITY DEFAULT — data column not in payload; fetch directly
          const { data: row } = await supabase.from('orders').select('id, data').eq('id', payload.new.id).maybeSingle();
          if (row?.data) applyUpdate(row.data);
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, (payload) => {
        setOrders(prev => prev.filter(x => x.id !== payload.old?.id));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: Pending Requests ──────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;
    const channel = supabase.channel('pending-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pending_requests' }, async (payload) => {
        const r = payload.new?.data;
        if (r) {
          setPendingRequests(prev => prev.some(x => x.id === r.id) ? prev : [r, ...prev]);
        } else {
          // payload.new.data may be null if Supabase RLS filters row-level data in Realtime
          // Fall back to a direct fetch for the specific row (or full list if id missing)
          const rowId = payload.new?.id;
          if (rowId) {
            const { data: row } = await supabase.from('pending_requests').select('id, data').eq('id', rowId).single();
            if (row?.data) setPendingRequests(prev => prev.some(x => x.id === row.data.id) ? prev : [row.data, ...prev]);
          } else {
            const { data: rows } = await supabase.from('pending_requests').select('id, data');
            if (rows) setPendingRequests(rows.map(row => row.data).filter(Boolean));
          }
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pending_requests' }, (payload) => {
        setPendingRequests(prev => prev.filter(x => x.id !== payload.old?.id));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: Admin notifications ───────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase.channel('admin-notifs-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_notifs' }, (payload) => {
        const n = payload.new;
        if (!n) return;
        // Skip if this device already showed it via notifyAdmin direct call
        if (shownAdminNotifIds.current.has(n.id)) {
          shownAdminNotifIds.current.delete(n.id);
          return;
        }
        notifySystem(n.title, n.message, n.type || 'info');
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: Chats ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;
    const channel = supabase.channel('chats-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, (payload) => {
        const row = payload.new;
        if (!row) return;
        setChats(prev => ({ ...prev, [row.order_id]: row.messages || [] }));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [isLoggedIn]);

  // ── Auto-save to Supabase on state changes ──────────────────────────────
  const debounceRef = useRef({});
  const dataLoadedRef = useRef(false);
  const debouncedUpsert = useCallback((key, fn, delay = 1500) => {
    clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(fn, delay);
  }, []);

  useEffect(() => {
    if (!dataLoadedRef.current || !restaurants.length) return;
    debouncedUpsert('restaurants', () => {
      const rows = restaurants.map(r => ({ id: r.id, owner_id: r.ownerId || null, data: r }));
      supabase.from('restaurants').upsert(rows).then(() => {});
    });
  }, [restaurants]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dataLoadedRef.current) return;
    debouncedUpsert('menu_items', () => {
      const rows = Object.entries(menuItems).map(([rid, items]) => ({ restaurant_id: rid, items }));
      if (rows.length) supabase.from('menu_items').upsert(rows).then(() => {});
    });
  }, [menuItems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dataLoadedRef.current || !riders.length) return;
    debouncedUpsert('riders', () => {
      const rows = riders.map(r => ({ id: r.id, user_id: r.userId || null, data: r }));
      supabase.from('riders').upsert(rows).then(() => {});
    });
  }, [riders]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dataLoadedRef.current) return;
    debouncedUpsert('app_config', () => {
      supabase.from('app_config').upsert({ id: 1, data: appConfig }).then(() => {});
    }, 2000);
  }, [appConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-capture GPS location on login ──────────────────────────────────
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
        supabase.from('profiles').update({ location: loc }).eq('id', uid).then(() => {});
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json`,
            { headers: { 'Accept-Language': 'th' } },
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
        if (err.code === 1) notifySystem('📍 ไม่สามารถดึงตำแหน่งได้', 'กรุณาอนุญาตสิทธิ์ GPS', 'warning');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
    );
  }, [isLoggedIn, currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-grant merchant/rider role (recovery) ───────────────────────────
  useEffect(() => {
    if (!isLoggedIn || !userProfile?.id) return;
    const uid = userProfile.id;
    if (restaurants.some(r => r.ownerId === uid) && !userRoles.includes('merchant')) grantRole(uid, 'merchant');
    if (riders.some(r => r.userId === uid) && !userRoles.includes('rider')) grantRole(uid, 'rider');
  }, [restaurants, riders, userProfile?.id, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync userRoles from globalUserRoles ─────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;
    const uid = currentUser?.id || userProfile?.id;
    if (!uid) return;
    const latestRoles = globalUserRoles[uid];
    if (!latestRoles || !latestRoles.length) return;
    const withAdmin = ADMIN_EMAIL && currentUser?.email === ADMIN_EMAIL
      ? [...new Set([...latestRoles, 'admin'])]
      : latestRoles;
    setUserRoles(prev => {
      if (withAdmin.length === prev.length && withAdmin.every(r => prev.includes(r))) return prev;
      return withAdmin;
    });
  }, [globalUserRoles, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── In-app order notifications ──────────────────────────────────────────
  useEffect(() => {
    const prev = prevOrdersRef.current;
    const uid = currentUser?.id;
    if (!uid || prev.length === 0) { prevOrdersRef.current = orders; return; }
    const prevMap = new Map(prev.map(o => [o.id, o]));
    const myShop = restaurants.find(r => r.ownerId === uid);

    // ── Merchant: new pending orders ──────────────────────────────────────
    if (myShop) {
      const newMerchantOrders = orders.filter(o => o.status === 'pending' && o.restaurantId === myShop.id && !prevMap.has(o.id));
      if (newMerchantOrders.length > 0) {
        setMerchantTab('orders');
        playOrderNotificationSound();
        notifySystem('🛎️ ออเดอร์ใหม่เข้าร้าน!', `Order เข้า ${newMerchantOrders.length} ครั้ง`, 'warning');
      }
    }

    // ── Rider: new available jobs ─────────────────────────────────────────
    if (userRoles.includes('rider')) {
      const newJobs = orders.filter(o => o.status === 'ready_to_pickup' && !o.riderId && !prevMap.has(o.id));
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

    // ── Status-change notifications for all parties ───────────────────────
    orders.forEach(o => {
      const p = prevMap.get(o.id);
      if (!p || p.status === o.status) return;

      // Customer notifications — every step of their order
      if (o.customerId === uid) {
        switch (o.status) {
          case 'preparing':
            notifySystem('👨‍🍳 ร้านกำลังเตรียมอาหาร', `ออเดอร์ #${o.id.slice(-6)} กำลังเตรียม`, 'info'); break;
          case 'ready_to_pickup':
            notifySystem('✅ อาหารพร้อมแล้ว!', `กำลังหาไรเดอร์ ออเดอร์ #${o.id.slice(-6)}`, 'info'); break;
          case 'rider_accepted':
            notifySystem('🛵 ไรเดอร์รับงานแล้ว!', `${o.riderName || 'ไรเดอร์'} กำลังมารับอาหาร`, 'info'); break;
          case 'picking_up':
            notifySystem('📦 ไรเดอร์รับอาหารแล้ว!', `ออเดอร์ #${o.id.slice(-6)} กำลังออกเดินทาง`, 'info'); break;
          case 'delivering':
            notifySystem('🚀 กำลังส่งอาหาร!', `ออเดอร์ #${o.id.slice(-6)} กำลังมาถึงคุณ`, 'info'); break;
          case 'delivered':
            playNotificationSound('order');
            notifySystem('📬 ถึงแล้ว! กรุณายืนยันรับสินค้า', `ออเดอร์ #${o.id.slice(-6)} — กด "ยืนยันรับอาหาร" เพื่อเสร็จสิ้น`, 'warning'); break;
          case 'completed':
            playNotificationSound('success');
            notifySystem(`✅ จัดส่ง${o.type === 'parcel' ? 'พัสดุ' : 'อาหาร'}สำเร็จ!`, `ออเดอร์ #${o.id.slice(-8)} ถึงมือคุณแล้ว 🎉`, 'success'); break;
          case 'cancelled':
            notifySystem('❌ ออเดอร์ถูกยกเลิก', `#${o.id.slice(-8)}${o.cancelReason ? `: ${o.cancelReason}` : ''}`, 'error'); break;
          default: break;
        }
      }

      // Merchant notifications — track their shop's order progress
      if (myShop && o.restaurantId === myShop.id) {
        switch (o.status) {
          case 'rider_accepted':
            notifySystem('🛵 ไรเดอร์รับงานแล้ว', `${o.riderName || 'ไรเดอร์'} มารับออเดอร์ #${o.id.slice(-6)}`, 'info'); break;
          case 'picking_up':
            notifySystem('✅ ไรเดอร์รับอาหารออกจากร้านแล้ว', `ออเดอร์ #${o.id.slice(-6)} ออกจากหน้าจอทำงานของคุณแล้ว`, 'success'); break;
          case 'completed':
            notifySystem('💰 ออเดอร์สำเร็จ!', `ออเดอร์ #${o.id.slice(-6)} จัดส่งสำเร็จ — รายได้เข้ากระเป๋าแล้ว`, 'success'); break;
          default: break;
        }
      }
    });

    prevOrdersRef.current = orders;
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save profile to Supabase on change ──────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn || !currentUser?.id) return;
    debouncedUpsert('profile', () => {
      supabase.from('profiles').update({
        name: userProfile.name,
        phone: userProfile.phone,
        avatar: userProfile.image || null,
        location: userProfile.location,
        addresses: userAddresses,
      }).eq('id', currentUser.id).then(() => {});
    }, 2000);
  }, [userProfile, userAddresses]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time Rider Location Simulation ─────────────────────────────────
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

  // ── Polling fallback for active orders (every 4s) ──────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;
    const poll = setInterval(async () => {
      const activeStatuses = ['pending','preparing','ready_to_pickup','rider_accepted','picking_up','delivering','delivered'];
      const { data } = await supabase
        .from('orders')
        .select('id, status, data')
        .in('status', activeStatuses)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!data?.length) return;
      setOrders(prev => {
        const incoming = data.map(r => r.data).filter(Boolean);
        const map = new Map(prev.map(o => [o.id, o]));
        let changed = false;
        incoming.forEach(o => {
          const existing = map.get(o.id);
          if (canApplyOrderUpdate(existing, o)) {
            const rank    = ORDER_STATUS_RANK[o.status] ?? -1;
            const oldRank = ORDER_STATUS_RANK[existing?.status] ?? -1;
            if (rank > oldRank || JSON.stringify(existing) !== JSON.stringify(o)) {
              map.set(o.id, o);
              changed = true;
            }
          }
        });
        return changed ? Array.from(map.values()) : prev;
      });
    }, 4000);
    return () => clearInterval(poll);
  }, [isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update Parcel Estimate ───────────────────────────────────────────────
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

  // ── Chat ─────────────────────────────────────────────────────────────────
  const openChatWindow = (id, title, role) => {
    if (!chats[id]) {
      setChats(prev => ({ ...prev, [id]: [] }));
      supabase.from('chats').upsert({ order_id: id, messages: [] }).then(() => {});
    }
    setActiveChat({ id, title, role });
  };
  const closeChatWindow = () => setActiveChat(null);

  const sendMessage = (text) => {
    if (!text.trim() || !activeChat) return;
    const newMessage = {
      text: text.trim(),
      sender: activeRole,
      senderName: activeRole === 'admin' ? 'เจ้าหน้าที่'
        : activeRole === 'rider' ? 'ไรเดอร์'
        : activeRole === 'merchant' ? 'ร้านค้า'
        : userProfile?.name || 'ลูกค้า',
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };
    setChats(prev => {
      const next = { ...prev, [activeChat.id]: [...(prev[activeChat.id] || []), newMessage] };
      supabase.from('chats').upsert({ order_id: activeChat.id, messages: next[activeChat.id], updated_at: new Date().toISOString() }).then(() => {});
      return next;
    });
  };

  const deleteChat = (chatId) => {
    setChats(prev => { const next = { ...prev }; delete next[chatId]; return next; });
    supabase.from('chats').delete().eq('order_id', chatId).then(() => {});
    if (activeChat?.id === chatId) setActiveChat(null);
  };

  // ── Location helpers ─────────────────────────────────────────────────────
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
    }, () => notifySystem('ผิดพลาด', 'ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS', 'error'), { enableHighAccuracy: true, timeout: 10000 });
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
    }, () => notifySystem('ผิดพลาด', 'ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS', 'error'), { enableHighAccuracy: true, timeout: 10000 });
  };

  const handleSaveProfile = useCallback(() => {
    setUserProfile({ ...tempProfile });
    setProfileSubView('main');
    notifySystem('สำเร็จ', 'บันทึกข้อมูลโปรไฟล์เรียบร้อย', 'success');
  }, [tempProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Merchant Management ──────────────────────────────────────────────────
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
    setMenuItems(prev => ({ ...prev, [restaurantId]: [...(prev[restaurantId] || []), { ...newItem, id: generateId(), available: true }] }));
    notifySystem('สำเร็จ', 'เพิ่มเมนูเรียบร้อย', 'success');
  };

  const handleEditMenuItem = (restaurantId, itemId, updatedItem) => {
    setMenuItems(prev => ({ ...prev, [restaurantId]: (prev[restaurantId] || []).map(item => item.id === itemId ? { ...item, ...updatedItem } : item) }));
    notifySystem('สำเร็จ', 'แก้ไขเมนูเรียบร้อย', 'success');
  };

  const handleDeleteMenuItem = (restaurantId, itemId) => {
    if (!window.confirm('ยืนยันการลบเมนูนี้?')) return;
    setMenuItems(prev => ({ ...prev, [restaurantId]: (prev[restaurantId] || []).filter(item => item.id !== itemId) }));
    notifySystem('สำเร็จ', 'ลบเมนูเรียบร้อย', 'success');
  };

  const handleToggleItemAvailability = (restaurantId, itemId) => {
    setMenuItems(prev => ({ ...prev, [restaurantId]: (prev[restaurantId] || []).map(item => item.id === itemId ? { ...item, available: !item.available } : item) }));
  };

  // ── Address management ───────────────────────────────────────────────────
  const handleUpdateUserLocation = useCallback(async (location) => {
    if (!location) return;
    const uid = currentUser?.id || userProfile?.id;
    setUserProfile(prev => ({ ...prev, location }));
    if (uid) supabase.from('profiles').update({ location }).eq('id', uid).then(() => {});
    notifySystem('📍 บันทึกตำแหน่งแล้ว', 'ตำแหน่งหลักของคุณถูกอัปเดตเรียบร้อย', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAddress = (addr) => {
    const loc = addr.location || USER_LOCATION;
    setUserAddresses(prev => [...prev, { id: generateId(), label: addr.label, address: addr.fullAddr, location: loc }]);
    notifySystem('สำเร็จ', 'บันทึกที่อยู่เรียบร้อย', 'success');
  };

  const handleUpdateAddress = useCallback(async (id, location, label, fullAddr) => {
    const addr = fullAddr || await reverseGeocode(location.lat, location.lng).catch(() => `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`);
    setUserAddresses(prev => prev.map(a => a.id === id ? { ...a, location, address: addr, ...(label ? { label } : {}) } : a));
    notifySystem('📍 อัปเดตหมุดแล้ว', 'บันทึกตำแหน่งที่อยู่ใหม่เรียบร้อย', 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteAddress = (id) => setUserAddresses(prev => prev.filter(a => a.id !== id));

  // ── Rider location update ─────────────────────────────────────────────────
  const updateRiderWorkingLocation = useCallback((riderId, location) => {
    if (!riderId || !location) return;
    setRiders(prev => prev.map(r => r.id === riderId ? { ...r, location } : r));
  }, []);

  // ── Manual role/pending sync from Supabase ───────────────────────────────
  const syncRoles = useCallback(async () => {
    const uid = currentUser?.id || userProfile?.id;
    if (!uid) return;
    const [rolesResult, pendingResult] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('pending_requests').select('id, data'),
    ]);
    const latest = rolesResult.data?.map(r => r.role) || [];
    if (latest.length > 0) {
      const withAdmin = ADMIN_EMAIL && currentUser?.email === ADMIN_EMAIL ? [...new Set([...latest, 'admin'])] : latest;
      setUserRoles(withAdmin);
    }
    if (pendingResult.data?.length) setPendingRequests(pendingResult.data.map(r => r.data));
    notifySystem('อัปเดต', 'โหลดข้อมูลล่าสุดแล้ว', 'success');
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth Functions ───────────────────────────────────────────────────────
  const handleLogin = async () => {
    const input = (loginForm.email || loginForm.phone || '').trim();
    if (!input) return notifySystem('ผิดพลาด', 'กรุณากรอกเบอร์โทรหรืออีเมล', 'error');
    if (!loginForm.password) return notifySystem('ผิดพลาด', 'กรุณากรอกรหัสผ่าน', 'error');
    setAuthLoading(true);
    try {
      let email = input;
      if (!input.includes('@')) {
        const { data: profile } = await supabase.from('profiles').select('email').eq('phone', input).single();
        if (!profile?.email) return notifySystem('ผิดพลาด', 'ไม่พบบัญชีสำหรับเบอร์นี้', 'error');
        email = profile.email;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password: loginForm.password });
      if (error) return notifySystem('ผิดพลาด', 'อีเมล/รหัสผ่านไม่ถูกต้อง', 'error');
      const { data: profile } = await supabase.from('profiles').select('banned').eq('email', email).maybeSingle();
      if (profile?.banned) {
        await supabase.auth.signOut();
        return notifySystem('ผิดพลาด', 'บัญชีนี้ถูกระงับการใช้งาน', 'error');
      }
      setLoginForm({ phone: '', email: '', password: '' });
      notifySystem('สำเร็จ', 'เข้าสู่ระบบเรียบร้อย!', 'success');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!registerForm.name) return notifySystem('ผิดพลาด', 'กรุณากรอกชื่อ-นามสกุล', 'error');
    if (!registerForm.email) return notifySystem('ผิดพลาด', 'กรุณากรอกอีเมล', 'error');
    if (!registerForm.password) return notifySystem('ผิดพลาด', 'กรุณากรอกรหัสผ่าน', 'error');
    if (registerForm.password.length < 6) return notifySystem('ผิดพลาด', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error');
    if (registerForm.password !== registerForm.confirmPassword) return notifySystem('ผิดพลาด', 'รหัสผ่านไม่ตรงกัน', 'error');
    setAuthLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: registerForm.email,
        password: registerForm.password,
        options: { data: { name: registerForm.name } },
      });
      if (error) return notifySystem('ผิดพลาด', error.message, 'error');
      if (!data.user) return notifySystem('ผิดพลาด', 'สมัครไม่สำเร็จ ลองใหม่อีกครั้ง', 'error');
      const uid = data.user.id;
      await Promise.all([
        supabase.from('profiles').insert({
          id: uid,
          name: registerForm.name,
          phone: registerForm.phone || null,
          email: registerForm.email,
          location: USER_LOCATION,
          addresses: [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
        }),
        supabase.from('wallets').insert({ user_id: uid, balance: 0, history: [] }),
        supabase.from('user_roles').insert({ user_id: uid, role: 'customer' }),
      ]);
      setRegisterForm({ phone: '', email: '', password: '', confirmPassword: '', name: '' });
      notifySystem('สำเร็จ', 'สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ 🎉', 'success');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // ── Clear wallet history ──────────────────────────────────────────────────
  const clearWalletHistory = useCallback(async () => {
    setWalletAllEntries([]);
    setWalletClearedAt(new Date());
    const uid = currentUser?.id || userProfile?.id;
    if (uid) {
      const { data: w } = await supabase.from('wallets').select('balance').eq('user_id', uid).single();
      await supabase.from('wallets').upsert({ user_id: uid, balance: w?.balance || 0, history: [] });
    }
  }, [currentUser?.id, userProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rating ────────────────────────────────────────────────────────────────
  const openRatingModal  = useCallback((order) => { setRatingOrderData(order); setShowRatingModal(true); }, []);

  const submitRating = useCallback(async ({ orderId, restaurantId, riderId, restaurantRating, riderRating, comment }) => {
    const orderToRate = orders.find(o => o.id === orderId);
    if (!orderToRate) return;
    if (restaurantId && restaurantRating) {
      let updatedRest;
      setRestaurants(prev => prev.map(r => {
        if (r.id !== restaurantId) return r;
        const prevCount = r.ratingCount || 0;
        const count = prevCount + 1;
        const avg = parseFloat((((r.rating || 5) * prevCount + restaurantRating) / count).toFixed(1));
        updatedRest = { ...r, rating: avg, ratingCount: count };
        return updatedRest;
      }));
      if (updatedRest) supabase.from('restaurants').update({ data: updatedRest }).eq('id', restaurantId).then(() => {});
    }
    if (riderId && riderRating) {
      let updatedRider;
      setRiders(prev => prev.map(r => {
        if (r.id !== riderId) return r;
        const prevCount = r.ratingCount || 0;
        const count = prevCount + 1;
        const avg = parseFloat((((r.avgRating || 5) * prevCount + riderRating) / count).toFixed(1));
        updatedRider = { ...r, avgRating: avg, ratingCount: count };
        return updatedRider;
      }));
      if (updatedRider) supabase.from('riders').update({ data: updatedRider }).eq('id', riderId).then(() => {});
    }
    const ratedOrder = { ...orderToRate, rated: true, ratingComment: comment };
    setOrders(prev => prev.map(o => o.id === orderId ? ratedOrder : o));
    supabase.from('orders').update({ data: ratedOrder }).eq('id', orderId).then(() => {});
    setShowRatingModal(false);
    setRatingOrderData(null);
    notifySystem('ขอบคุณ! 🌟', 'บันทึกรีวิวของคุณแล้ว', 'success');
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

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
    isDataLoading,

    // Auth
    isLoggedIn,
    currentUser,
    loginForm, setLoginForm,
    registerForm, setRegisterForm,
    authMode, setAuthMode,
    authLoading,
    handleLogin,
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
    selectedOrderToCancel,
    cancelReasonInput, setCancelReasonInput,
    showRejectModal,
    showImageModal, setShowImageModal,
    previewImageUrl,

    // TopUp & Wallet
    showTopUpModal, setShowTopUpModal,
    topUpSlip, setTopUpSlip,
    creditWallet,
    processTransaction,
    requestTopUp,
    requestWithdraw,
    adminAdjustWallet,

    // Rating
    showRatingModal, setShowRatingModal,
    ratingOrderData,
    openRatingModal,
    submitRating,

    // Chat
    activeChat,
    chats,
    openChatWindow,
    closeChatWindow,
    sendMessage,
    deleteChat,

    // Location
    handleMapLocationSelect,
    handleParcelMapSelect,
    getCurrentLocationForForm,
    getCurrentLocationForParcel,
    handleUpdateUserLocation,

    // Profile
    handleSaveProfile,
    profileUploading,
    handleProfilePhotoChange,

    // Merchant
    handleUpdateShopLocation,
    handleToggleShopStatus,
    handleAddMenuItem,
    handleEditMenuItem,
    handleDeleteMenuItem,
    handleToggleItemAvailability,
    handleShopPhotoChange,
    handleRegistrationPhotoSelect,
    handleTopUpSlipSelect,
    handleMenuPhotoSelect,
    openImagePreview,

    // Address
    handleAddAddress,
    handleUpdateAddress,
    handleDeleteAddress,

    // Registration
    requestRegisterMerchant,
    requestRegisterRider,

    // Promo
    promoCodes, setPromoCodes,
    validatePromoCode, usePromoCode, createPromoCode, togglePromoCode, deletePromoCode,

    // Admin
    handleApproveRequest,
    initiateRejectRequest,
    confirmRejectRequest,
    adminBanUser,
    toggleRestaurantStatus,
    toggleRiderBan,
    saveShopEdit,
    deleteRestaurant,

    // Misc
    toasts, removeToast,
    syncRoles,
    updateRiderWorkingLocation,
    isPending,
    hasPendingCancelRequest,
    initiateCancelOrder,
    confirmCancelOrder,
    requestCancelOrder,
    requestCancelByRole,
    forceRefresh,
    walletAllEntries,
    supabase,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
