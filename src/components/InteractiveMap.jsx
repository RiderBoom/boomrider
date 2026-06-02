import React, { useState } from 'react';
import { MapPin, Crosshair, Navigation } from 'lucide-react';

// Drop-in replacement for react-leaflet InteractiveMap.
// view mode  → OpenStreetMap iframe (zero JS deps, no crash)
// select mode → GPS button + coordinates display (no map click needed)

const OSM_EMBED = (lat, lng, zoom = 15) => {
  const d = 0.009;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
};

export default function InteractiveMap({
  mode = 'view',
  userLocation,
  shopLocation,
  riderLocation,
  onLocationSelect,
  isParcel = false,
  centerOverride,
  className = '',
}) {
  const [locating, setLocating] = useState(false);

  const heightClass = (() => {
    const m = (className || '').match(/h-\d+/);
    return m ? m[0] : 'h-64';
  })();

  const center = centerOverride || riderLocation || (mode === 'select' ? userLocation : null) || shopLocation || userLocation || { lat: 13.7563, lng: 100.5018 };

  const useGPS = () => {
    if (!navigator.geolocation || !onLocationSelect) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onLocationSelect({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // ── SELECT MODE ────────────────────────────────────────────────────────────
  if (mode === 'select') {
    const pinned = isParcel ? shopLocation : userLocation;
    return (
      <div className={`relative rounded-xl border-2 border-green-500 w-full mb-4 ${heightClass} bg-green-50 flex flex-col items-center justify-center gap-3 p-4`}>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs px-3 py-1 rounded-full shadow pointer-events-none whitespace-nowrap">
          {isParcel ? 'เลือกตำแหน่งจุดรับ/ส่ง' : 'ปักหมุดตำแหน่งของคุณ'}
        </div>

        <MapPin size={36} className="text-green-500 mt-6" />

        <button
          onClick={useGPS}
          disabled={locating}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-600 active:scale-95 text-white px-5 py-2.5 rounded-2xl font-bold text-sm shadow-md disabled:opacity-60 transition-all"
        >
          <Crosshair size={16} className={locating ? 'animate-spin' : ''} />
          {locating ? 'กำลังหาตำแหน่ง GPS...' : 'ใช้ตำแหน่งปัจจุบัน (GPS)'}
        </button>

        {pinned && (
          <p className="text-xs text-green-700 font-medium">
            <Navigation size={12} className="inline mr-1" />
            ปักหมุดแล้ว: {pinned.lat.toFixed(5)}, {pinned.lng.toFixed(5)}
          </p>
        )}

        {!pinned && (
          <p className="text-xs text-gray-500 text-center max-w-[200px]">
            กดปุ่มด้านบนเพื่อใช้ GPS<br />หรือพิมพ์ที่อยู่ในช่องค้นหาด้านบน
          </p>
        )}
      </div>
    );
  }

  // ── VIEW MODE ──────────────────────────────────────────────────────────────
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 border-gray-300 w-full mb-4 ${heightClass} bg-gray-100`}
      style={{ zIndex: 0 }}
    >
      <iframe
        title="แผนที่"
        src={OSM_EMBED(center.lat, center.lng)}
        style={{ width: '100%', height: '100%', border: 0 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
