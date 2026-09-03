# 🔔 คู่มือการตั้งค่าจริง FCM Push Notifications (Production Setup Guide)

คู่มือนี้แนะนำขั้นตอนการตั้งค่าระบบ **Firebase Cloud Messaging (FCM) Push Notifications** สำหรับระบบ **BoomRider** เพื่อให้รองรับการแจ้งเตือนแบบเรียลไทม์บนอุปกรณ์ขณะเปิดแอป ปิดแอป หรือล็อกหน้าจอ (Background / Lock Screen)

---

## 1. การสร้าง Service Account Key สำหรับ FCM (Firebase Console)

1. เข้าไปที่ [Firebase Console](https://console.firebase.google.com/) และเลือกโปรเจคของ BoomRider
2. ไปที่ **Project Settings** (ไอคอนรูปฟันเฟือง ⚙️ ด้านซ้ายบน) ➔ เลือกแท็บ **Service accounts**
3. ตรวจสอบว่าได้เลือก **Node.js** หรือ **Firebase Admin SDK**
4. คลิกปุ่ม **Generate new private key** ➔ ยืนยันในป๊อปอัปเพื่อดาวน์โหลดไฟล์ `.json`
5. ไฟล์ที่ดาวน์โหลดมาจะมีโครงสร้างดังนี้:
   ```json
   {
     "type": "service_account",
     "project_id": "your-firebase-project-id",
     "private_key_id": "...",
     "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n",
     "client_email": "firebase-adminsdk-xxxxx@your-firebase-project-id.iam.gserviceaccount.com",
     "client_id": "...",
     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
     "token_uri": "https://oauth2.googleapis.com/token",
     "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
     "client_x509_cert_url": "..."
   }
   ```

---

## 2. การเก็บค่า Secrets ใน Supabase และ GitHub Secrets

### A. เก็บค่าใน Supabase Edge Functions Secrets
Edge Function `send-notification` ต้องการ Environment Variables สำคัญ 2 ค่า:
1. **`FIREBASE_SERVICE_ACCOUNT_JSON`**: คัดลอกข้อความในไฟล์ `.json` ทั้งหมด (หรือทำการ Encode เป็น Base64)
2. **`NOTIFICATION_WEBHOOK_SECRET`**: รหัส Secret สุ่มสำหรับยืนยันความถูกต้องของ Webhook (เช่น `br_whsec_98f7a6b5c4321`)

**คำสั่งตั้งค่าผ่าน Supabase CLI:**
```bash
# ตั้งค่า Firebase Service Account JSON (ใส่ string json สองอัญประกาศแบบระวัง newlines)
npx supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"project_id":"...","client_email":"...","private_key":"..."}'

# ตั้งค่า Webhook Secret
npx supabase secrets set NOTIFICATION_WEBHOOK_SECRET="your_secure_webhook_secret_here"
```
*(หรือเข้าไปตั้งค่าที่ Supabase Dashboard ➔ Project Settings ➔ Edge Functions ➔ Secrets)*

### B. เก็บค่าใน GitHub Secrets (สำหรับ CI/CD)
หากรัน Build APK ผ่าน GitHub Actions ให้เปิด Repo ➔ **Settings** ➔ **Secrets and variables** ➔ **Actions** ➔ **New repository secret**:
- เพิ่ม `FIREBASE_SERVICE_ACCOUNT_JSON`
- เพิ่ม `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. การ Deploy Supabase Edge Function (`send-notification`)

1. ติดตั้ง Supabase CLI และ Login:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-supabase-project-id>
   ```
2. Deploy Edge Function ไปยัง Supabase Cloud:
   ```bash
   npx supabase functions deploy send-notification --no-verify-jwt
   ```
   *(หมายเหตุ: ใช้ `--no-verify-jwt` เพื่อให้ Database Webhook สามารถส่ง Request ผ่าน `x-webhook-secret` header ได้โดยตรง)*

---

## 4. การตั้งค่า Supabase Database Webhooks

เข้าไปที่ **Supabase Dashboard** ➔ **Database** ➔ **Webhooks** ➔ **Create a new webhook**:

### Webhook 1: สำหรับแจ้งเตือนออเดอร์ใหม่และอัปเดตสถานะ (`orders`)
- **Name**: `send-order-notifications`
- **Table**: `public.orders`
- **Events**: `INSERT`, `UPDATE`
- **Type**: `HTTP Request`
- **Method**: `POST`
- **URL**: `https://<your-project-ref>.supabase.co/functions/v1/send-notification`
- **HTTP Headers**:
  - `Content-Type`: `application/json`
  - `x-webhook-secret`: `<ค่า NOTIFICATION_WEBHOOK_SECRET ที่ตั้งไว้>`

### Webhook 2: สำหรับแจ้งเตือนไรเดอร์เมื่อมีงานใหม่เข้า (`job_offers`)
- **Name**: `send-job-offer-notifications`
- **Table**: `public.job_offers`
- **Events**: `INSERT`
- **Type**: `HTTP Request`
- **Method**: `POST`
- **URL**: `https://<your-project-ref>.supabase.co/functions/v1/send-notification`
- **HTTP Headers**:
  - `Content-Type`: `application/json`
  - `x-webhook-secret`: `<ค่า NOTIFICATION_WEBHOOK_SECRET ที่ตั้งไว้>`

### Webhook 3: สำหรับแจ้งเตือนผู้ดูแลระบบเมื่อมี Admin Notification (`admin_notifs`)
- **Name**: `send-admin-notifications`
- **Table**: `public.admin_notifs`
- **Events**: `INSERT`
- **Type**: `HTTP Request`
- **Method**: `POST`
- **URL**: `https://<your-project-ref>.supabase.co/functions/v1/send-notification`
- **HTTP Headers**:
  - `Content-Type`: `application/json`
  - `x-webhook-secret`: `<ค่า NOTIFICATION_WEBHOOK_SECRET ที่ตั้งไว้>`

---

## 5. วิธีการทดสอบการแจ้งเตือนตอนล็อกหน้าจอ (Lock Screen Test)

### A. การทดสอบบน Android Native App (Capacitor APK)
1. Build Signed/Debug APK และติดตั้งบนเครื่องจริง ( Physical Device )
2. เปิดแอป และอนุญาตสิทธิ์การแจ้งเตือน (Notification Permission) เมื่อระบบร้องขอ
3. เข้าสู่ระบบด้วยบัญชี Rider หรือ Customer เพื่อให้แอปบันทึก FCM Token ลงในตาราง `push_devices`
4. **กดปุ่ม Home ออกจากแอป หรือกดปุ่ม Power เพื่อล็อกหน้าจอ**
5. ใช้บัญชีอื่นสร้างออเดอร์ใหม่ หรือ ยิง cURL ทดสอบไปยัง Edge Function โดยตรง:
   ```bash
   curl -X POST 'https://<your-project-ref>.supabase.co/functions/v1/send-notification' \
     -H 'Content-Type: application/json' \
     -H 'x-webhook-secret: <your_secure_webhook_secret_here>' \
     -d '{
       "type": "INSERT",
       "table": "job_offers",
       "record": {
         "id": "test-offer-1",
         "order_id": "test-order-123456",
         "rider_user_id": "<your-rider-user-uuid>"
       }
     }'
   ```
6. **ผลลัพธ์ที่คาดหวัง**: บนหน้าจอล็อก (Lock Screen) จะมี Heads-up Notification เด้งขึ้นมาพร้อมเสียงและระบบสั่น:
   > 🛵 **งานใหม่เข้ามา!**
   > คุณมีออเดอร์ใหม่ #123456 รอรับงาน

### B. การตรวจสอบ Logs และ Troubleshooting
- หากไม่ได้รับแจ้งเตือน ให้ตรวจสอบ Logs ของ Edge Function ที่ **Supabase Dashboard** ➔ **Edge Functions** ➔ `send-notification` ➔ **Logs**
- ตรวจสอบสถานะการส่งในตาราง `notification_deliveries` ใน Database
- ตรวจสอบว่า FCM Token ของเครื่องลงทะเบียนในตาราง `push_devices` และมี `enabled = true`
