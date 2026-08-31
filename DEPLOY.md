# คู่มือ Deploy BoomRider

## Step 1: Push ขึ้น GitHub

### ติดตั้ง GitHub CLI (ครั้งเดียว)
```bash
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

### ติดตั้ง Vercel CLI
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

### Deploy Production
```bash
! vercel --prod
```

---

## Step 3: Connect Vercel + GitHub (Auto-Deploy)

1. ไปที่ https://vercel.com/dashboard
2. Import project จาก GitHub
3. ทุกครั้งที่ push ไป main branch จะ deploy อัตโนมัติ

---

## Step 4: ตั้ง Custom Domain (ถ้ามี)

```bash
! vercel domains add boomrider.app
```

อัพเดท `sitemap.xml` และ `index.html` canonical URL ด้วย domain จริง

---

## Step 5: Deploy Supabase Edge Functions

### ติดตั้ง Supabase CLI & Login
```bash
npm install -g supabase
supabase login
```

### ลิ้งก์โปรเจกต์ Supabase
```bash
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
```

### ตั้งค่า Environment Variables (Secrets)
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set FCM_SERVER_KEY=your_fcm_server_key # (ถ้าใช้งาน Push Notification)
supabase secrets set APP_ORIGIN=https://boomrider.vercel.app
supabase secrets set CRON_SECRET=generate-a-long-random-value
supabase secrets set NOTIFICATION_WEBHOOK_SECRET=generate-a-different-long-random-value
```

### Deploy Edge Functions
```bash
supabase functions deploy process-expired-offers
supabase functions deploy send-notification
```

กำหนด `x-cron-secret` ในระบบที่เรียก `process-expired-offers` และ
`x-webhook-secret` ใน Database Webhook ที่เรียก `send-notification` ห้ามนำค่าเหล่านี้
ไปใส่ในตัวแปร `VITE_*` หรือ frontend bundle

---

## Step 6: รัน SQL Migrations

นำไฟล์ SQL ในโฟลเดอร์ `supabase/migrations/` (โดยเฉพาะ `018_edge_functions_and_cron_setup.sql`) ไปรันที่ **Supabase Dashboard → SQL Editor** เพื่อเปิดใช้งานระบบ Cron Job และ Webhooks อัตโนมัติ

