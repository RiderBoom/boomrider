# 📋 BoomRider Staging, Production & Mobile FCM Release Checklist

เอกสารนี้ระบุขั้นตอนการตรวจสอบคุณภาพและความพร้อม (Release Gate & Physical Device Checklist) สำหรับระบบ **BoomRider** ก่อนเปิดใช้งานในระดับ **Staging**, **Beta**, และ **Production**

---

## 🚀 1. Staging Deployment Verification

- [ ] **GitHub Actions Staging Workflow**: กดรัน workflow `Deploy staging` ผ่าน GitHub Actions (`workflow_dispatch`)
- [ ] **Pipeline Execution**: ตรวจสอบว่าขั้นตอนต่อไปนี้ทำงานสำเร็จทั้งหมด:
  - `npm ci`
  - `npm run lint`
  - `npm test`
  - `npm run security:check`
  - `npm run build`
  - `npm run release:check`
  - `npm run test:e2e` (Playwright)
- [ ] **Database Migrations**: ตรวจสอบว่า `supabase db push` อัปเดต migration จนถึงล่าสุดครบถ้วน
- [ ] **Edge Functions Deployment**:
  - `ai-chat`
  - `send-notification`
  - `process-expired-offers`
- [ ] **Vercel Preview URL**: ตรวจสอบว่า Vercel staging deployment สำเร็จและเข้าถึง URL ได้
- [ ] **Automated Smoke Test**: `npm run smoke` ตรวจสอบ HTML app shell และ Security Headers สำเร็จ

---

## 🔐 2. Authentication & Authorization Flow

- [ ] **Customer Registration & Login**:
  - สมัครสมาชิกใหม่สำเร็จด้วย Email / Password
  - เข้าสู่ระบบสำเร็จ บันทึก JWT Token ลง `localStorage`
- [ ] **Session Maintenance**: รีเฟรชหน้าจอ Session ยังคงอยู่โดยไม่ต้อง Login ใหม่
- [ ] **Invalid / Expired Token Recovery**: เมื่อบังคับลบ Token หรือใช้ Refresh Token ที่หมดอายุ ระบบทำการ Sign Out และล้าง Auth Storage keys โดยไม่เกิด Infinite Redirect Loop
- [ ] **Role Management**: สิทธิ์ Customer, Merchant, Rider และ Admin แยกจากกันอย่างเด็ดขาดตามบทบาทในตาราง `user_roles`
- [ ] **RLS & Privilege Escalation Guards**:
  - ผู้ใช้ทั่วไปไม่สามารถดึงข้อมูลกระเป๋าเงิน หรืออัปเดตสิทธิ์ `user_roles` ของผู้อื่นได้
  - การพยายามเปลี่ยนสถานะออเดอร์โดยไม่มีสิทธิ์จะถูกปฏิเสธที่ระดับ Database Policy (42501 Error)

---

## 🛍️ 3. Core Order Lifecycle Flow

### A. Customer Order Creation
- [ ] เลือกเลือกร้านค้า และเพิ่มรายการอาหารลงใน Cart
- [ ] คำนวณราคารวม ค่าจัดส่ง และยอดหักกระเป๋าเงิน (Wallet) ได้ถูกต้อง
- [ ] ยืนยันการสั่งซื้อ ออเดอร์ถูกสร้างลงตาราง `orders` สถานะเป็น `pending`

### B. Merchant Acceptance
- [ ] ร้านค้าได้รับการแจ้งเตือนออเดอร์ใหม่เรียลไทม์ (เสียงเตือน + Vibration + Toast)
- [ ] กด "รับออเดอร์" สถานะออเดอร์เปลี่ยนเป็น `preparing` ➔ `ready_to_pickup`

### C. Rider Dispatch & Acceptance
- [ ] ระบบสร้าง `job_offers` และส่งสัญญาณ Notification ไปหาไรเดอร์ในรัศมี
- [ ] ไรเดอร์ได้รับการแจ้งเตือนงานใหม่
- [ ] ไรเดอร์กด "รับงาน" (`accept_job_offer` RPC):
  - ออเดอร์เปลี่ยนสถานะเป็น `rider_accepted`
  - `job_offers` สถานะเปลี่ยนเป็น `accepted`
  - ไรเดอร์ปรับสถานะเป็นไม่ว่าง (`is_available = false`)
- [ ] **Expired / Rejected Job Offer**: หากไรเดอร์ไม่ตอบรับภายในเวลาที่กำหนด (`expires_at`) งานถูกดึงกลับเพื่อ Redispatch ไรเดอร์ท่านอื่นผ่าน Edge Function `process-expired-offers`

### D. Delivery & Settlement
- [ ] **Pickup**: ไรเดอร์กดถึงจุดรับ/รับสินค้า สถานะเปลี่ยนเป็น `picking_up` ➔ `delivering`
- [ ] **Realtime Map Tracking**: ตำแหน่งพิกัด GPS ของไรเดอร์อัปเดตบนหน้าจอของลูกค้าเรียลไทม์
- [ ] **Delivery Complete**: ไรเดอร์ส่งสินค้าเรียบร้อย สถานะเปลี่ยนเป็น `delivered`
- [ ] **Customer Confirmation & Settlement**:
  - ลูกค้ากด "ยืนยันรับสินค้า" หรือระบบ Auto-complete หลังครบกำหนดเวลา
  - สถานะเปลี่ยนเป็น `completed`
  - RPC `process_order_settlement` ตัด/โอนเงิน และหักค่า GP ตามประเภทบริการ (`food`, `parcel`, `ride`, `service`) ลงกระเป๋าเงินไรเดอร์และระบบอย่างถูกต้อง

---

## 📱 4. Mobile Android & FCM Push Notification Checklist (Physical Device)

> 💡 *หมายเหตุ: ทำการติดตั้ง Debug/Signed APK ลงในมือถือ Android เครื่องจริงเพื่อทดสอบ*

### A. APK Installation & Setup
- [ ] ติดตั้ง `BoomRider-*.apk` บน Android OS 13+
- [ ] เปิดแอป ระบบร้องขอสิทธิ์ Notification Permission (`POST_NOTIFICATIONS`) ➔ กดยอมรับ (Granted)
- [ ] ล็อกอินบัญชี Rider หรือ Customer ➔ ตรวจสอบใน Database ตาราง `push_devices` ว่ามี record บันทึก `token` และ `enabled = true`

### B. Foreground Notification Test
- [ ] เปิดแอปค้างไว้บนหน้าจอ
- [ ] สร้างออเดอร์ใหม่ หรือ ยิง Webhook เข้า `send-notification`
- [ ] **ผลลัพธ์ที่คาดหวัง**: แอปเล่นเสียงเตือน (`playOrderNotificationSound`), สั่นเครื่อง (`vibrateDevice`), และแสดง Toast แจ้งเตือน

### C. Background Notification Test
- [ ] กดปุ่ม Home เพื่อสลับแอปไปอยู่ด้านหลัง (Background)
- [ ] ส่งแจ้งเตือนงานใหม่เข้าไรเดอร์
- [ ] **ผลลัพธ์ที่คาดหวัง**: มี System Heads-up Notification เด้งขึ้นมาด้านบนหน้าจอพร้อมเสียงและสั่น

### D. Lock Screen Test
- [ ] กดปุ่ม Power เพื่อล็อกหน้าจอมือถือ (Lock Screen)
- [ ] ส่งแจ้งเตือนสถานะออเดอร์ หรือ งานใหม่เข้าไรเดอร์
- [ ] **ผลลัพธ์ที่คาดหวัง**: หน้าจอสว่างขึ้นพร้อมแสดง Heads-up Notification บน Lock Screen

### E. Invalid / Expired Token Handling
- [ ] ถอนการติดตั้งแอปแล้วติดตั้งใหม่ (FCM Token เปลี่ยน)
- [ ] ส่งแจ้งเตือนไปยัง Token เดิม
- [ ] **ผลลัพธ์ที่คาดหวัง**: Edge Function `send-notification` ได้รับ `UNREGISTERED` error และอัปเดต `push_devices.enabled = false` อัตโนมัติ โดยบันทึก log ลง `notification_deliveries`

---

## 💳 5. PromptPay & Payment Flows

- [ ] **PromptPay QR Generation**:
  - กดสั่งซื้อ หรือ เติมเงินผ่าน PromptPay
  - ระบบสร้าง PromptPay QR Code ที่สแกนได้ถูกต้องตามมาตรฐาน EMVCo
- [ ] **Top-Up Slip Upload**:
  - อัปโหลดสลิปโอนเงิน รูปภาพถูกบีบอัดขนาดก่อนบันทึก
  - รายการเติมเงินเข้าตาราง `pending_requests` รอ Admin อนุมัติ

---

## 🔄 6. Rollback Procedure

หากเกิดปัญหาร้ายแรงบน Staging/Production ให้ปฏิบัติตามขั้นตอนต่อไปนี้:

1. **Vercel Rollback**:
   - เข้าไปที่ Vercel Dashboard ➔ Project Settings ➔ Deployments
   - เลือก Deployment ก่อนหน้าที่เสถียร ➔ กด **Promote to Production / Preview**
2. **Database Migration Rollback**:
   - ตรวจสอบไฟล์ SQL Down migration ใน `supabase/migrations/`
   - รันคำสั่งย้อน SQL migration ผ่าน Supabase CLI หรือ SQL Editor
3. **Edge Functions Rollback**:
   - Redeploy เวอร์ชันที่เสถียรผ่านคำสั่ง `supabase functions deploy <function-name>`
