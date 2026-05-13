# 🚀 คู่มือ Deploy BoomRider

## Step 1: Push ขึ้น GitHub

### ติดตั้ง GitHub CLI (ครั้งเดียว)
```bash
# Windows — รันใน Claude Code ด้วย ! prefix
! winget install --id GitHub.cli
```

### Login GitHub
```bash
! gh auth login
# เลือก GitHub.com > HTTPS > Login with browser
```

### สร้าง repo และ push
```bash
! gh repo create boomrider --public --push --source=.
```

หรือถ้า repo มีอยู่แล้ว:
```bash
! git remote add origin https://github.com/YOUR_USERNAME/boomrider.git
! git branch -M main
! git push -u origin main
```

---

## Step 2: Deploy บน Vercel

### ติดตั้ง Vercel CLI (ติดตั้งแล้ว)
```bash
! vercel login
# Login ด้วย GitHub account
```

### Deploy ครั้งแรก
```bash
! vercel --yes
# Framework: Vite
# Output directory: dist
```

### Set Environment Variables บน Vercel
```bash
! vercel env add VITE_FIREBASE_API_KEY production
! vercel env add VITE_FIREBASE_AUTH_DOMAIN production
! vercel env add VITE_FIREBASE_PROJECT_ID production
! vercel env add VITE_FIREBASE_STORAGE_BUCKET production
! vercel env add VITE_FIREBASE_MESSAGING_SENDER_ID production
! vercel env add VITE_FIREBASE_APP_ID production
! vercel env add VITE_FIREBASE_MEASUREMENT_ID production
! vercel env add VITE_FIREBASE_VAPID_KEY production
```

### Deploy Production
```bash
! vercel --prod
```

---

## Step 3: Firebase Setup

### 1. สร้าง Firebase Project
- ไปที่ https://console.firebase.google.com
- สร้าง project ใหม่ชื่อ "boomrider"

### 2. เปิดใช้ Authentication
- Authentication → Sign-in method
- เปิด: Email/Password ✅
- เปิด: Google ✅  
- เปิด: Phone ✅

### 3. สร้าง Storage Bucket
- Storage → Get started
- เลือก region ใกล้ที่สุด (asia-southeast1 = Singapore)

### 4. เปิดใช้ Cloud Messaging
- Project Settings → Cloud Messaging
- Generate Web Push key pair
- คัดลอก VAPID Key

### 5. คัดลอก Firebase Config
- Project Settings → Your apps → Add app (Web)
- คัดลอก firebaseConfig และใส่ใน .env.local

---

## Step 4: Connect Vercel + GitHub (Auto-Deploy)

1. ไปที่ https://vercel.com/dashboard
2. Import project จาก GitHub
3. ตั้งค่า Environment Variables
4. ทุกครั้งที่ push ไป main branch จะ deploy อัตโนมัติ

---

## Step 5: ตั้ง Custom Domain (ถ้ามี)

```bash
! vercel domains add boomrider.app
```

อัพเดท `sitemap.xml` และ `index.html` canonical URL ด้วย domain จริง

---

## Firebase Security Rules

### Storage Rules
ไปที่ Firebase Console → Storage → Rules และ paste:

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
    match /slips/{userId}/{allPaths=**} {
      allow read, write: if request.auth.uid == userId;
    }
    match /orders/{orderId}/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
    match /menus/{shopId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /shops/{shopId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```
