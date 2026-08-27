import React, { lazy, Suspense, useState } from 'react';
import { ShieldAlert, Bot, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppProvider, useApp } from './context/AppContext';
import ToastContainer from './components/ToastContainer';
import ChatModal from './components/ChatModal';
import AIChatModal from './components/AIChatModal';
import InstallBanner from './components/InstallBanner';
import AuthView from './views/AuthView';
import { USER_LOCATION } from './constants';

// Lazy load — each role loads its own chunk on first login
const CustomerView = lazy(() => import('./views/CustomerView'));
const MerchantView = lazy(() => import('./views/MerchantView'));
const RiderView    = lazy(() => import('./views/RiderView'));
const AdminView    = lazy(() => import('./views/AdminView'));

function ViewLoader() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-orange-400 to-orange-600">
      <div className="text-white text-2xl font-black tracking-tight mb-6">🛵 BoomRider</div>
      <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );
}

function RoleSwitcher() {
  const { i18n } = useTranslation();
  const { activeRole, setActiveRole, pendingRequests, isAdmin } = useApp();

  const toggleLang = () => {
    const nextLang = i18n.language === 'th' ? 'en' : 'th';
    i18n.changeLanguage(nextLang);
    localStorage.setItem('boomrider_lang', nextLang);
  };

  return (
    <div className="fixed top-0 left-0 right-0 bg-gray-900 text-white p-2 z-50 flex justify-between items-center text-xs sm:text-sm shadow-md overflow-x-auto">
      <div className="flex items-center gap-2">
        {import.meta.env.DEV && <span className="font-bold mr-2 whitespace-nowrap hidden sm:block">DEV MODE:</span>}
        <button
          onClick={toggleLang}
          className="bg-gray-800 hover:bg-gray-700 text-green-400 border border-green-500/30 px-2.5 py-1 rounded-full font-bold text-xs flex items-center gap-1 transition-all"
        >
          <Globe size={13} />
          <span>{i18n.language === 'th' ? 'EN' : 'TH'}</span>
        </button>
      </div>
      {import.meta.env.DEV && (
        <div className="flex space-x-2">
          {isAdmin && (
            <button onClick={() => setActiveRole('admin')} className={`px-3 py-1 rounded-full capitalize ${activeRole === 'admin' ? 'bg-red-500 font-bold' : 'bg-gray-700'}`}>
              Admin {pendingRequests.length > 0 && <span className="ml-1 bg-white text-red-600 px-1 rounded-full text-[10px]">{pendingRequests.length}</span>}
            </button>
          )}
          <button onClick={() => setActiveRole('customer')} className={`px-3 py-1 rounded-full capitalize ${activeRole === 'customer' ? 'bg-green-500 font-bold' : 'bg-gray-700'}`}>Customer</button>
        </div>
      )}
    </div>
  );
}

function AppRouter() {
  const {
    isLoggedIn, activeRole,
    toasts, removeToast,
  } = useApp();
  const [aiChatOpen, setAiChatOpen] = useState(false);

  return (
    <div
      id="app-scroll"
      style={{ fontFamily: "'Noto Sans Thai', 'Inter', sans-serif" }}
    >
      <RoleSwitcher />
      <InstallBanner />
      {!isLoggedIn ? (
        <AuthView />
      ) : (
        <>
          <ToastContainer toasts={toasts} removeToast={removeToast} />
          <ChatModal />
          <AIChatModal isOpen={aiChatOpen} onClose={() => setAiChatOpen(false)} />

          {/* AI Assistant Floating Button */}
          <button
            type="button"
            onClick={() => setAiChatOpen(true)}
            className="fixed bottom-20 right-4 z-[9999] bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-3.5 rounded-full shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-1.5 group border border-purple-300/40"
            title="คุยกับน้องบูม AI"
          >
            <Bot size={22} className="group-hover:rotate-12 transition-transform" />
            <span className="text-xs font-bold pr-1 hidden sm:inline">น้องบูม AI</span>
          </button>

          <Suspense fallback={<ViewLoader />}>
            {activeRole === 'customer' && <CustomerView />}
            {activeRole === 'merchant' && <MerchantView />}
            {activeRole === 'rider'    && <RiderView />}
            {activeRole === 'admin'    && <AdminView />}
          </Suspense>
        </>
      )}
    </div>
  );
}

export default function AppShell() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
