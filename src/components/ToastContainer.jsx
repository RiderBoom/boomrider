import React from 'react';
import { X, CheckCircle, AlertCircle, Bell, Info } from 'lucide-react';

const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`p-4 rounded-lg shadow-xl flex items-start transform transition-all duration-300 animate-in slide-in-from-right pointer-events-auto border-l-4 ${
            toast.type === 'success' ? 'bg-white border-green-500 text-gray-800' :
            toast.type === 'error' ? 'bg-white border-red-500 text-gray-800' :
            toast.type === 'warning' ? 'bg-white border-orange-500 text-gray-800' :
            'bg-white border-blue-500 text-gray-800'
          }`}
        >
          <div className={`mr-3 mt-0.5 ${
            toast.type === 'success' ? 'text-green-500' :
            toast.type === 'error' ? 'text-red-500' :
            toast.type === 'warning' ? 'text-orange-500' :
            'text-blue-500'
          }`}>
            {toast.type === 'success' ? <CheckCircle size={20} /> :
             toast.type === 'error' ? <AlertCircle size={20} /> :
             toast.type === 'warning' ? <Bell size={20} /> :
             <Info size={20} />}
          </div>
          <div className="flex-1">
            <h4 className={`font-bold text-sm ${
              toast.type === 'success' ? 'text-green-700' :
              toast.type === 'error' ? 'text-red-700' :
              toast.type === 'warning' ? 'text-orange-700' :
              'text-blue-700'
            }`}>
              {toast.title}
            </h4>
            <p className="text-sm text-gray-600 leading-snug mt-1">{toast.message}</p>
          </div>
          <button onClick={() => removeToast(toast.id)} className="text-gray-400 hover:text-gray-600 ml-2">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
