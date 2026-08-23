import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Bot, Send, Loader2, Sparkles, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generateId, formatDateTime, r2, playOrderNotificationSound } from '../utils';
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
1. เช็คสถานะออเดอร์ แนะนำร้าน และยอดเงินใน Wallet
2. สามารถ "สั่งอาหาร" ให้ลูกค้าได้โดยตรง เมื่อลูกค้าระบุชื่อร้านค้าและรายการอาหาร
3. สามารถ "สั่งส่งพัสดุ / เรียกไรเดอร์" ให้ลูกค้าได้โดยตรง เมื่อลูกค้าระบุจุดรับ จุดส่ง
4. สามารถ "ส่งข้อความสื่อสาร/แจ้งเตือน" ไปยังห้องแชทของร้านค้า ไรเดอร์ หรือแอดมิน เกี่ยวกับออเดอร์ที่ดำเนินการอยู่ได้ทันที
ตอบคำถามสั้นกระชับ ชัดเจน เข้าใจง่าย ภาษาไทยเสมอ`;

const GEMINI_TOOLS = [
  {
    function_declarations: [
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
  } = useApp();

  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: `สวัสดีครับคุณ ${userProfile?.name || currentUser?.name || 'ลูกค้า'}! 🛵✨ ผมน้องบูม AI Assistant\nผมสามารถช่วยเช็คสถานะ, สั่งอาหาร, เรียกไรเดอร์ส่งพัสดุ หรือส่งข้อความแจ้งเตือนไปยังร้านค้าและไรเดอร์ได้ครับ! มีอะไรให้รับใช้ไหมครับ?`,
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
    '🍔 สั่งกะเพราหมูสับ',
    '🚚 เรียกส่งพัสดุ',
    '💬 แจ้งร้านค้าว่าขอไม่ใส่ผัก',
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

  const executePlaceFoodOrder = async (args) => {
    const targetRestName = args.restaurantName || '';
    const openShops = (restaurants || []).filter((r) => r.status === 'open');
    const matchedShop =
      openShops.find(
        (r) =>
          r.name.toLowerCase().includes(targetRestName.toLowerCase()) ||
          targetRestName.toLowerCase().includes(r.name.toLowerCase())
      ) || openShops[0];

    if (!matchedShop) {
      return 'ขออภัยครับ ขณะนี้ไม่มีร้านอาหารที่เปิดให้บริการครับ 🍔';
    }

    const shopMenuItems = menuItems[matchedShop.id] || [];
    const orderedItems = [];
    const rawItems = args.items || [];

    for (const itemArg of rawItems) {
      const argName = (itemArg.itemName || '').toLowerCase();
      const qty = Math.max(1, Number(itemArg.qty) || 1);
      const matchedMenu =
        shopMenuItems.find(
          (m) => m.name.toLowerCase().includes(argName) || argName.includes(m.name.toLowerCase())
        ) || shopMenuItems[0];

      if (matchedMenu) {
        orderedItems.push({
          id: matchedMenu.id,
          name: matchedMenu.name,
          price: matchedMenu.price,
          qty,
        });
      }
    }

    if (orderedItems.length === 0 && shopMenuItems.length > 0) {
      const defaultMenu = shopMenuItems[0];
      orderedItems.push({
        id: defaultMenu.id,
        name: defaultMenu.name,
        price: defaultMenu.price,
        qty: 1,
      });
    }

    if (orderedItems.length === 0) {
      return `ขออภัยครับ ไม่พบเมนูอาหารในร้าน ${matchedShop.name} ครับ`;
    }

    const foodTotal = orderedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const distance = 1;
    const deliveryFee = (appConfig?.baseFee || 30) + Math.ceil(distance) * (appConfig?.perKmFee || 10);
    const grandTotal = Math.max(0, foodTotal + deliveryFee);

    const paymentMethod = args.paymentMethod === 'cash' ? 'cash' : 'wallet';

    if (paymentMethod === 'wallet' && balanceNum < grandTotal) {
      return `ขออภัยครับ ยอดเงินใน Wallet ไม่เพียงพอ (มียอด ฿${balanceNum.toLocaleString()} แต่ยอดสั่งซื้อคือ ฿${grandTotal.toLocaleString()}) กรุณาเติมเงินก่อนทำรายการครับ 💳`;
    }

    const addr = userAddresses?.[0] || { address: 'ที่อยู่ปัจจุบันของลูกค้า', location: userProfile?.location };
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
      restaurantLocation: matchedShop.location,
      pickupLocation: matchedShop.location,
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
    return `✅ สั่งอาหารให้เรียบร้อยแล้วครับ! 🎉\n\nร้านค้า: ${matchedShop.name}\nรายการ:\n${itemListStr}\nค่าส่ง: ฿${deliveryFee}\nยอดรวมทั้งสิ้น: ฿${grandTotal} (${paymentMethod === 'wallet' ? 'ตัดผ่าน Wallet' : 'เงินสด'})\nเลขที่ออเดอร์: #${orderId.slice(-6)}\n\nระบบได้แจ้งเตือนและส่งเสียงไปยังร้านค้าเรียบร้อยแล้วครับ! 🍔🔔`;
  };

  const executePlaceParcelOrder = async (args) => {
    const pickup = args.pickup || 'จุดรับของลูกค้า';
    const dropoff = args.dropoff || 'จุดส่งของปลายทาง';
    const grandTotal = (appConfig?.baseFee || 30) + (appConfig?.perKmFee || 10) * 2;
    const paymentMethod = args.paymentMethod === 'cash' ? 'cash' : 'wallet';

    if (paymentMethod === 'wallet' && balanceNum < grandTotal) {
      return `ขออภัยครับ ยอดเงินใน Wallet ไม่เพียงพอ (มียอด ฿${balanceNum.toLocaleString()} แต่ค่าส่งพัสดุคือ ฿${grandTotal.toLocaleString()}) กรุณาเติมเงินก่อนครับ 💳`;
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

    return `✅ เรียกส่งพัสดุเรียบร้อยแล้วครับ! 📦🛵\n\nจุดรับ: ${pickup}\nจุดส่ง: ${dropoff}\nค่าบริการ: ฿${grandTotal} (${paymentMethod === 'wallet' ? 'ตัดผ่าน Wallet' : 'เงินสด'})\nเลขที่ออเดอร์: #${orderId.slice(-6)}\n\nระบบกำลังกระจายงานแจ้งเตือนไปยังไรเดอร์บริเวณใกล้เคียงให้อัตโนมัติครับ! 🔔`;
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
    const currentActiveOrders = getActiveOrders();
    if (currentActiveOrders.length === 0) {
      return 'ขณะนี้คุณไม่มีออเดอร์ที่กำลังดำเนินการอยู่ครับ สามารถสั่งอาหารหรือเรียกส่งพัสดุได้เลยครับ 🛵';
    }
    const target = args?.orderId
      ? currentActiveOrders.find((o) => o.id.endsWith(args.orderId)) || currentActiveOrders[0]
      : currentActiveOrders[0];

    return `📦 สถานะออเดอร์ #${target.id.slice(-6)} (${target.type === 'parcel' ? 'ส่งพัสดุ' : target.restaurantName || 'อาหาร'})\nสถานะปัจจุบัน: ${
      STATUS_MAP[target.status] || target.status
    }\nไรเดอร์: ${target.riderName || 'กำลังค้นหาไรเดอร์...'}\nยอดรวม: ฿${target.grandTotal || target.deliveryFee || target.total || 0}`;
  };

  const executeTool = async (functionName, args) => {
    try {
      if (functionName === 'place_food_order') {
        return await executePlaceFoodOrder(args);
      } else if (functionName === 'place_parcel_order') {
        return await executePlaceParcelOrder(args);
      } else if (functionName === 'send_order_chat_message') {
        return await executeSendOrderChatMessage(args);
      } else if (functionName === 'check_order_status') {
        return await executeCheckOrderStatus(args);
      }
      return 'ไม่พบฟังก์ชันที่ระบุครับ';
    } catch (err) {
      console.error('executeTool error:', err);
      return 'เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้งครับ';
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
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      let replyText = '';

      const openShops = (restaurants || []).filter((r) => r.status === 'open');

      const isChatMessageIntent =
        text.includes('ส่งข้อความ') ||
        text.includes('บอกร้าน') ||
        text.includes('บอกไรเดอร์') ||
        text.includes('แจ้งร้าน');
      const isPlaceFoodIntent = text.includes('สั่งอาหาร') || text.includes('สั่งกะเพรา') || text.includes('สั่งข้าว');
      const isPlaceParcelIntent =
        text.includes('สั่งส่งพัสดุ') || text.includes('เรียกไรเดอร์') || text.includes('ส่งพัสดุจาก');

      if (isChatMessageIntent) {
        const cleanMsg = text.replace(
          /^(ส่งข้อความถึงร้าน|บอกร้านว่า|บอกไรเดอร์ว่า|แจ้งร้านว่า|ส่งข้อความว่า)\s*/,
          ''
        );
        replyText = await executeSendOrderChatMessage({ message: cleanMsg || text });
      } else if (isPlaceFoodIntent && (!apiKey || text.length < 30)) {
        replyText = await executePlaceFoodOrder({
          restaurantName: openShops[0]?.name || '',
          items: [{ itemName: text, qty: 1 }],
          paymentMethod: 'wallet',
        });
      } else if (isPlaceParcelIntent && !apiKey) {
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
      } else if (apiKey) {
        const systemPromptWithContext = buildContextPrompt();

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: `${SYSTEM_PROMPT}\n\n${systemPromptWithContext}` }],
              },
              contents: [
                {
                  role: 'user',
                  parts: [{ text }],
                },
              ],
              tools: GEMINI_TOOLS,
            }),
          }
        );

        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const functionCallPart = candidate?.content?.parts?.find((p) => p.functionCall);

        if (functionCallPart?.functionCall) {
          const { name: fnName, args: fnArgs } = functionCallPart.functionCall;
          replyText = await executeTool(fnName, fnArgs);
        } else {
          replyText =
            candidate?.content?.parts?.[0]?.text ||
            'ขออภัยครับ เกิดปัญหาในการประมวลผล กรุณาลองใหม่อีกครั้งครับ';
        }
      } else {
        replyText = `น้องบูมยินดีรับฟังครับ! สำหรับเรื่อง "${text}" คุณสามารถให้ผมสั่งอาหาร, เรียกส่งพัสดุ, ส่งข้อความแจ้งร้านค้า/ไรเดอร์ หรือเช็คยอดเงิน Wallet (฿${balanceNum.toLocaleString()}) ได้เลยครับ 🛵✨`;
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: replyText,
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch {
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
