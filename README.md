# 🛵 BoomRider — Enterprise On-Demand Super App Platform

**แพลตฟอร์ม Super App สำหรับการใช้งานจริงระยะเริ่มต้น (สั่งอาหาร, เรียกรถรับส่ง, ส่งพัสดุ และเรียกบริการทั่วไป)**
พัฒนาด้วย React 19 + Vite 8 + TailwindCSS 3 + Capacitor 8 + Supabase
*ส่งเร็ว ส่งถึง ส่งใจ — Deployed on Vercel*

[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://boomrider.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

| ฟีเจอร์ | รายละเอียด |
|---------|-----------|
| 🍔 **สั่งอาหาร (Food Delivery)** | เลือกร้าน → เลือกท็อปปิ้ง/เมนูพิเศษ → ชำระเงิน (Wallet/เงินสด/PromptPay) |
| 🚗 **เรียกรถรับส่ง (Ride-Hailing)** | คำนวณค่าบริการตามระยะทาง (Base Fee + Per Km) → เรียกคนขับ/วิน/แท็กซี่ real-time |
| 📦 **ส่งพัสดุ (Parcel Delivery)** | ปักหมุดจุดรับ-ส่งบนแผนที่ OSRM → คำนวณค่าส่งอัตโนมัติ → เรียกไรเดอร์พร้อมถ่ายรูปหลักฐาน |
| 🛠️ **เรียกบริการทั่วไป (On-Demand Service)** | เลือกบริการช่าง/ทำความสะอาด/ซ่อมแอร์/ประปา/ขนย้าย → คำนวณค่าบริการ |
| 🛵 **ระบบไรเดอร์ & คนขับ** | รับงานสั่งอาหาร/ส่งพัสดุ/เรียกรถ/งานบริการ → นำทาง GPS → ถ่ายรูปหลักฐาน → สรุปรายได้/หัก GP อัตโนมัติ |
| 🏪 **ระบบร้านค้า (Merchant Panel)** | จัดการร้านค้า → จัดการเมนู & ท็อปปิ้ง → รับออเดอร์ real-time → ดูรายงานรายได้ |
| 👑 **Admin Panel** | Dashboard สรุปผล, อนุมัติสมาชิก/ร้านค้า/พาร์ทเนอร์, กำหนด GP & ตั้งค่าระบบ |
| 💬 **Live Chat** | ระบบแชท real-time ระหว่าง ลูกค้า ↔ ร้านค้า ↔ ไรเดอร์/คนขับ |
| 🔔 **Notifications & Audio Alert** | แจ้งเตือนสถานะออเดอร์ real-time พร้อมเสียงเตือนและระบบสั่น |
| 💳 **Wallet System** | เติมเงินผ่าน PromptPay QR Code, ถอนเงิน, ประวัติธุรกรรม, ตัด GP อัตโนมัติ |
| 🤖 **ผู้ช่วย AI (น้องบูม AI)** | AI Chatbot ช่วยเช็คสถานะออเดอร์ เช็คยอดเงิน และแนะนำการใช้งาน 24 ชั่วโมง |
| 💼 **Portfolio Mode** | โหมดนำเสนอผลงาน แพ็กเกจระบบ Whitelabel/SaaS และฟอร์มติดต่อสอบถาม |
| 🌓 **Dark Mode / Multi-language** | รองรับโหมดมืด (Dark Mode) และรองรับ 2 ภาษา (ไทย / English) |

## 🚀 Tech Stack & Architecture

- **Frontend Framework**: React 19 + Vite 8 + TailwindCSS 3
- **Mobile Native**: Capacitor 8 (Android; iOS ยังไม่มี native project ใน repository นี้)
- **Backend & Database**: Supabase (PostgreSQL 15, Realtime WebSockets, Row Level Security RLS, Edge Functions)
- **Mapping & Routing**: Leaflet, OpenStreetMap, OSRM Routing Engine
- **AI Integration**: Google Gemini ผ่าน Supabase Edge Function ที่ตรวจ session
- **Internationalization**: i18next (ไทย / English)
- **Deploy**: Vercel (Web App) + Android development artifact; Play Store release pipeline ยังอยู่ใน checklist
- **Icons & Fonts**: Lucide React + Noto Sans Thai / Inter (Google Fonts)

## 📦 Setup

### 1. Clone & Install
```bash
git clone https://github.com/RiderBoom/boomrider.git
cd boomrider
npm install
```

### 2. Run Dev
```bash
npm run dev
# คัดลอก .env.example เป็น .env และใส่ Supabase public configuration ก่อน
# เปิด http://localhost:5173
```

### 3. Build Production
```bash
npm run build
```

## ☁️ Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

หรือ connect repo กับ Vercel Dashboard — จะ deploy อัตโนมัติทุกครั้งที่ push ไป main

## 📱 Android Development Build

```bash
npm run build
npx cap sync android
npx cap open android
# Build APK จาก Android Studio
```

คำสั่งนี้สร้าง development/debug build เท่านั้น การเผยแพร่ production ต้องใช้ signed
AAB, protected signing credentials และ release checklist ใน
[`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)

## 🗺️ SEO & Web Performance

- **Structured Data**: MobileApplication, Organization, WebSite (JSON-LD)
- **Open Graph**: Facebook/LINE sharing
- **Twitter Card**: Twitter/X sharing
- **Sitemap & Robots**: `/sitemap.xml`, `/robots.txt`
- **Installable Web App**: มี Web App Manifest; offline caching ถูกปิดไว้จนกว่าจะมี cache/update strategy ที่ทดสอบแล้ว

## 📁 Project Structure

```
src/
├── App.jsx              # Entry point & Providers
├── AppShell.jsx         # Layout, Routing & Navigation
├── context/
│   ├── AppContext.jsx   # Global state (auth, orders, wallet, theme)
│   └── hooks/          # useOrderActions, useWalletActions, ...
├── views/              # CustomerView, RiderView, MerchantView, AdminView, PortfolioView, AuthView
├── components/         # InteractiveMap, AIChatModal, LiveChatModal, ...
├── constants.js        # App config, GP rates, initial data
├── i18n.js             # Internationalization config (th/en)
└── utils.js            # Helpers (distance calculation, date parsing, audio/vibration)
public/
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker
├── robots.txt          # SEO robots
└── sitemap.xml         # SEO sitemap
```

## 👥 Roles & Access Control

| Role | Access & Capabilities |
|------|------------------------|
| **Customer** (ลูกค้า) | สั่งอาหาร, เรียกรถรับส่ง, ส่งพัสดุ, เรียกบริการช่าง/ทำความสะอาด, Wallet, Profile, น้องบูม AI |
| **Merchant** (ร้านค้า) | จัดการข้อมูลร้านค้า, เพิ่ม/แก้ไขเมนู & ตัวเลือกเสริม, รับออเดอร์, ดูสรุปรายได้ |
| **Rider / Driver / Service Provider** (พาร์ทเนอร์ผู้ให้บริการ) | รับงานส่งอาหาร/พัสดุ, รับงานเรียกรถรับส่ง, รับงานบริการทั่วไป, นำทาง GPS, ถ่ายรูปหลักฐาน, สรุปรายได้/กระเป๋าเงิน |
| **Admin** (ผู้ดูแลระบบ) | Dashboard สรุปภาพรวมระบบ, อนุมัติสมาชิก/ร้านค้า/ไรเดอร์, กำหนด GP & ค่าบริการ, จัดการกระเป๋าเงิน |

## 📄 License

MIT © 2026 BoomRider Co., Ltd.

## 🔐 Security Deployment

การปรับ policy หรือ authentication ต้องทดสอบใน staging ก่อน production และห้ามรัน
`supabase_schema.sql` ทับฐานข้อมูลที่มีข้อมูลแล้ว ดูขั้นตอนและ rollback ใน
[`SECURITY_DEPLOYMENT.md`](SECURITY_DEPLOYMENT.md)

ขั้นตอนรับมือเหตุขัดข้องและการกู้คืนอยู่ใน
[`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md)
