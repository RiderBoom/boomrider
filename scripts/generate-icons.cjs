/**
 * สร้างไอคอน BoomRider จาก SVG → PNG ทุกขนาด (ใช้ sharp)
 * รัน: node scripts/generate-icons.cjs
 */
const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

const DIR = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(DIR, { recursive: true });

// ── SVG โลโก้ BoomRider (เหมือนหน้าเว็บ: gradient ส้ม + มอเตอร์ไซค์ + ข้อความ) ──
function makeSVG(size) {
  const r = Math.round(size * 0.20);   // ความโค้งมุม (เหมือน app icon ทั่วไป)
  const scale = size / 512;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#fb923c"/>
      <stop offset="100%" stop-color="#c2410c"/>
    </linearGradient>
  </defs>

  <!-- พื้นหลัง gradient ส้ม -->
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>

  <!-- กลุ่ม content: scale ตามขนาด icon -->
  <g transform="scale(${scale})">

    <!-- มอเตอร์ไซค์ (Lucide Bike icon ดัดแปลง, centered at 256,195) -->
    <g transform="translate(256,192) scale(9.5)"
       fill="none" stroke="white" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round">
      <!-- ล้อหลัง -->
      <circle cx="-7" cy="6"  r="5"/>
      <!-- ล้อหน้า -->
      <circle cx="7"  cy="6"  r="5"/>
      <!-- โครง body -->
      <path d="M-7,6 L-1,-3 L4,-3"/>
      <path d="M 0,0 L7,6"/>
      <path d="M-1,-3 L1,2 L7,6"/>
      <!-- แฮนด์เดิ้ล -->
      <path d="M4,-3 L6,-6 L9,-6"/>
      <!-- ที่นั่ง -->
      <line x1="-3" y1="-3" x2="4" y2="-3" stroke-width="2.8"/>
    </g>

    <!-- ข้อความ BoomRider -->
    <text
      x="256" y="348"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="Arial Black, Arial, Helvetica, sans-serif"
      font-weight="900"
      font-size="80"
      letter-spacing="-3"
      fill="white"
    >BoomRider</text>

    <!-- เส้น underline accent -->
    <rect x="128" y="364" width="256" height="7" rx="3.5" fill="rgba(255,255,255,0.35)"/>

  </g>
</svg>`;
}

// ── list ของไอคอนที่ต้องสร้าง ─────────────────────────────────────────────────
const ICONS = [
  { name: 'icon-16.png',          size: 16  },
  { name: 'icon-32.png',          size: 32  },
  { name: 'icon-72.png',          size: 72  },
  { name: 'icon-96.png',          size: 96  },
  { name: 'icon-128.png',         size: 128 },
  { name: 'icon-144.png',         size: 144 },
  { name: 'icon-152.png',         size: 152 },
  { name: 'icon-180.png',         size: 180 },
  { name: 'icon-192.png',         size: 192 },
  { name: 'icon-384.png',         size: 384 },
  { name: 'icon-512.png',         size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png',       size: 32  },
  { name: 'shortcut-food.png',    size: 96  },
  { name: 'shortcut-parcel.png',  size: 96  },
];

(async () => {
  for (const { name, size } of ICONS) {
    const svg = Buffer.from(makeSVG(size));
    await sharp(svg, { density: 144 }).png().toFile(path.join(DIR, name));
    console.log(`✓ ${name} (${size}×${size})`);
  }

  // บันทึก SVG ต้นฉบับไว้ด้วย
  fs.writeFileSync(path.join(DIR, 'icon.svg'), makeSVG(512));
  console.log('✓ icon.svg');

  console.log('\n✅ ไอคอนทั้งหมดสร้างสำเร็จ →', DIR);
})();
