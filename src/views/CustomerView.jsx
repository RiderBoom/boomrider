import React, { useState } from 'react';
import { Search, X, RefreshCw, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import ToastContainer from '../components/ToastContainer';
import BottomNav from '../components/customer/BottomNav';
import HomeTab from '../components/customer/HomeTab';
import ActivityTab from '../components/customer/ActivityTab';
import ProfileTab from '../components/customer/ProfileTab';
import TopUpModal from '../components/customer/TopUpModal';
import RatingModal from '../components/customer/RatingModal';

export default function CustomerView() {
  const { t } = useTranslation();
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
    <div className="pb-20 pt-14 bg-gray-50 dark:bg-gray-900 min-h-screen text-gray-900 dark:text-white transition-colors duration-200">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {!selectedRestaurant && (activeTab !== 'profile' || profileSubView === 'main') && (
        <div className="bg-white dark:bg-gray-800 px-4 pt-4 pb-3 shadow-sm sticky top-12 z-40 border-b border-transparent dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-md shadow-orange-200">
                <span className="text-white text-lg">🛵</span>
              </div>
              <span className="font-black text-xl tracking-tight gradient-text">BoomRider</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-400">{t('hello')},</span>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 max-w-[80px] truncate">
                {(userProfile.name || 'ผู้ใช้').split(' ')[0]}
              </span>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="ml-1 p-1.5 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-orange-100 dark:hover:bg-gray-600 hover:text-orange-600 text-gray-400 dark:text-gray-300 active:scale-90 transition-all"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 px-3 py-2.5 rounded-2xl border border-transparent dark:border-gray-700">
            <Search size={18} className="text-gray-400 flex-shrink-0" />
            <label htmlFor="customer-search-input" className="sr-only">{t('search_placeholder')}</label>
            <input
              id="customer-search-input"
              name="searchQuery"
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('search_placeholder')}
              className="bg-transparent outline-none flex-1 text-sm text-gray-700 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              aria-label={t('search_placeholder')}
              autoComplete="off"
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
        <div className="bg-white dark:bg-gray-800 p-4 shadow-sm sticky top-12 z-40 flex items-center mb-4 text-gray-900 dark:text-white border-b border-transparent dark:border-gray-700">
          <button onClick={() => setProfileSubView('main')} className="mr-4 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full">
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
