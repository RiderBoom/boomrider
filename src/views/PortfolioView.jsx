import React, { useState } from 'react';
import {
  Smartphone, Rocket, ShieldCheck, CheckCircle2,
  DollarSign, Sparkles, Send, ArrowRight,
  ExternalLink, Layers, Award, Users
} from 'lucide-react';

export default function PortfolioView() {
  const [contactForm, setContactForm] = useState({ name: '', phone: '', note: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!contactForm.name || !contactForm.phone) return;
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-orange-600/20 via-slate-950 to-slate-950 pt-20 pb-16 px-4 sm:px-6 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.15)_0,transparent_100%)] pointer-events-none" />

        <div className="max-w-4xl mx-auto relative z-10">
          <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 text-orange-400 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-6">
            <Sparkles size={16} />
            <span>บริการรับทำแอปพลิเคชัน Delivery & Super App ครบวงจร</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight text-white mb-6 leading-tight">
            สร้างแอป <span className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">Delivery & เรียกรถ</span> ของคุณเอง
            <br />พร้อมระบบจัดการระดับบริษัทชั้นนำ
          </h1>

          <p className="text-slate-300 text-base sm:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            รับพัฒนาระบบแอปพลิเคชันส่งอาหาร, ส่งพัสดุ, เรียกรถ และบริการครบวงจร (Whitelabel Super App)
            มีระบบลูกค้า, ร้านค้า, ไรเดอร์ และ Admin ครบชุด พร้อมเปิดบริการทันที
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#pricing"
              className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold px-8 py-3.5 rounded-2xl shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <span>ดูราคาแพ็กเกจ</span>
              <ArrowRight size={18} />
            </a>
            <a
              href="#contact"
              className="w-full sm:w-auto bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-200 font-bold px-8 py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all"
            >
              <span>ติดต่อปรึกษาฟรี</span>
            </a>
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-3">4 แอปในระบบเดียว (4-in-1 Portal)</h2>
          <p className="text-slate-400 text-sm sm:text-base">ระบบรองรับผู้ใช้งานครบทุกบทบาท ส่งมอบพร้อมซอร์สโค้ดและระบบหลังบ้าน</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-3xl hover:border-orange-500/50 transition-all">
            <div className="w-12 h-12 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded-2xl flex items-center justify-center mb-4">
              <Smartphone size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Customer App</h3>
            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
              แอปสำหรับลูกค้า สั่งอาหาร, เรียกรถ, ส่งพัสดุ ปักหมุดแผนที่เรียลไทม์ และเติมเงินผ่าน PromptPay
            </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-3xl hover:border-orange-500/50 transition-all">
            <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mb-4">
              <Layers size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Merchant Portal</h3>
            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
              ระบบร้านค้า จัดการเมนู, เพิ่มท็อปปิ้ง, รับออเดอร์พร้อมเสียงเตือน และติดตามรายได้สด
            </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-3xl hover:border-orange-500/50 transition-all">
            <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 text-green-400 rounded-2xl flex items-center justify-center mb-4">
              <Rocket size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Rider / Driver App</h3>
            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
              แอปคนขับ รับงานเรียลไทม์ (FCFS Engine), ถ่ายรูปหลักฐานการส่ง และคำนวณรายได้/ค่า GP อัตโนมัติ
            </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-6 rounded-3xl hover:border-orange-500/50 transition-all">
            <div className="w-12 h-12 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-2xl flex items-center justify-center mb-4">
              <ShieldCheck size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Admin Back-Office</h3>
            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
              แดชบอร์ดผู้ดูแลระบบ อนุมัติพาร์ทเนอร์, กำหนดค่า GP ไดนามิก, จัดการกระเป๋าเงิน และสรุปยอดขาย
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-3">แพ็กเกจราคาสำหรับผู้ประกอบการ</h2>
          <p className="text-slate-400 text-sm sm:text-base">เลือกรอบการทำระบบที่เหมาะกับขนาดธุรกิจของคุณ</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Whitelabel Package */}
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-orange-500/40 p-8 rounded-3xl relative shadow-xl shadow-orange-500/5">
            <div className="absolute -top-3.5 right-6 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
              แนะนำที่สุด
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Whitelabel Full Owner</h3>
            <p className="text-slate-400 text-xs mb-6">ขายขาดพร้อมซอร์สโค้ด เปลี่ยนเป็นแบรนด์ของคุณ 100%</p>
            <div className="text-3xl sm:text-4xl font-black text-orange-400 mb-6">
              ฿250,000 <span className="text-xs font-normal text-slate-400">/ ชำระครั้งเดียว</span>
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-slate-300 mb-8">
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-orange-400 shrink-0" /> เปลี่ยนชื่อแอป, โลโก้, และธีมสีตามแบรนด์</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-orange-400 shrink-0" /> ระบบ Web App + ไฟล์ Android APK พร้อมลง Play Store</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-orange-400 shrink-0" /> เซ็ตอัประบบฐานข้อมูล Supabase และ Server ของคุณเอง</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-orange-400 shrink-0" /> สอนการใช้งานระบบ Admin และส่งมอบใน 7 วัน</li>
            </ul>
            <a href="#contact" className="block text-center w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-2xl transition-all">
              สั่งทำแพ็กเกจนี้
            </a>
          </div>

          {/* SaaS Monthly Package */}
          <div className="bg-slate-900/90 border border-slate-800 p-8 rounded-3xl">
            <h3 className="text-xl font-bold text-white mb-2">SaaS Monthly Rental</h3>
            <p className="text-slate-400 text-xs mb-6">เช่าใช้งานระบบรายเดือน สำหรับเริ่มต้นธุรกิจ</p>
            <div className="text-3xl sm:text-4xl font-black text-white mb-6">
              ฿9,900 <span className="text-xs font-normal text-slate-400">/ เดือน (+ Setup 50,000)</span>
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-slate-300 mb-8">
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-400 shrink-0" /> เปิดใช้งานระบบภายใต้แบรนด์ของคุณ</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-400 shrink-0" /> ดูแลและอัปเดตเซิร์ฟเวอร์ฟรีตลอดอายุการเช่า</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-400 shrink-0" /> ไม่จำกัดจำนวนออเดอร์และไรเดอร์</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-400 shrink-0" /> บริการ Support ดูแลปัญหาตลอด 24 ชั่วโมง</li>
            </ul>
            <a href="#contact" className="block text-center w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-2xl transition-all">
              สนใจเช่ารายเดือน
            </a>
          </div>
        </div>
      </section>

      {/* Contact Form Section */}
      <section id="contact" className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl">
          <div className="text-center mb-6">
            <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">ปรึกษาการทำแอป Delivery / เรียกรถ</h3>
            <p className="text-slate-400 text-xs sm:text-sm">กรอกข้อมูลเพื่อให้ทีมงานติดต่อกลับพร้อมส่งใบเสนอราคา</p>
          </div>

          {submitted ? (
            <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-6 rounded-2xl text-center">
              <CheckCircle2 size={36} className="mx-auto mb-2" />
              <h4 className="font-bold text-base mb-1">ส่งข้อมูลเรียบร้อยแล้ว!</h4>
              <p className="text-xs text-slate-300">ทีมงานจะติดต่อกลับไปยังเบอร์โทรศัพท์ที่ท่านระบุไว้โดยเร็วที่สุด</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">ชื่อ - นามสกุล / ชื่อบริษัท</label>
                <input
                  type="text"
                  required
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  placeholder="เช่น คุณสมชาย หรือ บริษัท ขนส่ง จำกัด"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">เบอร์โทรศัพท์ติดต่อ</label>
                <input
                  type="tel"
                  required
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  placeholder="เช่น 081-234-5678"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">รายละเอียดระบบที่ต้องการ (ตัวเลือก)</label>
                <textarea
                  rows="3"
                  value={contactForm.note}
                  onChange={(e) => setContactForm({ ...contactForm, note: e.target.value })}
                  placeholder="เช่น อยากทำแอปส่งอาหารประจำจังหวัดเชียงใหม่ มีไรเดอร์ประมาณ 30 คน"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                <Send size={18} />
                <span>ส่งข้อมูลขอใบเสนอราคา</span>
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
