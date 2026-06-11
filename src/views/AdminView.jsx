import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert, ArrowLeft, MessageSquare, Bell, Check, XCircle,
  ChefHat, Bike, Sliders, Save, CreditCard,
  DollarSign, Percent, Map as MapIcon,
  Edit, Power, Lock, Phone, FileBadge,
  Image as ImageIcon, Ban, X, Users, BarChart2, Tag,
  TrendingUp, ShoppingBag, Star, PlusCircle, Trash2,
  ToggleLeft, ToggleRight, Wallet, AlertCircle, List,
  DatabaseZap, ShieldOff, CheckSquare, Square,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STATUS_LABELS, ADMIN_EMAIL } from '../constants';
import { formatDateTimeFromMs } from '../utils';
import { supabase } from '../lib/supabase';

// ─── helpers ───────────────────────────────────────────────────────────────
function StatCard({ label, value, color = 'green', icon: Icon }) {
  const colors = {
    green:  'border-green-500 text-green-600',
    blue:   'border-blue-500 text-blue-600',
    orange: 'border-orange-500 text-orange-600',
    purple: 'border-purple-500 text-purple-600',
    red:    'border-red-500 text-red-600',
  };
  return (
    <div className={`bg-white p-5 rounded-xl shadow-sm border-l-4 ${colors[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">{label}</p>
          <h3 className="text-2xl font-bold text-gray-800 mt-1">{value}</h3>
        </div>
        {Icon && <Icon size={28} className={`opacity-20`} />}
      </div>
    </div>
  );
}

function SimpleBar({ label, value, max, color = '#22c55e' }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-xs text-gray-500 w-20 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-bold text-gray-700 w-12 text-right">{value}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function AdminView() {
  const {
    activeRole, setActiveRole,
    adminTab, setAdminTab,
    orders, restaurants, riders, pendingRequests,
    appConfig, setAppConfig,
    editConfig, setEditConfig,
    chats,
    globalWallets,
    userProfile,
    userWallet,
    walletHistory,
    editingShop, setEditingShop,
    shopEditForm, setShopEditForm,
    showCancelModal, setShowCancelModal,
    showRejectModal, setShowRejectModal,
    cancelReasonInput, setCancelReasonInput,
    showImageModal, setShowImageModal,
    previewImageUrl,
    handleApproveRequest,
    initiateRejectRequest, confirmRejectRequest,
    initiateCancelOrder, confirmCancelOrder,
    saveShopEdit,
    toggleRestaurantStatus, toggleRiderBan, deleteRestaurant,
    openChatWindow, openImagePreview,
    notifySystem,
    deleteChat,
    // Promo
    promoCodes, createPromoCode, togglePromoCode, deletePromoCode,
    // Admin tools
    adminAdjustWallet, adminBanUser,
    creditWallet, grantRole, revokeRole,
    setOrders, setRestaurants, setRiders, setPendingRequests, setGlobalWallets,
    isDataLoading,
  } = useApp();

  // ── Local state ──────────────────────────────────────────────────────────
  const [allUsers, setAllUsers] = useState([]);
  const [adjustUserId, setAdjustUserId] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDesc, setAdjustDesc] = useState('');
  const [resetPwdUserId, setResetPwdUserId] = useState(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [userWalletEntries, setUserWalletEntries] = useState({});
  const [userWalletLoading, setUserWalletLoading] = useState({});

  // Promo form
  const [promoForm, setPromoForm] = useState({
    code: '', type: 'percent', value: 10, minOrder: 0, maxUses: 100,
    maxDiscount: 500, expiry: '', description: '',
  });

  const [searchLedger, setSearchLedger] = useState('');
  const [approvingId, setApprovingId] = useState(null);

  // Transaction log state
  const [txList, setTxList] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txRefreshKey, setTxRefreshKey] = useState(0);

  // Wallet overview state (dashboard tab)
  const [walletRows, setWalletRows] = useState([]);       // [{ uid, name, roles, balance, history }]
  const [walletExpanded, setWalletExpanded] = useState(null); // uid of expanded row
  const [walletOverviewLoading, setWalletOverviewLoading] = useState(false);

  const loadAllUsers = async () => {
    const [profilesResult, walletsResult, rolesResult] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('wallets').select('user_id, balance'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    const walletsMap = {};
    walletsResult.data?.forEach(w => { walletsMap[w.user_id] = w.balance; });
    const rolesMap = {};
    rolesResult.data?.forEach(r => {
      if (!rolesMap[r.user_id]) rolesMap[r.user_id] = [];
      rolesMap[r.user_id].push(r.role);
    });
    setAllUsers((profilesResult.data || []).map(p => ({
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      banned: p.banned,
      walletBalance: walletsMap[p.id] ?? globalWallets[p.id]?.balance ?? 0,
      roles: rolesMap[p.id] || ['customer'],
    })));
  };

  const loadWalletOverview = async () => {
    setWalletOverviewLoading(true);
    const [walletsResult, profilesResult, rolesResult] = await Promise.all([
      supabase.from('wallets').select('user_id, balance, history'),
      supabase.from('profiles').select('id, name, email'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    const nameMap = {};
    profilesResult.data?.forEach(p => { nameMap[p.id] = { name: p.name || p.email || p.id.slice(0,8), email: p.email }; });
    const rolesMap = {};
    rolesResult.data?.forEach(r => {
      if (!rolesMap[r.user_id]) rolesMap[r.user_id] = [];
      rolesMap[r.user_id].push(r.role);
    });
    const rows = (walletsResult.data || []).map(w => ({
      uid:     w.user_id,
      name:    nameMap[w.user_id]?.name  || w.user_id.slice(0, 8),
      email:   nameMap[w.user_id]?.email || '',
      roles:   rolesMap[w.user_id]       || ['customer'],
      balance: w.balance || 0,
      history: (w.history || []).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    }));
    rows.sort((a, b) => b.balance - a.balance);
    setWalletRows(rows);
    setWalletOverviewLoading(false);
  };

  useEffect(() => {
    if (adminTab === 'users') loadAllUsers();
    if (adminTab === 'dashboard') loadWalletOverview();
    if (adminTab === 'approvals') {
      supabase.from('pending_requests').select('id, data').then(({ data }) => {
        if (data) setPendingRequests(data.map(r => r.data));
      });
    }
  }, [adminTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build transaction list from Supabase wallets when on ledger tab
  useEffect(() => {
    if (adminTab !== 'ledger') return;
    const loadLedger = async () => {
      setTxLoading(true);
      const [walletsResult, profilesResult] = await Promise.all([
        supabase.from('wallets').select('user_id, history'),
        supabase.from('profiles').select('id, name'),
      ]);
      const nameMap = {};
      profilesResult.data?.forEach(p => { nameMap[p.id] = p.name; });
      const entries = [];
      walletsResult.data?.forEach(w => {
        const uname = nameMap[w.user_id] || w.user_id.slice(0, 8);
        (w.history || []).forEach(e => entries.push({ ...e, userId: w.user_id, userName: uname }));
      });
      entries.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      setTxList(entries);
      setTxLoading(false);
    };
    loadLedger();
  }, [adminTab, txRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearTransactions = async () => {
    if (!window.confirm('ล้างประวัติธุรกรรมทั้งระบบใช่หรือไม่?')) return;
    const { data: wallets } = await supabase.from('wallets').select('user_id');
    if (wallets?.length) {
      await Promise.all(wallets.map(w => supabase.rpc('clear_wallet_history', { p_user_id: w.user_id })));
    }
    setTxList([]);
    setTxRefreshKey(k => k + 1);
    notifySystem('ล้างข้อมูล', 'ล้างบันทึกธุรกรรมเรียบร้อยแล้ว', 'success');
  };

  // ── Purge state ───────────────────────────────────────────────────────────
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [showResetAllModal, setShowResetAllModal] = useState(false);
  const [purgeOptions, setPurgeOptions] = useState({
    orders: false,
    walletEntries: false,
    pendingRequests: false,
    restaurants: false,
    riders: false,
    users: false,
    wallets: false,
  });
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);

  const togglePurge = (key) => setPurgeOptions(prev => ({ ...prev, [key]: !prev[key] }));

  const handlePurge = async (isResetAll = false) => {
    const opts = isResetAll
      ? { orders: true, walletEntries: true, pendingRequests: true, restaurants: true, riders: true, wallets: true, users: true }
      : purgeOptions;
    setPurgeLoading(true);
    setPurgeResult(null);
    try {
      const tasks = [];
      if (opts.orders)          { tasks.push(supabase.from('orders').delete().neq('id', '')); setOrders([]); }
      if (opts.pendingRequests) { tasks.push(supabase.from('pending_requests').delete().neq('id', '')); setPendingRequests([]); }
      if (opts.restaurants)     { tasks.push(supabase.from('restaurants').delete().neq('id', '')); setRestaurants([]); }
      if (opts.riders)          { tasks.push(supabase.from('riders').delete().neq('id', '')); setRiders([]); }
      if (opts.wallets) {
        tasks.push(supabase.from('wallets').delete().neq('user_id', ''));
        setGlobalWallets({});
      } else if (opts.walletEntries) {
        const { data: wals } = await supabase.from('wallets').select('user_id');
        if (wals?.length) tasks.push(...wals.map(w => supabase.rpc('clear_wallet_history', { p_user_id: w.user_id })));
      }
      if (opts.users) {
        tasks.push(supabase.from('profiles').delete().neq('id', ''));
        tasks.push(supabase.from('user_roles').delete().neq('user_id', ''));
      }
      await Promise.all(tasks);
      setPurgeResult({ ok: true, summary: 'เสร็จสิ้น' });
      notifySystem('ล้างข้อมูล ✅', 'ลบข้อมูลที่เลือกออกจากระบบเรียบร้อยแล้ว', 'success');
    } catch (err) {
      setPurgeResult({ ok: false, summary: `ผิดพลาด: ${err?.message || 'unknown'}` });
    } finally {
      setPurgeLoading(false);
      setShowPurgeModal(false);
      setShowResetAllModal(false);
    }
  };

  const saveConfig = () => {
    setAppConfig(editConfig);
    notifySystem('สำเร็จ', 'บันทึกการตั้งค่าระบบเรียบร้อยแล้ว', 'success');
  };

  // ── Derived metrics ──────────────────────────────────────────────────────
  // นับเฉพาะ orders ที่สำเร็จ (ไม่นับยกเลิก/pending)
  const completedOrders = orders.filter(o => ['completed', 'delivered'].includes(o.status));
  const totalGP   = completedOrders.reduce((s, o) => s + (o.adminGP || 0), 0);
  const gmv       = completedOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);

  // ── Chat groupings (admin sees ALL chats) ────────────────────────────────
  const allChatIds       = Object.keys(chats);
  const supportChats     = allChatIds.filter(k => k.startsWith('support-') || k.endsWith('-support'));
  // -rider-merchant ต้องกรองก่อน -merchant และ -rider เพื่อป้องกัน false-match
  const riderMerchantChats = allChatIds.filter(k => k.endsWith('-rider-merchant'));
  const merchantChats    = allChatIds.filter(k => k.endsWith('-merchant') && !k.endsWith('-rider-merchant'));
  const riderChats       = allChatIds.filter(k => k.endsWith('-rider') && !k.endsWith('-rider-merchant'));
  const totalChatCount   = allChatIds.length;
  // นับ unread: support chats ที่ข้อความล่าสุดมาจาก non-admin
  const unreadSupportCount = supportChats.filter(id => {
    const msgs = chats[id] || [];
    const last = msgs[msgs.length - 1];
    return last && last.sender !== 'admin';
  }).length;

  // Today's date string — must match formatDateTime() output: DD/MM/YYYY
  const todayStr = (() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()}`; })();
  const todayOrders = orders.filter(o => (o.createdAt || o.timestamp || '').startsWith(todayStr));
  const todayCompletedOrders = todayOrders.filter(o => ['completed', 'delivered'].includes(o.status));
  const todayGMV  = todayCompletedOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const todayGP   = todayCompletedOrders.reduce((s, o) => s + (o.adminGP || 0), 0);

  // Status breakdown
  const statusCount = useMemo(() => {
    const counts = {};
    orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return counts;
  }, [orders]);

  // Top restaurants by order count
  const topRestaurants = useMemo(() => {
    const counts = {};
    orders.filter(o => o.restaurantId).forEach(o => {
      counts[o.restaurantId] = (counts[o.restaurantId] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([id, cnt]) => ({ id, cnt, name: restaurants.find(r => r.id === id)?.name || id }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 5);
  }, [orders, restaurants]);

  // Top riders by delivery count
  const topRiders = useMemo(() => {
    const counts = {};
    orders.filter(o => o.riderId && ['delivered', 'completed'].includes(o.status)).forEach(o => {
      counts[o.riderId] = (counts[o.riderId] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([id, cnt]) => ({ id, cnt, name: riders.find(r => r.id === id)?.name || id }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 5);
  }, [orders, riders]);

  const maxRestCnt = topRestaurants[0]?.cnt || 1;
  const maxRiderCnt = topRiders[0]?.cnt || 1;

  // ── Tab config ───────────────────────────────────────────────────────────
  const TABS = [
    { id: 'dashboard',   label: 'ภาพรวม',     icon: BarChart2 },
    { id: 'analytics',   label: 'วิเคราะห์',  icon: TrendingUp },
    { id: 'approvals',   label: 'อนุมัติ',    icon: Bell,    badge: pendingRequests.length },
    { id: 'users',       label: 'ผู้ใช้',     icon: Users },
    { id: 'management',  label: 'จัดการระบบ', icon: Sliders },
    { id: 'promotions',  label: 'โปรโมชั่น',  icon: Tag,     badge: promoCodes.filter(p => p.active).length },
    { id: 'ledger',      label: 'ธุรกรรม',    icon: List },
    { id: 'messages',    label: 'ข้อความ',    icon: MessageSquare, badge: (unreadSupportCount || totalChatCount) || null },
    { id: 'settings',    label: 'ตั้งค่า',    icon: CreditCard },
  ];

  // ── Wallet adjust ─────────────────────────────────────────────────────────
  const loadUserWalletEntries = async (userId) => {
    if (!userId) return;
    setUserWalletLoading(prev => ({ ...prev, [userId]: true }));
    const { data } = await supabase.from('wallets').select('history').eq('user_id', userId).single();
    setUserWalletEntries(prev => ({ ...prev, [userId]: data?.history || [] }));
    setUserWalletLoading(prev => ({ ...prev, [userId]: false }));
  };

  const handleClearUserWalletHistory = async (userId, userName) => {
    if (!window.confirm(`ล้างประวัติกระเป๋าของ ${userName} ใช่หรือไม่?\n(รายการจะถูกซ่อน — ยอดเงินคงเดิม)`)) return;
    await supabase.rpc('clear_wallet_history', { p_user_id: userId });
    setUserWalletEntries(prev => ({ ...prev, [userId]: [] }));
    notifySystem('Admin', `ล้างประวัติกระเป๋าของ ${userName} แล้ว`, 'success');
  };

  const handleResetPassword = async () => {
    if (!resetPwdUserId) return;
    const user = allUsers.find(u => u.id === resetPwdUserId);
    if (!user?.email) return notifySystem('ผิดพลาด', 'ไม่พบอีเมลของผู้ใช้', 'error');
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${import.meta.env.VITE_APP_URL || window.location.origin}/reset-password`,
    });
    if (error) return notifySystem('ผิดพลาด', error.message, 'error');
    setResetPwdUserId(null);
    setResetPwdValue('');
    notifySystem('สำเร็จ', `ส่งอีเมลรีเซ็ตรหัสผ่านไปยัง ${user.email} แล้ว`, 'success');
  };

  const handleAdjust = async () => {
    const amt = parseFloat(adjustAmount);
    if (!adjustUserId || isNaN(amt) || amt === 0 || !adjustDesc) {
      return notifySystem('ผิดพลาด', 'กรุณากรอกข้อมูลให้ครบ', 'error');
    }
    await adminAdjustWallet(adjustUserId, amt, adjustDesc);
    setAdjustUserId(null);
    setAdjustAmount('');
    setAdjustDesc('');
    await loadAllUsers();
  };

  // ── Create promo ──────────────────────────────────────────────────────────
  const handleCreatePromo = () => {
    if (!promoForm.code || !promoForm.value) {
      return notifySystem('ผิดพลาด', 'กรุณากรอกโค้ดและมูลค่า', 'error');
    }
    createPromoCode({ ...promoForm, value: parseFloat(promoForm.value), minOrder: parseFloat(promoForm.minOrder || 0), maxUses: parseInt(promoForm.maxUses || 100), maxDiscount: parseFloat(promoForm.maxDiscount || 9999) });
    setPromoForm({ code: '', type: 'percent', value: 10, minOrder: 0, maxUses: 100, maxDiscount: 500, expiry: '', description: '' });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gray-100 pt-14 pb-20 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveRole('customer')} className="p-2 bg-white rounded-full shadow hover:bg-gray-50 text-gray-600"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><ShieldAlert className="text-red-500" size={24} /> Admin Panel</h1>
            <p className="text-xs text-gray-400">BoomRider Control Center</p>
          </div>
        </div>

        {/* Tab bar — horizontal scroll */}
        <div className="flex gap-1 bg-white p-1 rounded-xl shadow-sm overflow-x-auto max-w-full scrollbar-hide w-full md:w-auto">
          {TABS.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setAdminTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-xs whitespace-nowrap transition-all ${
                adminTab === id ? 'bg-green-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon size={13} />
              {label}
              {badge > 0 && (
                <span className={`ml-0.5 px-1.5 rounded-full text-[10px] font-bold ${adminTab === id ? 'bg-white text-green-700' : 'bg-red-500 text-white'}`}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── DASHBOARD ─────────────────────────────────────────────────── */}
      {adminTab === 'dashboard' && (
        <>
          {/* ── System Health Monitor ─────────────────────────────────────── */}
          {(() => {
            const activeOrders   = orders.filter(o => !['completed','cancelled'].includes(o.status));
            const waitingDispatch = orders.filter(o => o.status === 'ready_to_pickup' && !o.riderId);
            const ridersOnline   = riders.filter(r => r.is_available === true || r.isAvailable === true);
            const ridersActive   = riders.filter(r => r.status === 'active');
            const pendingCount   = pendingRequests.length;
            const alerts         = [];
            if (waitingDispatch.length > 0) alerts.push(`⚠️ ${waitingDispatch.length} ออเดอร์รอไรเดอร์ (ยังไม่มีการจ่ายงาน)`);
            if (pendingCount > 0) alerts.push(`🔔 ${pendingCount} คำขอรออนุมัติ`);
            return (
              <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border-l-4 border-green-500">
                <div className="flex items-center gap-2 mb-3">
                  <DatabaseZap size={16} className="text-green-600" />
                  <h2 className="font-bold text-gray-700 text-sm">System Monitor</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-black text-orange-600">{activeOrders.length}</div>
                    <div className="text-xs text-gray-500 mt-0.5">ออเดอร์ Active</div>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${waitingDispatch.length > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <div className={`text-xl font-black ${waitingDispatch.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{waitingDispatch.length}</div>
                    <div className="text-xs text-gray-500 mt-0.5">รอจ่ายงาน</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-black text-blue-600">{ridersOnline.length} / {ridersActive.length}</div>
                    <div className="text-xs text-gray-500 mt-0.5">ไรเดอร์ Online / Active</div>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${pendingCount > 0 ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                    <div className={`text-xl font-black ${pendingCount > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{pendingCount}</div>
                    <div className="text-xs text-gray-500 mt-0.5">รออนุมัติ</div>
                  </div>
                </div>
                {alerts.length > 0 && (
                  <div className="space-y-1">
                    {alerts.map((a, i) => (
                      <div key={i} className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-1.5 text-yellow-800 font-semibold">{a}</div>
                    ))}
                  </div>
                )}
                {alerts.length === 0 && (
                  <div className="text-xs text-green-700 font-semibold bg-green-50 rounded-lg px-3 py-1.5">✅ ระบบทำงานปกติ ไม่มีการแจ้งเตือน</div>
                )}
              </div>
            );
          })()}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="กำไร GP สุทธิ (จบแล้ว)" value={`฿${totalGP.toLocaleString()}`}       color="green"  icon={DollarSign} />
            <StatCard label="GMV (ออเดอร์จบแล้ว)"  value={`฿${gmv.toLocaleString()}`}           color="blue"   icon={TrendingUp} />
            <StatCard label="ออเดอร์ทั้งหมด"       value={orders.length}                        color="orange" icon={ShoppingBag} />
            <StatCard label="ไรเดอร์ Active"        value={riders.filter(r => r.status === 'active').length} color="purple" icon={Bike} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="ออเดอร์วันนี้ (ทั้งหมด)" value={todayOrders.length}               color="orange" icon={ShoppingBag} />
            <StatCard label="GMV วันนี้ (จบแล้ว)"    value={`฿${todayGMV.toLocaleString()}`}  color="blue"   icon={DollarSign} />
            <StatCard label="GP วันนี้ (จบแล้ว)"     value={`฿${todayGP.toLocaleString()}`}   color="green"  icon={TrendingUp} />
            <StatCard label="ร้านค้าทั้งหมด"         value={restaurants.length}               color="purple" icon={ChefHat} />
          </div>
          {/* ── กระเป๋าเงิน Admin (GP สะสม) ───────────────────────────────── */}
          {(() => {
            const adminBal = userWallet ?? 0;
            const rawHistory = walletHistory?.length ? walletHistory : [];
            const displayHistory = [...rawHistory].sort((a, b) => {
              const ms = (e) => e.createdAtMs || parseInt(((e.id || '').match(/\d{10,}/) || ['0'])[0], 10);
              return ms(b) - ms(a);
            });
            return (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                <div className="p-4 border-b bg-green-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet size={18} className="text-green-600" />
                    <h2 className="font-bold text-gray-700">กระเป๋าเงิน Admin — Platform GP</h2>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">฿{adminBal.toLocaleString()}</div>
                    <div className="text-xs text-gray-400">{displayHistory.length} รายการ</div>
                  </div>
                </div>
                {displayHistory.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    <Wallet size={36} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">ยังไม่มีประวัติธุรกรรม</p>
                    <p className="text-xs mt-1">GP จะถูก Credit อัตโนมัติเมื่อออเดอร์ส่งสำเร็จ</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-60">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                        <tr>
                          <th className="p-3 text-left">วันที่ / รายการ</th>
                          <th className="p-3 text-right">จำนวน</th>
                          <th className="p-3 text-right">คงเหลือ (ประมาณ)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {displayHistory.slice(0, 50).map((h, i) => {
                          const label   = h.desc || h.description || '';
                          const dateStr = h.createdAtMs ? formatDateTimeFromMs(h.createdAtMs) : (h.date || '');
                          const amt     = h.amount ?? 0;
                          const balAfter = null;
                          return (
                            <tr key={h.id || i} className="hover:bg-gray-50">
                              <td className="p-3">
                                <div className="text-xs text-gray-400">{dateStr}</div>
                                <div className="text-xs text-gray-700">{label}</div>
                              </td>
                              <td className={`p-3 text-right font-bold text-sm ${amt > 0 ? 'text-green-600' : amt < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                {amt > 0 ? '+' : amt < 0 ? '-' : ''}฿{Math.abs(amt).toLocaleString()}
                              </td>
                              <td className="p-3 text-right text-xs text-gray-400">
                                {balAfter != null ? `฿${Number(balAfter).toLocaleString()}` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center gap-2"><ShoppingBag size={16} className="text-gray-500" /><h2 className="font-bold text-gray-700">รายการธุรกรรมล่าสุด</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-4">ID / เวลา</th>
                    <th className="p-4">ลูกค้า</th>
                    <th className="p-4">ร้านค้า/บริการ</th>
                    <th className="p-4">ไรเดอร์</th>
                    <th className="p-4">สถานะ</th>
                    <th className="p-4 text-right">ยอดรวม</th>
                    <th className="p-4 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...orders].sort((a, b) => {
                    const tsA = parseInt((a.id || '').split('-')[0], 10) || 0;
                    const tsB = parseInt((b.id || '').split('-')[0], 10) || 0;
                    return tsB - tsA;
                  }).slice(0, 50).map(order => {
                    const rider = riders.find(r => r.id === order.riderId);
                    const restaurant = restaurants.find(r => r.id === order.restaurantId);
                    return (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="p-4"><div className="font-mono font-bold text-gray-700 text-xs">{order.id}</div><div className="text-xs text-gray-400">{order.createdAt || order.timestamp}</div></td>
                        <td className="p-4"><div className="font-bold text-sm">{order.customerName}</div><div className="text-xs text-gray-400 flex items-center mt-0.5"><Phone size={10} className="mr-1" /> {order.customerPhone || '-'}</div></td>
                        <td className="p-4">
                          {order.type === 'food'
                            ? <><div className="font-bold text-sm">{order.restaurantName}</div><div className="text-xs text-gray-400 flex items-center"><Phone size={10} className="mr-1" /> {restaurant?.phone || '-'}</div></>
                            : <div className="font-bold text-blue-600 text-sm">ส่งพัสดุ</div>}
                        </td>
                        <td className="p-4">
                          {rider
                            ? <><div className="font-bold text-sm">{rider.name}</div><div className="text-xs text-gray-400">{rider.phone}</div></>
                            : <span className="text-gray-400 italic text-xs">รอรับงาน</span>}
                        </td>
                        <td className="p-4">
                          <span className={`text-xs px-2 py-1 rounded-full border ${STATUS_LABELS[order.status]?.bg || 'bg-gray-100'} ${STATUS_LABELS[order.status]?.color || 'text-gray-500'}`}>
                            {STATUS_LABELS[order.status]?.label || order.status}
                          </span>
                          {order.status === 'cancelled' && <div className="text-xs text-red-400 mt-1">{order.cancelReason}</div>}
                          {order.paymentMethod === 'cash' && <div className="text-xs text-blue-600 mt-1 font-bold">COD</div>}
                        </td>
                        <td className="p-4 text-right font-bold">฿{(order.grandTotal || 0).toLocaleString()}</td>
                        <td className="p-4 text-right">
                          {!['cancelled', 'delivered', 'completed'].includes(order.status) && (
                            <button onClick={() => initiateCancelOrder(order.id)} className="text-red-500 hover:bg-red-50 text-xs px-2 py-1 rounded border border-red-200">ยกเลิก</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {orders.length === 0 && (
                isDataLoading ? (
                  <div className="p-6 space-y-2">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="flex gap-3 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-1/6" />
                        <div className="h-4 bg-gray-200 rounded w-1/4" />
                        <div className="h-4 bg-gray-200 rounded w-1/5" />
                        <div className="h-4 bg-gray-200 rounded w-1/6" />
                        <div className="h-4 bg-gray-200 rounded w-1/8" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-10 text-center text-gray-400">ยังไม่มีออเดอร์</div>
                )
              )}
            </div>
          </div>
        </>
      )}

      {/* ── ANALYTICS ─────────────────────────────────────────────────── */}
      {adminTab === 'analytics' && (
        <div className="space-y-6">
          {/* Status breakdown */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-700"><BarChart2 size={20} className="text-green-600" /> สถานะออเดอร์ทั้งหมด</h2>
            {Object.entries(STATUS_LABELS).map(([status, meta]) => (
              <SimpleBar
                key={status}
                label={meta.label}
                value={statusCount[status] || 0}
                max={orders.length || 1}
                color={status === 'completed' || status === 'delivered' ? '#22c55e' : status === 'cancelled' ? '#ef4444' : '#3b82f6'}
              />
            ))}
          </div>

          {/* Revenue by type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-orange-600"><ChefHat size={20} /> Top ร้านค้า (ออเดอร์)</h2>
              {topRestaurants.length === 0 ? <p className="text-gray-400 text-sm">ยังไม่มีข้อมูล</p> : (
                topRestaurants.map(r => (
                  <SimpleBar key={r.id} label={r.name} value={r.cnt} max={maxRestCnt} color="#f97316" />
                ))
              )}
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-blue-600"><Bike size={20} /> Top ไรเดอร์ (งานส่งสำเร็จ)</h2>
              {topRiders.length === 0 ? <p className="text-gray-400 text-sm">ยังไม่มีข้อมูล</p> : (
                topRiders.map(r => (
                  <SimpleBar key={r.id} label={r.name} value={r.cnt} max={maxRiderCnt} color="#3b82f6" />
                ))
              )}
            </div>
          </div>

          {/* Revenue breakdown */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-700"><DollarSign size={20} className="text-green-600" /> รายได้แยกประเภท</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(() => {
                // นับเฉพาะ orders ที่จบแล้ว (ไม่นับยกเลิก/กำลังดำเนินการ)
                const doneStatus = ['completed', 'delivered'];
                const food   = orders.filter(o => o.type === 'food'   && doneStatus.includes(o.status));
                const parcel = orders.filter(o => o.type === 'parcel' && doneStatus.includes(o.status));
                const allFood   = orders.filter(o => o.type === 'food');
                const allParcel = orders.filter(o => o.type === 'parcel');
                const foodGMV   = food.reduce((s, o) => s + (o.grandTotal || 0), 0);
                const parcelGMV = parcel.reduce((s, o) => s + (o.grandTotal || 0), 0);
                const foodGP    = food.reduce((s, o) => s + (o.adminGP || 0), 0);
                const parcelGP  = parcel.reduce((s, o) => s + (o.adminGP || 0), 0);
                return (
                  <>
                    <div className="bg-orange-50 p-4 rounded-xl text-center"><p className="text-xs text-orange-600 font-medium">อาหาร GMV (จบแล้ว)</p><p className="text-xl font-bold text-orange-700">฿{foodGMV.toLocaleString()}</p><p className="text-xs text-gray-400">{food.length}/{allFood.length} ออเดอร์</p></div>
                    <div className="bg-orange-50 p-4 rounded-xl text-center"><p className="text-xs text-orange-600 font-medium">GP จากอาหาร</p><p className="text-xl font-bold text-orange-700">฿{foodGP.toLocaleString()}</p><p className="text-xs text-gray-400">หลังหักส่วนลด</p></div>
                    <div className="bg-blue-50 p-4 rounded-xl text-center"><p className="text-xs text-blue-600 font-medium">พัสดุ GMV (จบแล้ว)</p><p className="text-xl font-bold text-blue-700">฿{parcelGMV.toLocaleString()}</p><p className="text-xs text-gray-400">{parcel.length}/{allParcel.length} ออเดอร์</p></div>
                    <div className="bg-blue-50 p-4 rounded-xl text-center"><p className="text-xs text-blue-600 font-medium">GP จากพัสดุ</p><p className="text-xl font-bold text-blue-700">฿{parcelGP.toLocaleString()}</p><p className="text-xs text-gray-400">หลังหักส่วนลด</p></div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* ── Wallet ทั้งระบบ ──────────────────────────────────────────── */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-purple-50 flex items-center justify-between">
              <h2 className="font-bold text-gray-700 flex items-center gap-2">
                <Wallet size={18} className="text-purple-600" /> Wallet ทั้งระบบ
              </h2>
              <div className="flex items-center gap-3">
                {walletRows.length > 0 && (
                  <span className="text-xs text-gray-400">{walletRows.length} กระเป๋า · รวม ฿{walletRows.reduce((s,r)=>s+r.balance,0).toLocaleString('th-TH',{minimumFractionDigits:2})}</span>
                )}
                <button onClick={loadWalletOverview} className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-lg font-bold hover:bg-purple-200">
                  รีเฟรช
                </button>
              </div>
            </div>

            {walletOverviewLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm animate-pulse">กำลังโหลด wallet...</div>
            ) : walletRows.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">ยังไม่มีข้อมูล wallet</div>
            ) : (
              <div className="divide-y max-h-[480px] overflow-y-auto">
                {walletRows.map(row => {
                  const isExpanded = walletExpanded === row.uid;
                  const roleCls = r => r === 'admin' ? 'bg-red-100 text-red-700' : r === 'merchant' ? 'bg-orange-100 text-orange-700' : r === 'rider' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500';
                  const gpEntries = row.history.filter(e => (e.desc||'').toLowerCase().includes('gp'));
                  const totalGP   = gpEntries.reduce((s,e)=>s+(e.amount||0), 0);
                  return (
                    <div key={row.uid}>
                      <div
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setWalletExpanded(isExpanded ? null : row.uid)}
                      >
                        {/* avatar */}
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(row.name||'?')[0].toUpperCase()}
                        </div>
                        {/* name + roles */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-sm text-gray-800 truncate">{row.name}</span>
                            {row.roles.map(r => (
                              <span key={r} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${roleCls(r)}`}>{r}</span>
                            ))}
                          </div>
                          <div className="text-[11px] text-gray-400 truncate">{row.email}</div>
                        </div>
                        {/* GP badge */}
                        {totalGP > 0 && (
                          <div className="text-[11px] text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded shrink-0">
                            GP +฿{totalGP.toLocaleString()}
                          </div>
                        )}
                        {/* balance */}
                        <span className={`text-sm font-bold shrink-0 ml-1 ${row.balance < 0 ? 'text-red-600' : row.balance > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                          ฿{row.balance.toLocaleString('th-TH',{minimumFractionDigits:2})}
                        </span>
                        <span className="text-gray-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>

                      {/* Expanded history */}
                      {isExpanded && (
                        <div className="bg-gray-50 border-t px-4 py-3 space-y-1.5 max-h-60 overflow-y-auto">
                          {row.history.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-2">ไม่มีประวัติธุรกรรม</p>
                          ) : (
                            row.history.slice(0, 50).map((e, i) => (
                              <div key={e.id || i} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${(e.amount||0)>=0?'bg-green-500':'bg-red-400'}`} />
                                  <span className="text-gray-600 truncate">{e.desc || '-'}</span>
                                  {e.refOrderId && (
                                    <span className="text-gray-300 shrink-0 font-mono">#{e.refOrderId.slice(-6)}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className={`font-bold ${(e.amount||0)>=0?'text-green-600':'text-red-500'}`}>
                                    {(e.amount||0)>=0?'+':''}{(e.amount||0).toLocaleString('th-TH',{minimumFractionDigits:2})}
                                  </span>
                                  <span className="text-gray-300 text-[10px]">{(e.date||'').slice(0,16)}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── GP เข้า Admin ────────────────────────────────────────────── */}
          {(() => {
            const gpHistory = walletHistory.filter(e => (e.desc||'').toLowerCase().includes('gp'));
            const totalGP   = gpHistory.reduce((s,e) => s + (e.amount||0), 0);
            if (gpHistory.length === 0) return null;
            return (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b bg-green-50 flex items-center justify-between">
                  <h2 className="font-bold text-gray-700 flex items-center gap-2">
                    <TrendingUp size={18} className="text-green-600" /> GP เข้า Admin
                  </h2>
                  <span className="text-lg font-bold text-green-600">+฿{totalGP.toLocaleString('th-TH',{minimumFractionDigits:2})}</span>
                </div>
                <div className="divide-y max-h-64 overflow-y-auto">
                  {gpHistory.slice(0,100).map((e, i) => (
                    <div key={e.id||i} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-700 truncate">{e.desc}</div>
                        <div className="text-[11px] text-gray-400">
                          {e.date || ''}
                          {e.refOrderId && <span className="ml-2 font-mono text-gray-300">#{e.refOrderId.slice(-6)}</span>}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-green-600 shrink-0">+฿{(e.amount||0).toLocaleString('th-TH',{minimumFractionDigits:2})}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── APPROVALS ─────────────────────────────────────────────────── */}
      {adminTab === 'approvals' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b"><h2 className="font-bold text-xl flex items-center gap-2"><Bell className="text-green-600" /> รายการรออนุมัติ ({pendingRequests.length})</h2></div>
          {pendingRequests.length === 0 ? (
            isDataLoading ? (
              <div className="divide-y">
                {[1, 2].map(i => (
                  <div key={i} className="p-6 animate-pulse">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-1/3" />
                        <div className="h-3 bg-gray-200 rounded w-1/2" />
                        <div className="h-3 bg-gray-200 rounded w-2/5" />
                      </div>
                      <div className="flex gap-2">
                        <div className="h-9 w-20 bg-gray-200 rounded-lg" />
                        <div className="h-9 w-20 bg-gray-200 rounded-lg" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-gray-400"><Check size={40} className="mx-auto mb-2 text-green-400 opacity-40" />ไม่มีรายการรออนุมัติ</div>
            )
          ) : (
            <div className="divide-y">
              {pendingRequests.map(req => (
                <div key={req.id} className="p-6 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          req.type === 'cancel_order'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>{
                          req.type === 'cancel_order'   ? '🚫 ขอยกเลิกออเดอร์'  :
                          req.type === 'topup'          ? '💰 เติมเงิน'          :
                          req.type === 'withdraw'       ? '💸 ถอนเงิน'           :
                          req.type === 'merchant_reg'   ? '🏪 สมัครร้านค้า'      :
                          req.type === 'rider_reg'      ? '🛵 สมัครไรเดอร์'      :
                          req.type
                        }</span>
                        <span className="text-xs text-gray-400">{req.timestamp}</span>
                      </div>
                      <div className="font-bold text-gray-800 mb-1">
                        {req.type === 'cancel_order'
                          ? `ขอยกเลิก #${req.data.orderId?.slice(-8)} — ${req.data.orderType === 'parcel' ? '📦 ส่งพัสดุ' : `🍜 ${req.data.restaurantName}`}`
                          : req.type === 'withdraw'
                            ? `แจ้งถอนเงิน: ฿${Number(req.data.amount).toLocaleString()}`
                            : (req.data.shopName ? `ร้าน: ${req.data.shopName}` : req.data.realName ? `ผู้สมัคร: ${req.data.realName}` : `฿${req.data.amount}`)}
                      </div>
                      {/* cancel_order details */}
                      {req.type === 'cancel_order' && (
                        <div className="mt-2 bg-red-50 border border-red-100 rounded-lg p-3 space-y-1.5">
                          <p className="text-sm text-gray-700">
                            <span className="text-gray-400 text-xs">เหตุผล: </span>
                            <strong className="text-red-700">{req.data.reason}</strong>
                          </p>
                          <p className="text-sm text-gray-700">
                            <span className="text-gray-400 text-xs">สถานะออเดอร์ตอนขอ: </span>
                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{req.data.prevStatus}</span>
                          </p>
                          <p className="text-sm text-gray-700">
                            <span className="text-gray-400 text-xs">ยอดเงิน: </span>
                            <strong>฿{(req.data.grandTotal || 0).toLocaleString()}</strong>
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded font-semibold bg-gray-100 text-gray-600">
                              {req.data.paymentMethod === 'wallet' ? '👛 Wallet' : '💵 เงินสด'}
                            </span>
                          </p>
                          {req.data.paymentMethod === 'wallet' && req.data.grandTotal > 0 && (
                            <p className="text-xs text-orange-600 font-semibold bg-orange-50 px-2 py-1 rounded border border-orange-200">
                              ⚠️ อนุมัติ = คืนเงิน ฿{(req.data.grandTotal || 0).toLocaleString()} เข้า Wallet ลูกค้า
                            </p>
                          )}
                          {req.data.paymentMethod === 'cash' && (
                            <p className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                              ✅ ชำระเงินสด — ไม่ต้องคืนเงิน
                            </p>
                          )}
                        </div>
                      )}
                      {req.type === 'withdraw' && (
                        <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 mt-1">
                          <p>ธนาคาร: <strong>{req.data.bank || '—'}</strong></p>
                          <p>เลขบัญชี: <strong>{req.data.accountNumber || req.data.account || '—'}</strong></p>
                          <p>ชื่อบัญชี: <strong>{req.data.accountName || req.data.name || '—'}</strong></p>
                        </div>
                      )}
                      {req.type === 'topup' && (req.data.bank || req.data.accountName || req.data.accountNumber) && (
                        <div className="text-sm text-gray-600 bg-blue-50 p-2 rounded border border-blue-100 mt-1">
                          {req.data.bank && <p>โอนจากธนาคาร: <strong>{req.data.bank}</strong></p>}
                          {(req.data.accountName || req.data.name) && <p>ชื่อบัญชี: <strong>{req.data.accountName || req.data.name}</strong></p>}
                          {(req.data.accountNumber || req.data.account) && <p>เลขบัญชี: <strong>{req.data.accountNumber || req.data.account}</strong></p>}
                        </div>
                      )}
                      {req.type === 'topup' && req.data.slipImage && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-500 mb-1">สลิปโอนเงิน:</p>
                          {req.data.slipImage.startsWith('data:') || req.data.slipImage.startsWith('http') ? (
                            <img src={req.data.slipImage} alt="slip" className="w-24 h-24 object-cover rounded cursor-pointer border hover:border-blue-500" onClick={() => openImagePreview(req.data.slipImage)} />
                          ) : (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">{req.data.slipImage}</span>
                          )}
                        </div>
                      )}
                      {(req.type === 'merchant_reg' || req.type === 'rider_reg') && (
                        <div className="text-sm text-gray-600 mt-2 space-y-0.5">
                          <p>ชื่อจริง: {req.data.realName}</p>
                          <p>เลขบัตร: {req.data.idCard}</p>
                          <p>เบอร์: {req.data.phone}</p>
                          <p>บัญชี: {req.data.bankName} – {req.data.bankAccount}</p>
                          {req.data.idCardImage && (
                            req.data.idCardImage.startsWith('data:') || req.data.idCardImage.startsWith('http') ? (
                              <button onClick={() => openImagePreview(req.data.idCardImage)} className="text-blue-500 text-xs underline flex items-center gap-1 mt-1"><FileBadge size={12} /> ดูบัตรประชาชน</button>
                            ) : (
                              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded block mt-1">✓ แนบบัตรประชาชนแล้ว (ไฟล์ขนาดใหญ่)</span>
                            )
                          )}
                          {req.data.shopImage && (
                            req.data.shopImage.startsWith('data:') || req.data.shopImage.startsWith('http') ? (
                              <button onClick={() => openImagePreview(req.data.shopImage)} className="text-blue-500 text-xs underline flex items-center gap-1 mt-1"><ImageIcon size={12} /> ดูรูปหน้าร้าน</button>
                            ) : (
                              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded block mt-1">✓ แนบรูปหน้าร้านแล้ว (ไฟล์ขนาดใหญ่)</span>
                            )
                          )}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-2">โดย: {req.user}</div>
                      {(req.type === 'topup' || req.type === 'withdraw') && (() => {
                        const walletEntry = globalWallets[req.userId];
                        return (
                          <div className="text-xs font-bold mt-1">
                            {walletEntry == null ? (
                              <span className="text-gray-400 animate-pulse">กำลังโหลดยอด Wallet…</span>
                            ) : (
                              <span className={`${req.type === 'withdraw' && walletEntry.balance < Number(req.data.amount) ? 'text-red-600' : 'text-blue-600'}`}>
                                ยอด Wallet ปัจจุบัน: ฿{walletEntry.balance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                {req.type === 'withdraw' && walletEntry.balance < Number(req.data.amount) && (
                                  <span className="ml-1 text-red-500 font-bold"> ⚠️ ยอดไม่พอ</span>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          if (approvingId) return;
                          setApprovingId(req.id);
                          try { await handleApproveRequest(req); } finally { setApprovingId(null); }
                        }}
                        disabled={!!approvingId}
                        className={`flex items-center gap-1 px-4 py-2 rounded-lg font-bold text-sm ${approvingId === req.id ? 'bg-green-300 text-white cursor-not-allowed' : approvingId ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
                      >
                        {approvingId === req.id ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> กำลังอนุมัติ...</> : <><Check size={16} /> อนุมัติ</>}
                      </button>
                      <button onClick={() => initiateRejectRequest(req.id)} disabled={!!approvingId} className={`flex items-center gap-1 px-4 py-2 rounded-lg font-bold text-sm ${approvingId ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}><XCircle size={16} /> ปฏิเสธ</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* ── USERS ─────────────────────────────────────────────────────── */}
      {adminTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center gap-2">
              <Users size={18} className="text-blue-600" />
              <h2 className="font-bold text-gray-700">ผู้ใช้ที่ลงทะเบียน ({allUsers.length})</h2>
            </div>
            {allUsers.length === 0 ? (
              <div className="p-10 text-center text-gray-400">
                <Users size={40} className="mx-auto mb-2 opacity-20" />
                <p>ไม่มีผู้ใช้</p>
              </div>
            ) : (
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {allUsers.map(user => (
                  <div key={user.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {(user.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-gray-800">{user.name}</span>
                            {user.banned && <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold">Banned</span>}
                            {user.roles?.map(r => (
                              <span key={r} className={`text-xs px-2 py-0.5 rounded-full font-bold ${r === 'admin' ? 'bg-red-100 text-red-700' : r === 'merchant' ? 'bg-orange-100 text-orange-700' : r === 'rider' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r}</span>
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">{user.email || user.phone || 'ไม่มีข้อมูล'}</div>
                          <div className="text-sm font-bold text-green-600 mt-0.5">Wallet: ฿{(user.walletBalance || 0).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => {
                            const next = adjustUserId === user.id ? null : user.id;
                            setAdjustUserId(next);
                            if (next) loadUserWalletEntries(next);
                          }}
                          className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg font-bold hover:bg-green-200"
                        >
                          <Wallet size={12} className="inline mr-1" /> Wallet
                        </button>
                        <button
                          onClick={() => { adminBanUser(user.id); setAllUsers(prev => prev.map(u => u.id === user.id ? { ...u, banned: !u.banned } : u)); }}
                          className={`text-xs px-3 py-1.5 rounded-lg font-bold ${user.banned ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                        >
                          {user.banned ? 'ปลดแบน' : 'แบน'}
                        </button>
                        <button
                          onClick={() => { setResetPwdUserId(resetPwdUserId === user.id ? null : user.id); setResetPwdValue(''); }}
                          className="text-xs bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg font-bold hover:bg-purple-200"
                        >รีเซ็ต PW</button>
                      </div>
                    </div>

                    {/* Role management */}
                    {!user.roles?.includes('admin') && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {['merchant', 'rider'].map(role => {
                          const has = user.roles?.includes(role);
                          return (
                            <button
                              key={role}
                              onClick={() => {
                                if (has) {
                                  revokeRole(user.id, role);
                                  setAllUsers(prev => prev.map(u => u.id === user.id ? { ...u, roles: u.roles.filter(r => r !== role) } : u));
                                } else {
                                  grantRole(user.id, role);
                                  setAllUsers(prev => prev.map(u => u.id === user.id ? { ...u, roles: [...(u.roles || []), role] } : u));
                                }
                              }}
                              className={`text-[11px] px-2.5 py-1 rounded-lg font-bold transition-all ${has ? 'bg-orange-200 text-orange-800 hover:bg-red-100 hover:text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-orange-100 hover:text-orange-700'}`}
                            >
                              {has ? `✓ ${role}` : `+ ${role}`}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Reset password panel */}
                    {resetPwdUserId === user.id && (
                      <div className="mt-3 bg-purple-50 p-3 rounded-lg border border-purple-200 animate-fade-in">
                        <p className="text-xs font-bold text-purple-700 mb-1">รีเซ็ตรหัสผ่านของ {user.name}</p>
                        <p className="text-xs text-gray-500 mb-3">ระบบจะส่งลิงก์รีเซ็ตรหัสผ่านไปยัง <strong>{user.email}</strong> ทางอีเมล</p>
                        <div className="flex gap-2">
                          <button onClick={() => { setResetPwdUserId(null); setResetPwdValue(''); }} className="flex-1 bg-gray-200 py-2 rounded text-sm">ยกเลิก</button>
                          <button onClick={handleResetPassword} className="flex-1 bg-purple-600 text-white py-2 rounded text-sm font-bold">ส่งอีเมลรีเซ็ต</button>
                        </div>
                      </div>
                    )}

                    {/* Wallet adjust panel */}
                    {adjustUserId === user.id && (
                      <div className="mt-3 bg-gray-50 p-3 rounded-lg border border-gray-200 animate-fade-in space-y-3">
                        <p className="text-xs font-bold text-gray-600">ปรับยอด Wallet ของ {user.name}</p>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            placeholder="จำนวนเงิน (ใส่ - เพื่อหัก)"
                            value={adjustAmount}
                            onChange={e => setAdjustAmount(e.target.value)}
                            className="flex-1 border p-2 rounded text-sm"
                          />
                          <input
                            type="text"
                            placeholder="คำอธิบาย"
                            value={adjustDesc}
                            onChange={e => setAdjustDesc(e.target.value)}
                            className="flex-1 border p-2 rounded text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setAdjustUserId(null)} className="flex-1 bg-gray-200 py-2 rounded text-sm">ยกเลิก</button>
                          <button onClick={handleAdjust} className="flex-1 bg-green-600 text-white py-2 rounded text-sm font-bold">ยืนยัน</button>
                        </div>

                        {/* Wallet history */}
                        <div className="border-t pt-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-gray-600">ประวัติธุรกรรม</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => loadUserWalletEntries(user.id)}
                                className="text-[10px] bg-blue-100 text-blue-600 px-2 py-1 rounded font-bold hover:bg-blue-200"
                              >รีเฟรช</button>
                              {(userWalletEntries[user.id] || []).length > 0 && (
                                <button
                                  onClick={() => handleClearUserWalletHistory(user.id, user.name)}
                                  className="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded font-bold hover:bg-red-200"
                                >ล้างประวัติ</button>
                              )}
                            </div>
                          </div>
                          {userWalletLoading[user.id] ? (
                            <p className="text-xs text-gray-400 text-center py-3">กำลังโหลด...</p>
                          ) : (userWalletEntries[user.id] || []).length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-2">ยังไม่มีประวัติธุรกรรม</p>
                          ) : (
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                              {[...(userWalletEntries[user.id] || [])].sort((a, b) => {
                                const ms = (e) => e.createdAtMs || parseInt(((e.id || '').match(/\d{10,}/) || ['0'])[0], 10);
                                return ms(b) - ms(a);
                              }).map((entry, idx) => {
                                const amt = entry.amount ?? 0;
                                return (
                                  <div key={entry.id || idx} className="flex justify-between items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100 text-xs">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold text-gray-700 truncate">{entry.desc || '—'}</div>
                                      <div className="text-gray-400 text-[10px]">{entry.createdAtMs ? formatDateTimeFromMs(entry.createdAtMs) : (entry.date || '')}</div>
                                    </div>
                                    <span className={`font-bold flex-shrink-0 ${amt >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {amt >= 0 ? '+' : ''}฿{Math.abs(amt).toLocaleString()}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MANAGEMENT ────────────────────────────────────────────────── */}
      {adminTab === 'management' && (
        <div className="space-y-6">
          {/* Restaurants */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-orange-600"><ChefHat size={20} /> จัดการร้านค้า ({restaurants.length})</h2>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {restaurants.map(rest => (
                <div key={rest.id} className="border rounded-xl p-3">
                  {editingShop === rest.id ? (
                    <div className="space-y-2">
                      <input value={shopEditForm.name || ''} onChange={e => setShopEditForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่อร้าน" className="w-full border p-2 rounded text-sm" />
                      <input value={shopEditForm.phone || ''} onChange={e => setShopEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="เบอร์โทร" className="w-full border p-2 rounded text-sm" />
                      <select value={shopEditForm.category || ''} onChange={e => setShopEditForm(f => ({ ...f, category: e.target.value }))} className="w-full border p-2 rounded text-sm">
                        {['Street Food', 'Fast Food', 'Japanese', 'Italian', 'Dessert', 'Thai'].map(c => <option key={c}>{c}</option>)}
                      </select>
                      <input value={shopEditForm.time || ''} onChange={e => setShopEditForm(f => ({ ...f, time: e.target.value }))} placeholder="เวลาจัดส่ง เช่น 20-30 min" className="w-full border p-2 rounded text-sm" />
                      <div className="flex gap-2">
                        <button onClick={() => setEditingShop(null)} className="flex-1 bg-gray-200 py-2 rounded text-sm font-bold">ยกเลิก</button>
                        <button onClick={saveShopEdit} className="flex-1 bg-green-600 text-white py-2 rounded text-sm font-bold">บันทึก</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3 flex-1 min-w-0">
                        <img src={rest.image} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" alt={rest.name} />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm truncate">{rest.name}</div>
                          <div className="text-xs text-gray-500">{rest.category} · {rest.phone}</div>
                          <div className={`text-xs font-bold mt-0.5 ${rest.status === 'open' ? 'text-green-600' : rest.status === 'banned' ? 'text-red-600' : 'text-gray-500'}`}>
                            {rest.status === 'open' ? '● เปิดอยู่' : rest.status === 'banned' ? '● แบนแล้ว' : '● ปิดอยู่'}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 ml-2 shrink-0">
                        <button onClick={() => { setEditingShop(rest.id); setShopEditForm({ name: rest.name, phone: rest.phone, category: rest.category, time: rest.time }); }} className="p-1.5 bg-blue-100 text-blue-600 rounded" title="แก้ไข"><Edit size={14} /></button>
                        <button onClick={() => toggleRestaurantStatus(rest.id, 'toggle_open')} className={`p-1.5 rounded ${rest.status === 'open' ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-600'}`} title="เปิด/ปิด"><Power size={14} /></button>
                        <button onClick={() => toggleRestaurantStatus(rest.id, 'ban')} className={`p-1.5 rounded ${rest.status === 'banned' ? 'bg-red-500 text-white' : 'bg-red-100 text-red-600'}`} title="แบน"><Ban size={14} /></button>
                        <button onClick={() => { if (window.confirm(`ลบร้าน "${rest.name}" ออกจากระบบถาวร?`)) deleteRestaurant(rest.id); }} className="p-1.5 bg-gray-800 text-white rounded hover:bg-red-700 transition-colors" title="ลบร้านค้า"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {restaurants.length === 0 && <p className="text-gray-400 text-center py-8">ยังไม่มีร้านค้าในระบบ</p>}
            </div>
          </div>

          {/* Riders */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-blue-600"><Bike size={20} /> จัดการไรเดอร์ ({riders.length})</h2>
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
              {riders.map(rider => (
                <div key={rider.id} className="flex justify-between items-center border rounded-xl p-3">
                  <div>
                    <div className="font-bold text-sm">{rider.name}</div>
                    <div className="text-xs text-gray-500">{rider.phone}</div>
                    <div className={`text-xs font-bold mt-0.5 ${rider.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                      {rider.status === 'active' ? '● Active' : '● Banned'}
                    </div>
                  </div>
                  <button onClick={() => toggleRiderBan(rider.id)} className={`px-4 py-2 rounded-lg text-sm font-bold ${rider.status === 'banned' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {rider.status === 'banned' ? 'ปลดแบน' : 'แบน'}
                  </button>
                </div>
              ))}
              {riders.length === 0 && <p className="text-gray-400 text-center py-8">ยังไม่มีไรเดอร์ในระบบ</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── PROMOTIONS ────────────────────────────────────────────────── */}
      {adminTab === 'promotions' && (
        <div className="space-y-6">
          {/* Create promo */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-purple-600"><PlusCircle size={20} /> สร้างโค้ดส่วนลดใหม่</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">โค้ดส่วนลด <span className="text-red-500">*</span></label><input value={promoForm.code} onChange={e => setPromoForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="เช่น BOOM50" className="w-full border p-2 rounded-lg font-mono uppercase" maxLength={20} /></div>
              <div><label className="block text-sm font-medium mb-1">คำอธิบาย</label><input value={promoForm.description} onChange={e => setPromoForm(f => ({ ...f, description: e.target.value }))} placeholder="เช่น ส่วนลด 10% สำหรับออเดอร์แรก" className="w-full border p-2 rounded-lg" /></div>
              <div>
                <label className="block text-sm font-medium mb-1">ประเภทส่วนลด</label>
                <select value={promoForm.type} onChange={e => setPromoForm(f => ({ ...f, type: e.target.value }))} className="w-full border p-2 rounded-lg">
                  <option value="percent">เปอร์เซ็นต์ (%)</option>
                  <option value="fixed">จำนวนเงิน (฿)</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">มูลค่า ({promoForm.type === 'percent' ? '%' : '฿'})</label><input type="number" value={promoForm.value} onChange={e => setPromoForm(f => ({ ...f, value: e.target.value }))} className="w-full border p-2 rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">ยอดขั้นต่ำ (฿)</label><input type="number" value={promoForm.minOrder} onChange={e => setPromoForm(f => ({ ...f, minOrder: e.target.value }))} className="w-full border p-2 rounded-lg" /></div>
              {promoForm.type === 'percent' && <div><label className="block text-sm font-medium mb-1">ส่วนลดสูงสุด (฿)</label><input type="number" value={promoForm.maxDiscount} onChange={e => setPromoForm(f => ({ ...f, maxDiscount: e.target.value }))} className="w-full border p-2 rounded-lg" /></div>}
              <div><label className="block text-sm font-medium mb-1">จำนวนครั้งที่ใช้ได้</label><input type="number" value={promoForm.maxUses} onChange={e => setPromoForm(f => ({ ...f, maxUses: e.target.value }))} className="w-full border p-2 rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">หมดอายุ</label><input type="date" value={promoForm.expiry} onChange={e => setPromoForm(f => ({ ...f, expiry: e.target.value }))} className="w-full border p-2 rounded-lg" /></div>
            </div>
            <button onClick={handleCreatePromo} className="mt-4 bg-purple-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-purple-700 flex items-center gap-2">
              <PlusCircle size={18} /> สร้างโค้ด
            </button>
          </div>

          {/* Promo list */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50"><h2 className="font-bold text-gray-700">โค้ดทั้งหมด ({promoCodes.length})</h2></div>
            {promoCodes.length === 0 ? (
              <div className="p-10 text-center text-gray-400"><Tag size={36} className="mx-auto mb-2 opacity-20" />ยังไม่มีโค้ดส่วนลด</div>
            ) : (
              <div className="divide-y">
                {promoCodes.map(promo => (
                  <div key={promo.id} className="p-4 hover:bg-gray-50 flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-purple-700 bg-purple-50 px-3 py-1 rounded-lg text-sm">{promo.code}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${promo.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {promo.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mt-1">{promo.description || '-'}</div>
                      <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                        <span>ส่วนลด: <strong>{promo.type === 'percent' ? `${promo.value}%` : `฿${promo.value}`}</strong></span>
                        {promo.minOrder > 0 && <span>ขั้นต่ำ: <strong>฿{promo.minOrder}</strong></span>}
                        {promo.type === 'percent' && promo.maxDiscount < 9999 && <span>สูงสุด: <strong>฿{promo.maxDiscount}</strong></span>}
                        <span>ใช้แล้ว: <strong>{promo.usedCount || 0}/{promo.maxUses}</strong></span>
                        {promo.expiry && <span>หมดอายุ: <strong>{promo.expiry}</strong></span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => togglePromoCode(promo.id)} className={`p-2 rounded-lg ${promo.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`} title={promo.active ? 'ปิด' : 'เปิด'}>
                        {promo.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      <button onClick={() => deletePromoCode(promo.id)} className="p-2 rounded-lg bg-red-100 text-red-600" title="ลบ"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MESSAGES ──────────────────────────────────────────────────── */}
      {adminTab === 'messages' && (
        <div className="space-y-4">

          {totalChatCount === 0 && (
            <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm">
              <MessageSquare size={36} className="mx-auto mb-2 opacity-20" />ไม่มีข้อความ
            </div>
          )}

          {/* Support chats (ลูกค้า ↔ Admin) */}
          {supportChats.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-purple-50 flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2 text-purple-700">
                  <MessageSquare size={16} /> ลูกค้า ↔ เจ้าหน้าที่ ({supportChats.length})
                </h3>
                {unreadSupportCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadSupportCount} ใหม่
                  </span>
                )}
              </div>
              <div className="divide-y">
                {supportChats.map(chatId => {
                  // รองรับทั้ง 'support-{userId}' และ '{orderId}-support'
                  const isOrderFormat = chatId.endsWith('-support');
                  const identifier   = isOrderFormat
                    ? chatId.replace('-support', '')
                    : chatId.replace('support-', '');
                  // หาชื่อลูกค้าจาก order (ถ้าเป็น orderId format)
                  const relatedOrder = isOrderFormat
                    ? orders.find(o => o.id === identifier)
                    : null;
                  const displayName  = relatedOrder
                    ? `ออเดอร์ #${identifier.slice(-6)} (${relatedOrder.customerName || 'ลูกค้า'})`
                    : `ลูกค้า: ${identifier.slice(0, 8)}...`;
                  const chatTitle    = relatedOrder
                    ? `Support — ออเดอร์ #${identifier.slice(-6)}`
                    : `ลูกค้า ${identifier.slice(0, 8)}...`;

                  const msgs    = chats[chatId] || [];
                  const lastMsg = msgs[msgs.length - 1];
                  const hasUnread = lastMsg && lastMsg.sender !== 'admin';

                  return (
                    <div key={chatId} className={`p-4 hover:bg-gray-50 flex justify-between items-center gap-2 ${hasUnread ? 'bg-purple-50/60' : ''}`}>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openChatWindow(chatId, chatTitle, 'admin')}>
                        <div className="font-bold text-sm text-purple-700 flex items-center gap-2">
                          {displayName}
                          {hasUnread && <span className="w-2 h-2 bg-red-500 rounded-full inline-block" />}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{lastMsg?.text || 'เริ่มสนทนา'}</div>
                        <div className="text-[10px] text-gray-400">{lastMsg?.time} · {msgs.length} ข้อความ</div>
                      </div>
                      <button
                        onClick={() => openChatWindow(chatId, chatTitle, 'admin')}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 active:scale-95 transition-all flex-shrink-0"
                      >
                        ตอบกลับ
                      </button>
                      <button onClick={() => { if(window.confirm('ลบแชทนี้?')) deleteChat(chatId); }}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 flex-shrink-0" title="ลบแชท">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Merchant chats (ลูกค้า ↔ ร้านค้า) */}
          {merchantChats.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-orange-50">
                <h3 className="font-bold flex items-center gap-2 text-orange-700">
                  <MessageSquare size={16} /> ลูกค้า ↔ ร้านค้า ({merchantChats.length})
                </h3>
              </div>
              <div className="divide-y">
                {merchantChats.map(chatId => {
                  const orderId = chatId.replace('-merchant', '');
                  const order   = orders.find(o => o.id === orderId);
                  const msgs    = chats[chatId] || [];
                  const lastMsg = msgs[msgs.length - 1];
                  return (
                    <div key={chatId} className="p-4 hover:bg-gray-50 flex justify-between items-center gap-2">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openChatWindow(chatId, order ? `${order.customerName} ↔ ${order.restaurantName}` : `ออร์เดอร์ ${orderId.slice(0,6)}`, 'admin')}>
                        <div className="font-bold text-sm text-orange-700">
                          {order ? `${order.customerName} ↔ ${order.restaurantName}` : `ออร์เดอร์ ${orderId.slice(0,6)}...`}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{lastMsg?.text || 'เริ่มสนทนา'}</div>
                        <div className="text-[10px] text-gray-400">{lastMsg?.time} · {msgs.length} ข้อความ</div>
                      </div>
                      <button onClick={() => { if(window.confirm('ลบแชทนี้?')) deleteChat(chatId); }}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 flex-shrink-0" title="ลบแชท">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rider chats (ลูกค้า ↔ ไรเดอร์) */}
          {riderChats.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-blue-50">
                <h3 className="font-bold flex items-center gap-2 text-blue-700">
                  <MessageSquare size={16} /> ลูกค้า ↔ ไรเดอร์ ({riderChats.length})
                </h3>
              </div>
              <div className="divide-y">
                {riderChats.map(chatId => {
                  const orderId = chatId.replace('-rider', '');
                  const order   = orders.find(o => o.id === orderId);
                  const msgs    = chats[chatId] || [];
                  const lastMsg = msgs[msgs.length - 1];
                  return (
                    <div key={chatId} className="p-4 hover:bg-gray-50 flex justify-between items-center gap-2">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openChatWindow(chatId, order ? `${order.customerName} ↔ ไรเดอร์` : `ออร์เดอร์ ${orderId.slice(0,6)}`, 'admin')}>
                        <div className="font-bold text-sm text-blue-700">
                          {order ? `${order.customerName} ↔ ${order.riderName || 'ไรเดอร์'}` : `ออร์เดอร์ ${orderId.slice(0,6)}...`}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{lastMsg?.text || 'เริ่มสนทนา'}</div>
                        <div className="text-[10px] text-gray-400">{lastMsg?.time} · {msgs.length} ข้อความ</div>
                      </div>
                      <button onClick={() => { if(window.confirm('ลบแชทนี้?')) deleteChat(chatId); }}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 flex-shrink-0" title="ลบแชท">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rider ↔ Merchant chats */}
          {riderMerchantChats.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-teal-50">
                <h3 className="font-bold flex items-center gap-2 text-teal-700">
                  <MessageSquare size={16} /> ไรเดอร์ ↔ ร้านค้า ({riderMerchantChats.length})
                </h3>
              </div>
              <div className="divide-y">
                {riderMerchantChats.map(chatId => {
                  const orderId = chatId.replace('-rider-merchant', '');
                  const order   = orders.find(o => o.id === orderId);
                  const msgs    = chats[chatId] || [];
                  const lastMsg = msgs[msgs.length - 1];
                  return (
                    <div key={chatId} className="p-4 hover:bg-gray-50 flex justify-between items-center gap-2">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openChatWindow(chatId, order ? `ไรเดอร์ ↔ ${order.restaurantName}` : `ออร์เดอร์ ${orderId.slice(0,6)}`, 'admin')}>
                        <div className="font-bold text-sm text-teal-700">
                          {order ? `ไรเดอร์ ↔ ${order.restaurantName || 'ร้านค้า'}` : `ออร์เดอร์ ${orderId.slice(0,6)}...`}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{lastMsg?.text || 'เริ่มสนทนา'}</div>
                        <div className="text-[10px] text-gray-400">{lastMsg?.time} · {msgs.length} ข้อความ</div>
                      </div>
                      <button onClick={() => { if(window.confirm('ลบแชทนี้?')) deleteChat(chatId); }}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 flex-shrink-0" title="ลบแชท">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── SETTINGS ──────────────────────────────────────────────────── */}
      {adminTab === 'settings' && (
        <div className="bg-white p-6 rounded-xl shadow-sm">
          <h2 className="font-bold text-xl mb-6 flex items-center gap-2"><Sliders /> ตั้งค่าระบบ</h2>

          {/* Bank info */}
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-8">
            <h3 className="font-bold text-blue-700 border-b border-blue-200 pb-2 mb-4 flex items-center gap-2"><CreditCard size={18} /> บัญชีรับเงิน</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">ชื่อธนาคาร</label><input type="text" value={editConfig.adminBankName} onChange={e => setEditConfig({ ...editConfig, adminBankName: e.target.value })} className="w-full border p-2 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">เลขที่บัญชี</label><input type="text" value={editConfig.adminBankAccount} onChange={e => setEditConfig({ ...editConfig, adminBankAccount: e.target.value })} className="w-full border p-2 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">ชื่อบัญชี</label><input type="text" value={editConfig.adminAccountName} onChange={e => setEditConfig({ ...editConfig, adminAccountName: e.target.value })} className="w-full border p-2 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">เบอร์ / เลขบัตร PromptPay</label><input type="text" value={editConfig.adminPromptPayId || ''} onChange={e => setEditConfig({ ...editConfig, adminPromptPayId: e.target.value })} className="w-full border p-2 rounded" placeholder="0xx-xxx-xxxx หรือ 13 หลัก" /></div>
              <div><label className="block text-sm font-medium mb-1">QR Code URL (สำรอง)</label><input type="text" value={editConfig.adminQrCode} onChange={e => setEditConfig({ ...editConfig, adminQrCode: e.target.value })} className="w-full border p-2 rounded" /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-4">
              <h3 className="font-bold text-gray-500 border-b pb-2 flex items-center gap-2"><MapIcon size={16} /> รัศมีให้บริการ (กม.)</h3>
              <div><label className="block text-sm font-medium mb-1">App Service Radius</label><input type="number" value={editConfig.appRadius} onChange={e => setEditConfig({ ...editConfig, appRadius: parseFloat(e.target.value) })} className="w-full border p-2 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">Restaurant Delivery Radius</label><input type="number" value={editConfig.restaurantRadius} onChange={e => setEditConfig({ ...editConfig, restaurantRadius: parseFloat(e.target.value) })} className="w-full border p-2 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">Rider Job Radius</label><input type="number" value={editConfig.riderRadius} onChange={e => setEditConfig({ ...editConfig, riderRadius: parseFloat(e.target.value) })} className="w-full border p-2 rounded" /></div>
            </div>
            <div className="space-y-4">
              <h3 className="font-bold text-gray-500 border-b pb-2 flex items-center gap-2"><DollarSign size={16} /> ค่าบริการขนส่ง</h3>
              <div><label className="block text-sm font-medium mb-1">Base Fee (฿)</label><input type="number" value={editConfig.baseFee} onChange={e => setEditConfig({ ...editConfig, baseFee: parseFloat(e.target.value) })} className="w-full border p-2 rounded" /></div>
              <div><label className="block text-sm font-medium mb-1">Per Km Fee (฿/กม.)</label><input type="number" value={editConfig.perKmFee} onChange={e => setEditConfig({ ...editConfig, perKmFee: parseFloat(e.target.value) })} className="w-full border p-2 rounded" /></div>
            </div>
          </div>

          <div className="space-y-4 mb-8">
            <h3 className="font-bold text-gray-500 border-b pb-2 flex items-center gap-2"><Percent size={16} /> ค่าคอมมิชชั่น (GP %)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-1 text-orange-600">GP ร้านค้า (Food)</label>
                <div className="flex items-center">
                  <input type="number" value={editConfig.gpFood} onChange={e => setEditConfig({ ...editConfig, gpFood: parseFloat(e.target.value) })} className="w-full border p-2 rounded-l" />
                  <span className="bg-gray-100 border border-l-0 p-2 rounded-r text-gray-500">%</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-blue-600">GP ไรเดอร์ (Delivery)</label>
                <div className="flex items-center">
                  <input type="number" value={editConfig.gpDelivery} onChange={e => setEditConfig({ ...editConfig, gpDelivery: parseFloat(e.target.value) })} className="w-full border p-2 rounded-l" />
                  <span className="bg-gray-100 border border-l-0 p-2 rounded-r text-gray-500">%</span>
                </div>
              </div>
            </div>
          </div>

          <button onClick={saveConfig} className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold shadow hover:bg-green-700 flex items-center gap-2">
            <Save size={18} /> บันทึกการตั้งค่าทั้งหมด
          </button>

          {/* ── เครื่องมือระบบ ────────────────────────────────────────────── */}
          <div className="mt-8 border-t pt-6">
            <h3 className="font-bold text-gray-500 border-b pb-2 mb-4 flex items-center gap-2">
              <Sliders size={16} /> เครื่องมือระบบ (Admin Only)
            </h3>
            <div className="flex flex-wrap items-center gap-3">
            </div>
            <p className="text-xs text-gray-400 mt-2">
              ปัดเศษทศนิยม balance ทุก wallet ให้เป็น 2 ตำแหน่ง และแก้ไข floating-point artifact
            </p>
          </div>

          {/* ── ล้างข้อมูลระบบ ─────────────────────────────────────────── */}
          <div className="mt-6 border-t pt-6">
            <h3 className="font-bold text-red-600 border-b border-red-100 pb-2 mb-4 flex items-center gap-2">
              <DatabaseZap size={16} /> ล้างข้อมูลระบบ (ถาวร)
            </h3>
            <p className="text-xs text-gray-500 mb-4">เลือกประเภทข้อมูลที่ต้องการลบออกจากระบบอย่างถาวร ข้อมูลที่ลบแล้วไม่สามารถกู้คืนได้</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {[
                { key: 'orders',          label: 'ออเดอร์ทั้งหมด',                sub: 'ประวัติออเดอร์ทุกรายการ',                      color: 'red' },
                { key: 'walletEntries',   label: 'ประวัติธุรกรรม Wallet',          sub: 'ลบประวัติเงินเข้า-ออก (ไม่กระทบยอดคงเหลือ)',  color: 'yellow' },
                { key: 'wallets',         label: 'ยอดเงิน + ประวัติทุก Wallet',   sub: 'ล้างกระเป๋าทั้งระบบ รวม UID เก่าทั้งหมด',     color: 'rose' },
                { key: 'pendingRequests', label: 'คำขอรอดำเนินการ',                sub: 'เติมเงิน / ถอน / สมัครร้านค้า / ไรเดอร์',     color: 'purple' },
                { key: 'restaurants',     label: 'ร้านค้าทั้งหมด',                sub: 'ลบร้านค้าและเมนูอาหารทั้งหมด',                color: 'orange' },
                { key: 'riders',          label: 'ไรเดอร์ทั้งหมด',                sub: 'ลบข้อมูลไรเดอร์ทุกคน',                        color: 'blue' },
                { key: 'users',           label: 'บัญชีผู้ใช้ทั้งหมด',            sub: 'ลบ users + roles (แอดมินยังอยู่ในระบบ)',       color: 'gray' },
              ].map(({ key, label, sub, color }) => {
                const colorMap = {
                  red:    'border-red-200 bg-red-50',
                  orange: 'border-orange-200 bg-orange-50',
                  yellow: 'border-yellow-200 bg-yellow-50',
                  rose:   'border-rose-200 bg-rose-50',
                  purple: 'border-purple-200 bg-purple-50',
                  blue:   'border-blue-200 bg-blue-50',
                  gray:   'border-gray-200 bg-gray-50',
                };
                const textMap = {
                  red: 'text-red-600', orange: 'text-orange-600', yellow: 'text-yellow-600',
                  rose: 'text-rose-600', purple: 'text-purple-600', blue: 'text-blue-600', gray: 'text-gray-600',
                };
                const checked = purgeOptions[key];
                return (
                  <button
                    key={key}
                    onClick={() => togglePurge(key)}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${checked ? colorMap[color] : 'border-gray-100 bg-gray-50'}`}
                  >
                    {checked
                      ? <CheckSquare size={18} className={`mt-0.5 shrink-0 ${textMap[color]}`} />
                      : <Square size={18} className="mt-0.5 shrink-0 text-gray-300" />
                    }
                    <div>
                      <p className="font-semibold text-sm text-gray-800">{label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  const anySelected = Object.values(purgeOptions).some(Boolean);
                  if (!anySelected) return notifySystem('ผิดพลาด', 'กรุณาเลือกประเภทข้อมูลอย่างน้อย 1 รายการ', 'error');
                  setShowPurgeModal(true);
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm shadow hover:bg-red-700 transition-colors"
              >
                <Trash2 size={15} /> ล้างข้อมูลที่เลือก
              </button>
              <button
                onClick={() => setShowResetAllModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl font-bold text-sm shadow hover:bg-black transition-colors"
              >
                <DatabaseZap size={15} /> รีเซ็ตระบบทั้งหมด
              </button>
              {purgeResult && (
                <span className={`text-sm px-3 py-1.5 rounded-lg border ${purgeResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {purgeResult.summary}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODALS ────────────────────────────────────────────────────── */}

      {showPurgeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-full"><ShieldOff size={22} className="text-red-600" /></div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">ยืนยันการลบข้อมูล</h3>
                <p className="text-xs text-red-500 font-medium">ข้อมูลจะถูกลบถาวร กู้คืนไม่ได้</p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5 space-y-1.5">
              {purgeOptions.orders          && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> ออเดอร์ทั้งหมด</p>}
              {purgeOptions.walletEntries   && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> ประวัติธุรกรรม Wallet</p>}
              {purgeOptions.wallets         && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> ยอดเงิน + ประวัติทุก Wallet</p>}
              {purgeOptions.pendingRequests && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> คำขอรอดำเนินการทั้งหมด</p>}
              {purgeOptions.restaurants     && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> ร้านค้าทั้งหมด</p>}
              {purgeOptions.riders          && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> ไรเดอร์ทั้งหมด</p>}
              {purgeOptions.users           && <p className="text-sm text-red-700 flex items-center gap-2"><Trash2 size={13} /> บัญชีผู้ใช้ทั้งหมด</p>}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowPurgeModal(false)}
                disabled={purgeLoading}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handlePurge}
                disabled={purgeLoading}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-bold hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
              >
                {purgeLoading ? (
                  <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> กำลังลบ...</>
                ) : (
                  <><Trash2 size={15} /> ยืนยันลบถาวร</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetAllModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-gray-900 rounded-full"><DatabaseZap size={22} className="text-white" /></div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">รีเซ็ตระบบทั้งหมด</h3>
                <p className="text-xs text-red-500 font-medium">ข้อมูลทั้งหมดจะถูกลบถาวร กู้คืนไม่ได้</p>
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 mb-5 space-y-1.5">
              {['ออเดอร์ทั้งหมด','ยอดเงิน + ประวัติทุก Wallet','คำขอรอดำเนินการ','ร้านค้าทั้งหมด','ไรเดอร์ทั้งหมด','บัญชีผู้ใช้ทั้งหมด'].map(t => (
                <p key={t} className="text-sm text-red-300 flex items-center gap-2"><Trash2 size={13} /> {t}</p>
              ))}
            </div>
            <p className="text-xs text-gray-400 mb-4 text-center">แอดมินจะยังคง Login อยู่ แต่ข้อมูลทั้งหมดในระบบจะหายไป</p>
            <div className="flex gap-2">
              <button onClick={() => setShowResetAllModal(false)} disabled={purgeLoading} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-200 transition-colors">ยกเลิก</button>
              <button onClick={() => handlePurge(true)} disabled={purgeLoading} className="flex-1 bg-gray-900 text-white py-2.5 rounded-xl font-bold hover:bg-black transition-colors flex items-center justify-center gap-2">
                {purgeLoading ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> กำลังรีเซ็ต...</> : <><DatabaseZap size={15} /> ยืนยันรีเซ็ตทั้งหมด</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-red-600"><Ban size={20} /> ยืนยันการยกเลิกออเดอร์</h3>
            <p className="text-gray-600 mb-2 text-sm">กรุณาระบุเหตุผล:</p>
            <textarea value={cancelReasonInput} onChange={e => setCancelReasonInput(e.target.value)} placeholder="เช่น ติดต่อลูกค้าไม่ได้, ร้านปิด..." className="w-full border p-2 rounded-lg mb-4 h-24 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setShowCancelModal(false)} className="flex-1 bg-gray-200 py-2 rounded-lg font-bold">ยกเลิก</button>
              <button onClick={confirmCancelOrder} className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold">ยืนยัน</button>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-xs text-center">
            <XCircle size={48} className="text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold mb-2">ยืนยันการปฏิเสธคำขอ?</h3>
            <p className="text-gray-500 mb-6 text-sm">ข้อมูลจะถูกลบออกจากระบบถาวร</p>
            <div className="flex gap-2">
              <button onClick={() => setShowRejectModal(false)} className="flex-1 bg-gray-200 py-2 rounded-lg font-bold">ยกเลิก</button>
              <button onClick={confirmRejectRequest} className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold">ยืนยันปฏิเสธ</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ธุรกรรมทั้งระบบ ─────────────────────────────────────────────── */}
      {adminTab === 'ledger' && (() => {
        const txTypeBadge = (type) => {
          const map = {
            order_placed:      { label: 'สั่งซื้อ',    cls: 'bg-blue-100 text-blue-700' },
            order_completed:   { label: 'จบงาน',       cls: 'bg-green-100 text-green-700' },
            order_cancelled:   { label: 'ยกเลิก',      cls: 'bg-red-100 text-red-700' },
            rider_income:      { label: 'ค่าส่ง',      cls: 'bg-yellow-100 text-yellow-700' },
            merchant_income:   { label: 'รายได้ร้าน',  cls: 'bg-orange-100 text-orange-700' },
            admin_gp:          { label: 'GP',           cls: 'bg-purple-100 text-purple-700' },
            topup_approved:    { label: 'เติมเงิน',    cls: 'bg-emerald-100 text-emerald-700' },
            withdraw_approved: { label: 'ถอนเงิน',     cls: 'bg-rose-100 text-rose-700' },
            wallet_refund:     { label: 'คืนเงิน',     cls: 'bg-teal-100 text-teal-700' },
          };
          return map[type] || { label: type || '?', cls: 'bg-gray-100 text-gray-600' };
        };
        const txRoleBadge = (role) => {
          const map = {
            admin:    { label: 'Admin',   cls: 'bg-red-100 text-red-700' },
            rider:    { label: 'ไรเดอร์', cls: 'bg-yellow-100 text-yellow-700' },
            merchant: { label: 'ร้านค้า', cls: 'bg-green-100 text-green-700' },
            customer: { label: 'ลูกค้า',  cls: 'bg-blue-100 text-blue-700' },
          };
          return map[role] || { label: role || '-', cls: 'bg-gray-100 text-gray-600' };
        };

        // Filter by search
        const q = searchLedger.toLowerCase().trim();
        const filtered = q
          ? txList.filter(e =>
              (e.desc || '').toLowerCase().includes(q) ||
              (e.userName || '').toLowerCase().includes(q) ||
              (e.orderId || '').toLowerCase().includes(q) ||
              (e.type || '').toLowerCase().includes(q)
            )
          : txList;

        const totalIn  = filtered.reduce((s, e) => s + Math.max(0, e.amount ?? 0), 0);
        const totalOut = filtered.reduce((s, e) => s + Math.min(0, e.amount ?? 0), 0);

        return (
          <div>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
              <div className="flex-1">
                <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                  <List size={18} className="text-green-600" /> ธุรกรรมทั้งระบบ
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {txLoading ? 'กำลังโหลด...' : `${filtered.length} รายการ`}
                </p>
              </div>
              <input
                type="search"
                placeholder="ค้นหาชื่อ / รายการ / ออเดอร์..."
                value={searchLedger}
                onChange={e => setSearchLedger(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm w-full sm:w-52 focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              <button
                onClick={handleClearTransactions}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-100 transition-colors whitespace-nowrap"
              >
                <Trash2 size={15} /> ล้างข้อมูล
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-xl p-3 shadow-sm border-l-4 border-gray-300 text-center">
                <p className="text-xs text-gray-400">ทั้งหมด</p>
                <p className="font-bold text-gray-700">{filtered.length}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border-l-4 border-green-500 text-center">
                <p className="text-xs text-gray-400">เงินเข้า</p>
                <p className="font-bold text-green-600">+฿{totalIn.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl p-3 shadow-sm border-l-4 border-red-500 text-center">
                <p className="text-xs text-gray-400">เงินออก</p>
                <p className="font-bold text-red-500">-฿{Math.abs(totalOut).toLocaleString()}</p>
              </div>
            </div>

            {txLoading ? (
              <div className="bg-white rounded-xl p-12 text-center text-gray-400 shadow-sm">
                <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm">กำลังโหลดข้อมูล...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center text-gray-400 shadow-sm">
                <Wallet size={40} className="mx-auto mb-3 opacity-20" />
                <p className="font-semibold">ยังไม่มีข้อมูลธุรกรรม</p>
                <p className="text-xs mt-1">ข้อมูลจะแสดงเมื่อมีการสั่งซื้อ / เติมเงิน / ถอนเงิน</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-y-auto max-h-[65vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0 shadow-sm">
                      <tr>
                        <th className="p-3 text-left">เวลา</th>
                        <th className="p-3 text-left">ประเภท</th>
                        <th className="p-3 text-left">ผู้ใช้</th>
                        <th className="p-3 text-left">รายการ</th>
                        <th className="p-3 text-right">จำนวน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.slice(0, 300).map((entry, i) => {
                        const typeBadge = txTypeBadge(entry.type);
                        const roleBadge = txRoleBadge(entry.role);
                        const amt = entry.amount ?? 0;
                        const timeStr = entry.createdAtMs ? formatDateTimeFromMs(entry.createdAtMs) : (entry.date || '—');
                        return (
                          <tr key={entry._docId || `tx-${i}`} className="hover:bg-gray-50 transition-colors">
                            <td className="p-3 text-xs text-gray-400 whitespace-nowrap align-top pt-3.5">{timeStr}</td>
                            <td className="p-3 align-top pt-3.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${typeBadge.cls}`}>{typeBadge.label}</span>
                            </td>
                            <td className="p-3 align-top pt-3.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-semibold text-gray-700">{entry.userName || '—'}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${roleBadge.cls}`}>{roleBadge.label}</span>
                              </div>
                              {entry.orderId && <p className="text-[10px] text-gray-400 mt-0.5">#{entry.orderId.slice(-6)}</p>}
                            </td>
                            <td className="p-3 text-xs text-gray-600 max-w-[180px] truncate align-top pt-3.5">{entry.desc || '—'}</td>
                            <td className={`p-3 text-right font-bold text-sm whitespace-nowrap align-top pt-3.5 ${amt > 0 ? 'text-green-600' : amt < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {amt !== 0 ? `${amt > 0 ? '+' : ''}฿${Math.abs(amt).toLocaleString()}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filtered.length > 300 && (
                    <p className="text-center text-xs text-gray-400 py-3">แสดง 300 รายการแรก — ใช้ช่องค้นหาเพื่อกรอง</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showImageModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setShowImageModal(false)}>
          <div className="relative max-w-4xl w-full h-full flex items-center justify-center">
            <button onClick={() => setShowImageModal(false)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white hover:bg-white/40"><X size={24} /></button>
            <img src={previewImageUrl} className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} alt="preview" />
          </div>
        </div>
      )}
    </div>
  );
}
