// ===== App Constants =====

export const INITIAL_CONFIG = {
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
  adminQrCode: "https://upload.wikimedia.org/wikipedia/commons/d/d0/QR_code_for_mobile_English_Wikipedia.svg",
  adminPromptPayId: ""
};

export const GP_RATES = {
  food: 0.30,      // GP 30%
  delivery: 0.15,  // GP 15%
};

export const USER_LOCATION = { lat: 13.7563, lng: 100.5018 };

// ── ข้อมูลจริงโหลดจาก Firestore — ไม่มี demo data เพื่อป้องกันสับสน ──
export const INITIAL_RESTAURANTS = [];
export const INITIAL_RIDERS = [];
export const INITIAL_MENU_ITEMS = {};

export const STATUS_LABELS = {
  pending: { label: "รอร้านรับออเดอร์", color: "text-orange-500", bg: "bg-orange-100" },
  preparing: { label: "กำลังเตรียมอาหาร", color: "text-blue-500", bg: "bg-blue-100" },
  ready_to_pickup: { label: "รอไรเดอร์รับงาน", color: "text-purple-500", bg: "bg-purple-100" },
  rider_accepted: { label: "ไรเดอร์รับงานแล้ว", color: "text-indigo-500", bg: "bg-indigo-100" },
  picking_up: { label: "ถึงจุดรับ/รอรับของ", color: "text-indigo-600", bg: "bg-indigo-100" },
  delivering: { label: "ไรเดอร์กำลังไปส่ง", color: "text-blue-600", bg: "bg-blue-100" },
  delivered: { label: "จัดส่งสำเร็จ", color: "text-green-600", bg: "bg-green-100" },
  completed: { label: "จบงานแล้ว ✓", color: "text-emerald-700", bg: "bg-emerald-100" },
  cancelled: { label: "ยกเลิกแล้ว", color: "text-red-500", bg: "bg-red-100" },
};

// ===== Admin Config =====
export const ADMIN_UID = import.meta.env.VITE_ADMIN_UID || '';

export const ADMIN_PERMISSIONS = {
  viewDashboard:    true,
  approveRequests:  true,
  manageRestaurants:true,
  manageRiders:     true,
  manageOrders:     true,
  editSystemConfig: true,
  viewMessages:     true,
  approveTopups:    true,
};
