import React, { useState, useEffect } from 'react';
import { Star, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

function StarRow({ value, onChange, label }) {
  return (
    <div className="mb-4">
      <p className="text-sm font-semibold text-gray-700 mb-2">{label}</p>
      <div className="flex gap-2 justify-center">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(n)} className="focus:outline-none transition-transform active:scale-90">
            <Star size={36} className={n <= value ? 'text-yellow-400 fill-current' : 'text-gray-300'} />
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-gray-400 mt-1">
        {value === 1 ? 'แย่มาก' : value === 2 ? 'แย่' : value === 3 ? 'พอใช้' : value === 4 ? 'ดี' : 'ดีมาก!'}
      </p>
    </div>
  );
}

export default function RatingModal() {
  const { showRatingModal, setShowRatingModal, ratingOrderData, submitRating } = useApp();

  const [restaurantStars, setRestaurantStars] = useState(5);
  const [riderStars, setRiderStars] = useState(5);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (ratingOrderData) { setRestaurantStars(5); setRiderStars(5); setComment(''); }
  }, [ratingOrderData]);

  if (!showRatingModal || !ratingOrderData) return null;

  const o = ratingOrderData;
  const isFood = o.type === 'food';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-end justify-center z-50 backdrop-blur-sm"
      onClick={() => setShowRatingModal(false)}
    >
      <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-10 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-black text-gray-900">ให้คะแนนรีวิว ⭐</h3>
            <p className="text-xs text-gray-400">{isFood ? o.restaurantName : '📦 ' + (o.dropoff || 'พัสดุ')}</p>
          </div>
          <button onClick={() => setShowRatingModal(false)} className="p-2 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">
            <X size={18} />
          </button>
        </div>

        {isFood && (
          <StarRow value={restaurantStars} onChange={setRestaurantStars} label={`🍽️ ร้านอาหาร: ${o.restaurantName}`} />
        )}
        {o.riderId && (
          <StarRow value={riderStars} onChange={setRiderStars} label="🛵 ไรเดอร์" />
        )}

        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="ความคิดเห็นเพิ่มเติม (ไม่บังคับ)..."
          rows={2}
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-300 mb-4"
        />
        <button
          onClick={() => submitRating({
            orderId:          o.id,
            restaurantId:     isFood ? o.restaurantId : null,
            riderId:          o.riderId || null,
            restaurantRating: isFood ? restaurantStars : null,
            riderRating:      o.riderId ? riderStars : null,
            comment,
          })}
          className="w-full bg-yellow-400 text-yellow-900 py-3.5 rounded-2xl font-black text-base hover:bg-yellow-300 active:scale-95 transition-all shadow-lg shadow-yellow-200"
        >
          ส่งรีวิว 🌟
        </button>
        <button
          onClick={() => setShowRatingModal(false)}
          className="w-full mt-2 text-gray-400 text-sm py-2 hover:text-gray-600"
        >
          ข้ามไปก่อน
        </button>
      </div>
    </div>
  );
}
