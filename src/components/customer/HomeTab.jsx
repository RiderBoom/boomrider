import React, { useState, useMemo, useEffect } from 'react';
import {
  Utensils, Package, Bike, Search, ArrowLeft, Star, Clock,
  MapPin, Navigation, Plus, Minus, X, Tag, CheckCircle,
  ChefHat, Crosshair, Banknote, Sparkles, SlidersHorizontal, Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getDistanceFromLatLonInKm } from '../../utils';
import { DEFAULT_CATEGORIES } from '../../constants';
import RestaurantCard from '../RestaurantCard';
import InteractiveMap from '../InteractiveMap';

export default function HomeTab({ searchQuery, setSearchQuery }) {
  const {
    serviceType, setServiceType,
    restaurants, menuItems, appConfig,
    userProfile,
    cart, setCart,
    parcelDetails, setParcelDetails,
    paymentMethod, setPaymentMethod,
    parcelMapTarget, setParcelMapTarget,
    parcelDistance, parcelEstimate,
    placeOrder, placeParcelOrder, placeRideOrder,
    addToCart, calculateFoodTotal, calculateDeliveryFee,
    handleParcelMapSelect,
    getCurrentLocationForParcel,
    notifySystem,
    validatePromoCode, applyPromoCode,
    selectedRestaurant, setSelectedRestaurant,
    isDataLoading,
  } = useApp();

  // State for Ride-Hailing Service
  const [rideDetails, setRideDetails] = useState({
    pickup: '',
    dropoff: '',
    pickupLocation: null,
    dropoffLocation: null,
    passengerCount: 1,
    selectedExtraIds: [],
    notes: '',
  });
  const [rideMapTarget, setRideMapTarget] = useState('pickup');

  const getCurrentLocationForRide = (target) => {
    if (!navigator.geolocation) return notifySystem('ผิดพลาด', 'Browser ไม่รองรับ GPS', 'error');
    notifySystem('กำลังดึงพิกัด', 'กำลังหาตำแหน่งของคุณ...', 'info');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
      let addr = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json&accept-language=th`,
          { headers: { 'Accept-Language': 'th' } },
        );
        const data = await res.json();
        if (data.display_name) addr = data.display_name;
      } catch (e) { console.error(e); }

      if (target === 'pickup') {
        setRideDetails(prev => ({ ...prev, pickup: addr, pickupLocation: loc }));
        setRideMapTarget('pickup');
      } else {
        setRideDetails(prev => ({ ...prev, dropoff: addr, dropoffLocation: loc }));
        setRideMapTarget('dropoff');
      }
      notifySystem('สำเร็จ', `ตั้ง${target === 'pickup' ? 'จุดรับ' : 'จุดส่ง'}เป็นตำแหน่งปัจจุบันแล้ว`, 'success');
    }, () => notifySystem('ผิดพลาด', 'ไม่สามารถดึงพิกัดได้ กรุณาเปิดสิทธิ์ GPS', 'error'), { enableHighAccuracy: true, timeout: 10000 });
  };

  // Auto-GPS: pull current pickup location when parcel or ride tab opens
  useEffect(() => {
    if (serviceType === 'parcel' && !parcelDetails.pickupLocation) {
      getCurrentLocationForParcel('pickup');
    } else if (serviceType === 'ride' && !rideDetails.pickupLocation) {
      getCurrentLocationForRide('pickup');
    }
  }, [serviceType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRideMapSelect = async (loc) => {
    const target = rideMapTarget || 'pickup';
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json&accept-language=th`,
        { headers: { 'Accept-Language': 'th' } },
      );
      const data = await res.json();
      const addr = data.display_name || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
      if (target === 'pickup') {
        setRideDetails(prev => ({ ...prev, pickup: addr, pickupLocation: loc }));
      } else {
        setRideDetails(prev => ({ ...prev, dropoff: addr, dropoffLocation: loc }));
      }
    } catch {
      const addr = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
      if (target === 'pickup') {
        setRideDetails(prev => ({ ...prev, pickup: addr, pickupLocation: loc }));
      } else {
        setRideDetails(prev => ({ ...prev, dropoff: addr, dropoffLocation: loc }));
      }
    }
  };

  // Calculate Ride Distance and Estimate
  const rideDistance = useMemo(() => {
    if (rideDetails.pickupLocation && rideDetails.dropoffLocation) {
      return getDistanceFromLatLonInKm(
        rideDetails.pickupLocation.lat, rideDetails.pickupLocation.lng,
        rideDetails.dropoffLocation.lat, rideDetails.dropoffLocation.lng,
      );
    }
    return 0;
  }, [rideDetails.pickupLocation, rideDetails.dropoffLocation]);

  const rideEstimate = useMemo(() => {
    if (rideDistance <= 0) return 0;
    const base = appConfig.rideBaseFee || 25;
    const perKm = appConfig.ridePerKmFee || 12;
    const distPrice = Math.ceil(base + (rideDistance * perKm));
    const extraServices = appConfig.extraServices || [];
    const extrasPrice = (rideDetails.selectedExtraIds || []).reduce((sum, id) => {
      const s = extraServices.find(item => item.id === id);
      return sum + (s ? (s.price || 0) : 0);
    }, 0);
    return distPrice + extrasPrice;
  }, [rideDistance, rideDetails.selectedExtraIds, appConfig]);

  const toggleRideExtraService = (id) => {
    setRideDetails(prev => {
      const cur = prev.selectedExtraIds || [];
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      return { ...prev, selectedExtraIds: next };
    });
  };

  const [selectedCategory, setSelectedCategory] = useState('ทั้งหมด');
  const [orderNotes, setOrderNotes]   = useState('');
  const [promoInput, setPromoInput]   = useState('');
  const [promoResult, setPromoResult] = useState(null);
  const [showPromoField, setShowPromoField] = useState(false);

  // Modal for selecting item options / toppings
  const [selectedMenuItem, setSelectedMenuItem] = useState(null);
  const [selectedOptions, setSelectedOptions]   = useState([]);

  const handleCartQty = (itemId, delta) => {
    setCart(prev =>
      prev.map(c => c.id === itemId ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0),
    );
  };

  const handleApplyPromo = () => {
    if (!promoInput.trim()) return;
    const foodTotal   = calculateFoodTotal();
    const deliveryFee = cart.length > 0 ? calculateDeliveryFee(cart[0].distance) : 0;
    const result      = validatePromoCode(promoInput.trim(), foodTotal + deliveryFee);
    setPromoResult(result);
    if (result.valid) {
      notifySystem('สำเร็จ', `ใช้โค้ด ${promoInput.toUpperCase()} ส่วนลด ฿${result.discount}`, 'success');
    } else {
      notifySystem('ผิดพลาด', result.message, 'error');
    }
  };

  const promoDiscount = promoResult?.valid ? (promoResult.discount || 0) : 0;

  const categories = useMemo(() => {
    const catsInShops = restaurants.filter(r => r.category).map(r => r.category);
    const combined = [...new Set([...DEFAULT_CATEGORIES, ...catsInShops])].sort();
    return ['ทั้งหมด', ...combined];
  }, [restaurants]);

  const handleOpenOptionModal = (item) => {
    if (item.options && item.options.length > 0) {
      setSelectedMenuItem(item);
      setSelectedOptions([]);
    } else {
      addToCart(item, selectedRestaurant.id, selectedRestaurant.name, selectedRestaurant.distance);
    }
  };

  const toggleOption = (opt) => {
    setSelectedOptions(prev => {
      const exists = prev.some(o => o.name === opt.name);
      if (exists) return prev.filter(o => o.name !== opt.name);
      return [...prev, opt];
    });
  };

  const handleConfirmAddToCart = () => {
    if (!selectedMenuItem) return;
    const extraPrice = selectedOptions.reduce((sum, o) => sum + (o.price || 0), 0);
    addToCart(selectedMenuItem, selectedRestaurant.id, selectedRestaurant.name, selectedRestaurant.distance, selectedOptions, extraPrice);
    setSelectedMenuItem(null);
    setSelectedOptions([]);
  };

  const restaurantsWithDistance = useMemo(() => restaurants.map(r => ({
    ...r,
    distance: getDistanceFromLatLonInKm(
      userProfile.location.lat, userProfile.location.lng,
      r.location.lat, r.location.lng,
    ),
  })), [restaurants, userProfile.location]);

  const visibleRestaurants = useMemo(() => {
    let list = restaurantsWithDistance.filter(r => r.status === 'open');
    if (selectedCategory !== 'ทั้งหมด') list = list.filter(r => r.category === selectedCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r => {
        if (r.name?.toLowerCase().includes(q)) return true;
        if (r.category?.toLowerCase().includes(q)) return true;
        return (menuItems[r.id] || []).some(m =>
          m.name?.toLowerCase().includes(q) || m.desc?.toLowerCase().includes(q),
        );
      });
    }
    return list;
  }, [restaurantsWithDistance, selectedCategory, searchQuery, menuItems]);

  // ── Menu detail view ────────────────────────────────────────────────────────
  if (selectedRestaurant) {
    return (
      <div className="min-h-screen bg-gray-50 animate-fade-in">
        <div className="relative h-52">
          <img src={selectedRestaurant.image} className="w-full h-full object-cover" alt={selectedRestaurant.name} loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />
          <button
            onClick={() => setSelectedRestaurant(null)}
            className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm p-2 rounded-full shadow-lg active:scale-90 transition-transform"
            aria-label="ย้อนกลับ"
          >
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
            {menuItems[selectedRestaurant.id]?.length > 0 ? (
              menuItems[selectedRestaurant.id].map(item => (
                <div key={item.id} className={`bg-white rounded-2xl p-3 flex items-center gap-3 shadow-sm ${!item.available ? 'opacity-50' : ''}`}>
                  {item.image && (
                    <img src={item.image} className="w-20 h-20 object-cover rounded-xl flex-shrink-0 bg-gray-100" alt={item.name} loading="lazy" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</h3>
                          {item.tag && (
                            <span className="bg-orange-100 text-orange-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                              <Sparkles size={9} /> {item.tag}
                            </span>
                          )}
                          {!item.available && <span className="text-red-500 text-xs font-bold"> (หมด)</span>}
                        </div>
                        <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{item.desc}</p>
                        <p className="font-bold text-gray-900 mt-1.5">฿{item.price}</p>
                        {item.options && item.options.length > 0 && (
                          <span className="text-[10px] text-blue-600 font-semibold flex items-center gap-0.5 mt-0.5">
                            <SlidersHorizontal size={10} /> มีตัวเลือกเพิ่มเติม ({item.options.length})
                          </span>
                        )}
                      </div>
                      <button
                        disabled={!item.available}
                        onClick={() => handleOpenOptionModal(item)}
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
            <div className="max-h-32 overflow-y-auto mb-3 space-y-1.5">
              {cart.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-700 block truncate font-medium">{item.name}</span>
                    {item.selectedOptions && item.selectedOptions.length > 0 && (
                      <span className="text-[10px] text-gray-400 block truncate">
                        + {item.selectedOptions.map(o => o.name).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleCartQty(item.id, -1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-orange-100 text-gray-600 hover:text-orange-600"><Minus size={14} /></button>
                    <span className="text-sm font-bold w-5 text-center">{item.qty}</span>
                    <button onClick={() => handleCartQty(item.id, 1)} className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white hover:bg-orange-600"><Plus size={14} /></button>
                    <span className="text-xs font-bold text-gray-500 w-14 text-right">฿{(item.price * item.qty).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {!showPromoField ? (
              <button onClick={() => setShowPromoField(true)} className="text-xs text-orange-500 underline flex items-center gap-1 mb-2">
                <Tag size={12} /> ใช้โค้ดส่วนลด
              </button>
            ) : (
              <div className="flex gap-2 mb-2">
                <label htmlFor="cart-promo-input" className="sr-only">โค้ดส่วนลด</label>
                <input
                  id="cart-promo-input"
                  name="promoCode"
                  value={promoInput}
                  onChange={e => setPromoInput(e.target.value.toUpperCase())}
                  placeholder="กรอกโค้ดส่วนลด"
                  className="flex-1 border border-orange-200 rounded-lg px-3 py-1.5 text-sm font-mono uppercase focus:outline-none focus:border-orange-400"
                  maxLength={20}
                  autoComplete="off"
                  aria-label="กรอกโค้ดส่วนลด"
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

            <label htmlFor="cart-order-notes" className="sr-only">หมายเหตุถึงร้าน</label>
            <textarea
              id="cart-order-notes"
              name="orderNotes"
              value={orderNotes}
              onChange={e => setOrderNotes(e.target.value)}
              placeholder="หมายเหตุถึงร้าน (ไม่ใส่น้ำตาล, ไม่ใส่ผัก...)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none h-16 mb-2 focus:outline-none focus:border-orange-300"
              maxLength={200}
              autoComplete="off"
            />

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
            <button
              onClick={() => { if (promoResult?.valid) applyPromoCode(promoInput); placeOrder(promoDiscount, orderNotes); setOrderNotes(''); }}
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-xl shadow-orange-200 active:scale-95 transition-transform"
            >
              สั่งอาหาร ฿{Math.max(0, calculateFoodTotal() + calculateDeliveryFee(cart[0].distance) - promoDiscount).toLocaleString()}
            </button>
          </div>
        )}

        {/* Option Selection Modal */}
        {selectedMenuItem && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="bg-orange-500 text-white p-4 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-base leading-tight">{selectedMenuItem.name}</h3>
                  <p className="text-xs text-orange-100 mt-0.5">ราคาเริ่มต้น ฿{selectedMenuItem.price}</p>
                </div>
                <button onClick={() => setSelectedMenuItem(null)} className="text-white/80 hover:text-white p-1">
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 max-h-72 overflow-y-auto">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">เลือกตัวเลือกเพิ่มเติม / ท็อปปิ้ง</p>
                <div className="space-y-2">
                  {selectedMenuItem.options?.map((opt, idx) => {
                    const isSelected = selectedOptions.some(o => o.name === opt.name);
                    return (
                      <div
                        key={idx}
                        onClick={() => toggleOption(opt)}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                          isSelected ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-800">{opt.name}</span>
                        <span className="text-xs font-bold text-orange-600">+฿{opt.price || 0}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs text-gray-400 block">ราคารวม</span>
                  <span className="text-lg font-black text-orange-600">
                    ฿{selectedMenuItem.price + selectedOptions.reduce((s, o) => s + (o.price || 0), 0)}
                  </span>
                </div>
                <button
                  onClick={handleConfirmAddToCart}
                  className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600 active:scale-95 transition-all shadow-md shadow-orange-200"
                >
                  ใส่ตะกร้า
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Home tab ────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 py-3">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setServiceType('food')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl font-semibold text-xs sm:text-sm transition-all duration-200 ${serviceType === 'food' ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'bg-white text-gray-600 shadow-sm'}`}
        ><Utensils size={16} /> สั่งอาหาร</button>
        <button
          onClick={() => setServiceType('parcel')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl font-semibold text-xs sm:text-sm transition-all duration-200 ${serviceType === 'parcel' ? 'bg-blue-500 text-white shadow-lg shadow-blue-200' : 'bg-white text-gray-600 shadow-sm'}`}
        ><Package size={16} /> ส่งพัสดุ</button>
        <button
          onClick={() => setServiceType('ride')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl font-semibold text-xs sm:text-sm transition-all duration-200 ${serviceType === 'ride' ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-white text-gray-600 shadow-sm'}`}
        ><Bike size={16} /> เรียกรถ</button>
      </div>

      {serviceType === 'food' ? (
        <>
          {!searchQuery && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1 scrollbar-hide">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${selectedCategory === cat ? 'bg-orange-500 text-white shadow-md shadow-orange-200' : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'}`}
                >{cat}</button>
              ))}
            </div>
          )}

          <div className="featured-banner mb-5">
            <div className="relative z-10">
              <div className="text-xs font-semibold text-orange-200 uppercase tracking-wider mb-1">ยินดีต้อนรับสู่ BoomRider</div>
              <h2 className="text-xl font-black text-white leading-tight mb-1">สั่งอาหาร<br />ส่งพัสดุ ง่ายๆ!</h2>
              <p className="text-orange-100 text-xs mb-3">บริการครอบคลุมทั่วกรุงเทพและปริมณฑล</p>
              <button
                onClick={() => setServiceType('parcel')}
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
                <button
                  onClick={() => { setSearchQuery(''); setSelectedCategory('ทั้งหมด'); }}
                  className="mt-2 text-orange-500 text-sm underline"
                >ล้างการค้นหา</button>
              </div>
            )
          )}

          <div className="stagger">
            {visibleRestaurants.map(rest => (
              <div key={rest.id} className="animate-fade-in-up">
                <RestaurantCard rest={rest} appConfig={appConfig} onSelect={setSelectedRestaurant} userProfile={userProfile} />
              </div>
            ))}
          </div>
        </>
      ) : serviceType === 'ride' ? (
        /* ── Ride-Hailing form ── */
        <div className="bg-white p-5 rounded-xl shadow-sm">
          <h2 className="font-bold text-lg mb-4 text-purple-600 flex items-center"><Bike className="mr-2" /> บริการเรียกรถรับ-ส่งผู้โดยสาร</h2>
          <div className="space-y-3">
            <p className="text-xs text-gray-500 text-center">ค่าบริการเริ่มต้น {appConfig.rideBaseFee || 25}บ. + {appConfig.ridePerKmFee || 12}บ./กม.</p>
            <div className="mb-4">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setRideMapTarget('pickup')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${rideMapTarget === 'pickup' ? 'bg-green-500 text-white shadow-md shadow-green-200' : 'bg-gray-100 text-gray-600'}`}
                >📍 จุดรับผู้โดยสาร{rideDetails.pickupLocation ? ' ✓' : ''}</button>
                <button
                  onClick={() => setRideMapTarget('dropoff')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${rideMapTarget === 'dropoff' ? 'bg-red-500 text-white shadow-md shadow-red-200' : 'bg-gray-100 text-gray-600'}`}
                >🏁 จุดส่งผู้โดยสาร{rideDetails.dropoffLocation ? ' ✓' : ''}</button>
              </div>
              <InteractiveMap
                mode="select"
                isParcel={true}
                activeParcelTarget={rideMapTarget || 'pickup'}
                shopLocation={rideDetails.pickupLocation}
                userLocation={rideDetails.dropoffLocation}
                centerOverride={
                  rideMapTarget === 'pickup'
                    ? (rideDetails.pickupLocation || userProfile?.location)
                    : (rideDetails.dropoffLocation || userProfile?.location)
                }
                onLocationSelect={handleRideMapSelect}
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="ride-pickup-input" className="text-sm text-gray-500">จุดรับผู้โดยสาร</label>
                <button
                  onClick={() => getCurrentLocationForRide('pickup')}
                  className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-green-200 active:scale-95 transition-transform"
                ><Crosshair size={12} /> ตำแหน่งปัจจุบัน</button>
              </div>
              <div className="flex items-center border rounded-lg p-2 bg-gray-50">
                <MapPin size={18} className="text-green-500 mr-2 flex-shrink-0" />
                <input id="ride-pickup-input" name="ridePickup" value={rideDetails.pickup} onChange={e => setRideDetails({ ...rideDetails, pickup: e.target.value })} type="text" placeholder="ระบุจุดรับ..." className="w-full outline-none bg-transparent text-sm" autoComplete="off" />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="ride-dropoff-input" className="text-sm text-gray-500">จุดส่งผู้โดยสาร</label>
                <button
                  onClick={() => getCurrentLocationForRide('dropoff')}
                  className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-red-200 active:scale-95 transition-transform"
                ><Crosshair size={12} /> ตำแหน่งปัจจุบัน</button>
              </div>
              <div className="flex items-center border rounded-lg p-2 bg-gray-50">
                <Navigation size={18} className="text-red-500 mr-2 flex-shrink-0" />
                <input id="ride-dropoff-input" name="rideDropoff" value={rideDetails.dropoff} onChange={e => setRideDetails({ ...rideDetails, dropoff: e.target.value })} type="text" placeholder="ระบุจุดส่ง..." className="w-full outline-none bg-transparent text-sm" autoComplete="off" />
              </div>
            </div>

            <div>
              <label htmlFor="ride-passenger-count" className="text-sm text-gray-500 flex items-center gap-1 mb-1"><Users size={14} /> จำนวนผู้โดยสาร</label>
              <select
                id="ride-passenger-count"
                value={rideDetails.passengerCount}
                onChange={e => setRideDetails({ ...rideDetails, passengerCount: parseInt(e.target.value) })}
                className="w-full border rounded-lg p-2 text-sm bg-white"
              >
                <option value={1}>1 คน</option>
                <option value={2}>2 คน</option>
              </select>
            </div>

            {/* Extra Options configured by Admin */}
            {(appConfig.extraServices || []).filter(s => s.active !== false).length > 0 && (
              <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 space-y-2">
                <p className="text-xs font-bold text-purple-700">✨ บริการเพิ่มเติม (เลือกเสริมได้)</p>
                <div className="space-y-1.5">
                  {(appConfig.extraServices || []).filter(s => s.active !== false).map(srv => {
                    const isChecked = (rideDetails.selectedExtraIds || []).includes(srv.id);
                    return (
                      <div
                        key={srv.id}
                        onClick={() => toggleRideExtraService(srv.id)}
                        className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-colors ${isChecked ? 'bg-purple-100 border-purple-400 text-purple-900 font-semibold' : 'bg-white border-gray-200 text-gray-700'}`}
                      >
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={isChecked} onChange={() => {}} className="rounded text-purple-600" />
                          {srv.name}
                        </span>
                        <span className="font-bold text-purple-600">+฿{srv.price}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="ride-notes-input" className="text-xs text-gray-500">หมายเหตุถึงคนขับ</label>
              <input id="ride-notes-input" name="rideNotes" value={rideDetails.notes} onChange={e => setRideDetails({ ...rideDetails, notes: e.target.value })} type="text" placeholder="คำแนะนำเพิ่มเติม เช่น จุดสังเกต..." className="border rounded-lg p-2 mt-1 w-full text-sm" autoComplete="off" />
            </div>

            {rideDistance > 0 && (
              <div className="bg-purple-50 p-3 rounded-xl text-center my-2 border border-purple-200">
                <p className="text-sm font-bold text-purple-800">
                  📏 ระยะทาง {rideDistance.toFixed(1)} กม. &nbsp;|&nbsp; ค่าโดยสาร ฿{rideEstimate}
                </p>
                <p className="text-xs text-purple-500 mt-0.5">คำนวณจากจุดรับถึงจุดส่งผู้โดยสาร</p>
              </div>
            )}

            <div className="flex items-center space-x-2 mt-2 p-2 bg-gray-50 rounded-lg">
              <span className="text-sm font-bold">ชำระเงิน:</span>
              <button onClick={() => setPaymentMethod('wallet')} className={`flex-1 py-1 text-xs rounded border ${paymentMethod === 'wallet' ? 'bg-purple-100 border-purple-500 text-purple-700 font-bold' : 'bg-white border-gray-300'}`}>Wallet</button>
              <button onClick={() => setPaymentMethod('cash')} className={`flex-1 py-1 text-xs rounded border ${paymentMethod === 'cash' ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold' : 'bg-white border-gray-300'}`}>เงินสด</button>
            </div>

            <button onClick={() => placeRideOrder(rideDetails, rideEstimate)} className="w-full bg-purple-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-purple-700 mt-4 active:scale-95 transition-transform">
              คำนวณราคา & เรียกรถ
            </button>
          </div>
        </div>
      ) : (
        /* ── Parcel form ── */
        <div className="bg-white p-5 rounded-xl shadow-sm">
          <h2 className="font-bold text-lg mb-4 text-blue-600 flex items-center"><Package className="mr-2" /> บริการส่งพัสดุด่วน</h2>
          <div className="space-y-3">
            <p className="text-xs text-gray-500 text-center">ค่าบริการเริ่มต้น {appConfig.baseFee}บ. + {appConfig.perKmFee}บ./กม.</p>
            <div className="mb-4">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setParcelMapTarget('pickup')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${parcelMapTarget === 'pickup' ? 'bg-green-500 text-white shadow-md shadow-green-200' : 'bg-gray-100 text-gray-600'}`}
                >📍 จุดรับของ{parcelDetails.pickupLocation ? ' ✓' : ''}</button>
                <button
                  onClick={() => setParcelMapTarget('dropoff')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${parcelMapTarget === 'dropoff' ? 'bg-red-500 text-white shadow-md shadow-red-200' : 'bg-gray-100 text-gray-600'}`}
                >🏁 จุดส่งของ{parcelDetails.dropoffLocation ? ' ✓' : ''}</button>
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
                <label htmlFor="parcel-pickup-input" className="text-sm text-gray-500">จุดรับของ</label>
                <button
                  onClick={() => getCurrentLocationForParcel('pickup')}
                  className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-green-200 active:scale-95 transition-transform"
                ><Crosshair size={12} /> ตำแหน่งปัจจุบัน</button>
              </div>
              <div className="flex items-center border rounded-lg p-2 bg-gray-50">
                <MapPin size={18} className="text-green-500 mr-2 flex-shrink-0" />
                <input id="parcel-pickup-input" name="pickup" value={parcelDetails.pickup} onChange={e => setParcelDetails({ ...parcelDetails, pickup: e.target.value })} type="text" placeholder="ระบุจุดรับ..." className="w-full outline-none bg-transparent text-sm" autoComplete="off" />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="parcel-dropoff-input" className="text-sm text-gray-500">จุดส่งของ</label>
                <button
                  onClick={() => getCurrentLocationForParcel('dropoff')}
                  className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-red-200 active:scale-95 transition-transform"
                ><Crosshair size={12} /> ตำแหน่งปัจจุบัน</button>
              </div>
              <div className="flex items-center border rounded-lg p-2 bg-gray-50">
                <Navigation size={18} className="text-red-500 mr-2 flex-shrink-0" />
                <input id="parcel-dropoff-input" name="dropoff" value={parcelDetails.dropoff} onChange={e => setParcelDetails({ ...parcelDetails, dropoff: e.target.value })} type="text" placeholder="ระบุจุดส่ง..." className="w-full outline-none bg-transparent text-sm" autoComplete="off" />
              </div>
            </div>
            <div>
              <label htmlFor="parcel-weight-input" className="text-sm text-gray-500">น้ำหนักพัสดุ (kg)</label>
              <input id="parcel-weight-input" name="weight" value={parcelDetails.weight} onChange={e => setParcelDetails({ ...parcelDetails, weight: e.target.value })} type="number" className="border rounded-lg p-2 mt-1 w-full" autoComplete="off" />
            </div>
            <div className="bg-blue-50 rounded-xl p-3 space-y-2 border border-blue-100">
              <p className="text-xs font-bold text-blue-700">📬 ข้อมูลผู้รับ (สำหรับให้ไรเดอร์ติดต่อ)</p>
              <div>
                <label htmlFor="parcel-receiver-name-input" className="text-xs text-gray-500">ชื่อผู้รับ</label>
                <input id="parcel-receiver-name-input" name="receiverName" value={parcelDetails.receiverName || ''} onChange={e => setParcelDetails({ ...parcelDetails, receiverName: e.target.value })} type="text" placeholder="ชื่อ-นามสกุลผู้รับ" className="border rounded-lg p-2 mt-1 w-full text-sm" autoComplete="name" />
              </div>
              <div>
                <label htmlFor="parcel-receiver-phone-input" className="text-xs text-gray-500">เบอร์โทรผู้รับ</label>
                <input id="parcel-receiver-phone-input" name="receiverPhone" value={parcelDetails.receiverPhone || ''} onChange={e => setParcelDetails({ ...parcelDetails, receiverPhone: e.target.value })} type="tel" placeholder="0xx-xxx-xxxx" className="border rounded-lg p-2 mt-1 w-full text-sm" autoComplete="tel" />
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
            <button onClick={placeParcelOrder} className="w-full bg-green-500 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-green-600 mt-4">
              คำนวณราคา & เรียกแมส
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
