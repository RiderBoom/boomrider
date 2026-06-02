import { useEffect, useRef, useState } from 'react';
import { Crosshair, Navigation } from 'lucide-react';

// CARTO Voyager — ฟรี, สวย, ไม่ต้อง API key
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// DivIcon marker — ไม่ต้องใช้ไฟล์ PNG (ป้องกันปัญหา asset path ใน Vite)
function makeIcon(L, color, emoji) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};color:#fff;
      width:36px;height:36px;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      border:3px solid #fff;
      box-shadow:0 2px 10px rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center">
        <div style="transform:rotate(45deg);font-size:16px;line-height:1">${emoji}</div>
    </div>`,
    iconSize:    [36, 36],
    iconAnchor:  [18, 36],
    popupAnchor: [0, -38],
  });
}

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
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);   // Leaflet map instance
  const markersRef    = useRef({});     // { user, shop, rider, pin }
  const leafletRef    = useRef(null);   // L reference (for updates without reinit)
  const [locating, setLocating] = useState(false);
  const [pinned,   setPinned]   = useState(null);

  // ── height: extract from className (e.g. "h-64", "h-36") ─────────────────
  const heightClass = (() => {
    const m = (className || '').match(/h-\[?\d+\]?/);
    return m ? m[0] : 'h-64';
  })();

  const defaultCenter =
    centerOverride
    || riderLocation
    || (mode === 'select' ? (isParcel ? shopLocation : userLocation) : null)
    || shopLocation
    || userLocation
    || { lat: 13.7563, lng: 100.5018 };

  // ── Initialize Leaflet (once on mount) ───────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Dynamic import — ป้องกัน top-level module execution crash
    import('leaflet').then(({ default: L }) => {
      if (destroyed || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(containerRef.current, {
        center:             [defaultCenter.lat, defaultCenter.lng],
        zoom:               15,
        zoomControl:        true,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTR,
        maxZoom:     19,
        subdomains:  'abcd',
      }).addTo(map);

      mapRef.current = map;

      // ── SELECT MODE ────────────────────────────────────────────────────
      if (mode === 'select') {
        const placePin = (latlng) => {
          const loc = { lat: latlng.lat, lng: latlng.lng };
          setPinned(loc);
          onLocationSelect?.(loc);
          if (markersRef.current.pin) {
            markersRef.current.pin.setLatLng(latlng);
          } else {
            const m = L.marker(latlng, {
              icon:      makeIcon(L, '#f97316', '📍'),
              draggable: true,
            }).addTo(map);
            m.on('dragend', (e) => {
              const p = e.target.getLatLng();
              const newLoc = { lat: p.lat, lng: p.lng };
              setPinned(newLoc);
              onLocationSelect?.(newLoc);
            });
            markersRef.current.pin = m;
          }
        };

        // คลิกบนแผนที่ = ปักหมุด
        map.on('click', (e) => placePin(e.latlng));

        // แสดงตำแหน่งที่เลือกไว้แล้ว (ถ้ามี)
        const existing = isParcel ? shopLocation : userLocation;
        if (existing) placePin({ lat: existing.lat, lng: existing.lng });

      // ── VIEW MODE ──────────────────────────────────────────────────────
      } else {
        const latlngs = [];

        if (userLocation) {
          const m = L.marker([userLocation.lat, userLocation.lng], {
            icon: makeIcon(L, '#22c55e', '🏠'),
          }).addTo(map).bindPopup('ตำแหน่งของคุณ');
          markersRef.current.user = m;
          latlngs.push([userLocation.lat, userLocation.lng]);
        }
        if (shopLocation) {
          const m = L.marker([shopLocation.lat, shopLocation.lng], {
            icon: makeIcon(L, '#f97316', '🏪'),
          }).addTo(map).bindPopup('ร้านอาหาร / จุดรับ');
          markersRef.current.shop = m;
          latlngs.push([shopLocation.lat, shopLocation.lng]);
        }
        if (riderLocation) {
          const m = L.marker([riderLocation.lat, riderLocation.lng], {
            icon: makeIcon(L, '#3b82f6', '🛵'),
          }).addTo(map).bindPopup('ไรเดอร์');
          markersRef.current.rider = m;
          latlngs.push([riderLocation.lat, riderLocation.lng]);
        }

        // Fit map เพื่อแสดงทุก marker
        if (latlngs.length > 1) {
          map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 16 });
        }
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current  = null;
        markersRef.current = {};
        leafletRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── อัปเดต rider marker แบบ real-time (ไม่ต้อง reinit map) ───────────────
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current || mode !== 'view') return;
    const L = leafletRef.current;
    if (riderLocation) {
      if (markersRef.current.rider) {
        markersRef.current.rider.setLatLng([riderLocation.lat, riderLocation.lng]);
      } else {
        markersRef.current.rider = L.marker([riderLocation.lat, riderLocation.lng], {
          icon: makeIcon(L, '#3b82f6', '🛵'),
        }).addTo(mapRef.current).bindPopup('ไรเดอร์');
      }
    }
    if (centerOverride) {
      mapRef.current.panTo([centerOverride.lat, centerOverride.lng], { animate: true });
    }
  }, [riderLocation, centerOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── centerOverride เปลี่ยน (เช่น switch pickup↔dropoff) ──────────────────
  useEffect(() => {
    if (!mapRef.current || !centerOverride || mode !== 'select') return;
    mapRef.current.panTo([centerOverride.lat, centerOverride.lng], { animate: true });
  }, [centerOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS ──────────────────────────────────────────────────────────────────
  const useGPS = () => {
    if (!navigator.geolocation || !onLocationSelect) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onLocationSelect(loc);
        setPinned(loc);
        if (!mapRef.current || !leafletRef.current) return;
        const L   = leafletRef.current;
        const map = mapRef.current;
        map.setView([loc.lat, loc.lng], 16, { animate: true });
        if (markersRef.current.pin) {
          markersRef.current.pin.setLatLng([loc.lat, loc.lng]);
        } else {
          const m = L.marker([loc.lat, loc.lng], {
            icon:      makeIcon(L, '#f97316', '📍'),
            draggable: true,
          }).addTo(map);
          m.on('dragend', (e) => {
            const p = e.target.getLatLng();
            const newLoc = { lat: p.lat, lng: p.lng };
            setPinned(newLoc);
            onLocationSelect(newLoc);
          });
          markersRef.current.pin = m;
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 w-full mb-4 ${heightClass} ${
        mode === 'select' ? 'border-green-500' : 'border-gray-200'
      }`}
      style={{ zIndex: 0 }}
    >
      {/* Leaflet container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {mode === 'select' && (
        <>
          {/* คำแนะนำบนสุด */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-green-600/90 text-white text-xs px-3 py-1 rounded-full shadow pointer-events-none z-[1000] whitespace-nowrap backdrop-blur-sm">
            {isParcel ? '📍 แตะแผนที่เพื่อเลือกตำแหน่ง' : '📍 แตะแผนที่เพื่อปักหมุดตำแหน่ง'}
          </div>

          {/* ปุ่ม GPS + พิกัด */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-[1000]">
            <button
              onClick={useGPS}
              disabled={locating}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 active:scale-95 text-white px-4 py-2 rounded-2xl font-bold text-sm shadow-lg disabled:opacity-60 transition-all"
            >
              <Crosshair size={15} className={locating ? 'animate-spin' : ''} />
              {locating ? 'กำลังหาตำแหน่ง GPS...' : 'ใช้ GPS ตำแหน่งปัจจุบัน'}
            </button>
            {pinned && (
              <div className="bg-white/90 backdrop-blur-sm text-xs text-green-700 font-semibold px-3 py-1 rounded-full shadow">
                <Navigation size={10} className="inline mr-1" />
                {pinned.lat.toFixed(5)}, {pinned.lng.toFixed(5)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
