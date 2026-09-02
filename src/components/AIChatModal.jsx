import React, { useState, useRef, useEffect } from 'react';
import { generateAiReply } from '../lib/aiGateway.js';
import ReactDOM from 'react-dom';
import { X, Bot, Send, Loader2, Sparkles, User, ShoppingBag, Star, Store, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generateId, formatDateTime, r2, playOrderNotificationSound, getDistanceFromLatLonInKm } from '../utils';
import { autoDispatch } from '../context/hooks/useAutoDispatch';

const STATUS_MAP = {
  pending: 'รอร้านค้ารับออเดอร์',
  preparing: 'ร้านกำลังเตรียมอาหาร',
  ready_to_pickup: 'รอไรเดอร์เข้ารับสินค้า',
  rider_accepted: 'ไรเดอร์รับงานแล้ว',
  picking_up: 'ไรเดอร์กำลังรับสินค้า',
  delivering: 'ไรเดอร์กำลังเดินทางไปส่ง',
  delivered: 'จัดส่งแล้ว (รอคุณยืนยัน)',
  completed: 'เสร็จสิ้นเรียบร้อย',
  cancelled: 'ยกเลิกแล้ว',
};

const SYSTEM_PROMPT = `คุณคือ "น้องบูม (BoomBot)" ผู้ช่วยอัจฉริยะ AI ประจำแอปพลิเคชัน BoomRider (บริการสั่งอาหารและส่งพัสดุในประเทศไทย)
หน้าที่ของคุณคือบริการและช่วยเหลือผู้ใช้ด้วยความเป็นกันเอง สุภาพ มีหางเสียง (ครับ/ค่ะ)
ความสามารถพิเศษของคุณ:
1. สามารถเข้าถึงรายชื่อร้านค้าในระบบทั้งหมด และเมนูของร้านค้าทั้งหมด
2. สามารถแสดงตัวเลือกร้านค้าและเมนูอาหารเพื่อให้ลูกค้าเลือกและกดสั่งซื้อผ่านน้องบูม AI ได้ทันที
3. เช็คสถานะออเดอร์ และ ยอดเงิน Wallet
4. สามารถ "สั่งอาหาร" ให้ลูกค้าได้โดยตรง เมื่อลูกค้าระบุชื่อร้านค้าและรายการอาหาร
5. สามารถ "สั่งส่งพัสดุ / เรียกไรเดอร์" ให้ลูกค้าได้โดยตรง เมื่อลูกค้าระบุจุดรับ จุดส่ง
6. สามารถ "ส่งข้อความสื่อสาร/แจ้งเตือน" ไปยังห้องแชทของร้านค้า ไรเดอร์ หรือแอดมิน เกี่ยวกับออเดอร์ที่ดำเนินการอยู่ได้ทันที
ตอบคำถามสั้นกระชับ ชัดเจน เข้าใจง่าย ภาษาไทยเสมอ`;

const GEMINI_TOOLS = [
  {
    function_declarations: [
      {
        name: 'list_all_restaurants',
        description: 'เข้าถึงและแสดงรายชื่อร้านค้าทั้งหมดในระบบ BoomRider เพื่อให้ลูกค้าเลือกดูและสั่งซื้อ',
        parameters: {
          type: 'OBJECT',
          properties: {
            keyword: { type: 'STRING', description: 'คำค้นหาชื่อร้านค้า หรือประเภทอาหาร (ไม่ระบุก็ได้เพื่อแสดงร้านค้าทั้งหมด)' },
          },
        },
      },
      {
        name: 'get_restaurant_menu',
        description: 'ค้นหาชื่อร้านค้าและเข้าถึงรายการเมนูทั้งหมดของร้านค้านั้นๆ เพื่อให้ลูกค้าเลือกและกดสั่งซื้อ',
        parameters: {
          type: 'OBJECT',
          properties: {
            restaurantName: { type: 'STRING', description: 'ชื่อร้านค้า หรือคีย์เวิร์ดชื่อร้าน (หากไม่ระบุจะดึงร้านค้าแรกในระบบ)' },
          },
        },
      },
      {
        name: 'place_food_order',
        description: 'สั่งอาหารจากร้านค้าโดยระบุชื่อร้านค้า รายการอาหาร วิธีชำระเงิน และหมายเหตุ',
        parameters: {
          type: 'OBJECT',
          properties: {
            restaurantName: { type: 'STRING', description: 'ชื่อร้านค้า หรือคีย์เวิร์ดชื่อร้าน' },
            items: {
              type: 'ARRAY',
              description: 'รายการเมนูและจำนวนที่สั่ง',
              items: {
                type: 'OBJECT',
                properties: {
                  itemName: { type: 'STRING', description: 'ชื่อเมนูอาหาร' },
                  qty: { type: 'NUMBER', description: 'จำนวนจาน/ชิ้น' },
                },
                required: ['itemName', 'qty'],
              },
            },
            paymentMethod: { type: 'STRING', description: "วิธีชำระเงิน 'wallet' หรือ 'cash'" },
            notes: { type: 'STRING', description: 'หมายเหตุเพิ่มเติมถึงร้านค้า' },
          },
          required: ['restaurantName', 'items'],
        },
      },
      {
        name: 'place_parcel_order',
        description: 'สั่งส่งพัสดุ/เรียกไรเดอร์มารับของ โดยระบุจุดรับ จุดส่ง เบอร์ผู้รับ',
        parameters: {
          type: 'OBJECT',
          properties: {
            pickup: { type: 'STRING', description: 'จุดรับสินค้า/พัสดุ' },
            dropoff: { type: 'STRING', description: 'จุดส่งสินค้า/พัสดุ' },
            receiverName: { type: 'STRING', description: 'ชื่อผู้รับ' },
            receiverPhone: { type: 'STRING', description: 'เบอร์โทรศัพท์ผู้รับ' },
            weight: { type: 'STRING', description: 'น้ำหนักพัสดุ (กก.)' },
            paymentMethod: { type: 'STRING', description: "วิธีชำระเงิน 'wallet' หรือ 'cash'" },
          },
          required: ['pickup', 'dropoff'],
        },
      },
      {
        name: 'send_order_chat_message',
        description: 'ส่งข้อความสื่อสารหรือแจ้งเตือนไปยังห้องแชทของร้านค้า ไรเดอร์ หรือแอดมินสำหรับออเดอร์',
        parameters: {
          type: 'OBJECT',
          properties: {
            orderId: { type: 'STRING', description: "ID ของออเดอร์ หรือ 'latest' สำหรับออเดอร์ล่าสุด" },
            message: { type: 'STRING', description: 'ข้อความแจ้งเตือนหรือสื่อสารที่ต้องการส่งถึงร้านค้า/ไรเดอร์/แอดมิน' },
          },
          required: ['message'],
        },
      },
      {
        name: 'check_order_status',
        description: 'เช็คสถานะออเดอร์ปัจจุบันของผู้ใช้',
        parameters: {
          type: 'OBJECT',
          properties: {
            orderId: { type: 'STRING', description: 'ID ออเดอร์ (ไม่ระบุก็ได้)' },
          },
        },
      },
    ],
  },
];

export default function AIChatModal({ isOpen, onClose }) {
  const {
    userProfile,
    currentUser,
    orders,
    setOrders,
    userAddresses,
    userWallet,
    creditWallet,
    restaurants,
    menuItems,
    appConfig,
    notifyAdmin,
    notifySystem,
    supabase,
    activeRole,
    setSelectedRestaurant,
    addToCart,
  } = useApp();

  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: `สวัสดีครับคุณ ${userProfile?.name || currentUser?.name || 'ลูกค้า'}! 🛵✨ ผมน้องบูม AI Assistant\nผมสามารถช่วยเช็คสถานะ, ดูเมนูร้านค้า, สั่งอาหาร, เรียกไรเดอร์ส่งพัสดุ หรือส่งข้อความแจ้งเตือนไปยังร้านค้าและไรเดอร์ได้ครับ! มีอะไรให้รับใช้ไหมครับ?`,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Initialize initial welcome message if empty
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          sender: 'bot',
          text: `สวัสดีครับคุณ ${userProfile?.name || currentUser?.name || 'ลูกค้า'}! 🛵✨ ผมน้องบูม AI Assistant พร้อมดึงข้อมูลออเดอร์ ยอดเงิน Wallet และร้านอาหารมาช่วยดูแลคุณครับ วันนี้มีอะไรให้ผมช่วยไหมครับ?`,
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [userProfile?.name, currentUser?.name, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  if (!isOpen) return null;

  const quickPrompts = [
    '📦 เช็คสถานะออเดอร์',
    '💳 ยอดเงิน Wallet',
    '🚚 เรียกส่งพัสดุ',
  ];

  const currentUserId = userProfile?.id || currentUser?.id || '';
  const balanceNum = typeof userWallet === 'number' ? userWallet : Number(userWallet?.balance || 0);

  const getActiveOrders = () => {
    return (orders || []).filter(
      (o) =>
        (o.customerId === currentUserId || (!o.customerId && currentUserId)) &&
        o.status !== 'completed' &&
        o.status !== 'cancelled'
    );
  };

  const activeOrders = getActiveOrders();

  // Format real-time context for System Prompt
  const buildContextPrompt = () => {
    const activeOrderSummary = activeOrders
      .map((o, idx) => {
        const typeStr = o.type === 'parcel' ? 'ส่งพัสดุ' : `สั่งอาหาร (${o.restaurantName || 'ร้านค้า'})`;
        const statusStr = STATUS_MAP[o.status] || o.status;
        const riderStr = o.riderName ? ` | ไรเดอร์: ${o.riderName}` : '';
        return `${idx + 1}. ออเดอร์ #${o.id.slice(-6)} [${typeStr}] - สถานะ: ${statusStr} - ยอดรวม: ฿${o.grandTotal || o.total || o.amount || 0}${riderStr}`;
      })
      .join('\n');

    const openShops = (restaurants || [])
      .filter((r) => r.status === 'open')
      .slice(0, 5)
      .map((r) => `- ${r.name} (⭐ ${r.rating || 5.0}, ค่าส่ง ฿${r.deliveryFee ?? 15})`)
      .join('\n');

    return `คุณคือ "น้องบูม (BoomBot)" AI Assistant ประจำแอปพลิเคชัน BoomRider
หน้าที่ของคุณคือช่วยเหลือผู้ใช้อย่างเป็นกันเอง สุภาพ มีหางเสียง (ครับ/ค่ะ) โดยอ้างอิงข้อมูลจริงจากระบบดังนี้:

[ข้อมูลผู้ใช้ปัจจุบัน]
- ชื่อ: ${userProfile?.name || currentUser?.name || 'ลูกค้า'}
- เบอร์โทร: ${userProfile?.phone || 'ไม่ระบุ'}
- บทบาท: ${activeRole || 'customer'}
- ยอดเงินคงเหลือใน Wallet: ฿${balanceNum.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

[สถานะออเดอร์ปัจจุบันของคุณ (${activeOrders.length} รายการ)]
${activeOrderSummary || 'ไม่มีออเดอร์ที่กำลังดำเนินการในขณะนี้'}

[ร้านอาหารที่เปิดให้บริการขณะนี้]
${openShops || 'ไม่มีข้อมูลร้านค้า'}

คำสั่งสถิติตอบให้ตรงกับข้อมูลจริงด้านบนเสมอ หากผู้ใช้ถามเรื่องยอดเงิน ให้ตอบ ฿${balanceNum.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} หากถามออเดอร์ ให้ระบุสถานะและเลขท้ายออเดอร์ตรงตามข้อมูลจริงสั้นกระชับเข้าใจง่ายครับ`;
  };

  // ── Local Tool Execution Handlers ──────────────────────────────────────────

  const executeListAllRestaurants = async (args) => {
    const keyword = (args?.keyword || '').trim().toLowerCase();
    const allShops = restaurants || [];

    if (allShops.length === 0) {
      return {
        text: 'ขณะนี้ยังไม่มีรายชื่อร้านค้าในระบบครับ 🏪',
      };
    }

    let filteredShops = allShops;
    if (keyword) {
      filteredShops = allShops.filter(
        (r) =>
          r.name.toLowerCase().includes(keyword) ||
          (r.category || '').toLowerCase().includes(keyword)
      );
    }

    if (filteredShops.length === 0) {
      filteredShops = allShops;
    }

    const custLoc = userAddresses?.[0]?.location || userProfile?.location || { lat: 13.7563, lng: 100.5018 };
    const baseFee = appConfig?.baseFee || 30;
    const perKmFee = appConfig?.perKmFee || 10;

    const shopsWithDetails = filteredShops.map((shop) => {
      const shopLoc = shop.location || { lat: 13.7563, lng: 100.5018 };
      let dist = 1;
      if (custLoc?.lat && custLoc?.lng && shopLoc?.lat && shopLoc?.lng) {
        dist = getDistanceFromLatLonInKm(custLoc.lat, custLoc.lng, shopLoc.lat, shopLoc.lng);
        if (dist <= 0) dist = 1;
      }
      const fee = baseFee + Math.ceil(dist) * perKmFee;
      const itemCount = (menuItems[shop.id] || []).filter((m) => m.available !== false).length;

      return {
        ...shop,
        distance: dist.toFixed(1),
        deliveryFee: fee,
        itemCount,
      };
    });

    return {
      text: `นี่คือรายชื่อร้านค้าทั้งหมดในระบบ BoomRider ครับ 🏪✨\nคุณสามารถเลือกดูเมนูอาหาร หรือกดเข้าสู่หน้าร้านค้าเพื่อสั่งซื้อได้เลยครับ!`,
      cardData: {
        type: 'all_restaurants',
        shops: shopsWithDetails,
      },
    };
  };

  const executeGetRestaurantMenu = async (args) => {
    const targetRestName = (args?.restaurantName || '').trim();
    const allShops = restaurants || [];
    const openShops = allShops.filter((r) => r.status === 'open');

    if (allShops.length === 0) {
      return {
        text: 'ขออภัยครับ ขณะนี้ไม่มีร้านอาหารอยู่ในระบบครับ 🍔',
      };
    }

    let matchedShop = null;
    if (targetRestName) {
      matchedShop = (openShops.length > 0 ? openShops : allShops).find(
        (r) =>
          r.name.toLowerCase().includes(targetRestName.toLowerCase()) ||
          targetRestName.toLowerCase().includes(r.name.toLowerCase())
      );
    }

    if (!matchedShop && targetRestName) {
      const anyMatched = allShops.find(
        (r) =>
          r.name.toLowerCase().includes(targetRestName.toLowerCase()) ||
          targetRestName.toLowerCase().includes(r.name.toLowerCase())
      );
      if (anyMatched) {
        matchedShop = anyMatched;
      }
    }

    if (!matchedShop) {
      matchedShop = openShops[0] || allShops[0];
    }

    const shopMenuItems = (menuItems[matchedShop.id] || []).filter((m) => m.available !== false);

    const custLoc = userAddresses?.[0]?.location || userProfile?.location || { lat: 13.7563, lng: 100.5018 };
    const shopLoc = matchedShop.location || { lat: 13.7563, lng: 100.5018 };
    let distance = 1;
    if (custLoc?.lat && custLoc?.lng && shopLoc?.lat && shopLoc?.lng) {
      distance = getDistanceFromLatLonInKm(custLoc.lat, custLoc.lng, shopLoc.lat, shopLoc.lng);
      if (distance <= 0) distance = 1;
    }

    const baseFee = appConfig?.baseFee || 30;
    const perKmFee = appConfig?.perKmFee || 10;
    const deliveryFee = baseFee + Math.ceil(distance) * perKmFee;

    if (shopMenuItems.length === 0) {
      return {
        text: `ร้าน "${matchedShop.name}" ยังไม่มีรายการเมนูอาหารในระบบขณะนี้ครับ 🍔`,
      };
    }

    return {
      text: `นี่คือชื่อร้านและรายการเมนูของ "${matchedShop.name}" (${matchedShop.status === 'open' ? '🟢 เปิดให้บริการ' : '🔴 ปิดบริการ'}) ครับ 😋\nคุณสามารถกดสั่งซื้อเมนูที่ต้องการ หรือกดใส่ตะกร้าได้ทันทีครับ!`,
      cardData: {
        type: 'restaurant_menu',
        restaurant: matchedShop,
        items: shopMenuItems,
        distance: distance.toFixed(1),
        deliveryFee,
      },
    };
  };

  const executePlaceFoodOrder = async (args) => {
    const targetRestName = (args.restaurantName || '').trim();
    const openShops = (restaurants || []).filter((r) => r.status === 'open');

    if (openShops.length === 0) {
      return 'ขออภัยครับ ขณะนี้ไม่มีร้านอาหารที่เปิดให้บริการครับ 🍔';
    }

    let matchedShop = null;
    if (targetRestName) {
      matchedShop = openShops.find(
        (r) =>
          r.name.toLowerCase().includes(targetRestName.toLowerCase()) ||
          targetRestName.toLowerCase().includes(r.name.toLowerCase())
      );
    }

    if (!matchedShop) {
      if (targetRestName) {
        const availableShopNames = openShops.map((r) => `• ${r.name}`).join('\n');
        return `ขออภัยครับ ไม่พบร้าน "${targetRestName}" ที่เปิดให้บริการขณะนี้\n\nร้านที่เปิดให้บริการอยู่ในขณะนี้:\n${availableShopNames}`;
      }
      matchedShop = openShops[0];
    }

    const shopMenuItems = menuItems[matchedShop.id] || [];
    if (shopMenuItems.length === 0) {
      return `ขออภัยครับ ร้าน "${matchedShop.name}" ยังไม่มีรายการเมนูอาหารในระบบครับ`;
    }

    const orderedItems = [];
    const missingItems = [];
    const rawItems = args.items || [];

    for (const itemArg of rawItems) {
      const argName = (itemArg.itemName || '').trim().toLowerCase();
      const qty = Math.max(1, Number(itemArg.qty) || 1);
      if (!argName) continue;

      const matchedMenu = shopMenuItems.find(
        (m) =>
          m.name.toLowerCase().includes(argName) ||
          argName.includes(m.name.toLowerCase())
      );

      if (matchedMenu) {
        orderedItems.push({
          id: matchedMenu.id,
          name: matchedMenu.name,
          price: matchedMenu.price,
          qty,
        });
      } else {
        missingItems.push(itemArg.itemName);
      }
    }

    if (orderedItems.length === 0) {
      const availableMenuNames = shopMenuItems.slice(0, 8).map((m) => `• ${m.name} (฿${m.price})`).join('\n');
      return `ขออภัยครับ ไม่พบเมนูที่คุณระบุในร้าน "${matchedShop.name}"\n\nเมนูแนะนำของร้าน ${matchedShop.name}:\n${availableMenuNames}`;
    }

    // Calculate real distance using coordinates
    const custLoc = userAddresses?.[0]?.location || userProfile?.location || { lat: 13.7563, lng: 100.5018 };
    const shopLoc = matchedShop.location || { lat: 13.7563, lng: 100.5018 };
    let distance = 1;
    if (custLoc?.lat && custLoc?.lng && shopLoc?.lat && shopLoc?.lng) {
      distance = getDistanceFromLatLonInKm(custLoc.lat, custLoc.lng, shopLoc.lat, shopLoc.lng);
      if (distance <= 0) distance = 1;
    }

    const foodTotal = orderedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const baseFee = appConfig?.baseFee || 30;
    const perKmFee = appConfig?.perKmFee || 10;
    const deliveryFee = baseFee + Math.ceil(distance) * perKmFee;
    const grandTotal = Math.max(0, foodTotal + deliveryFee);

    const paymentMethod = args.paymentMethod === 'cash' ? 'cash' : 'wallet';

    if (paymentMethod === 'wallet' && balanceNum < grandTotal) {
      return `ขออภัยครับ ยอดเงินใน Wallet ไม่เพียงพอ (มียอด ฿${balanceNum.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} แต่ยอดสั่งซื้อคือ ฿${grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) กรุณาเติมเงินก่อนทำรายการครับ 💳`;
    }

    const addr = userAddresses?.[0] || { address: 'ที่อยู่ปัจจุบันของลูกค้า', location: custLoc };
    const orderId = generateId();

    const newOrder = {
      id: orderId,
      type: 'food',
      status: 'pending',
      customerId: currentUserId,
      customerName: userProfile?.name || currentUser?.name || 'ลูกค้า',
      customerPhone: userProfile?.phone || null,
      restaurantId: matchedShop.id,
      restaurantName: matchedShop.name,
      restaurantOwnerId: matchedShop.ownerId || null,
      restaurantLocation: shopLoc,
      pickupLocation: shopLoc,
      location: addr.location,
      address: addr.address,
      items: orderedItems,
      foodTotal,
      deliveryFee,
      promoDiscount: 0,
      grandTotal,
      paymentMethod,
      notes: args.notes || 'สั่งผ่านน้องบูม AI Assistant',
      createdAt: formatDateTime(),
    };

    setOrders((prev) => [newOrder, ...prev]);
    await supabase.from('orders').insert({ id: orderId, status: 'pending', data: newOrder });

    if (paymentMethod === 'wallet') {
      creditWallet(currentUserId, -grandTotal, `ชำระค่าอาหาร ออเดอร์ #${orderId.slice(-6)} (สั่งผ่าน AI)`);
    }

    notifyAdmin('🛎️ ออเดอร์ใหม่ (ผ่าน AI)', `${userProfile?.name || 'ลูกค้า'} สั่ง ${matchedShop.name} ฿${grandTotal}`, 'info');
    notifySystem('สั่งอาหารสำเร็จ! 🎉', `ออเดอร์ #${orderId.slice(-6)} ส่งไปยังร้านแล้ว`, 'success');
    playOrderNotificationSound();

    const itemListStr = orderedItems.map((i) => `• ${i.name} x${i.qty} (฿${i.price * i.qty})`).join('\n');
    let missingNote = '';
    if (missingItems.length > 0) {
      missingNote = `\n\n⚠️ หมายเหตุ: ไม่พบเมนู (${missingItems.join(', ')}) จึงเว้นรายการดังกล่าวไว้ครับ`;
    }

    return `✅ สั่งอาหารให้เรียบร้อยแล้วครับ! 🎉\n\nร้านค้า: ${matchedShop.name}\nรายการที่สั่ง:\n${itemListStr}\nค่าอาหาร: ฿${foodTotal}\nค่าจัดส่ง (${distance.toFixed(1)} กม.): ฿${deliveryFee}\nยอดรวมทั้งสิ้น: ฿${grandTotal} (${paymentMethod === 'wallet' ? 'ตัดผ่าน Wallet' : 'เงินสด'})\nเลขที่ออเดอร์: #${orderId.slice(-6)}${missingNote}\n\nระบบได้ส่งคำสั่งซื้อและแจ้งเตือนไปยังร้านค้าเรียบร้อยแล้วครับ! 🍔🔔`;
  };

  const executePlaceParcelOrder = async (args) => {
    const pickup = args.pickup || 'จุดรับของลูกค้า';
    const dropoff = args.dropoff || 'จุดส่งของปลายทาง';
    const distance = 2;
    const baseFee = appConfig?.baseFee || 30;
    const perKmFee = appConfig?.perKmFee || 10;
    const grandTotal = baseFee + Math.ceil(distance) * perKmFee;
    const paymentMethod = args.paymentMethod === 'cash' ? 'cash' : 'wallet';

    if (paymentMethod === 'wallet' && balanceNum < grandTotal) {
      return `ขออภัยครับ ยอดเงินใน Wallet ไม่เพียงพอ (มียอด ฿${balanceNum.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} แต่ค่าส่งพัสดุคือ ฿${grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) กรุณาเติมเงินก่อนครับ 💳`;
    }

    const orderId = generateId();
    const newOrder = {
      id: orderId,
      type: 'parcel',
      status: 'ready_to_pickup',
      customerId: currentUserId,
      customerName: userProfile?.name || currentUser?.name || 'ลูกค้า',
      customerPhone: userProfile?.phone || null,
      pickup,
      dropoff,
      pickupLocation: userProfile?.location,
      location: userProfile?.location,
      weight: String(args.weight || '1'),
      receiverName: args.receiverName || 'ผู้รับ',
      receiverPhone: args.receiverPhone || '',
      deliveryFee: grandTotal,
      riderIncome: r2(grandTotal * (1 - (appConfig?.gpDelivery ?? 15) / 100)),
      grandTotal,
      paymentMethod,
      notes: 'สั่งเรียกไรเดอร์ผ่านน้องบูม AI',
      createdAt: formatDateTime(),
    };

    setOrders((prev) => [newOrder, ...prev]);
    await supabase.from('orders').insert({ id: orderId, status: 'ready_to_pickup', data: newOrder });

    if (paymentMethod === 'wallet') {
      creditWallet(currentUserId, -grandTotal, `ค่าส่งพัสดุ ออเดอร์ #${orderId.slice(-6)} (สั่งผ่าน AI)`);
    }

    notifyAdmin('📦 พัสดุใหม่ (ผ่าน AI)', `${userProfile?.name || 'ลูกค้า'} ส่ง ${pickup} → ${dropoff}`, 'info');
    notifySystem('สั่งส่งพัสดุสำเร็จ! 📦', `ออเดอร์ #${orderId.slice(-6)} กำลังหาไรเดอร์`, 'success');

    autoDispatch(supabase, newOrder);

    return `✅ เรียกส่งพัสดุเรียบร้อยแล้วครับ! 📦🛵\n\nจุดรับ: ${pickup}\nจุดส่ง: ${dropoff}\nผู้รับ: ${args.receiverName || 'ไม่ระบุ'} (${args.receiverPhone || 'ไม่ระบุเบอร์'})\nค่าบริการจัดส่ง: ฿${grandTotal} (${paymentMethod === 'wallet' ? 'ตัดผ่าน Wallet' : 'เงินสด'})\nเลขที่ออเดอร์: #${orderId.slice(-6)}\n\nระบบกำลังกระจายงานแจ้งเตือนไปยังไรเดอร์บริเวณใกล้เคียงให้อัตโนมัติครับ! 🔔`;
  };

  const executeSendOrderChatMessage = async (args) => {
    const currentActiveOrders = getActiveOrders();
    let targetOrder = null;

    if (args.orderId && args.orderId !== 'latest') {
      targetOrder = (orders || []).find((o) => o.id.endsWith(args.orderId) || o.id === args.orderId);
    }
    if (!targetOrder && currentActiveOrders.length > 0) {
      targetOrder = currentActiveOrders[0];
    }

    if (!targetOrder) {
      return 'ขณะนี้ไม่พบออเดอร์ที่กำลังดำเนินการอยู่ จึงไม่สามารถส่งข้อความถึงร้านค้า/ไรเดอร์ได้ครับ 🛵';
    }

    const messageText = args.message || '';
    if (!messageText.trim()) {
      return 'กรุณาระบุข้อความที่ต้องการส่งครับ';
    }

    const newMessage = {
      text: `🤖 [ข้อความผ่านน้องบูม AI Assistant]: ${messageText}`,
      sender: 'customer',
      senderName: userProfile?.name ? `${userProfile.name} (ผ่าน AI)` : 'ลูกค้า (ผ่าน AI)',
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };

    await supabase.rpc('append_chat_message', { p_order_id: targetOrder.id, p_message: newMessage });

    notifySystem('ส่งข้อความสำเร็จ 💬', `ส่งข้อความออเดอร์ #${targetOrder.id.slice(-6)} เรียบร้อย`, 'success');

    return `💬 ส่งข้อความเรียบร้อยแล้วครับ!\n\nข้อความ: "${messageText}"\nไปยังออเดอร์: #${targetOrder.id.slice(-6)} (${targetOrder.type === 'parcel' ? 'ส่งพัสดุ' : targetOrder.restaurantName || 'ร้านค้า'})\n\nข้อความถูกบันทึกลงในห้องแชทและแจ้งเตือนไปยังร้านค้า/ไรเดอร์ทันทีครับ! ✨`;
  };

  const executeCheckOrderStatus = async (args) => {
    const userOrders = (orders || []).filter(
      (o) => o.customerId === currentUserId || (!o.customerId && currentUserId)
    );

    if (userOrders.length === 0) {
      return 'ขณะนี้คุณยังไม่มีประวัติออเดอร์ในระบบครับ คุณสามารถสั่งอาหารหรือเรียกส่งพัสดุผ่านผมได้เลยครับ! 🛵✨';
    }

    const targetId = args?.orderId;
    if (targetId && targetId !== 'latest') {
      const matched = userOrders.find((o) => o.id.endsWith(targetId) || o.id === targetId);
      if (matched) {
        const typeStr = matched.type === 'parcel' ? 'ส่งพัสดุ' : `อาหาร (${matched.restaurantName || 'ร้านค้า'})`;
        const statusStr = STATUS_MAP[matched.status] || matched.status;
        const riderStr = matched.riderName ? `\nไรเดอร์: ${matched.riderName} (${matched.riderPhone || 'มีเบอร์ในระบบ'})` : '\nไรเดอร์: กำลังค้นหาไรเดอร์...';
        const itemsStr = matched.items ? `\nรายการ: ${matched.items.map((i) => `${i.name} x${i.qty}`).join(', ')}` : '';
        const routeStr = matched.type === 'parcel' ? `\nจุดรับ: ${matched.pickup}\nจุดส่ง: ${matched.dropoff}` : '';

        return `📦 รายละเอียดออเดอร์ #${matched.id.slice(-6)} [${typeStr}]\nสถานะปัจจุบัน: ${statusStr}${riderStr}${itemsStr}${routeStr}\nยอดรวมทั้งสิ้น: ฿${matched.grandTotal || matched.deliveryFee || 0}\nเวลาสั่ง: ${matched.createdAt || 'ไม่ระบุ'}`;
      }
    }

    const activeList = getActiveOrders();
    if (activeList.length > 0) {
      const summaryList = activeList
        .map((o, idx) => {
          const typeStr = o.type === 'parcel' ? 'ส่งพัสดุ' : `อาหาร (${o.restaurantName || 'ร้านค้า'})`;
          const statusStr = STATUS_MAP[o.status] || o.status;
          const riderStr = o.riderName ? ` | ไรเดอร์: ${o.riderName}` : '';
          return `${idx + 1}. #${o.id.slice(-6)} [${typeStr}]\n   • สถานะ: ${statusStr}${riderStr}\n   • ยอดรวม: ฿${o.grandTotal || o.deliveryFee || 0}`;
        })
        .join('\n\n');

      return `🛵 สถานะออเดอร์ที่กำลังดำเนินการ (${activeList.length} รายการ):\n\n${summaryList}\n\nต้องการดูรายละเอียดเพิ่มเติมของออเดอร์ไหน พิมพ์ระบุเลขท้ายออเดอร์ได้เลยครับ!`;
    }

    const latest = userOrders[0];
    const latestStatus = STATUS_MAP[latest.status] || latest.status;
    return `ขณะนี้ไม่มีออเดอร์ที่กำลังดำเนินการครับ\n\nออเดอร์ล่าสุดของคุณคือ #${latest.id.slice(-6)} (${latest.type === 'parcel' ? 'ส่งพัสดุ' : latest.restaurantName || 'อาหาร'})\nสถานะ: ${latestStatus}\nเวลาสั่ง: ${latest.createdAt || 'ไม่ระบุ'}\n\nคุณสามารถสั่งอาหารหรือเรียกส่งพัสดุรายการใหม่ได้เลยครับ! 🍔📦`;
  };

  const executeTool = async (functionName, args) => {
    try {
      if (functionName === 'list_all_restaurants') {
        return await executeListAllRestaurants(args);
      } else if (functionName === 'get_restaurant_menu') {
        return await executeGetRestaurantMenu(args);
      } else if (functionName === 'place_food_order') {
        const res = await executePlaceFoodOrder(args);
        return typeof res === 'string' ? { text: res } : res;
      } else if (functionName === 'place_parcel_order') {
        const res = await executePlaceParcelOrder(args);
        return typeof res === 'string' ? { text: res } : res;
      } else if (functionName === 'send_order_chat_message') {
        const res = await executeSendOrderChatMessage(args);
        return typeof res === 'string' ? { text: res } : res;
      } else if (functionName === 'check_order_status') {
        const res = await executeCheckOrderStatus(args);
        return typeof res === 'string' ? { text: res } : res;
      }
      return { text: 'ไม่พบฟังก์ชันที่ระบุครับ' };
    } catch (err) {
      console.error('executeTool error:', err);
      return { text: 'เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้งครับ' };
    }
  };

  // ── Main Send Handler ──────────────────────────────────────────────────────

  const handleSend = async (textToSend) => {
    const text = textToSend || inputText.trim();
    if (!text || loading) return;

    const userMsg = {
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setLoading(true);

    try {
      let replyText = '';

      const openShops = (restaurants || []).filter((r) => r.status === 'open');

      let replyCardData = null;

      const isListRestaurantsIntent =
        text.includes('รายชื่อร้าน') ||
        text.includes('ร้านทั้งหมด') ||
        text.includes('ร้านค้าทั้งหมด') ||
        text.includes('มีร้านอะไรบ้าง') ||
        text.includes('มีร้านค้าอะไรบ้าง') ||
        text.includes('ร้านค้าในระบบ') ||
        text.includes('เลือกร้าน') ||
        text.includes('แนะนำร้าน');

      const isMenuIntent =
        !isListRestaurantsIntent &&
        (text.includes('ขอเมนู') ||
        text.includes('ดูเมนู') ||
        text.includes('แสดงเมนู') ||
        text.includes('มีเมนูอะไรบ้าง') ||
        text.includes('รายการอาหาร') ||
        text.includes('เมนูร้าน'));

      const isChatMessageIntent =
        text.includes('ส่งข้อความ') ||
        text.includes('บอกร้าน') ||
        text.includes('บอกไรเดอร์') ||
        text.includes('แจ้งร้าน');

      const isPlaceFoodIntent =
        !isMenuIntent &&
        (text.includes('สั่งอาหาร') || text.includes('สั่งกะเพรา') || text.includes('สั่งข้าว'));

      const isPlaceParcelIntent =
        text.includes('สั่งส่งพัสดุ') || text.includes('เรียกไรเดอร์') || text.includes('ส่งพัสดุจาก');

      if (isListRestaurantsIntent) {
        const res = await executeListAllRestaurants({ keyword: text });
        replyText = res.text;
        replyCardData = res.cardData || null;
      } else if (isMenuIntent) {
        let cleanShopName = text
          .replace(/^(ขอเมนู|ดูเมนู|แสดงเมนู|ขอเมนูอาหาร|มีเมนูอะไรบ้าง|รายการอาหาร|เมนูร้าน)\s*/g, '')
          .replace(/(ของร้าน|ร้าน|หน่อยครับ|หน่อยค่ะ|หน่อย|ครับ|ค่ะ)/g, '')
          .trim();
        const res = await executeGetRestaurantMenu({ restaurantName: cleanShopName });
        replyText = res.text;
        replyCardData = res.cardData || null;
      } else if (isChatMessageIntent) {
        const cleanMsg = text.replace(
          /^(ส่งข้อความถึงร้าน|บอกร้านว่า|บอกไรเดอร์ว่า|แจ้งร้านว่า|ส่งข้อความว่า)\s*/,
          ''
        );
        replyText = await executeSendOrderChatMessage({ message: cleanMsg || text });
      } else if (isPlaceFoodIntent && text.length < 30) {
        replyText = await executePlaceFoodOrder({
          restaurantName: openShops[0]?.name || '',
          items: [{ itemName: text, qty: 1 }],
          paymentMethod: 'wallet',
        });
      } else if (isPlaceParcelIntent) {
        replyText = await executePlaceParcelOrder({
          pickup: 'จุดรับของปัจจุบัน',
          dropoff: 'จุดส่งของปลายทาง',
          paymentMethod: 'wallet',
        });
      } else if (text.includes('สถานะออเดอร์') || text.includes('เช็คออเดอร์')) {
        replyText = await executeCheckOrderStatus({});
      } else if (text.includes('Wallet') || text.includes('ยอดเงิน') || text.includes('เงิน')) {
        replyText = `ยอดเงินใน Wallet ของคุณในปัจจุบันคือ ฿${balanceNum.toLocaleString('th-TH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ครับ สามารถใช้ชำระค่าอาหารและค่าส่งพัสดุได้ทันที! 💳`;
      } else {
        const systemPromptWithContext = buildContextPrompt();
        const data = await generateAiReply({
          text,
          systemPrompt: `${SYSTEM_PROMPT}\n\n${systemPromptWithContext}`,
          tools: GEMINI_TOOLS,
        });

        if (data.functionCall) {
          const { name: fnName, args: fnArgs } = data.functionCall;
          const toolRes = await executeTool(fnName, fnArgs);
          replyText = toolRes.text;
          replyCardData = toolRes.cardData || null;
        } else {
          replyText = data.text;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: replyText,
          cardData: replyCardData,
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (error) {
      console.error('AI chat request failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: 'ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งครับ',
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const portal = document.getElementById('modal-root') || document.body;

  const modal = (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center z-[99999] p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md h-[85vh] sm:h-[560px] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up border border-purple-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 p-4 text-white shadow-md flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-2xl backdrop-blur-md border border-white/20">
              <Bot size={22} className="text-purple-200" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-base">น้องบูม AI Assistant</h3>
                <Sparkles size={14} className="text-amber-300 animate-pulse" />
              </div>
              <p className="text-[11px] text-purple-200">สั่งอาหาร • เรียกพัสดุ • แจ้งเตือนร้าน/ไรเดอร์</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-y-auto bg-slate-50 space-y-3">
          {messages.map((msg, idx) => {
            const isBot = msg.sender === 'bot';
            return (
              <div
                key={idx}
                className={`flex gap-2 ${isBot ? 'items-start' : 'items-end justify-end'}`}
              >
                {isBot && (
                  <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs shrink-0 mt-1 shadow-sm">
                    <Bot size={15} />
                  </div>
                )}
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line shadow-sm ${
                    isBot
                      ? 'bg-white text-gray-800 rounded-tl-xs border border-purple-50/80'
                      : 'bg-purple-600 text-white rounded-tr-xs'
                  }`}
                >
                  {msg.text}

                  {/* Render All Restaurants Card if present */}
                  {msg.cardData && msg.cardData.type === 'all_restaurants' && (
                    <div className="mt-2.5 pt-2.5 border-t border-purple-100 space-y-2">
                      <div className="text-[11px] font-bold text-purple-900 flex items-center gap-1">
                        <Store size={14} className="text-purple-600" />
                        <span>รายชื่อร้านค้าในระบบ ({msg.cardData.shops.length} ร้าน)</span>
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {msg.cardData.shops.map((shop) => (
                          <div
                            key={shop.id}
                            className="bg-white p-2.5 rounded-xl border border-gray-100 shadow-2xs space-y-1.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                                  <span>{shop.name}</span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-medium ${
                                      shop.status === 'open'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-rose-100 text-rose-700'
                                    }`}
                                  >
                                    {shop.status === 'open' ? 'เปิด' : 'ปิด'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                  <Star size={10} className="fill-amber-400 text-amber-400" />
                                  <span>{shop.rating || 5.0}</span>
                                  <span>• {shop.distance} กม.</span>
                                  <span>• ค่าส่ง ฿{shop.deliveryFee}</span>
                                  <span>• {shop.itemCount} เมนู</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-gray-50">
                              <button
                                type="button"
                                onClick={() => handleSend(`ขอเมนูร้าน ${shop.name}`)}
                                className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-xs active:scale-95 transition-all"
                              >
                                📋 ดูเมนูร้านนี้
                              </button>
                              {setSelectedRestaurant && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRestaurant(shop);
                                    onClose();
                                  }}
                                  className="bg-purple-600 hover:bg-purple-700 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-xs active:scale-95 transition-all"
                                >
                                  ดูหน้าร้าน
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Render Restaurant & Menu Card if present */}
                  {msg.cardData && msg.cardData.type === 'restaurant_menu' && (
                    <div className="mt-2.5 pt-2.5 border-t border-purple-100 space-y-2">
                      <div className="bg-purple-50/70 p-2.5 rounded-xl border border-purple-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Store size={16} className="text-purple-600 shrink-0" />
                          <div>
                            <div className="font-bold text-purple-900 text-xs flex items-center gap-1.5">
                              <span>{msg.cardData.restaurant.name}</span>
                              <span
                                className={`px-1.5 py-0.5 rounded-md text-[9px] font-medium ${
                                  msg.cardData.restaurant.status === 'open'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {msg.cardData.restaurant.status === 'open' ? 'เปิด' : 'ปิด'}
                              </span>
                            </div>
                            <div className="text-[10px] text-purple-600 flex items-center gap-1">
                              <Star size={10} className="fill-purple-500 text-purple-500" />
                              <span>{msg.cardData.restaurant.rating || 5.0}</span>
                              <span>• {msg.cardData.distance} กม.</span>
                              <span>• ค่าส่ง ฿{msg.cardData.deliveryFee}</span>
                            </div>
                          </div>
                        </div>
                        {setSelectedRestaurant && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRestaurant(msg.cardData.restaurant);
                              onClose();
                            }}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-xs active:scale-95 transition-all shrink-0"
                          >
                            ดูหน้าร้าน
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {msg.cardData.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-white p-2 rounded-xl border border-gray-100 shadow-2xs flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {item.image && (
                                <img
                                  src={item.image}
                                  alt={item.name}
                                  className="w-10 h-10 object-cover rounded-lg shrink-0 bg-gray-50"
                                />
                              )}
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-800 text-[11px] truncate">{item.name}</div>
                                {item.desc && <div className="text-[9px] text-gray-400 truncate">{item.desc}</div>}
                                <div className="text-xs font-bold text-purple-700">฿{item.price}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleSend(`สั่ง ${item.name} จากร้าน ${msg.cardData.restaurant.name} 1 จาน`)
                                }
                                className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded-lg text-[10px] font-medium flex items-center gap-0.5 shadow-xs active:scale-95 transition-all"
                              >
                                <ShoppingBag size={10} />
                                <span>สั่งซื้อ</span>
                              </button>
                              {addToCart && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    addToCart(
                                      item,
                                      msg.cardData.restaurant.id,
                                      msg.cardData.restaurant.name,
                                      Number(msg.cardData.distance)
                                    );
                                    notifySystem('เพิ่มลงตระกร้าแล้ว 🛒', `${item.name} ถูกเพิ่มลงในตะกร้าแล้ว`);
                                  }}
                                  className="bg-purple-100 hover:bg-purple-200 text-purple-700 p-1 rounded-lg text-[10px] font-medium shadow-xs active:scale-95 transition-all"
                                  title="ใส่ตะกร้า"
                                >
                                  <Plus size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <span
                    className={`block text-[9px] mt-1 text-right ${
                      isBot ? 'text-gray-400' : 'text-purple-200'
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>
                {!isBot && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs shrink-0 shadow-sm">
                    <User size={15} />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-2 items-center text-xs text-purple-600 bg-purple-50 p-3 rounded-2xl w-fit animate-pulse border border-purple-100">
              <Loader2 size={16} className="animate-spin" />
              <span>น้องบูมกำลังประมวลผลคำสั่ง...</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Quick Prompts */}
        <div className="px-3 py-2 bg-slate-100 border-t border-slate-200/60 overflow-x-auto flex gap-2 no-scrollbar shrink-0">
          {quickPrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(prompt.replace(/^[^\s]+\s/, ''))}
              className="px-3 py-1.5 bg-white hover:bg-purple-50 text-purple-700 text-[11px] font-medium rounded-full border border-purple-200/80 shrink-0 shadow-xs transition-colors active:scale-95"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="p-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="สั่งอาหาร, เรียกพัสดุ หรือส่งข้อความ..."
            className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!inputText.trim() || loading}
            className="bg-purple-600 hover:bg-purple-700 text-white p-2.5 rounded-full shadow-md transition-all active:scale-95 disabled:opacity-40 shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, portal);
}
