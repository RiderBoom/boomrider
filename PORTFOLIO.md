# 🛵 BoomRider — Portfolio & Client Presentation Guide
> **Enterprise-Grade On-Demand Super App Platform**
> *ระบบแอปพลิเคชันสั่งอาหาร เรียกรถ ส่งพัสดุ และบริการครบวงจร (Food, Ride, Parcel, Service Super App)*

---

## 📌 Executive Summary (ภาพรวมโครงการ)

**BoomRider** เป็นแฟลตฟอร์ม Super App ระดับพาณิชย์ (Commercial-Grade Super App) ที่พัฒนาขึ้นด้วยสถาปัตยกรรมระดับสากล รองรับ 4 บริการหลักในแอปเดียว มีความปลอดภัยสูง ประมวลผลธุรกรรมทางการเงินและออเดอร์แบบ Realtime พร้อมระบบบริหารจัดการสำหรับผู้ดูแลระบบ (Admin) ร้านค้า (Merchant) ไรเดอร์ (Rider) และลูกค้า (Customer) ครบวงจร

---

## 🌟 Key Features Showcase (จุดเด่นและฟีเจอร์หลัก)

### 1. 🍔 Food Delivery (ระบบสั่งอาหาร)
- สั่งอาหารง่าย เลือกท็อปปิ้ง/ตัวเลือกพิเศษ (Options & Extra Price)
- ค้นหาร้านค้า แยกหมวดหมู่ และค้นหาเมนูพร้อม Tag อาหาร
- คำนวณค่าจัดส่งตามระยะทางจริง
- ติดตามสถานะออเดอร์ Realtime (Placed -> Preparing -> Dispatch -> Delivering -> Delivered)

### 2. 📦 Parcel Delivery (ระบบส่งพัสดุ)
- ปักหมุดจุดรับ-ส่งบนแผนที่ Leaflet / OSRM
- คำนวณค่าส่งอัตโนมัติจากระยะทางตามพิกัด Latitude/Longitude
- ระบบแนบรูปถ่ายหลักฐานการเข้ารับและส่งมอบพัสดุ

### 3. 🛵 Ride-Hailing (ระบบเรียกรถรับส่ง)
- คำนวณค่าเดินทางตามระยะทาง ค่าบริการเริ่มต้น (Base Fee + Per Km Fee)
- เรียกรถและกระจายงานให้คนขับที่ใกล้ที่สุดแบบ Realtime (Broadcast Dispatch Engine)

### 4. 🛠️ On-Demand Service (ระบบเรียกบริการ)
- เรียกช่าง/บริการถึงบ้าน พร้อมระบบคำนวณค่าบริการและตัวเลือกเสริม

### 5. 💳 Digital Wallet & PromptPay
- เติมเงินเข้ากระเป๋าเงินดิจิทัลผ่าน **PromptPay QR Code**
- ระบบหักค่า GP และกระจายรายได้เข้า Wallet ไรเดอร์และร้านค้าโดยอัตโนมัติ

### 6. 🤖 AI Chatbot (น้องบูม AI)
- ผู้ช่วย AI อัตโนมัติ (Google Gemini API Integration) ช่วยเช็คสถานะออเดอร์ เช็คยอดเงินคงเหลือ และแนะนำการใช้งาน 24 ชั่วโมง

---

## 🛠️ Tech Stack & Architecture (สถาปัตยกรรมทางเทคนิค)

| Layer | Technology Used |
| :--- | :--- |
| **Frontend Framework** | React 19, Vite 7, TailwindCSS 3 |
| **Mobile Native** | Capacitor 8 (Android APK / AAB & iOS Ready) |
| **Backend & Database** | Supabase (PostgreSQL 15, Realtime WebSockets, RLS, Edge Functions) |
| **Mapping & Routing** | Leaflet, OpenStreetMap, OSRM Routing Engine |
| **Security & Auth** | Row Level Security (RLS) 100%, Atomic Database Locks (`FOR UPDATE`), Content Security Policy |
| **Internationalization** | i18next (รองรับ ภาษาไทย / English / Dark Mode) |

---

## 💰 Commercial Pricing & Business Models (ราคาและโมเดลธุรกิจสำหรับเสนอขาย)

### 1. Whitelabel Customization (ขายระบบเปลี่ยนแบรนด์)
- **ราคาประเมิน**: **250,000 – 450,000 บาท**
- **สิ่งที่ลูกค้าได้รับ**:
  - เปลี่ยนสี โลโก้ ชื่อแอป เป็นของแบรนด์ลูกค้า
  - ระบบ Web App + Android Native App (APK/Play Store Ready)
  - เซ็ตอัประบบฐานข้อมูลและ Server บน Supabase/Vercel ของลูกค้าเอง
  - สิทธิ์ความคุ้มครองโค้ดและคู่มือการใช้งาน

### 2. SaaS Model (เปิดเช่าระบบรายเดือน)
- **Setup Fee**: 50,000 บาท
- **Monthly Subscription**: 9,900 – 19,900 บาท / เดือน

---

## 🎯 Pitch Deck Template (แนวทางการนำเสนอขายลูกค้า)

1. **Slide 1: Hook / Problem** — ตลาดการสั่งอาหารและขนส่งโตต่อเนื่อง แต่แอปใหญ่เก็บค่า GP แพง (30-35%) ทำให้ร้านค้าและไรเดอร์อยู่ยาก
2. **Slide 2: Solution** — นำเสนอแอปเฉพาะท้องถิ่น/แบรนด์ของลูกค้าเอง เก็บ GP เป็นธรรม รันธุรกิจได้ทันที
3. **Slide 3: Live Demo** — แสดงการใช้งานแอป BoomRider จริง (กดสั่งอาหาร -> ไรเดอร์รับงาน -> หน้า Admin อนุมัติ)
4. **Slide 4: Business Model & ROI** — คำนวณจุดคุ้มทุน (ROI) จากการเก็บค่า GP
5. **Slide 5: Offer & Pricing** — นำเสนอแพ็กเกจราคาและระยะเวลาส่งมอบ (1-2 สัปดาห์)

---

*© 2026 BoomRider Platform. All rights reserved.*
