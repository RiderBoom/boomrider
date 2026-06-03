import React from 'react';
import { X, Check, Receipt } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import PromptPayQR from '../PromptPayQR';

export default function TopUpModal() {
  const {
    appConfig,
    withdrawAmount, setWithdrawAmount,
    topUpSlip, setTopUpSlip,
    handleTopUpSlipSelect,
    requestTopUp,
    setShowTopUpModal,
  } = useApp();

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={() => setShowTopUpModal(false)}
    >
      <div className="bg-white p-5 rounded-2xl shadow-2xl w-full max-w-sm relative" onClick={e => e.stopPropagation()}>
        <button onClick={() => setShowTopUpModal(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
        <div className="text-center mb-4">
          <h3 className="text-lg font-bold text-green-600">เติมเงินเข้า Wallet</h3>
          <p className="text-xs text-gray-500">สแกน QR หรือโอนตามเลขบัญชี</p>
        </div>
        <div className="bg-gray-100 p-3 rounded-xl mb-4 border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-white p-1.5 rounded-lg shadow-sm border flex items-center justify-center">
              <PromptPayQR
                promptPayId={appConfig.adminPromptPayId}
                amount={parseFloat(withdrawAmount) || 0}
                size={96}
              />
            </div>
            <div className="text-right flex-1 pl-3">
              <p className="font-bold text-gray-800 text-sm">{appConfig.adminBankName}</p>
              <p className="text-lg font-mono font-bold text-blue-600 my-0.5 tracking-wide">{appConfig.adminBankAccount}</p>
              <p className="text-xs text-gray-500 line-clamp-1">{appConfig.adminAccountName}</p>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 font-bold">฿</span>
            </div>
            <input
              type="number"
              value={withdrawAmount}
              onChange={e => setWithdrawAmount(e.target.value)}
              className="w-full pl-8 pr-4 py-2 text-right text-xl font-bold bg-white border border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className={`w-full border-2 border-dashed p-2 rounded-lg text-center cursor-pointer flex items-center justify-center transition-colors ${topUpSlip ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
            <input type="file" accept="image/*" className="hidden" onChange={handleTopUpSlipSelect} />
            {topUpSlip
              ? <><Check size={16} className="mr-1" /> สลิปพร้อมส่ง</>
              : <><Receipt size={16} className="mr-1" /> แนบสลิปโอนเงิน</>
            }
          </label>
          {topUpSlip && (
            <div className="mt-2 h-20 w-full bg-gray-100 rounded-lg overflow-hidden relative">
              <img src={topUpSlip} className="w-full h-full object-cover opacity-80" alt="slip" />
              <button
                onClick={e => { e.preventDefault(); setTopUpSlip(null); }}
                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            if (withdrawAmount > 0) {
              if (!topUpSlip) return alert('กรุณาแนบสลิปการโอนเงิน');
              requestTopUp(parseFloat(withdrawAmount), topUpSlip);
            } else {
              alert('กรุณาระบุจำนวนเงิน');
            }
          }}
          className="w-full bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition-colors flex items-center justify-center"
        >
          แจ้งโอนเงิน
        </button>
      </div>
    </div>
  );
}
