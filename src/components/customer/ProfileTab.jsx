import React, { useState, useEffect } from 'react';
import {
  MapPin, ArrowDownCircle, Wallet, MessageSquare,
  ChevronRight, Repeat, LogOut, Settings, Save,
  Camera, Crosshair, Bike, ChefHat, Plus, Trash2,
  Check, Edit,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDateTimeFromMs } from '../../utils';
import InteractiveMap from '../InteractiveMap';

export default function ProfileTab() {
  const {
    userProfile,
    profileSubView, setProfileSubView,
    userRoles, userWallet, walletHistory,
    userAddresses,
    tempProfile, setTempProfile,
    withdrawMode, setWithdrawMode,
    withdrawAmount, setWithdrawAmount,
    withdrawBank, setWithdrawBank,
    withdrawAccount, setWithdrawAccount,
    withdrawName, setWithdrawName,
    setShowTopUpModal,
    merchantRegForm, setMerchantRegForm,
    riderRegForm, setRiderRegForm,
    newAddr, setNewAddr,
    handleMapLocationSelect, getCurrentLocationForForm,
    handleAddAddress, handleUpdateAddress, handleDeleteAddress,
    handleProfilePhotoChange,
    handleRegistrationPhotoSelect,
    handleSaveProfile, profileUploading,
    requestWithdraw, requestRegisterMerchant, requestRegisterRider,
    openChatWindow, handleLogout,
    isPending, syncRoles,
    setActiveRole,
    handleUpdateUserLocation,
    notifySystem,
  } = useApp();

  const [editingAddrId, setEditingAddrId] = useState(null);
  const [editAddrPinLoc, setEditAddrPinLoc] = useState(null);
  const [editAddrSaving, setEditAddrSaving] = useState(false);
  const [newAddrMode, setNewAddrMode] = useState(false);
  const [userPinLoc, setUserPinLoc] = useState(null);
  const [userPinSaving, setUserPinSaving] = useState(false);
  const [merchantSubmitting, setMerchantSubmitting] = useState(false);
  const [riderSubmitting, setRiderSubmitting] = useState(false);

  // Auto-GPS: pull current location when entering pin_location subview
  useEffect(() => {
    if (profileSubView !== 'pin_location' || !navigator.geolocation) return;
    notifySystem('กำลังดึง GPS', 'กำลังหาตำแหน่งของคุณ...', 'info');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setUserPinLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        notifySystem('สำเร็จ', 'พบตำแหน่ง GPS ของคุณแล้ว', 'success');
      },
      () => notifySystem('ไม่สามารถดึง GPS', 'กรุณาแตะแผนที่เพื่อเลือกตำแหน่ง', 'error'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [profileSubView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-GPS: pull current location when adding a new address
  useEffect(() => {
    if (newAddrMode) getCurrentLocationForForm();
  }, [newAddrMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const MERCHANT_FORM_INIT = { shopName: '', category: 'Street Food', realName: '', idCard: '', phone: '', bankName: '', bankAccount: '', idCardImage: null, shopImage: null, location: null };
  const RIDER_FORM_INIT    = { realName: '', vehicle: 'Motorcycle', idCard: '', phone: '', bankName: '', bankAccount: '', idCardImage: null, profileImage: null };

  return (
    <div className="p-4 min-h-screen pb-24">
      {profileSubView === 'main' ? (
        <>
          <div className="bg-white p-6 rounded-2xl shadow-sm mb-4 flex items-center">
            <div className="w-16 h-16 bg-gray-200 rounded-full overflow-hidden mr-4 relative">
              <img
                src={userProfile.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userProfile.name || 'User') + '&background=fb923c&color=fff&size=64'}
                alt="Profile"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer text-white">
                <Edit size={20} />
              </div>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold">{userProfile.name}</h2>
              <div className="text-gray-500 text-sm">ID: {userProfile.id}</div>
            </div>
          </div>
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setProfileSubView('wallet')}
              className="flex-1 bg-gradient-to-r from-green-600 to-green-500 p-4 rounded-2xl shadow-lg text-white flex justify-between items-center"
            >
              <div className="flex items-center"><Wallet className="mr-2" /><span className="font-bold text-sm">฿{userWallet.toFixed(2)}</span></div>
            </button>
            <button
              onClick={() => openChatWindow('support-' + userProfile.id, 'เจ้าหน้าที่ (Admin)', 'customer')}
              className="flex-1 bg-blue-600 p-4 rounded-2xl shadow-lg text-white flex justify-center items-center font-bold text-sm"
            >
              <MessageSquare className="mr-2" /> ติดต่อเจ้าหน้าที่
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
            <div className="p-4 border-b bg-gray-50 font-bold text-gray-700 text-sm">เมนูพาร์ทเนอร์</div>
            {userRoles.includes('merchant') ? (
              <button onClick={() => setActiveRole('merchant')} className="w-full p-4 flex items-center justify-between hover:bg-green-50 border-b">
                <span className="text-green-700 font-bold">สลับไปร้านค้า</span><Repeat size={20} />
              </button>
            ) : isPending('merchant_reg') ? (
              <div className="p-4 text-gray-400 border-b flex items-center justify-between bg-gray-50">
                <span>สมัครร้านค้า (รออนุมัติ...)</span>
                <button onClick={syncRoles} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200 flex items-center gap-1 ml-2">
                  <Repeat size={12} /> ตรวจสอบ
                </button>
              </div>
            ) : (
              <button onClick={() => setProfileSubView('reg_merchant')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
                <span>สมัครเปิดร้านอาหาร</span><ChevronRight size={20} />
              </button>
            )}
            {userRoles.includes('rider') ? (
              <button onClick={() => setActiveRole('rider')} className="w-full p-4 flex items-center justify-between hover:bg-blue-50">
                <span className="text-blue-700 font-bold">สลับไปไรเดอร์</span><Repeat size={20} />
              </button>
            ) : isPending('rider_reg') ? (
              <div className="p-4 text-gray-400 flex items-center justify-between bg-gray-50">
                <span>สมัครไรเดอร์ (รออนุมัติ...)</span>
                <button onClick={syncRoles} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200 flex items-center gap-1 ml-2">
                  <Repeat size={12} /> ตรวจสอบ
                </button>
              </div>
            ) : (
              <button onClick={() => setProfileSubView('reg_rider')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50">
                <span>สมัครขับ BoomRider</span><ChevronRight size={20} />
              </button>
            )}
            <button onClick={handleLogout} className="w-full p-4 flex items-center justify-between hover:bg-red-50 border-t">
              <span className="text-red-600 font-bold">ออกจากระบบ</span><LogOut size={20} className="text-red-600" />
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => { setProfileSubView('pin_location'); setUserPinLoc(null); }}
              className="w-full p-4 flex items-center justify-between hover:bg-blue-50 border-b"
            >
              <div className="flex items-center">
                <div className="bg-blue-100 p-2 rounded-lg text-blue-600 mr-3"><MapPin size={20} /></div>
                <div className="text-left">
                  <div className="font-medium">ตำแหน่งของฉัน</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {userProfile.location
                      ? `${userProfile.location.lat.toFixed(4)}, ${userProfile.location.lng.toFixed(4)}`
                      : 'ยังไม่ได้ตั้ง'}
                  </div>
                </div>
              </div>
              <ChevronRight size={20} className="text-gray-400" />
            </button>
            <button onClick={() => setProfileSubView('address')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
              <div className="flex items-center"><div className="bg-gray-100 p-2 rounded-lg text-gray-600 mr-3"><MapPin size={20} /></div><span>ที่อยู่ของฉัน</span></div>
              <ChevronRight size={20} className="text-gray-400" />
            </button>
            <button onClick={() => setProfileSubView('edit_profile')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 border-b">
              <div className="flex items-center"><div className="bg-gray-100 p-2 rounded-lg text-gray-600 mr-3"><Settings size={20} /></div><span>ตั้งค่า/แก้ไขโปรไฟล์</span></div>
              <ChevronRight size={20} className="text-gray-400" />
            </button>
          </div>
        </>

      ) : profileSubView === 'wallet' ? (
        <div className="p-4 pt-0 bg-white min-h-[50vh]">
          <div className="bg-gradient-to-r from-green-600 to-green-500 p-8 rounded-2xl shadow-lg text-white mb-6 text-center">
            <p className="text-green-100 mb-2">ยอดเงินคงเหลือ</p>
            <h1 className="text-4xl font-bold mb-6">฿{userWallet.toFixed(2)}</h1>
            {!withdrawMode ? (
              <div className="grid grid-cols-3 gap-4">
                {[100, 500, 1000].map(amount => (
                  <button
                    key={amount}
                    onClick={() => { setWithdrawAmount(amount.toString()); setShowTopUpModal(true); }}
                    className="bg-white/20 hover:bg-white/30 py-2 rounded-lg font-bold backdrop-blur-sm"
                  >
                    +฿{amount}
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm space-y-2">
                <input type="number" placeholder="ระบุจำนวนเงิน" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} className="w-full text-black p-2 rounded text-center font-bold" />
                <input type="text" placeholder="ชื่อธนาคาร (เช่น กสิกร)" value={withdrawBank} onChange={e => setWithdrawBank(e.target.value)} className="w-full text-black p-2 rounded text-sm" />
                <input type="text" placeholder="เลขบัญชี" value={withdrawAccount} onChange={e => setWithdrawAccount(e.target.value)} className="w-full text-black p-2 rounded text-sm" />
                <input type="text" placeholder="ชื่อบัญชี" value={withdrawName} onChange={e => setWithdrawName(e.target.value)} className="w-full text-black p-2 rounded text-sm" />
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setWithdrawMode(false)} className="flex-1 bg-gray-500 py-2 rounded font-bold">ยกเลิก</button>
                  <button
                    onClick={() => {
                      if (withdrawAmount > 0 && withdrawBank && withdrawAccount && withdrawName) {
                        requestWithdraw(parseFloat(withdrawAmount), { bank: withdrawBank, account: withdrawAccount, name: withdrawName });
                        setWithdrawMode(false); setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount('');
                      } else { alert('กรุณากรอกข้อมูลให้ครบถ้วน'); }
                    }}
                    className="flex-1 bg-white text-green-600 py-2 rounded font-bold"
                  >
                    ยืนยันถอน
                  </button>
                </div>
              </div>
            )}
            {!withdrawMode && (
              <button onClick={() => setWithdrawMode(true)} className="mt-4 text-sm text-green-100 underline flex items-center justify-center w-full">
                <ArrowDownCircle size={16} className="mr-1" /> ต้องการถอนเงิน?
              </button>
            )}
          </div>
          <h3 className="font-bold text-base mb-3 text-gray-700">ประวัติธุรกรรม</h3>
          {walletHistory.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีประวัติธุรกรรม</div>
          ) : (
            <div className="space-y-2">
              {[...walletHistory].sort((a, b) => {
                const ms = (e) => e.createdAtMs || parseInt(((e.id || '').match(/\d{10,}/) || ['0'])[0], 10);
                return ms(b) - ms(a);
              }).map(tx => {
                const amt = tx.amount ?? 0;
                const isIncome = amt >= 0;
                return (
                  <div key={tx.id} className="flex justify-between items-center gap-3 p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 text-sm truncate">{tx.desc || '—'}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{tx.createdAtMs ? formatDateTimeFromMs(tx.createdAtMs) : (tx.date || '')}</div>
                    </div>
                    <span className={`font-bold text-sm flex-shrink-0 ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                      {isIncome ? '+' : '-'}฿{Math.abs(amt).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      ) : profileSubView === 'pin_location' ? (
        <div className="p-4 pt-0">
          <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-4 mb-4">
            <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
              <MapPin size={18} className="text-blue-500" /> ตำแหน่งของฉัน
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              ตำแหน่งนี้ใช้คำนวณระยะทางร้านค้าใกล้บ้าน และเป็นที่อยู่เริ่มต้นสำหรับสั่งอาหาร
            </p>
            <div className="text-xs mb-3 space-y-0.5">
              <div className="text-gray-500">
                📍 ตำแหน่งตอนนี้:{' '}
                {userProfile.location
                  ? <span className="text-gray-700 font-medium">{userProfile.location.lat.toFixed(4)}, {userProfile.location.lng.toFixed(4)}</span>
                  : <span className="text-red-400 font-bold">ยังไม่ได้ตั้ง</span>}
              </div>
              {userPinLoc && (
                <div className="text-blue-600 font-bold">
                  🔵 เลือกใหม่: {userPinLoc.lat.toFixed(4)}, {userPinLoc.lng.toFixed(4)}
                </div>
              )}
            </div>
            <div className="rounded-xl overflow-hidden border-2 border-blue-200 mb-2">
              <InteractiveMap
                mode="select"
                userLocation={userPinLoc || userProfile.location}
                onLocationSelect={loc => setUserPinLoc(loc)}
                className="h-64"
              />
            </div>
            <p className="text-[10px] text-gray-400 text-center mb-3">แตะบนแผนที่เพื่อปักหมุดตำแหน่งของคุณ</p>
            <button
              onClick={() => {
                if (!navigator.geolocation) return notifySystem('ไม่รองรับ', 'Browser นี้ไม่รองรับ GPS', 'error');
                navigator.geolocation.getCurrentPosition(
                  pos => setUserPinLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => notifySystem('ไม่สามารถดึง GPS', 'กรุณาแตะแผนที่เพื่อเลือกตำแหน่ง', 'error'),
                  { enableHighAccuracy: true, timeout: 8000 },
                );
              }}
              className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold mb-3 flex items-center justify-center gap-2 hover:bg-gray-200 active:scale-95 transition-all"
            >
              <Crosshair size={15} /> ใช้ GPS ตำแหน่งปัจจุบัน
            </button>
            <button
              disabled={!userPinLoc || userPinSaving}
              onClick={async () => {
                if (!userPinLoc) return;
                setUserPinSaving(true);
                await handleUpdateUserLocation(userPinLoc);
                setUserPinSaving(false);
                setUserPinLoc(null);
                setProfileSubView('main');
              }}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                userPinLoc && !userPinSaving
                  ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-95 shadow-lg shadow-blue-100'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {userPinSaving
                ? <><Save size={16} className="animate-spin" /> กำลังบันทึก...</>
                : <><MapPin size={16} /> บันทึกตำแหน่งของฉัน</>}
            </button>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-bold">📋 ตำแหน่งของฉันมีผลต่อ:</p>
            <p>• <strong>ร้านค้า</strong> — เรียงตามระยะทางจากตำแหน่งของคุณ</p>
            <p>• <strong>ค่าส่ง</strong> — คำนวณจากตำแหน่งร้านถึงตำแหน่งของคุณ</p>
            <p>• <strong>ส่งพัสดุ</strong> — ใช้เป็นตำแหน่งเริ่มต้นของจุดรับ</p>
          </div>
        </div>

      ) : profileSubView === 'address' ? (
        <div className="p-4 pt-0">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg">ที่อยู่ของฉัน</h3>
            <button
              onClick={() => { setNewAddrMode(v => !v); setEditingAddrId(null); }}
              className={`text-sm font-bold px-3 py-1.5 rounded-full flex items-center gap-1 ${newAddrMode ? 'bg-gray-200 text-gray-600' : 'bg-green-500 text-white'}`}
            >
              {newAddrMode ? '✕ ยกเลิก' : <><Plus size={14} /> เพิ่มที่อยู่</>}
            </button>
          </div>

          <div className="space-y-3 mb-5">
            {userAddresses.map(addr => (
              <div key={addr.id}>
                <div className={`border-2 rounded-xl overflow-hidden transition-all ${editingAddrId === addr.id ? 'border-blue-400' : 'border-gray-200'}`}>
                  <div className="p-3 flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold flex items-center gap-1">
                        <MapPin size={15} className="text-green-500 flex-shrink-0" />
                        {addr.label}
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{addr.address}</p>
                      {addr.location && (
                        <p className="text-gray-400 text-[10px] mt-0.5">
                          {addr.location.lat.toFixed(4)}, {addr.location.lng.toFixed(4)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 ml-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          if (editingAddrId === addr.id) {
                            setEditingAddrId(null); setEditAddrPinLoc(null);
                          } else {
                            setEditingAddrId(addr.id);
                            setEditAddrPinLoc(null);
                            setNewAddrMode(false);
                          }
                        }}
                        className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-0.5 ${editingAddrId === addr.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-500'}`}
                      >
                        <MapPin size={13} /> {editingAddrId === addr.id ? 'ปิด' : 'แก้หมุด'}
                      </button>
                      <button
                        onClick={() => handleDeleteAddress(addr.id)}
                        className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:bg-red-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {editingAddrId === addr.id && (
                    <div className="border-t border-blue-100 bg-blue-50 p-3">
                      <p className="text-xs text-blue-700 font-bold mb-2">📍 แตะแผนที่เพื่อย้ายหมุดที่อยู่นี้</p>
                      <div className="rounded-xl overflow-hidden border-2 border-blue-300 mb-2">
                        <InteractiveMap
                          mode="select"
                          userLocation={editAddrPinLoc || addr.location || userProfile.location}
                          onLocationSelect={loc => setEditAddrPinLoc(loc)}
                          className="h-56"
                        />
                      </div>
                      {editAddrPinLoc && (
                        <p className="text-xs text-blue-600 font-bold mb-2 text-center">
                          🔵 เลือกแล้ว: {editAddrPinLoc.lat.toFixed(4)}, {editAddrPinLoc.lng.toFixed(4)}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            navigator.geolocation?.getCurrentPosition(
                              pos => setEditAddrPinLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                              () => notifySystem('ไม่สามารถดึง GPS', 'กรุณาแตะแผนที่แทน', 'error'),
                              { enableHighAccuracy: true, timeout: 8000 },
                            );
                          }}
                          className="flex-1 py-2 rounded-lg bg-white border border-blue-200 text-blue-600 text-xs font-bold flex items-center justify-center gap-1 hover:bg-blue-50"
                        >
                          <Crosshair size={13} /> GPS ปัจจุบัน
                        </button>
                        <button
                          disabled={!editAddrPinLoc || editAddrSaving}
                          onClick={async () => {
                            if (!editAddrPinLoc) return;
                            setEditAddrSaving(true);
                            await handleUpdateAddress(addr.id, editAddrPinLoc);
                            setEditAddrSaving(false);
                            setEditingAddrId(null);
                            setEditAddrPinLoc(null);
                          }}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                            editAddrPinLoc && !editAddrSaving
                              ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-95'
                              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {editAddrSaving
                            ? <><Save size={13} className="animate-spin" /> บันทึก...</>
                            : <><Save size={13} /> บันทึกหมุด</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {userAddresses.length === 0 && !newAddrMode && (
              <div className="text-center py-10 text-gray-400">
                <MapPin size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">ยังไม่มีที่อยู่ กดปุ่ม "เพิ่มที่อยู่" เพื่อเพิ่ม</p>
              </div>
            )}
          </div>

          {newAddrMode && (
            <div className="bg-gray-50 border-2 border-green-200 p-4 rounded-2xl">
              <h4 className="font-bold text-green-700 mb-3 flex items-center gap-1"><MapPin size={15} /> เพิ่มที่อยู่ใหม่</h4>
              <div className="rounded-xl overflow-hidden border-2 border-green-300 mb-2">
                <InteractiveMap
                  mode="select"
                  userLocation={newAddr.location || userProfile.location}
                  onLocationSelect={handleMapLocationSelect}
                  className="h-60"
                />
              </div>
              <p className="text-[10px] text-gray-400 text-center mb-3">แตะบนแผนที่เพื่อปักหมุดตำแหน่ง</p>
              <button
                onClick={getCurrentLocationForForm}
                className="w-full py-2 rounded-lg bg-white border border-green-200 text-green-600 text-sm font-bold mb-3 flex items-center justify-center gap-1 hover:bg-green-50 active:scale-95 transition-all"
              >
                <Crosshair size={14} /> ใช้ GPS ตำแหน่งปัจจุบัน
              </button>
              {newAddr.location && (
                <p className="text-xs text-green-600 font-bold text-center mb-3">
                  ✅ ปักหมุดแล้ว: {newAddr.location.lat.toFixed(4)}, {newAddr.location.lng.toFixed(4)}
                </p>
              )}
              <input
                value={newAddr.label}
                onChange={e => setNewAddr({ ...newAddr, label: e.target.value })}
                placeholder="ชื่อสถานที่ เช่น บ้าน, ที่ทำงาน"
                className="w-full p-2.5 border rounded-lg mb-2 text-sm"
              />
              <textarea
                value={newAddr.fullAddr}
                onChange={e => setNewAddr({ ...newAddr, fullAddr: e.target.value })}
                placeholder="รายละเอียดเพิ่มเติม / จุดสังเกต (ไม่บังคับ)"
                rows={2}
                className="w-full p-2.5 border rounded-lg mb-3 text-sm resize-none"
              />
              <button
                onClick={() => {
                  if (!newAddr.label) return notifySystem('ผิดพลาด', 'กรุณาใส่ชื่อสถานที่', 'error');
                  if (!newAddr.location) return notifySystem('ผิดพลาด', 'กรุณาปักหมุดบนแผนที่ก่อน', 'error');
                  const addrText = newAddr.fullAddr || `${newAddr.location.lat.toFixed(5)}, ${newAddr.location.lng.toFixed(5)}`;
                  handleAddAddress({ ...newAddr, fullAddr: addrText });
                  setNewAddr({ label: '', fullAddr: '', location: null });
                  setNewAddrMode(false);
                }}
                className="w-full bg-green-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-500 active:scale-95 transition-all"
              >
                <Save size={16} /> บันทึกที่อยู่
              </button>
            </div>
          )}
        </div>

      ) : profileSubView === 'edit_profile' ? (
        <div className="p-4 pt-0">
          <div className="flex justify-center mb-6">
            <label className="w-24 h-24 bg-gray-200 rounded-full overflow-hidden relative cursor-pointer">
              <img
                src={tempProfile.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(tempProfile.name || 'User') + '&background=fb923c&color=fff&size=96'}
                className="w-full h-full object-cover"
                alt="profile"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                {profileUploading ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Camera />}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handleProfilePhotoChange} disabled={profileUploading} />
            </label>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm text-gray-500">ชื่อ-นามสกุล</label><input value={tempProfile.name} onChange={e => setTempProfile({ ...tempProfile, name: e.target.value })} className="w-full border-b py-2 outline-none font-medium text-lg" /></div>
            <div><label className="text-sm text-gray-500">เบอร์โทรศัพท์</label><input value={tempProfile.phone} onChange={e => setTempProfile({ ...tempProfile, phone: e.target.value })} className="w-full border-b py-2 outline-none font-medium text-lg" /></div>
            <div><label className="text-sm text-gray-500">อีเมล</label><input value={tempProfile.email} onChange={e => setTempProfile({ ...tempProfile, email: e.target.value })} className="w-full border-b py-2 outline-none font-medium text-lg" /></div>
            <button
              onClick={handleSaveProfile}
              disabled={profileUploading}
              className={`w-full bg-green-600 text-white py-3 rounded-lg font-bold mt-8 transition-opacity ${profileUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {profileUploading ? 'กำลังอัปโหลดรูป...' : 'บันทึกการเปลี่ยนแปลง'}
            </button>
          </div>
        </div>

      ) : profileSubView === 'reg_merchant' ? (
        <div className="p-4 pt-0">
          <div className="bg-orange-50 p-4 rounded-xl mb-6 text-center">
            <ChefHat size={48} className="text-orange-500 mx-auto mb-2" />
            <h2 className="text-xl font-bold text-orange-700">ลงทะเบียนร้านค้า (KYC)</h2>
          </div>
          <div className="space-y-4">
            <div><label className="font-bold mb-1 block">ชื่อร้านค้า</label><input value={merchantRegForm.shopName} onChange={e => setMerchantRegForm({ ...merchantRegForm, shopName: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
            <div className="mb-4">
              <label className="text-sm mb-1 block">รูปหน้าร้าน (Shop Image)</label>
              <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${merchantRegForm.shopImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                {merchantRegForm.shopImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                <input type="file" accept="image/*" className="hidden" onChange={e => handleRegistrationPhotoSelect(e, setMerchantRegForm, 'shopImage')} />
              </label>
              {merchantRegForm.shopImage && <img src={merchantRegForm.shopImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="shop" />}
            </div>
            <div><label className="font-bold mb-1 block">หมวดหมู่</label>
              <select value={merchantRegForm.category} onChange={e => setMerchantRegForm({ ...merchantRegForm, category: e.target.value })} className="w-full border p-2 rounded-lg">
                <option>Street Food</option><option>Fast Food</option><option>Japanese</option><option>Italian</option><option>Dessert</option>
              </select>
            </div>
            <div className="pt-2 border-t mt-2">
              <h4 className="font-bold text-gray-700 mb-2">ข้อมูลเจ้าของร้าน (ยืนยันตัวตน)</h4>
              <div><label className="text-sm mb-1 block">ชื่อ-นามสกุล</label><input value={merchantRegForm.realName} onChange={e => setMerchantRegForm({ ...merchantRegForm, realName: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
              <div><label className="text-sm mb-1 block">เลขบัตรประชาชน</label><input value={merchantRegForm.idCard} onChange={e => setMerchantRegForm({ ...merchantRegForm, idCard: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
              <div><label className="text-sm mb-1 block">เบอร์โทรศัพท์</label><input value={merchantRegForm.phone} onChange={e => setMerchantRegForm({ ...merchantRegForm, phone: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div><label className="text-sm mb-1 block">ธนาคาร</label><input value={merchantRegForm.bankName} onChange={e => setMerchantRegForm({ ...merchantRegForm, bankName: e.target.value })} className="w-full border p-2 rounded-lg" placeholder="กสิกร, ไทยพาณิชย์..." /></div>
                <div><label className="text-sm mb-1 block">เลขที่บัญชี</label><input value={merchantRegForm.bankAccount} onChange={e => setMerchantRegForm({ ...merchantRegForm, bankAccount: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
              </div>
              <div className="mb-4">
                <label className="text-sm mb-1 block">รูปถ่ายบัตรประชาชน</label>
                <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${merchantRegForm.idCardImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                  {merchantRegForm.idCardImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleRegistrationPhotoSelect(e, setMerchantRegForm, 'idCardImage')} />
                </label>
                {merchantRegForm.idCardImage && <img src={merchantRegForm.idCardImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="id" />}
              </div>
            </div>
            <button
              disabled={merchantSubmitting}
              onClick={async () => {
                setMerchantSubmitting(true);
                const ok = await requestRegisterMerchant(merchantRegForm);
                setMerchantSubmitting(false);
                if (ok) {
                  setMerchantRegForm(MERCHANT_FORM_INIT);
                  setProfileSubView('main');
                }
              }}
              className="w-full bg-orange-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {merchantSubmitting
                ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> กำลังส่งข้อมูล...</>
                : 'ส่งใบสมัครร้านค้า'}
            </button>
          </div>
        </div>

      ) : (
        <div className="p-4 pt-0">
          <div className="bg-blue-50 p-4 rounded-xl mb-6 text-center">
            <Bike size={48} className="text-blue-500 mx-auto mb-2" />
            <h2 className="text-xl font-bold text-blue-700">สมัครขับ BoomRider (KYC)</h2>
          </div>
          <div className="space-y-4">
            <div><label className="font-bold mb-1 block">ชื่อ-นามสกุล (ผู้ขับขี่)</label><input value={riderRegForm.realName} onChange={e => setRiderRegForm({ ...riderRegForm, realName: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
            <div><label className="font-bold mb-1 block">ประเภทพาหนะ</label>
              <select value={riderRegForm.vehicle} onChange={e => setRiderRegForm({ ...riderRegForm, vehicle: e.target.value })} className="w-full border p-2 rounded-lg">
                <option value="Motorcycle">รถจักรยานยนต์</option><option value="Car">รถยนต์</option>
              </select>
            </div>
            <div className="pt-2 border-t mt-2">
              <h4 className="font-bold text-gray-700 mb-2">ข้อมูลยืนยันตัวตน</h4>
              <div><label className="text-sm mb-1 block">เลขบัตรประชาชน</label><input value={riderRegForm.idCard} onChange={e => setRiderRegForm({ ...riderRegForm, idCard: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
              <div><label className="text-sm mb-1 block">เบอร์โทรศัพท์</label><input value={riderRegForm.phone} onChange={e => setRiderRegForm({ ...riderRegForm, phone: e.target.value })} className="w-full border p-2 rounded-lg mb-2" /></div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div><label className="text-sm mb-1 block">ธนาคาร</label><input value={riderRegForm.bankName} onChange={e => setRiderRegForm({ ...riderRegForm, bankName: e.target.value })} className="w-full border p-2 rounded-lg" placeholder="กสิกร, ไทยพาณิชย์..." /></div>
                <div><label className="text-sm mb-1 block">เลขที่บัญชี</label><input value={riderRegForm.bankAccount} onChange={e => setRiderRegForm({ ...riderRegForm, bankAccount: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
              </div>
              <div className="mb-2">
                <label className="text-sm mb-1 block">รูปถ่ายบัตรประชาชน <span className="text-red-500">*</span></label>
                <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${riderRegForm.idCardImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                  {riderRegForm.idCardImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleRegistrationPhotoSelect(e, setRiderRegForm, 'idCardImage')} />
                </label>
                {riderRegForm.idCardImage && <img src={riderRegForm.idCardImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="id" />}
              </div>
              <div className="mb-4">
                <label className="text-sm mb-1 block">รูปโปรไฟล์ไรเดอร์ (ไม่บังคับ)</label>
                <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block ${riderRegForm.profileImage ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                  {riderRegForm.profileImage ? <><Check className="inline mr-1" /> เลือกแล้ว</> : <><Camera className="inline mr-1" /> ถ่ายรูป/เลือกรูป</>}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleRegistrationPhotoSelect(e, setRiderRegForm, 'profileImage')} />
                </label>
                {riderRegForm.profileImage && <img src={riderRegForm.profileImage} className="mt-2 h-32 w-full object-cover rounded-lg" alt="profile" />}
              </div>
            </div>
            <button
              disabled={riderSubmitting}
              onClick={async () => {
                setRiderSubmitting(true);
                const ok = await requestRegisterRider(riderRegForm);
                setRiderSubmitting(false);
                if (ok) {
                  setRiderRegForm(RIDER_FORM_INIT);
                  setProfileSubView('main');
                }
              }}
              className="w-full bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {riderSubmitting
                ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> กำลังส่งข้อมูล...</>
                : 'ส่งใบสมัครไรเดอร์'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
