'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plane, ShoppingBag, Sparkles, Orbit } from 'lucide-react';
import { useGame } from '@/lib/store';
import type { Lang } from '@/lib/i18n';
import { ArenaScreen } from '@/components/aram/screens/ArenaScreen';
import { ColorWheelScreen } from '@/components/aram/screens/ColorWheelScreen';
import { DailyDollarAds } from '@/components/aram/DailyDollarAds';

type Section='home'|'crash'|'colors'|'store';
const WORDS:Record<Lang,string[]> = {
 ar:['الألعاب','اختر لعبتك وابدأ المنافسة','عجلة الحظ','ARMCOFLY','عجلة الألوان','المتجر','العودة إلى الألعاب','قواعد اللعبة قيد الضبط','لعبة الألوان كما في الفيديو','15 ثانية لفتح الرهانات','الأصفر والبنفسجي والأخضر'],
 en:['Games','Choose a game and join the action','Lucky Wheel','ARMCOFLY','Color Wheel','Shop','Back to games','Game rules need confirmation','Color game from your video','15 seconds betting window','Yellow, purple and green'],
 ru:['Игры','Выберите игру','Колесо удачи','ARMCOFLY','Цветное колесо','Магазин','Назад к играм','Правила игры требуют подтверждения','Цветная игра из видео','15 секунд для ставок','Жёлтый, фиолетовый и зелёный'],
 es:['Juegos','Elige un juego','Ruleta de la suerte','ARMCOFLY','Ruleta de colores','Tienda','Volver a los juegos','Falta confirmar las reglas','Juego de colores del vídeo','15 segundos para apostar','Amarillo, morado y verde'],
 pt:['Jogos','Escolha um jogo','Roleta da sorte','ARMCOFLY','Roleta de cores','Loja','Voltar aos jogos','As regras precisam de confirmação','Jogo de cores do vídeo','15 segundos para apostar','Amarelo, roxo e verde'],
 fr:['Jeux','Choisissez un jeu','Roue de la chance','ARMCOFLY','Roue des couleurs','Boutique','Retour aux jeux','Les règles doivent être confirmées','Jeu de couleurs de la vidéo','15 secondes pour miser','Jaune, violet et vert'],
 de:['Spiele','Wähle ein Spiel','Glücksrad','ARMCOFLY','Farbrad','Shop','Zurück zu den Spielen','Spielregeln müssen bestätigt werden','Farbspiel aus dem Video','15 Sekunden Wettzeit','Gelb, Lila und Grün'],
 tr:['Oyunlar','Bir oyun seç','Şans çarkı','ARMCOFLY','Renk çarkı','Mağaza','Oyunlara dön','Oyun kuralları onaylanmalı','Videodaki renk oyunu','15 saniye bahis süresi','Sarı, mor ve yeşil'],
 zh:['游戏','选择一款游戏','幸运转盘','ARMCOFLY','颜色转盘','商店','返回游戏','需要确认游戏规则','视频中的颜色游戏','15秒下注时间','黄色、紫色和绿色'],
 hi:['गेम्स','एक गेम चुनें','लकी व्हील','ARMCOFLY','कलर व्हील','स्टोर','गेम्स पर वापस','गेम नियमों की पुष्टि आवश्यक','वीडियो वाला रंग गेम','15 सेकंड की बेटिंग विंडो','पीला, बैंगनी और हरा'],
 id:['Game','Pilih permainan','Roda keberuntungan','ARMCOFLY','Roda warna','Toko','Kembali ke permainan','Aturan permainan perlu dikonfirmasi','Game warna dari video','Waktu taruhan 15 detik','Kuning, ungu, dan hijau'],
 bn:['গেমসমূহ','একটি গেম বেছে নিন','লাকি হুইল','ARMCOFLY','কালার হুইল','স্টোর','গেমে ফিরে যান','গেমের নিয়ম নিশ্চিত করতে হবে','ভিডিওর কালার গেম','১৫ সেকেন্ড বাজির সময়','হলুদ, বেগুনি ও সবুজ'],
 ja:['ゲーム','ゲームを選択','ラッキーホイール','ARMCOFLY','カラーホイール','ショップ','ゲームに戻る','ゲームルールの確認が必要','動画のカラーゲーム','ベット受付15秒','黄・紫・緑'],
 ko:['게임','게임을 선택하세요','행운의 휠','ARMCOFLY','컬러 휠','상점','게임으로 돌아가기','게임 규칙 확인 필요','영상의 컬러 게임','베팅 시간 15초','노랑, 보라, 초록'],
 ur:['گیمز','ایک گیم منتخب کریں','لکی وہیل','ARMCOFLY','کلر وہیل','اسٹور','گیمز پر واپس','گیم کے اصولوں کی تصدیق درکار ہے','ویڈیو والا کلر گیم','15 سیکنڈ بیٹنگ کا وقت','پیلا، جامنی اور سبز'],
};
export function ArenaHubScreen({initData,isVerified,telegramUserId,openColorWheelRequest}:{initData:string;isVerified:boolean;telegramUserId:string;openColorWheelRequest:number}) {
 const lang=useGame(s=>s.lang); const w=WORDS[lang]??WORDS.en;
 const [section,setSection]=useState<Section>('home');
 const rtl=lang==='ar'||lang==='ur';
 useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('tab');if(requested==='crash')setSection('crash');else if(requested==='arena'||requested==='colors')setSection('colors');},[]);
 useEffect(()=>{if(openColorWheelRequest>0)setSection('colors');},[openColorWheelRequest]);
 const back=()=>setSection('home');
 if(section==='colors') return <div className="h-full min-h-0 overflow-hidden"><div className="sticky top-0 z-50 px-3 pt-2 pb-1"><button type="button" onClick={back} className="group flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/70 bg-gradient-to-r from-[#fff7e8] via-white to-[#fff1d8] px-4 py-2.5 text-sm font-black text-amber-950 shadow-[0_5px_0_rgba(146,83,25,.16),0_10px_22px_rgba(120,53,15,.12)] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"><ArrowLeft size={17}/>{w[6]}</button></div><ColorWheelScreen initData={initData} isVerified={isVerified} telegramUserId={telegramUserId}/></div>;
 if(section==='crash'||section==='store') return <div className="h-full min-h-0 overflow-hidden"><div className="sticky top-0 z-50 px-3 pt-2 pb-1"><button type="button" onClick={back} className="group flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/70 bg-gradient-to-r from-[#fff7e8] via-white to-[#fff1d8] px-4 py-2.5 text-sm font-black text-amber-950 shadow-[0_5px_0_rgba(146,83,25,.16),0_10px_22px_rgba(120,53,15,.12)] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"><ArrowLeft size={17}/>{w[6]}</button></div><ArenaScreen key={section} initData={initData} isVerified={isVerified} telegramUserId={telegramUserId} initialGameMode={section}/></div>;
 const cards=[
  {id:'colors' as const,icon:Orbit,title:w[4],sub:'🎨',color:'from-teal-300 to-violet-500',float:[0,-6,0],duration:2.5},
  {id:'crash' as const,icon:Plane,title:w[3],sub:'✈️',color:'from-sky-300 to-blue-600',float:[0,-7,0],duration:1.7},
  {id:'store' as const,icon:ShoppingBag,title:w[5],sub:'🪙',color:'from-emerald-300 to-teal-600',float:[0,-5,0],duration:2.0},
 ];
 return <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pt-4 pb-6" dir={rtl?'rtl':'ltr'}>
  <header className="mx-auto mb-4 max-w-md text-center"><div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg"><Sparkles size={24}/></div><h2 className="text-2xl font-black text-[#3a210f]">{w[0]}</h2><p className="mt-1 text-xs font-bold text-amber-900/60">{w[1]}</p></header>
  <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
   {cards.map((card,index)=>{const Icon=card.icon;return <motion.button key={card.id} type="button" onClick={()=>setSection(card.id)} whileHover={{y:-7,rotateX:7,rotateY:rtl?5:-5,scale:1.025}} whileTap={{scale:.96,rotateX:0}} initial={{opacity:0,y:24,rotateX:12}} animate={{opacity:1,y:0,rotateX:0}} transition={{delay:index*.09,duration:.48,type:'spring',stiffness:180,damping:16}} style={{transformStyle:'preserve-3d',perspective:900}} className="group relative isolate flex min-h-[174px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-white/80 bg-gradient-to-br from-white via-[#fffaf0] to-[#f3e4ce] p-3 text-center shadow-[0_9px_0_rgba(137,79,35,.18),0_17px_30px_rgba(83,45,17,.17)] transition-shadow duration-300 hover:shadow-[0_12px_0_rgba(137,79,35,.2),0_24px_38px_rgba(83,45,17,.24)]"><span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/80 blur-2xl transition-transform duration-700 group-hover:scale-150"/><span aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"/><motion.span aria-hidden="true" className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full opacity-25 blur-2xl" style={{background:card.id==='crash'?'#38bdf8':card.id==='colors'?'#8b5cf6':'#10b981'}} animate={{scale:[.85,1.18,.85],opacity:[.16,.32,.16]}} transition={{duration:card.duration+1,repeat:Infinity,ease:'easeInOut'}}/><motion.div animate={{y:card.float,rotateZ:[-2,2,-2]}} transition={{duration:card.duration,repeat:Infinity,ease:'easeInOut'}} style={{transform:'translateZ(34px)',transformStyle:'preserve-3d'}} className={'relative mb-3 grid h-[82px] w-[82px] place-items-center rounded-[27px] border border-white/45 bg-gradient-to-br '+card.color+' text-white shadow-[0_8px_0_rgba(40,35,30,.18),0_17px_24px_rgba(0,0,0,.22),inset_0_2px_5px_rgba(255,255,255,.55)]'}><span aria-hidden="true" className="pointer-events-none absolute inset-1 rounded-[22px] border border-white/25"/><Icon size={39} strokeWidth={2.35} className="drop-shadow-[0_3px_3px_rgba(0,0,0,.25)]"/></motion.div><span className="relative mb-1 text-lg drop-shadow-sm" style={{transform:'translateZ(18px)'}}>{card.sub}</span><span className="relative text-base font-black text-[#49290f] drop-shadow-sm" style={{transform:'translateZ(16px)'}}>{card.title}</span><span aria-hidden="true" className="pointer-events-none absolute inset-x-7 bottom-2 h-1 rounded-full bg-gradient-to-r from-transparent via-amber-900/15 to-transparent blur-[2px]"/></motion.button>})}
  </div>
  <DailyDollarAds/>
 </div>;
}
