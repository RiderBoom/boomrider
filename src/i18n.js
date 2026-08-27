import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  th: {
    translation: {
      // Common
      "app_name": "BoomRider",
      "back": "← กลับ",
      "cancel": "ยกเลิก",
      "confirm": "ยืนยัน",
      "save": "บันทึก",
      "loading": "กำลังโหลด...",
      "reload": "🔄 โหลดข้อมูลใหม่",
      "contact_admin": "กรุณาติดต่อเจ้าหน้าที่",
      "language": "ภาษา",
      "thai": "ไทย",
      "english": "English",
      "dark_mode": "โหมดมืด",
      "light_mode": "โหมดสว่าง",
      "hello": "สวัสดี",

      // Customer Bottom Nav
      "nav_home": "หน้าแรก",
      "nav_activity": "กิจกรรม",
      "nav_profile": "โปรไฟล์",

      // Customer Services
      "service_food": "อาหาร",
      "service_parcel": "พัสดุ",
      "service_ride": "เรียกรถ",
      "service_service": "บริการ",
      "search_placeholder": "ค้นหาร้านอาหาร, เมนู...",

      // Customer Activity & Profile
      "activity_title": "กิจกรรมการสั่งซื้อ",
      "active_orders": "ออเดอร์ที่กำลังดำเนินอยู่",
      "order_history": "ประวัติการสั่งซื้อ",
      "profile_title": "โปรไฟล์ของคุณ",
      "wallet_balance": "ยอดเงินในกระเป๋า",
      "topup": "เติมเงิน",
      "withdraw": "ถอนเงิน",
      "addresses": "ที่อยู่ของคุณ",
      "add_address": "+ เพิ่มที่อยู่ใหม่",
      "logout": "ออกจากระบบ",
      "register_partner": "สมัครเป็นพาร์ทเนอร์",
      "reg_merchant": "🏪 สมัครร้านค้า",
      "reg_rider": "🛵 สมัครไรเดอร์",

      // Auth View
      "login": "เข้าสู่ระบบ",
      "register": "สมัครใช้งาน",
      "slogan": "ส่งเร็ว ส่งถึง ส่งใจ",
      "email_or_phone": "เบอร์โทร หรือ อีเมล",
      "password": "รหัสผ่าน",
      "forgot_password": "ลืมรหัสผ่าน?",
      "full_name": "ชื่อ-นามสกุล",
      "confirm_password": "ยืนยันรหัสผ่าน",
      "submit_login": "เข้าสู่ระบบ",
      "submit_register": "สมัครใช้งานฟรี",

      // Rider View
      "rider_no_data_title": "ยังไม่มีข้อมูลไรเดอร์",
      "rider_no_data_desc": "Admin ยังไม่อนุมัติ หรืออาจต้องโหลดข้อมูลใหม่",
      "rider_register": "📋 สมัครไรเดอร์",
      "rider_back_home": "กลับหน้าหลัก",
      "rider_banned_title": "บัญชีถูกระงับ",
      "rider_online": "Online",
      "rider_offline": "Offline",
      "rider_gps_realtime": "GPS ติดตามตำแหน่งแบบ Real-time",
      "rider_gps_denied": "GPS ถูกปิดกั้น — กรุณาเปิดสิทธิ์ตำแหน่งในเบราว์เซอร์",
      "rider_gps_unavailable": "GPS ไม่พร้อมใช้งาน",
      "rider_gps_timeout": "GPS หมดเวลา — กำลังลองใหม่...",
      "rider_today": "วันนี้",
      "rider_total": "รวมทั้งหมด",
      "rider_completed_jobs": "งานสำเร็จ",
      "rider_tab_new_jobs": "งานใหม่",
      "rider_tab_active": "ทำอยู่",
      "rider_tab_map": "จุดรับงาน",
      "rider_tab_history": "ประวัติ",
      "rider_tab_wallet": "กระเป๋า",

      // Rider Job Details
      "rider_job_new": "🛵 มีงานใหม่เข้ามา!",
      "rider_job_respond_in": "กรุณาตอบรับภายใน {{seconds}} วินาที",
      "rider_job_accept": "✅ รับงาน!",
      "rider_job_reject": "✕ ปฏิเสธ",
      "rider_accepting": "กำลังรับ...",
      "rider_collect_cash": "💰 เก็บเงินสดจาก {{target}}: ฿{{amount}}",
      "rider_cash_gp_notice": "⚠️ หลังส่งสำเร็จ −฿{{amount}} จะหักจากกระเป๋า (ค่า GP platform)",
      "rider_wallet_notice": "👛 ชำระผ่าน Wallet · ยอดรวม: ฿{{amount}}",
      "rider_navigate_pickup": "🗺️ นำทางไปจุดรับ",
      "rider_navigate_dropoff": "🗺️ นำทางไปส่ง",
      "rider_accept_job": "✅ รับงาน — รับ ฿{{amount}} เข้ากระเป๋า",
      "rider_accept_cash_job": "✅ รับงาน — เก็บเงินสด ฿{{amount}}",
      "rider_no_active_jobs": "ไม่มีงานที่กำลังทำอยู่",
      "rider_view_new_jobs": "ดูงานใหม่",
      "rider_status_accepted": "🟡 กำลังไปรับ",
      "rider_status_picking_up": "🟠 ถึงจุดรับ",
      "rider_status_delivering": "🔵 กำลังส่ง",
      "rider_btn_arrived_pickup": "✅ ถึงจุดรับแล้ว",
      "rider_btn_picked_up": "✅ ยืนยันรับของแล้ว → ออกส่ง",
      "rider_btn_delivered": "🎉 ยืนยันส่งถึงที่หมายแล้ว!",
      "rider_upload_proof": "📷 ถ่ายรูปหลักฐานการส่ง",
      "rider_proof_uploaded": "✓ อัปโหลดสำเร็จ",
      "rider_cancel_job_request": "✕ ขอยกเลิกงานนี้ (ส่ง Admin)",
      "rider_waiting_cancel_approval": "⏳ รอ Admin อนุมัติการยกเลิก",

      // Rider Wallet
      "rider_wallet_main": "กระเป๋าเงินหลัก",
      "rider_topup": "เติมเงิน",
      "rider_withdraw": "ถอนเงิน",
      "rider_transaction_history": "ประวัติธุรกรรม",
      "rider_pending_admin": "⏳ รอ Admin อนุมัติ",

      // Rider Map Settings
      "rider_set_work_location": "ตั้งจุดรับงานของคุณ",
      "rider_map_hint": "แตะบนแผนที่เพื่อปักหมุดจุดที่คุณต้องการรับงาน — งานที่อยู่ในรัศมี {{radius}} กม. จากจุดนี้จะปรากฏในแท็บ \"งานใหม่\"",
      "rider_use_current_gps": "📡 ใช้ตำแหน่ง GPS ปัจจุบัน",
      "rider_save_work_location": "บันทึกจุดรับงาน",
    }
  },
  en: {
    translation: {
      // Common
      "app_name": "BoomRider",
      "back": "← Back",
      "cancel": "Cancel",
      "confirm": "Confirm",
      "save": "Save",
      "loading": "Loading...",
      "reload": "🔄 Reload Data",
      "contact_admin": "Please contact support",
      "language": "Language",
      "thai": "ไทย",
      "english": "English",
      "dark_mode": "Dark Mode",
      "light_mode": "Light Mode",
      "hello": "Hello",

      // Customer Bottom Nav
      "nav_home": "Home",
      "nav_activity": "Activity",
      "nav_profile": "Profile",

      // Customer Services
      "service_food": "Food",
      "service_parcel": "Parcel",
      "service_ride": "Ride",
      "service_service": "Service",
      "search_placeholder": "Search restaurants, food...",

      // Customer Activity & Profile
      "activity_title": "Order Activity",
      "active_orders": "Active Orders",
      "order_history": "Order History",
      "profile_title": "Your Profile",
      "wallet_balance": "Wallet Balance",
      "topup": "Top Up",
      "withdraw": "Withdraw",
      "addresses": "Your Addresses",
      "add_address": "+ Add New Address",
      "logout": "Log Out",
      "register_partner": "Register as Partner",
      "reg_merchant": "🏪 Register Merchant",
      "reg_rider": "🛵 Register Rider",

      // Auth View
      "login": "Log In",
      "register": "Sign Up",
      "slogan": "Fast, Reliable, Heartfelt Delivery",
      "email_or_phone": "Phone or Email",
      "password": "Password",
      "forgot_password": "Forgot Password?",
      "full_name": "Full Name",
      "confirm_password": "Confirm Password",
      "submit_login": "Log In",
      "submit_register": "Sign Up Free",

      // Rider View
      "rider_no_data_title": "No Rider Profile Found",
      "rider_no_data_desc": "Admin has not approved yet or data needs refresh",
      "rider_register": "📋 Register Rider",
      "rider_back_home": "Back to Main",
      "rider_banned_title": "Account Suspended",
      "rider_online": "Online",
      "rider_offline": "Offline",
      "rider_gps_realtime": "Real-time GPS Tracking",
      "rider_gps_denied": "GPS Blocked — Please allow location access in browser",
      "rider_gps_unavailable": "GPS Unavailable",
      "rider_gps_timeout": "GPS Timeout — Retrying...",
      "rider_today": "Today",
      "rider_total": "Total",
      "rider_completed_jobs": "Completed Jobs",
      "rider_tab_new_jobs": "New Jobs",
      "rider_tab_active": "Active",
      "rider_tab_map": "Pickup Point",
      "rider_tab_history": "History",
      "rider_tab_wallet": "Wallet",

      // Rider Job Details
      "rider_job_new": "🛵 New Job Offer!",
      "rider_job_respond_in": "Please respond within {{seconds}} seconds",
      "rider_job_accept": "✅ Accept!",
      "rider_job_reject": "✕ Reject",
      "rider_accepting": "Accepting...",
      "rider_collect_cash": "💰 Collect cash from {{target}}: ฿{{amount}}",
      "rider_cash_gp_notice": "⚠️ After delivery −฿{{amount}} platform GP fee will be deducted",
      "rider_wallet_notice": "👛 Paid via Wallet · Total: ฿{{amount}}",
      "rider_navigate_pickup": "🗺️ Navigate to Pickup",
      "rider_navigate_dropoff": "🗺️ Navigate to Dropoff",
      "rider_accept_job": "✅ Accept Job — Earn ฿{{amount}}",
      "rider_accept_cash_job": "✅ Accept Job — Collect Cash ฿{{amount}}",
      "rider_no_active_jobs": "No active jobs in progress",
      "rider_view_new_jobs": "View New Jobs",
      "rider_status_accepted": "🟡 En Route to Pickup",
      "rider_status_picking_up": "🟠 At Pickup",
      "rider_status_delivering": "🔵 Delivering",
      "rider_btn_arrived_pickup": "✅ Arrived at Pickup",
      "rider_btn_picked_up": "✅ Picked Up → Start Delivery",
      "rider_btn_delivered": "🎉 Confirm Delivered!",
      "rider_upload_proof": "📷 Take Delivery Photo Proof",
      "rider_proof_uploaded": "✓ Uploaded",
      "rider_cancel_job_request": "✕ Request Job Cancellation (Admin)",
      "rider_waiting_cancel_approval": "⏳ Awaiting Admin Cancellation Approval",

      // Rider Wallet
      "rider_wallet_main": "Main Wallet",
      "rider_topup": "Top Up",
      "rider_withdraw": "Withdraw",
      "rider_transaction_history": "Transaction History",
      "rider_pending_admin": "⏳ Pending Admin Approval",

      // Rider Map Settings
      "rider_set_work_location": "Set Working Location",
      "rider_map_hint": "Tap on map to pin your preferred working location — jobs within {{radius}} km of this point will appear in \"New Jobs\"",
      "rider_use_current_gps": "📡 Use Current GPS Location",
      "rider_save_work_location": "Save Working Location",
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('boomrider_lang') || 'th',
    fallbackLng: 'th',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
