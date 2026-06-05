# 🛵 BoomRider — แอปสั่งอาหารและส่งพัสดุ

**แอปส่งอาหารและพัสดุออนไลน์** พัฒนาด้วย React + Vite + Capacitor  
*ส่งเร็ว ส่งถึง ส่งใจ — Deployed on Vercel*

[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://boomrider.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

| ฟีเจอร์ | รายละเอียด |
|---------|-----------|
| 🍔 **สั่งอาหาร** | เลือกร้าน → เพิ่มเมนู → ชำระเงิน (Wallet/เงินสด) |
| 📦 **ส่งพัสดุ** | ปักหมุดจุดรับ-ส่ง → คำนวณค่าส่ง → เรียกไรเดอร์ |
| 🛵 **ระบบไรเดอร์** | รับงาน → ถ่ายรูปหลักฐาน → รับรายได้ |
| 🏪 **ระบบร้านค้า** | จัดการเมนู → รับออเดอร์ → ดูรายได้ |
| 👑 **Admin Panel** | Dashboard, อนุมัติสมาชิก, จัดการระบบ |
| 💬 **Live Chat** | แชทระหว่าง ลูกค้า ↔ ร้านค้า ↔ ไรเดอร์ |
| 🔔 **Notifications** | แจ้งเตือนสถานะออเดอร์ real-time |
| 💳 **Wallet System** | เติมเงิน ถอนเงิน ประวัติธุรกรรม |

## 🚀 Tech Stack

- **Frontend**: React 19 + Vite 7 + TailwindCSS 3
- **Mobile**: Capacitor 8 (Android)
- **Storage**: localStorage (ไม่ต้องการ backend server)
- **Deploy**: Vercel (Web) + Play Store (Android)
- **Icons**: Lucide React
- **Fonts**: Noto Sans Thai + Inter (Google Fonts)

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

## 📱 Android Build

```bash
npm run build
npx cap sync android
npx cap open android
# Build APK จาก Android Studio
```

## 🗺️ SEO

- **Structured Data**: MobileApplication, Organization, WebSite (JSON-LD)
- **Open Graph**: Facebook/LINE sharing
- **Twitter Card**: Twitter/X sharing
- **Sitemap**: `/sitemap.xml`
- **Robots**: `/robots.txt`
- **PWA**: installable, offline support

## 📁 Project Structure

```
src/
├── App.jsx              # Entry point
├── AppShell.jsx         # Layout + routing
├── context/
│   ├── AppContext.jsx   # Global state (auth, orders, wallet)
│   └── hooks/          # useOrderActions, useWalletActions, ...
├── views/              # CustomerView, RiderView, AdminView, AuthView
├── components/         # Shared UI components
├── constants.js        # App config, initial data
└── utils.js            # Helpers (generateId, formatDateTime, ...)
public/
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker
├── robots.txt          # SEO robots
└── sitemap.xml         # SEO sitemap
```

## 👥 Roles

| Role | Access |
|------|--------|
| Customer | สั่งอาหาร, ส่งพัสดุ, Wallet, Profile |
| Merchant | จัดการร้าน, เมนู, รับออเดอร์ |
| Rider | รับงาน, นำทาง, ถ่ายรูปหลักฐาน |
| Admin | Dashboard, อนุมัติ, จัดการระบบ |

## 📄 License

MIT © 2026 BoomRider Co., Ltd.
