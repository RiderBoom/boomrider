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
