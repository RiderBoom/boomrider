import sharp from 'sharp';
import { writeFileSync } from 'fs';

// 1200x630 OG banner — BoomRider branding
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#fb923c"/>
      <stop offset="100%" stop-color="#c2410c"/>
    </linearGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.22)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.10)"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Decorative circles -->
  <circle cx="1150" cy="-30"  r="260" fill="rgba(255,255,255,0.07)"/>
  <circle cx="1050" cy="620"  r="180" fill="rgba(0,0,0,0.10)"/>
  <circle cx="-30"  cy="80"   r="160" fill="rgba(255,255,255,0.06)"/>

  <!-- Icon card -->
  <rect x="72" y="150" width="320" height="320" rx="64" fill="url(#card)"/>

  <!-- Motorcycle (from icon.svg, scaled to fit card) -->
  <g transform="translate(232,312) scale(19)"
     fill="none" stroke="white" stroke-width="2.1"
     stroke-linecap="round" stroke-linejoin="round">
    <circle cx="-7" cy="6" r="5"/>
    <circle cx="7"  cy="6" r="5"/>
    <path d="M-7,6 L-1,-3 L4,-3"/>
    <path d="M 0,0 L7,6"/>
    <path d="M-1,-3 L1,2 L7,6"/>
    <path d="M4,-3 L6,-6 L9,-6"/>
    <line x1="-3" y1="-3" x2="4" y2="-3" stroke-width="2.8"/>
  </g>

  <!-- App name -->
  <text x="440" y="272"
        font-family="Arial Black, Arial Bold, Arial, sans-serif"
        font-weight="900"
        font-size="118"
        letter-spacing="-3"
        fill="white">BoomRider</text>

  <!-- Tagline line 1 -->
  <text x="444" y="348"
        font-family="Arial, sans-serif"
        font-weight="400"
        font-size="44"
        fill="rgba(255,255,255,0.92)">Food Delivery &amp; Parcel Service</text>

  <!-- Divider -->
  <rect x="444" y="376" width="620" height="5" rx="2.5" fill="rgba(255,255,255,0.30)"/>

  <!-- Tagline line 2 -->
  <text x="444" y="432"
        font-family="Arial, sans-serif"
        font-weight="300"
        font-size="34"
        fill="rgba(255,255,255,0.78)">Fast  •  Affordable  •  Reliable</text>

  <!-- URL pill -->
  <rect x="444" y="468" width="268" height="58" rx="29" fill="rgba(255,255,255,0.18)"/>
  <text x="578" y="504"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-weight="600"
        font-size="26"
        fill="white">boomrider.app</text>

  <!-- Bottom strip -->
  <rect x="0" y="600" width="1200" height="30" fill="rgba(0,0,0,0.15)"/>
  <text x="600" y="621"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="18"
        fill="rgba(255,255,255,0.65)">Order now at boomrider.app</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
writeFileSync('public/og-image.png', png);
console.log('✅  public/og-image.png  (1200 x 630) generated');
