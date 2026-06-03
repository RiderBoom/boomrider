import React, { useState } from 'react';
import { Search, X, RefreshCw, ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import ToastContainer from '../components/ToastContainer';
import BottomNav from '../components/customer/BottomNav';
import HomeTab from '../components/customer/HomeTab';
import ActivityTab from '../components/customer/ActivityTab';
import ProfileTab from '../components/customer/ProfileTab';
import TopUpModal from '../components/customer/TopUpModal';
import RatingModal from '../components/customer/RatingModal';

export default function CustomerView() {
  const {
    activeTab,
    profileSubView, setProfileSubView,
    toasts, removeToast,
    userProfile,
    selectedRestaurant,
    showTopUpModal,
    forceRefresh,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await forceRefresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  return (
    <div className="pb-20 pt-14 bg-gray-50 min-h-screen">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {!selectedRestaurant && (activeTab !== 'profile' || profileSubView === 'main') && (
        <div className="bg-white px-4 pt-4 pb-3 shadow-sm sticky top-12 z-40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-md shadow-orange-200">
                <span className="text-white text-lg">🛵</span>
              </div>
              <span className="font-black text-xl tracking-tight gradient-text">BoomRider</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">สวัสดี,</span>
              <span className="text-xs font-semibold text-gray-700 max-w-[80px] truncate">
                {(userProfile.name || 'ผู้ใช้').split(' ')[0]}
              </span>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="ml-1 p-1.5 rounded-full bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-400 active:scale-90 transition-all"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-gray-100 px-3 py-2.5 rounded-2xl">
            <Search size={18} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาร้านอาหาร เมนู..."
              className="bg-transparent outline-none flex-1 text-sm text-gray-700 placeholder-gray-400"
              aria-label="ค้นหา"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'profile' && profileSubView !== 'main' && (
        <div className="bg-white p-4 shadow-sm sticky top-12 z-40 flex items-center mb-4">
          <button onClick={() => setProfileSubView('main')} className="mr-4 p-1 hover:bg-gray-100 rounded-full">
            <ArrowLeft />
          </button>
          <h2 className="text-xl font-bold">เมนูจัดการ</h2>
        </div>
      )}

      {activeTab === 'home' && (
        <HomeTab searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      )}
      {activeTab === 'activity' && <ActivityTab />}
      {activeTab === 'profile' && <ProfileTab />}

      <BottomNav />
      {showTopUpModal && <TopUpModal />}
      <RatingModal />
    </div>
  );
}
