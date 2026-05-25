import React from 'react';
import { Clock, Star } from 'lucide-react';

const RestaurantCard = ({ rest, appConfig, onSelect, userProfile }) => {
  const isOutOfRange = rest.distance > appConfig.restaurantRadius;
  const isMyShop = rest.ownerId === userProfile.id;
  const isDisabled = rest.status !== 'open' || isOutOfRange;

  return (
    <div
      onClick={() => !isDisabled && onSelect(rest)}
      className={`restaurant-card mb-4 ${isDisabled ? 'opacity-60' : 'card-hover'} ${isMyShop ? 'ring-2 ring-orange-400' : ''}`}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={`ร้าน ${rest.name}`}
    >
      <div className="relative overflow-hidden" style={{ height: 160 }}>
        <img
          src={rest.image}
          alt={rest.name}
          className="restaurant-card-img"
          loading="lazy"
          decoding="async"
        />
        <span className="restaurant-card-badge">{rest.category}</span>
        <span className="absolute bottom-2 right-2 bg-white/95 text-gray-700 text-xs font-semibold px-2 py-1 rounded-full shadow flex items-center gap-1">
          <Clock size={11} /> {rest.time}
        </span>
        {rest.status === 'closed' && (
          <div className="restaurant-card-closed-overlay">ร้านปิด</div>
        )}
        {isOutOfRange && (
          <div className="restaurant-card-closed-overlay">นอกพื้นที่</div>
        )}
        {isMyShop && (
          <span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">ร้านคุณ</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex justify-between items-start">
          <h3 className="font-bold text-base text-gray-800 leading-tight">{rest.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            rest.distance <= appConfig.riderRadius
              ? 'bg-green-100 text-green-700'
              : 'bg-orange-100 text-orange-600'
          }`}>{rest.distance} กม.</span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-sm text-gray-500">
          <span className="flex items-center gap-0.5 text-yellow-500 font-semibold">
            <Star size={13} className="fill-current" /> {rest.rating}
          </span>
          <span className="text-gray-300">•</span>
          <span className="text-gray-500">ค่าส่ง ฿{appConfig.baseFee + Math.ceil(rest.distance) * appConfig.perKmFee}</span>
        </div>
      </div>
    </div>
  );
};

export default RestaurantCard;
