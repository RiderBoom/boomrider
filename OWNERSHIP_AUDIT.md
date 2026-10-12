# 📑 รายงานการตรวจสอบกรรมสิทธิ์ซอฟต์แวร์และความถูกต้องของ LICENSE (Software Ownership & Licensing Audit Report)

**โครงการ**: Boom Rider — Enterprise On-Demand Super App Platform
**วันที่ตรวจสอบ**: 12 ตุลาคม 2026
**ผู้ทำการตรวจสอบ**: Jules (Software Engineering & IP Security Audit)
**ผู้ถือสิทธิ์ตั้งต้น**: นายวิศิษชัย บุญแร่ (Wisitchai Bunrae / RiderBoom)

---

## 1. บทสรุปผู้บริหาร (Executive Summary)

จากการตรวจสอบกรรมสิทธิ์ซอฟต์แวร์ ประวัติการพัฒนาใน Git history โครงสร้างการอนุญาตใช้สิทธิ์ (Licensing) ของโมดูลภายนอก (Third-party dependencies) และเงื่อนไขทางกฎหมายสำหรับโครงการ Boom Rider พบว่า:

1. **ผู้สร้างสรรค์หลัก (Sole Creator)**: นายวิศิษชัย บุญแร่ (Wisitchai Bunrae / RiderBoom) เป็นผู้สร้างสรรค์และออกแบบสถาปัตยกรรมระบบแต่เพียงผู้เดียว โดยมีหลักฐานเชิงประวัติศาสตร์ดิจิทัล (Git Commits) รองรับ 100%
2. **ข้อผิดพลาดทางนิติฐานะ (Legal Entity Mismatch)**: ไฟล์ `LICENSE` ในปัจจุบันระบุ `Copyright (c) 2026 BoomRider Co., Ltd.` ทั้งที่ธุรกิจปัจจุบันยังดำเนินงานในนาม **"บุคคลธรรมดา"** และบริษัทยังไม่ได้จดทะเบียนจัดตั้งอย่างเป็นทางการ ส่งผลให้เกิดความเสี่ยงเรื่องความสมบูรณ์ทางกฎหมายของการอ้างสิทธิ์
3. **ความเสี่ยงจาก MIT License ต่อโมเดลพาณิชย์**: การระบุใช้ MIT License บน Repository เปิดเผย (Public Repository) อนุญาตให้บุคคลภายนอกนำซอฟต์แวร์ไปคัดลอก แก้ไข ขาย หรือทำ White-label แข่งขันได้โดยไม่ต้องจ่ายค่าธรรมเนียม ซึ่งขัดแย้งกับแผนการขายระบบในรูปแบบ Whitelabel (250,000 – 450,000 บาท) หรือ SaaS (9,900 – 19,900 บาท/เดือน) ตามที่ระบุใน `PORTFOLIO.md`
4. **ความถูกต้องของ Third-party Dependencies**: ไม่พบโมดูลภายนอกที่ใช้สัญญาอนุญาตแบบ Copyleft เข้มงวด (เช่น GPL / AGPL) หรือสัญญาที่ห้ามใช้เชิงพาณิชย์ (Non-Commercial) ทุกไลบรารีใช้สิทธิ์แบบ Permissive (MIT, Apache-2.0, BSD-2-Clause, ISC) ซึ่งปลอดภัยต่อการนำไปประกอบธุรกิจและขายต่อเชิงพาณิชย์

---

## 2. การตรวจสอบข้อเท็จจริงและหลักฐาน (Facts & Evidence Audit)

### 2.1 ประวัติการพัฒนาและผู้ถือสิทธิ์ (Git Audit & Provenance)

จากการตรวจสอบ Git Repository History ด้วยคำสั่งวิเคราะห์ Commit Graph และ Author Metadata:

| รายการตรวจสอบ | ข้อมูลที่พบในระบบ | การประเมินสถานะ |
| :--- | :--- | :--- |
| **ผู้สร้าง/ผู้พัฒนารายบุคคล** | นายวิศิษชัย บุญแร่ (`RiderBoom`) | ✅ ยืนยันตัวตนผู้สร้างหลัก (Sole Author) |
| **อีเมลที่ใช้อนุมัติ Commits** | `104240228+RiderBoom@users.noreply.github.com` | ✅ เป็นบัญชี GitHub ทางการของผู้ก่อตั้ง |
| **สัดส่วน Commits** | 100% ของ Commits ดำเนินการโดย `RiderBoom` | ✅ ไม่พบผู้ร่วมพัฒนาภายนอก (No external contributors) |
| **การใช้ AI Assistance** | `Co-authored-by: google-labs-jules[bot]` | ℹ️ เป็นเครื่องมือช่วยเขียนโค้ด สิทธิ์ในผลงานตกเป็นของผู้สั่งการ (มนุษย์) |
| **ข้อความ Copyright ใน LICENSE** | `Copyright (c) 2026 BoomRider Co., Ltd.` | ⚠️ **ข้อผิดพลาด**: อ้างสิทธิ์นิติบุคคลที่ยังไม่มีตัวตนทางกฎหมาย |
| **ข้อมูลในเอกสารประกอบ** | `README.md` และ `PORTFOLIO.md` ระบุ Wisitchai Bunrae เป็น Founder & CEO | ✅ ตรงกับข้อเท็จจริงการดำเนินงานในนามบุคคลธรรมดา |

### 2.2 การตรวจสอบโมดูลภายนอก (Third-Party Dependencies & Licenses)

จากการตรวจสอบ package dependencies ทั้งหมด 27 รายการใน `package.json` และ `node_modules`:

#### Production Dependencies (10 รายการ)
1. `@capacitor/push-notifications` (`^8.1.3`) — **MIT**
2. `@supabase/supabase-js` (`^2.117.2`) — **MIT**
3. `i18next` (`^26.4.2`) — **MIT**
4. `leaflet` (`^1.9.4`) — **BSD-2-Clause**
5. `lucide-react` (`^1.51.0`) — **ISC**
6. `promptpay-qr` (`^0.5.0`) — **MIT**
7. `qrcode` (`^1.5.4`) — **MIT**
8. `react` (`^19.3.0`) — **MIT**
9. `react-dom` (`^19.3.0`) — **MIT**
10. `react-i18next` (`^17.0.15`) — **MIT**

#### Development Dependencies (17 รายการ)
- `@capacitor/android`, `@capacitor/cli`, `@capacitor/core`: **MIT**
- `@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`: **MIT**
- `@playwright/test`: **Apache-2.0**
- `@types/react`, `@types/react-dom`: **MIT**
- `@vitejs/plugin-react`, `vite`: **MIT**
- `autoprefixer`, `postcss`, `tailwindcss`: **MIT**
- `globals`: **MIT**
- `sharp`: **Apache-2.0**

#### บริการภายนอกและแผนที่ (Mapping & External Services)
- **OpenStreetMap Data**: สัญญาอนุญาต **ODbL (Open Database License)** — *ต้องแสดงเครดิต "© OpenStreetMap contributors" ในหน้าแผนที่ ( InteractiveMap.jsx มีการใช้งานแผนที่ OSM)*
- **OSRM Routing Engine**: **BSD-2-Clause** — *อนุญาตใช้งานเชิงพาณิชย์ได้*

**สรุปผล Third-party Audit**: ผ่านเกณฑ์ความปลอดภัย 100% ไม่ติดเงื่อนไข GPL/AGPL ไร้ข้อจำกัดเชิงพาณิชย์

---

## 3. การวิเคราะห์ความเสี่ยงทางกฎหมาย (Legal Risk Analysis)

### ความเสี่ยงที่ 1: นิติฐานะที่ไม่ตรงกับความจริง (Legal Entity Mismatch Risk) — *ระดับความเสี่ยง: สูง*
- **คำอธิบาย**: กฎหมายลิขสิทธิ์ไทย (พ.ร.บ. ลิขสิทธิ์ พ.ศ. 2537 และที่แก้ไขเพิ่มเติม) ระบุว่า ลิขสิทธิ์ย่อมเกิดขึ้นทันทีเมื่อผู้สร้างสรรค์ (มนุษย์) ได้สร้างสรรค์ผลงาน การระบุว่า `BoomRider Co., Ltd.` เป็นผู้ถือสิทธิ์ ในขณะที่บริษัทยังไม่ได้จดทะเบียนจัดตั้ง นิติบุคคลดังกล่าวจึงยังไม่มีสภาพบุคคลตามกฎหมายแพ่งและพาณิชย์ (ยังไม่มีสิทธิและหน้าที่)
- **ผลกระทบ**: หากนำเอกสารไปยื่นแจ้งข้อมูลลิขสิทธิ์ต่อกรมทรัพย์สินทางปัญญา (DIP) หรือใช้ฟ้องร้องละเมิดลิขสิทธิ์ คู่กรณีอาจยกข้อต่อสู้เรื่อง "ผู้ฟ้องไม่มีอำนาจฟ้อง" หรือ "เอกสารอ้างสิทธิ์เป็นเท็จ" ได้

### ความเสี่ยงที่ 2: การรั่วไหลของกรรมสิทธิ์เชิงพาณิชย์ผ่าน MIT License — *ระดับความเสี่ยง: สูง*
- **คำอธิบาย**: MIT License เป็นสัญญาอนุญาตแบบเปิดกว้าง (Permissive Open Source) ที่ให้สิทธิ์แก่ **"บุคคลใดก็ตามที่ได้รับสำเนาซอฟต์แวร์"** ในการนำไป ทำซ้ำ ดัดแปลง แจกจ่าย อนุญาตใช้สิทธิ์ย่อย (Sublicense) หรือ **"ขาย" (Sell)** ได้โดยไม่มีเงื่อนไขต้องจ่ายค่าตอบแทน
- **ผลกระทบ**:
  - หาก Codebase อยู่ใน Public Repository ภายใต้ MIT License ลูกค้าหรือคู่แข่งสามารถ Clone โค้ดไปใช้งาน ขายต่อ หรือทำแบรนด์แข่งได้โดยไม่ละเมิดกฎหมาย
  - ทำให้โมเดลการขาย Whitelabel Customization (250,000 – 450,000 บาท) สูญเสียมูลค่าทางธุรกิจ เพราะผู้ซื้อสามารถอ้างสิทธิ์ใช้งานฟรีภายใต้ MIT License ได้

### ความเสี่ยงที่ 3: ข้อกำหนดการแสดงเครดิต OpenStreetMap (Attribution Compliance) — *ระดับความเสี่ยง: ต่ำ*
- **คำอธิบาย**: การใช้ข้อมูลแผนที่จาก OpenStreetMap ภายใต้ ODbL จำเป็นต้องคงข้อความ Attribution ไว้ในหน้า UI แผนที่
- **ผลกระทบ**: หากลบข้อความ Attribution ออก อาจถูกแจ้งเตือนละเมิดเงื่อนไข ODbL จาก OpenStreetMap Foundation

---

## 4. ผลกระทบของ MIT License ต่อการขายและการสงวนสิทธิ์ซอฟต์แวร์

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MIT License Impact Matrix                             │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ สิทธิ์ที่ MIT อนุญาต      │ - นำไปใช้ ทำซ้ำ ดัดแปลง แจกจ่าย ขาย ได้เสรี    │
│                          │ - ทำเป็น Closed Source รวมในซอฟต์แวร์อื่นได้     │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ ผลกระทบต่อการขาย         │ - ไม่สามารถจำกัดการใช้งานของผู้นำโค้ดไปใช้ได้   │
│                          │ - ไม่สามารถเรียกเก็บ Royalty Fee จากผู้นำไปใช้ได้ │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ สิทธิ์ที่เจ้าของเดิมยังเหลือ│ - ยังคงเป็นผู้สร้างสรรค์ (Author)                 │
│                          │ - ยังสามารถนำโค้ดไปขายหรือทำ Commercial ได้       │
│                          │   (แต่คนอื่นก็ทำได้เช่นกัน หากได้โค้ดไป)         │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

### ข้อแนะนำทางกลยุทธ์การอนุญาตใช้สิทธิ์ (Licensing Strategy Recommendation)

1. **สำหรับการดำเนินงานพาณิชย์ (Commercial / Proprietary Model)**:
   - เปลี่ยน Repository ให้เป็น **Private Repository**
   - ใช้สัญญาอนุญาตแบบ **Proprietary / Commercial License** สำหรับซอฟต์แวร์หลัก (Core Super App Platform)
   - สงวนสิทธิ์ทั้งหมด (All Rights Reserved) โดยมอบสิทธิ์ใช้งาน (License Agreement) ให้ลูกค้า Whitelabel เป็นรายๆ ไป (End-User License Agreement - EULA)
2. **หากต้องการคงส่วนที่เป็น Open Source**:
   - ใช้รูปแบบ **Dual-Licensing** โดยแยก Open Source SDK / Components (เช่น UI Components) ให้ใช้ MIT License แต่ Core Business Logic / Supabase Schema / Edge Functions เป็น Proprietary License

---

## 5. รูปแบบ Copyright Notice และนโยบายสิทธิ์ที่เหมาะสมสำหรับบุคคลธรรมดา

เพื่อให้สอดคล้องกับสถานะปัจจุบันที่ดำเนินงานในนาม **บุคคลธรรมดา** และเตรียมพร้อมสำหรับการโอนสิทธิ์ให้บริษัทในอนาคต ขอเสนอรูปแบบ Copyright Notice และนโยบายสิทธิ์ดังนี้:

### 5.1 รูปแบบ Copyright Notice สำหรับบุคคลธรรมดา (แนะนำให้ใช้ปัจจุบัน)

#### แบบสงวนสิทธิ์ทั้งหมด (สำหรับการขายเชิงพาณิชย์ / Private Repository)
```text
Copyright (c) 2026 Wisitchai Bunrae. All rights reserved.

This software and associated documentation files (the "Software") are the proprietary
property of Wisitchai Bunrae. Unauthorized copying, modification, distribution,
or commercial deployment of this software, via any medium, is strictly prohibited.
```

#### แบบ Open Source (หากต้องการเผยแพร่สาธารณะบางส่วน)
```text
Copyright (c) 2026 Wisitchai Bunrae <Wisitchai.Bunrae@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy...
```

### 5.2 ข้อความแจ้ง Attribution และเครื่องหมายการค้า (Trademarks & Attribution Notice)

```text
"Boom Rider", "BoomRider", "RiderBoom", และโลโก้สัญลักษณ์ที่เกี่ยวข้อง เป็นเครื่องหมายการค้าและเครื่องหมายบริการของ นายวิศิษชัย บุญแร่
ข้อมูลแผนที่และเส้นทางนำทาง บริการโดย © OpenStreetMap contributors ภายใต้ข้อตกลง Open Database License (ODbL)
```

---

## 6. แผนโรดแมปการยื่นจดแจ้งทรัพย์สินทางปัญญาและการโอนสิทธิ์ (IP Assignment Roadmap)

```
[ขั้นตอนที่ 1]                       [ขั้นตอนที่ 2]                      [ขั้นตอนที่ 3]                          [ขั้นตอนที่ 4]
ยื่นจดแจ้งลิขสิทธิ์ (DIP) ─────────► จดทะเบียนจัดตั้งบริษัท ─────────► ทำสัญญาโอนสิทธิ์ (IP Assignment) ────────► อัปเดต Copyright Notice
ในนาม นายวิศิษชัย บุญแร่             บริษัท บูมไรเดอร์ จำกัด            นายวิศิษชัย -> BoomRider Co., Ltd.        เป็น BoomRider Co., Ltd.
```

### รายละเอียดขั้นตอนในโรดแมป:

#### ขั้นตอนที่ 1: การยื่นแจ้งข้อมูลลิขสิทธิ์ต่อกรมทรัพย์สินทางปัญญา (DIP)
- **ผู้ยื่น**: นายวิศิษชัย บุญแร่ (ในฐานะผู้สร้างสรรค์ประเภทงานวรรณกรรม / โปรแกรมคอมพิวเตอร์)
- **เอกสารที่ต้องใช้**:
  1. แบบแจ้งข้อมูลลิขสิทธิ์ (ลข. 01)
  2. สำเนาบัตรประชาชน นายวิศิษชัย บุญแร่
  3. ตัวอย่างผลงานโปรแกรมคอมพิวเตอร์ (Source Code หน้าแรก-หน้าสุดท้าย หรือเอกสารสถาปัตยกรรมระบบ)
  4. เอกสารแสดงประวัติการสร้างสรรค์ (Git Log Summary & Repository Metadata)

#### ขั้นตอนที่ 2: การจดทะเบียนจัดตั้งบริษัท
- ดำเนินการจดทะเบียนนิติบุคคลในชื่อ **บริษัท บูมไรเดอร์ จำกัด (BoomRider Co., Ltd.)** ต่อกรมพัฒนาธุรกิจการค้า กระทรวงพาณิชย์

#### ขั้นตอนที่ 3: การทำสัญญาโอนกรรมสิทธิ์ในทรัพย์สินทางปัญญา (IP Assignment Agreement)
- จัดทำ **"สัญญาโอนกรรมสิทธิ์ในลิขสิทธิ์และทรัพย์สินทางปัญญา" (Intellectual Property Assignment Agreement)**
- **ผู้โอน (Assignor)**: นายวิศิษชัย บุญแร่
- **ผู้รับโอน (Assignee)**: บริษัท บูมไรเดอร์ จำกัด (โดยกรรมการผู้มีอำนาจ)
- **สาระสำคัญของสัญญา**:
  - โอนกรรมสิทธิ์ในโปรแกรมคอมพิวเตอร์ BoomRider ทั้งหมด (Source Code, Database Schema, Design, Trademarks, Domain Names) เข้าเป็นทรัพย์สินของบริษัท
  - ครอบคลุมการโอนสิทธิ์ในการฟ้องร้องดำเนินคดี การอนุญาตให้ใช้สิทธิ์ (Licensing) และการหารายได้เชิงพาณิชย์ทั้งหมด

#### ขั้นตอนที่ 4: การปรับเปลี่ยน Copyright Notice และบันทึกในเอกสารระบบ
- เมื่อทำสัญญาโอนสิทธิ์เรียบร้อยแล้ว จึงทำการอัปเดตไฟล์ `LICENSE` และ Header Notice ทั้งหมดเป็น:
  `Copyright (c) 2026 BoomRider Co., Ltd. All rights reserved.`
- แจ้งแก้ไขผู้ถือสิทธิ์ในหนังสือรับรองการแจ้งข้อมูลลิขสิทธิ์ต่อกรมทรัพย์สินทางปัญญา (ถ้ามี)

---

## 7. สรุปข้อปฏิบัติตามข้อบังคับโครงการ (Compliance & Constraint Adherence)

ในการดำเนินงาน audit ครั้งนี้ ได้ปฏิบัติตามข้อห้ามในคำสั่งอย่างเคร่งครัดดังนี้:

1. ❌ **ไม่มีการแก้ไขไฟล์ `LICENSE`** ใน Repository
2. ❌ **ไม่มีการลบหรือดัดแปลงประวัติ Git (Git history)**
3. ❌ **ไม่มีการเปลี่ยนสิทธิ์ Repository** (Keep current permissions)
4. ❌ **ไม่มีการ Deploy ระบบจริง** (No live deployment triggered)
5. ✅ จัดทำเอกสาร `OWNERSHIP_AUDIT.md` เพื่อใช้เป็นหลักฐานอ้างอิงและประกอบการอนุมัติของผู้ก่อตั้ง

---

*รายงานนี้จัดทำขึ้นเพื่อใช้เป็นหลักฐานอ้างอิงทางกฎหมายและเทคนิคสำหรับโครงการ Boom Rider*
