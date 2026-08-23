import { useEffect, useRef, useState } from 'react';
import { Crosshair, Navigation, Search, Loader2, X } from 'lucide-react';

// CARTO Voyager — ฟรี, สวย, ไม่ต้อง API key
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

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

let _riderStylesInjected = false;
function ensureRiderTrackingStyles() {
  if (_riderStylesInjected || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.textContent = '@keyframes br-pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.8);opacity:0}}@keyframes br-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}';
  document.head.appendChild(s);
  _riderStylesInjected = true;
}

function makeRiderTrackingIcon(L) {
  ensureRiderTrackingStyles();
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center">
        <div style="position:absolute;width:48px;height:48px;border-radius:50%;background:rgba(59,130,246,0.3);animation:br-pulse 1.6s ease-out infinite"></div>
        <div style="position:absolute;width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.15);animation:br-pulse 1.6s ease-out .4s infinite"></div>
        <div style="
          position:relative;z-index:1;
          background:#3b82f6;color:#fff;
          width:36px;height:36px;
          border-radius:50%;
          border:3px solid #fff;
          box-shadow:0 3px 12px rgba(59,130,246,.6);
          display:flex;align-items:center;justify-content:center;
          font-size:18px;line-height:1;
          animation:br-bob 1.2s ease-in-out infinite;
        ">🛵</div>
      </div>`,
    iconSize:    [48, 48],
    iconAnchor:  [24, 24],
    popupAnchor: [0, -28],
  });
}

export default function InteractiveMap({
  mode = 'view',
  userLocation,
  shopLocation,
  riderLocation,
  onLocationSelect,
  isParcel = false,
  activeParcelTarget = null,  // 'pickup' | 'dropoff'
  centerOverride,
  className = '',
  trackingMode = false,       // ใช้ animated rider icon + auto-follow
  autoFollow = false,         // pan map ตามไรเดอร์ real-time
  showRoute = true,           // วาดเส้นทางถนน OSRM อัตโนมัติ ( view mode )
}) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markersRef    = useRef({});     // { pin, secondary, user, shop, rider }
  const polylineRef   = useRef(null);   // OSRM route polyline
  const leafletRef    = useRef(null);

  // Search state (Nominatim)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchDebounceRef = useRef(null);

  // Always-fresh refs — updated every render so stale closures see current values
  const onLocationSelectRef   = useRef(onLocationSelect);
  const activeParcelTargetRef = useRef(activeParcelTarget);
  useEffect(() => { onLocationSelectRef.current   = onLocationSelect; });
  useEffect(() => { activeParcelTargetRef.current = activeParcelTarget; });

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
          const loc    = { lat: latlng.lat, lng: latlng.lng };
          const target = activeParcelTargetRef.current;
          const color  = target === 'dropoff' ? '#ef4444' : '#22c55e';
          const emoji  = target === 'dropoff' ? '🏁' : '📍';

          setPinned(loc);
          onLocationSelectRef.current?.(loc);   // always calls the latest callback

          if (markersRef.current.pin) {
            markersRef.current.pin.setLatLng(latlng);
            markersRef.current.pin.setIcon(makeIcon(L, color, emoji));
          } else {
            const m = L.marker(latlng, {
              icon:      makeIcon(L, color, emoji),
              draggable: true,
            }).addTo(map);
            m.on('dragend', (e) => {
              const p      = e.target.getLatLng();
              const newLoc = { lat: p.lat, lng: p.lng };
              setPinned(newLoc);
              onLocationSelectRef.current?.(newLoc);
            });
            markersRef.current.pin = m;
          }
        };

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
          const icon = trackingMode
            ? makeRiderTrackingIcon(L)
            : makeIcon(L, '#3b82f6', '🛵');
          const m = L.marker([riderLocation.lat, riderLocation.lng], { icon })
            .addTo(map).bindPopup('ไรเดอร์');
          markersRef.current.rider = m;
          latlngs.push([riderLocation.lat, riderLocation.lng]);
        }

        if (latlngs.length > 1) {
          map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 16 });
        } else if (riderLocation && trackingMode) {
          map.setView([riderLocation.lat, riderLocation.lng], 16);
        }
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current     = null;
        markersRef.current = {};
        leafletRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OSRM Routing (View Mode) ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current || mode !== 'view' || !showRoute) return;
    const L = leafletRef.current;
    const map = mapRef.current;

    // คำนวณเส้นทาง OSRM ระหว่างจุดรับและจุดส่ง หรือ ไรเดอร์
    let waypoints = [];
    if (riderLocation && shopLocation) {
      waypoints = [riderLocation, shopLocation];
      if (userLocation) waypoints.push(userLocation);
    } else if (shopLocation && userLocation) {
      waypoints = [shopLocation, userLocation];
    }

    if (waypoints.length < 2) {
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      return;
    }

    const coordsStr = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

    let active = true;
    fetch(osrmUrl)
      .then((res) => res.json())
      .then((data) => {
        if (!active || !data.routes || !data.routes[0]) return;
        const routeCoords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);

        if (polylineRef.current) {
          polylineRef.current.setLatLngs(routeCoords);
        } else {
          polylineRef.current = L.polyline(routeCoords, {
            color: '#3b82f6',
            weight: 5,
            opacity: 0.8,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: '1, 8',
          }).addTo(map);
        }
      })
      .catch((err) => {
        console.warn('OSRM Route fetch error:', err);
      });

    return () => {
      active = false;
    };
  }, [mode, showRoute, userLocation?.lat, userLocation?.lng, shopLocation?.lat, shopLocation?.lng, riderLocation?.lat, riderLocation?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── อัปเดต rider marker แบบ real-time (view mode) ────────────────────────
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current || mode !== 'view') return;
    const L = leafletRef.current;
    if (riderLocation) {
      const icon = trackingMode
        ? makeRiderTrackingIcon(L)
        : makeIcon(L, '#3b82f6', '🛵');
      if (markersRef.current.rider) {
        markersRef.current.rider.setLatLng([riderLocation.lat, riderLocation.lng]);
        if (trackingMode) markersRef.current.rider.setIcon(icon);
      } else {
        markersRef.current.rider = L.marker([riderLocation.lat, riderLocation.lng], { icon })
          .addTo(mapRef.current).bindPopup('ไรเดอร์');
      }
      if (autoFollow) {
        mapRef.current.panTo([riderLocation.lat, riderLocation.lng], { animate: true, duration: 0.8 });
      }
    }
    if (centerOverride) {
      mapRef.current.panTo([centerOverride.lat, centerOverride.lng], { animate: true });
    }
  }, [riderLocation, centerOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── pan เมื่อ centerOverride เปลี่ยน (select mode) ───────────────────────
  useEffect(() => {
    if (!mapRef.current || !centerOverride || mode !== 'select') return;
    mapRef.current.panTo([centerOverride.lat, centerOverride.lng], { animate: true });
  }, [centerOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Non-parcel select: sync pin when userLocation prop changes (e.g., auto-GPS from parent) ──
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current || mode !== 'select' || isParcel) return;
    if (!userLocation) return;
    const L   = leafletRef.current;
    const map = mapRef.current;
    const latlng = [userLocation.lat, userLocation.lng];
    if (markersRef.current.pin) {
      markersRef.current.pin.setLatLng(latlng);
    } else {
      const m = L.marker(latlng, {
        icon:      makeIcon(L, '#22c55e', '📍'),
        draggable: true,
      }).addTo(map);
      m.on('dragend', (e) => {
        const p      = e.target.getLatLng();
        const newLoc = { lat: p.lat, lng: p.lng };
        setPinned(newLoc);
        onLocationSelectRef.current?.(newLoc);
      });
      markersRef.current.pin = m;
    }
    setPinned(userLocation);
    map.panTo(latlng, { animate: true });
  }, [userLocation, isParcel, mode]);  

  // ── Parcel: sync active pin + secondary static marker when target/locations change ──
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current || mode !== 'select' || !isParcel) return;
    const L   = leafletRef.current;
    const map = mapRef.current;

    // shopLocation = pickup, userLocation = dropoff (parcel convention in CustomerView)
    const activeLocation = activeParcelTarget === 'pickup' ? shopLocation : userLocation;
    const otherLocation  = activeParcelTarget === 'pickup' ? userLocation  : shopLocation;
    const activeColor    = activeParcelTarget === 'pickup' ? '#22c55e' : '#ef4444';
    const activeEmoji    = activeParcelTarget === 'pickup' ? '📍' : '🏁';
    const otherColor     = activeParcelTarget === 'pickup' ? '#ef4444' : '#22c55e';
    const otherEmoji     = activeParcelTarget === 'pickup' ? '🏁' : '📍';

    // Move / create the active (draggable) pin
    if (activeLocation) {
      const latlng = [activeLocation.lat, activeLocation.lng];
      if (markersRef.current.pin) {
        markersRef.current.pin.setLatLng(latlng);
        markersRef.current.pin.setIcon(makeIcon(L, activeColor, activeEmoji));
      } else {
        const m = L.marker(latlng, {
          icon:      makeIcon(L, activeColor, activeEmoji),
          draggable: true,
        }).addTo(map);
        m.on('dragend', (e) => {
          const p      = e.target.getLatLng();
          const newLoc = { lat: p.lat, lng: p.lng };
          setPinned(newLoc);
          onLocationSelectRef.current?.(newLoc);
        });
        markersRef.current.pin = m;
      }
      setPinned(activeLocation);
    } else if (markersRef.current.pin) {
      // Target has no location yet — just update the icon color/emoji
      markersRef.current.pin.setIcon(makeIcon(L, activeColor, activeEmoji));
    }

    // Show the "other" location as a static secondary marker
    if (otherLocation) {
      if (markersRef.current.secondary) {
        markersRef.current.secondary.setLatLng([otherLocation.lat, otherLocation.lng]);
        markersRef.current.secondary.setIcon(makeIcon(L, otherColor, otherEmoji));
      } else {
        markersRef.current.secondary = L.marker([otherLocation.lat, otherLocation.lng], {
          icon:      makeIcon(L, otherColor, otherEmoji),
          draggable: false,
        }).addTo(map);
      }
    } else if (markersRef.current.secondary) {
      markersRef.current.secondary.remove();
      markersRef.current.secondary = null;
    }
  }, [activeParcelTarget, shopLocation, userLocation, isParcel, mode]);  

  // ── Nominatim Address Search ──────────────────────────────────────────────
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!val.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          val
        )}&countrycodes=th&limit=5&accept-language=th`
      )
        .then((res) => res.json())
        .then((data) => {
          setSearchResults(data || []);
          setShowSearchResults(true);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setIsSearching(false));
    }, 500);
  };

  const handleSelectSearchResult = (result) => {
    const loc = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
    const target = activeParcelTargetRef.current;
    const color = target === 'dropoff' ? '#ef4444' : '#22c55e';
    const emoji = target === 'dropoff' ? '🏁' : '📍';

    setPinned(loc);
    onLocationSelectRef.current?.(loc);
    setShowSearchResults(false);
    setSearchQuery(result.display_name.split(',')[0] || result.display_name);

    if (!mapRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapRef.current;

    map.setView([loc.lat, loc.lng], 16, { animate: true });

    if (markersRef.current.pin) {
      markersRef.current.pin.setLatLng([loc.lat, loc.lng]);
      markersRef.current.pin.setIcon(makeIcon(L, color, emoji));
    } else {
      const m = L.marker([loc.lat, loc.lng], {
        icon: makeIcon(L, color, emoji),
        draggable: true,
      }).addTo(map);
      m.on('dragend', (e) => {
        const p = e.target.getLatLng();
        const newLoc = { lat: p.lat, lng: p.lng };
        setPinned(newLoc);
        onLocationSelectRef.current?.(newLoc);
      });
      markersRef.current.pin = m;
    }
  };

  // ── GPS ──────────────────────────────────────────────────────────────────
  const useGPS = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc    = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const target = activeParcelTargetRef.current;
        const color  = target === 'dropoff' ? '#ef4444' : '#22c55e';
        const emoji  = target === 'dropoff' ? '🏁' : '📍';

        onLocationSelectRef.current?.(loc);
        setPinned(loc);

        if (!mapRef.current || !leafletRef.current) return;
        const L   = leafletRef.current;
        const map = mapRef.current;
        map.setView([loc.lat, loc.lng], 16, { animate: true });

        if (markersRef.current.pin) {
          markersRef.current.pin.setLatLng([loc.lat, loc.lng]);
          markersRef.current.pin.setIcon(makeIcon(L, color, emoji));
        } else {
          const m = L.marker([loc.lat, loc.lng], {
            icon:      makeIcon(L, color, emoji),
            draggable: true,
          }).addTo(map);
          m.on('dragend', (e) => {
            const p      = e.target.getLatLng();
            const newLoc = { lat: p.lat, lng: p.lng };
            setPinned(newLoc);
            onLocationSelectRef.current?.(newLoc);
          });
          markersRef.current.pin = m;
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const borderColor = mode !== 'select'
    ? 'border-gray-200'
    : isParcel && activeParcelTarget === 'dropoff'
      ? 'border-red-500'
      : 'border-green-500';

  const hintText = isParcel
    ? (activeParcelTarget === 'pickup'  ? '📍 แตะแผนที่เพื่อเลือกจุดรับของ'
     : activeParcelTarget === 'dropoff' ? '🏁 แตะแผนที่เพื่อเลือกจุดส่งของ'
     : '📍 กรุณาเลือกประเภทหมุดก่อน')
    : '📍 แตะแผนที่เพื่อปักหมุดตำแหน่ง';

  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 w-full mb-4 ${heightClass} ${borderColor}`}
      style={{ zIndex: 0 }}
    >
      {/* Leaflet container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {mode === 'select' && (
        <>
          {/* ช่องค้นหาที่อยู่ภาษาไทย (Nominatim) */}
          <div className="absolute top-2 left-2 right-2 z-[1000]">
            <div className="relative flex items-center bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200">
              <Search size={16} className="text-gray-400 ml-3 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="ค้นหาชื่อสถานที่, ถนน, ซอย..."
                className="w-full py-2 px-2 text-xs text-gray-800 bg-transparent border-none focus:outline-none"
              />
              {isSearching ? (
                <Loader2 size={16} className="animate-spin text-green-500 mr-3 shrink-0" />
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setShowSearchResults(false);
                  }}
                  className="p-1 mr-2 text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {/* ผลการค้นหา Dropdown */}
            {showSearchResults && searchResults.length > 0 && (
              <div className="mt-1 bg-white rounded-xl shadow-xl border border-gray-100 max-h-48 overflow-y-auto divide-y divide-gray-100">
                {searchResults.map((res) => (
                  <button
                    key={res.place_id}
                    type="button"
                    onClick={() => handleSelectSearchResult(res)}
                    className="w-full text-left px-3 py-2 hover:bg-green-50 transition-colors text-xs text-gray-700 flex flex-col"
                  >
                    <span className="font-semibold text-gray-900 truncate">
                      {res.display_name.split(',')[0]}
                    </span>
                    <span className="text-[10px] text-gray-400 truncate">
                      {res.display_name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* คำแนะนำบนสุด */}
          <div
            className={`absolute top-12 left-1/2 -translate-x-1/2 text-white text-xs px-3 py-1 rounded-full shadow pointer-events-none z-[999] whitespace-nowrap backdrop-blur-sm ${
              isParcel && activeParcelTarget === 'dropoff' ? 'bg-red-600/90' : 'bg-green-600/90'
            }`}
          >
            {hintText}
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
