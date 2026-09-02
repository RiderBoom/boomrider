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
# JSON ของ Firebase service account สำหรับโปรเจกต์ BoomRider โดยเฉพาะ
# ใส่ผ่าน terminal โดยตรง ห้ามบันทึกลงไฟล์ .env หรือ repository
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
supabase secrets set APP_ORIGIN=https://boomrider.vercel.app
supabase secrets set CRON_SECRET=generate-a-long-random-value
supabase secrets set NOTIFICATION_WEBHOOK_SECRET=generate-a-different-long-random-value
supabase secrets set GEMINI_API_KEY=your-server-side-gemini-key
# Optional: pin a tested model instead of using the function default
supabase secrets set GEMINI_MODEL=gemini-1.5-flash
```

### Deploy Edge Functions
```bash
supabase functions deploy process-expired-offers
supabase functions deploy send-notification
supabase functions deploy ai-chat
```

กำหนด `x-cron-secret` ในระบบที่เรียก `process-expired-offers` และ
`x-webhook-secret` ใน Database Webhook ที่เรียก `send-notification` ห้ามนำค่าเหล่านี้
ไปใส่ในตัวแปร `VITE_*` หรือ frontend bundle

สร้าง Database Webhook สำหรับเหตุการณ์ต่อไปนี้ โดยชี้ไปที่
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-notification`:

- `job_offers`: `INSERT`
- `orders`: `INSERT`, `UPDATE`
- `admin_notifs`: `INSERT`

ทุก webhook ต้องส่ง `x-webhook-secret` ให้ตรงกับ `NOTIFICATION_WEBHOOK_SECRET`
และ Authorization header สำหรับ Edge Function ห้ามส่ง service-role key ไปยัง client

สำหรับ Android ให้สร้าง Firebase app package `com.boomrider.app` แล้วเก็บ
`google-services.json` เป็น GitHub Actions secret ชื่อ `GOOGLE_SERVICES_JSON_BASE64`
โดย base64 encode ไฟล์ทั้งก้อน ไฟล์จริงถูก `.gitignore` และห้าม commit

หลัง deploy `ai-chat` แล้ว ให้ยืนยันว่า user ที่ login เรียกได้, request ที่ไม่มี JWT
ได้ 401 และ browser bundle ไม่มี Google API key จากนั้นหมุนเวียน Gemini key เดิมที่เคย
ถูกส่งไป frontend และตั้ง API/quota restrictions ใน Google Cloud Console

---

## Step 6: Deploy SQL migrations

สำหรับฐานข้อมูลที่มีข้อมูลจริง ห้ามคัดลอก SQL ทั้งชุดหรือรัน `supabase_schema.sql`
ผ่าน SQL Editor ให้ตรวจ migration history, backup และ staging ตาม
[`SECURITY_DEPLOYMENT.md`](SECURITY_DEPLOYMENT.md) แล้ว deploy เฉพาะ forward migrations
ใหม่ด้วย Supabase CLI จาก trusted environment:

```bash
supabase migration list
supabase db push --dry-run
supabase db push
```

ตรวจรายการจาก `--dry-run` ก่อนทุกครั้ง และหยุดทันทีถ้าประวัติ migration ของ remote
ไม่ตรงกับ repository

---

## Step 7: Production verification

1. ตรวจ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` ใน deployment environment
2. รัน `npm ci && npm run lint && npm test && npm run security:check && npm run build`
3. ทดสอบ login, order, wallet, dispatch, settlement และ AI ด้วย test accounts
4. ตรวจ error logs โดยห้ามบันทึก token, พิกัดละเอียด หรือข้อมูลส่วนบุคคล
5. ตรวจ checklist และ rollback ใน [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)

