'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plane, ShoppingBag, Sparkles, Trophy, Orbit } from 'lucide-react';
import { useGame } from '@/lib/store';
import type { Lang } from '@/lib/i18n';
import { ArenaScreen } from '@/components/aram/screens/ArenaScreen';
import { DailyDollarAds } from '@/components/aram/DailyDollarAds';

type Section='home'|'wheel'|'crash'|'colors'|'store';
const WORDS:Record<Lang,string[]> = {
 ar:['الساحة','اختر لعبتك وابدأ المنافسة','عجلة الحظ','ARMCOFLY','عجلة الألوان','المتجر','العودة للساحة','قواعد اللعبة قيد الضبط','لعبة الألوان كما في الفيديو','15 ثانية لفتح الرهانات','الأصفر والبنفسجي والأخضر'],
 en:['Arena','Choose a game and join the action','Lucky Wheel','ARMCOFLY','Color Wheel','Shop','Back to arena','Game rules need confirmation','Color game from your video','15 seconds betting window','Yellow, purple and green'],
 ru:['Арена','Выберите игру','Колесо удачи','ARMCOFLY','Цветное колесо','Магазин','Назад на арену','Правила игры требуют подтверждения','Цветная игра из видео','15 секунд для ставок','Жёлтый, фиолетовый и зелёный'],
 es:['Arena','Elige un juego','Ruleta de la suerte','ARMCOFLY','Ruleta de colores','Tienda','Volver a la arena','Falta confirmar las reglas','Juego de colores del vídeo','15 segundos para apostar','Amarillo, morado y verde'],
 pt:['Arena','Escolha um jogo','Roleta da sorte','ARMCOFLY','Roleta de cores','Loja','Voltar à arena','As regras precisam de confirmação','Jogo de cores do vídeo','15 segundos para apostar','Amarelo, roxo e verde'],
 fr:['Arène','Choisissez un jeu','Roue de la chance','ARMCOFLY','Roue des couleurs','Boutique','Retour à l’arène','Les règles doivent être confirmées','Jeu de couleurs de la vidéo','15 secondes pour miser','Jaune, violet et vert'],
 de:['Arena','Wähle ein Spiel','Glücksrad','ARMCOFLY','Farbrad','Shop','Zurück zur Arena','Spielregeln müssen bestätigt werden','Farbspiel aus dem Video','15 Sekunden Wettzeit','Gelb, Lila und Grün'],
 tr:['Arena','Bir oyun seç','Şans çarkı','ARMCOFLY','Renk çarkı','Mağaza','Arenaya dön','Oyun kuralları onaylanmalı','Videodaki renk oyunu','15 saniye bahis süresi','Sarı, mor ve yeşil'],
 zh:['竞技场','选择一款游戏','幸运转盘','ARMCOFLY','颜色转盘','商店','返回竞技场','需要确认游戏规则','视频中的颜色游戏','15秒下注时间','黄色、紫色和绿色'],
 hi:['एरीना','एक गेम चुनें','लकी व्हील','ARMCOFLY','कलर व्हील','स्टोर','एरीना पर वापस','गेम नियमों की पुष्टि आवश्यक','वीडियो वाला रंग गेम','15 सेकंड की बेटिंग विंडो','पीला, बैंगनी और हरा'],
 id:['Arena','Pilih permainan','Roda keberuntungan','ARMCOFLY','Roda warna','Toko','Kembali ke arena','Aturan permainan perlu dikonfirmasi','Game warna dari video','Waktu taruhan 15 detik','Kuning, ungu, dan hijau'],
 bn:['অ্যারেনা','একটি গেম বেছে নিন','লাকি হুইল','ARMCOFLY','কালার হুইল','স্টোর','অ্যারেনায় ফিরুন','গেমের নিয়ম নিশ্চিত করতে হবে','ভিডিওর কালার গেম','১৫ সেকেন্ড বাজির সময়','হলুদ, বেগুনি ও সবুজ'],
 ja:['アリーナ','ゲームを選択','ラッキーホイール','ARMCOFLY','カラーホイール','ショップ','アリーナに戻る','ゲームルールの確認が必要','動画のカラーゲーム','ベット受付15秒','黄・紫・緑'],
 ko:['아레나','게임을 선택하세요','행운의 휠','ARMCOFLY','컬러 휠','상점','아레나로 돌아가기','게임 규칙 확인 필요','영상의 컬러 게임','베팅 시간 15초','노랑, 보라, 초록'],
 ur:['ایرینا','ایک گیم منتخب کریں','لکی وہیل','ARMCOFLY','کلر وہیل','اسٹور','ایرینا پر واپس','گیم کے اصولوں کی تصدیق درکار ہے','ویڈیو والا کلر گیم','15 سیکنڈ بیٹنگ کا وقت','پیلا، جامنی اور سبز'],
};
export function ArenaHubScreen({initData,isVerified,telegramUserId}:{initData:string;isVerified:boolean;telegramUserId:string}) {
 const lang=useGame(s=>s.lang); const w=WORDS[lang]??WORDS.en;
 const [section,setSection]=useState<Section>('home');
 const rtl=lang==='ar'||lang==='ur';
 useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('tab');if(requested==='crash')setSection('crash');else if(requested==='arena')setSection('wheel');},[]);
 const back=()=>setSection('home');
 if(section==='wheel'||section==='crash'||section==='store') return <div className="h-full min-h-0 overflow-hidden"><div className="px-3 pt-2"><button onClick={back} className="flex items-center gap-2 rounded-xl border border-amber-900/10 bg-white/70 px-3 py-2 text-xs font-black text-amber-900"><ArrowLeft size={15}/>{w[6]}</button></div><ArenaScreen key={section} initData={initData} isVerified={isVerified} telegramUserId={telegramUserId} initialGameMode={section}/></div>;
 if(section==='colors') return <div className="h-full overflow-y-auto px-4 py-5" dir={rtl?'rtl':'ltr'}><button onClick={back} className="mb-4 flex items-center gap-2 rounded-xl border border-amber-900/10 bg-white/70 px-3 py-2 text-xs font-black text-amber-900"><ArrowLeft size={15}/>{w[6]}</button><section className="mx-auto max-w-md rounded-3xl border border-white/10 bg-[#24272b] p-5 text-white"><div className="mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-amber-300 bg-[conic-gradient(#facc15_0_25%,#a78bfa_25%_50%,#2dd4bf_50%_75%,#facc15_75%)] shadow-[0_0_35px_rgba(45,212,191,.22)]"><Orbit size={38} className="text-slate-900"/></div><h2 className="mt-4 text-center text-xl font-black">{w[4]}</h2><p className="mt-2 text-center text-sm text-white/65">{w[7]}</p><p className="mt-2 text-center text-xs text-white/45">{w[8]} · {w[9]}</p><div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-black"><div className="rounded-xl bg-yellow-400 p-3 text-slate-900">🟡<br/> {w[10].split(',')[0]}</div><div className="rounded-xl bg-violet-400 p-3 text-slate-900">🟣<br/> {w[10].split(',')[1]}</div><div className="rounded-xl bg-teal-400 p-3 text-slate-900">🟢<br/> {w[10].split(',')[2]}</div></div></section></div>;
 const cards=[
  {id:'wheel' as const,icon:Trophy,title:w[2],sub:'🎡',color:'from-amber-300 to-orange-500',float:[0,-5,0],duration:2.2},
  {id:'crash' as const,icon:Plane,title:w[3],sub:'✈️',color:'from-sky-300 to-blue-600',float:[0,-7,0],duration:1.7},
  {id:'colors' as const,icon:Orbit,title:w[4],sub:'🎨',color:'from-teal-300 to-violet-500',float:[0,-6,0],duration:2.5},
  {id:'store' as const,icon:ShoppingBag,title:w[5],sub:'🪙',color:'from-emerald-300 to-teal-600',float:[0,-5,0],duration:2.0},
 ];
 return <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 pt-4 pb-6" dir={rtl?'rtl':'ltr'}>
  <header className="mx-auto mb-4 max-w-md text-center"><div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg"><Sparkles size={24}/></div><h2 className="text-2xl font-black text-[#3a210f]">{w[0]}</h2><p className="mt-1 text-xs font-bold text-amber-900/60">{w[1]}</p></header>
  <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
   {cards.map((card,index)=>{const Icon=card.icon;return <motion.button key={card.id} type="button" onClick={()=>setSection(card.id)} whileTap={{scale:.96}} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:index*.06}} className="relative flex min-h-[148px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/70 bg-white/75 p-3 text-center shadow-[0_10px_28px_rgba(120,53,15,.12)]"><motion.div animate={{y:card.float}} transition={{duration:card.duration,repeat:Infinity,ease:'easeInOut'}} className={'mb-2 grid h-20 w-20 place-items-center rounded-[26px] bg-gradient-to-br '+card.color+' text-white shadow-[0_12px_22px_rgba(0,0,0,.18)]'}><Icon size={37} strokeWidth={2.4}/></motion.div><span className="mb-1 text-lg">{card.sub}</span><span className="text-base font-black text-[#49290f]">{card.title}</span></motion.button>})}
  </div>
  <DailyDollarAds/>
 </div>;
}
