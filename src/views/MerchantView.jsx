import React, { useState } from 'react';
import {
  ChefHat, LogOut, Camera, ToggleRight, ToggleLeft,
  Plus, Edit, Trash2, Save,
  Image as ImageIcon, Check, MapPin, Loader, Bell,
  Clock, CheckCircle, History, X, XCircle, Wallet,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STATUS_LABELS } from '../constants';
import { formatDateTimeFromMs } from '../utils';
import InteractiveMap from '../components/InteractiveMap';

export default function MerchantView() {
  const {
    activeRole, setActiveRole,
    merchantTab, setMerchantTab,
    orders, restaurants, menuItems,
    userProfile, currentUser,
    appConfig,
    isEditingMenu, setIsEditingMenu,
    editForm, setEditForm,
    handleToggleShopStatus,
    handleAddMenuItem, handleEditMenuItem,
    handleDeleteMenuItem, handleToggleItemAvailability,
    handleShopPhotoChange,
    handleMenuPhotoSelect,
    openChatWindow,
    updateOrderStatus,
    notifySystem,
    profileSubView, setProfileSubView,
    setActiveTab,
    syncRoles, grantRole, userRoles,
    handleUpdateShopLocation,
    initiateCancelOrder,
    requestCancelByRole,
    showCancelModal, setShowCancelModal,
    selectedOrderToCancel,
    cancelReasonInput, setCancelReasonInput,
    userWallet, walletHistory,
  } = useApp();

  const [pendingShopLocation, setPendingShopLocation] = useState(null);
  const [savingShopLocation, setSavingShopLocation] = useState(false);

  const myShop = restaurants.find(r => r.ownerId === userProfile.id || r.ownerId === currentUser?.id);

  // กลุ่ม orders แยกตาม status
  const myOrders = myShop ? orders.filter(o => o.type === 'food' && o.restaurantId === myShop.id) : [];
  const newOrders     = myOrders.filter(o => o.status === 'pending');
  const activeOrders  = myOrders.filter(o => ['preparing', 'ready_to_pickup', 'rider_accepted', 'picking_up', 'delivering'].includes(o.status));
  const doneOrders    = myOrders.filter(o => ['delivered', 'completed', 'cancelled'].includes(o.status));

  const myRevenue = myOrders
    .filter(o => ['delivered', 'completed'].includes(o.status))
    .reduce((sum, o) => sum + (o.merchantIncome || 0), 0);

  const openEditMenu = (item) => {
    setIsEditingMenu(item ? item.id : 'new');
    setEditForm(item ? { ...item } : { name: '', price: '', desc: '', image: '' });
  };

  const saveMenu = () => {
    if (!editForm.name || !editForm.price) return notifySystem("ผิดพลาด", "กรุณากรอกชื่อและราคา", "error");
    if (isEditingMenu === 'new') {
      handleAddMenuItem(myShop.id, { ...editForm, price: parseFloat(editForm.price) });
    } else {
      handleEditMenuItem(myShop.id, isEditingMenu, { ...editForm, price: parseFloat(editForm.price) });
    }
    setIsEditingMenu(null);
  };

  if (!myShop) return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
      <ChefHat size={56} className="text-gray-300 mb-4" />
      <h2 className="text-xl font-bold text-gray-700 mb-2">ยังไม่มีร้านค้าในระบบ</h2>
      <p className="text-gray-500 text-sm mb-2">อาจเกิดจากการสมัครยังไม่ผ่านการอนุมัติ</p>
      <p className="text-xs text-gray-400 mb-2">ID: {userProfile.id || currentUser?.id}</p>
      <p className="text-xs text-gray-400 mb-6">สิทธิ์: {userRoles.join(', ')}</p>
      <button
        onClick={() => { syncRoles(); notifySystem("กำลังตรวจสอบ", "โหลดข้อมูลล่าสุดแล้ว", "info"); }}
        className="bg-blue-500 text-white px-6 py-3 rounded-xl font-bold mb-3 shadow w-full max-w-xs"
      >🔄 ตรวจสอบสถานะอีกครั้ง</button>
      <button
        onClick={() => { setActiveRole('customer'); setProfileSubView('reg_merchant'); setActiveTab('profile'); }}
        className="bg-orange-500 text-white px-6 py-3 rounded-xl font-bold mb-3 shadow w-full max-w-xs"
      >สมัครเปิดร้านใหม่</button>
      <button onClick={() => setActiveRole('customer')} className="text-gray-500 text-sm underline">กลับหน้าหลัก</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pt-14 pb-10">
      <header className="bg-white shadow p-4 mb-4 sticky top-0 z-30">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-xl font-bold flex items-center"><ChefHat className="mr-2 text-green-600" /> จัดการร้านค้า</h1>
          <button onClick={() => setActiveRole('customer')} className="flex items-center text-sm bg-gray-200 px-3 py-1 rounded-full hover:bg-gray-300"><LogOut size={14} className="mr-1" /> ออก</button>
        </div>

        {/* รูปหน้าร้าน */}
        <div className="relative h-36 w-full rounded-xl overflow-hidden mb-3 group">
          <img src={myShop.image} className="w-full h-full object-cover" alt="shop" />
          <label className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white text-sm font-bold">
            <Camera className="mr-2" size={18} /> เปลี่ยนรูปหน้าร้าน
            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleShopPhotoChange(myShop.id, e)} />
          </label>
        </div>

        <div className="flex justify-between items-center mb-3">
          <div>
            <div className="font-bold text-lg">{myShop.name}</div>
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <span className={myShop.status === 'open' ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>
                ● {myShop.status === 'open' ? 'เปิดอยู่' : 'ปิดอยู่'}
              </span>
              {myShop.location && myShop.location.lat !== 13.7563 && (
                <span className="text-gray-400 ml-1">
                  · 📍 {myShop.location.lat.toFixed(3)}, {myShop.location.lng.toFixed(3)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => handleToggleShopStatus(myShop.id)}
            className={`px-4 py-2 rounded-lg font-bold text-white text-sm flex items-center ${myShop.status === 'open' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
          >
            {myShop.status === 'open' ? <><ToggleRight className="mr-1" size={16} /> ปิดร้าน</> : <><ToggleLeft className="mr-1" size={16} /> เปิดร้าน</>}
          </button>
        </div>

        {/* รายได้วันนี้ */}
        <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 flex justify-between items-center mb-3">
          <span className="text-gray-600 text-sm">รายได้สุทธิ (สำเร็จแล้ว)</span>
          <span className="text-xl font-bold text-green-700">฿{myRevenue.toFixed(0)}</span>
        </div>

        {/* Tab bar */}
        <div className="flex bg-gray-100 p-1 rounded-lg gap-1">
          <button
            onClick={() => setMerchantTab('orders')}
            className={`flex-1 py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1 relative ${merchantTab === 'orders' ? 'bg-white shadow text-orange-600' : 'text-gray-500'}`}
          >
            <Bell size={13} />
            ออเดอร์ใหม่
            {newOrders.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {newOrders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setMerchantTab('active')}
            className={`flex-1 py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1 ${merchantTab === 'active' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            <Clock size={13} />
            กำลังทำ ({activeOrders.length})
          </button>
          <button
            onClick={() => setMerchantTab('menu')}
            className={`flex-1 py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1 ${merchantTab === 'menu' ? 'bg-white shadow text-green-600' : 'text-gray-500'}`}
          >
            <ChefHat size={13} />
            เมนู
          </button>
          <button
            onClick={() => setMerchantTab('location')}
            className={`flex-1 py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1 ${merchantTab === 'location' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            <MapPin size={13} />
            ที่ตั้ง
          </button>
          <button
            onClick={() => setMerchantTab('wallet')}
            className={`flex-1 py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1 ${merchantTab === 'wallet' ? 'bg-white shadow text-green-600' : 'text-gray-500'}`}
          >
            <Wallet size={13} />
            กระเป๋า
          </button>
        </div>
      </header>

      {/* ── ออเดอร์ใหม่ (pending) ─────────────────────────────────────── */}
      {merchantTab === 'orders' && (
        <div className="px-4">
          {newOrders.length === 0 ? (
            <div className="text-center text-gray-400 mt-16 py-8">
              <Bell size={44} className="mx-auto mb-3 opacity-20" />
              <p className="font-bold text-gray-500">ไม่มีออเดอร์ใหม่</p>
              <p className="text-xs text-gray-400 mt-1">ออเดอร์ใหม่จะแสดงที่นี่พร้อมเสียงแจ้งเตือน</p>
            </div>
          ) : (
            <div className="space-y-4">
              {newOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  updateOrderStatus={updateOrderStatus}
                  onCancel={initiateCancelOrder}
                  highlight="orange"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── กำลังทำ / รอไรเดอร์ ───────────────────────────────────────── */}
      {merchantTab === 'active' && (
        <div className="px-4">
          {activeOrders.length === 0 ? (
            <div className="text-center text-gray-400 mt-16 py-8">
              <Clock size={44} className="mx-auto mb-3 opacity-20" />
              <p className="font-bold text-gray-500">ไม่มีออเดอร์ที่กำลังดำเนินการ</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  updateOrderStatus={updateOrderStatus}
                  onCancel={initiateCancelOrder}
                  highlight="blue"
                />
              ))}
            </div>
          )}
          {/* ประวัติย่อ */}
          {doneOrders.length > 0 && (
            <div className="mt-6">
              <h4 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><History size={12} /> เสร็จสิ้น ({doneOrders.length})</h4>
              <div className="space-y-2">
                {doneOrders.slice(0, 10).map(order => (
                  <div key={order.id} className="bg-white p-3 rounded-lg border border-gray-100 flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-gray-700">#{order.id.slice(-6)}</span>
                      <span className="text-xs text-gray-400 ml-2">{order.customerName}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-bold ${['delivered','completed'].includes(order.status) ? 'text-green-600' : 'text-red-400'}`}>
                        {['delivered','completed'].includes(order.status) ? `+฿${(order.merchantIncome||0).toFixed(0)}` : 'ยกเลิก'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── จัดการเมนู ────────────────────────────────────────────────── */}
      {merchantTab === 'menu' && (
        <div className="px-4">
          {!isEditingMenu ? (
            <>
              <button
                onClick={() => openEditMenu(null)}
                className="w-full bg-green-100 text-green-700 py-3 rounded-xl font-bold mb-4 border-2 border-green-200 flex items-center justify-center"
              >
                <Plus className="mr-2" /> เพิ่มเมนูใหม่
              </button>
              <div className="space-y-4">
                {(menuItems[myShop.id] || []).map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm flex items-start">
                    {item.image && <img src={item.image} className="w-16 h-16 rounded-lg bg-gray-200 object-cover mr-4 flex-shrink-0" alt={item.name} />}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <h3 className="font-bold truncate">{item.name}</h3>
                        <div className="flex space-x-1 ml-2 flex-shrink-0">
                          <button onClick={() => openEditMenu(item)} className="p-1 bg-gray-100 rounded text-gray-600"><Edit size={16} /></button>
                          <button onClick={() => handleDeleteMenuItem(myShop.id, item.id)} className="p-1 bg-red-100 rounded text-red-600"><Trash2 size={16} /></button>
                        </div>
                      </div>
                      <p className="text-gray-500 text-xs mb-2 line-clamp-1">{item.desc}</p>
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-green-600">฿{item.price}</span>
                        <button
                          onClick={() => handleToggleItemAvailability(myShop.id, item.id)}
                          className={`px-3 py-1 rounded-full text-xs font-bold ${item.available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                        >
                          {item.available ? 'มีขาย' : 'หมด'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(menuItems[myShop.id] || []).length === 0 && (
                  <p className="text-gray-400 text-center py-8 text-sm">ยังไม่มีเมนู กดปุ่มด้านบนเพื่อเพิ่ม</p>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white p-6 rounded-xl shadow-lg">
              <h3 className="font-bold text-lg mb-4">{isEditingMenu === 'new' ? 'เพิ่มเมนูใหม่' : 'แก้ไขเมนู'}</h3>
              <div className="space-y-3">
                <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder="ชื่ออาหาร" className="w-full border p-2 rounded" />
                <input type="number" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} placeholder="ราคา (บาท)" className="w-full border p-2 rounded" />
                <textarea value={editForm.desc} onChange={e => setEditForm({ ...editForm, desc: e.target.value })} placeholder="รายละเอียด" className="w-full border p-2 rounded" />
                <div className="mb-2">
                  <label className="block text-sm text-gray-500 mb-1">รูปภาพอาหาร</label>
                  <label className={`w-full border-2 border-dashed p-4 rounded-lg text-center cursor-pointer block text-gray-500 hover:bg-gray-50 ${editForm._imageUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                    {editForm._imageUploading ? (
                      <div className="flex flex-col items-center py-2">
                        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <span className="text-xs text-green-600">กำลังอัปโหลดรูป...</span>
                      </div>
                    ) : editForm.image ? (
                      <div className="relative">
                        <img src={editForm.image} className="h-32 w-full object-cover rounded-lg mx-auto" alt="food" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 hover:opacity-100 rounded-lg transition-opacity">
                          <Camera className="mr-2" /> เปลี่ยนรูป
                        </div>
                      </div>
                    ) : (
                      <><ImageIcon className="mx-auto mb-2 text-gray-400" /><span>กดเพื่อเลือกรูป หรือ ถ่ายรูป</span></>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handleMenuPhotoSelect} />
                  </label>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setIsEditingMenu(null)} className="flex-1 bg-gray-200 py-3 rounded font-bold">ยกเลิก</button>
                  <button
                    onClick={saveMenu}
                    disabled={!!editForm._imageUploading}
                    className={`flex-1 py-3 rounded font-bold text-white ${editForm._imageUploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600'}`}
                  >
                    {editForm._imageUploading ? 'กำลังอัปโหลด...' : 'บันทึก'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ที่ตั้งร้านค้า ─────────────────────────────────────────────── */}
      {merchantTab === 'location' && (
        <div className="px-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-blue-100 mb-4">
            <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
              <MapPin size={16} className="text-blue-500" /> ที่ตั้งร้านค้าของคุณ
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              ตำแหน่งนี้ใช้แสดงระยะทางให้ลูกค้า และส่งงานให้ไรเดอร์ในรัศมี {appConfig?.riderRadius || 5} กม. — <strong>ต้องตั้งให้ถูกต้อง</strong>
            </p>

            {/* ตำแหน่งปัจจุบัน */}
            <div className="text-xs text-gray-500 mb-3 space-y-0.5">
              <div>
                📍 ที่ตั้งร้านตอนนี้:{' '}
                {myShop.location
                  ? `${myShop.location.lat.toFixed(4)}, ${myShop.location.lng.toFixed(4)}`
                  : <span className="text-red-400 font-bold">ยังไม่ได้ตั้ง</span>}
              </div>
              {pendingShopLocation && (
                <div className="text-blue-600 font-bold">
                  🔵 เลือกใหม่: {pendingShopLocation.lat.toFixed(4)}, {pendingShopLocation.lng.toFixed(4)}
                </div>
              )}
            </div>

            {/* แผนที่ */}
            <div className="rounded-xl overflow-hidden border-2 border-blue-200 mb-3">
              <InteractiveMap
                mode="select"
                userLocation={pendingShopLocation || myShop.location}
                onLocationSelect={(loc) => setPendingShopLocation(loc)}
                className="h-64"
              />
            </div>
            <p className="text-[10px] text-gray-400 mb-3 text-center">แตะบนแผนที่เพื่อปักหมุดที่ตั้งร้านค้า</p>

            {/* GPS อัตโนมัติ */}
            <button
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                  pos => setPendingShopLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => notifySystem('ไม่สามารถดึง GPS', 'กรุณาแตะแผนที่เพื่อเลือกตำแหน่ง', 'error'),
                  { enableHighAccuracy: true, timeout: 8000 },
                );
              }}
              className="w-full py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-bold mb-2 hover:bg-gray-200 active:scale-95 transition-all"
            >
              📡 ใช้ GPS ปัจจุบันเป็นที่ตั้งร้าน
            </button>

            {/* บันทึก */}
            <button
              disabled={!pendingShopLocation || savingShopLocation}
              onClick={async () => {
                if (!pendingShopLocation) return;
                setSavingShopLocation(true);
                handleUpdateShopLocation(myShop.id, pendingShopLocation);
                setPendingShopLocation(null);
                setSavingShopLocation(false);
              }}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                pendingShopLocation && !savingShopLocation
                  ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-95'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {savingShopLocation ? (
                <><Loader size={16} className="animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><MapPin size={16} /> บันทึกที่ตั้งร้าน</>
              )}
            </button>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-bold">📋 ที่ตั้งร้านมีผลต่อ:</p>
            <p>• <strong>ลูกค้า</strong> — เห็นร้านคุณเรียงตามระยะทางจากตำแหน่งลูกค้า</p>
            <p>• <strong>ไรเดอร์</strong> — รับงานจากร้านในรัศมี {appConfig?.riderRadius || 5} กม. จากจุดรับงานของไรเดอร์</p>
            <p>• <strong>แผนที่</strong> — ลูกค้าเห็นหมุดร้านถูกต้องบนแผนที่</p>
          </div>
        </div>
      )}


      {/* ── กระเป๋าเงิน ───────────────────────────────────────────────── */}
      {merchantTab === 'wallet' && (
        <div className="px-4">
          {/* ยอดคงเหลือ */}
          <div className="bg-gradient-to-r from-green-600 to-green-500 rounded-2xl p-5 mb-4 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} />
              <span className="text-green-100 text-sm">ยอดเงินคงเหลือ</span>
            </div>
            <div className="text-3xl font-bold">฿{(userWallet ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-green-200 text-xs mt-1">รายได้จากออเดอร์จะเข้ากระเป๋าอัตโนมัติ</div>
          </div>

          {/* ประวัติธุรกรรม */}
          <h3 className="font-bold text-base mb-3 text-gray-700">ประวัติธุรกรรม</h3>
          {!walletHistory || walletHistory.length === 0 ? (
            <div className="text-center text-gray-400 py-10">
              <Wallet size={36} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">ยังไม่มีประวัติ</p>
              <p className="text-xs mt-1 text-gray-400">รายได้จะแสดงเมื่อออเดอร์ส่งสำเร็จ</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...(walletHistory)].sort((a, b) => {
                  const ms = (e) => e.createdAtMs || parseInt(((e.id || '').match(/\d{10,}/) || ['0'])[0], 10);
                  return ms(b) - ms(a);
                }).slice(0, 50).map((tx, i) => {
                const amt = tx.amount ?? 0;
                const isIncome = amt >= 0;
                return (
                  <div key={tx.id || i} className="flex justify-between items-center gap-3 p-3.5 bg-white rounded-xl border border-gray-100 shadow-sm">
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
      )}

      {/* ── Cancel Order Modal ─────────────────────────────────────────── */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            {/* Header */}
            <div className="bg-orange-500 px-5 py-4 flex justify-between items-center">
              <div className="flex items-center gap-2 text-white">
                <XCircle size={20} />
                <h3 className="font-bold text-base">ขอยกเลิกออเดอร์ (รอ Admin อนุมัติ)</h3>
              </div>
              <button onClick={() => setShowCancelModal(false)} className="text-white/80 hover:text-white">
                <X size={20} />
              </button>
            </div>
            {/* Body */}
            <div className="p-5">
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 mb-3 flex items-start gap-2">
                <span className="text-yellow-600 mt-0.5">⚠️</span>
                <p className="text-xs text-yellow-700">คำขอยกเลิกจะถูกส่งให้ <strong>Admin</strong> อนุมัติก่อน ระบบจะคืนเงินให้ลูกค้าหลัง Admin ยืนยัน</p>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                กรุณาระบุเหตุผล เพื่อให้ Admin พิจารณา
              </p>
              <div className="space-y-2 mb-4">
                {['สินค้าหมด / ร้านปิด', 'วัตถุดิบไม่พร้อม', 'ปริมาณสั่งมากเกินไป', 'อื่นๆ'].map(preset => (
                  <button
                    key={preset}
                    onClick={() => setCancelReasonInput(preset)}
                    className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-all ${
                      cancelReasonInput === preset
                        ? 'bg-red-50 border-red-400 text-red-700 font-semibold'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {cancelReasonInput === preset ? '● ' : '○ '}{preset}
                  </button>
                ))}
              </div>
              <textarea
                value={cancelReasonInput}
                onChange={e => setCancelReasonInput(e.target.value)}
                placeholder="หรือพิมพ์เหตุผลเพิ่มเติม..."
                className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                * หากลูกค้าชำระผ่าน Wallet ระบบจะคืนเงินให้อัตโนมัติ
              </p>
            </div>
            {/* Footer */}
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm hover:bg-gray-200 active:scale-95 transition-all"
              >
                ไม่ยกเลิก
              </button>
              <button
                onClick={() => {
                  requestCancelByRole(selectedOrderToCancel, cancelReasonInput, 'merchant');
                  setShowCancelModal(false);
                }}
                disabled={!cancelReasonInput.trim()}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                  cancelReasonInput.trim()
                    ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-100'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                ส่งคำขอถึง Admin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── OrderCard component ──────────────────────────────────────────────────────
function OrderCard({ order, updateOrderStatus, onCancel, highlight }) {
  const { userProfile, riders } = useApp();
  const borderColor = highlight === 'orange' ? 'border-orange-400' : 'border-blue-400';
  const badgeBg = {
    pending:         'bg-yellow-100 text-yellow-800',
    preparing:       'bg-orange-100 text-orange-800',
    ready_to_pickup: 'bg-blue-100 text-blue-800',
    rider_accepted:  'bg-indigo-100 text-indigo-800',
    picking_up:      'bg-purple-100 text-purple-800',
    delivering:      'bg-cyan-100 text-cyan-800',
  };

  // ยกเลิกได้เฉพาะก่อนที่ไรเดอร์จะรับงาน
  const canCancel = ['pending', 'preparing', 'ready_to_pickup'].includes(order.status);

  return (
    <div className={`bg-white p-4 rounded-xl shadow border-l-4 ${borderColor}`}>
      <div className="flex justify-between mb-2">
        <div>
          <span className="font-bold text-sm">#{order.id.slice(-6)}</span>
          <span className="text-xs text-gray-500 ml-2">{order.customerName}</span>
          {order.paymentMethod === 'cash' && (
            <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">💵 เก็บเงินสด</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${badgeBg[order.status] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_LABELS[order.status]?.label || order.status}
        </span>
      </div>

      {/* รายการสินค้า */}
      <div className="mb-3 text-sm bg-gray-50 rounded-lg p-2">
        {/* normalize items: รองรับทั้ง Array และ Object {0:x,1:y} จาก Firestore เก่า */}
        {(Array.isArray(order.items) ? order.items : Object.values(order.items || {})).map((item, idx) => (
          <div key={idx} className="flex justify-between text-xs">
            <span>{item?.qty}× {item?.name}</span>
            <span className="text-gray-500">฿{((item?.price ?? 0) * (item?.qty ?? 0)).toFixed(0)}</span>
          </div>
        ))}
        <div className="border-t mt-1.5 pt-1.5 flex justify-between font-bold text-sm">
          <span>รวม</span>
          <span className="text-green-600">฿{order.grandTotal}</span>
        </div>
      </div>

      {/* ── เบอร์ติดต่อ ── */}
      {(order.customerPhone || order.riderId) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {order.customerPhone && (
            <a
              href={`tel:${order.customerPhone}`}
              className="flex-1 min-w-[110px] bg-orange-50 text-orange-600 border border-orange-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center hover:bg-orange-100 active:scale-95 transition-all"
            >
              📞 <span className="ml-1">{order.customerPhone}</span>
            </a>
          )}
          {order.riderId && (() => {
            // ใช้ riderPhone จาก order ก่อน (ฝังตอน acceptOrder) fallback หา riders array
            const phone = order.riderPhone || riders.find(r => r.id === order.riderId)?.phone;
            return phone ? (
              <a
                href={`tel:${phone}`}
                className="flex-1 min-w-[110px] bg-green-50 text-green-600 border border-green-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center hover:bg-green-100 active:scale-95 transition-all"
              >
                📞 <span className="ml-1">{phone}</span>
              </a>
            ) : null;
          })()}
        </div>
      )}

      {/* ปุ่มควบคุม — สถานะออเดอร์ */}
      <div className="flex gap-2 mb-2">
        {order.status === 'pending' && (
          <button
            onClick={() => updateOrderStatus(order.id, 'preparing')}
            className="flex-1 bg-orange-500 text-white py-2 rounded-lg font-bold text-xs hover:bg-orange-600 active:scale-95 transition-all"
          >
            ✅ รับออเดอร์
          </button>
        )}
        {order.status === 'preparing' && (
          <button
            onClick={() => updateOrderStatus(order.id, 'ready_to_pickup')}
            className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-bold text-xs hover:bg-blue-600 active:scale-95 transition-all"
          >
            🛵 เรียกไรเดอร์
          </button>
        )}
        {order.status === 'ready_to_pickup' && (
          <div className="flex-1 bg-blue-50 text-blue-600 border border-blue-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center">
            ⏳ รอไรเดอร์รับงาน...
          </div>
        )}
        {['rider_accepted', 'picking_up', 'delivering'].includes(order.status) && (
          <div className="flex-1 bg-indigo-50 text-indigo-600 border border-indigo-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center">
            🛵 ไรเดอร์กำลังส่ง
          </div>
        )}
      </div>

      {/* ปุ่มยกเลิก — แสดงเฉพาะก่อนไรเดอร์รับงาน */}
      {canCancel && (
        <button
          onClick={() => onCancel(order.id)}
          className="w-full py-2 rounded-lg border border-red-300 text-red-600 bg-red-50 font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-red-100 active:scale-95 transition-all"
        >
          <XCircle size={14} /> ยกเลิกออเดอร์นี้
        </button>
      )}
    </div>
  );
}
