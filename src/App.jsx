import React, { useState, useEffect, useRef } from 'react';
import {
  Home, ShoppingBag, Truck, User, MapPin, Clock,
  CheckCircle, ChefHat, DollarSign, Package,
  Navigation, Menu, Star, Search, ArrowRight,
  Bike, TrendingUp, Users, AlertCircle, X, Utensils,
  Wallet, ChevronRight, Lock, Power, ShieldAlert,
  CreditCard, Settings, FileText, LogOut, Edit, Phone, Mail,
  Plus, Trash2, ArrowLeft, Save, Bell, Check, XCircle, ArrowDownCircle,
  Repeat, LogIn, Sliders, ToggleLeft, ToggleRight, Image as ImageIcon,
  History, Calendar, Ban, MessageSquare, Upload, FileBadge, Camera, Eye,
  Crosshair, Map as MapIcon, Banknote, Percent, QrCode, Receipt, MessageCircle, Send, Info, Volume2
} from 'lucide-react';

// ===== Firebase Imports =====
import {
  loginWithEmail,
  registerWithEmail,
  loginWithGoogle,
  logout as firebaseLogout,
  onAuthChange,
} from './firebase/auth';
import { uploadProfilePhoto, uploadShopPhoto, uploadIdCard, uploadTopUpSlip as fbUploadSlip } from './firebase/storage';
import { requestNotificationPermission, onForegroundMessage, saveFcmToken } from './firebase/messaging';

// ===== Firebase Feature Flag =====
// ตั้งเป็น true เมื่อกรอก .env.local ครบแล้ว
const FIREBASE_ENABLED = !!(
  import.meta.env.VITE_FIREBASE_API_KEY &&
  import.meta.env.VITE_FIREBASE_API_KEY.length > 10
);

// --- Constants & Config ---

const INITIAL_CONFIG = {
    appRadius: 15,          // km
    restaurantRadius: 10,   // km
    riderRadius: 5,         // km
    baseFee: 20,            // THB
    perKmFee: 10,           // THB/km
    gpFood: 30,             // % GP ร้านค้า
    gpDelivery: 15,         // % GP ไรเดอร์
    // Admin Payment Info
    adminBankName: "กสิกรไทย (KBANK)",
    adminBankAccount: "123-4-56789-0",
    adminAccountName: "บริษัท บูมไรเดอร์ จำกัด",
    adminQrCode: "https://upload.wikimedia.org/wikipedia/commons/d/d0/QR_code_for_mobile_English_Wikipedia.svg" // Placeholder
};

const GP_RATES = {
  food: 0.30,      // GP 30%
  delivery: 0.15,  // GP 15%
};

const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const d = R * c; 
  return parseFloat(d.toFixed(2));
};

const deg2rad = (deg) => {
  return deg * (Math.PI/180)
};

const USER_LOCATION = { lat: 13.7563, lng: 100.5018 }; 

const INITIAL_RESTAURANTS = [
  { id: 2, ownerId: 'u99', name: "Burger King Clone", phone: "02-111-1111", rating: 4.5, time: "20-30 min", image: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=500&q=60", category: "Fast Food", status: 'open', location: { lat: 13.7600, lng: 100.5100 } }, 
  { id: 3, ownerId: 'u98', name: "Sushi House", phone: "02-222-2222", rating: 4.9, time: "30-40 min", image: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=500&q=60", category: "Japanese", status: 'closed', location: { lat: 13.7200, lng: 100.5300 } }, 
  { id: 4, ownerId: 'u97', name: "Pizza Company", phone: "1112", rating: 4.6, time: "25-35 min", image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=500&q=60", category: "Italian", status: 'open', location: { lat: 13.8500, lng: 100.6000 } }, 
];

const INITIAL_RIDERS = [
  // Removed initial rider to test registration
  { id: 102, userId: 'u98', name: "วินัย ขยันซอย", phone: "089-999-8888", status: 'active', balance: 500, location: { lat: 13.7500, lng: 100.5050 } }, 
  { id: 103, userId: 'u99', name: "สมศักดิ์ รักงาน", phone: "081-555-6666", status: 'banned', balance: 0, location: { lat: 13.7563, lng: 100.5018 } },
];

const INITIAL_MENU_ITEMS = {
  1: [ 
    { id: 101, name: "ข้าวมันไก่ต้ม (สูตรเด็ด)", price: 50, desc: "เนื้อนุ่ม ข้าวหอม น้ำจิ้มรสเด็ด", available: true, image: "https://images.unsplash.com/photo-1516685018646-549198525c1b?auto=format&fit=crop&w=200&q=60" },
    { id: 102, name: "ข้าวมันไก่ทอด", price: 55, desc: "กรอบนอกนุ่มใน", available: true, image: "https://images.unsplash.com/photo-1626804475297-4110892ae3fc?auto=format&fit=crop&w=200&q=60" },
  ],
  2: [
    { id: 201, name: "Whopper Set", price: 199, desc: "เบอร์เกอร์เนื้อย่างไฟ พร้อมเฟรนช์ฟรายส์", available: true },
    { id: 202, name: "Chicken Burger", price: 89, desc: "ไก่กรอบ ซอสมายองเนส", available: true },
  ],
  3: [
    { id: 301, name: "Salmon Set", price: 250, desc: "แซลมอนซาชิมิ 5 ชิ้น + ข้าว", available: true },
    { id: 302, name: "California Roll", price: 120, desc: "ไข่กุ้ง ปูอัด อะโวคาโด", available: false },
  ],
  4: [
    { id: 401, name: "Hawaiian Pizza", price: 320, desc: "แฮม สับปะรด ชีสแน่นๆ", available: true },
    { id: 402, name: "Spaghetti Carbonara", price: 180, desc: "ครีมซอส เบคอน", available: true },
  ],
};

const STATUS_LABELS = {
  pending: { label: "รอร้านรับออเดอร์", color: "text-orange-500", bg: "bg-orange-100" },
  preparing: { label: "กำลังเตรียมอาหาร", color: "text-blue-500", bg: "bg-blue-100" },
  ready_to_pickup: { label: "รอไรเดอร์รับงาน", color: "text-purple-500", bg: "bg-purple-100" },
  rider_accepted: { label: "ไรเดอร์รับงานแล้ว", color: "text-indigo-500", bg: "bg-indigo-100" },
  picking_up: { label: "ถึงจุดรับ/รอรับของ", color: "text-indigo-600", bg: "bg-indigo-100" },
  delivering: { label: "ไรเดอร์กำลังไปส่ง", color: "text-blue-600", bg: "bg-blue-100" },
  delivered: { label: "จัดส่งสำเร็จ", color: "text-green-600", bg: "bg-green-100" },
  cancelled: { label: "ยกเลิกแล้ว", color: "text-red-500", bg: "bg-red-100" },
};

// Robust ID Generator
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// --- Skeleton Loading Component ---
const SkeletonRestaurantCard = () => (
  <div className="restaurant-card mb-4">
    <div className="skeleton skeleton-card" style={{borderRadius: '20px 20px 0 0'}}></div>
    <div className="p-3">
      <div className="skeleton skeleton-title mb-2 w-2/3"></div>
      <div className="skeleton skeleton-text w-1/2"></div>
    </div>
  </div>
);

// --- World-Class Restaurant Card Component ---
const RestaurantCard = ({ rest, appConfig, onSelect, userProfile }) => {
  const isOutOfRange = rest.distance > appConfig.restaurantRadius;
  const isMyShop = rest.ownerId === userProfile.id;
  const isDisabled = rest.status !== 'open' || isOutOfRange;

  return (
    <div
      onClick={() => !isDisabled && onSelect(rest)}
      className={`restaurant-card mb-4 ${isDisabled ? 'opacity-60' : 'card-hover'} ${isMyShop ? 'ring-2 ring-orange-400' : ''}`}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={`ร้าน ${rest.name}`}
    >
      <div className="relative overflow-hidden" style={{height: 160}}>
        <img
          src={rest.image}
          alt={rest.name}
          className="restaurant-card-img"
          loading="lazy"
          decoding="async"
        />
        {/* Category Badge */}
        <span className="restaurant-card-badge">{rest.category}</span>
        {/* Delivery Time */}
        <span className="absolute bottom-2 right-2 bg-white/95 text-gray-700 text-xs font-semibold px-2 py-1 rounded-full shadow flex items-center gap-1">
          <Clock size={11}/> {rest.time}
        </span>
        {/* Closed / Out of range overlay */}
        {rest.status === 'closed' && (
          <div className="restaurant-card-closed-overlay">ร้านปิด</div>
        )}
        {isOutOfRange && (
          <div className="restaurant-card-closed-overlay">นอกพื้นที่</div>
        )}
        {isMyShop && (
          <span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">ร้านคุณ</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex justify-between items-start">
          <h3 className="font-bold text-base text-gray-800 leading-tight">{rest.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            rest.distance <= appConfig.riderRadius
              ? 'bg-green-100 text-green-700'
              : 'bg-orange-100 text-orange-600'
          }`}>{rest.distance} กม.</span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-sm text-gray-500">
          <span className="flex items-center gap-0.5 text-yellow-500 font-semibold">
            <Star size={13} className="fill-current"/> {rest.rating}
          </span>
          <span className="text-gray-300">•</span>
          <span className="text-gray-500">ค่าส่ง ฿{appConfig.baseFee + Math.ceil(rest.distance) * appConfig.perKmFee}</span>
        </div>
      </div>
    </div>
  );
};

// --- Toast Notification Component ---
const ToastContainer = ({ toasts, removeToast }) => {
    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
            {toasts.map(toast => (
                <div 
                    key={toast.id} 
                    className={`p-4 rounded-lg shadow-xl flex items-start transform transition-all duration-300 animate-in slide-in-from-right pointer-events-auto border-l-4 ${
                        toast.type === 'success' ? 'bg-white border-green-500 text-gray-800' :
                        toast.type === 'error' ? 'bg-white border-red-500 text-gray-800' :
                        toast.type === 'warning' ? 'bg-white border-orange-500 text-gray-800' :
                        'bg-white border-blue-500 text-gray-800'
                    }`}
                >
                    <div className={`mr-3 mt-0.5 ${
                        toast.type === 'success' ? 'text-green-500' :
                        toast.type === 'error' ? 'text-red-500' :
                        toast.type === 'warning' ? 'text-orange-500' :
                        'text-blue-500'
                    }`}>
                        {toast.type === 'success' ? <CheckCircle size={20} /> :
                         toast.type === 'error' ? <AlertCircle size={20} /> :
                         toast.type === 'warning' ? <Bell size={20} /> :
                         <Info size={20} />}
                    </div>
                    <div className="flex-1">
                        <h4 className={`font-bold text-sm ${
                             toast.type === 'success' ? 'text-green-700' :
                             toast.type === 'error' ? 'text-red-700' :
                             toast.type === 'warning' ? 'text-orange-700' :
                             'text-blue-700'
                        }`}>
                            {toast.title}
                        </h4>
                        <p className="text-sm text-gray-600 leading-snug mt-1">{toast.message}</p>
                    </div>
                    <button onClick={() => removeToast(toast.id)} className="text-gray-400 hover:text-gray-600 ml-2"><X size={16}/></button>
                </div>
            ))}
        </div>
    );
};

// --- Interactive Map Component ---
const InteractiveMap = ({ 
    mode = 'view', // 'view' | 'select'
    userLocation, 
    shopLocation, 
    riderLocation, 
    onLocationSelect,
    status,
    isParcel = false, // Added prop to change icon for parcel
    className = "" 
}) => {
    const mapRef = useRef(null);

    const handleMapClick = (e) => {
        if (mode !== 'select') return;
        const rect = mapRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const latPercent = (y / rect.height) * 100;
        const lngPercent = (x / rect.width) * 100;

        const newLat = 13.7 + (latPercent / 1000); 
        const newLng = 100.5 + (lngPercent / 1000);

        onLocationSelect({ lat: newLat, lng: newLng, x: lngPercent, y: latPercent });
    };

    const toPercent = (loc) => {
        if (!loc) return { top: '50%', left: '50%' };
        if (loc.x !== undefined && loc.y !== undefined) return { top: `${loc.y}%`, left: `${loc.x}%` };
        
        const y = (loc.lat - 13.7) * 500; 
        const x = (loc.lng - 100.5) * 500;
        return { top: `${Math.min(Math.max(y, 10), 90)}%`, left: `${Math.min(Math.max(x, 10), 90)}%` };
    };

    const userPos = toPercent(userLocation);
    const shopPos = toPercent(shopLocation);
    const riderPos = toPercent(riderLocation);

    let lineStart = shopPos;
    let lineEnd = userPos;
    if (riderLocation) {
        lineStart = riderPos;
        lineEnd = ['delivering'].includes(status) ? userPos : shopPos;
    }

    return (
        <div 
            ref={mapRef}
            onClick={handleMapClick}
            className={`w-full bg-gray-100 rounded-xl relative overflow-hidden border-2 shadow-inner mb-4 transition-all ${className || 'h-64'} ${mode === 'select' ? 'border-green-500 cursor-crosshair hover:bg-gray-50' : 'border-gray-300'}`}
        >
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/city-map.png')] opacity-20 pointer-events-none"></div>
            <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 pointer-events-none opacity-10">
                {[...Array(16)].map((_, i) => <div key={i} className="border border-gray-400"></div>)}
            </div>

            {mode === 'select' && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-green-600 text-white text-xs px-3 py-1 rounded-full shadow-lg z-30 pointer-events-none animate-bounce">
                    แตะเพื่อปักหมุดตำแหน่ง
                </div>
            )}

            {userLocation && (
                <div className="absolute transform -translate-x-1/2 -translate-y-full z-20 transition-all duration-300" style={userPos}>
                    <MapPin size={32} className="text-red-500 fill-current drop-shadow-lg"/>
                    <div className="w-2 h-2 bg-black/50 rounded-full mx-auto blur-[1px]"></div>
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-white/80 px-1 rounded shadow text-nowrap">{isParcel ? 'จุดส่ง' : 'ลูกค้า'}</span>
                </div>
            )}

            {(mode === 'view' || isParcel) && shopLocation && (
                <div className="absolute transform -translate-x-1/2 -translate-y-full z-10" style={shopPos}>
                    <div className="bg-white p-1 rounded-full shadow-md">
                        {isParcel ? <Package size={20} className="text-blue-600"/> : <ChefHat size={20} className="text-orange-500"/>}
                    </div>
                    <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-white/80 px-1 rounded shadow text-nowrap">{isParcel ? 'จุดรับ' : 'ร้านค้า'}</span>
                </div>
            )}

            {mode === 'view' && riderLocation && (
                <div 
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-[2000ms] ease-linear" 
                    style={riderPos}
                >
                    <div className="bg-green-600 text-white p-1.5 rounded-full shadow-xl border-2 border-white">
                        <Bike size={20}/>
                    </div>
                    <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-20"></div>
                </div>
            )}
            
            {/* Route Line */}
            {mode === 'view' && userLocation && shopLocation && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                    <line 
                        x1={lineStart.left} y1={lineStart.top} 
                        x2={lineEnd.left} y2={lineEnd.top} 
                        stroke="#3b82f6" strokeWidth="3" strokeDasharray="6,4" 
                        className="opacity-50 animate-pulse"
                    />
                </svg>
            )}
        </div>
    );
};

export default function SuperDeliveryApp() {
  const [activeRole, setActiveRole] = useState('customer'); 
  const [orders, setOrders] = useState([]);
  const [appConfig, setAppConfig] = useState(INITIAL_CONFIG);
  const [restaurants, setRestaurants] = useState(INITIAL_RESTAURANTS);
  const [riders, setRiders] = useState(INITIAL_RIDERS);
  const [menuItems, setMenuItems] = useState(INITIAL_MENU_ITEMS); 
  const [pendingRequests, setPendingRequests] = useState([]);

  // UI State
  const [adminTab, setAdminTab] = useState('dashboard');
  const [merchantTab, setMerchantTab] = useState('orders');
  const [riderTab, setRiderTab] = useState('jobs');
  const [profileSubView, setProfileSubView] = useState('main');

  // Authentication State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ phone: '', email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ phone: '', email: '', password: '', confirmPassword: '', name: '' });
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'

  // Data State
  const [userProfile, setUserProfile] = useState({
      id: "u1", 
      name: "คุณลูกค้า สุดหล่อ",
      phone: "081-234-5678",
      email: "somchai@example.com",
      location: USER_LOCATION 
  });
  const [userRoles, setUserRoles] = useState(['customer']); 
  const [userAddresses, setUserAddresses] = useState([
      { id: 1, label: "บ้าน", address: "123 คอนโดใจกลางเมือง", location: USER_LOCATION },
  ]);
  const [userWallet, setUserWallet] = useState(450.00); 
  const [walletHistory, setWalletHistory] = useState([
      { id: 'init-1', type: 'deposit', amount: 500, date: '01/10/2023', desc: 'เติมเงิน (สำเร็จ)' },
  ]);

  const [cart, setCart] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [activeTab, setActiveTab] = useState('home'); 
  const [serviceType, setServiceType] = useState('food'); 
  const [parcelDetails, setParcelDetails] = useState({ pickup: '', dropoff: '', weight: '1', distance: 0 });
  const [paymentMethod, setPaymentMethod] = useState('wallet'); 

  // Form & Modal State
  const [newAddr, setNewAddr] = useState({ label: '', fullAddr: '', location: null }); 
  const [withdrawMode, setWithdrawMode] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBank, setWithdrawBank] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [withdrawName, setWithdrawName] = useState(userProfile.name);
  const [tempProfile, setTempProfile] = useState(userProfile);
  const [merchantRegForm, setMerchantRegForm] = useState({ shopName: '', category: 'Street Food', realName: '', idCard: '', phone: '', bankName: '', bankAccount: '', idCardImage: null, shopImage: null });
  const [riderRegForm, setRiderRegForm] = useState({ realName: '', vehicle: 'Motorcycle', idCard: '', phone: '', bankName: '', bankAccount: '', idCardImage: null, profileImage: null });
  const [editConfig, setEditConfig] = useState(INITIAL_CONFIG);
  const [isEditingMenu, setIsEditingMenu] = useState(null); 
  const [editForm, setEditForm] = useState({ name: '', price: '', desc: '', image: '' });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedOrderToCancel, setSelectedOrderToCancel] = useState(null);
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedRequestToReject, setSelectedRequestToReject] = useState(null);
  const [riderJobPhotos, setRiderJobPhotos] = useState({}); 
  const [showProofModal, setShowProofModal] = useState(false);
  const [selectedProofOrder, setSelectedProofOrder] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  
  // TopUp Modal & Slip
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpSlip, setTopUpSlip] = useState(null);

  // Chat State
  const [activeChat, setActiveChat] = useState(null); 
  const [chats, setChats] = useState({});

  // Parcel Map State
  const [parcelMapTarget, setParcelMapTarget] = useState(null); 
  const [parcelDistance, setParcelDistance] = useState(0);
  const [parcelEstimate, setParcelEstimate] = useState(0);
  
  // Toast State
  const [toasts, setToasts] = useState([]);

  // --- Authentication Functions ---
  useEffect(() => {
    // Restore session from localStorage (local mode)
    const savedUser = localStorage.getItem('boomrider_user');
    if (savedUser) {
      const user = JSON.parse(savedUser);
      setCurrentUser(user);
      setIsLoggedIn(true);
      setUserProfile(user.profile);
      setUserRoles(user.roles);
      setUserWallet(user.wallet);
      setWalletHistory(user.walletHistory);
      setUserAddresses(user.addresses);
    }

    // Firebase Auth state observer
    if (FIREBASE_ENABLED) {
      const unsubscribe = onAuthChange(async (firebaseUser) => {
        if (firebaseUser) {
          // Bootstrap or refresh session from Firebase user
          const savedRaw = localStorage.getItem('boomrider_user');
          const saved = savedRaw ? JSON.parse(savedRaw) : null;
          // Skip if already logged in as this exact Firebase user
          if (saved && saved.id === firebaseUser.uid) return;
          const profile = {
            id: firebaseUser.uid,
            name: firebaseUser.displayName || firebaseUser.email || 'ผู้ใช้ใหม่',
            phone: firebaseUser.phoneNumber || '',
            email: firebaseUser.email || '',
            image: firebaseUser.photoURL || null,
            location: USER_LOCATION,
          };
          const newUser = {
            id: firebaseUser.uid,
            phone: firebaseUser.phoneNumber || '',
            email: firebaseUser.email || '',
            profile,
            roles: ['customer'],
            wallet: saved?.wallet !== undefined ? saved.wallet : 0,
            walletHistory: saved?.walletHistory || [],
            addresses: saved?.addresses || [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
          };
          setCurrentUser(newUser);
          setIsLoggedIn(true);
          setUserProfile(profile);
          setUserRoles(['customer']);
          localStorage.setItem('boomrider_user', JSON.stringify(newUser));

          // Request push notification permission
          try {
            const fcmToken = await requestNotificationPermission();
            if (fcmToken) await saveFcmToken(firebaseUser.uid, fcmToken);
          } catch (_) {}
        } else {
          // Firebase signed out — clear only if session was Firebase-based
          const savedRaw = localStorage.getItem('boomrider_user');
          const saved = savedRaw ? JSON.parse(savedRaw) : null;
          if (saved && saved.id && saved.id.length > 20) {
            // Firebase UIDs are long strings; local IDs are short
            localStorage.removeItem('boomrider_user');
            setIsLoggedIn(false);
            setCurrentUser(null);
          }
        }
      });

      // Foreground message handler
      onForegroundMessage((msg) => {
        notifySystem(msg.title, msg.body, 'info');
      });

      return () => unsubscribe();
    }
  }, []);

  const handleLogin = async () => {
    if (!loginForm.phone && !loginForm.email) {
      return notifySystem("ผิดพลาด", "กรุณากรอกเบอร์โทรหรืออีเมล", "error");
    }
    if (!loginForm.password) {
      return notifySystem("ผิดพลาด", "กรุณากรอกรหัสผ่าน", "error");
    }

    // Firebase Auth (when configured)
    if (FIREBASE_ENABLED && loginForm.email) {
      try {
        const fbUser = await loginWithEmail(loginForm.email, loginForm.password);
        const savedRaw = localStorage.getItem('boomrider_user');
        const saved = savedRaw ? JSON.parse(savedRaw) : null;
        const profile = {
          id: fbUser.uid,
          name: fbUser.displayName || saved?.name || loginForm.email,
          phone: fbUser.phoneNumber || saved?.phone || '',
          email: fbUser.email || loginForm.email,
          image: fbUser.photoURL || saved?.profile?.image || null,
          location: USER_LOCATION,
        };
        const user = {
          id: fbUser.uid,
          name: profile.name,
          phone: profile.phone,
          email: profile.email,
          profile,
          roles: saved?.roles || ['customer'],
          wallet: saved?.wallet ?? 0,
          walletHistory: saved?.walletHistory || [],
          addresses: saved?.addresses || [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
        };
        localStorage.setItem('boomrider_user', JSON.stringify(user));
        setCurrentUser(user);
        setIsLoggedIn(true);
        setUserProfile(profile);
        setUserRoles(user.roles);
        setUserWallet(user.wallet);
        setWalletHistory(user.walletHistory);
        setUserAddresses(user.addresses);
        notifySystem("สำเร็จ", "เข้าสู่ระบบเรียบร้อย!", "success");
        return;
      } catch (err) {
        const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
          ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
          : err.code === 'auth/user-not-found'
          ? 'ไม่พบบัญชีนี้ในระบบ'
          : err.code === 'auth/unauthorized-domain'
          ? 'Domain ยังไม่ได้รับอนุญาต กรุณาเพิ่ม domain ใน Firebase Console'
          : (err.message || 'เกิดข้อผิดพลาด');
        return notifySystem("ผิดพลาด", msg, "error");
      }
    }

    // Local fallback
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const user = users.find(u =>
      (u.phone === loginForm.phone && loginForm.phone) ||
      (u.email === loginForm.email && loginForm.email)
    );
    if (!user || user.password !== loginForm.password) {
      return notifySystem("ผิดพลาด", "เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง", "error");
    }
    setCurrentUser(user);
    setIsLoggedIn(true);
    setUserProfile(user.profile);
    setUserRoles(user.roles);
    setUserWallet(user.wallet);
    setWalletHistory(user.walletHistory);
    setUserAddresses(user.addresses);
    localStorage.setItem('boomrider_user', JSON.stringify(user));
    notifySystem("สำเร็จ", "เข้าสู่ระบบเรียบร้อย!", "success");
  };

  const handleLoginWithGoogle = async () => {
    if (!FIREBASE_ENABLED) return notifySystem("แจ้งเตือน", "Firebase ยังไม่ได้ตั้งค่า", "warning");
    try {
      await loginWithGoogle();
      notifySystem("สำเร็จ", "เข้าสู่ระบบด้วย Google เรียบร้อย!", "success");
    } catch (err) {
      notifySystem("ผิดพลาด", err.message || 'Google login ล้มเหลว', "error");
    }
  };

  const handleRegister = async () => {
    if (!registerForm.name) {
      return notifySystem("ผิดพลาด", "กรุณากรอกชื่อ-นามสกุล", "error");
    }
    if (!registerForm.phone && !registerForm.email) {
      notifySystem("ผิดพลาด", "กรุณากรอกเบอร์โทรหรืออีเมล", "error");
      return;
    }
    if (!registerForm.password) {
      notifySystem("ผิดพลาด", "กรุณากรอกรหัสผ่าน", "error");
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      notifySystem("ผิดพลาด", "รหัสผ่านไม่ตรงกัน", "error");
      return;
    }

    // Firebase register (when configured and email provided)
    if (FIREBASE_ENABLED && registerForm.email) {
      try {
        const fbUser = await registerWithEmail(registerForm.email, registerForm.password, registerForm.name);
        const profile = {
          id: fbUser.uid,
          name: registerForm.name,
          phone: registerForm.phone,
          email: registerForm.email,
          image: null,
          location: USER_LOCATION,
        };
        const newUser = {
          id: fbUser.uid,
          name: registerForm.name,
          phone: registerForm.phone,
          email: registerForm.email,
          profile,
          roles: ['customer'],
          wallet: 0,
          walletHistory: [],
          addresses: [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
        };
        localStorage.setItem('boomrider_user', JSON.stringify(newUser));
        setCurrentUser(newUser);
        setIsLoggedIn(true);
        setUserProfile(profile);
        setUserRoles(['customer']);
        setUserWallet(0);
        setWalletHistory([]);
        setUserAddresses(newUser.addresses);
        notifySystem("สำเร็จ", "สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ", "success");
        return;
      } catch (err) {
        const msg = err.code === 'auth/email-already-in-use'
          ? 'อีเมลนี้ถูกใช้งานแล้ว'
          : err.code === 'auth/weak-password'
          ? 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
          : err.code === 'auth/unauthorized-domain'
          ? 'Domain ยังไม่ได้รับอนุญาต กรุณาเพิ่ม domain ใน Firebase Console'
          : (err.message || 'เกิดข้อผิดพลาด');
        return notifySystem("ผิดพลาด", msg, "error");
      }
    }

    // Local fallback
    const users = JSON.parse(localStorage.getItem('boomrider_users') || '[]');
    const existingUser = users.find(u =>
      (u.phone === registerForm.phone && registerForm.phone) ||
      (u.email === registerForm.email && registerForm.email)
    );
    if (existingUser) {
      return notifySystem("ผิดพลาด", "เบอร์โทรหรืออีเมลนี้ถูกใช้งานแล้ว", "error");
    }

    const newUser = {
      id: generateId(),
      name: registerForm.name,
      phone: registerForm.phone,
      email: registerForm.email,
      password: registerForm.password,
      profile: {
        id: generateId(),
        name: registerForm.name,
        phone: registerForm.phone,
        email: registerForm.email,
        location: USER_LOCATION,
        image: null,
      },
      roles: ['customer'],
      wallet: 0,
      walletHistory: [],
      addresses: [{ id: 1, label: 'บ้าน', address: 'กรุณาเพิ่มที่อยู่', location: USER_LOCATION }],
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    localStorage.setItem('boomrider_users', JSON.stringify(users));
    localStorage.setItem('boomrider_user', JSON.stringify(newUser));
    setCurrentUser(newUser);
    setIsLoggedIn(true);
    setUserProfile(newUser.profile);
    setUserRoles(newUser.roles);
    setUserWallet(newUser.wallet);
    setWalletHistory(newUser.walletHistory);
    setUserAddresses(newUser.addresses);
    notifySystem("สำเร็จ", "สมัครใช้งานเรียบร้อย! ยินดีต้อนรับ", "success");
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setUserProfile({
      id: "u1", 
      name: "คุณลูกค้า สุดหล่อ",
      phone: "081-234-5678",
      email: "somchai@example.com",
      location: USER_LOCATION 
    });
    setUserRoles(['customer']);
    setUserWallet(450.00);
    setWalletHistory([{ id: 'init-1', type: 'deposit', amount: 500, date: '01/10/2023', desc: 'เติมเงิน (สำเร็จ)' }]);
    setUserAddresses([{ id: 1, label: "บ้าน", address: "123 คอนโดใจกลางเมือง", location: USER_LOCATION }]);
    localStorage.removeItem('boomrider_user');
    if (FIREBASE_ENABLED) firebaseLogout().catch(() => {});
    setActiveRole('customer');
    setActiveTab('home');
    setProfileSubView('main');
  };

  // Save user data to localStorage when it changes
  useEffect(() => {
    if (isLoggedIn && currentUser) {
      const updatedUser = {
        ...currentUser,
        profile: userProfile,
        roles: userRoles,
        wallet: userWallet,
        walletHistory: walletHistory,
        addresses: userAddresses
      };
      localStorage.setItem('boomrider_user', JSON.stringify(updatedUser));
    }
  }, [userProfile, userRoles, userWallet, walletHistory, userAddresses]);

  // --- System Notification (Sound & Vibration) ---
  const notifySystem = (title, message, type = 'info') => {
      // 1. Add Visual Toast
      const id = Date.now();
      setToasts(prev => [...prev, { id, title, message, type }]);
      setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);

      // 2. Play Sound
      try {
          const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3"); // Generic notification sound
          audio.volume = 0.5;
          audio.play().catch(e => console.log("Audio play failed (interaction required):", e));
      } catch (e) {
          console.error("Audio error", e);
      }

      // 3. Vibrate (Mobile only)
      if (navigator.vibrate) {
          // Vibrate pattern: 200ms on, 100ms off, 200ms on
          navigator.vibrate([200, 100, 200]);
      }
  };

  const removeToast = (id) => {
      setToasts(prev => prev.filter(t => t.id !== id));
  };


  // --- Real-time Simulation Effect ---
  useEffect(() => {
    const interval = setInterval(() => {
        setOrders(prevOrders => prevOrders.map(order => {
            if (['rider_accepted', 'picking_up', 'delivering'].includes(order.status) && order.riderId) {
                let currentPos = order.riderLocation || order.pickupLocation || USER_LOCATION;
                let targetPos = ['delivering'].includes(order.status) ? (order.location || USER_LOCATION) : (order.pickupLocation || USER_LOCATION);
                const step = 0.05;
                const newLat = currentPos.lat + (targetPos.lat - currentPos.lat) * step;
                const newLng = currentPos.lng + (targetPos.lng - currentPos.lng) * step;
                let newX = currentPos.x;
                let newY = currentPos.y;
                if (currentPos.x !== undefined && targetPos.x !== undefined) {
                    newX = currentPos.x + (targetPos.x - currentPos.x) * step;
                    newY = currentPos.y + (targetPos.y - currentPos.y) * step;
                }
                return {
                    ...order,
                    riderLocation: { lat: newLat, lng: newLng, x: newX, y: newY }
                };
            }
            return order;
        }));
    }, 1000); 
    return () => clearInterval(interval);
  }, []);

  // Update Parcel Estimate when locations change
  useEffect(() => {
      if (parcelDetails.pickupLocation && parcelDetails.dropoffLocation) {
          const d = getDistanceFromLatLonInKm(
              parcelDetails.pickupLocation.lat, parcelDetails.pickupLocation.lng,
              parcelDetails.dropoffLocation.lat, parcelDetails.dropoffLocation.lng
          );
          setParcelDistance(d);
          setParcelEstimate(Math.ceil(appConfig.baseFee + (d * appConfig.perKmFee)));
      }
  }, [parcelDetails.pickupLocation, parcelDetails.dropoffLocation, appConfig]);


  // --- Chat Logic ---
  const openChatWindow = (id, title, role) => {
    const chatId = id;
    if (!chats[chatId]) {
      setChats(prev => ({ ...prev, [chatId]: [] })); 
    }
    setActiveChat({ id: chatId, title, role }); 
  };

  const closeChatWindow = () => {
    setActiveChat(null);
  };

  const sendMessage = (text) => {
    if (!text.trim() || !activeChat) return;
    const sender = activeRole;
    const newMessage = { text, sender, time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) };
    
    setChats(prev => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), newMessage]
    }));
  };

  // --- Logic Helpers ---

  const handleMapLocationSelect = (loc) => {
      const mockAddress = `ปักหมุดที่: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
      setNewAddr(prev => ({ ...prev, fullAddr: mockAddress, location: loc }));
  };
  
  const handleParcelMapSelect = (loc) => {
      const mockAddr = `พิกัด: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
      if (parcelMapTarget === 'pickup') {
          setParcelDetails(prev => ({ ...prev, pickup: mockAddr, pickupLocation: loc }));
      } else if (parcelMapTarget === 'dropoff') {
          setParcelDetails(prev => ({ ...prev, dropoff: mockAddr, dropoffLocation: loc }));
      }
  };
  
  const getCurrentLocationForForm = () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const newLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                x: 50, y: 50
            };
            const mockAddr = `พิกัด GPS: ${newLocation.lat.toFixed(6)}, ${newLocation.lng.toFixed(6)}`;
            setNewAddr(prev => ({ ...prev, location: newLocation, fullAddr: mockAddr }));
            notifySystem("สำเร็จ", "ดึงพิกัดปัจจุบันเรียบร้อย!", "success");
        }, (err) => {
            console.error(err);
            notifySystem("ผิดพลาด", "ไม่สามารถดึงพิกัดได้ (กรุณาเปิด GPS)", "error");
        });
    } else {
        alert("Browser ไม่รองรับ Geolocation");
    }
  };

  const isPending = (type) => pendingRequests.some(r => r.type === type && r.userId === userProfile.id);

  const calculateDeliveryFee = (distance) => appConfig.baseFee + (Math.ceil(distance) * appConfig.perKmFee);

  const addToCart = (item, restaurantId, restaurantName, distance) => {
    if (!item.available) return notifySystem("ขออภัย", "เมนูนี้หมดแล้ว", "error");
    if (cart.length > 0 && cart[0].restaurantId !== restaurantId) {
      if (!window.confirm("คุณต้องการเริ่มออเดอร์ใหม่จากร้านนี้ใช่ไหม? (ตะกร้าเก่าจะถูกลบ)")) return;
      setCart([{ ...item, restaurantId, restaurantName, qty: 1, distance }]);
    } else {
      const existing = cart.find(c => c.id === item.id);
      if (existing) {
        setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      } else {
        setCart([...cart, { ...item, restaurantId, restaurantName, qty: 1, distance }]);
      }
      notifySystem("เพิ่มลงตะกร้า", `เพิ่ม ${item.name} แล้ว`, "success");
    }
  };

  const calculateFoodTotal = () => cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  // --- Wallet Logic ---
  const processTransaction = (type, amount, description) => {
      setUserWallet(prev => prev + amount);
      setWalletHistory(prev => [{
          id: generateId(),
          type: type,
          amount: amount,
          date: new Date().toLocaleString('th-TH'),
          desc: description
      }, ...prev]);
  };

  const placeOrder = () => {
    if (cart.length === 0) return;
    const distance = cart[0].distance;
    const foodTotal = calculateFoodTotal();
    const deliveryFee = calculateDeliveryFee(distance);
    const grandTotal = foodTotal + deliveryFee;

    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
        return notifySystem("ยอดเงินไม่พอ", "กรุณาเติมเงินหรือเลือกชำระเงินสด", "error");
    }

    const adminGP = (foodTotal * (appConfig.gpFood / 100)) + (deliveryFee * (appConfig.gpDelivery / 100));
    const merchantIncome = foodTotal * (1 - (appConfig.gpFood / 100)); 
    const riderIncome = deliveryFee * (1 - (appConfig.gpDelivery / 100)); 

    const newOrder = {
      id: `OD-${Math.floor(Math.random() * 10000)}`,
      type: 'food',
      items: cart,
      foodTotal: foodTotal,
      deliveryFee: deliveryFee,
      grandTotal: grandTotal, 
      paymentMethod: paymentMethod, 
      distance: distance,
      adminGP: adminGP,
      merchantIncome: merchantIncome,
      riderIncome: riderIncome,
      restaurantId: cart[0].restaurantId,
      restaurantName: cart[0].restaurantName,
      status: 'pending',
      customerName: userProfile.name,
      customerPhone: userProfile.phone, 
      customerId: userProfile.id, // Ensure customerId is saved
      address: userAddresses[0]?.address,
      location: userAddresses[0]?.location,
      pickupLocation: restaurants.find(r => r.id === cart[0].restaurantId)?.location || USER_LOCATION,
      timestamp: new Date().toLocaleString('th-TH'),
      riderId: null,
      riderLocation: null,
      pickupPhoto: null,
      deliveryPhoto: null
    };

    setOrders([newOrder, ...orders]);
    setCart([]);
    
    if (paymentMethod === 'wallet') {
        processTransaction('payment', -grandTotal, `ชำระค่าอาหาร (${cart[0].restaurantName})`);
    }

    notifySystem("สั่งซื้อสำเร็จ", "ออเดอร์ถูกส่งไปยังร้านค้าแล้ว", "success");
    // Notify Merchant (Simulated)
    setTimeout(() => notifySystem("ร้านค้า", "มีออเดอร์ใหม่เข้ามา!", "warning"), 1000);

    setActiveTab('activity');
    setSelectedRestaurant(null);
  };

  const placeParcelOrder = () => {
    if(!parcelDetails.pickup || !parcelDetails.dropoff || !parcelDetails.pickupLocation || !parcelDetails.dropoffLocation) return notifySystem("ข้อมูลไม่ครบ", "กรุณาระบุจุดรับและจุดส่งให้ครบถ้วน", "error");
    
    const deliveryFee = parcelEstimate;
    const grandTotal = deliveryFee;

    if (parcelDistance > appConfig.appRadius) return notifySystem("นอกพื้นที่", `ระยะทาง (${parcelDistance} กม.) เกินขอบเขตให้บริการ`, "error");
    
    if (paymentMethod === 'wallet' && userWallet < grandTotal) {
        return notifySystem("ยอดเงินไม่พอ", "กรุณาเติมเงินหรือเลือกชำระเงินสด", "error");
    }

    const adminGP = deliveryFee * (appConfig.gpDelivery / 100);
    const riderIncome = deliveryFee * (1 - (appConfig.gpDelivery / 100));
    
    const newOrder = {
      id: `EX-${Math.floor(Math.random() * 10000)}`,
      type: 'parcel',
      pickup: parcelDetails.pickup,
      dropoff: parcelDetails.dropoff,
      location: parcelDetails.dropoffLocation, // Dropoff lat/lng
      pickupLocation: parcelDetails.pickupLocation, // Pickup lat/lng
      distance: parcelDistance,
      weight: parcelDetails.weight,
      grandTotal: grandTotal,
      paymentMethod: paymentMethod,
      adminGP: adminGP,
      merchantIncome: 0,
      riderIncome: riderIncome,
      status: 'ready_to_pickup',
      customerName: userProfile.name,
      customerPhone: userProfile.phone, 
      customerId: userProfile.id,
      timestamp: new Date().toLocaleString('th-TH'),
      riderId: null,
      riderLocation: null,
      pickupPhoto: null,
      deliveryPhoto: null
    };
    
    setOrders([newOrder, ...orders]);
    
    if (paymentMethod === 'wallet') {
        processTransaction('payment', -grandTotal, 'ชำระค่าส่งพัสดุ');
    }

    notifySystem("เรียกรถสำเร็จ", "กำลังค้นหาไรเดอร์...", "success");
    // Notify Rider (Simulated)
    setTimeout(() => notifySystem("ไรเดอร์", "มีงานส่งพัสดุใหม่เข้ามา!", "warning"), 1000);

    setParcelDetails({ pickup: '', dropoff: '', weight: '1', distance: 0, pickupLocation: null, dropoffLocation: null });
    setParcelMapTarget(null);
    setParcelEstimate(0);
    setParcelDistance(0);
    setActiveTab('activity');
  };

  const updateOrderStatus = (orderId, newStatus, actorId = null, extraData = {}) => {
    setOrders(prevOrders => prevOrders.map(o => {
        if (o.id !== orderId) return o;

        // Check if status actually changes to avoid duplicate toasts if applicable
        if (o.status !== newStatus) {
            // Notifications logic based on status change
            if (newStatus === 'preparing') notifySystem("อัปเดตสถานะ", `ร้านค้ารับออเดอร์ #${o.id} แล้ว`, "info");
            if (newStatus === 'ready_to_pickup') notifySystem("ไรเดอร์", `ออเดอร์ #${o.id} พร้อมส่งแล้ว (แจ้งไรเดอร์)`, "warning");
            if (newStatus === 'rider_accepted') notifySystem("อัปเดตสถานะ", `ไรเดอร์รับงาน #${o.id} แล้ว`, "success");
            if (newStatus === 'picking_up') notifySystem("อัปเดตสถานะ", `ไรเดอร์ถึงร้านค้า/จุดรับแล้ว`, "info");
            if (newStatus === 'delivering') notifySystem("อัปเดตสถานะ", `ไรเดอร์รับของแล้ว กำลังไปส่ง`, "info");
            if (newStatus === 'delivered') notifySystem("เสร็จสิ้น", `ออเดอร์ #${o.id} จัดส่งสำเร็จ!`, "success");
        }

        const updatedOrder = { ...o, status: newStatus, ...extraData };
        
        if (newStatus === 'rider_accepted' && actorId) {
            updatedOrder.riderId = actorId;
            updatedOrder.riderLocation = o.pickupLocation;
        }

        if (newStatus === 'delivered') {
            if (updatedOrder.riderId) {
                const riderProfile = riders.find(r => r.id === updatedOrder.riderId);
                if (riderProfile && riderProfile.userId === userProfile.id) {
                    processTransaction('income', o.riderIncome, `รายได้งาน ${o.restaurantName || 'พัสดุ'} (${o.paymentMethod})`);
                }
            }

            if (o.type === 'food') {
                const restaurant = restaurants.find(r => r.id === o.restaurantId);
                if (restaurant && restaurant.ownerId === userProfile.id) {
                     processTransaction('income', o.merchantIncome, `รายได้ออเดอร์ ${o.id} (${o.paymentMethod})`);
                }
            }
        }

        return updatedOrder;
    }));
  };

  const handleRiderPhotoUpload = (orderId, type, event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setRiderJobPhotos(prev => ({
          ...prev,
          [orderId]: { ...prev[orderId], [type]: reader.result }
        }));
        notifySystem("สำเร็จ", "อัปโหลดรูปภาพเรียบร้อย", "success");
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleProfilePhotoChange = (event) => {
      const file = event.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setTempProfile(prev => ({ ...prev, image: reader.result }));
          };
          reader.readAsDataURL(file);
      }
  };

  const handleShopPhotoChange = (restaurantId, event) => {
      const file = event.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setRestaurants(prev => prev.map(r => r.id === restaurantId ? { ...r, image: reader.result } : r));
              notifySystem("สำเร็จ", "อัปเดตรูปหน้าร้านสำเร็จ", "success");
          };
          reader.readAsDataURL(file);
      }
  };

  const handleRegistrationPhotoSelect = (event, setForm, field) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm(prev => ({ ...prev, [field]: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleTopUpSlipSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTopUpSlip(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleMenuPhotoSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditForm(prev => ({ ...prev, image: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const openImagePreview = (url) => {
      setPreviewImageUrl(url);
      setShowImageModal(true);
  };

  // --- Merchant Management ---
  const handleToggleShopStatus = (restaurantId) => {
      setRestaurants(restaurants.map(r => {
          if (r.id === restaurantId) {
              const newStatus = r.status === 'open' ? 'closed' : 'open';
              notifySystem("สถานะร้าน", `ร้านค้า ${newStatus === 'open' ? 'เปิด' : 'ปิด'} แล้ว`, "info");
              return { ...r, status: newStatus };
          }
          return r;
      }));
  };

  const handleAddMenuItem = (restaurantId, newItem) => {
      const currentItems = menuItems[restaurantId] || [];
      const itemWithId = { ...newItem, id: generateId(), available: true };
      setMenuItems({ ...menuItems, [restaurantId]: [...currentItems, itemWithId] });
      notifySystem("สำเร็จ", "เพิ่มเมนูเรียบร้อย", "success");
  };

  const handleEditMenuItem = (restaurantId, itemId, updatedItem) => {
      const currentItems = menuItems[restaurantId];
      const newItems = currentItems.map(item => item.id === itemId ? { ...item, ...updatedItem } : item);
      setMenuItems({ ...menuItems, [restaurantId]: newItems });
      notifySystem("สำเร็จ", "แก้ไขเมนูเรียบร้อย", "success");
  };

  const handleDeleteMenuItem = (restaurantId, itemId) => {
      if(!window.confirm("ยืนยันการลบเมนูนี้?")) return;
      const currentItems = menuItems[restaurantId];
      const newItems = currentItems.filter(item => item.id !== itemId);
      setMenuItems({ ...menuItems, [restaurantId]: newItems });
      notifySystem("สำเร็จ", "ลบเมนูเรียบร้อย", "success");
  };

  const handleToggleItemAvailability = (restaurantId, itemId) => {
      const currentItems = menuItems[restaurantId];
      const newItems = currentItems.map(item => item.id === itemId ? { ...item, available: !item.available } : item);
      setMenuItems({ ...menuItems, [restaurantId]: newItems });
  };

  // --- Request Logic ---
  const requestTopUp = (amount, slipImage) => {
      const newReq = { 
          id: generateId(), 
          type: 'topup', 
          data: { amount, slipImage }, // Attach slip image
          userId: userProfile.id, 
          user: userProfile.name, 
          timestamp: new Date().toLocaleString('th-TH') 
      };
      setPendingRequests([newReq, ...pendingRequests]);
      setShowTopUpModal(false);
      setTopUpSlip(null);
      setWithdrawAmount(''); 
      notifySystem("สำเร็จ", "แจ้งโอนเงินเรียบร้อย รอตรวจสอบ", "success");
      setTimeout(() => notifySystem("Admin", "มีรายการแจ้งโอนเงินใหม่!", "warning"), 1500);
  };

  const requestWithdraw = (amount, bankInfo) => {
      if(userWallet < amount) return notifySystem("ผิดพลาด", "ยอดเงินในกระเป๋าไม่เพียงพอ", "error");
      const newReq = { 
          id: generateId(), 
          type: 'withdraw', 
          data: { amount, ...bankInfo }, 
          userId: userProfile.id, 
          user: userProfile.name, 
          timestamp: new Date().toLocaleString('th-TH') 
      };
      setPendingRequests([newReq, ...pendingRequests]);
      notifySystem("สำเร็จ", "แจ้งถอนเงินเรียบร้อย รอตรวจสอบ", "success");
      setTimeout(() => notifySystem("Admin", "มีรายการแจ้งถอนเงินใหม่!", "warning"), 1500);
  };

  const requestRegisterMerchant = (data) => {
      if (!data.shopName || !data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
          return notifySystem("ข้อมูลไม่ครบ", "กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน", "error");
      }
      if (restaurants.some(r => r.ownerId === userProfile.id)) return notifySystem("ซ้ำซ้อน", "คุณมีร้านค้าอยู่แล้ว", "error");
      if (isPending('merchant_reg')) return notifySystem("รออนุมัติ", "คำขอสมัครร้านค้ากำลังรอการอนุมัติ", "info");
      
      const newReq = { id: generateId(), type: 'merchant_reg', data: { ...data }, userId: userProfile.id, user: userProfile.name, timestamp: new Date().toLocaleString('th-TH') };
      setPendingRequests([newReq, ...pendingRequests]);
      notifySystem("สำเร็จ", "ส่งใบสมัครร้านค้าเรียบร้อย", "success");
      setTimeout(() => notifySystem("Admin", "มีรายการสมัครร้านค้าใหม่!", "warning"), 1500);
  };

  const requestRegisterRider = (data) => {
      if (!data.realName || !data.idCard || !data.phone || !data.bankAccount || !data.idCardImage) {
          return notifySystem("ข้อมูลไม่ครบ", "กรุณากรอกข้อมูลให้ครบถ้วนและอัปโหลดรูปบัตรประชาชน", "error");
      }
      if (isPending('rider_reg')) return notifySystem("รออนุมัติ", "คำขอสมัครไรเดอร์กำลังรอการอนุมัติ", "info");
      
      const newReq = { id: generateId(), type: 'rider_reg', data: { ...data }, userId: userProfile.id, user: userProfile.name, timestamp: new Date().toLocaleString('th-TH') };
      setPendingRequests([newReq, ...pendingRequests]);
      notifySystem("สำเร็จ", "ส่งใบสมัครไรเดอร์เรียบร้อย", "success");
      setTimeout(() => notifySystem("Admin", "มีรายการสมัครไรเดอร์ใหม่!", "warning"), 1500);
  };

  const handleAddAddress = (addr) => {
      const loc = addr.location || USER_LOCATION; // Use pinned location or default
      setUserAddresses([...userAddresses, { id: generateId(), label: addr.label, address: addr.fullAddr, location: loc }]);
      notifySystem("สำเร็จ", "บันทึกที่อยู่เรียบร้อย", "success");
  };
  
  const handleDeleteAddress = (id) => setUserAddresses(userAddresses.filter(a => a.id !== id));

  // --- Admin Logic ---
  const handleApproveRequest = (req) => {
      if (req.type === 'topup') {
          processTransaction('deposit', req.data.amount, 'เติมเงิน (อนุมัติแล้ว)');
          notifySystem("Admin", "อนุมัติเติมเงินเรียบร้อย", "success");
      } else if (req.type === 'withdraw') {
          if(userWallet < req.data.amount) return notifySystem("ผิดพลาด", "ผู้ใช้มียอดเงินไม่พอ", "error");
          processTransaction('withdraw', -req.data.amount, 'ถอนเงิน (อนุมัติแล้ว)');
          notifySystem("Admin", "อนุมัติถอนเงินเรียบร้อย", "success");
      } else if (req.type === 'merchant_reg') {
          const newId = restaurants.length + 10; 
          const newRest = { 
              id: newId, 
              ownerId: req.userId, 
              name: req.data.shopName, 
              phone: req.data.phone,
              rating: 5.0, 
              time: "20-30 min", 
              image: req.data.shopImage || "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=500&q=60", 
              category: req.data.category, 
              status: 'open', 
              location: USER_LOCATION 
          };
          setRestaurants([newRest, ...restaurants]);
          if (req.userId === userProfile.id) setUserRoles(prev => [...prev, 'merchant']);
          setMenuItems({...menuItems, [newId]: []}); 
          notifySystem("Admin", "อนุมัติร้านค้าเรียบร้อย", "success");
      } else if (req.type === 'rider_reg') {
          const newId = 200 + riders.length; 
          const newRider = { id: newId, userId: req.userId, name: req.data.realName, phone: req.data.phone, status: 'active', balance: 0, location: USER_LOCATION }; // FIXED: Added phone
          setRiders([newRider, ...riders]);
          if (req.userId === userProfile.id) setUserRoles(prev => [...prev, 'rider']);
          notifySystem("Admin", "อนุมัติไรเดอร์เรียบร้อย", "success");
      }
      setPendingRequests(pendingRequests.filter(r => r.id !== req.id));
  };

  const initiateRejectRequest = (id) => {
      setSelectedRequestToReject(id);
      setShowRejectModal(true);
  };

  const confirmRejectRequest = () => {
      if (selectedRequestToReject) {
          setPendingRequests(pendingRequests.filter(r => r.id !== selectedRequestToReject));
          setShowRejectModal(false);
          setSelectedRequestToReject(null);
          notifySystem("Admin", "ปฏิเสธคำขอเรียบร้อย", "info");
      }
  };
  
  const initiateCancelOrder = (orderId) => {
      setSelectedOrderToCancel(orderId);
      setCancelReasonInput('');
      setShowCancelModal(true);
  };

  const confirmCancelOrder = () => {
      if (!selectedOrderToCancel) return;
      const orderId = selectedOrderToCancel;
      const reason = cancelReasonInput || "มีปัญหาแจ้งเข้ามา";

      setOrders(prevOrders => prevOrders.map(o => {
          if (o.id === orderId) {
              return { ...o, status: 'cancelled', cancelReason: reason };
          }
          return o;
      }));

      const order = orders.find(o => o.id === orderId);
      if (order && order.status !== 'cancelled' && order.status !== 'delivered' && order.paymentMethod === 'wallet') {
           processTransaction('refund', order.grandTotal, `คืนเงิน: ยกเลิกออเดอร์ ${order.id} (${reason})`);
      }
      
      setShowCancelModal(false);
      setSelectedOrderToCancel(null);
      notifySystem("ระบบ", "ยกเลิกออเดอร์เรียบร้อย", "info");
  };

  const toggleRestaurantStatus = (id, action) => {
    setRestaurants(restaurants.map(r => {
      if (r.id !== id) return r;
      if (action === 'toggle_open') return { ...r, status: r.status === 'open' ? 'closed' : 'open' };
      if (action === 'ban') return { ...r, status: r.status === 'banned' ? 'open' : 'banned' };
      return r;
    }));
  };
  const toggleRiderBan = (id) => setRiders(riders.map(r => r.id === id ? { ...r, status: r.status === 'banned' ? 'active' : 'banned' } : r));

  const renderRoleSwitcher = () => (
    <div className="fixed top-0 left-0 right-0 bg-gray-900 text-white p-2 z-50 flex justify-between items-center text-xs sm:text-sm shadow-md overflow-x-auto">
      <span className="font-bold mr-2 whitespace-nowrap hidden sm:block">DEV MODE:</span>
      <div className="flex space-x-2">
        <button onClick={() => setActiveRole('admin')} className={`px-3 py-1 rounded-full capitalize ${activeRole === 'admin' ? 'bg-red-500 font-bold' : 'bg-gray-700'}`}>Admin {pendingRequests.length > 0 && <span className="ml-1 bg-white text-red-600 px-1 rounded-full text-[10px]">{pendingRequests.length}</span>}</button>
        <button onClick={() => setActiveRole('customer')} className={`px-3 py-1 rounded-full capitalize ${activeRole === 'customer' ? 'bg-green-500 font-bold' : 'bg-gray-700'}`}>Customer</button>
      </div>
    </div>
  );

  // --- View Render Functions ---

  const renderCustomerView = () => {
    const restaurantsWithDistance = restaurants.map(r => {
        const dist = getDistanceFromLatLonInKm(userProfile.location.lat, userProfile.location.lng, r.location.lat, r.location.lng);
        return { ...r, distance: dist };
    });
    const visibleRestaurants = restaurantsWithDistance.filter(r => r.status !== 'banned');

    return (
      <div className="pb-20 pt-14 bg-gray-50 min-h-screen">
        {/* TOAST CONTAINER */}
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
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">สวัสดี,</span>
                <span className="text-xs font-semibold text-gray-700 max-w-[80px] truncate">{userProfile.name.split(' ')[0]}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-gray-100 px-3 py-2.5 rounded-2xl">
              <Search size={18} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="ค้นหาร้านอาหาร เมนู..."
                className="bg-transparent outline-none flex-1 text-sm text-gray-700 placeholder-gray-400"
                aria-label="ค้นหา"
              />
            </div>
          </div>
        )}
        {activeTab === 'profile' && profileSubView !== 'main' && (<div className="bg-white p-4 shadow-sm sticky top-12 z-40 flex items-center mb-4"><button onClick={() => setProfileSubView('main')} className="mr-4 p-1 hover:bg-gray-100 rounded-full"><ArrowLeft/></button><h2 className="text-xl font-bold">เมนูจัดการ</h2></div>)}

        {/* Home Tab */}
        {activeTab === 'home' && !selectedRestaurant && (
          <div className="px-4 py-3">
            {/* Service Type Switcher */}
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setServiceType('food')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all duration-200 ${
                  serviceType === 'food'
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
                    : 'bg-white text-gray-600 shadow-sm'
                }`}
              >
                <Utensils size={18}/> สั่งอาหาร
              </button>
              <button
                onClick={() => setServiceType('parcel')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all duration-200 ${
                  serviceType === 'parcel'
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-200'
                    : 'bg-white text-gray-600 shadow-sm'
                }`}
              >
                <Package size={18}/> ส่งพัสดุ
              </button>
            </div>

             {serviceType === 'food' ? (
               <>
                 {/* World-class Featured Banner */}
                 <div className="featured-banner mb-5">
                   <div className="relative z-10">
                     <div className="text-xs font-semibold text-orange-200 uppercase tracking-wider mb-1">โปรโมชั่นวันนี้</div>
                     <h2 className="text-xl font-black text-white leading-tight mb-1">ฟรีค่าส่ง<br/>ออเดอร์แรก!</h2>
                     <p className="text-orange-100 text-xs mb-3">ใช้ได้ทุกร้านในพื้นที่</p>
                     <button className="bg-white text-orange-600 text-xs font-bold px-4 py-1.5 rounded-full">
                       ใช้สิทธิ์ →
                     </button>
                   </div>
                 </div>

                 {/* Section Title */}
                 <div className="flex items-center justify-between mb-3">
                   <h2 className="font-bold text-gray-800">ร้านใกล้คุณ</h2>
                   <span className="text-xs text-orange-500 font-medium">{visibleRestaurants.length} ร้าน</span>
                 </div>

                 {/* Restaurant Cards - World Class */}
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
               <div className="bg-white p-5 rounded-xl shadow-sm"><h2 className="font-bold text-lg mb-4 text-blue-600 flex items-center"><Package className="mr-2"/> บริการส่งพัสดุด่วน</h2><div className="space-y-3"><p className="text-xs text-gray-500 text-center">ค่าบริการเริ่มต้น {appConfig.baseFee}บ. + {appConfig.perKmFee}บ./กม.</p><div className="bg-blue-50 p-3 rounded text-sm text-center text-blue-700">จำลองระยะทาง: Pickup {'>'} Dropoff (สุ่ม)</div>
               
               {/* Parcel Map Selection */}
               <div className="mb-4">
                  <div className="flex gap-2 mb-2">
                      <button 
                         onClick={() => setParcelMapTarget('pickup')} 
                         className={`flex-1 py-2 text-xs font-bold rounded ${parcelMapTarget === 'pickup' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                      >
                         📍 ปักหมุดจุดรับ
                      </button>
                      <button 
                         onClick={() => setParcelMapTarget('dropoff')} 
                         className={`flex-1 py-2 text-xs font-bold rounded ${parcelMapTarget === 'dropoff' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                      >
                         🏁 ปักหมุดจุดส่ง
                      </button>
                  </div>

                  <InteractiveMap 
                      mode="select"
                      isParcel={true}
                      userLocation={parcelMapTarget === 'pickup' ? (parcelDetails.pickupLocation || userProfile.location) : (parcelDetails.dropoffLocation || userProfile.location)} 
                      onLocationSelect={handleParcelMapSelect}
                  />
                  <p className="text-xs text-center text-gray-400 mt-1">
                      {parcelMapTarget ? `กำลังเลือก: ${parcelMapTarget === 'pickup' ? 'จุดรับสินค้า' : 'จุดส่งสินค้า'}` : 'กรุณาเลือกประเภทหมุดก่อนแตะแผนที่'}
                  </p>
               </div>

               <div><label className="text-sm text-gray-500">จุดรับของ</label><div className="flex items-center border rounded-lg p-2 mt-1 bg-gray-50"><MapPin size={18} className="text-green-500 mr-2" /><input value={parcelDetails.pickup} onChange={e => setParcelDetails({...parcelDetails, pickup: e.target.value})} type="text" placeholder="ระบุจุดรับ..." className="w-full outline-none bg-transparent" /></div></div><div><label className="text-sm text-gray-500">จุดส่งของ</label><div className="flex items-center border rounded-lg p-2 mt-1 bg-gray-50"><Navigation size={18} className="text-red-500 mr-2" /><input value={parcelDetails.dropoff} onChange={e => setParcelDetails({...parcelDetails, dropoff: e.target.value})} type="text" placeholder="ระบุจุดส่ง..." className="w-full outline-none bg-transparent" /></div></div><div><label className="text-sm text-gray-500">น้ำหนักพัสดุ (kg)</label><input value={parcelDetails.weight} onChange={e => setParcelDetails({...parcelDetails, weight: e.target.value})} type="number" className="border rounded-lg p-2 mt-1 w-full" /></div>
               
               {/* Parcel Distance & Price Info */}
               {parcelDistance > 0 && (
                   <div className="bg-blue-50 p-2 rounded text-center text-sm text-blue-800 font-bold my-2">
                       ระยะทาง: {parcelDistance} กม. | ค่าส่ง: ฿{parcelEstimate}
                   </div>
               )}

               {/* Payment Selection for Parcel */}
               <div className="flex items-center space-x-2 mt-2 p-2 bg-gray-50 rounded-lg">
                   <span className="text-sm font-bold">ชำระเงิน:</span>
                   <button onClick={() => setPaymentMethod('wallet')} className={`flex-1 py-1 text-xs rounded border ${paymentMethod === 'wallet' ? 'bg-green-100 border-green-500 text-green-700' : 'bg-white border-gray-300'}`}>Wallet</button>
                   <button onClick={() => setPaymentMethod('cash')} className={`flex-1 py-1 text-xs rounded border ${paymentMethod === 'cash' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300'}`}>เงินสด</button>
               </div>

               <button onClick={placeParcelOrder} className="w-full bg-green-500 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-green-600 mt-4">คำนวณราคา & เรียกแมส</button></div></div>
             )}
          </div>
        )}

        {selectedRestaurant && (
          <div className="min-h-screen bg-gray-50 animate-fade-in">
            {/* Hero Image */}
            <div className="relative h-52">
              <img src={selectedRestaurant.image} className="w-full h-full object-cover" alt={selectedRestaurant.name} loading="eager"/>
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20"/>
              <button
                onClick={() => setSelectedRestaurant(null)}
                className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm p-2 rounded-full shadow-lg active:scale-90 transition-transform"
                aria-label="ย้อนกลับ"
              >
                <ArrowLeft size={20} className="text-gray-800"/>
              </button>
              {/* Rating badge */}
              <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1 shadow">
                <Star size={13} className="text-yellow-500 fill-current"/>
                <span className="text-sm font-bold">{selectedRestaurant.rating}</span>
              </div>
            </div>

            {/* Restaurant Info */}
            <div className="bg-white px-4 pt-4 pb-3 border-b border-gray-100">
              <h1 className="text-xl font-black text-gray-900 mb-1">{selectedRestaurant.name}</h1>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span className="flex items-center gap-1"><Clock size={13}/> {selectedRestaurant.time}</span>
                <span className="text-gray-300">•</span>
                <span>{selectedRestaurant.distance} กม.</span>
                <span className="text-gray-300">•</span>
                <span className="text-orange-600 font-semibold">ค่าส่ง ฿{calculateDeliveryFee(selectedRestaurant.distance)}</span>
              </div>
            </div>

            {/* Menu Items */}
            <div className="px-4 pt-4 pb-40">
              <h2 className="font-bold text-lg text-gray-800 mb-3">เมนูทั้งหมด</h2>
              <div className="space-y-3">
                {menuItems[selectedRestaurant.id] && menuItems[selectedRestaurant.id].length > 0 ? (
                  menuItems[selectedRestaurant.id].map(item => (
                    <div key={item.id} className={`bg-white rounded-2xl p-3 flex items-center gap-3 shadow-sm ${!item.available ? 'opacity-50' : ''}`}>
                      {item.image && (
                        <img src={item.image} className="w-20 h-20 object-cover rounded-xl flex-shrink-0 bg-gray-100" alt={item.name} loading="lazy"/>
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
                            className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 transition-all active:scale-90 ${
                              item.available
                                ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                            }`}
                            aria-label={`เพิ่ม ${item.name}`}
                          >+</button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <ChefHat size={40} className="mx-auto mb-2 opacity-30"/>
                    <p>ยังไม่มีเมนูอาหาร</p>
                  </div>
                )}
              </div>
            </div>

            {/* Cart Bar - World Class */}
            {cart.length > 0 && (
              <div className="fixed bottom-0 left-0 right-0 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.12)] px-4 pt-3 pb-safe rounded-t-3xl z-50 animate-slide-in-from-bottom">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-orange-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
                      {cart.reduce((acc, i) => acc + i.qty, 0)}
                    </span>
                    <span className="text-sm font-semibold text-gray-700">รายการในตะกร้า</span>
                  </div>
                  <span className="font-black text-xl text-gray-900">฿{(calculateFoodTotal() + calculateDeliveryFee(cart[0].distance)).toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-gray-500 flex items-center gap-1"><Banknote size={13}/> ชำระโดย:</span>
                  <button onClick={() => setPaymentMethod('wallet')} className={`flex-1 py-2 text-sm rounded-xl border font-bold transition-all ${paymentMethod === 'wallet' ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}>Wallet</button>
                  <button onClick={() => setPaymentMethod('cash')} className={`flex-1 py-2 text-sm rounded-xl border font-bold transition-all ${paymentMethod === 'cash' ? 'bg-blue-500 text-white border-blue-500 shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}>เงินสด</button>
                </div>

                <button
                  onClick={placeOrder}
                  className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-xl shadow-orange-200 active:scale-95 transition-transform"
                >
                  สั่งอาหาร ฿{(calculateFoodTotal() + calculateDeliveryFee(cart[0].distance)).toLocaleString()}
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
                        <div className="bg-white p-6 rounded-2xl shadow-sm mb-4 flex items-center"><div className="w-16 h-16 bg-gray-200 rounded-full overflow-hidden mr-4 relative"><img src={userProfile.image} alt="Profile" className="w-full h-full object-cover"/><div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer text-white"><Edit size={20}/></div></div><div className="flex-1"><h2 className="text-xl font-bold">{userProfile.name}</h2><div className="text-gray-500 text-sm">ID: {userProfile.id}</div></div></div>
                        <div className="flex gap-2 mb-6">
                            <button onClick={() => setProfileSubView('wallet')} className="flex-1 bg-gradient-to-r from-green-600 to-green-500 p-4 rounded-2xl shadow-lg text-white flex justify-between items-center"><div className="flex items-center"><Wallet className="mr-2"/><span className="font-bold text-sm">฿{userWallet.toFixed(2)}</span></div></button>
                            {/* UPDATED: User Contact Admin (Unique ID per user) */}
                            <button onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'admin')} className="flex-1 bg-blue-600 p-4 rounded-2xl shadow-lg text-white flex justify-center items-center font-bold text-sm"><MessageSquare className="mr-2"/> ติดต่อเจ้าหน้าที่</button>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
                            <div className="p-4 border-b bg-gray-50 font-bold text-gray-700 text-sm">เมนูพาร์ทเนอร์</div>
                            {/* RESTRICTED: Buttons are now conditional based on approval */}
                            {userRoles.includes('merchant') ? (
                                <button onClick={() => setActiveRole('merchant')} className="w-full p-4 flex items-center justify-between hover:bg-green-50 border-b">
                                    <span className="text-green-700 font-bold">สลับไปร้านค้า</span><Repeat size={20}/>
                                </button>
                            ) : isPending('merchant_reg') ? (
                                <div className="p-4 text-gray-400 border-b flex items-center justify-between bg-gray-50">
                                    <span>สมัครร้านค้า (รออนุมัติ...)</span><Clock size={20}/>
                                </div>
                            ) : (
                                <button onClick={() => setProfileSubView('reg_merchant')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
                                    <span>สมัครเปิดร้านอาหาร</span><ChevronRight size={20}/>
                                </button>
                            )}

                            {userRoles.includes('rider') ? (
                                <button onClick={() => setActiveRole('rider')} className="w-full p-4 flex items-center justify-between hover:bg-blue-50">
                                    <span className="text-blue-700 font-bold">สลับไปไรเดอร์</span><Repeat size={20}/>
                                </button>
                            ) : isPending('rider_reg') ? (
                                <div className="p-4 text-gray-400 flex items-center justify-between bg-gray-50">
                                    <span>สมัครไรเดอร์ (รออนุมัติ...)</span><Clock size={20}/>
                                </div>
                            ) : (
                                <button onClick={() => setProfileSubView('reg_rider')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50">
                                    <span>สมัครขับ BoomRider</span><ChevronRight size={20}/>
                                </button>
                            )}
                            
                            {/* Logout Button */}
                            <button onClick={handleLogout} className="w-full p-4 flex items-center justify-between hover:bg-red-50 border-t">
                                <span className="text-red-600 font-bold">ออกจากระบบ</span><LogOut size={20} className="text-red-600"/>
                            </button>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                            <button onClick={() => setProfileSubView('address')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b"><div className="flex items-center"><div className="bg-gray-100 p-2 rounded-lg text-gray-600 mr-3"><MapPin size={20}/></div><span>ที่อยู่ของฉัน</span></div><ChevronRight size={20} className="text-gray-400"/></button>
                            <button onClick={() => setProfileSubView('edit_profile')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b"><div className="flex items-center"><div className="bg-gray-100 p-2 rounded-lg text-gray-600 mr-3"><Settings size={20}/></div><span>ตั้งค่า/แก้ไขโปรไฟล์</span></div><ChevronRight size={20} className="text-gray-400"/></button>
                        </div>
                    </>
                ) : profileSubView === 'wallet' ? (
                    <div className="p-4 pt-0 bg-white min-h-[50vh]">
                        <div className="bg-gradient-to-r from-green-600 to-green-500 p-8 rounded-2xl shadow-lg text-white mb-6 text-center">
                            <p className="text-green-100 mb-2">ยอดเงินคงเหลือ</p><h1 className="text-4xl font-bold mb-6">฿{userWallet.toFixed(2)}</h1>
                            {!withdrawMode ? (
                                <div className="grid grid-cols-3 gap-4">
                                    {[100, 500, 1000].map(amount => (
                                        <button 
                                            key={amount} 
                                            onClick={() => {
                                                // setTopUpAmount(amount.toString()); // Removed unused
                                                setWithdrawAmount(amount.toString());
                                                setShowTopUpModal(true); 
                                            }} 
                                            className="bg-white/20 hover:bg-white/30 py-2 rounded-lg font-bold backdrop-blur-sm"
                                        >
                                            +฿{amount}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm space-y-2">
                                    <input type="number" placeholder="ระบุจำนวนเงิน" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full text-black p-2 rounded text-center font-bold"/>
                                    <input type="text" placeholder="ชื่อธนาคาร (เช่น กสิกร)" value={withdrawBank} onChange={(e) => setWithdrawBank(e.target.value)} className="w-full text-black p-2 rounded text-sm"/>
                                    <input type="text" placeholder="เลขบัญชี" value={withdrawAccount} onChange={(e) => setWithdrawAccount(e.target.value)} className="w-full text-black p-2 rounded text-sm"/>
                                    <input type="text" placeholder="ชื่อบัญชี" value={withdrawName} onChange={(e) => setWithdrawName(e.target.value)} className="w-full text-black p-2 rounded text-sm"/>
                                    <div className="flex gap-2 pt-2"><button onClick={() => setWithdrawMode(false)} className="flex-1 bg-gray-500 py-2 rounded font-bold">ยกเลิก</button><button onClick={() => { if(withdrawAmount > 0 && withdrawBank && withdrawAccount && withdrawName) { requestWithdraw(parseFloat(withdrawAmount), { bank: withdrawBank, account: withdrawAccount, name: withdrawName }); setWithdrawMode(false); setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount(''); } else { alert("กรุณากรอกข้อมูลให้ครบถ้วน"); } }} className="flex-1 bg-white text-green-600 py-2 rounded font-bold">ยืนยันถอน</button></div>
                                </div>
                            )}
                            {!withdrawMode && <button onClick={() => setWithdrawMode(true)} className="mt-4 text-sm text-green-100 underline flex items-center justify-center w-full"><ArrowDownCircle size={16} className="mr-1"/> ต้องการถอนเงิน?</button>}
                        </div>
                        <h3 className="font-bold text-lg mb-4">ประวัติธุรกรรม</h3>
                        <div className="space-y-3">{walletHistory.map(tx => (<div key={tx.id} className="flex justify-between items-center p-3 border rounded-lg"><div><div className="font-bold text-gray-800">{tx.desc}</div><div className="text-xs text-gray-500">{tx.date}</div></div><span className={`font-bold ${['income', 'deposit', 'refund'].includes(tx.type) ? 'text-green-600' : 'text-red-500'}`}>{['income', 'deposit', 'refund'].includes(tx.type) ? '+' : ''}{tx.amount}</span></div>))}</div>
                    </div>
                ) : profileSubView === 'address' ? (
                    <div className="p-4 pt-0">
                        <h3 className="font-bold text-lg mb-4">ที่อยู่ของฉัน</h3>
                        <div className="space-y-4 mb-8">
                            {userAddresses.map(addr => (
                                <div key={addr.id} className="border p-4 rounded-xl flex justify-between items-start">
                                    <div>
                                        <div className="font-bold flex items-center"><MapPin size={16} className="mr-1 text-green-600"/> {addr.label}</div>
                                        <p className="text-gray-500 text-sm mt-1">{addr.address}</p>
                                        <div className="text-xs text-gray-400 mt-1">Lat: {addr.location.lat.toFixed(4)}, Lng: {addr.location.lng.toFixed(4)}</div>
                                    </div>
                                    <button onClick={() => handleDeleteAddress(addr.id)} className="text-red-500 p-2"><Trash2 size={18}/></button>
                                </div>
                            ))}
                        </div>
                        
                        {/* Add Address Form */}
                        <div className="bg-gray-50 p-4 rounded-xl">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-bold">เพิ่มที่อยู่ใหม่</h4>
                                <button onClick={getCurrentLocationForForm} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded flex items-center hover:bg-blue-200">
                                    <Crosshair size={12} className="mr-1"/> ใช้ตำแหน่งปัจจุบัน
                                </button>
                            </div>
                            
                            {/* Interactive Map Picker */}
                            <InteractiveMap 
                                mode="select" 
                                userLocation={newAddr.location || userProfile.location}
                                onLocationSelect={handleMapLocationSelect}
                            />

                            <input value={newAddr.label} onChange={e => setNewAddr({...newAddr, label: e.target.value})} placeholder="ชื่อสถานที่ (เช่น บ้าน)" className="w-full p-2 border rounded-lg mb-2"/>
                            <textarea value={newAddr.fullAddr} onChange={e => setNewAddr({...newAddr, fullAddr: e.target.value})} placeholder="รายละเอียด/จุดสังเกต..." className="w-full p-2 border rounded-lg mb-3"/>
                            <button onClick={() => { if(newAddr.label && newAddr.fullAddr) { handleAddAddress(newAddr); setNewAddr({label:'', fullAddr:'', location: null}); } }} className="w-full bg-green-600 text-white py-2 rounded-lg font-bold">บันทึกที่อยู่</button>
                        </div>
                    </div>
                ) : profileSubView === 'edit_profile' ? (
                    <div className="p-4 pt-0">
                        <div className="flex justify-center mb-6">
                            <label className="w-24 h-24 bg-gray-200 rounded-full overflow-hidden relative cursor-pointer">
                                <img src={tempProfile.image} className="w-full h-full object-cover"/>
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white"><Camera/></div>
                                <input type="file" accept="image/*" className="hidden" onChange={handleProfilePhotoChange}/>
                            </label>
                        </div>
                        <div className="space-y-4"><div><label className="text-sm text-gray-500">ชื่อ-นามสกุล</label><input value={tempProfile.name} onChange={e => setTempProfile({...tempProfile, name: e.target.value})} className="w-full border-b py-2 outline-none font-medium text-lg"/></div><div><label className="text-sm text-gray-500">เบอร์โทรศัพท์</label><input value={tempProfile.phone} onChange={e => setTempProfile({...tempProfile, phone: e.target.value})} className="w-full border-b py-2 outline-none font-medium text-lg"/></div><div><label className="text-sm text-gray-500">อีเมล</label><input value={tempProfile.email} onChange={e => setTempProfile({...tempProfile, email: e.target.value})} className="w-full border-b py-2 outline-none font-medium text-lg"/></div><button onClick={() => { setUserProfile(tempProfile); setProfileSubView('main'); alert('บันทึกข้อมูลสำเร็จ'); }} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold mt-8">บันทึกการเปลี่ยนแปลง</button></div>
                    </div>
                ) : profileSubView === 'reg_merchant' ? (
                    <div className="p-4 pt-0">
                        <div className="bg-orange-50 p-4 rounded-xl mb-6 text-center"><ChefHat size={48} className="text-orange-500 mx-auto mb-2"/><h2 className="text-xl font-bold text-orange-700">ลงทะเบียนร้านค้า (KYC)</h2></div>
                        <div className="space-y-4">
                            <div><label className="font-bold mb-1 block">ชื่อร้านค้า</label><input value={merchantRegForm.shopName} onChange={e => setMerchantRegForm({...merchantRegForm, shopName: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
                            <div className="mb-4">
                                <label className="text-sm mb-1 block">รูปหน้าร้าน (Shop Image)</label>
                                <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${merchantRegForm.shopImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                                    {merchantRegForm.shopImage ? <><Check className="inline mr-1"/> เลือกแล้ว</> : <><Camera className="inline mr-1"/> ถ่ายรูป/เลือกรูป</>}
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRegistrationPhotoSelect(e, setMerchantRegForm, 'shopImage')} />
                                </label>
                                {merchantRegForm.shopImage && <img src={merchantRegForm.shopImage} className="mt-2 h-32 w-full object-cover rounded-lg"/>}
                            </div>
                            <div><label className="font-bold mb-1 block">หมวดหมู่</label><select value={merchantRegForm.category} onChange={e => setMerchantRegForm({...merchantRegForm, category: e.target.value})} className="w-full border p-2 rounded-lg"><option>Street Food</option><option>Fast Food</option><option>Japanese</option><option>Italian</option><option>Dessert</option></select></div>
                            <div className="pt-2 border-t mt-2"><h4 className="font-bold text-gray-700 mb-2">ข้อมูลเจ้าของร้าน (ยืนยันตัวตน)</h4>
                                <div><label className="text-sm mb-1 block">ชื่อ-นามสกุล (ตรงตามบัตรประชาชน)</label><input value={merchantRegForm.realName} onChange={e => setMerchantRegForm({...merchantRegForm, realName: e.target.value})} className="w-full border p-2 rounded-lg mb-2"/></div>
                                <div><label className="text-sm mb-1 block">เลขบัตรประชาชน</label><input value={merchantRegForm.idCard} onChange={e => setMerchantRegForm({...merchantRegForm, idCard: e.target.value})} className="w-full border p-2 rounded-lg mb-2"/></div>
                                <div><label className="text-sm mb-1 block">เบอร์โทรศัพท์</label><input value={merchantRegForm.phone} onChange={e => setMerchantRegForm({...merchantRegForm, phone: e.target.value})} className="w-full border p-2 rounded-lg mb-2"/></div>
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <div><label className="text-sm mb-1 block">ธนาคาร</label><input value={merchantRegForm.bankName} onChange={e => setMerchantRegForm({...merchantRegForm, bankName: e.target.value})} className="w-full border p-2 rounded-lg" placeholder="กสิกร, ไทยพาณิชย์..."/></div>
                                    <div><label className="text-sm mb-1 block">เลขที่บัญชี</label><input value={merchantRegForm.bankAccount} onChange={e => setMerchantRegForm({...merchantRegForm, bankAccount: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
                                </div>
                                <div className="mb-4">
                                    <label className="text-sm mb-1 block">รูปถ่ายบัตรประชาชน</label>
                                    <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${merchantRegForm.idCardImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                                        {merchantRegForm.idCardImage ? <><Check className="inline mr-1"/> เลือกแล้ว</> : <><Camera className="inline mr-1"/> ถ่ายรูป/เลือกรูป</>}
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRegistrationPhotoSelect(e, setMerchantRegForm, 'idCardImage')} />
                                    </label>
                                    {merchantRegForm.idCardImage && <img src={merchantRegForm.idCardImage} className="mt-2 h-32 w-full object-cover rounded-lg"/>}
                                </div>
                            </div>
                            <button onClick={() => requestRegisterMerchant(merchantRegForm)} className="w-full bg-orange-500 text-white py-3 rounded-lg font-bold shadow-lg">ส่งใบสมัคร</button>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 pt-0">
                        <div className="bg-blue-50 p-4 rounded-xl mb-6 text-center"><Bike size={48} className="text-blue-500 mx-auto mb-2"/><h2 className="text-xl font-bold text-blue-700">สมัครขับ BoomRider (KYC)</h2></div>
                        <div className="space-y-4">
                            <div><label className="font-bold mb-1 block">ชื่อ-นามสกุล (ผู้ขับขี่)</label><input value={riderRegForm.realName} onChange={e => setRiderRegForm({...riderRegForm, realName: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
                            <div><label className="font-bold mb-1 block">ประเภทพาหนะ</label><select className="w-full border p-2 rounded-lg"><option>รถจักรยานยนต์</option><option>รถยนต์</option></select></div>
                            <div className="pt-2 border-t mt-2"><h4 className="font-bold text-gray-700 mb-2">ข้อมูลยืนยันตัวตน</h4>
                                <div><label className="text-sm mb-1 block">เลขบัตรประชาชน</label><input value={riderRegForm.idCard} onChange={e => setRiderRegForm({...riderRegForm, idCard: e.target.value})} className="w-full border p-2 rounded-lg mb-2"/></div>
                                <div><label className="text-sm mb-1 block">เบอร์โทรศัพท์</label><input value={riderRegForm.phone} onChange={e => setRiderRegForm({...riderRegForm, phone: e.target.value})} className="w-full border p-2 rounded-lg mb-2"/></div>
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <div><label className="text-sm mb-1 block">ธนาคาร</label><input value={riderRegForm.bankName} onChange={e => setRiderRegForm({...riderRegForm, bankName: e.target.value})} className="w-full border p-2 rounded-lg" placeholder="กสิกร, ไทยพาณิชย์..."/></div>
                                    <div><label className="text-sm mb-1 block">เลขที่บัญชี</label><input value={riderRegForm.bankAccount} onChange={e => setRiderRegForm({...riderRegForm, bankAccount: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
                                </div>
                                <div className="mb-4">
                                    <label className="text-sm mb-1 block">รูปถ่ายบัตรประชาชน</label>
                                    <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${riderRegForm.idCardImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                                        {riderRegForm.idCardImage ? <><Check className="inline mr-1"/> เลือกแล้ว</> : <><Camera className="inline mr-1"/> ถ่ายรูป/เลือกรูป</>}
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRegistrationPhotoSelect(e, setRiderRegForm, 'idCardImage')} />
                                    </label>
                                    {riderRegForm.idCardImage && <img src={riderRegForm.idCardImage} className="mt-2 h-32 w-full object-cover rounded-lg"/>}
                                </div>
                            </div>
                            <button onClick={() => requestRegisterRider(riderRegForm)} className="w-full bg-blue-500 text-white py-3 rounded-lg font-bold shadow-lg">ส่งใบสมัคร</button>
                        </div>
                    </div>
                )}
            </div>
        )}

        {activeTab === 'activity' && <div className="p-4"><h2 className="text-2xl font-bold mb-6">กิจกรรมของคุณ</h2>{orders.length === 0 ? <div className="text-center text-gray-400 mt-20">ไม่มีรายการ</div> : orders.map(order => (
            <div key={order.id} className="bg-white p-4 mb-4 rounded-xl shadow-sm">
                <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg">{order.restaurantName || "พัสดุ"}</span>
                    <div className="text-xs text-gray-500 flex flex-col items-end">
                        <span>{order.status}</span>
                        {/* Display Payment Method in Order History */}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] mt-1 ${order.paymentMethod === 'cash' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                            {order.paymentMethod === 'cash' ? 'เงินสด' : 'Wallet'}
                        </span>
                    </div>
                </div>
                
                {/* Live Map for Active Orders */}
                {['rider_accepted', 'picking_up', 'delivering'].includes(order.status) && (
                    <InteractiveMap 
                        mode="view" 
                        userLocation={order.location} // Dropoff
                        shopLocation={order.pickupLocation} // Pickup
                        riderLocation={order.riderLocation} // Rider
                        status={order.status}
                    />
                )}
                
                {/* Chat Buttons for User */}
                <div className="flex gap-2 mt-2">
                    {/* Chat with Merchant */}
                    {order.type === 'food' && (
                        <button onClick={() => openChatWindow(order.id + '-merchant', order.restaurantName, 'merchant')} className="flex-1 bg-orange-100 text-orange-700 py-2 rounded text-xs font-bold flex items-center justify-center hover:bg-orange-200">
                            <MessageSquare size={14} className="mr-1"/> ร้านค้า
                        </button>
                    )}
                    
                    {/* Chat with Rider (Only if assigned) */}
                    {order.riderId && (
                        <button onClick={() => openChatWindow(order.id + '-rider', 'Rider', 'rider')} className="flex-1 bg-green-100 text-green-700 py-2 rounded text-xs font-bold flex items-center justify-center hover:bg-green-200">
                            <Bike size={14} className="mr-1"/> ไรเดอร์
                        </button>
                    )}
                </div>

                <div className="flex justify-between mt-3 pt-3 border-t">
                    <span>ยอดรวม</span>
                    <span className="font-bold">฿{order.grandTotal}</span>
                </div>
            </div>
        ))}</div>}

        {!selectedRestaurant && (
          <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 flex justify-around z-40 bottom-nav-bar shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
            {[
              { id: 'home',     icon: Home,       label: 'หน้าแรก' },
              { id: 'activity', icon: ShoppingBag, label: 'ออเดอร์', badge: orders.filter(o => ['pending','preparing','rider_accepted','delivering'].includes(o.status)).length },
              { id: 'profile',  icon: User,        label: 'บัญชี' },
            ].map(({ id, icon: Icon, label, badge }) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setProfileSubView('main'); }}
                className={`bottom-nav-item ${activeTab === id ? 'active' : 'text-gray-400'}`}
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
      </div>
    );
  };

  // --- 2. Merchant View ---
  const renderMerchantView = () => {
    const myShop = restaurants.find(r => r.ownerId === userProfile.id);
    const myOrders = myShop ? orders.filter(o => o.type === 'food' && o.restaurantId === myShop.id) : [];
    const myRevenue = myOrders.reduce((sum, o) => sum + o.merchantIncome, 0);

    const openEditMenu = (item) => {
        setIsEditingMenu(item ? item.id : 'new');
        setEditForm(item ? { ...item } : { name: '', price: '', desc: '', image: '' });
    };

    const saveMenu = () => {
        if (!editForm.name || !editForm.price) return alert("กรุณากรอกชื่อและราคา");
        if (isEditingMenu === 'new') {
            handleAddMenuItem(myShop.id, { ...editForm, price: parseFloat(editForm.price) });
        } else {
            handleEditMenuItem(myShop.id, isEditingMenu, { ...editForm, price: parseFloat(editForm.price) });
        }
        setIsEditingMenu(null);
    };

    if (!myShop) return <div className="min-h-screen bg-red-50 flex items-center justify-center">ไม่พบร้านค้าของคุณ</div>;

    return (
      <div className="min-h-screen bg-gray-50 pt-14 pb-10">
        <header className="bg-white shadow p-4 mb-4 sticky top-0 z-30">
          <div className="flex justify-between items-center mb-4">
             <h1 className="text-xl font-bold flex items-center"><ChefHat className="mr-2 text-green-600"/> จัดการร้านค้า</h1>
             <button onClick={() => setActiveRole('customer')} className="flex items-center text-sm bg-gray-200 px-3 py-1 rounded-full hover:bg-gray-300"><LogOut size={14} className="mr-1"/> ออก</button>
          </div>
          
          {/* Shop Image Header with Edit */}
          <div className="relative h-40 w-full rounded-xl overflow-hidden mb-4 group">
              <img src={myShop.image} className="w-full h-full object-cover"/>
              <label className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white">
                  <Camera className="mr-2"/> เปลี่ยนรูปหน้าร้าน
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleShopPhotoChange(myShop.id, e)}/>
              </label>
          </div>

          <div className="flex justify-between items-center mb-4">
              <div><div className="font-bold text-lg">{myShop.name}</div><div className={`text-xs ${myShop.status === 'open' ? 'text-green-600' : 'text-red-500'}`}>สถานะ: {myShop.status.toUpperCase()}</div></div>
              <button onClick={() => handleToggleShopStatus(myShop.id)} className={`px-4 py-2 rounded-lg font-bold text-white flex items-center ${myShop.status === 'open' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>{myShop.status === 'open' ? <><ToggleRight className="mr-2"/> ปิดร้าน</> : <><ToggleLeft className="mr-2"/> เปิดร้าน</>}</button>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-lg">
              <button onClick={() => setMerchantTab('orders')} className={`flex-1 py-2 rounded-md font-bold text-sm ${merchantTab === 'orders' ? 'bg-white shadow text-green-600' : 'text-gray-500'}`}>ออเดอร์ ({myOrders.filter(o => o.status === 'pending').length})</button>
              <button onClick={() => setMerchantTab('menu')} className={`flex-1 py-2 rounded-md font-bold text-sm ${merchantTab === 'menu' ? 'bg-white shadow text-green-600' : 'text-gray-500'}`}>จัดการเมนู</button>
          </div>
        </header>

        {merchantTab === 'orders' && (
            <div className="px-4">
                <div className="bg-white p-4 rounded-lg shadow-sm border border-green-100 mb-4 flex justify-between items-center"><span className="text-gray-600">รายได้สุทธิวันนี้</span><span className="text-2xl font-bold text-green-700">฿{myRevenue.toFixed(0)}</span></div>
                <div className="space-y-4">
                    {myOrders.length === 0 && <p className="text-gray-400 text-center mt-10">ไม่มีออเดอร์ในขณะนี้</p>}
                    {myOrders.map(order => (
                        <div key={order.id} className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
                            <div className="flex justify-between mb-2">
                                <div>
                                    <span className="font-bold">#{order.id}</span>
                                    {order.paymentMethod === 'cash' && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1 rounded">เก็บเงินสด</span>}
                                </div>
                                <span className="text-xs bg-gray-100 px-2 py-1 rounded">{STATUS_LABELS[order.status].label}</span>
                            </div>
                            <div className="mb-4 text-sm">{order.items.map((item, idx) => <div key={idx} className="flex justify-between"><span>{item.qty}x {item.name}</span><span>฿{item.price * item.qty}</span></div>)}<div className="border-t mt-2 pt-2 flex justify-between font-bold"><span>รวม</span><span>฿{order.grandTotal}</span></div></div>
                            <div className="flex gap-2">
                                {/* Chat Button for Merchant */}
                                <button onClick={() => openChatWindow(order.id + '-merchant', order.customerName, 'merchant')} className="flex-1 bg-orange-100 text-orange-700 py-2 rounded font-bold text-sm flex items-center justify-center">
                                    <MessageSquare size={16} className="mr-1"/> แชทลูกค้า
                                </button>
                                {order.status === 'pending' && <button onClick={() => updateOrderStatus(order.id, 'preparing')} className="flex-1 bg-green-500 text-white py-2 rounded font-bold">รับออเดอร์</button>}
                                {order.status === 'preparing' && <button onClick={() => updateOrderStatus(order.id, 'ready_to_pickup')} className="flex-1 bg-blue-500 text-white py-2 rounded font-bold">เสร็จแล้ว</button>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {merchantTab === 'menu' && (
            <div className="px-4">
                {!isEditingMenu ? (
                    <>
                        <button onClick={() => openEditMenu(null)} className="w-full bg-green-100 text-green-700 py-3 rounded-xl font-bold mb-4 border-2 border-green-200 flex items-center justify-center"><Plus className="mr-2"/> เพิ่มเมนูใหม่</button>
                        <div className="space-y-4">
                            {(menuItems[myShop.id] || []).map(item => (
                                <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm flex items-start">
                                    {item.image && <img src={item.image} className="w-16 h-16 rounded-lg bg-gray-200 object-cover mr-4"/>}
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start"><h3 className="font-bold">{item.name}</h3><div className="flex space-x-1"><button onClick={() => openEditMenu(item)} className="p-1 bg-gray-100 rounded text-gray-600"><Edit size={16}/></button><button onClick={() => handleDeleteMenuItem(myShop.id, item.id)} className="p-1 bg-red-100 rounded text-red-600"><Trash2 size={16}/></button></div></div>
                                        <p className="text-gray-500 text-xs mb-2 line-clamp-1">{item.desc}</p>
                                        <div className="flex justify-between items-center"><span className="font-bold text-green-600">฿{item.price}</span><button onClick={() => handleToggleItemAvailability(myShop.id, item.id)} className={`px-3 py-1 rounded-full text-xs font-bold ${item.available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{item.available ? 'มีขาย' : 'หมด'}</button></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="bg-white p-6 rounded-xl shadow-lg">
                        <h3 className="font-bold text-lg mb-4">{isEditingMenu === 'new' ? 'เพิ่มเมนูใหม่' : 'แก้ไขเมนู'}</h3>
                        <div className="space-y-3">
                            <input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} placeholder="ชื่ออาหาร" className="w-full border p-2 rounded"/>
                            <input type="number" value={editForm.price} onChange={e => setEditForm({...editForm, price: e.target.value})} placeholder="ราคา (บาท)" className="w-full border p-2 rounded"/>
                            <textarea value={editForm.desc} onChange={e => setEditForm({...editForm, desc: e.target.value})} placeholder="รายละเอียด" className="w-full border p-2 rounded"/>
                            
                            <div className="mb-2">
                                <label className="block text-sm text-gray-500 mb-1">รูปภาพอาหาร</label>
                                <label className="w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block text-gray-500 hover:bg-gray-50">
                                    {editForm.image ? (
                                        <div className="relative">
                                            <img src={editForm.image} className="h-32 w-full object-cover rounded-lg mx-auto" />
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 hover:opacity-100 rounded-lg transition-opacity">
                                                <Camera className="mr-2"/> เปลี่ยนรูป
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <ImageIcon className="mx-auto mb-2 text-gray-400"/>
                                            <span>กดเพื่อเลือกรูป หรือ ถ่ายรูป</span>
                                        </>
                                    )}
                                    <input type="file" accept="image/*" className="hidden" onChange={handleMenuPhotoSelect} />
                                </label>
                            </div>

                            <div className="flex gap-2 mt-4"><button onClick={() => setIsEditingMenu(null)} className="flex-1 bg-gray-200 py-3 rounded font-bold">ยกเลิก</button><button onClick={saveMenu} className="flex-1 bg-green-600 text-white py-3 rounded font-bold">บันทึก</button></div>
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>
    );
  };

  // --- 3. Rider View ---
  const renderRiderView = () => {
    const me = riders.find(r => r.userId === userProfile.id); 
    const availableJobs = orders.filter(o => o.status === 'ready_to_pickup' && getDistanceFromLatLonInKm(me?.location.lat || USER_LOCATION.lat, me?.location.lng || USER_LOCATION.lng, o.pickupLocation.lat, o.pickupLocation.lng) <= appConfig.riderRadius);
    const myJobs = orders.filter(o => ['rider_accepted', 'picking_up', 'delivering'].includes(o.status));
    const historyJobs = orders.filter(o => o.status === 'delivered'); 

    return (
      <div className="min-h-screen bg-gray-900 text-white pt-14 pb-20">
         <div className="p-4 bg-gray-800 shadow-lg">
            <div className="flex justify-between items-center mb-2"><h1 className="text-xl font-bold flex items-center"><Bike className="mr-2 text-green-400"/> Rider App</h1><button onClick={() => setActiveRole('customer')} className="text-xs bg-gray-700 px-2 py-1 rounded">กลับ</button></div>
            <div className="flex items-center text-sm text-gray-400"><User size={14} className="mr-1"/> {me?.name || 'User'} | <span className="text-green-400 ml-1">Online</span></div>
         </div>
         
         <div className="flex p-4 gap-2">
             <button onClick={() => setRiderTab('jobs')} className={`flex-1 py-2 rounded-lg font-bold text-sm ${riderTab === 'jobs' ? 'bg-green-600' : 'bg-gray-700'}`}>งานใหม่ ({availableJobs.length})</button>
             <button onClick={() => setRiderTab('active')} className={`flex-1 py-2 rounded-lg font-bold text-sm ${riderTab === 'active' ? 'bg-green-600' : 'bg-gray-700'}`}>ทำอยู่</button>
             <button onClick={() => setRiderTab('history')} className={`flex-1 py-2 rounded-lg font-bold text-sm ${riderTab === 'history' ? 'bg-green-600' : 'bg-gray-700'}`}>ประวัติ</button>
         </div>
         
         <div className="px-4 space-y-4">
            {riderTab === 'jobs' && availableJobs.map(job => (<div key={job.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <div className="flex justify-between mb-2">
                    <span className="font-bold">{job.restaurantName || "ส่งพัสดุ"}</span>
                    <span className="text-green-400 font-bold">฿{job.riderIncome.toFixed(0)}</span>
                </div>
                {job.paymentMethod === 'cash' && <div className="mb-2 text-xs bg-blue-900/50 text-blue-200 px-2 py-1 rounded inline-block">เก็บเงินสด: ฿{job.grandTotal}</div>}
                
                {/* Rider Map Preview for Available Job */}
                <div className="mb-3 rounded-lg overflow-hidden border border-gray-600">
                     <InteractiveMap 
                        mode="view" 
                        userLocation={job.location} 
                        shopLocation={job.pickupLocation} 
                        className="h-40" 
                     />
                </div>

                <div className="text-sm text-gray-400 mb-2">ระยะทางส่ง: {job.distance} กม.</div>
                <button onClick={() => updateOrderStatus(job.id, 'rider_accepted', me?.id)} className="w-full bg-green-500 py-2 rounded font-bold">รับงาน</button>
            </div>))}
            {riderTab === 'jobs' && availableJobs.length === 0 && <div className="text-center text-gray-500 mt-10">ไม่พบงานในรัศมี {appConfig.riderRadius} กม.</div>}
            
            {riderTab === 'active' && myJobs.map(job => (
                <div key={job.id} className="bg-gray-800 p-4 rounded-xl border border-green-500">
                    <div className="flex justify-between mb-2"><span>#{job.id}</span><span className="text-yellow-400">{job.status}</span></div>
                    {job.paymentMethod === 'cash' && <div className="mb-2 text-sm font-bold text-blue-300 bg-blue-900/40 p-2 rounded">💰 ต้องเก็บเงินลูกค้า: ฿{job.grandTotal}</div>}
                    
                    {/* Live Map for Rider */}
                    <div className="mb-3 rounded-lg overflow-hidden border border-green-500/50">
                        <InteractiveMap 
                            mode="view" 
                            userLocation={job.location} 
                            shopLocation={job.pickupLocation} 
                            riderLocation={job.riderLocation}
                            status={job.status}
                            className="h-48"
                        />
                    </div>

                    {/* Chat Button for Rider */}
                    <button onClick={() => openChatWindow(job.id + '-rider', job.customerName, 'rider')} className="w-full bg-green-700 py-2 rounded mb-2 flex items-center justify-center font-bold text-sm hover:bg-green-600">
                        <MessageSquare size={16} className="mr-2"/> แชทกับลูกค้า
                    </button>

                    {/* Status: picking_up */}
                    {job.status === 'rider_accepted' && (
                        <button onClick={() => updateOrderStatus(job.id, 'picking_up')} className="w-full bg-indigo-500 py-2 rounded mb-2">ถึงจุดรับแล้ว</button>
                    )}

                    {/* Status: delivering (Requires Proof of Pickup) */}
                    {job.status === 'picking_up' && (
                        <>
                            <div className="mb-2">
                                <div className="flex gap-2">
                                    <label className="flex-1 py-2 rounded border-2 border-dashed border-gray-500 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700">
                                        <Camera className="mr-2"/> ถ่ายรูป
                                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleRiderPhotoUpload(job.id, 'pickup', e)} />
                                    </label>
                                    <label className="flex-1 py-2 rounded border-2 border-dashed border-gray-500 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700">
                                        <ImageIcon className="mr-2"/> อัลบั้ม
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRiderPhotoUpload(job.id, 'pickup', e)} />
                                    </label>
                                </div>
                                {riderJobPhotos[job.id]?.pickup && <img src={riderJobPhotos[job.id].pickup} className="mt-2 h-32 w-full object-cover rounded"/>}
                            </div>
                            <button 
                                disabled={!riderJobPhotos[job.id]?.pickup}
                                onClick={() => updateOrderStatus(job.id, 'delivering', null, { pickupPhoto: riderJobPhotos[job.id].pickup })} 
                                className={`w-full py-2 rounded mb-2 ${riderJobPhotos[job.id]?.pickup ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
                            >
                                ยืนยันรับของ
                            </button>
                        </>
                    )}

                    {/* Status: delivered (Requires Proof of Delivery) */}
                    {job.status === 'delivering' && (
                        <>
                            <div className="mb-2">
                                <div className="flex gap-2">
                                    <label className="flex-1 py-2 rounded border-2 border-dashed border-gray-500 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700">
                                        <Camera className="mr-2"/> ถ่ายรูป
                                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleRiderPhotoUpload(job.id, 'delivery', e)} />
                                    </label>
                                    <label className="flex-1 py-2 rounded border-2 border-dashed border-gray-500 text-gray-400 flex items-center justify-center cursor-pointer hover:bg-gray-700">
                                        <ImageIcon className="mr-2"/> อัลบั้ม
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleRiderPhotoUpload(job.id, 'delivery', e)} />
                                    </label>
                                </div>
                                {riderJobPhotos[job.id]?.delivery && <img src={riderJobPhotos[job.id].delivery} className="mt-2 h-32 w-full object-cover rounded"/>}
                            </div>
                            <button 
                                disabled={!riderJobPhotos[job.id]?.delivery}
                                onClick={() => updateOrderStatus(job.id, 'delivered', null, { deliveryPhoto: riderJobPhotos[job.id].delivery })} 
                                className={`w-full py-2 rounded mb-2 ${riderJobPhotos[job.id]?.delivery ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
                            >
                                ยืนยันส่งสำเร็จ
                            </button>
                        </>
                    )}
                </div>
            ))}
            
            {riderTab === 'history' && (
                <div>
                    <div className="bg-gray-800 p-4 rounded-xl mb-4 border border-gray-700">
                        <h3 className="text-gray-400 text-sm mb-1">รายได้รวมวันนี้</h3>
                        <div className="text-3xl font-bold text-green-400">฿{historyJobs.reduce((acc, job) => acc + (job.status === 'delivered' ? job.riderIncome : 0), 0).toFixed(0)}</div>
                        <div className="text-xs text-gray-500 mt-1">จาก {historyJobs.filter(j => j.status === 'delivered').length} งานที่สำเร็จ</div>
                    </div>
                    <h4 className="font-bold mb-2 text-sm text-gray-400">รายการย้อนหลัง</h4>
                    {historyJobs.map(job => (
                        <div key={job.id} className="bg-gray-800 p-3 rounded-lg border border-gray-700 mb-2 flex justify-between items-center">
                            <div>
                                <div className="font-bold text-sm">{job.restaurantName || "ส่งพัสดุ"}</div>
                                <div className="text-xs text-gray-500">{job.timestamp}</div>
                                {job.status === 'cancelled' && <div className="text-xs text-red-400">ยกเลิก: {job.cancelReason || 'ไม่ระบุ'}</div>}
                            </div>
                            <div className="text-right">
                                {job.status === 'delivered' ? (
                                    <>
                                        <div className="text-green-400 font-bold">+฿{job.riderIncome.toFixed(0)}</div>
                                        <div className="text-xs text-green-600 bg-green-900/30 px-1 rounded">สำเร็จ</div>
                                    </>
                                ) : (
                                    <div className="text-xs text-red-500 bg-red-900/30 px-2 py-1 rounded">ยกเลิกแล้ว</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
         </div>
      </div>
    );
  };

  // --- 4. Admin View ---
  const renderAdminView = () => {
     const saveConfig = () => { setAppConfig(editConfig); alert("บันทึกการตั้งค่าระบบเรียบร้อยแล้ว"); };
     const totalGP = orders.reduce((sum, o) => sum + (o.adminGP || 0), 0);
     const gmv = orders.reduce((sum, o) => sum + o.grandTotal, 0);

     const getRiderName = (riderId) => {
         const r = riders.find(rider => rider.id === riderId);
         return r ? r.name : '-';
     };
     
     // Filter support chats for Admin
     const supportChats = Object.keys(chats).filter(key => key.startsWith('support-'));

     return (
       <div className="min-h-screen bg-gray-100 pt-14 p-6">
         <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <h1 className="text-3xl font-bold text-gray-800">Admin Panel</h1>
            <div className="flex space-x-2 bg-white p-1 rounded-lg shadow-sm overflow-x-auto max-w-full">
                <button onClick={() => setAdminTab('dashboard')} className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap ${adminTab === 'dashboard' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>Dashboard</button>
                <button onClick={() => setAdminTab('messages')} className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap ${adminTab === 'messages' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>ข้อความ ({supportChats.length})</button>
                <button onClick={() => setAdminTab('approvals')} className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center whitespace-nowrap ${adminTab === 'approvals' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>อนุมัติ {pendingRequests.length > 0 && <span className="ml-1 bg-red-500 text-white px-1.5 rounded-full text-xs">{pendingRequests.length}</span>}</button>
                <button onClick={() => setAdminTab('management')} className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap ${adminTab === 'management' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>จัดการระบบ</button>
                <button onClick={() => setAdminTab('settings')} className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap ${adminTab === 'settings' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>ตั้งค่า</button>
            </div>
         </div>

         {/* Messages Content */}
         {adminTab === 'messages' && (
             <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                 <div className="p-6 border-b"><h2 className="font-bold text-xl flex items-center"><MessageSquare className="mr-2 text-green-600"/> ข้อความร้องเรียนจากลูกค้า</h2></div>
                 {supportChats.length === 0 ? <div className="p-10 text-center text-gray-400">ไม่มีข้อความใหม่</div> : (
                     <div className="divide-y">
                         {supportChats.map(chatId => {
                             const userId = chatId.split('-')[1];
                             const lastMsg = chats[chatId][chats[chatId].length - 1];
                             return (
                                 <div key={chatId} className="p-4 hover:bg-gray-50 flex justify-between items-center cursor-pointer" onClick={() => openChatWindow(chatId, `Customer (${userId})`, 'customer')}>
                                     <div>
                                         <div className="font-bold">ลูกค้า ID: {userId}</div>
                                         <div className="text-sm text-gray-500 truncate w-64">{lastMsg?.text || 'เริ่มสนทนา'}</div>
                                     </div>
                                     <div className="text-xs text-gray-400">{lastMsg?.time}</div>
                                 </div>
                             );
                         })}
                     </div>
                 )}
             </div>
         )}

         {/* Dashboard Content */}
         {adminTab === 'dashboard' && (
             <>
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                 <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500"><p className="text-gray-500 text-sm">กำไรสุทธิ</p><h3 className="text-2xl font-bold text-gray-800">฿{totalGP.toLocaleString()}</h3></div>
                 <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-blue-500"><p className="text-gray-500 text-sm">GMV (ยอดขายรวม)</p><h3 className="text-2xl font-bold text-gray-800">฿{gmv.toLocaleString()}</h3></div>
                 <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-orange-500"><p className="text-gray-500 text-sm">ออเดอร์ทั้งหมด</p><h3 className="text-2xl font-bold text-gray-800">{orders.length}</h3></div>
                 <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500"><p className="text-gray-500 text-sm">ไรเดอร์ Active</p><h3 className="text-2xl font-bold text-gray-800">{riders.filter(r => r.status === 'active').length}</h3></div>
             </div>
             
             <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b bg-gray-50"><h2 className="font-bold text-lg text-gray-700">รายการธุรกรรมล่าสุด</h2></div>
                <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wider">
                        <tr><th className="p-4">ID / เวลา</th><th className="p-4">ลูกค้า</th><th className="p-4">ร้านค้า/บริการ</th><th className="p-4">ไรเดอร์</th><th className="p-4">สถานะ</th><th className="p-4 text-right">ยอดรวม</th><th className="p-4 text-right">จัดการ</th></tr>
                    </thead>
                    <tbody className="divide-y">
                        {orders.map(order => {
                            const rider = riders.find(r => r.id === order.riderId);
                            const restaurant = restaurants.find(r => r.id === order.restaurantId);
                            return (
                                <tr key={order.id} className="hover:bg-gray-50">
                                    <td className="p-4"><div className="font-mono font-bold text-gray-700">{order.id}</div><div className="text-xs text-gray-500">{order.timestamp}</div></td>
                                    <td className="p-4"><div className="font-bold">{order.customerName}</div><div className="text-xs text-gray-500 flex items-center mt-1"><Phone size={10} className="mr-1"/> {order.customerPhone || '-'}</div></td>
                                    <td className="p-4">
                                        {order.type === 'food' ? (
                                            <><div className="font-bold">{order.restaurantName}</div><div className="text-xs text-gray-500 flex items-center mt-1"><Phone size={10} className="mr-1"/> {restaurant?.phone || '-'}</div></>
                                        ) : (
                                            <div className="font-bold text-blue-600">ส่งพัสดุ</div>
                                        )}
                                    </td>
                                    <td className="p-4">
                                        {rider ? (
                                            <><div className="font-bold">{rider.name}</div><div className="text-xs text-gray-500 flex items-center mt-1"><Phone size={10} className="mr-1"/> {rider.phone || '-'}</div></>
                                        ) : (<span className="text-gray-400 italic">รอรับงาน</span>)}
                                    </td>
                                    <td className="p-4"><span className={`text-xs px-2 py-1 rounded-full border ${STATUS_LABELS[order.status].bg} ${STATUS_LABELS[order.status].color} border-opacity-20`}>{order.status === 'cancelled' ? 'ยกเลิกแล้ว' : STATUS_LABELS[order.status].label}</span>
                                    {order.status === 'cancelled' && <div className="text-xs text-red-500 mt-1">เหตุผล: {order.cancelReason}</div>}
                                    {order.paymentMethod === 'cash' && <div className="text-xs text-blue-600 mt-1 font-bold">COD (เงินสด)</div>}
                                    
                                    { (order.status === 'cancelled' || order.status !== 'delivered') && (
                                        <div className="mt-2 text-[10px] text-gray-400">
                                            <span className="block">Food GP: {appConfig.gpFood}%</span>
                                            <span className="block">Del GP: {appConfig.gpDelivery}%</span>
                                        </div>
                                    )}
                                    </td>
                                    <td className="p-4 text-right font-medium">฿{order.grandTotal}</td>
                                    <td className="p-4 text-right">
                                        {order.status !== 'cancelled' && order.status !== 'delivered' && (
                                            <button onClick={() => initiateCancelOrder(order.id)} className="text-red-500 hover:bg-red-50 hover:text-red-700 font-bold text-xs px-3 py-1 rounded border border-red-200 transition-colors">
                                                ยกเลิก
                                            </button>
                                        )}
                                        {(order.pickupPhoto || order.deliveryPhoto) && (
                                            <button onClick={() => openProofModal(order)} className="text-blue-500 hover:bg-blue-50 font-bold text-xs px-3 py-1 rounded border border-blue-200 ml-2 transition-colors">
                                                หลักฐาน
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                </div>
            </div>
            </>
         )}

         {/* Approvals Content */}
         {adminTab === 'approvals' && (
             <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                 <div className="p-6 border-b"><h2 className="font-bold text-xl flex items-center"><Bell className="mr-2 text-green-600"/> รายการรออนุมัติ ({pendingRequests.length})</h2></div>
                 {pendingRequests.length === 0 ? <div className="p-10 text-center text-gray-400">ไม่มีรายการรออนุมัติ</div> : (
                     <div className="divide-y">
                         {pendingRequests.map(req => (
                             <div key={req.id} className="p-6 flex items-center justify-between hover:bg-gray-50">
                                 <div>
                                    <div className="flex items-center mb-1">
                                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold mr-2">{req.type}</span>
                                        <span className="text-sm text-gray-500">{req.timestamp}</span>
                                    </div>
                                    <div className="font-bold text-gray-800">
                                        {req.type === 'withdraw' 
                                            ? `แจ้งถอนเงิน: ฿${Number(req.data.amount).toLocaleString()}`
                                            : (req.data.name || req.data.shopName || `จำนวน ฿${req.data.amount}`)
                                        }
                                    </div>
                                    
                                    {/* Display Withdrawal Details */}
                                    {req.type === 'withdraw' && (
                                        <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded mt-1 border border-gray-200">
                                            <p className="font-bold text-xs text-gray-500">ข้อมูลการโอน:</p>
                                            <p>ธนาคาร: {req.data.bank}</p>
                                            <p>เลขบัญชี: {req.data.account}</p>
                                            <p>ชื่อบัญชี: {req.data.name}</p>
                                        </div>
                                    )}

                                    {/* Display TopUp Slip */}
                                    {req.type === 'topup' && req.data.slipImage && (
                                        <div className="mt-2">
                                            <p className="text-xs text-gray-500 mb-1">หลักฐานการโอนเงิน (สลิป):</p>
                                            <img 
                                                src={req.data.slipImage} 
                                                alt="Topup Slip" 
                                                className="w-24 h-24 object-cover rounded cursor-pointer border hover:border-blue-500"
                                                onClick={() => openImagePreview(req.data.slipImage)}
                                            />
                                        </div>
                                    )}

                                    <div className="text-sm text-gray-600 mt-1">
                                        {(req.type === 'merchant_reg' || req.type === 'rider_reg') && (
                                            <>
                                            <p>ชื่อจริง: {req.data.realName}</p>
                                            <p>เลขบัตร: {req.data.idCard}</p>
                                            <p>เบอร์โทร: {req.data.phone}</p>
                                            <p>บัญชี: {req.data.bankName} - {req.data.bankAccount}</p>
                                            {req.data.idCardImage && <button onClick={() => openImagePreview(req.data.idCardImage)} className="text-blue-500 text-xs underline flex items-center mt-1"><FileBadge size={12} className="mr-1"/> ดูรูปบัตรประชาชน</button>}
                                            {req.data.shopImage && <button onClick={() => openImagePreview(req.data.shopImage)} className="text-blue-500 text-xs underline flex items-center mt-1"><ImageIcon size={12} className="mr-1"/> ดูรูปหน้าร้าน</button>}
                                            </>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-400 mt-1">Request by: {req.user}</div>
                                 </div>
                                 <div className="flex gap-2"><button onClick={() => handleApproveRequest(req)} className="flex items-center bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700"><Check size={18} className="mr-1"/> อนุมัติ</button><button onClick={() => initiateRejectRequest(req.id)} className="flex items-center bg-gray-200 text-gray-600 px-4 py-2 rounded-lg font-bold hover:bg-gray-300"><XCircle size={18} className="mr-1"/> ปฏิเสธ</button></div>
                             </div>
                         ))}
                     </div>
                 )}
             </div>
         )}

         {/* Management Content */}
         {adminTab === 'management' && (
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <div className="bg-white rounded-xl shadow-sm p-6"><h2 className="font-bold text-xl mb-4 flex items-center text-orange-600"><ChefHat className="mr-2"/> จัดการร้านค้า ({restaurants.length})</h2><div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">{restaurants.map(rest => (<div key={rest.id} className="flex justify-between items-center border-b pb-2"><div><div className="font-bold">{rest.name}</div><div className={`text-xs ${rest.status === 'open' ? 'text-green-600' : 'text-red-500'}`}>สถานะ: {rest.status.toUpperCase()}</div></div><div className="flex space-x-2"><button onClick={() => toggleRestaurantStatus(rest.id, 'toggle_open')} className={`p-2 rounded-lg ${rest.status === 'open' ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-600'}`} title="เปิด/ปิด"><Power size={18}/></button><button onClick={() => toggleRestaurantStatus(rest.id, 'ban')} className={`p-2 rounded-lg ${rest.status === 'banned' ? 'bg-red-500 text-white' : 'bg-red-100 text-red-600'}`} title="แบน"><Lock size={18}/></button></div></div>))}</div></div>
                 <div className="bg-white rounded-xl shadow-sm p-6"><h2 className="font-bold text-xl mb-4 flex items-center text-blue-600"><Bike className="mr-2"/> จัดการไรเดอร์ ({riders.length})</h2><div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">{riders.map(rider => (<div key={rider.id} className="flex justify-between items-center border-b pb-2"><div><div className="font-bold flex items-center">{rider.name}</div><div className={`text-xs ${rider.status === 'active' ? 'text-green-600' : 'text-red-500'}`}>สถานะ: {rider.status.toUpperCase()}</div></div><button onClick={() => toggleRiderBan(rider.id)} className={`px-3 py-1 rounded-lg text-sm font-bold ${rider.status === 'banned' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{rider.status === 'banned' ? 'ปลดแบน' : 'แบน'}</button></div>))}</div></div>
             </div>
         )}

         {/* Settings Content */}
         {adminTab === 'settings' && (
             <div className="bg-white p-6 rounded-xl shadow-sm">
                 <h2 className="font-bold text-xl mb-6 flex items-center"><Sliders className="mr-2"/> ตั้งค่าระบบ</h2>
                 
                 {/* Admin Payment Settings (New) */}
                 <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-8">
                     <h3 className="font-bold text-blue-700 border-b border-blue-200 pb-2 mb-4 flex items-center"><CreditCard size={18} className="mr-2"/> ตั้งค่าบัญชีรับเงิน (Admin Payment)</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">ชื่อธนาคาร</label>
                            <input type="text" value={editConfig.adminBankName} onChange={e => setEditConfig({...editConfig, adminBankName: e.target.value})} className="w-full border p-2 rounded"/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">เลขที่บัญชี</label>
                            <input type="text" value={editConfig.adminBankAccount} onChange={e => setEditConfig({...editConfig, adminBankAccount: e.target.value})} className="w-full border p-2 rounded"/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">ชื่อบัญชี</label>
                            <input type="text" value={editConfig.adminAccountName} onChange={e => setEditConfig({...editConfig, adminAccountName: e.target.value})} className="w-full border p-2 rounded"/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">QR Code URL (รูปภาพ)</label>
                            <input type="text" value={editConfig.adminQrCode} onChange={e => setEditConfig({...editConfig, adminQrCode: e.target.value})} className="w-full border p-2 rounded"/>
                        </div>
                     </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                     <div className="space-y-4">
                         <h3 className="font-bold text-gray-500 border-b pb-2 flex items-center"><MapIcon size={16} className="mr-2"/> รัศมีให้บริการ (กิโลเมตร)</h3>
                         <div><label className="block text-sm font-medium mb-1">App Service Radius (Max)</label><input type="number" value={editConfig.appRadius} onChange={e => setEditConfig({...editConfig, appRadius: parseFloat(e.target.value)})} className="w-full border p-2 rounded"/><p className="text-xs text-gray-400 mt-1">ระยะทางไกลสุดที่ลูกค้ายังสั่งอาหาร/ส่งของได้</p></div>
                         <div><label className="block text-sm font-medium mb-1">Restaurant Delivery Radius</label><input type="number" value={editConfig.restaurantRadius} onChange={e => setEditConfig({...editConfig, restaurantRadius: parseFloat(e.target.value)})} className="w-full border p-2 rounded"/><p className="text-xs text-gray-400 mt-1">รัศมีที่ร้านค้าจะปรากฏให้ลูกค้าเห็น</p></div>
                         <div><label className="block text-sm font-medium mb-1">Rider Job Radius</label><input type="number" value={editConfig.riderRadius} onChange={e => setEditConfig({...editConfig, riderRadius: parseFloat(e.target.value)})} className="w-full border p-2 rounded"/><p className="text-xs text-gray-400 mt-1">รัศมีที่ไรเดอร์จะมองเห็นงานใหม่</p></div>
                     </div>
                     <div className="space-y-4">
                         <h3 className="font-bold text-gray-500 border-b pb-2 flex items-center"><DollarSign size={16} className="mr-2"/> ค่าบริการขนส่ง (บาท)</h3>
                         <div><label className="block text-sm font-medium mb-1">Base Fee (ค่าเริ่มต้น)</label><input type="number" value={editConfig.baseFee} onChange={e => setEditConfig({...editConfig, baseFee: parseFloat(e.target.value)})} className="w-full border p-2 rounded"/></div>
                         <div><label className="block text-sm font-medium mb-1">Per Km Fee (ค่าต่อกม.)</label><input type="number" value={editConfig.perKmFee} onChange={e => setEditConfig({...editConfig, perKmFee: parseFloat(e.target.value)})} className="w-full border p-2 rounded"/></div>
                     </div>
                 </div>

                 <div className="space-y-4 mb-8">
                     <h3 className="font-bold text-gray-500 border-b pb-2 flex items-center"><Percent size={16} className="mr-2"/> ค่าคอมมิชชั่น (GP %)</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium mb-1 text-orange-600">GP ร้านค้า (Food)</label>
                            <div className="flex items-center">
                                <input type="number" value={editConfig.gpFood} onChange={e => setEditConfig({...editConfig, gpFood: parseFloat(e.target.value)})} className="w-full border p-2 rounded-l"/>
                                <span className="bg-gray-100 border border-l-0 p-2 rounded-r text-gray-500">%</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">หักจากยอดขายอาหารของร้านค้า</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 text-blue-600">GP ไรเดอร์ (Delivery)</label>
                            <div className="flex items-center">
                                <input type="number" value={editConfig.gpDelivery} onChange={e => setEditConfig({...editConfig, gpDelivery: parseFloat(e.target.value)})} className="w-full border p-2 rounded-l"/>
                                <span className="bg-gray-100 border border-l-0 p-2 rounded-r text-gray-500">%</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">หักจากค่าส่งของไรเดอร์</p>
                        </div>
                     </div>
                 </div>

                 <button onClick={saveConfig} className="mt-6 bg-green-600 text-white px-6 py-3 rounded-lg font-bold shadow hover:bg-green-700 flex items-center justify-center w-full md:w-auto"><Save className="mr-2"/> บันทึกการตั้งค่าทั้งหมด</button>
             </div>
         )}
       </div>
     );
  };

  return (
    <div className="text-gray-900" style={{fontFamily: "'Noto Sans Thai', 'Inter', sans-serif"}}>
      {renderRoleSwitcher()}
      
      {/* Authentication Screen - World Class */}
      {!isLoggedIn ? (
        <div className="min-h-screen flex flex-col" style={{background: 'linear-gradient(160deg, #fff7ed 0%, #fff 40%, #eff6ff 100%)'}}>
          {/* Hero Section */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
            {/* Logo */}
            <div className="mb-8 text-center animate-fade-in-down">
              <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-orange-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-orange-200">
                <span className="text-4xl">🛵</span>
              </div>
              <h1 className="text-4xl font-black text-gray-900 tracking-tight">BoomRider</h1>
              <p className="text-gray-500 mt-1 text-sm">ส่งเร็ว ส่งถึง ส่งใจ</p>
            </div>

            {/* Feature Chips */}
            <div className="flex gap-2 mb-8 flex-wrap justify-center animate-fade-in-up">
              {['🍔 อาหารร้อนๆ', '📦 ส่งพัสดุ', '⚡ เร็วใน 30 นาที'].map((chip) => (
                <span key={chip} className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1 rounded-full shadow-sm font-medium">
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {/* Auth Card - Bottom Sheet style */}
          <div className="bg-white rounded-t-3xl shadow-[0_-8px_40px_rgba(0,0,0,0.12)] px-6 pt-6 pb-10 animate-slide-in-from-bottom">
            {/* Tab Switcher */}
            <div className="flex mb-5 bg-gray-100 rounded-2xl p-1">
              <button
                onClick={() => setAuthMode('login')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${
                  authMode === 'login'
                    ? 'bg-white text-orange-600 shadow-md'
                    : 'text-gray-500'
                }`}
              >เข้าสู่ระบบ</button>
              <button
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${
                  authMode === 'register'
                    ? 'bg-white text-orange-600 shadow-md'
                    : 'text-gray-500'
                }`}
              >สมัครใช้งาน</button>
            </div>

            {authMode === 'login' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">เบอร์โทร หรือ อีเมล</label>
                  <input
                    type="text"
                    value={loginForm.phone || loginForm.email}
                    onChange={(e) => setLoginForm({...loginForm, phone: e.target.value, email: e.target.value})}
                    className="input-field"
                    placeholder="081-xxx-xxxx หรือ email@example.com"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">รหัสผ่าน</label>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({...loginForm, password: e.target.value})}
                    className="input-field"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                </div>
                <button
                  onClick={handleLogin}
                  className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 active:scale-95 transition-transform mt-2"
                >เข้าสู่ระบบ</button>
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { label: 'ชื่อ-นามสกุล', type: 'text', field: 'name', placeholder: 'ชื่อจริง นามสกุล', autoComplete: 'name' },
                  { label: 'เบอร์โทรศัพท์', type: 'tel', field: 'phone', placeholder: '081-xxx-xxxx', autoComplete: 'tel' },
                  { label: 'อีเมล (ไม่บังคับ)', type: 'email', field: 'email', placeholder: 'email@example.com', autoComplete: 'email' },
                  { label: 'รหัสผ่าน', type: 'password', field: 'password', placeholder: '••••••••', autoComplete: 'new-password' },
                  { label: 'ยืนยันรหัสผ่าน', type: 'password', field: 'confirmPassword', placeholder: '••••••••', autoComplete: 'new-password' },
                ].map(({ label, type, field, placeholder, autoComplete }) => (
                  <div key={field}>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">{label}</label>
                    <input
                      type={type}
                      value={registerForm[field]}
                      onChange={(e) => setRegisterForm({...registerForm, [field]: e.target.value})}
                      className="input-field"
                      placeholder={placeholder}
                      autoComplete={autoComplete}
                    />
                  </div>
                ))}
                <button
                  onClick={handleRegister}
                  className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 active:scale-95 transition-transform mt-2"
                >สมัครใช้งานฟรี</button>
              </div>
            )}

            <div className="mt-4 text-center">
              <p className="text-xs text-gray-400 mb-2">หรือเข้าสู่ระบบด้วย</p>
              <div className="flex gap-2">
                <button className="flex-1 flex items-center justify-center gap-2 border border-gray-200 bg-gray-50 rounded-xl py-2.5 text-sm font-medium text-gray-600 active:bg-gray-100 transition-colors">
                  <Phone size={16} className="text-green-600"/> เบอร์โทร
                </button>
                <button onClick={handleLoginWithGoogle} className="flex-1 flex items-center justify-center gap-2 border border-gray-200 bg-gray-50 rounded-xl py-2.5 text-sm font-medium text-gray-600 active:bg-gray-100 transition-colors">
                  <Mail size={16} className="text-red-500"/> Google
                </button>
              </div>
            </div>

            <p className="text-center text-[11px] text-gray-400 mt-4">
              การเข้าสู่ระบบแสดงว่าคุณยอมรับ
              <span className="text-orange-500 font-medium"> นโยบายความเป็นส่วนตัว</span> ของเรา
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* TOAST CONTAINER */}
          <ToastContainer toasts={toasts} removeToast={removeToast} />
          {showTopUpModal && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowTopUpModal(false)}>
              <div className="bg-white p-5 rounded-2xl shadow-2xl w-full max-w-sm relative" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setShowTopUpModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  
                  <div className="text-center mb-4">
                      <h3 className="text-lg font-bold text-green-600">เติมเงินเข้า Wallet</h3>
                      <p className="text-xs text-gray-500">สแกน QR หรือโอนตามเลขบัญชี</p>
                  </div>
                  
                  <div className="bg-gray-100 p-3 rounded-xl mb-4 border border-gray-100">
                      <div className="flex items-center justify-between mb-3">
                          <div className="bg-white p-1.5 rounded-lg shadow-sm border">
                            <img src={appConfig.adminQrCode} alt="QR Code" className="w-24 h-24 object-cover"/>
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
                          <input 
                              type="number" 
                              value={withdrawAmount} 
                              onChange={(e) => setWithdrawAmount(e.target.value)} 
                              className="w-full pl-8 pr-4 py-2 text-right text-xl font-bold bg-white border border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
                              placeholder="0.00"
                          />
                      </div>
                  </div>

                  {/* Added Slip Upload for TopUp */}
                  <div className="mb-4">
                      <label className={`w-full border-2 border-dashed p-2 rounded-lg text-center cursor-pointer flex items-center justify-center transition-colors ${topUpSlip ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                          <input type="file" accept="image/*" className="hidden" onChange={handleTopUpSlipSelect} />
                          {topUpSlip ? (
                              <><Check size={16} className="mr-1"/> สลิปพร้อมส่ง</>
                          ) : (
                              <><Receipt size={16} className="mr-1"/> แนบสลิปโอนเงิน</>
                          )}
                      </label>
                      {topUpSlip && <div className="mt-2 h-20 w-full bg-gray-100 rounded-lg overflow-hidden relative">
                        <img src={topUpSlip} className="w-full h-full object-cover opacity-80" />
                        <button onClick={(e) => {e.preventDefault(); setTopUpSlip(null);}} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"><X size={12}/></button>
                      </div>}
                  </div>

                  <button 
                      onClick={() => {
                          if (withdrawAmount > 0) {
                              if (!topUpSlip) return alert("กรุณาแนบสลิปการโอนเงิน");
                              requestTopUp(parseFloat(withdrawAmount), topUpSlip);
                          } else {
                              alert("กรุณาระบุจำนวนเงิน");
                          }
                      }}
                      className="w-full bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition-colors flex items-center justify-center"
                  >
                      แจ้งโอนเงิน
                  </button>
              </div>
          </div>
      )}
      
      {showCancelModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-xl shadow-xl w-96">
                  <h3 className="text-lg font-bold mb-4 flex items-center text-red-600"><Ban className="mr-2"/> ยืนยันการยกเลิกออเดอร์</h3>
                  <p className="text-gray-600 mb-2 text-sm">กรุณาระบุเหตุผล (จะแจ้งเตือนไปยังลูกค้า/ไรเดอร์):</p>
                  <textarea 
                      value={cancelReasonInput} 
                      onChange={(e) => setCancelReasonInput(e.target.value)} 
                      placeholder="เช่น ติดต่อลูกค้าไม่ได้, ร้านปิดกะทันหัน..." 
                      className="w-full border p-2 rounded-lg mb-4 h-24"
                  />
                  <div className="flex gap-2">
                      <button onClick={() => setShowCancelModal(false)} className="flex-1 bg-gray-200 py-2 rounded-lg font-bold">ยกเลิก</button>
                      <button onClick={confirmCancelOrder} className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold">ยืนยัน</button>
                  </div>
              </div>
          </div>
      )}

      {/* Reject Request Modal */}
      {showRejectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-xl shadow-xl w-80 text-center">
                  <XCircle size={48} className="text-red-500 mx-auto mb-4"/>
                  <h3 className="text-lg font-bold mb-2">ยืนยันการปฏิเสธคำขอ?</h3>
                  <p className="text-gray-500 mb-6 text-sm">ข้อมูลนี้จะถูกลบออกจากระบบถาวร</p>
                  <div className="flex gap-2">
                      <button onClick={() => setShowRejectModal(false)} className="flex-1 bg-gray-200 py-2 rounded-lg font-bold">ยกเลิก</button>
                      <button onClick={confirmRejectRequest} className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold">ยืนยันปฏิเสธ</button>
                  </div>
              </div>
          </div>
      )}

      {/* View Proof Modal */}
      {showProofModal && selectedProofOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
              <div className="bg-white p-4 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold">หลักฐานการทำงาน (Order #{selectedProofOrder.id})</h3>
                      <button onClick={() => setShowProofModal(false)} className="p-1 hover:bg-gray-100 rounded-full"><X/></button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <p className="font-bold text-sm mb-2 text-indigo-600">รูปถ่ายตอนรับสินค้า (Pickup)</p>
                          {selectedProofOrder.pickupPhoto ? <img src={selectedProofOrder.pickupPhoto} className="w-full rounded-lg border"/> : <p className="text-gray-400 text-sm">ไม่มีรูปภาพ</p>}
                      </div>
                      <div>
                          <p className="font-bold text-sm mb-2 text-green-600">รูปถ่ายตอนส่งสินค้า (Delivery)</p>
                          {selectedProofOrder.deliveryPhoto ? <img src={selectedProofOrder.deliveryPhoto} className="w-full rounded-lg border"/> : <p className="text-gray-400 text-sm">ไม่มีรูปภาพ</p>}
                      </div>
                  </div>
              </div>
          </div>
      )}
      
      {/* Chat Modal */}
      {activeChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white w-full max-w-md h-[500px] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-green-600 p-4 flex justify-between items-center text-white shadow-md">
                    <div className="flex items-center">
                        <div className="bg-white/20 p-2 rounded-full mr-3"><MessageCircle size={20}/></div>
                        <div>
                            <h3 className="font-bold text-lg">{activeChat.title}</h3>
                            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full capitalize">{activeChat.role}</span>
                        </div>
                    </div>
                    <button onClick={closeChatWindow} className="p-1 hover:bg-white/20 rounded-full"><X size={24}/></button>
                </div>

                {/* Messages Body */}
                <div className="flex-1 p-4 overflow-y-auto bg-gray-50 space-y-3">
                    {(chats[activeChat.id] || []).length === 0 ? (
                        <div className="text-center text-gray-400 mt-10">เริ่มสนทนาได้เลย...</div>
                    ) : (
                        (chats[activeChat.id] || []).map((msg, idx) => (
                            <div key={idx} className={`flex ${msg.sender === activeRole ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[75%] p-3 rounded-2xl shadow-sm ${msg.sender === activeRole ? 'bg-green-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none'}`}>
                                    <p className="text-sm">{msg.text}</p>
                                    <span className={`text-[10px] block text-right mt-1 ${msg.sender === activeRole ? 'text-green-100' : 'text-gray-400'}`}>{msg.time}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer Input */}
                <div className="p-3 bg-white border-t flex items-center gap-2">
                    <input 
                        type="text" 
                        placeholder="พิมพ์ข้อความ..." 
                        className="flex-1 border bg-gray-100 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
                        onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                                sendMessage(e.target.value);
                                e.target.value = '';
                            }
                        }}
                    />
                    <button 
                        onClick={(e) => {
                            const input = e.currentTarget.previousElementSibling;
                            sendMessage(input.value);
                            input.value = '';
                        }}
                        className="bg-green-600 text-white p-2.5 rounded-full hover:bg-green-700 shadow-lg transition-transform active:scale-95"
                    >
                        <Send size={18} className="ml-0.5"/>
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {showImageModal && (
          <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4" onClick={() => setShowImageModal(false)}>
              <div className="relative max-w-4xl w-full h-full flex items-center justify-center">
                  <button onClick={() => setShowImageModal(false)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white hover:bg-white/40"><X size={24}/></button>
                  <img src={previewImageUrl} className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
              </div>
          </div>
      )}
      
      {activeRole === 'customer' && renderCustomerView()}
      {activeRole === 'merchant' && renderMerchantView()}
      {activeRole === 'rider' && renderRiderView()}
      {activeRole === 'admin' && renderAdminView()}
      </>
      )}
    </div>
  );
}