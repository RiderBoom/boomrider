import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Home, ShoppingBag, User, MapPin, Clock,
  Search, ArrowLeft, Star, Package,
  Navigation, Utensils, Wallet, ChevronRight,
  Repeat, LogOut, Settings, MessageSquare,
  Plus, Minus, Trash2, Save, Bell, Check, ArrowDownCircle,
  Camera, Crosshair, Banknote, Receipt, ShieldAlert,
  Bike, ChefHat, X, Edit, Tag, CheckCircle, RefreshCw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { subscribeToRiderLocation } from '../firebase/firestore';
import { getDistanceFromLatLonInKm, formatDateTimeFromMs } from '../utils';
import RestaurantCard from '../components/RestaurantCard';
import InteractiveMap from '../components/InteractiveMap';
import ToastContainer from '../components/ToastContainer';
import PromptPayQR from '../components/PromptPayQR';

const CATEGORIES = ['ทั้งหมด', 'Street Food', 'Fast Food', 'Japanese', 'Italian', 'Dessert', 'Thai'];

export default function CustomerView() {
  const {
    activeRole, setActiveRole,
    activeTab, setActiveTab,
    profileSubView, setProfileSubView,
    serviceType, setServiceType,
    orders, restaurants, riders, menuItems, appConfig,
    userProfile, setUserProfile,
    userRoles,
    userAddresses,
    userWallet, walletHistory,
    tempProfile, setTempProfile,
    cart, setCart,
    selectedRestaurant, setSelectedRestaurant,
    parcelDetails, setParcelDetails,
    paymentMethod, setPaymentMethod,
    parcelMapTarget, setParcelMapTarget,
    parcelDistance, parcelEstimate,
    newAddr, setNewAddr,
    withdrawMode, setWithdrawMode,
    withdrawAmount, setWithdrawAmount,
    withdrawBank, setWithdrawBank,
    withdrawAccount, setWithdrawAccount,
    withdrawName, setWithdrawName,
    merchantRegForm, setMerchantRegForm,
    riderRegForm, setRiderRegForm,
    showTopUpModal, setShowTopUpModal,
    topUpSlip, setTopUpSlip,
    showRatingModal, setShowRatingModal,
    ratingOrderData,
    openRatingModal,
    submitRating,
    pendingRequests,
    isAdmin,
    toasts, removeToast, notifySystem,
    addToCart, calculateFoodTotal, calculateDeliveryFee, placeOrder, placeParcelOrder,
    handleParcelMapSelect,
    handleMapLocationSelect, getCurrentLocationForForm, getCurrentLocationForParcel,
    handleUpdateUserLocation,
    handleAddAddress, handleUpdateAddress, handleDeleteAddress,
    handleProfilePhotoChange, handleTopUpSlipSelect,
    handleRegistrationPhotoSelect,
    handleSaveProfile, profileUploading,
    requestTopUp, requestWithdraw,
    requestRegisterMerchant, requestRegisterRider,
    openChatWindow, handleLogout,
    isPending, syncRoles,
    currentUser,
    updateOrderStatus,
    requestCancelOrder,
    hasPendingCancelRequest,
    forceRefresh,
    openImagePreview,
    isDataLoading,
    // Promo
    validatePromoCode, usePromoCode,
  } = useApp();

  // ── Local state ────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ทั้งหมด');
  const [promoInput, setPromoInput] = useState('');
  const [promoResult, setPromoResult] = useState(null); // { valid, discount, message }
  const [showPromoField, setShowPromoField] = useState(false);

  // ── Cancel request modal state ────────────────────────────────────────
  const [showCancelReqModal, setShowCancelReqModal] = useState(false);
  const [cancelReqOrderId, setCancelReqOrderId]     = useState(null);
  const [cancelReqReason,  setCancelReqReason]      = useState('');

  // ── Rating modal state ────────────────────────────────────────────────
  const [ratingRestaurantStars, setRatingRestaurantStars] = useState(5);
  const [ratingRiderStars,      setRatingRiderStars]      = useState(5);
  const [ratingComment,         setRatingComment]         = useState('');

  // ── Live tracking fullscreen state ───────────────────────────────────
  const [trackingOrderId, setTrackingOrderId] = useState(null);

  // ETA helper: distance km ÷ avg rider speed 30 km/h
  const calcETA = (fromLoc, toLoc) => {
    if (!fromLoc || !toLoc) return null;
    const km = getDistanceFromLatLonInKm(fromLoc.lat, fromLoc.lng, toLoc.lat, toLoc.lng);
    const mins = Math.max(1, Math.ceil((km / 30) * 60));
    return { km: km.toFixed(1), mins };
  };

  // ── Refresh button spinning state ────────────────────────────────────
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await forceRefresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  // ── Address pin state ─────────────────────────────────────────────────
  const [editingAddrId, setEditingAddrId] = useState(null);
  const [editAddrPinLoc, setEditAddrPinLoc] = useState(null);
  const [editAddrSaving, setEditAddrSaving] = useState(false);
  const [newAddrMode, setNewAddrMode] = useState(false);

  // ── User main location pin state ──────────────────────────────────────
  const [userPinLoc, setUserPinLoc] = useState(null);   // เลือกแล้วแต่ยังไม่ save
  const [userPinSaving, setUserPinSaving] = useState(false);

  // ── Rider live location — subscribed from rider_locations/{riderUid} ──────
  const [riderLocations, setRiderLocations] = useState({}); // { [orderId]: {lat,lng} }
  const riderLocUnsubs = useRef({});  // { [orderId]: unsubscribe fn }

  useEffect(() => {
    const trackingStatuses = ['rider_accepted', 'picking_up', 'delivering'];
    const activeOrders = orders.filter(
      o => trackingStatuses.includes(o.status) && o.riderUid,
    );
    const activeIds = new Set(activeOrders.map(o => o.id));

    // Unsubscribe orders that are no longer active
    Object.keys(riderLocUnsubs.current).forEach(id => {
      if (!activeIds.has(id)) {
        riderLocUnsubs.current[id]();
        delete riderLocUnsubs.current[id];
        setRiderLocations(prev => { const n = { ...prev }; delete n[id]; return n; });
      }
    });

    // Subscribe to new active orders
    activeOrders.forEach(o => {
      if (riderLocUnsubs.current[o.id]) return; // already subscribed
      riderLocUnsubs.current[o.id] = subscribeToRiderLocation(o.riderUid, (loc) => {
        setRiderLocations(prev => ({ ...prev, [o.id]: loc }));
      });
    });

    return () => {
      Object.values(riderLocUnsubs.current).forEach(unsub => unsub());
      riderLocUnsubs.current = {};
    };
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

  const restaurantsWithDistance = useMemo(() => restaurants.map(r => {
    const dist = getDistanceFromLatLonInKm(
      userProfile.location.lat, userProfile.location.lng,
      r.location.lat, r.location.lng,
    );
    return { ...r, distance: dist };
  }), [restaurants, userProfile.location]);

  // Filtered restaurants — search + category
  const visibleRestaurants = useMemo(() => {
    let list = restaurantsWithDistance.filter(r => r.status !== 'banned');
    if (selectedCategory !== 'ทั้งหมด') {
      list = list.filter(r => r.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r => {
        if (r.name?.toLowerCase().includes(q)) return true;
        if (r.category?.toLowerCase().includes(q)) return true;
        const items = menuItems[r.id] || [];
        return items.some(m => m.name?.toLowerCase().includes(q) || m.desc?.toLowerCase().includes(q));
      });
    }
    return list;
  }, [restaurantsWithDistance, selectedCategory, searchQuery, menuItems]);

  // Promo helpers
  const promoDiscount = promoResult?.valid ? (promoResult.discount || 0) : 0;

  const handleApplyPromo = () => {
    if (!promoInput.trim()) return;
    const foodTotal = calculateFoodTotal();
    const deliveryFee = cart.length > 0 ? calculateDeliveryFee(cart[0].distance) : 0;
    const total = foodTotal + deliveryFee;
    const result = validatePromoCode(promoInput.trim(), total);
    setPromoResult(result);
    if (result.valid) {
      notifySystem('สำเร็จ', `ใช้โค้ด ${promoInput.toUpperCase()} ส่วนลด ฿${result.discount}`, 'success');
    } else {
      notifySystem('ผิดพลาด', result.message, 'error');
    }
  };

  const handleCartQty = (itemId, delta) => {
    setCart(prev => {
      const updated = prev.map(c => c.id === itemId ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0);
      return updated;
    });
  };

  // orders ที่ยังอยู่ระหว่างดำเนินการ — รวมทั้ง food/parcel ที่ 'delivered' รอลูกค้ายืนยัน
  const activityBadge = orders.filter(o =>
    (
      ['pending', 'preparing', 'ready_to_pickup', 'rider_accepted', 'picking_up', 'delivering', 'delivered'].includes(o.status)
    ) &&
    (o.customerId === userProfile.id || o.customerId === currentUser?.id),
  ).length;

  return (
    <div className="pb-20 pt-14 bg-gray-50 min-h-screen">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {(activeTab !== 'profile' || profileSubView === 'main') && (
        <div className="bg-white px-4 pt-4 pb-3 shadow-sm sticky top-12 z-40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-md shadow-orange-200">
                <span className="text-white text-lg">🛵</span>
              </div>
              <span className="font-black text-xl tracking-tight gradient-text">BoomRider</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">สวัสดี,</span>
              <span className="text-xs font-semibold text-gray-700 max-w-[80px] truncate">{(userProfile.name || 'ผู้ใช้').split(' ')[0]}</span>
              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="ml-1 p-1.5 rounded-full bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-400 active:scale-90 transition-all"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-gray-100 px-3 py-2.5 rounded-2xl">
            <Search size={18} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาร้านอาหาร เมนู..."
              className="bg-transparent outline-none flex-1 text-sm text-gray-700 placeholder-gray-400"
              aria-label="ค้นหา"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}
      {activeTab === 'profile' && profileSubView !== 'main' && (
        <div className="bg-white p-4 shadow-sm sticky top-12 z-40 flex items-center mb-4">
          <button onClick={() => setProfileSubView('main')} className="mr-4 p-1 hover:bg-gray-100 rounded-full"><ArrowLeft /></button>
          <h2 className="text-xl font-bold">เมนูจัดการ</h2>
        </div>
      )}

      {/* Home Tab */}
      {activeTab === 'home' && !selectedRestaurant && (
        <div className="px-4 py-3">
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setServiceType('food')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all duration-200 ${serviceType === 'food' ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'bg-white text-gray-600 shadow-sm'}`}
            ><Utensils size={18} /> สั่งอาหาร</button>
            <button
              onClick={() => setServiceType('parcel')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all duration-200 ${serviceType === 'parcel' ? 'bg-blue-500 text-white shadow-lg shadow-blue-200' : 'bg-white text-gray-600 shadow-sm'}`}
            ><Package size={18} /> ส่งพัสดุ</button>
          </div>

          {serviceType === 'food' ? (
            <>
              {/* Category filter */}
              {!searchQuery && (
                <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1 scrollbar-hide">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                        selectedCategory === cat
                          ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                          : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              <div className="featured-banner mb-5">
                <div className="relative z-10">
                  <div className="text-xs font-semibold text-orange-200 uppercase tracking-wider mb-1">ยินดีต้อนรับสู่ BoomRider</div>
                  <h2 className="text-xl font-black text-white leading-tight mb-1">สั่งอาหาร<br />ส่งพัสดุ ง่ายๆ!</h2>
                  <p className="text-orange-100 text-xs mb-3">บริการครอบคลุมทั่วกรุงเทพและปริมณฑล</p>
                  <button
                    onClick={() => { setServiceType('parcel'); }}
                    className="bg-white text-orange-600 text-xs font-bold px-4 py-1.5 rounded-full"
                  >ส่งพัสดุเดี๋ยวนี้ →</button>
                </div>
              </div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-800">
                  {searchQuery ? `ผลการค้นหา "${searchQuery}"` : selectedCategory === 'ทั้งหมด' ? 'ร้านใกล้คุณ' : selectedCategory}
                </h2>
                <span className="text-xs text-orange-500 font-medium">{visibleRestaurants.length} ร้าน</span>
              </div>
              {visibleRestaurants.length === 0 && (
                isDataLoading && !searchQuery && selectedCategory === 'ทั้งหมด' ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-white rounded-2xl p-3 flex gap-3 shadow-sm animate-pulse">
                        <div className="w-20 h-20 rounded-xl bg-gray-200 flex-shrink-0" />
                        <div className="flex-1 space-y-2 py-1">
                          <div className="h-4 bg-gray-200 rounded w-3/4" />
                          <div className="h-3 bg-gray-200 rounded w-1/2" />
                          <div className="h-3 bg-gray-200 rounded w-2/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 text-gray-400">
                    <Search size={40} className="mx-auto mb-2 opacity-20" />
                    <p className="font-medium">ไม่พบร้านอาหารที่ค้นหา</p>
                    <button onClick={() => { setSearchQuery(''); setSelectedCategory('ทั้งหมด'); }} className="mt-2 text-orange-500 text-sm underline">ล้างการค้นหา</button>
                  </div>
                )
              )}
              <div className="stagger">
                {visibleRestaurants.map(rest => (
                  <div key={rest.id} className="animate-fade-in-up">
                    <RestaurantCard
                      rest={rest}
                      appConfig={appConfig}
                      onSelect={setSelectedRestaurant}
                      userProfile={userProfile}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="bg-white p-5 rounded-xl shadow-sm">
              <h2 className="font-bold text-lg mb-4 text-blue-600 flex items-center"><Package className="mr-2" /> บริการส่งพัสดุด่วน</h2>
              <div className="space-y-3">
                <p className="text-xs text-gray-500 text-center">ค่าบริการเริ่มต้น {appConfig.baseFee}บ. + {appConfig.perKmFee}บ./กม.</p>
                <div className="mb-4">
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setParcelMapTarget('pickup')}
                      className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${parcelMapTarget === 'pickup' ? 'bg-green-500 text-white shadow-md shadow-green-200' : 'bg-gray-100 text-gray-600'}`}
                    >
                      📍 จุดรับของ{parcelDetails.pickupLocation ? ' ✓' : ''}
                    </button>
                    <button
                      onClick={() => setParcelMapTarget('dropoff')}
                      className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${parcelMapTarget === 'dropoff' ? 'bg-red-500 text-white shadow-md shadow-red-200' : 'bg-gray-100 text-gray-600'}`}
                    >
                      🏁 จุดส่งของ{parcelDetails.dropoffLocation ? ' ✓' : ''}
                    </button>
                  </div>
                  <InteractiveMap
                    mode="select"
                    isParcel={true}
                    activeParcelTarget={parcelMapTarget}
                    shopLocation={parcelDetails.pickupLocation}
                    userLocation={parcelDetails.dropoffLocation}
                    centerOverride={
                      parcelMapTarget === 'pickup'
                        ? (parcelDetails.pickupLocation || userProfile?.location)
                        : parcelMapTarget === 'dropoff'
                          ? (parcelDetails.dropoffLocation || userProfile?.location)
                          : (userProfile?.location || undefined)
                    }
                    onLocationSelect={handleParcelMapSelect}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-sm text-gray-500">จุดรับของ</label>
                    <button
                      onClick={() => getCurrentLocationForParcel('pickup')}
                      className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-green-200 active:scale-95 transition-transform"
                    >
                      <Crosshair size={12} /> ตำแหน่งปัจจุบัน
                    </button>
                  </div>
                  <div className="flex items-center border rounded-lg p-2 bg-gray-50">
                    <MapPin size={18} className="text-green-500 mr-2 flex-shrink-0" />
                    <input value={parcelDetails.pickup} onChange={e => setParcelDetails({ ...parcelDetails, pickup: e.target.value })} type="text" placeholder="ระบุจุดรับ..." className="w-full outline-none bg-transparent text-sm" />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-sm text-gray-500">จุดส่งของ</label>
                    <button
                      onClick={() => getCurrentLocationForParcel('dropoff')}
                      className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-red-200 active:scale-95 transition-transform"
                    >
                      <Crosshair size={12} /> ตำแหน่งปัจจุบัน
                    </button>
                  </div>
                  <div className="flex items-center border rounded-lg p-2 bg-gray-50">
                    <Navigation size={18} className="text-red-500 mr-2 flex-shrink-0" />
                    <input value={parcelDetails.dropoff} onChange={e => setParcelDetails({ ...parcelDetails, dropoff: e.target.value })} type="text" placeholder="ระบุจุดส่ง..." className="w-full outline-none bg-transparent text-sm" />
                  </div>
                </div>
                <div><label className="text-sm text-gray-500">น้ำหนักพัสดุ (kg)</label><input value={parcelDetails.weight} onChange={e => setParcelDetails({ ...parcelDetails, weight: e.target.value })} type="number" className="border rounded-lg p-2 mt-1 w-full" /></div>
                {/* ── ข้อมูลผู้รับ ── */}
                <div className="bg-blue-50 rounded-xl p-3 space-y-2 border border-blue-100">
                  <p className="text-xs font-bold text-blue-700">📬 ข้อมูลผู้รับ (สำหรับให้ไรเดอร์ติดต่อ)</p>
                  <div>
                    <label className="text-xs text-gray-500">ชื่อผู้รับ</label>
                    <input
                      value={parcelDetails.receiverName || ''}
                      onChange={e => setParcelDetails({ ...parcelDetails, receiverName: e.target.value })}
                      type="text"
                      placeholder="ชื่อ-นามสกุลผู้รับ"
                      className="border rounded-lg p-2 mt-1 w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">เบอร์โทรผู้รับ</label>
                    <input
                      value={parcelDetails.receiverPhone || ''}
                      onChange={e => setParcelDetails({ ...parcelDetails, receiverPhone: e.target.value })}
                      type="tel"
                      placeholder="0xx-xxx-xxxx"
                      className="border rounded-lg p-2 mt-1 w-full text-sm"
                    />
                  </div>
                </div>

                {parcelDistance > 0 && (
                  <div className="bg-blue-50 p-3 rounded-xl text-center my-2 border border-blue-200">
                    <p className="text-sm font-bold text-blue-800">
                      📏 ระยะทาง {parcelDistance.toFixed(1)} กม. &nbsp;|&nbsp; ค่าส่ง ฿{parcelEstimate}
                    </p>
                    <p className="text-xs text-blue-500 mt-0.5">คำนวณจากจุดรับถึงจุดส่ง</p>
                  </div>
                )}

                <div className="flex items-center space-x-2 mt-2 p-2 bg-gray-50 rounded-lg">
                  <span className="text-sm font-bold">ชำระเงิน:</span>
                  <button onClick={() => setPaymentMethod('wallet')} className={`flex-1 py-1 text-xs rounded border ${paymentMethod === 'wallet' ? 'bg-green-100 border-green-500 text-green-700' : 'bg-white border-gray-300'}`}>Wallet</button>
                  <button onClick={() => setPaymentMethod('cash')} className={`flex-1 py-1 text-xs rounded border ${paymentMethod === 'cash' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300'}`}>เงินสด</button>
                </div>
                <button onClick={placeParcelOrder} className="w-full bg-green-500 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-green-600 mt-4">คำนวณราคา & เรียกแมส</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selected Restaurant / Menu */}
      {selectedRestaurant && (
        <div className="min-h-screen bg-gray-50 animate-fade-in">
          <div className="relative h-52">
            <img src={selectedRestaurant.image} className="w-full h-full object-cover" alt={selectedRestaurant.name} loading="eager" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />
            <button onClick={() => setSelectedRestaurant(null)} className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm p-2 rounded-full shadow-lg active:scale-90 transition-transform" aria-label="ย้อนกลับ">
              <ArrowLeft size={20} className="text-gray-800" />
            </button>
            <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1 shadow">
              <Star size={13} className="text-yellow-500 fill-current" />
              <span className="text-sm font-bold">{selectedRestaurant.rating}</span>
            </div>
          </div>
          <div className="bg-white px-4 pt-4 pb-3 border-b border-gray-100">
            <h1 className="text-xl font-black text-gray-900 mb-1">{selectedRestaurant.name}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="flex items-center gap-1"><Clock size={13} /> {selectedRestaurant.time}</span>
              <span className="text-gray-300">•</span>
              <span>{selectedRestaurant.distance} กม.</span>
              <span className="text-gray-300">•</span>
              <span className="text-orange-600 font-semibold">ค่าส่ง ฿{calculateDeliveryFee(selectedRestaurant.distance)}</span>
            </div>
          </div>
          <div className="px-4 pt-4 pb-40">
            <h2 className="font-bold text-lg text-gray-800 mb-3">เมนูทั้งหมด</h2>
            <div className="space-y-3">
              {menuItems[selectedRestaurant.id] && menuItems[selectedRestaurant.id].length > 0 ? (
                menuItems[selectedRestaurant.id].map(item => (
                  <div key={item.id} className={`bg-white rounded-2xl p-3 flex items-center gap-3 shadow-sm ${!item.available ? 'opacity-50' : ''}`}>
                    {item.image && (
                      <img src={item.image} className="w-20 h-20 object-cover rounded-xl flex-shrink-0 bg-gray-100" alt={item.name} loading="lazy" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</h3>
                          {!item.available && <span className="text-red-500 text-xs font-bold"> (หมด)</span>}
                          <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{item.desc}</p>
                          <p className="font-bold text-gray-900 mt-1.5">฿{item.price}</p>
                        </div>
                        <button
                          disabled={!item.available}
                          onClick={() => addToCart(item, selectedRestaurant.id, selectedRestaurant.name, selectedRestaurant.distance)}
                          className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 transition-all active:scale-90 ${item.available ? 'bg-orange-500 text-white shadow-md shadow-orange-200' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
                          aria-label={`เพิ่ม ${item.name}`}
                        >+</button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <ChefHat size={40} className="mx-auto mb-2 opacity-30" />
                  <p>ยังไม่มีเมนูอาหาร</p>
                </div>
              )}
            </div>
          </div>

          {cart.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.12)] px-4 pt-3 pb-safe rounded-t-3xl z-50 animate-slide-in-from-bottom">
              {/* Cart items */}
              <div className="max-h-32 overflow-y-auto mb-3 space-y-1.5">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 flex-1 truncate">{item.name}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleCartQty(item.id, -1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-orange-100 text-gray-600 hover:text-orange-600"><Minus size={14} /></button>
                      <span className="text-sm font-bold w-5 text-center">{item.qty}</span>
                      <button onClick={() => handleCartQty(item.id, 1)} className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white hover:bg-orange-600"><Plus size={14} /></button>
                      <span className="text-xs font-bold text-gray-500 w-14 text-right">฿{(item.price * item.qty).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Promo code */}
              {!showPromoField ? (
                <button onClick={() => setShowPromoField(true)} className="text-xs text-orange-500 underline flex items-center gap-1 mb-2">
                  <Tag size={12} /> ใช้โค้ดส่วนลด
                </button>
              ) : (
                <div className="flex gap-2 mb-2">
                  <input
                    value={promoInput}
                    onChange={e => setPromoInput(e.target.value.toUpperCase())}
                    placeholder="กรอกโค้ดส่วนลด"
                    className="flex-1 border border-orange-200 rounded-lg px-3 py-1.5 text-sm font-mono uppercase focus:outline-none focus:border-orange-400"
                    maxLength={20}
                  />
                  <button onClick={handleApplyPromo} className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">ใช้</button>
                  <button onClick={() => { setShowPromoField(false); setPromoInput(''); setPromoResult(null); }} className="text-gray-400 hover:text-gray-600 px-2"><X size={16} /></button>
                </div>
              )}
              {promoResult?.valid && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 mb-2 flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle size={14} /> ส่วนลด <strong>฿{promoResult.discount}</strong>
                </div>
              )}

              <div className="flex justify-between items-center mb-2 text-sm text-gray-500">
                <span>ค่าอาหาร</span><span>฿{calculateFoodTotal().toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center mb-2 text-sm text-gray-500">
                <span>ค่าส่ง</span><span>฿{calculateDeliveryFee(cart[0].distance)}</span>
              </div>
              {promoDiscount > 0 && (
                <div className="flex justify-between items-center mb-2 text-sm text-green-600 font-semibold">
                  <span>ส่วนลด</span><span>-฿{promoDiscount}</span>
                </div>
              )}
              <div className="flex justify-between items-center mb-3 font-black text-lg">
                <span>รวม</span>
                <span className="text-orange-600">฿{Math.max(0, calculateFoodTotal() + calculateDeliveryFee(cart[0].distance) - promoDiscount).toLocaleString()}</span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-gray-500 flex items-center gap-1"><Banknote size={13} /> ชำระ:</span>
                <button onClick={() => setPaymentMethod('wallet')} className={`flex-1 py-2 text-sm rounded-xl border font-bold transition-all ${paymentMethod === 'wallet' ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}>Wallet</button>
                <button onClick={() => setPaymentMethod('cash')} className={`flex-1 py-2 text-sm rounded-xl border font-bold transition-all ${paymentMethod === 'cash' ? 'bg-blue-500 text-white border-blue-500 shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}>เงินสด</button>
              </div>
              <button onClick={() => {
                if (promoResult?.valid) usePromoCode(promoInput);
                placeOrder(promoDiscount);
              }} className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-xl shadow-orange-200 active:scale-95 transition-transform">
                สั่งอาหาร ฿{Math.max(0, calculateFoodTotal() + calculateDeliveryFee(cart[0].distance) - promoDiscount).toLocaleString()}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="p-4 min-h-screen pb-24">
          {profileSubView === 'main' ? (
            <>
              <div className="bg-white p-6 rounded-2xl shadow-sm mb-4 flex items-center">
                <div className="w-16 h-16 bg-gray-200 rounded-full overflow-hidden mr-4 relative">
                  <img src={userProfile.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userProfile.name || 'User') + '&background=fb923c&color=fff&size=64'} alt="Profile" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer text-white"><Edit size={20} /></div>
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{userProfile.name}</h2>
                  <div className="text-gray-500 text-sm">ID: {userProfile.id}</div>
                </div>
              </div>
              <div className="flex gap-2 mb-6">
                <button onClick={() => setProfileSubView('wallet')} className="flex-1 bg-gradient-to-r from-green-600 to-green-500 p-4 rounded-2xl shadow-lg text-white flex justify-between items-center">
                  <div className="flex items-center"><Wallet className="mr-2" /><span className="font-bold text-sm">฿{userWallet.toFixed(2)}</span></div>
                </button>
                <button onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'customer')} className="flex-1 bg-blue-600 p-4 rounded-2xl shadow-lg text-white flex justify-center items-center font-bold text-sm">
                  <MessageSquare className="mr-2" /> ติดต่อเจ้าหน้าที่
                </button>
              </div>
              <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                <div className="p-4 border-b bg-gray-50 font-bold text-gray-700 text-sm">เมนูพาร์ทเนอร์</div>
                {userRoles.includes('merchant') ? (
                  <button onClick={() => setActiveRole('merchant')} className="w-full p-4 flex items-center justify-between hover:bg-green-50 border-b">
                    <span className="text-green-700 font-bold">สลับไปร้านค้า</span><Repeat size={20} />
                  </button>
                ) : isPending('merchant_reg') ? (
                  <div className="p-4 text-gray-400 border-b flex items-center justify-between bg-gray-50">
                    <span>สมัครร้านค้า (รออนุมัติ...)</span>
                    <button onClick={syncRoles} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200 flex items-center gap-1 ml-2">
                      <Repeat size={12} /> ตรวจสอบ
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setProfileSubView('reg_merchant')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
                    <span>สมัครเปิดร้านอาหาร</span><ChevronRight size={20} />
                  </button>
                )}
                {userRoles.includes('rider') ? (
                  <button onClick={() => setActiveRole('rider')} className="w-full p-4 flex items-center justify-between hover:bg-blue-50">
                    <span className="text-blue-700 font-bold">สลับไปไรเดอร์</span><Repeat size={20} />
                  </button>
                ) : isPending('rider_reg') ? (
                  <div className="p-4 text-gray-400 flex items-center justify-between bg-gray-50">
                    <span>สมัครไรเดอร์ (รออนุมัติ...)</span>
                    <button onClick={syncRoles} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200 flex items-center gap-1 ml-2">
                      <Repeat size={12} /> ตรวจสอบ
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setProfileSubView('reg_rider')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50">
                    <span>สมัครขับ BoomRider</span><ChevronRight size={20} />
                  </button>
                )}
                <button onClick={handleLogout} className="w-full p-4 flex items-center justify-between hover:bg-red-50 border-t">
                  <span className="text-red-600 font-bold">ออกจากระบบ</span><LogOut size={20} className="text-red-600" />
                </button>
              </div>
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* ── ตำแหน่งปัจจุบัน ── */}
                <button
                  onClick={() => { setProfileSubView('pin_location'); setUserPinLoc(null); }}
                  className="w-full p-4 flex items-center justify-between hover:bg-blue-50 border-b"
                >
                  <div className="flex items-center">
                    <div className="bg-blue-100 p-2 rounded-lg text-blue-600 mr-3"><MapPin size={20} /></div>
                    <div className="text-left">
                      <div className="font-medium">ตำแหน่งของฉัน</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {userProfile.location
                          ? `${userProfile.location.lat.toFixed(4)}, ${userProfile.location.lng.toFixed(4)}`
                          : 'ยังไม่ได้ตั้ง'}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-gray-400" />
                </button>
                <button onClick={() => setProfileSubView('address')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
                  <div className="flex items-center"><div className="bg-gray-100 p-2 rounded-lg text-gray-600 mr-3"><MapPin size={20} /></div><span>ที่อยู่ของฉัน</span></div>
                  <ChevronRight size={20} className="text-gray-400" />
                </button>
                <button onClick={() => setProfileSubView('edit_profile')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
                  <div className="flex items-center"><div className="bg-gray-100 p-2 rounded-lg text-gray-600 mr-3"><Settings size={20} /></div><span>ตั้งค่า/แก้ไขโปรไฟล์</span></div>
                  <ChevronRight size={20} className="text-gray-400" />
                </button>
              </div>
            </>
          ) : profileSubView === 'wallet' ? (
            <div className="p-4 pt-0 bg-white min-h-[50vh]">
              <div className="bg-gradient-to-r from-green-600 to-green-500 p-8 rounded-2xl shadow-lg text-white mb-6 text-center">
                <p className="text-green-100 mb-2">ยอดเงินคงเหลือ</p>
                <h1 className="text-4xl font-bold mb-6">฿{userWallet.toFixed(2)}</h1>
                {!withdrawMode ? (
                  <div className="grid grid-cols-3 gap-4">
                    {[100, 500, 1000].map(amount => (
                      <button key={amount} onClick={() => { setWithdrawAmount(amount.toString()); setShowTopUpModal(true); }} className="bg-white/20 hover:bg-white/30 py-2 rounded-lg font-bold backdrop-blur-sm">+฿{amount}</button>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm space-y-2">
                    <input type="number" placeholder="ระบุจำนวนเงิน" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full text-black p-2 rounded text-center font-bold" />
                    <input type="text" placeholder="ชื่อธนาคาร (เช่น กสิกร)" value={withdrawBank} onChange={(e) => setWithdrawBank(e.target.value)} className="w-full text-black p-2 rounded text-sm" />
                    <input type="text" placeholder="เลขบัญชี" value={withdrawAccount} onChange={(e) => setWithdrawAccount(e.target.value)} className="w-full text-black p-2 rounded text-sm" />
                    <input type="text" placeholder="ชื่อบัญชี" value={withdrawName} onChange={(e) => setWithdrawName(e.target.value)} className="w-full text-black p-2 rounded text-sm" />
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => setWithdrawMode(false)} className="flex-1 bg-gray-500 py-2 rounded font-bold">ยกเลิก</button>
                      <button onClick={() => {
                        if (withdrawAmount > 0 && withdrawBank && withdrawAccount && withdrawName) {
                          requestWithdraw(parseFloat(withdrawAmount), { bank: withdrawBank, account: withdrawAccount, name: withdrawName });
                          setWithdrawMode(false); setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount('');
                        } else { alert("กรุณากรอกข้อมูลให้ครบถ้วน"); }
                      }} className="flex-1 bg-white text-green-600 py-2 rounded font-bold">ยืนยันถอน</button>
                    </div>
                  </div>
                )}
                {!withdrawMode && <button onClick={() => setWithdrawMode(true)} className="mt-4 text-sm text-green-100 underline flex items-center justify-center w-full"><ArrowDownCircle size={16} className="mr-1" /> ต้องการถอนเงิน?</button>}
              </div>
              <h3 className="font-bold text-base mb-3 text-gray-700">ประวัติธุรกรรม</h3>
              {walletHistory.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีประวัติธุรกรรม</div>
              ) : (
                <div className="space-y-2">
                  {[...walletHistory].sort((a, b) => {
                      const ms = (e) => e.createdAtMs || parseInt(((e.id || '').match(/\d{10,}/) || ['0'])[0], 10);
                      return ms(b) - ms(a);
                    }).map(tx => {
                    const amt = tx.amount ?? 0;
                    const isIncome = amt >= 0;
                    return (
                      <div key={tx.id} className="flex justify-between items-center gap-3 p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-800 text-sm truncate">{tx.desc || '—'}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{tx.createdAtMs ? formatDateTimeFromMs(tx.createdAtMs) : (tx.date || '')}</div>
                        </div>
                        <span className={`font-bold text-sm flex-shrink-0 ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                          {isIncome ? '+' : '-'}฿{Math.abs(amt).toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : profileSubView === 'pin_location' ? (
            <div className="p-4 pt-0">
              <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-4 mb-4">
                <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
                  <MapPin size={18} className="text-blue-500" /> ตำแหน่งของฉัน
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  ตำแหน่งนี้ใช้คำนวณระยะทางร้านค้าใกล้บ้าน และเป็นที่อยู่เริ่มต้นสำหรับสั่งอาหาร
                </p>

                {/* ตำแหน่งปัจจุบัน */}
                <div className="text-xs mb-3 space-y-0.5">
                  <div className="text-gray-500">
                    📍 ตำแหน่งตอนนี้:{' '}
                    {userProfile.location
                      ? <span className="text-gray-700 font-medium">{userProfile.location.lat.toFixed(4)}, {userProfile.location.lng.toFixed(4)}</span>
                      : <span className="text-red-400 font-bold">ยังไม่ได้ตั้ง</span>}
                  </div>
                  {userPinLoc && (
                    <div className="text-blue-600 font-bold">
                      🔵 เลือกใหม่: {userPinLoc.lat.toFixed(4)}, {userPinLoc.lng.toFixed(4)}
                    </div>
                  )}
                </div>

                {/* แผนที่ */}
                <div className="rounded-xl overflow-hidden border-2 border-blue-200 mb-2">
                  <InteractiveMap
                    mode="select"
                    userLocation={userPinLoc || userProfile.location}
                    onLocationSelect={(loc) => setUserPinLoc(loc)}
                    className="h-64"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-center mb-3">แตะบนแผนที่เพื่อปักหมุดตำแหน่งของคุณ</p>

                {/* GPS อัตโนมัติ */}
                <button
                  onClick={() => {
                    if (!navigator.geolocation) return notifySystem('ไม่รองรับ', 'Browser นี้ไม่รองรับ GPS', 'error');
                    navigator.geolocation.getCurrentPosition(
                      pos => setUserPinLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                      () => notifySystem('ไม่สามารถดึง GPS', 'กรุณาแตะแผนที่เพื่อเลือกตำแหน่ง', 'error'),
                      { enableHighAccuracy: true, timeout: 8000 },
                    );
                  }}
                  className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold mb-3 flex items-center justify-center gap-2 hover:bg-gray-200 active:scale-95 transition-all"
                >
                  <Crosshair size={15} /> ใช้ GPS ตำแหน่งปัจจุบัน
                </button>

                {/* บันทึก */}
                <button
                  disabled={!userPinLoc || userPinSaving}
                  onClick={async () => {
                    if (!userPinLoc) return;
                    setUserPinSaving(true);
                    await handleUpdateUserLocation(userPinLoc);
                    setUserPinSaving(false);
                    setUserPinLoc(null);
                    setProfileSubView('main');
                  }}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                    userPinLoc && !userPinSaving
                      ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-95 shadow-lg shadow-blue-100'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {userPinSaving
                    ? <><Save size={16} className="animate-spin" /> กำลังบันทึก...</>
                    : <><MapPin size={16} /> บันทึกตำแหน่งของฉัน</>}
                </button>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                <p className="font-bold">📋 ตำแหน่งของฉันมีผลต่อ:</p>
                <p>• <strong>ร้านค้า</strong> — เรียงตามระยะทางจากตำแหน่งของคุณ</p>
                <p>• <strong>ค่าส่ง</strong> — คำนวณจากตำแหน่งร้านถึงตำแหน่งของคุณ</p>
                <p>• <strong>ส่งพัสดุ</strong> — ใช้เป็นตำแหน่งเริ่มต้นของจุดรับ</p>
              </div>
            </div>

          ) : profileSubView === 'address' ? (
            <div className="p-4 pt-0">

              {/* ── หัว + ปุ่มเพิ่มใหม่ ─────────────────────────────── */}
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">ที่อยู่ของฉัน</h3>
                <button
                  onClick={() => { setNewAddrMode(v => !v); setEditingAddrId(null); }}
                  className={`text-sm font-bold px-3 py-1.5 rounded-full flex items-center gap-1 ${newAddrMode ? 'bg-gray-200 text-gray-600' : 'bg-green-500 text-white'}`}
                >
                  {newAddrMode ? '✕ ยกเลิก' : <><Plus size={14} /> เพิ่มที่อยู่</>}
                </button>
              </div>

              {/* ── รายการที่อยู่ที่มีอยู่ ────────────────────────────── */}
              <div className="space-y-3 mb-5">
                {userAddresses.map(addr => (
                  <div key={addr.id}>
                    {/* Card */}
                    <div className={`border-2 rounded-xl overflow-hidden transition-all ${editingAddrId === addr.id ? 'border-blue-400' : 'border-gray-200'}`}>
                      <div className="p-3 flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold flex items-center gap-1">
                            <MapPin size={15} className="text-green-500 flex-shrink-0" />
                            {addr.label}
                          </div>
                          <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{addr.address}</p>
                          {addr.location && (
                            <p className="text-gray-400 text-[10px] mt-0.5">
                              {addr.location.lat.toFixed(4)}, {addr.location.lng.toFixed(4)}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2 flex-shrink-0">
                          <button
                            onClick={() => {
                              if (editingAddrId === addr.id) {
                                setEditingAddrId(null); setEditAddrPinLoc(null);
                              } else {
                                setEditingAddrId(addr.id);
                                setEditAddrPinLoc(null);
                                setNewAddrMode(false);
                              }
                            }}
                            className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-0.5 ${editingAddrId === addr.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-500'}`}
                          >
                            <MapPin size={13} /> {editingAddrId === addr.id ? 'ปิด' : 'แก้หมุด'}
                          </button>
                          <button
                            onClick={() => handleDeleteAddress(addr.id)}
                            className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:bg-red-100"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* ── แผนที่แก้หมุดที่อยู่เดิม (inline expand) ── */}
                      {editingAddrId === addr.id && (
                        <div className="border-t border-blue-100 bg-blue-50 p-3">
                          <p className="text-xs text-blue-700 font-bold mb-2">📍 แตะแผนที่เพื่อย้ายหมุดที่อยู่นี้</p>

                          <div className="rounded-xl overflow-hidden border-2 border-blue-300 mb-2">
                            <InteractiveMap
                              mode="select"
                              userLocation={editAddrPinLoc || addr.location || userProfile.location}
                              onLocationSelect={(loc) => setEditAddrPinLoc(loc)}
                              className="h-56"
                            />
                          </div>

                          {editAddrPinLoc && (
                            <p className="text-xs text-blue-600 font-bold mb-2 text-center">
                              🔵 เลือกแล้ว: {editAddrPinLoc.lat.toFixed(4)}, {editAddrPinLoc.lng.toFixed(4)}
                            </p>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                navigator.geolocation?.getCurrentPosition(
                                  pos => setEditAddrPinLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                                  () => notifySystem('ไม่สามารถดึง GPS', 'กรุณาแตะแผนที่แทน', 'error'),
                                  { enableHighAccuracy: true, timeout: 8000 },
                                );
                              }}
                              className="flex-1 py-2 rounded-lg bg-white border border-blue-200 text-blue-600 text-xs font-bold flex items-center justify-center gap-1 hover:bg-blue-50"
                            >
                              <Crosshair size={13} /> GPS ปัจจุบัน
                            </button>
                            <button
                              disabled={!editAddrPinLoc || editAddrSaving}
                              onClick={async () => {
                                if (!editAddrPinLoc) return;
                                setEditAddrSaving(true);
                                await handleUpdateAddress(addr.id, editAddrPinLoc);
                                setEditAddrSaving(false);
                                setEditingAddrId(null);
                                setEditAddrPinLoc(null);
                              }}
                              className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                                editAddrPinLoc && !editAddrSaving
                                  ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-95'
                                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                              }`}
                            >
                              {editAddrSaving ? (
                                <><Save size={13} className="animate-spin" /> บันทึก...</>
                              ) : (
                                <><Save size={13} /> บันทึกหมุด</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {userAddresses.length === 0 && !newAddrMode && (
                  <div className="text-center py-10 text-gray-400">
                    <MapPin size={36} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">ยังไม่มีที่อยู่ กดปุ่ม "เพิ่มที่อยู่" เพื่อเพิ่ม</p>
                  </div>
                )}
              </div>

              {/* ── Form เพิ่มที่อยู่ใหม่ ─────────────────────────────── */}
              {newAddrMode && (
                <div className="bg-gray-50 border-2 border-green-200 p-4 rounded-2xl">
                  <h4 className="font-bold text-green-700 mb-3 flex items-center gap-1"><MapPin size={15} /> เพิ่มที่อยู่ใหม่</h4>

                  {/* แผนที่ */}
                  <div className="rounded-xl overflow-hidden border-2 border-green-300 mb-2">
                    <InteractiveMap
                      mode="select"
                      userLocation={newAddr.location || userProfile.location}
                      onLocationSelect={handleMapLocationSelect}
                      className="h-60"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 text-center mb-3">แตะบนแผนที่เพื่อปักหมุดตำแหน่ง</p>

                  {/* GPS */}
                  <button
                    onClick={getCurrentLocationForForm}
                    className="w-full py-2 rounded-lg bg-white border border-green-200 text-green-600 text-sm font-bold mb-3 flex items-center justify-center gap-1 hover:bg-green-50 active:scale-95 transition-all"
                  >
                    <Crosshair size={14} /> ใช้ GPS ตำแหน่งปัจจุบัน
                  </button>

                  {newAddr.location && (
                    <p className="text-xs text-green-600 font-bold text-center mb-3">
                      ✅ ปักหมุดแล้ว: {newAddr.location.lat.toFixed(4)}, {newAddr.location.lng.toFixed(4)}
                    </p>
                  )}

                  <input
                    value={newAddr.label}
                    onChange={e => setNewAddr({ ...newAddr, label: e.target.value })}
                    placeholder="ชื่อสถานที่ เช่น บ้าน, ที่ทำงาน"
                    className="w-full p-2.5 border rounded-lg mb-2 text-sm"
                  />
                  <textarea
                    value={newAddr.fullAddr}
                    onChange={e => setNewAddr({ ...newAddr, fullAddr: e.target.value })}
                    placeholder="รายละเอียดเพิ่มเติม / จุดสังเกต (ไม่บังคับ)"
                    rows={2}
                    className="w-full p-2.5 border rounded-lg mb-3 text-sm resize-none"
                  />
                  <button
                    onClick={() => {
                      if (!newAddr.label) return notifySystem("ผิดพลาด", "กรุณาใส่ชื่อสถานที่", "error");
                      if (!newAddr.location) return notifySystem("ผิดพลาด", "กรุณาปักหมุดบนแผนที่ก่อน", "error");
                      const addrText = newAddr.fullAddr || `${newAddr.location.lat.toFixed(5)}, ${newAddr.location.lng.toFixed(5)}`;
                      handleAddAddress({ ...newAddr, fullAddr: addrText });
                      setNewAddr({ label: '', fullAddr: '', location: null });
                      setNewAddrMode(false);
                    }}
                    className="w-full bg-green-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-500 active:scale-95 transition-all"
                  >
                    <Save size={16} /> บันทึกที่อยู่
                  </button>
                </div>
              )}
            </div>
          ) : profileSubView === 'edit_profile' ? (
            <div className="p-4 pt-0">
              <div className="flex justify-center mb-6">
                <label className="w-24 h-24 bg-gray-200 rounded-full overflow-hidden relative cursor-pointer">
                  <img src={tempProfile.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(tempProfile.name || 'User') + '&background=fb923c&color=fff&size=96'} className="w-full h-full object-cover" alt="profile" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                    {profileUploading ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Camera />}
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleProfilePhotoChange} disabled={profileUploading} />
                </label>
              </div>
              <div className="space-y-4">
                <div><label className="text-sm text-gray-500">ชื่อ-นามสกุล</label><input value={tempProfile.name} onChange={e => setTempProfile({ ...tempProfile, name: e.target.value })} className="w-full border-b py-2 outline-none font-medium text-lg" /></div>
                <div><label className="text-sm text-gray-500">เบอร์โทรศัพท์</label><input value={tempProfile.phone} onChange={e => setTempProfile({ ...tempProfile, phone: e.target.value })} className="w-full border-b py-2 outline-none font-medium text-lg" /></div>
                <div><label className="text-sm text-gray-500">อีเมล</label><input value={tempProfile.email} onChange={e => setTempProfile({ ...tempProfile, email: e.target.value })} className="w-full border-b py-2 outline-none font-medium text-lg" /></div>
                <button onClick={handleSaveProfile} disabled={profileUploading} className={`w-full bg-green-600 text-white py-3 rounded-lg font-bold mt-8 transition-opacity ${profileUploading ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  {profileUploading ? 'กำลังอัปโหลดรูป...' : 'บันทึกการเปลี่ยนแปลง'}
                </button>
              </div>
            </div>
          ) : profileSubView === 'reg_merchant' ? (
            <div className="p-4 pt-0">
              <div className="bg-orange-50 p-4 rounded-xl mb-6 text-center"><ChefHat size={48} className="text-orange-500 mx-auto mb-2" /><h2 className="text-xl font-bold text-orange-700">ลงทะเบียนร้านค้า (KYC)</h2></div>
              <div className="space-y-4">
                <div><label className="font-bold mb-1 block">ชื่อร้านค้า</label><input value={merchantRegForm.shopName} onChange={e => setMerchantRegForm({ ...merchantRegForm, shopName: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                <div className="mb-4">
                  <label className="text-sm mb-1 block">รูปหน้าร้าน (Shop Image)</label>
                  <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${merchantRegForm.shopImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                    {merchantRegForm.shopImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRegistrationPhotoSelect(e, setMerchantRegForm, 'shopImage')} />
                  </label>
                  {merchantRegForm.shopImage && <img src={merchantRegForm.shopImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="shop" />}
                </div>
                <div><label className="font-bold mb-1 block">หมวดหมู่</label><select value={merchantRegForm.category} onChange={e => setMerchantRegForm({ ...merchantRegForm, category: e.target.value })} className="w-full border p-2 rounded-lg"><option>Street Food</option><option>Fast Food</option><option>Japanese</option><option>Italian</option><option>Dessert</option></select></div>
                <div className="pt-2 border-t mt-2">
                  <h4 className="font-bold text-gray-700 mb-2">ข้อมูลเจ้าของร้าน (ยืนยันตัวตน)</h4>
                  <div><label className="text-sm mb-1 block">ชื่อ-นามสกุล</label><input value={merchantRegForm.realName} onChange={e => setMerchantRegForm({ ...merchantRegForm, realName: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
                  <div><label className="text-sm mb-1 block">เลขบัตรประชาชน</label><input value={merchantRegForm.idCard} onChange={e => setMerchantRegForm({ ...merchantRegForm, idCard: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
                  <div><label className="text-sm mb-1 block">เบอร์โทรศัพท์</label><input value={merchantRegForm.phone} onChange={e => setMerchantRegForm({ ...merchantRegForm, phone: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div><label className="text-sm mb-1 block">ธนาคาร</label><input value={merchantRegForm.bankName} onChange={e => setMerchantRegForm({ ...merchantRegForm, bankName: e.target.value })} className="w-full border p-2 rounded-lg" placeholder="กสิกร, ไทยพาณิชย์..." /></div>
                    <div><label className="text-sm mb-1 block">เลขที่บัญชี</label><input value={merchantRegForm.bankAccount} onChange={e => setMerchantRegForm({ ...merchantRegForm, bankAccount: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                  </div>
                  <div className="mb-4">
                    <label className="text-sm mb-1 block">รูปถ่ายบัตรประชาชน</label>
                    <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${merchantRegForm.idCardImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                      {merchantRegForm.idCardImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRegistrationPhotoSelect(e, setMerchantRegForm, 'idCardImage')} />
                    </label>
                    {merchantRegForm.idCardImage && <img src={merchantRegForm.idCardImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="id" />}
                  </div>
                </div>
                <button onClick={() => requestRegisterMerchant(merchantRegForm)} className="w-full bg-orange-500 text-white py-3 rounded-lg font-bold shadow-lg">ส่งใบสมัคร</button>
              </div>
            </div>
          ) : (
            <div className="p-4 pt-0">
              <div className="bg-blue-50 p-4 rounded-xl mb-6 text-center"><Bike size={48} className="text-blue-500 mx-auto mb-2" /><h2 className="text-xl font-bold text-blue-700">สมัครขับ BoomRider (KYC)</h2></div>
              <div className="space-y-4">
                <div><label className="font-bold mb-1 block">ชื่อ-นามสกุล (ผู้ขับขี่)</label><input value={riderRegForm.realName} onChange={e => setRiderRegForm({ ...riderRegForm, realName: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                <div><label className="font-bold mb-1 block">ประเภทพาหนะ</label><select value={riderRegForm.vehicle} onChange={e => setRiderRegForm({ ...riderRegForm, vehicle: e.target.value })} className="w-full border p-2 rounded-lg"><option value="Motorcycle">รถจักรยานยนต์</option><option value="Car">รถยนต์</option></select></div>
                <div className="pt-2 border-t mt-2">
                  <h4 className="font-bold text-gray-700 mb-2">ข้อมูลยืนยันตัวตน</h4>
                  <div><label className="text-sm mb-1 block">เลขบัตรประชาชน</label><input value={riderRegForm.idCard} onChange={e => setRiderRegForm({ ...riderRegForm, idCard: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
                  <div><label className="text-sm mb-1 block">เบอร์โทรศัพท์</label><input value={riderRegForm.phone} onChange={e => setRiderRegForm({ ...riderRegForm, phone: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div><label className="text-sm mb-1 block">ธนาคาร</label><input value={riderRegForm.bankName} onChange={e => setRiderRegForm({ ...riderRegForm, bankName: e.target.value })} className="w-full border p-2 rounded-lg" placeholder="กสิกร, ไทยพาณิชย์..." /></div>
                    <div><label className="text-sm mb-1 block">เลขที่บัญชี</label><input value={riderRegForm.bankAccount} onChange={e => setRiderRegForm({ ...riderRegForm, bankAccount: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                  </div>
                  <div className="mb-4">
                    <label className="text-sm mb-1 block">รูปถ่ายบัตรประชาชน</label>
                    <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${riderRegForm.idCardImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                      {riderRegForm.idCardImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRegistrationPhotoSelect(e, setRiderRegForm, 'idCardImage')} />
                    </label>
                    {riderRegForm.idCardImage && <img src={riderRegForm.idCardImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="id" />}
                  </div>
                </div>
                <button onClick={() => requestRegisterRider(riderRegForm)} className="w-full bg-blue-500 text-white py-3 rounded-lg font-bold shadow-lg">ส่งใบสมัคร</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {activeTab === 'activity' && (() => {
        const myOrders = orders.filter(o =>
          o.customerId === userProfile.id || o.customerId === currentUser?.id,
        );
        // กำลังดำเนินการ: สถานะปกติ + 'delivered' (ทุกประเภท) ที่รอลูกค้ายืนยัน
        const inProgress = myOrders.filter(o =>
          ['pending', 'preparing', 'ready_to_pickup', 'rider_accepted', 'picking_up', 'delivering', 'delivered'].includes(o.status),
        );
        // แสดง "จบงานแล้ว" เฉพาะออเดอร์ที่เพิ่งจบภายใน 2 ชั่วโมง
        // 'delivered' ยังรออยู่ใน inProgress → ไม่แสดงซ้ำที่นี่
        const now = Date.now();
        const justDone = myOrders.filter(o => {
          if (o.status !== 'completed') return false;
          if (!o.completedAt) return true;
          return (now - new Date(o.completedAt).getTime()) < 2 * 60 * 60 * 1000;
        });
        // ประวัติ: completed ที่เก่ากว่า 2 ชม. และ cancelled
        const history = myOrders.filter(o => {
          if (!['completed', 'cancelled'].includes(o.status)) return false;
          if (o.status === 'completed') {
            if (!o.completedAt) return false;
            if ((now - new Date(o.completedAt).getTime()) < 2 * 60 * 60 * 1000) return false;
          }
          return true;
        });
        return (
          <div className="p-4">
            {inProgress.length > 0 && (
              <>
                <h2 className="text-lg font-bold mb-3 text-orange-600 flex items-center gap-2"><Bike size={18} /> กำลังดำเนินการ ({inProgress.length})</h2>
                {inProgress.map(order => {
                  const STATUS_LABELS = {
                    pending:         { label: 'รอร้านรับออเดอร์',          color: 'bg-orange-100 text-orange-600' },
                    preparing:       { label: 'กำลังเตรียมอาหาร',          color: 'bg-blue-100 text-blue-600' },
                    ready_to_pickup: { label: 'รอไรเดอร์รับงาน',           color: 'bg-purple-100 text-purple-600' },
                    rider_accepted:  { label: 'ไรเดอร์รับงานแล้ว',         color: 'bg-indigo-100 text-indigo-600' },
                    picking_up:      { label: 'ไรเดอร์ถึงจุดรับแล้ว',      color: 'bg-indigo-100 text-indigo-700' },
                    delivering:      { label: '🛵 กำลังส่งของหาคุณ!',      color: 'bg-blue-100 text-blue-700' },
                    delivered:       { label: '📦 ไรเดอร์ถึงที่หมายแล้ว!', color: 'bg-teal-100 text-teal-700' },
                  };
                  const s = STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-600' };
                  // ไรเดอร์ถึงที่หมายแล้ว → ไฮไลท์กรอบสีเขียว รอลูกค้ายืนยัน
                  const cardBorder = order.status === 'delivered'
                    ? 'border-2 border-teal-400'
                    : 'border border-orange-100';
                  return (
                    <div key={order.id} className={`bg-white mb-4 rounded-2xl shadow-sm overflow-hidden ${cardBorder}`}>
                      <div className="p-4 border-b border-orange-50">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-bold text-gray-900">
                              {order.type === 'parcel' ? '📦 ส่งพัสดุด่วน' : order.restaurantName}
                            </h3>
                            <p className="text-xs text-gray-400 mt-0.5">{order.id} · {order.timestamp}</p>
                          </div>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${s.color}`}>{s.label}</span>
                        </div>
                        {order.type === 'parcel' && (
                          <div className="bg-blue-50 rounded-lg p-2.5 space-y-1.5">
                            <div className="flex items-start gap-2">
                              <MapPin size={13} className="text-green-600 mt-0.5 flex-shrink-0" />
                              <span className="text-xs text-gray-700"><span className="font-semibold text-green-700">รับ: </span>{order.pickup}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <Navigation size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
                              <span className="text-xs text-gray-700"><span className="font-semibold text-red-600">ส่ง: </span>{order.dropoff}</span>
                            </div>
                            {order.distance > 0 && (
                              <p className="text-xs text-gray-400 pl-5">ระยะทาง {order.distance} กม. · {order.weight} kg</p>
                            )}
                          </div>
                        )}
                        {/* ── ปุ่มขอยกเลิก / สถานะรอ Admin — ซ่อนเมื่อไรเดอร์ถึงที่หมายแล้ว ── */}
                        {order.status !== 'delivered' && (
                          <div className="mt-2">
                            {hasPendingCancelRequest(order.id) ? (
                              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 flex items-center gap-2">
                                <Clock size={13} className="text-yellow-500 shrink-0" />
                                <div>
                                  <p className="text-yellow-700 font-bold text-xs">⏳ รอ Admin อนุมัติการยกเลิก</p>
                                  <p className="text-yellow-600 text-[11px] mt-0.5">คำขอยกเลิกกำลังรอการตรวจสอบ</p>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setCancelReqOrderId(order.id); setCancelReqReason(''); setShowCancelReqModal(true); }}
                                className="w-full text-center text-xs text-gray-400 hover:text-red-500 py-1.5 hover:bg-red-50 rounded-lg transition-all border border-dashed border-gray-200 hover:border-red-200"
                              >
                                ✕ ขอยกเลิกออเดอร์นี้
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* ── Live Tracking Panel ── */}
                      {['rider_accepted', 'picking_up', 'delivering'].includes(order.status) && (() => {
                        const rLoc = riderLocations[order.id] ?? order.riderLocation;
                        const dest = order.status === 'picking_up'
                          ? order.pickupLocation
                          : order.location;
                        const eta  = calcETA(rLoc, dest);
                        const isDelivering = order.status === 'delivering';
                        return (
                          <div className="border-t border-blue-50">
                            {/* ETA Info Bar */}
                            <div className={`px-4 py-2.5 flex items-center justify-between ${isDelivering ? 'bg-blue-600' : 'bg-indigo-50'}`}>
                              <div className="flex items-center gap-2">
                                <span className={`text-lg ${isDelivering ? '' : ''}`}>🛵</span>
                                <div>
                                  <p className={`text-xs font-bold ${isDelivering ? 'text-white' : 'text-indigo-700'}`}>
                                    {order.riderName || 'ไรเดอร์'}
                                  </p>
                                  <p className={`text-[10px] ${isDelivering ? 'text-blue-100' : 'text-indigo-400'}`}>
                                    {isDelivering ? 'กำลังมาส่งให้คุณ!' : order.status === 'picking_up' ? 'กำลังรับของ' : 'รับงานแล้ว'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {eta && (
                                  <div className={`text-right ${isDelivering ? 'text-white' : 'text-indigo-700'}`}>
                                    <p className="text-xs font-black">~{eta.mins} นาที</p>
                                    <p className={`text-[10px] ${isDelivering ? 'text-blue-100' : 'text-indigo-400'}`}>{eta.km} กม.</p>
                                  </div>
                                )}
                                <button
                                  onClick={() => setTrackingOrderId(order.id)}
                                  className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${isDelivering ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'} active:scale-95 transition-all`}
                                >
                                  <MapPin size={11} /> เต็มจอ
                                </button>
                              </div>
                            </div>
                            {/* Mini Map — h-72 + autoFollow เมื่อกำลังส่ง, h-44 ระหว่างรับของ */}
                            <InteractiveMap
                              mode="view"
                              userLocation={order.location}
                              shopLocation={order.pickupLocation}
                              riderLocation={rLoc}
                              trackingMode
                              autoFollow={isDelivering}
                              className={isDelivering ? 'h-72' : 'h-44'}
                            />
                          </div>
                        );
                      })()}
                      {/* ── ยอดชำระ / สถานะการจ่ายเงิน ── */}
                      {order.status === 'delivered' ? (
                        /* ไรเดอร์ถึงที่หมายแล้ว: แสดงข้อมูลการชำระเงินให้ชัดเจน */
                        order.paymentMethod === 'cash' ? (
                          <div className="px-4 py-3 bg-orange-100 border-t border-orange-200 flex items-center gap-3">
                            <Banknote size={22} className="text-orange-600 shrink-0" />
                            <div className="flex-1">
                              <p className="text-orange-800 font-bold text-sm">เตรียมจ่ายเงินสดให้ไรเดอร์</p>
                              <p className="text-orange-600 text-xs mt-0.5">ยอดที่ต้องจ่าย <span className="font-black text-base text-orange-700">฿{(order.grandTotal || 0).toLocaleString()}</span></p>
                            </div>
                          </div>
                        ) : (
                          <div className="px-4 py-2.5 bg-green-50 border-t border-green-100 flex items-center gap-2">
                            <span className="text-base">👛</span>
                            <span className="text-xs text-green-700 font-semibold">ตัดเงินจาก Wallet แล้ว — ไม่ต้องจ่ายเพิ่ม</span>
                          </div>
                        )
                      ) : (
                        <div className="px-4 py-2 bg-orange-50 border-t border-orange-100 flex items-center justify-between">
                          <div className="text-xs text-gray-500">
                            {order.paymentMethod === 'cash' ? '💵 ชำระเงินสด' : '👛 ตัดจาก Wallet'}
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-gray-400 mr-1">ยอดชำระ</span>
                            <span className="text-lg font-black text-orange-600">฿{(order.grandTotal || 0).toLocaleString()}</span>
                          </div>
                        </div>
                      )}
                      {/* ── ปุ่มยืนยันรับสินค้า/อาหาร — แสดงเมื่อไรเดอร์ถึงที่หมายแล้ว ── */}
                      {order.status === 'delivered' && (
                        <div className="px-3 pt-2 pb-3">
                          <button
                            onClick={() => {
                              updateOrderStatus(order.id, 'completed');
                              setRatingRestaurantStars(5);
                              setRatingRiderStars(5);
                              setRatingComment('');
                              openRatingModal(order);
                            }}
                            className="w-full bg-teal-500 text-white py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-teal-400 active:scale-95 transition-all shadow-lg shadow-teal-900/20 animate-pulse"
                          >
                            <CheckCircle size={18} />
                            {order.type === 'parcel' ? 'ยืนยันรับสินค้าเรียบร้อยแล้ว' : 'ยืนยันรับอาหารเรียบร้อยแล้ว'}
                          </button>
                          <p className="text-center text-xs text-gray-400 mt-1.5">
                            {order.paymentMethod === 'cash'
                              ? '✅ ตรวจสอบรูปหลักฐานด้านบน แล้วกดหลังรับของและจ่ายเงินให้ไรเดอร์'
                              : '✅ ตรวจสอบรูปหลักฐานด้านบน แล้วกดเพื่อยืนยันว่าได้รับของแล้ว'}
                          </p>
                        </div>
                      )}
                      {/* ── ติดต่อ ── */}
                      <div className="p-3 flex flex-wrap gap-2 border-t border-gray-50">
                        {order.type === 'food' && (() => {
                          // ใช้ restaurantPhone จาก order ก่อน (ฝังตอน placeOrder) fallback หา restaurants array
                          const phone = order.restaurantPhone || restaurants.find(r => r.id === order.restaurantId)?.phone;
                          return phone ? (
                            <a href={`tel:${phone}`} className="flex-1 min-w-[110px] bg-orange-50 text-orange-700 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 hover:bg-orange-100 active:scale-95 transition-all">
                              📞 <span>{phone}</span>
                            </a>
                          ) : null;
                        })()}
                        {order.riderId && (() => {
                          // ใช้ riderPhone จาก order ก่อน (ฝังตอน acceptOrder) fallback หา riders array
                          const phone = order.riderPhone || riders.find(r => r.id === order.riderId)?.phone;
                          return phone ? (
                            <a href={`tel:${phone}`} className="flex-1 min-w-[110px] bg-green-50 text-green-700 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 hover:bg-green-100 active:scale-95 transition-all">
                              📞 <span>{phone}</span>
                            </a>
                          ) : null;
                        })()}
                        <button onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'customer')} className="flex-1 min-w-[110px] bg-blue-50 text-blue-700 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 hover:bg-blue-100 active:scale-95 transition-all">
                          <MessageSquare size={13} /> Support
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* ── ส่วน "จบงานแล้ว" — แสดงออเดอร์ที่ไรเดอร์เพิ่งจัดส่งสำเร็จ ─── */}
            {justDone.length > 0 && (
              <>
                <h2 className="text-lg font-bold mb-3 text-green-600 flex items-center gap-2 mt-4">
                  <CheckCircle size={18} /> จบงานแล้ว ({justDone.length})
                </h2>
                {justDone.map(order => (
                  <div key={order.id} className="bg-white mb-4 rounded-2xl shadow-sm overflow-hidden border-2 border-green-400">
                    {/* Success Banner */}
                    <div className="bg-green-500 px-4 py-3 flex items-center gap-3">
                      <div className="bg-white rounded-full p-1.5">
                        <CheckCircle size={20} className="text-green-500" />
                      </div>
                      <div>
                        <p className="text-white font-bold text-sm">จัดส่งสำเร็จแล้ว! 🎉</p>
                        <p className="text-green-100 text-xs">ของถึงมือคุณเรียบร้อย</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-gray-900">
                            {order.type === 'parcel' ? '📦 ส่งพัสดุด่วน' : order.restaurantName}
                          </h3>
                          <p className="text-xs text-gray-400 mt-0.5">{order.id} · {order.timestamp}</p>
                          {order.type === 'parcel' && order.dropoff && (
                            <p className="text-xs text-gray-500 mt-0.5">→ {order.dropoff}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-green-100 text-green-700">
                            ✅ จบงานแล้ว
                          </span>
                          <div className="font-bold text-gray-800 mt-1">฿{(order.grandTotal || 0).toLocaleString()}</div>
                        </div>
                      </div>
                      {/* Payment reminder */}
                      {order.paymentMethod === 'cash' ? (
                        <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 flex items-center gap-2">
                          <Banknote size={18} className="text-orange-500 shrink-0" />
                          <div>
                            <p className="text-orange-700 font-bold text-sm">เตรียมจ่ายเงินสด ฿{(order.grandTotal || 0).toLocaleString()}</p>
                            <p className="text-orange-500 text-xs">ชำระให้ไรเดอร์โดยตรง</p>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                          <span>👛</span><span>ตัดจาก Wallet เรียบร้อยแล้ว</span>
                        </div>
                      )}
                      {!order.rated && (
                        <button
                          onClick={() => {
                            setRatingRestaurantStars(5);
                            setRatingRiderStars(5);
                            setRatingComment('');
                            openRatingModal(order);
                          }}
                          className="mt-3 w-full bg-yellow-400 text-yellow-900 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-yellow-300 active:scale-95 transition-all"
                        >
                          <Star size={16} className="fill-current" /> ให้คะแนนรีวิว
                        </button>
                      )}
                      {order.rated && (
                        <p className="mt-3 text-center text-xs text-green-600 font-semibold">⭐ รีวิวแล้ว ขอบคุณ!</p>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {history.length > 0 && (
              <>
                <h2 className="text-lg font-bold mb-3 text-gray-600 flex items-center gap-2 mt-4"><Receipt size={18} /> ประวัติออเดอร์</h2>
                {history.map(order => (
                  <div key={order.id} className="bg-white mb-3 rounded-xl shadow-sm p-4 border border-gray-100">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-bold text-gray-800">
                          {order.type === 'parcel' ? '📦 ส่งพัสดุด่วน' : order.restaurantName}
                        </h3>
                        <p className="text-xs text-gray-400">{order.id} · {order.timestamp}</p>
                        {order.type === 'parcel' && order.dropoff && (
                          <p className="text-xs text-gray-500 mt-0.5">→ {order.dropoff}</p>
                        )}
                        {order.status === 'cancelled' && order.cancelReason && (
                          <p className="text-xs text-red-500 mt-0.5">ยกเลิก: {order.cancelReason}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${order.status === 'cancelled' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                          {order.status === 'cancelled' ? 'ยกเลิกแล้ว' : 'จัดส่งสำเร็จ ✓'}
                        </span>
                        <div className="font-bold text-gray-800 mt-1">฿{(order.grandTotal || 0).toLocaleString()}</div>
                      </div>
                    </div>
                    {order.status === 'completed' && !order.rated && (
                      <button
                        onClick={() => {
                          setRatingRestaurantStars(5);
                          setRatingRiderStars(5);
                          setRatingComment('');
                          openRatingModal(order);
                        }}
                        className="mt-2 w-full bg-yellow-50 border border-yellow-300 text-yellow-700 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1 hover:bg-yellow-100 active:scale-95 transition-all"
                      >
                        <Star size={13} className="fill-current" /> ให้คะแนน
                      </button>
                    )}
                    {order.status === 'completed' && order.rated && (
                      <p className="mt-2 text-center text-xs text-green-500 font-semibold">⭐ รีวิวแล้ว</p>
                    )}
                  </div>
                ))}
              </>
            )}

            {myOrders.length === 0 && (
              <div className="text-center mt-20 text-gray-400">
                <ShoppingBag size={48} className="mx-auto mb-3 opacity-20" />
                <p className="font-medium">ยังไม่มีออเดอร์</p>
                <button onClick={() => setActiveTab('home')} className="mt-3 text-orange-500 font-bold text-sm underline">สั่งอาหารเลย!</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Bottom Nav */}
      {!selectedRestaurant && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 flex justify-around z-40 bottom-nav-bar shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
          {[
            { id: 'home', icon: Home, label: 'หน้าแรก' },
            { id: 'activity', icon: ShoppingBag, label: 'ออเดอร์', badge: activityBadge },
            { id: 'profile', icon: User, label: 'บัญชี' },
            ...(isAdmin ? [{ id: 'admin', icon: ShieldAlert, label: 'แอดมิน', badge: pendingRequests.length, isRole: true }] : []),
          ].map(({ id, icon: Icon, label, badge, isRole }) => (
            <button
              key={id}
              onClick={() => {
                if (isRole) { setActiveRole(id); }
                else { setActiveTab(id); setProfileSubView('main'); }
              }}
              className={`bottom-nav-item ${
                isRole
                  ? (activeRole === id ? 'active' : 'text-gray-400')
                  : (activeTab === id && activeRole === 'customer' ? 'active' : 'text-gray-400')
              } ${id === 'admin' ? '!text-red-500' : ''}`}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={activeTab === id ? 2.5 : 1.8} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-${activeTab === id ? 'bold' : 'medium'} mt-0.5`}>{label}</span>
              <div className="nav-dot"></div>
            </button>
          ))}
        </div>
      )}

      {/* TopUp Modal */}
      {showTopUpModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowTopUpModal(false)}>
          <div className="bg-white p-5 rounded-2xl shadow-2xl w-full max-w-sm relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowTopUpModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-green-600">เติมเงินเข้า Wallet</h3>
              <p className="text-xs text-gray-500">สแกน QR หรือโอนตามเลขบัญชี</p>
            </div>
            <div className="bg-gray-100 p-3 rounded-xl mb-4 border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className="bg-white p-1.5 rounded-lg shadow-sm border flex items-center justify-center">
                  <PromptPayQR
                    promptPayId={appConfig.adminPromptPayId}
                    amount={parseFloat(withdrawAmount) || 0}
                    size={96}
                  />
                </div>
                <div className="text-right flex-1 pl-3">
                  <p className="font-bold text-gray-800 text-sm">{appConfig.adminBankName}</p>
                  <p className="text-lg font-mono font-bold text-blue-600 my-0.5 tracking-wide">{appConfig.adminBankAccount}</p>
                  <p className="text-xs text-gray-500 line-clamp-1">{appConfig.adminAccountName}</p>
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 font-bold">฿</span>
                </div>
                <input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full pl-8 pr-4 py-2 text-right text-xl font-bold bg-white border border-gray-200 rounded-lg focus:border-green-500 focus:outline-none" placeholder="0.00" />
              </div>
            </div>
            <div className="mb-4">
              <label className={`w-full border-2 border-dashed p-2 rounded-lg text-center cursor-pointer flex items-center justify-center transition-colors ${topUpSlip ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                <input type="file" accept="image/*" className="hidden" onChange={handleTopUpSlipSelect} />
                {topUpSlip ? <><Check size={16} className="mr-1" /> สลิปพร้อมส่ง</> : <><Receipt size={16} className="mr-1" /> แนบสลิปโอนเงิน</>}
              </label>
              {topUpSlip && (
                <div className="mt-2 h-20 w-full bg-gray-100 rounded-lg overflow-hidden relative">
                  <img src={topUpSlip} className="w-full h-full object-cover opacity-80" alt="slip" />
                  <button onClick={(e) => { e.preventDefault(); setTopUpSlip(null); }} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"><X size={12} /></button>
                </div>
              )}
            </div>
            <button onClick={() => {
              if (withdrawAmount > 0) {
                if (!topUpSlip) return alert("กรุณาแนบสลิปการโอนเงิน");
                requestTopUp(parseFloat(withdrawAmount), topUpSlip);
              } else { alert("กรุณาระบุจำนวนเงิน"); }
            }} className="w-full bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition-colors flex items-center justify-center">
              แจ้งโอนเงิน
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: ขอยกเลิกออเดอร์ (ส่ง Admin อนุมัติ) ── */}
      {showCancelReqModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-end justify-center z-50 backdrop-blur-sm"
          onClick={() => setShowCancelReqModal(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-t-3xl p-5 pb-8 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <div className="flex items-center gap-2 mb-1">
              <div className="bg-red-100 rounded-full p-1.5"><X size={16} className="text-red-500" /></div>
              <h3 className="font-bold text-gray-800 text-base">ขอยกเลิกออเดอร์</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4 pl-1">
              คำขอจะส่งไปยัง Admin เพื่อตรวจสอบ
              {cancelReqOrderId && (() => {
                const o = orders.find(x => x.id === cancelReqOrderId);
                return o?.paymentMethod === 'wallet'
                  ? ` — หาก Admin อนุมัติ จะคืนเงิน ฿${(o.grandTotal || 0).toLocaleString()} เข้า Wallet ให้`
                  : '';
              })()}
            </p>

            {/* Preset reasons */}
            {[
              'เปลี่ยนใจไม่ต้องการแล้ว',
              'สั่งผิด / ต้องการแก้ไข',
              'ที่อยู่จัดส่งผิด',
              'รอนานเกินไป',
            ].map(r => (
              <button
                key={r}
                onClick={() => setCancelReqReason(r)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm mb-1.5 border transition-all ${
                  cancelReqReason === r
                    ? 'bg-red-50 border-red-300 text-red-700 font-semibold'
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {cancelReqReason === r ? '✓ ' : ''}{r}
              </button>
            ))}

            <textarea
              value={cancelReqReason}
              onChange={e => setCancelReqReason(e.target.value)}
              placeholder="หรือพิมพ์เหตุผลอื่น..."
              rows={2}
              className="w-full mt-1 border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-200"
            />

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowCancelReqModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 active:scale-95 transition-all"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => {
                  if (!cancelReqReason.trim()) return alert('กรุณาระบุเหตุผล');
                  requestCancelOrder(cancelReqOrderId, cancelReqReason);
                  setShowCancelReqModal(false);
                  setCancelReqOrderId(null);
                  setCancelReqReason('');
                }}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 active:scale-95 transition-all"
              >
                ส่งคำขอยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen Live Tracking Overlay */}
      {trackingOrderId && (() => {
        const o = orders.find(ord => ord.id === trackingOrderId);
        if (!o) { setTrackingOrderId(null); return null; }
        const rLoc = riderLocations[o.id] ?? o.riderLocation;
        const dest = o.status === 'picking_up' ? o.pickupLocation : o.location;
        const eta  = calcETA(rLoc, dest);
        const isDelivering = o.status === 'delivering';
        return (
          <div className="fixed inset-0 z-[200] bg-white flex flex-col">
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 shadow-sm flex-shrink-0 ${isDelivering ? 'bg-blue-600' : 'bg-indigo-600'}`}>
              <button
                onClick={() => setTrackingOrderId(null)}
                className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 active:scale-90 transition-all"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="text-center flex-1 mx-3">
                <p className="text-white font-black text-sm">
                  {isDelivering ? '🛵 กำลังส่งให้คุณ!' : o.status === 'picking_up' ? '🏪 ไรเดอร์ถึงร้านแล้ว' : '✅ ไรเดอร์รับงานแล้ว'}
                </p>
                <p className="text-blue-100 text-xs mt-0.5">{o.riderName || 'ไรเดอร์'}</p>
              </div>
              {eta ? (
                <div className="text-right bg-white/20 rounded-xl px-3 py-1.5">
                  <p className="text-white font-black text-sm leading-tight">~{eta.mins} นาที</p>
                  <p className="text-blue-100 text-[10px]">{eta.km} กม.</p>
                </div>
              ) : <div className="w-16" />}
            </div>

            {/* Map full remaining height */}
            <div className="flex-1 relative">
              <InteractiveMap
                mode="view"
                userLocation={o.location}
                shopLocation={o.pickupLocation}
                riderLocation={rLoc}
                trackingMode
                autoFollow={isDelivering}
                className="h-full"
              />

              {/* Floating legend */}
              <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-3 z-[1000]">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-[10px]">🛵</span>
                    <span className="text-gray-600 font-medium">ไรเดอร์</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center text-white text-[10px]">🏪</span>
                    <span className="text-gray-600 font-medium">{o.type === 'parcel' ? 'จุดรับ' : 'ร้าน'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white text-[10px]">🏠</span>
                    <span className="text-gray-600 font-medium">ที่ส่ง</span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" />
                    <span className="text-blue-600 font-bold">Live</span>
                  </div>
                </div>
                {o.type === 'parcel' && o.dropoff && (
                  <p className="text-[10px] text-gray-400 mt-1.5 truncate">📦 ส่งถึง: {o.dropoff}</p>
                )}
                {o.type === 'food' && (
                  <p className="text-[10px] text-gray-400 mt-1.5 truncate">🍽️ {o.restaurantName}</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Rating Modal */}
      {showRatingModal && ratingOrderData && (() => {
        const o = ratingOrderData;
        const isFood = o.type === 'food';
        const StarRow = ({ value, onChange, label }) => (
          <div className="mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">{label}</p>
            <div className="flex gap-2 justify-center">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => onChange(n)} className="focus:outline-none transition-transform active:scale-90">
                  <Star
                    size={36}
                    className={n <= value ? 'text-yellow-400 fill-current' : 'text-gray-300'}
                  />
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-gray-400 mt-1">
              {value === 1 ? 'แย่มาก' : value === 2 ? 'แย่' : value === 3 ? 'พอใช้' : value === 4 ? 'ดี' : 'ดีมาก!'}
            </p>
          </div>
        );
        return (
          <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50 backdrop-blur-sm" onClick={() => setShowRatingModal(false)}>
            <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-10 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-black text-gray-900">ให้คะแนนรีวิว ⭐</h3>
                  <p className="text-xs text-gray-400">{isFood ? o.restaurantName : '📦 ' + (o.dropoff || 'พัสดุ')}</p>
                </div>
                <button onClick={() => setShowRatingModal(false)} className="p-2 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">
                  <X size={18} />
                </button>
              </div>

              {isFood && (
                <StarRow
                  value={ratingRestaurantStars}
                  onChange={setRatingRestaurantStars}
                  label={`🍽️ ร้านอาหาร: ${o.restaurantName}`}
                />
              )}

              {o.riderId && (
                <StarRow
                  value={ratingRiderStars}
                  onChange={setRatingRiderStars}
                  label="🛵 ไรเดอร์"
                />
              )}

              <textarea
                value={ratingComment}
                onChange={e => setRatingComment(e.target.value)}
                placeholder="ความคิดเห็นเพิ่มเติม (ไม่บังคับ)..."
                rows={2}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-300 mb-4"
              />

              <button
                onClick={() => submitRating({
                  orderId:          o.id,
                  restaurantId:     isFood ? o.restaurantId : null,
                  riderId:          o.riderId || null,
                  restaurantRating: isFood ? ratingRestaurantStars : null,
                  riderRating:      o.riderId ? ratingRiderStars : null,
                  comment:          ratingComment,
                })}
                className="w-full bg-yellow-400 text-yellow-900 py-3.5 rounded-2xl font-black text-base hover:bg-yellow-300 active:scale-95 transition-all shadow-lg shadow-yellow-200"
              >
                ส่งรีวิว 🌟
              </button>
              <button
                onClick={() => setShowRatingModal(false)}
                className="w-full mt-2 text-gray-400 text-sm py-2 hover:text-gray-600"
              >
                ข้ามไปก่อน
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
