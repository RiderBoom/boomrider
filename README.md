# 🛵 BoomRider — แอปสั่งอาหารและส่งพัสดุ

**แอปส่งอาหารและพัสดุออนไลน์ระดับโลก** พัฒนาด้วย React + Vite + Capacitor  
*ส่งเร็ว ส่งถึง ส่งใจ — Powered by Firebase & Deployed on Vercel*

[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://boomrider.vercel.app)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-orange?logo=firebase)](https://firebase.google.com)
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
| 🔔 **Push Notifications** | แจ้งเตือนสถานะออเดอร์ real-time |
| 💳 **Wallet System** | เติมเงิน ถอนเงิน ประวัติธุรกรรม |

## 🚀 Tech Stack

- **Frontend**: React 19 + Vite 7 + TailwindCSS 3
- **Mobile**: Capacitor 8 (Android)
- **Backend**: Firebase (Auth, Storage, Cloud Messaging)
- **Deploy**: Vercel (Web) + Play Store (Android)
- **Icons**: Lucide React
- **Fonts**: Noto Sans Thai + Inter (Google Fonts)

## 📦 Setup

### 1. Clone & Install
```bash
git clone https://github.com/boomrider/boomrider-app.git
cd boomrider-app
npm install
```

### 2. Firebase Config
```bash
cp .env.example .env.local
# แก้ไข .env.local ใส่ค่าจาก Firebase Console
```

ค่าที่ต้องใส่ใน `.env.local`:
```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
VITE_FIREBASE_VAPID_KEY=BH...
```

### 3. Run Dev
```bash
npm run dev
# เปิด http://localhost:5173
```

### 4. Build Production
```bash
npm run build
```

## 🔥 Firebase Setup

### Authentication
1. Firebase Console → Authentication → Sign-in method
2. เปิดใช้: **Email/Password** + **Google** + **Phone**

### Storage Rules
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth.uid == userId;
    }
    match /kyc/{userId}/{allPaths=**} {
      allow read, write: if request.auth.uid == userId;
    }
    match /orders/{orderId}/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
    match /menus/{shopId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

### Cloud Messaging
1. Firebase Console → Cloud Messaging → Web Push certificates
2. สร้าง key pair → คัดลอก VAPID key → ใส่ใน `VITE_FIREBASE_VAPID_KEY`

## ☁️ Deploy to Vercel

```bash
# ติดตั้ง Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables บน Vercel Dashboard หรือ:
vercel env add VITE_FIREBASE_API_KEY
# (ทำซ้ำสำหรับทุก VITE_ variable)
```

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
├── App.jsx              # Main app (components + logic)
├── App.css              # Component styles
├── index.css            # Global styles + animations
├── main.jsx             # Entry + Service Worker registration
└── firebase/
    ├── config.js        # Firebase init
    ├── auth.js          # Authentication helpers
    ├── storage.js       # File upload helpers
    └── messaging.js     # Push notification helpers
public/
├── manifest.json        # PWA manifest
├── sw.js                # Service Worker
├── firebase-messaging-sw.js  # FCM background handler
├── robots.txt           # SEO robots
└── sitemap.xml          # SEO sitemap
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
