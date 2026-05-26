import React, { useState } from 'react';
import {
  Bike, User, MessageSquare, Camera, Image as ImageIcon, AlertCircle,
  ToggleLeft, ToggleRight, TrendingUp, Clock, DollarSign, Star, Loader, MapPin,
  XCircle, X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import InteractiveMap from '../components/InteractiveMap';
import { getDistanceFromLatLonInKm } from '../utils';
import { USER_LOCATION } from '../constants';

export default function RiderView() {
  const {
    activeRole, setActiveRole,
    riderTab, setRiderTab,
    orders, riders, appConfig,
    userProfile, currentUser,
    riderJobPhotos,
    acceptOrder,
    updateOrderStatus,
    requestCancelByRole,
    hasPendingCancelRequest,
    handleRiderPhotoUpload,
    openChatWindow,
    setProfileSubView, setActiveTab,
    updateRiderWorkingLocation,
    FIREBASE_ENABLED,
  } = useApp();

  // ── state สำหรับปุ่ม "รับงาน" ──────────────────────────────────────────────
  const [acceptingId, setAcceptingId] = useState(null); // orderId ที่กำลัง pending
  const [savingLocation, setSavingLocation] = useState(false);
  const [pendingLocation, setPendingLocation] = useState(null); // ตำแหน่งที่เลือกบนแผนที่ แต่ยังไม่ save

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
  const todayStr = new Date().toLocaleDateString('th-TH');
  const todayJobs = completedJobs.filter(j => j.timestamp && j.timestamp.includes(todayStr));
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
      </div>

      <div className="px-4 space-y-4">
        {riderTab === 'jobs' && availableJobs.map(job => (
          <div key={job.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            {/* Header: ร้าน / ประเภทงาน + รายได้ */}
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="font-bold text-white">{job.restaurantName || (job.type === 'parcel' ? '📦 ส่งพัสดุ' : 'งาน')}</span>
                <div className="text-xs text-gray-500 mt-0.5">#{job.id.slice(-6)}</div>
              </div>
              <div className="text-right">
                <div className="text-green-400 font-bold text-base">฿{(job.riderIncome || 0).toFixed(0)}</div>
                <div className="text-xs text-gray-500">รายได้ไรเดอร์</div>
              </div>
            </div>

            {/* ยอดรวมออเดอร์ + วิธีชำระ */}
            <div className={`mb-2 text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 ${
              job.paymentMethod === 'cash'
                ? 'bg-blue-900/60 text-blue-200'
                : 'bg-gray-700 text-gray-300'
            }`}>
              {job.paymentMethod === 'cash'
                ? <>💰 <span>เก็บเงินสดจากลูกค้า: <strong>฿{(job.grandTotal || 0).toLocaleString()}</strong></span></>
                : <>👛 <span>ชำระผ่าน Wallet · ยอดรวม: ฿{(job.grandTotal || 0).toLocaleString()}</span></>
              }
            </div>

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

            {/* ปุ่มรับงาน */}
            <button
              disabled={acceptingId === job.id}
              onClick={async () => {
                setAcceptingId(job.id);
                await acceptOrder(job.id, me.id, myLocation);
                setAcceptingId(null);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                acceptingId === job.id
                  ? 'bg-gray-600 cursor-not-allowed text-gray-400'
                  : 'bg-green-500 hover:bg-green-400 active:scale-95 text-white shadow-lg shadow-green-900/40'
              }`}
            >
              {acceptingId === job.id ? (
                <><Loader size={16} className="animate-spin" /> กำลังรับงาน...</>
              ) : (
                <>✅ รับงาน — ได้รับ ฿{(job.riderIncome || 0).toFixed(0)}</>
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
                const pickupPhoto = riderJobPhotos[job.id]?.pickup;
                const deliveryPhoto = riderJobPhotos[job.id]?.delivery;

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
                      <div className="mb-3 text-sm font-bold text-blue-300 bg-blue-900/40 p-2.5 rounded-lg">
                        💰 เก็บเงินสดจากลูกค้า: ฿{(job.grandTotal || 0).toLocaleString()}
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
                      <div>👤 ลูกค้า: {job.customerName} {job.customerPhone ? `· ${job.customerPhone}` : ''}</div>
                    </div>

                    {/* Chat buttons — ลูกค้า / ร้านค้า / Admin */}
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() => openChatWindow(job.id + '-rider', job.customerName || 'ลูกค้า', 'rider')}
                        className="flex-1 bg-gray-700 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-gray-600 active:scale-95 transition-all"
                      >
                        <MessageSquare size={13} className="mr-1" /> แชทลูกค้า
                      </button>
                      {job.type === 'food' && (
                        <button
                          onClick={() => openChatWindow(job.id + '-rider-merchant', job.restaurantName || 'ร้านค้า', 'rider')}
                          className="flex-1 bg-orange-900/40 text-orange-300 border border-orange-700/50 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-orange-900/60 active:scale-95 transition-all"
                        >
                          <MessageSquare size={13} className="mr-1" /> แชทร้านค้า
                        </button>
                      )}
                      <button
                        onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'rider')}
                        className="flex-1 bg-blue-900/40 text-blue-300 border border-blue-700/50 py-2 rounded-lg flex items-center justify-center font-bold text-xs hover:bg-blue-900/60 active:scale-95 transition-all"
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

                    {/* ── Step: picking_up → delivering (พร้อมรูปถ่าย) ── */}
                    {job.status === 'picking_up' && (
                      <>
                        <p className="text-xs text-gray-400 mb-2 font-bold">📷 ถ่ายรูปสินค้าก่อนรับ:</p>
                        <div className="flex gap-2 mb-2">
                          <label className="flex-1 py-3 rounded-xl border-2 border-dashed border-gray-600 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700 hover:border-gray-500 text-sm">
                            <Camera size={16} className="mr-1.5" /> ถ่ายรูป
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleRiderPhotoUpload(job.id, 'pickup', e)} />
                          </label>
                          <label className="flex-1 py-3 rounded-xl border-2 border-dashed border-gray-600 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700 hover:border-gray-500 text-sm">
                            <ImageIcon size={16} className="mr-1.5" /> อัลบั้ม
                            <input type="file" accept="image/*" className="hidden" onChange={e => handleRiderPhotoUpload(job.id, 'pickup', e)} />
                          </label>
                        </div>
                        {pickupPhoto && (
                          <img src={pickupPhoto} className="mb-2 h-36 w-full object-cover rounded-xl border border-green-500/50" alt="pickup" />
                        )}
                        <button
                          disabled={!pickupPhoto}
                          onClick={() => {
                            if (!pickupPhoto) return;
                            updateOrderStatus(job.id, 'delivering', null, { pickupPhoto });
                          }}
                          className={`w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                            pickupPhoto
                              ? 'bg-blue-500 text-white hover:bg-blue-400'
                              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          {pickupPhoto ? '✅ ยืนยันรับของแล้ว → ออกส่ง' : '⏳ รอถ่ายรูปสินค้าก่อน'}
                        </button>
                      </>
                    )}

                    {/* ── Step: delivering → delivered (พร้อมรูปถ่าย) ── */}
                    {job.status === 'delivering' && (
                      <>
                        <p className="text-xs text-gray-400 mb-2 font-bold">📷 ถ่ายรูปหลักฐานการส่ง:</p>
                        <div className="flex gap-2 mb-2">
                          <label className="flex-1 py-3 rounded-xl border-2 border-dashed border-gray-600 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700 hover:border-gray-500 text-sm">
                            <Camera size={16} className="mr-1.5" /> ถ่ายรูป
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleRiderPhotoUpload(job.id, 'delivery', e)} />
                          </label>
                          <label className="flex-1 py-3 rounded-xl border-2 border-dashed border-gray-600 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700 hover:border-gray-500 text-sm">
                            <ImageIcon size={16} className="mr-1.5" /> อัลบั้ม
                            <input type="file" accept="image/*" className="hidden" onChange={e => handleRiderPhotoUpload(job.id, 'delivery', e)} />
                          </label>
                        </div>
                        {deliveryPhoto && (
                          <img src={deliveryPhoto} className="mb-2 h-36 w-full object-cover rounded-xl border border-green-500/50" alt="delivery" />
                        )}
                        <button
                          disabled={!deliveryPhoto}
                          onClick={() => {
                            if (!deliveryPhoto) return;
                            updateOrderStatus(job.id, 'delivered', null, { deliveryPhoto });
                          }}
                          className={`w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                            deliveryPhoto
                              ? 'bg-green-500 text-white hover:bg-green-400 shadow-lg shadow-green-900/50'
                              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          {deliveryPhoto ? '🎉 ยืนยันส่งสำเร็จ!' : '⏳ รอถ่ายรูปหลักฐานก่อน'}
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

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
