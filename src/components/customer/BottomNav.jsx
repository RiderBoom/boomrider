import React from 'react';
import { Home, ShoppingBag, User, ShieldAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function BottomNav() {
  const {
    activeTab, setActiveTab,
    activeRole, setActiveRole,
    setProfileSubView,
    isAdmin, pendingRequests,
    orders, userProfile, currentUser,
    selectedRestaurant,
  } = useApp();

  if (selectedRestaurant) return null;

  const activityBadge = orders.filter(o =>
    ['pending', 'preparing', 'ready_to_pickup', 'rider_accepted', 'picking_up', 'delivering', 'delivered'].includes(o.status) &&
    (o.customerId === userProfile.id || o.customerId === currentUser?.id),
  ).length;

  const tabs = [
    { id: 'home',     icon: Home,        label: 'หน้าแรก' },
    { id: 'activity', icon: ShoppingBag, label: 'ออเดอร์', badge: activityBadge },
    { id: 'profile',  icon: User,        label: 'บัญชี' },
    ...(isAdmin ? [{ id: 'admin', icon: ShieldAlert, label: 'แอดมิน', badge: pendingRequests.length, isRole: true }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 flex justify-around z-40 bottom-nav-bar shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      {tabs.map(({ id, icon: Icon, label, badge, isRole }) => (
        <button
          key={id}
          onClick={() => {
            if (isRole) { setActiveRole(id); }
            else { setActiveTab(id); setProfileSubView('main'); }
          }}
          className={`bottom-nav-item ${
            isRole
              ? (activeRole === id ? 'active' : 'text-gray-400')
              : (activeTab === id && activeRole === 'customer' ? 'active' : 'text-gray-400')
          } ${id === 'admin' ? '!text-red-500' : ''}`}
        >
          <div className="relative">
            <Icon size={22} strokeWidth={activeTab === id ? 2.5 : 1.8} />
            {badge > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </div>
          <span className={`text-[10px] font-${activeTab === id ? 'bold' : 'medium'} mt-0.5`}>{label}</span>
          <div className="nav-dot" />
        </button>
      ))}
    </div>
  );
}
