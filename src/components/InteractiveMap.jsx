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
  className = '',
}) => {
  const center = userLocation || shopLocation || { lat: 13.7563, lng: 100.5018 };
  const height = className?.includes('h-') ? className : 'h-64';

  const routeLine = [];
  if (mode === 'view') {
    if (riderLocation && shopLocation && !['delivering', 'delivered', 'completed'].includes(status)) {
      routeLine.push([riderLocation.lat, riderLocation.lng], [shopLocation.lat, shopLocation.lng]);
    } else if (riderLocation && userLocation && ['delivering', 'delivered', 'completed'].includes(status)) {
      routeLine.push([riderLocation.lat, riderLocation.lng], [userLocation.lat, userLocation.lng]);
    } else if (shopLocation && userLocation) {
      routeLine.push([shopLocation.lat, shopLocation.lng], [userLocation.lat, userLocation.lng]);
    }
  }

  return (
    <div className={`relative w-full rounded-xl overflow-hidden border-2 shadow-inner mb-4 ${height} ${mode === 'select' ? 'border-green-500' : 'border-gray-300'}`}>
      {mode === 'select' && (
        <div className="absolute z-[999] top-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs px-3 py-1 rounded-full shadow-lg pointer-events-none animate-bounce">
          แตะแผนที่เพื่อปักหมุดตำแหน่ง
        </div>
      )}
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        dragging={mode === 'select'}
        tap={mode === 'select'}
        touchZoom={false}
        doubleClickZoom={mode === 'select'}
        zoomControl={mode === 'select'}
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
