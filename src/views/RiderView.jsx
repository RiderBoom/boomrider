import React, { useState } from 'react';
import {
  Bike, User, MessageSquare, AlertCircle,
  ToggleLeft, ToggleRight, TrendingUp, Clock, DollarSign, Star, Loader, MapPin,
  XCircle, X, Wallet, CreditCard, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import InteractiveMap from '../components/InteractiveMap';
import { getDistanceFromLatLonInKm, formatDateTimeFromMs, formatDateTime } from '../utils';
import { USER_LOCATION } from '../constants';

export default function RiderView() {
  const {
    activeRole, setActiveRole,
    riderTab, setRiderTab,
    orders, riders, restaurants, appConfig,
    userProfile, currentUser,
    acceptOrder,
    updateOrderStatus,
    requestCancelByRole,
    hasPendingCancelRequest,
    openChatWindow,
    setProfileSubView, setActiveTab,
    updateRiderWorkingLocation,
    FIREBASE_ENABLED,
    userWallet,
    walletHistory,
    pendingRequests,
    requestTopUp,
    requestWithdraw,
  } = useApp();

  // ── state สำหรับปุ่ม "รับงาน" ──────────────────────────────────────────────
  const [acceptingId, setAcceptingId] = useState(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [pendingLocation, setPendingLocation] = useState(null);

  // ── state สำหรับ Wallet tab ──────────────────────────────────────────────
  const [walletAction, setWalletAction] = useState(null); // null | 'topup' | 'withdraw'
  const [walletAmount, setWalletAmount] = useState('');
  const [walletBank, setWalletBank] = useState('');
  const [walletAccName, setWalletAccName] = useState('');
  const [walletAccNo, setWalletAccNo] = useState('');
  const [submittingWallet, setSubmittingWallet] = useState(false);

  // ── Reset wallet form เมื่อ user เปลี่ยน (ป้องกัน stale form ข้าม account) ──
  const _walletUid = userProfile.id || currentUser?.id || '';
  React.useEffect(() => {
    setWalletAction(null);
    setWalletAmount('');
    setWalletBank('');
    setWalletAccName('');
    setWalletAccNo('');
  }, [_walletUid]);

  // ── Scroll to top เมื่อ switch tab (ป้องกัน scroll position เก่าทำให้เห็น map) ──
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [riderTab]);

  // ── state สำหรับ Modal ขอยกเลิกงาน (ส่งไป Admin) ──────────────────────────
  const [showRiderCancelModal, setShowRiderCancelModal] = useState(false);
  const [riderCancelOrderId, setRiderCancelOrderId]     = useState(null);
  const [riderCancelReason, setRiderCancelReason]       = useState('');

  // Online/offline toggle (persisted per rider)
  const [isOnline, setIsOnline] = useState(() => {
    const key = `boomrider_rider_online_${userProfile.id || currentUser?.id}`;
    return localStorage.getItem(key) !== 'false';
  });

  // ── GPS ตำแหน่งจริงของไรเดอร์ ────────────────────────────────────────────
  const [riderGPS, setRiderGPS] = useState(null);

  React.useEffect(() => {
    if (!navigator.geolocation) return;
    let watchId;
    navigator.geolocation.getCurrentPosition(
      pos => setRiderGPS({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
    watchId = navigator.geolocation.watchPosition(
      pos => setRiderGPS({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, []);

  const toggleOnline = () => {
    setIsOnline(prev => {
      const next = !prev;
      const key = `boomrider_rider_online_${userProfile.id || currentUser?.id}`;
      localStorage.setItem(key, String(next));
      return next;
    });
  };

  // ── หาข้อมูลไรเดอร์ก่อน ────────────────────────────────────────────────
  const me = riders.find(r => r.userId === (userProfile.id || currentUser?.id));

  // ── ตำแหน่งที่ใช้คำนวณระยะทาง: GPS จริง → ตำแหน่งปักหมุดของไรเดอร์ → USER_LOCATION ──
  const myLocation = riderGPS || me?.location || USER_LOCATION;

  if (!me) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle size={56} className="text-yellow-400 mb-4" />
        <h2 className="text-xl font-bold mb-2">ยังไม่มีข้อมูลไรเดอร์</h2>
        <p className="text-gray-400 text-sm mb-2">Admin ยังไม่อนุมัติ หรืออาจต้องโหลดข้อมูลใหม่</p>
        <p className="text-xs text-gray-500 mb-6">UID: {userProfile.id || currentUser?.id || '—'}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-green-600 text-white px-6 py-3 rounded-xl font-bold mb-3 shadow w-full max-w-xs"
        >🔄 โหลดข้อมูลใหม่</button>
        <button
          onClick={() => { setActiveRole('customer'); setProfileSubView('reg_rider'); setActiveTab('profile'); }}
          className="bg-blue-500 text-white px-6 py-3 rounded-xl font-bold mb-3 shadow w-full max-w-xs"
        >📋 สมัครไรเดอร์</button>
        <button onClick={() => setActiveRole('customer')} className="text-gray-400 text-sm underline mt-2">กลับหน้าหลัก</button>
      </div>
    );
  }

  if (me.status === 'banned') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle size={56} className="text-red-400 mb-4" />
        <h2 className="text-xl font-bold mb-2">บัญชีถูกระงับ</h2>
        <p className="text-gray-400 text-sm mb-6">กรุณาติดต่อเจ้าหน้าที่</p>
        <button onClick={() => setActiveRole('customer')} className="text-gray-400 text-sm underline">กลับหน้าหลัก</button>
      </div>
    );
  }

  // ── ตัวกรองงานที่พร้อมรับ ────────────────────────────────────────────────
  const myUid = userProfile.id || currentUser?.id;
  const availableJobs = isOnline ? orders.filter(o => {
    if (o.status !== 'ready_to_pickup' || o.riderId) return false;
    // ห้ามรับงานที่ตัวเองสั่ง
    if (o.customerId && o.customerId === myUid) return false;
    // ตรวจสอบระยะทาง — ถ้าไม่มี pickupLocation ก็แสดงงานนั้นด้วย (พิมพ์ที่อยู่เอง)
    if (!o.pickupLocation) return true;
    const dist = getDistanceFromLatLonInKm(
      myLocation.lat, myLocation.lng,
      o.pickupLocation.lat, o.pickupLocation.lng,
    );
    return dist <= (appConfig.riderRadius || 5);
  }) : [];

  const myJobs = orders.filter(o =>
    ['rider_accepted', 'picking_up', 'delivering'].includes(o.status) && o.riderId === me.id,
  );

  const historyJobs = orders.filter(o =>
    ['delivered', 'completed'].includes(o.status) && o.riderId === me.id,
  );

  // Earnings stats
  const completedJobs = historyJobs.filter(j => ['delivered', 'completed'].includes(j.status));
  const todayStr = formatDateTime().slice(0, 10); // DD/MM/YYYY
  const todayJobs = completedJobs.filter(j => j.timestamp && j.timestamp.startsWith(todayStr));
  const todayEarning = todayJobs.reduce((s, j) => s + (j.riderIncome || 0), 0);
  const totalEarning = completedJobs.reduce((s, j) => s + (j.riderIncome || 0), 0);

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-14 pb-20">
      <div className="p-4 bg-gray-800 shadow-lg">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-xl font-bold flex items-center"><Bike className="mr-2 text-green-400" /> BoomRider</h1>
          <button onClick={() => setActiveRole('customer')} className="text-xs bg-gray-700 px-3 py-1.5 rounded-lg">← กลับ</button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center text-sm text-gray-300">
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center font-bold text-sm mr-2">
              {(me.name || 'R')[0]}
            </div>
            <div>
              <div className="font-bold text-white text-sm">{me.name}</div>
              <div className="text-xs text-gray-400">{me.phone}</div>
            </div>
          </div>
          {/* Online/Offline toggle */}
          <button
            onClick={toggleOnline}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm transition-all ${
              isOnline
                ? 'bg-green-500 text-white shadow-lg shadow-green-900/50'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {isOnline ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            {isOnline ? 'Online' : 'Offline'}
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="bg-gray-700 rounded-xl p-2.5 text-center">
            <DollarSign size={14} className="text-green-400 mx-auto mb-0.5" />
            <div className="text-sm font-bold text-green-400">฿{todayEarning.toFixed(0)}</div>
            <div className="text-[10px] text-gray-500">วันนี้</div>
          </div>
          <div className="bg-gray-700 rounded-xl p-2.5 text-center">
            <TrendingUp size={14} className="text-blue-400 mx-auto mb-0.5" />
            <div className="text-sm font-bold text-blue-400">฿{totalEarning.toFixed(0)}</div>
            <div className="text-[10px] text-gray-500">รวมทั้งหมด</div>
          </div>
          <div className="bg-gray-700 rounded-xl p-2.5 text-center">
            <Star size={14} className="text-yellow-400 mx-auto mb-0.5" />
            <div className="text-sm font-bold text-yellow-400">{completedJobs.length}</div>
            <div className="text-[10px] text-gray-500">งานสำเร็จ</div>
          </div>
        </div>
      </div>

      {/* GPS status bar */}
      {isOnline && (
        <div className={`mx-4 mb-1 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 ${riderGPS ? 'bg-green-900/40 text-green-300' : 'bg-yellow-900/40 text-yellow-300'}`}>
          <span>{riderGPS ? '📡' : '⚠️'}</span>
          {riderGPS
            ? `GPS: ${riderGPS.lat.toFixed(4)}, ${riderGPS.lng.toFixed(4)} — รัศมี ${appConfig.riderRadius} กม.`
            : 'รอ GPS… ใช้ตำแหน่งเริ่มต้นระหว่างรอ'}
        </div>
      )}

      <div className="flex p-4 gap-1.5">
        <button onClick={() => setRiderTab('jobs')} className={`flex-1 py-2 rounded-lg font-bold text-xs ${riderTab === 'jobs' ? 'bg-green-600' : 'bg-gray-700'}`}>
          งานใหม่ {availableJobs.length > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5 ml-0.5">{availableJobs.length}</span>}
        </button>
        <button onClick={() => setRiderTab('active')} className={`flex-1 py-2 rounded-lg font-bold text-xs ${riderTab === 'active' ? 'bg-green-600' : 'bg-gray-700'}`}>ทำอยู่ ({myJobs.length})</button>
        <button onClick={() => setRiderTab('map')} className={`flex-1 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1 ${riderTab === 'map' ? 'bg-blue-600' : 'bg-gray-700'}`}>
          <MapPin size={13} />จุดรับงาน
        </button>
        <button onClick={() => setRiderTab('history')} className={`flex-1 py-2 rounded-lg font-bold text-xs ${riderTab === 'history' ? 'bg-green-600' : 'bg-gray-700'}`}>ประวัติ</button>
        <button onClick={() => setRiderTab('wallet')} className={`flex-1 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1 ${riderTab === 'wallet' ? 'bg-yellow-600' : 'bg-gray-700'}`}>
          <Wallet size={13} />กระเป๋า
        </button>
      </div>

      {/* key={riderTab} — force full unmount/remount on tab switch
          ป้องกัน Leaflet map tiles (z-index 200–1000) ซ้อนทับ wallet content */}
      <div key={riderTab} className="px-4 space-y-4">
        {riderTab === 'jobs' && availableJobs.map(job => (
          <div key={job.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            {/* Header: ร้าน / ประเภทงาน + รายได้ */}
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="font-bold text-white">{job.restaurantName || (job.type === 'parcel' ? '📦 ส่งพัสดุ' : 'งาน')}</span>
                <div className="text-xs text-gray-500 mt-0.5">#{job.id.slice(-6)}</div>
              </div>
              <div className="text-right">
                {job.paymentMethod === 'cash' ? (
                  <>
                    <div className="text-yellow-400 font-bold text-base">฿{(job.grandTotal || 0).toFixed(0)}</div>
                    <div className="text-xs text-gray-500">เก็บเงินสด</div>
                    <div className="text-xs text-green-400">สุทธิ ฿{(job.riderIncome || 0).toFixed(0)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-green-400 font-bold text-base">฿{(job.riderIncome || 0).toFixed(0)}</div>
                    <div className="text-xs text-gray-500">เข้ากระเป๋า</div>
                  </>
                )}
              </div>
            </div>

            {/* ยอดรวมออเดอร์ + วิธีชำระ */}
            {job.paymentMethod === 'cash' ? (
              <div className="mb-2 bg-yellow-900/40 border border-yellow-700/40 rounded-lg px-3 py-2 space-y-0.5">
                <div className="text-xs text-yellow-300 font-bold flex items-center gap-1.5">
                  💰 เก็บเงินสดจาก{job.type === 'parcel' ? 'ผู้รับ' : 'ลูกค้า'}: <strong>฿{(job.grandTotal || 0).toLocaleString()}</strong>
                </div>
                {(job.adminGP || 0) > 0 && (
                  <div className="text-[11px] text-orange-300">
                    ⚠️ หลังส่งสำเร็จ −฿{(job.adminGP || 0).toFixed(0)} จะหักจากกระเป๋า (ค่า GP platform)
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-2 text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 bg-gray-700 text-gray-300">
                👛 <span>ชำระผ่าน Wallet · ยอดรวม: ฿{(job.grandTotal || 0).toLocaleString()}</span>
              </div>
            )}

            {/* แผนที่ */}
            <div className="mb-3 rounded-lg overflow-hidden border border-gray-600">
              <InteractiveMap mode="view" userLocation={job.location} shopLocation={job.pickupLocation} className="h-36" />
            </div>

            {/* ที่อยู่ */}
            <div className="text-sm text-gray-400 mb-1.5 space-y-1">
              <div>📍 {job.type === 'parcel' ? `รับที่: ${job.pickup}` : `ร้าน: ${job.restaurantName}`}</div>
              {job.type === 'parcel' && job.dropoff && (
                <div>🏁 ส่งที่: {job.dropoff}</div>
              )}
              {job.type === 'food' && job.address && (
                <div>🏠 ส่งที่: {job.address}</div>
              )}
            </div>

            {/* น้ำหนักพัสดุ */}
            {job.type === 'parcel' && job.weight && (
              <div className="bg-gray-700/40 rounded-lg px-3 py-1.5 mb-2 flex items-center gap-2">
                <span className="text-xs text-gray-400">📦 น้ำหนัก:</span>
                <span className="text-xs text-white font-bold">{job.weight} กก.</span>
              </div>
            )}

            {/* รายการอาหาร (food orders) */}
            {job.type === 'food' && job.items && job.items.length > 0 && (
              <div className="bg-gray-700/50 rounded-lg px-3 py-2 mb-2">
                <p className="text-xs text-gray-400 font-bold mb-1">🍱 รายการสั่ง ({job.items.length} รายการ)</p>
                {job.items.slice(0, 3).map((item, i) => (
                  <div key={i} className="text-xs text-gray-300 flex justify-between">
                    <span>· {item.name} {item.qty > 1 ? `x${item.qty}` : ''}</span>
                    <span>฿{((item.price || 0) * (item.qty || 1)).toFixed(0)}</span>
                  </div>
                ))}
                {job.items.length > 3 && (
                  <p className="text-xs text-gray-500 mt-0.5">+{job.items.length - 3} รายการ</p>
                )}
              </div>
            )}

            {/* ระยะทาง */}
            <div className="text-xs text-gray-500 mb-3 flex gap-3">
              <span>📏 จากคุณ: {job.pickupLocation
                ? `${getDistanceFromLatLonInKm(myLocation.lat, myLocation.lng, job.pickupLocation.lat, job.pickupLocation.lng).toFixed(1)} กม.`
                : 'ไม่ทราบ'}</span>
              {job.distance > 0 && <span>🛵 ระยะส่ง: {job.distance.toFixed(1)} กม.</span>}
            </div>

            {/* ── เบอร์ติดต่อ (พัสดุ) ── */}
            {job.type === 'parcel' && (job.customerPhone || job.receiverPhone) && (
              <div className="bg-gray-700/60 rounded-lg px-3 py-2 mb-3 space-y-1.5">
                <p className="text-xs text-gray-400 font-bold">📞 ติดต่อ</p>
                {job.customerPhone && (
                  <a href={`tel:${job.customerPhone}`} className="flex items-center gap-2 text-xs text-green-300 hover:text-green-200">
                    <span className="bg-gray-600 px-2 py-0.5 rounded text-gray-400">ผู้ส่ง</span>
                    <span className="font-bold">{job.customerName || 'ลูกค้า'}</span>
                    <span className="underline">{job.customerPhone}</span>
                  </a>
                )}
                {job.receiverPhone && (
                  <a href={`tel:${job.receiverPhone}`} className="flex items-center gap-2 text-xs text-blue-300 hover:text-blue-200">
                    <span className="bg-gray-600 px-2 py-0.5 rounded text-gray-400">ผู้รับ</span>
                    <span className="font-bold">{job.receiverName || 'ผู้รับ'}</span>
                    <span className="underline">{job.receiverPhone}</span>
                  </a>
                )}
              </div>
            )}

            {/* ปุ่มรับงาน */}
            <button
              disabled={acceptingId === job.id}
              onClick={async () => {
                setAcceptingId(job.id);
                try {
                  await acceptOrder(job.id, me.id, myLocation);
                } catch (_) {
                  // error handled inside acceptOrder; always reset spinner
                } finally {
                  setAcceptingId(null);
                }
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                acceptingId === job.id
                  ? 'bg-gray-600 cursor-not-allowed text-gray-400'
                  : 'bg-green-500 hover:bg-green-400 active:scale-95 text-white shadow-lg shadow-green-900/40'
              }`}
            >
              {acceptingId === job.id ? (
                <><Loader size={16} className="animate-spin" /> กำลังรับงาน...</>
              ) : job.paymentMethod === 'cash' ? (
                <>✅ รับงาน — เก็บเงินสด ฿{(job.grandTotal || 0).toFixed(0)}</>
              ) : (
                <>✅ รับงาน — รับ ฿{(job.riderIncome || 0).toFixed(0)} เข้ากระเป๋า</>
              )}
            </button>
          </div>
        ))}
        {riderTab === 'jobs' && availableJobs.length === 0 && (
          <div className="text-center text-gray-500 mt-10">
            {!isOnline ? (
              <div>
                <ToggleLeft size={40} className="mx-auto mb-2 opacity-30" />
                <p className="font-bold text-gray-400">คุณอยู่ใน Offline mode</p>
                <button onClick={toggleOnline} className="mt-3 bg-green-500 text-white px-6 py-2 rounded-full font-bold text-sm hover:bg-green-600">
                  เปิดรับงาน
                </button>
              </div>
            ) : (
              <div>
                <Clock size={40} className="mx-auto mb-2 opacity-30" />
                <p>ไม่พบงานในรัศมี {appConfig.riderRadius} กม.</p>
                <p className="text-xs mt-1">รอสักครู่...</p>
              </div>
            )}
          </div>
        )}

        {/* ── Map tab — ปักหมุดจุดรับงาน ─── */}
        {riderTab === 'map' && (
          <div>
            <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-blue-500/30">
              <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                <MapPin size={16} className="text-blue-400" /> ตั้งจุดรับงานของคุณ
              </h3>
              <p className="text-xs text-gray-400 mb-3">
                แตะบนแผนที่เพื่อปักหมุดจุดที่คุณต้องการรับงาน — งานที่อยู่ในรัศมี {appConfig.riderRadius || 5} กม. จากจุดนี้จะปรากฏในแท็บ "งานใหม่"
              </p>

              {/* แสดงจุดปัจจุบัน */}
              <div className="text-xs text-gray-400 mb-3 space-y-0.5">
                <div>📍 จุดปัจจุบัน: {me.location ? `${me.location.lat.toFixed(4)}, ${me.location.lng.toFixed(4)}` : 'ยังไม่ได้ตั้ง'}</div>
                {riderGPS && <div>📡 GPS จริง: {riderGPS.lat.toFixed(4)}, {riderGPS.lng.toFixed(4)}</div>}
                {pendingLocation && <div className="text-blue-300">🔵 เลือกใหม่: {pendingLocation.lat.toFixed(4)}, {pendingLocation.lng.toFixed(4)}</div>}
              </div>

              {/* แผนที่ */}
              <div className="rounded-xl overflow-hidden border border-blue-500/40 mb-3">
                <InteractiveMap
                  mode="select"
                  userLocation={pendingLocation || me.location || myLocation}
                  onLocationSelect={(loc) => setPendingLocation(loc)}
                  className="h-64"
                />
              </div>
              <p className="text-[10px] text-gray-500 mb-3 text-center">แตะบนแผนที่เพื่อเลือกตำแหน่ง แล้วกดบันทึก</p>

              {/* ปุ่ม GPS อัตโนมัติ */}
              <button
                onClick={() => {
                  if (riderGPS) setPendingLocation(riderGPS);
                  else navigator.geolocation?.getCurrentPosition(
                    pos => setPendingLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                    () => {},
                    { enableHighAccuracy: true, timeout: 8000 },
                  );
                }}
                className="w-full py-2 rounded-lg bg-gray-700 text-gray-300 text-sm font-bold mb-2 hover:bg-gray-600 active:scale-95 transition-all"
              >
                📡 ใช้ตำแหน่ง GPS ปัจจุบัน
              </button>

              {/* ปุ่มบันทึก */}
              <button
                disabled={!pendingLocation || savingLocation}
                onClick={async () => {
                  if (!pendingLocation) return;
                  setSavingLocation(true);
                  await updateRiderWorkingLocation(me.id, pendingLocation);
                  setPendingLocation(null);
                  setSavingLocation(false);
                }}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                  pendingLocation && !savingLocation
                    ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-95'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {savingLocation ? (
                  <><Loader size={16} className="animate-spin" /> กำลังบันทึก...</>
                ) : (
                  <><MapPin size={16} /> บันทึกจุดรับงาน</>
                )}
              </button>
            </div>

            {/* แสดงรัศมีจากจุดปักหมุด */}
            <div className="bg-gray-800 rounded-xl p-3 border border-gray-700 text-xs text-gray-400">
              <p className="font-bold text-white mb-1">📋 สรุปการตั้งค่า</p>
              <p>รัศมีรับงาน: <span className="text-green-400 font-bold">{appConfig.riderRadius || 5} กม.</span></p>
              <p className="mt-1 text-gray-500">หมายเหตุ: GPS จะอัปเดตตำแหน่งคุณเองอัตโนมัติ ส่วนจุดรับงานช่วยให้คำนวณงานที่ใกล้คุณได้เมื่อ GPS ไม่พร้อมใช้งาน</p>
            </div>
          </div>
        )}

        {/* ── Active jobs ─── */}
        {riderTab === 'active' && (
          <>
            {myJobs.length === 0 ? (
              // ✅ FIX: empty state สำหรับ active tab (ป้องกัน white screen)
              <div className="text-center text-gray-500 mt-16 px-4">
                <Bike size={48} className="mx-auto mb-3 opacity-20" />
                <p className="font-bold text-gray-400 text-lg">ไม่มีงานที่กำลังทำอยู่</p>
                <p className="text-sm text-gray-600 mt-1">กดแท็บ "งานใหม่" เพื่อรับงาน</p>
                <button
                  onClick={() => setRiderTab('jobs')}
                  className="mt-4 bg-green-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-green-400"
                >
                  ดูงานใหม่
                </button>
              </div>
            ) : (
              myJobs.map(job => {
                return (
                  <div key={job.id} className="bg-gray-800 p-4 rounded-xl border border-green-500">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="font-bold text-white">{job.restaurantName || 'ส่งพัสดุ'}</span>
                        <div className="text-xs text-gray-400 mt-0.5">#{job.id}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-green-400 font-bold">฿{(job.riderIncome || 0).toFixed(0)}</div>
                        <div className={`text-xs mt-0.5 px-2 py-0.5 rounded-full font-bold ${
                          job.status === 'rider_accepted' ? 'bg-indigo-900 text-indigo-300' :
                          job.status === 'picking_up' ? 'bg-yellow-900 text-yellow-300' :
                          'bg-blue-900 text-blue-300'
                        }`}>
                          {job.status === 'rider_accepted' ? '🟡 กำลังไปรับ' :
                           job.status === 'picking_up' ? '🟠 ถึงจุดรับ' :
                           '🔵 กำลังส่ง'}
                        </div>
                      </div>
                    </div>

                    {job.paymentMethod === 'cash' && (
                      <div className="mb-3 bg-yellow-900/30 border border-yellow-700/40 rounded-xl p-3 space-y-1">
                        <div className="text-sm font-bold text-yellow-300">
                          💰 เก็บเงินสดจาก{job.type === 'parcel' ? 'ผู้รับ' : 'ลูกค้า'}: ฿{(job.grandTotal || 0).toLocaleString()}
                        </div>
                        {(job.adminGP || 0) > 0 && (
                          <div className="text-[11px] text-orange-300">
                            ⚠️ หลังส่งสำเร็จ −฿{(job.adminGP || 0).toFixed(0)} จะหักจากกระเป๋า (ค่า GP platform)
                          </div>
                        )}
                      </div>
                    )}

                    {/* Map */}
                    <div className="mb-3 rounded-lg overflow-hidden border border-green-500/30">
                      <InteractiveMap
                        mode="view"
                        userLocation={job.location}
                        shopLocation={job.pickupLocation}
                        riderLocation={job.riderLocation}
                        status={job.status}
                        className="h-48"
                      />
                    </div>

                    {/* Address info */}
                    <div className="text-xs text-gray-400 mb-3 space-y-1">
                      {job.type === 'food' && <div>🏪 รับที่: {job.restaurantName}</div>}
                      {job.type === 'parcel' && <div>📦 รับที่: {job.pickup}</div>}
                      <div>📍 ส่งที่: {job.address || job.dropoff || 'ที่อยู่ลูกค้า'}</div>
                      <div>👤 ผู้ส่ง: {job.customerName} {job.customerPhone ? `· ${job.customerPhone}` : ''}</div>
                      {job.type === 'parcel' && job.receiverName && (
                        <div>📬 ผู้รับ: {job.receiverName} {job.receiverPhone ? `· ${job.receiverPhone}` : ''}</div>
                      )}
                    </div>

                    {/* ── ติดต่อ ── */}
                    <div className="flex flex-wrap gap-2 mb-2">
                      {job.customerPhone && (
                        <a
                          href={`tel:${job.customerPhone}`}
                          className="flex-1 min-w-[110px] bg-gray-700 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-gray-600 active:scale-95 transition-all"
                        >
                          📞 <span className="ml-1">{job.customerPhone}</span>
                        </a>
                      )}
                      {job.type === 'parcel' && job.receiverPhone && (
                        <a
                          href={`tel:${job.receiverPhone}`}
                          className="flex-1 min-w-[110px] bg-blue-900/40 text-blue-300 border border-blue-700/50 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-blue-900/60 active:scale-95 transition-all"
                        >
                          📞 <span className="ml-1">{job.receiverPhone}</span>
                        </a>
                      )}
                      {job.type === 'food' && (() => {
                        const phone = job.restaurantPhone || restaurants.find(r => r.id === job.restaurantId)?.phone;
                        return phone ? (
                          <a
                            href={`tel:${phone}`}
                            className="flex-1 min-w-[110px] bg-orange-900/40 text-orange-300 border border-orange-700/50 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-orange-900/60 active:scale-95 transition-all"
                          >
                            📞 <span className="ml-1">{phone}</span>
                          </a>
                        ) : null;
                      })()}
                      <button
                        onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'rider')}
                        className="flex-1 min-w-[110px] bg-blue-900/40 text-blue-300 border border-blue-700/50 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-blue-900/60 active:scale-95 transition-all"
                      >
                        <MessageSquare size={13} className="mr-1" /> Admin
                      </button>
                    </div>

                    {/* ขอยกเลิกงาน → Admin */}
                    {hasPendingCancelRequest(job.id) ? (
                      <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
                        <Clock size={13} className="text-yellow-400 shrink-0" />
                        <p className="text-yellow-300 text-xs font-bold">⏳ รอ Admin อนุมัติการยกเลิก</p>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setRiderCancelOrderId(job.id); setRiderCancelReason(''); setShowRiderCancelModal(true); }}
                        className="w-full py-1.5 rounded-lg border border-red-800/50 text-red-400 text-xs font-bold flex items-center justify-center gap-1 hover:bg-red-900/20 mb-3 transition-all"
                      >
                        ✕ ขอยกเลิกงานนี้ (ส่ง Admin)
                      </button>
                    )}

                    {/* ── Step: rider_accepted → picking_up ── */}
                    {job.status === 'rider_accepted' && (
                      <button
                        onClick={() => updateOrderStatus(job.id, 'picking_up')}
                        className="w-full bg-indigo-500 py-3 rounded-xl font-bold text-sm hover:bg-indigo-400 active:scale-95 transition-all"
                      >
                        ✅ ถึงจุดรับแล้ว
                      </button>
                    )}

                    {/* ── Step: picking_up → delivering ── */}
                    {job.status === 'picking_up' && (
                      <button
                        onClick={() => updateOrderStatus(job.id, 'delivering')}
                        className="w-full bg-blue-500 py-3 rounded-xl font-bold text-sm hover:bg-blue-400 active:scale-95 transition-all"
                      >
                        ✅ ยืนยันรับของแล้ว → ออกส่ง
                      </button>
                    )}

                    {/* ── Step: delivering → delivered ── */}
                    {job.status === 'delivering' && (
                      <>
                        {job.paymentMethod === 'cash' && (
                          <div className="bg-yellow-900/40 border border-yellow-600/50 rounded-xl p-3 mb-3">
                            <p className="text-yellow-300 text-sm font-bold mb-0.5">
                              💰 อย่าลืมเก็บเงินสด ฿{(job.grandTotal || 0).toLocaleString()} จาก{job.type === 'parcel' ? 'ผู้รับ' : 'ลูกค้า'}!
                            </p>
                            {(job.adminGP || 0) > 0 && (
                              <p className="text-orange-300 text-[11px]">
                                หลังกดยืนยัน −฿{(job.adminGP || 0).toFixed(0)} หักจากกระเป๋า (ค่า GP)
                              </p>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => updateOrderStatus(job.id, 'delivered')}
                          className="w-full bg-green-500 py-3 rounded-xl font-bold text-sm hover:bg-green-400 active:scale-95 transition-all shadow-lg shadow-green-900/50"
                        >
                          🎉 ยืนยันส่งสำเร็จ!
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ═══════════════════════════ WALLET TAB ═══════════════════════════ */}
        {riderTab === 'wallet' && (() => {
          const pendingWithdrawals = pendingRequests.filter(
            r => r.userId === _walletUid && r.type === 'withdraw'
          );
          const pendingWithdrawTotal = pendingWithdrawals.reduce(
            (sum, r) => sum + (Number(r.data?.amount) || 0), 0
          );
          const effectiveBalance = Math.max(0, (userWallet ?? 0) - pendingWithdrawTotal);
          return (
          <div className="pb-6">
            {/* ── ยอดกระเป๋าหลัก ─────────────────────────────────────────────── */}
            <div className="bg-gray-800 border border-green-600/40 rounded-2xl p-5 mb-4 flex flex-col items-center">
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={18} className="text-green-400" />
                <span className="text-sm text-green-300 font-bold">กระเป๋าเงินหลัก</span>
              </div>
              <div className="text-4xl font-black text-green-400 my-2">
                ฿{Number(userWallet ?? 0).toLocaleString()}
              </div>
              {pendingWithdrawTotal > 0 && (
                <div className="flex flex-col items-center gap-0.5 mb-1">
                  <span className="text-[11px] text-orange-400">⏳ รอถอน −฿{pendingWithdrawTotal.toLocaleString()}</span>
                  <span className="text-xs font-bold text-white">คงเหลือถอนได้ ฿{effectiveBalance.toLocaleString()}</span>
                </div>
              )}
              <p className="text-[11px] text-gray-500 text-center">รายได้จากการส่ง · ถอนเมื่อ Admin อนุมัติ</p>
              <div className="flex gap-3 mt-4 w-full">
                <button
                  onClick={() => { setWalletAction(walletAction === 'topup' ? null : 'topup'); setWalletAmount(''); }}
                  className={`flex-1 text-xs py-2.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
                    walletAction === 'topup' ? 'bg-blue-500 text-white' : 'bg-blue-700/30 text-blue-300 hover:bg-blue-700/50'
                  }`}
                >
                  <ArrowUpCircle size={13} /> เติมเงิน
                </button>
                <button
                  onClick={() => { setWalletAction(walletAction === 'withdraw' ? null : 'withdraw'); setWalletAmount(''); }}
                  className={`flex-1 text-xs py-2.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
                    walletAction === 'withdraw' ? 'bg-orange-500 text-white' : 'bg-orange-700/30 text-orange-300 hover:bg-orange-700/50'
                  }`}
                >
                  <ArrowDownCircle size={13} /> ถอนเงิน
                </button>
              </div>
            </div>

            {/* ── ฟอร์มส่งคำขอ ─────────────────────────────────────────────────── */}
            {walletAction && (
              <div className="bg-gray-800 border border-gray-600 rounded-2xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-white text-sm">
                    {walletAction === 'topup' ? '💳 ขอเติมเงิน' : '💸 ขอถอนเงิน'}
                  </h3>
                  <button
                    onClick={() => { setWalletAction(null); setWalletAmount(''); setWalletBank(''); setWalletAccName(''); setWalletAccNo(''); }}
                    className="text-gray-400 hover:text-white w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-700 transition-all"
                  >✕</button>
                </div>

                {walletAction === 'topup' && (
                  <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3 mb-3 text-xs text-blue-300 leading-relaxed">
                    💡 โอนเงินมาที่บัญชีแอดมิน แล้วแจ้งรายละเอียดด้านล่าง Admin จะเติมเงินให้ภายใน 24 ชม.
                  </div>
                )}
                {walletAction === 'withdraw' && effectiveBalance <= 0 && (
                  <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-3 mb-3 text-xs text-red-300">
                    ⚠️ ยอดที่ถอนได้ = ฿0 ยังไม่สามารถถอนได้
                  </div>
                )}

                <div className="space-y-2">
                  <input
                    type="number"
                    placeholder={walletAction === 'withdraw' ? `จำนวนเงิน (สูงสุด ฿${effectiveBalance.toLocaleString()})` : 'จำนวนเงิน (฿) *'}
                    value={walletAmount}
                    onChange={e => setWalletAmount(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-xl px-3 py-2.5 text-sm border border-gray-600 focus:border-green-500 outline-none placeholder-gray-500"
                  />
                  <input type="text" placeholder="ชื่อธนาคาร (เช่น กสิกร, SCB) *" value={walletBank}
                    onChange={e => setWalletBank(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-xl px-3 py-2.5 text-sm border border-gray-600 focus:border-green-500 outline-none placeholder-gray-500" />
                  <input type="text" placeholder="ชื่อบัญชี *" value={walletAccName}
                    onChange={e => setWalletAccName(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-xl px-3 py-2.5 text-sm border border-gray-600 focus:border-green-500 outline-none placeholder-gray-500" />
                  <input type="text" placeholder="เลขบัญชี *" value={walletAccNo}
                    onChange={e => setWalletAccNo(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-xl px-3 py-2.5 text-sm border border-gray-600 focus:border-green-500 outline-none placeholder-gray-500" />
                </div>

                <button
                  onClick={() => {
                    const amt = parseFloat(walletAmount);
                    if (!amt || amt <= 0) return;
                    const bankInfo = { bank: walletBank, accountName: walletAccName, accountNumber: walletAccNo };
                    setSubmittingWallet(true);
                    try {
                      if (walletAction === 'topup') requestTopUp(amt, null, null, bankInfo);
                      else requestWithdraw(amt, bankInfo);
                      setWalletAction(null); setWalletAmount(''); setWalletBank(''); setWalletAccName(''); setWalletAccNo('');
                    } finally { setSubmittingWallet(false); }
                  }}
                  disabled={
                    submittingWallet || !walletAmount || parseFloat(walletAmount) <= 0 ||
                    !walletBank || !walletAccName || !walletAccNo ||
                    (walletAction === 'withdraw' && (parseFloat(walletAmount) > effectiveBalance || effectiveBalance <= 0))
                  }
                  className="w-full mt-3 bg-green-600 hover:bg-green-500 active:scale-95 text-white py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submittingWallet ? '⏳ กำลังส่ง...' : '📨 ส่งคำขอให้ Admin'}
                </button>
              </div>
            )}

            {/* ── คำขอที่รอ Admin ────────────────────────────────────────────── */}
            {(() => {
              const pending = pendingRequests.filter(r =>
                r.userId === _walletUid && (r.type === 'topup' || r.type === 'withdraw')
              );
              if (!pending.length) return null;
              return (
                <div className="mb-4">
                  <h4 className="text-xs text-yellow-400 font-bold uppercase mb-2">⏳ รอ Admin อนุมัติ ({pending.length})</h4>
                  <div className="space-y-2">
                    {pending.map((req, idx) => {
                      const amt = req.data?.amount ?? req.amount ?? 0;
                      return (
                        <div key={req.id || idx} className="bg-gray-800 border border-yellow-700/30 rounded-xl p-3 flex justify-between items-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            req.type === 'topup' ? 'bg-blue-900/50 text-blue-300' : 'bg-orange-900/50 text-orange-300'
                          }`}>
                            {req.type === 'topup' ? '💰 เติมเงิน' : '💸 ถอนเงิน'}
                          </span>
                          <span className="font-bold text-white text-sm">฿{Number(amt).toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── ประวัติธุรกรรม ─────────────────────────────────────────────── */}
            <h4 className="text-xs text-gray-500 font-bold uppercase mb-2 tracking-wide">ประวัติธุรกรรม</h4>
            {!walletHistory || walletHistory.length === 0 ? (
              <div className="text-center text-gray-600 py-8">
                <Wallet size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm text-gray-500">ยังไม่มีประวัติ — รายได้จะแสดงเมื่อส่งงานสำเร็จ</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...(walletHistory || [])].sort((a, b) => {
                    const ms = (e) => e.createdAtMs || parseInt(((e.id || '').match(/\d{10,}/) || ['0'])[0], 10);
                    return ms(b) - ms(a);
                  }).slice(0, 40).map((entry, i) => {
                  const amt = entry.amount ?? 0;
                  return (
                    <div key={entry.id || i} className="bg-gray-800 rounded-xl p-3 border border-gray-700/80">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-300 truncate">{entry.desc || '—'}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{entry.createdAtMs ? formatDateTimeFromMs(entry.createdAtMs) : (entry.date || '')}</div>
                        </div>
                        <div className={`font-bold text-sm flex-shrink-0 ${amt >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {amt >= 0 ? '+' : '-'}฿{Math.abs(amt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })()}

        {riderTab === 'history' && (
          <div>
            {/* ── ติดต่อ Admin ── */}
            <button
              onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'rider')}
              className="w-full mb-4 bg-blue-900/30 border border-blue-700/40 text-blue-300 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-900/50 active:scale-95 transition-all"
            >
              <MessageSquare size={16} /> ติดต่อเจ้าหน้าที่ (Admin)
            </button>

            {/* ── Earnings summary ── */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <h3 className="text-gray-400 text-xs mb-1">รายได้วันนี้</h3>
                <div className="text-2xl font-bold text-green-400">฿{todayEarning.toFixed(0)}</div>
                <div className="text-xs text-gray-500 mt-1">{todayJobs.length} งาน</div>
              </div>
              <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <h3 className="text-gray-400 text-xs mb-1">รายได้รวมทั้งหมด</h3>
                <div className="text-2xl font-bold text-blue-400">฿{totalEarning.toFixed(0)}</div>
                <div className="text-xs text-gray-500 mt-1">{completedJobs.length} งานสำเร็จ</div>
              </div>
            </div>

            {/* ── Job list ── */}
            <h4 className="font-bold mb-3 text-sm text-gray-400">รายการย้อนหลัง</h4>
            {historyJobs.length === 0 ? (
              <div className="text-center text-gray-600 py-12">
                <Star size={36} className="mx-auto mb-2 opacity-20" />
                <p>ยังไม่มีประวัติการส่ง</p>
              </div>
            ) : (
              historyJobs.map(job => {
                // ✅ FIX: ตรวจสอบทั้ง 'delivered' และ 'completed' (status เปลี่ยนเป็น completed ทันที)
                const isSuccess = job.status === 'delivered' || job.status === 'completed';
                const income = typeof job.riderIncome === 'number' ? job.riderIncome : 0;

                return (
                  <div key={job.id} className="bg-gray-800 p-3 rounded-xl border border-gray-700 mb-2">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="font-bold text-sm text-white truncate">
                          {job.restaurantName || 'ส่งพัสดุ'}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{job.timestamp}</div>
                        {job.status === 'cancelled' && (
                          <div className="text-xs text-red-400 mt-0.5">
                            ยกเลิก: {job.cancelReason || 'ไม่ระบุเหตุผล'}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {isSuccess ? (
                          <>
                            <div className="text-green-400 font-bold">+฿{income.toFixed(0)}</div>
                            <div className="text-[10px] text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full mt-0.5">
                              ✓ จัดส่งสำเร็จ
                            </div>
                          </>
                        ) : (
                          <div className="text-[10px] text-red-400 bg-red-900/30 px-2 py-0.5 rounded-full">
                            ✗ ยกเลิก
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Modal ขอยกเลิกงาน (Rider → Admin) ───────────────────────────── */}
      {showRiderCancelModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-700">
            <div className="bg-red-900 px-5 py-4 flex justify-between items-center">
              <div className="flex items-center gap-2 text-white">
                <XCircle size={20} />
                <h3 className="font-bold text-base">ขอยกเลิกงาน (รอ Admin อนุมัติ)</h3>
              </div>
              <button onClick={() => setShowRiderCancelModal(false)} className="text-white/70 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="p-5">
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-3 py-2 mb-4 flex items-start gap-2">
                <span className="text-yellow-400 mt-0.5">⚠️</span>
                <p className="text-xs text-yellow-300">คำขอยกเลิกจะถูกส่งให้ <strong>Admin</strong> อนุมัติก่อน Admin อาจปฏิเสธหรืออนุมัติการยกเลิก</p>
              </div>
              <p className="text-sm text-gray-300 mb-3">ระบุเหตุผลที่ต้องการยกเลิกงาน</p>
              <div className="space-y-2 mb-3">
                {['ไม่สามารถเข้าถึงจุดรับสินค้า', 'รถเสีย / เกิดอุบัติเหตุ', 'ลูกค้าไม่รับสาย', 'อื่นๆ'].map(preset => (
                  <button
                    key={preset}
                    onClick={() => setRiderCancelReason(preset)}
                    className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-all ${
                      riderCancelReason === preset
                        ? 'bg-red-900/60 border-red-500 text-red-300 font-semibold'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {riderCancelReason === preset ? '● ' : '○ '}{preset}
                  </button>
                ))}
              </div>
              <textarea
                value={riderCancelReason}
                onChange={e => setRiderCancelReason(e.target.value)}
                placeholder="หรือพิมพ์เหตุผลเพิ่มเติม..."
                className="w-full bg-gray-700 border border-gray-600 rounded-xl p-3 text-sm text-white placeholder-gray-500 resize-none h-16 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowRiderCancelModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-700 text-gray-300 font-bold text-sm hover:bg-gray-600 active:scale-95 transition-all"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => {
                  requestCancelByRole(riderCancelOrderId, riderCancelReason, 'rider');
                  setShowRiderCancelModal(false);
                }}
                disabled={!riderCancelReason.trim()}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                  riderCancelReason.trim()
                    ? 'bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/50'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                ส่งคำขอถึง Admin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
