import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const userIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});
const shopIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});
const riderIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const MapClickHandler = ({ onSelect }) => {
  useMapEvents({ click: (e) => onSelect({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
};

const InteractiveMap = ({
  mode = 'view',
  userLocation,
  shopLocation,
  riderLocation,
  onLocationSelect,
  status,
  isParcel = false,
  centerOverride,
  className = '',
}) => {
  const center = centerOverride || userLocation || shopLocation || { lat: 13.7563, lng: 100.5018 };

  // Extract height class from className; default h-64
  const heightClass = (() => {
    if (!className) return 'h-64';
    const match = className.match(/h-\d+/);
    return match ? match[0] : 'h-64';
  })();

  const routeLine = [];
  if (mode === 'view') {
    if (riderLocation && shopLocation && !['delivering', 'delivered', 'completed'].includes(status)) {
      routeLine.push([riderLocation.lat, riderLocation.lng], [shopLocation.lat, shopLocation.lng]);
    } else if (riderLocation && userLocation && ['delivering', 'delivered', 'completed'].includes(status)) {
      routeLine.push([riderLocation.lat, riderLocation.lng], [userLocation.lat, userLocation.lng]);
    } else if (shopLocation && userLocation) {
      routeLine.push([shopLocation.lat, shopLocation.lng], [userLocation.lat, userLocation.lng]);
    }
  } else if (mode === 'select' && isParcel && shopLocation && userLocation) {
    // Show route line between pickup and dropoff in parcel select mode
    routeLine.push([shopLocation.lat, shopLocation.lng], [userLocation.lat, userLocation.lng]);
  }

  return (
    /*
     * isolation: isolate  — สร้าง stacking context ใหม่
     * overflow-hidden     — clip Leaflet layers ไม่ให้หลุดออกนอก container
     * position: relative  — ทำให้ Leaflet children ที่เป็น absolute อ้างอิง container นี้
     * z-index ต่ำ (z-0)  — กันไม่ให้ Leaflet panes (z 200–1000) ซ้อนทับ UI ข้างนอก
     */
    <div
      className={`relative isolate overflow-hidden rounded-xl border-2 w-full mb-4 ${heightClass} ${
        mode === 'select' ? 'border-green-500' : 'border-gray-300'
      }`}
      style={{ zIndex: 0 }}
    >
      {mode === 'select' && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs px-3 py-1 rounded-full shadow-lg pointer-events-none animate-bounce"
          style={{ zIndex: 1000 }}
        >
          แตะแผนที่เพื่อปักหมุดตำแหน่ง
        </div>
      )}
      <MapContainer
        key={`${center.lat},${center.lng}`}
        center={[center.lat, center.lng]}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        dragging={true}
        tap={true}
        touchZoom={true}
        doubleClickZoom={true}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mode === 'select' && <MapClickHandler onSelect={onLocationSelect} />}
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>{isParcel ? 'จุดส่ง' : 'ลูกค้า'}</Popup>
          </Marker>
        )}
        {shopLocation && (
          <Marker position={[shopLocation.lat, shopLocation.lng]} icon={shopIcon}>
            <Popup>{isParcel ? 'จุดรับ' : 'ร้านค้า'}</Popup>
          </Marker>
        )}
        {riderLocation && mode === 'view' && (
          <Marker position={[riderLocation.lat, riderLocation.lng]} icon={riderIcon}>
            <Popup>ไรเดอร์</Popup>
          </Marker>
        )}
        {routeLine.length === 2 && (
          <Polyline positions={routeLine} color="#3b82f6" dashArray="8,6" />
        )}
      </MapContainer>
    </div>
  );
};

export default InteractiveMap;
