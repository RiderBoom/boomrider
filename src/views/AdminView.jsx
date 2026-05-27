import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert, ArrowLeft, MessageSquare, Bell, Check, XCircle,
  ChefHat, Bike, Sliders, Save, CreditCard,
  DollarSign, Percent, Map as MapIcon,
  Edit, Power, Lock, Phone, FileBadge,
  Image as ImageIcon, Ban, X, Users, BarChart2, Tag,
  TrendingUp, ShoppingBag, Star, PlusCircle, Trash2,
  ToggleLeft, ToggleRight, Wallet, AlertCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STATUS_LABELS, FIREBASE_ENABLED } from '../constants';
import { saveAppConfig } from '../firebase/firestore';

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
    selectedProofOrder,
    showProofModal, setShowProofModal,
    showImageModal, setShowImageModal,
    previewImageUrl,
    handleApproveRequest,
    initiateRejectRequest, confirmRejectRequest,
    initiateCancelOrder, confirmCancelOrder,
    saveShopEdit,
    toggleRestaurantStatus, toggleRiderBan,
    openChatWindow, openProofModal, openImagePreview,
    notifySystem,
    deleteChat,
    // Promo
    promoCodes, createPromoCode, togglePromoCode, deletePromoCode,
    // Admin tools
    adminAdjustWallet, adminBanUser,
    creditWallet,
    // Multi-wallet
    multiWallet,
    txLogs,
    handleApproveDeposit,
    handleRejectDeposit,
    handleApproveWithdrawal,
    handleRejectWithdrawal,
    adminCreditWalletByType,
  } = useApp();

  // ── Local state ──────────────────────────────────────────────────────────
  const [allUsers, setAllUsers] = useState([]);
  const [adjustUserId, setAdjustUserId] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDesc, setAdjustDesc] = useState('');

  // Promo form
  const [promoForm, setPromoForm] = useState({
    code: '', type: 'percent', value: 10, minOrder: 0, maxUses: 100,
    maxDiscount: 500, expiry: '', description: '',
  });

  // Load all users from localStorage
  useEffect(() => {
    if (adminTab === 'users') {
      const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
      const wallets = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}');
      const roles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
      const merged = users.map(u => ({
        ...u,
        walletBalance: wallets[u.id]?.balance ?? u.wallet ?? 0,
        roles: roles[u.id] || u.roles || ['customer'],
      }));
      setAllUsers(merged);
    }
  }, [adminTab]);

  const saveConfig = async () => {
    setAppConfig(editConfig);
    try {
      if (FIREBASE_ENABLED) await saveAppConfig(editConfig);
      notifySystem('สำเร็จ', 'บันทึกการตั้งค่าระบบเรียบร้อยแล้ว', 'success');
    } catch {
      notifySystem('สำเร็จ', 'บันทึกการตั้งค่าเรียบร้อย (local)', 'success');
    }
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

  // Today's date string (Thai locale day)
  const todayStr = new Date().toLocaleDateString('th-TH');
  const todayOrders = orders.filter(o => o.timestamp && o.timestamp.includes(todayStr));
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
    { id: 'messages',    label: 'ข้อความ',    icon: MessageSquare, badge: (unreadSupportCount || totalChatCount) || null },
    { id: 'settings',    label: 'ตั้งค่า',    icon: CreditCard },
  ];

  // ── Wallet adjust ─────────────────────────────────────────────────────────
  const handleAdjust = () => {
    const amt = parseFloat(adjustAmount);
    if (!adjustUserId || isNaN(amt) || amt === 0 || !adjustDesc) {
      return notifySystem('ผิดพลาด', 'กรุณากรอกข้อมูลให้ครบ', 'error');
    }
    adminAdjustWallet(adjustUserId, amt, adjustDesc);
    setAdjustUserId(null);
    setAdjustAmount('');
    setAdjustDesc('');
    // Reload user list
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const wallets = JSON.parse(localStorage.getItem('boomrider_wallets') || '{}');
    const roles = JSON.parse(localStorage.getItem('boomrider_user_roles') || '{}');
    setAllUsers(users.map(u => ({
      ...u,
      walletBalance: wallets[u.id]?.balance ?? u.wallet ?? 0,
      roles: roles[u.id] || u.roles || ['customer'],
    })));
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
            const adminPlatBal = multiWallet?.admin_platform?.balance ?? userWallet ?? 0;
            const adminPlatHistory = multiWallet?.admin_platform?.history ?? walletHistory ?? [];
            const adminTxLogs = txLogs.filter(l => l.target_wallet_type === 'admin_platform').slice(0, 30);
            const displayHistory = adminTxLogs.length > 0 ? adminTxLogs : adminPlatHistory;
            return (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                <div className="p-4 border-b bg-green-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet size={18} className="text-green-600" />
                    <h2 className="font-bold text-gray-700">กระเป๋าเงิน Admin — Platform GP</h2>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">฿{adminPlatBal.toLocaleString()}</div>
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
                          <th className="p-3 text-right">คงเหลือ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {displayHistory.slice(0, 50).map((h, i) => {
                          // h อาจเป็น txLog (มี description, timestamp) หรือ history entry (มี date, desc)
                          const label   = h.description || h.desc || '';
                          const dateStr = h.date || (h.timestamp?.toDate ? h.timestamp.toDate().toLocaleString('th-TH') : '');
                          const amt     = h.amount ?? 0;
                          const balAfter = h.balance_after ?? null;
                          return (
                            <tr key={h.id || i} className="hover:bg-gray-50">
                              <td className="p-3">
                                <div className="text-xs text-gray-400">{dateStr}</div>
                                <div className="text-xs text-gray-700">{label}</div>
                              </td>
                              <td className={`p-3 text-right font-bold text-sm ${amt > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {amt > 0 ? '+' : ''}฿{Math.abs(amt).toLocaleString()}
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
                  {orders.slice(0, 50).map(order => {
                    const rider = riders.find(r => r.id === order.riderId);
                    const restaurant = restaurants.find(r => r.id === order.restaurantId);
                    return (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="p-4"><div className="font-mono font-bold text-gray-700 text-xs">{order.id}</div><div className="text-xs text-gray-400">{order.timestamp}</div></td>
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
                          {(order.pickupPhoto || order.deliveryPhoto) && (
                            <button onClick={() => openProofModal(order)} className="text-blue-500 hover:bg-blue-50 text-xs px-2 py-1 rounded border border-blue-200 ml-1">หลักฐาน</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {orders.length === 0 && <div className="p-10 text-center text-gray-400">ยังไม่มีออเดอร์</div>}
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

          {/* Wallet balances */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-2 flex items-center gap-2 text-gray-700"><Wallet size={20} className="text-purple-600" /> ยอด Wallet ทั้งระบบ</h2>
            {(() => {
              const wallets = Object.values(globalWallets);
              const total = wallets.reduce((s, w) => s + (w.balance || 0), 0);
              return (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-purple-600">฿{total.toLocaleString()}</span>
                  <span className="text-gray-400 text-sm">ใน {wallets.length} กระเป๋า</span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── APPROVALS ─────────────────────────────────────────────────── */}
      {adminTab === 'approvals' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b"><h2 className="font-bold text-xl flex items-center gap-2"><Bell className="text-green-600" /> รายการรออนุมัติ ({pendingRequests.length})</h2></div>
          {pendingRequests.length === 0 ? (
            <div className="p-10 text-center text-gray-400"><Check size={40} className="mx-auto mb-2 text-green-400 opacity-40" />ไม่มีรายการรออนุมัติ</div>
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
                        {/* walletType badge — shows which sub-wallet to credit/debit */}
                        {(req.type === 'topup' || req.type === 'withdraw') && (req.walletType || req.data?.walletType) && (() => {
                          const wt = req.walletType || req.data?.walletType;
                          const wtLabel = wt === 'rider_credit' ? '🎯 เครดิต GP' : wt === 'rider_main' ? '🛵 รายได้ไรเดอร์' : wt === 'shop_settlement' ? '🏪 รายได้ร้าน' : wt === 'admin_platform' ? '🏛 Platform' : wt;
                          return <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">{wtLabel}</span>;
                        })()}
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
                      {(req.type === 'topup' || req.type === 'withdraw') && (
                        <div className="text-xs text-blue-600 font-bold mt-1">
                          ยอด Wallet ปัจจุบัน: ฿{(globalWallets[req.userId]?.balance ?? 0).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button onClick={() => handleApproveRequest(req)} className="flex items-center gap-1 bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700 text-sm"><Check size={16} /> อนุมัติ</button>
                      <button onClick={() => initiateRejectRequest(req.id)} className="flex items-center gap-1 bg-gray-200 text-gray-600 px-4 py-2 rounded-lg font-bold hover:bg-gray-300 text-sm"><XCircle size={16} /> ปฏิเสธ</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TRANSACTION LOGS (Multi-Wallet) ─────────────────────────────── */}
      {adminTab === 'approvals' && (() => {
        const pendingDeposits = txLogs.filter(l => l.type === 'topup' && l.status === 'pending');
        const pendingWithdrawals = txLogs.filter(l => l.type === 'withdraw' && l.status === 'pending_approval');
        const allPending = [...pendingDeposits, ...pendingWithdrawals];

        if (allPending.length === 0) return null;

        return (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
            <div className="p-4 border-b bg-purple-50 flex items-center gap-2">
              <Wallet size={18} className="text-purple-600" />
              <h2 className="font-bold text-gray-700">คำขอ Multi-Wallet ({allPending.length} รายการ)</h2>
            </div>
            <div className="divide-y">
              {allPending.map(tx => (
                <div key={tx.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          tx.type === 'topup' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {tx.type === 'topup' ? '💰 เติมเงิน' : '💸 ถอนเงิน'}
                        </span>
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold">
                          {tx.target_wallet_type}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                          tx.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'
                        }`}>{tx.status}</span>
                      </div>
                      <div className="font-bold text-gray-800 text-lg">
                        {tx.type === 'topup' ? '+' : '-'}฿{Number(tx.amount).toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{tx.description}</div>
                      <div className="text-xs text-gray-400">User: {tx.user_id}</div>
                      {tx.bank_info && Object.keys(tx.bank_info).length > 0 && (
                        <div className="mt-2 bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs text-gray-600 space-y-0.5">
                          {tx.bank_info.bank && <p>ธนาคาร: <strong>{tx.bank_info.bank}</strong></p>}
                          {tx.bank_info.accountName && <p>ชื่อบัญชี: <strong>{tx.bank_info.accountName}</strong></p>}
                          {tx.bank_info.accountNumber && <p>เลขบัญชี: <strong>{tx.bank_info.accountNumber}</strong></p>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => tx.type === 'topup' ? handleApproveDeposit(tx.id) : handleApproveWithdrawal(tx.id)}
                        className="flex items-center gap-1 bg-green-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-green-700 text-xs"
                      ><Check size={14} /> อนุมัติ</button>
                      <button
                        onClick={() => tx.type === 'topup' ? handleRejectDeposit(tx.id) : handleRejectWithdrawal(tx.id)}
                        className="flex items-center gap-1 bg-red-100 text-red-600 px-3 py-2 rounded-lg font-bold hover:bg-red-200 text-xs"
                      ><XCircle size={14} /> ปฏิเสธ</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── ALL TRANSACTION LOGS (ประวัติธุรกรรมทั้งหมด) ────────────────── */}
      {adminTab === 'approvals' && txLogs.length > 0 && (() => {
        const completedLogs = txLogs.filter(l => !['pending', 'pending_approval'].includes(l.status)).slice(0, 30);
        if (completedLogs.length === 0) return null;
        return (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
            <div className="p-4 border-b bg-gray-50 flex items-center gap-2">
              <TrendingUp size={18} className="text-gray-500" />
              <h2 className="font-bold text-gray-700">ประวัติธุรกรรม Multi-Wallet (ล่าสุด)</h2>
            </div>
            <div className="overflow-y-auto max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-gray-400 uppercase text-[10px]">
                    <th className="p-2 text-left">ประเภท</th>
                    <th className="p-2 text-left">Wallet</th>
                    <th className="p-2 text-left">รายละเอียด</th>
                    <th className="p-2 text-right">จำนวน</th>
                    <th className="p-2 text-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {completedLogs.map((log, i) => (
                    <tr key={log.id || i} className="hover:bg-gray-50">
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          log.type === 'topup' ? 'bg-blue-100 text-blue-700' :
                          log.type === 'withdraw' ? 'bg-orange-100 text-orange-700' :
                          log.type === 'delivery_fee' ? 'bg-green-100 text-green-700' :
                          log.type === 'platform_gp_deduct' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>{log.type}</span>
                      </td>
                      <td className="p-2 text-gray-500 font-mono text-[10px]">{log.target_wallet_type}</td>
                      <td className="p-2 text-gray-600 max-w-32 truncate">{log.description}</td>
                      <td className={`p-2 text-right font-bold ${(log.amount ?? 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {(log.amount ?? 0) >= 0 ? '+' : ''}฿{Math.abs(log.amount ?? 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          log.status === 'success' ? 'bg-green-100 text-green-700' :
                          log.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{log.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

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
                <p>ไม่มีผู้ใช้ (Firebase users จะไม่แสดงที่นี่)</p>
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
                          onClick={() => setAdjustUserId(adjustUserId === user.id ? null : user.id)}
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
                      </div>
                    </div>

                    {/* Wallet adjust panel */}
                    {adjustUserId === user.id && (
                      <div className="mt-3 bg-gray-50 p-3 rounded-lg border border-gray-200 animate-fade-in">
                        <p className="text-xs font-bold text-gray-600 mb-2">ปรับยอด Wallet ของ {user.name}</p>
                        <div className="flex gap-2 mb-2">
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
              <div><label className="block text-sm font-medium mb-1">QR Code URL</label><input type="text" value={editConfig.adminQrCode} onChange={e => setEditConfig({ ...editConfig, adminQrCode: e.target.value })} className="w-full border p-2 rounded" /></div>
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
        </div>
      )}

      {/* ── MODALS ────────────────────────────────────────────────────── */}
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

      {showProofModal && selectedProofOrder && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-4 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">หลักฐาน #{selectedProofOrder.id}</h3>
              <button onClick={() => setShowProofModal(false)} className="p-1 hover:bg-gray-100 rounded-full"><X /></button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="font-bold text-sm mb-2 text-indigo-600">รูปรับของ (Pickup)</p>
                {selectedProofOrder.pickupPhoto ? <img src={selectedProofOrder.pickupPhoto} className="w-full rounded-lg border" alt="pickup" /> : <p className="text-gray-400 text-sm">ไม่มีรูปภาพ</p>}
              </div>
              <div>
                <p className="font-bold text-sm mb-2 text-green-600">รูปส่งของ (Delivery)</p>
                {selectedProofOrder.deliveryPhoto ? <img src={selectedProofOrder.deliveryPhoto} className="w-full rounded-lg border" alt="delivery" /> : <p className="text-gray-400 text-sm">ไม่มีรูปภาพ</p>}
              </div>
            </div>
          </div>
        </div>
      )}

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
