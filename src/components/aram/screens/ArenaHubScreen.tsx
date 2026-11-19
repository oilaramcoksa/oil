// المهندس محمد حماد
'use client';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useGame } from '@/lib/store';
import type { Lang } from '@/lib/i18n';
import dynamic from 'next/dynamic';
// Each game is its own chunk: opening one never pays for the others.
const ArenaScreen=dynamic(()=>import('@/components/aram/screens/ArenaScreen').then(m=>m.ArenaScreen));
const ColorWheelScreen=dynamic(()=>import('@/components/aram/screens/ColorWheelScreen').then(m=>m.ColorWheelScreen));
const CrashGameScreen=dynamic(()=>import('@/components/aram/screens/CrashGameScreen').then(m=>m.CrashGameScreen));
const LuckyWheel=dynamic(()=>import('@/components/aram/LuckyWheel').then(m=>m.LuckyWheel));
import { DailyDollarAds } from '@/components/aram/DailyDollarAds';

type Section='home'|'arena'|'crash'|'colors';
const ARENA_TITLE:Record<string,string>={ar:'الأرينا · دوئل',en:'Arena Duel',ru:'Арена · дуэль'};
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

/* Short marketing lines; languages without a translation fall back to English. */
const EXTRA:Record<string,{play:string;featured:string;crash:string;wheel:string;colors:string;store:string}> = {
 ar:{play:'العب الآن',featured:'مميزة',crash:'اسحب أرباحك قبل أن تسقط الطائرة',wheel:'ادخل المنافسة وخذ الجائزة كلها',colors:'اختر لونك وضاعف رصيدك',store:'اشحن عملات الرهان بسهولة'},
 en:{play:'Play now',featured:'Featured',crash:'Cash out before the plane crashes',wheel:'Join the duel and win the pot',colors:'Pick your color and multiply',store:'Top up bet tokens in seconds'},
 ru:{play:'Играть',featured:'Топ',crash:'Забери выигрыш до падения самолёта',wheel:'Вступай в дуэль и забирай банк',colors:'Выбери цвет и умножь баланс',store:'Пополни монеты для ставок'},
 es:{play:'Jugar',featured:'Destacado',crash:'Retira antes de que caiga el avión',wheel:'Únete al duelo y gana el bote',colors:'Elige tu color y multiplica',store:'Recarga fichas de apuesta'},
 tr:{play:'Oyna',featured:'Öne çıkan',crash:'Uçak düşmeden kazancını çek',wheel:'Düelloya katıl, potu kazan',colors:'Rengini seç, kazancı katla',store:'Bahis jetonlarını yükle'},
 fr:{play:'Jouer',featured:'À la une',crash:'Encaissez avant que l’avion ne s’écrase',wheel:'Rejoignez le duel et gagnez la cagnotte',colors:'Choisissez votre couleur et multipliez',store:'Rechargez vos jetons de pari'},
};

const LUCKY_TAG:Record<string,string>={ar:'لفّة مجانية كل يوم وجوائز فورية',en:'A free spin every day, instant prizes',ru:'Бесплатное вращение каждый день'};
const COLORS=['#2457f5','#8b5cf6','#0ea5e9','#10b981','#ec4899','#ef4444','#14b8a6','#6366f1'];
const CW=['y','p','y','p','y','p','y','t','p','y','p','y','p','y','p'] as const;
const CW_HEX={y:'#f5cf55',p:'#a98add',t:'#65c8b9'} as const;
const polar=(cx:number,cy:number,r:number,deg:number)=>{const a=(deg-90)*Math.PI/180;return [cx+r*Math.cos(a),cy+r*Math.sin(a)] as const;};
const slice=(cx:number,cy:number,r:number,a0:number,a1:number)=>{const [x0,y0]=polar(cx,cy,r,a0);const [x1,y1]=polar(cx,cy,r,a1);return `M${cx} ${cy}L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;};

function LuckyWheelArt({still}:{still:boolean}) {
 const slices=[{c:'#f59e0b'},...COLORS.map(c=>({c}))];
 const step=360/slices.length;
 return <svg viewBox="0 0 120 120" className="h-full w-full drop-shadow-[0_8px_14px_rgba(0,0,0,.45)]" aria-hidden="true">
  <circle cx="60" cy="60" r="57" fill="#3a2a0a"/><circle cx="60" cy="60" r="55" fill="none" stroke="#f9d977" strokeWidth="2.5"/>
  <g className={still?'':'hub-spin'} style={{transformOrigin:'60px 60px'}}>
   {slices.map((x,i)=><path key={i} d={slice(60,60,51,i*step,(i+1)*step)} fill={x.c} stroke="#1b1330" strokeWidth="1"/>)}
   {slices.map((_,i)=>{const [x,y]=polar(60,60,43,i*step+step/2);return <circle key={i} cx={x} cy={y} r="2" fill="#fff" fillOpacity=".7"/>;})}
  </g>
  <circle cx="60" cy="60" r="12" fill="#2a1c0a" stroke="#f9d977" strokeWidth="2.5"/><circle cx="60" cy="60" r="4.5" fill="#f9d977"/>
  <path d="M60 2 L52 -6 L68 -6Z" fill="#fb923c" transform="translate(0 12)" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round"/>
 </svg>;
}

function ColorWheelArt({still}:{still:boolean}) {
 const step=360/CW.length;
 return <svg viewBox="0 0 120 120" className="h-full w-full drop-shadow-[0_8px_14px_rgba(0,0,0,.45)]" aria-hidden="true">
  <circle cx="60" cy="60" r="57" fill="#3a2a0a"/><circle cx="60" cy="60" r="55" fill="none" stroke="#f9d977" strokeWidth="2.5"/>
  <g className={still?'':'hub-spin-rev'} style={{transformOrigin:'60px 60px'}}>
   {CW.map((k,i)=><path key={i} d={slice(60,60,51,i*step,(i+1)*step)} fill={CW_HEX[k]} stroke="#1b1330" strokeWidth=".9"/>)}
  </g>
  <circle cx="60" cy="60" r="17" fill="#17191b" stroke="#47494b" strokeWidth="3"/><circle cx="60" cy="60" r="5" fill="#f9d977"/>
  <path d="M60 2 L52 -6 L68 -6Z" fill="#fb923c" transform="translate(0 12)" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round"/>
 </svg>;
}

function Ticker({still}:{still:boolean}) {
 const [v,setV]=useState(2);
 useEffect(()=>{
  if(still)return;
  const start=performance.now();
  const id=window.setInterval(()=>{const t=((performance.now()-start)%4200)/1000;setV(t>3.6?11.3:1+(Math.exp(t*.7)-1)*.9);},110);
  return()=>window.clearInterval(id);
 },[still]);
 return <span className="tabular-nums">×{v.toFixed(2)}</span>;
}

function CrashArt({still}:{still:boolean}) {
 return <div className="relative h-[110px] w-[160px] shrink-0">
  <svg viewBox="0 0 160 110" className="absolute inset-0 h-full w-full" aria-hidden="true">
   <defs>
    <linearGradient id="hubCrashFill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#38bdf8" stopOpacity="0"/><stop offset="1" stopColor="#38bdf8" stopOpacity=".5"/></linearGradient>
    <linearGradient id="hubCrashStroke" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#38bdf8"/><stop offset="1" stopColor="#fde68a"/></linearGradient>
   </defs>
   <path d="M6 100 C50 98 90 80 150 14 L150 104 L6 104Z" fill="url(#hubCrashFill)"/>
   <path d="M6 100 C50 98 90 80 150 14" fill="none" stroke="url(#hubCrashStroke)" strokeWidth="3.5" strokeLinecap="round" className={still?'':'hub-trail'} pathLength={1}/>
  </svg>
  <div className={'hub-plane absolute left-0 top-0 '+(still?'hub-plane-still':'')} aria-hidden="true">
   <svg viewBox="-14 -12 28 24" className="h-6 w-7 drop-shadow-[0_0_8px_rgba(125,211,252,.9)]"><path d="M13 0 L-11 -9 L-6 0 L-11 9Z" fill="#fff"/><path d="M13 0 L-6 0 L-11 9Z" fill="#bae6fd"/></svg>
  </div>
 </div>;
}

function StoreArt() {
 return <svg viewBox="0 0 90 70" className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,.4)]" aria-hidden="true">
  {[0,1,2,3].map(i=><g key={i} transform={`translate(0 ${-i*9})`}><ellipse cx="32" cy="58" rx="24" ry="9" fill="#b45309"/><ellipse cx="32" cy="54" rx="24" ry="9" fill="#fbbf24" stroke="#fde68a" strokeWidth="1.5"/><ellipse cx="32" cy="54" rx="14" ry="4.6" fill="none" stroke="#b45309" strokeWidth="1.5" strokeOpacity=".6"/></g>)}
  <g transform="translate(56 26)"><ellipse cx="14" cy="26" rx="15" ry="6" fill="#b45309"/><ellipse cx="14" cy="23" rx="15" ry="6" fill="#fbbf24" stroke="#fde68a" strokeWidth="1.5"/></g>
  <path d="M70 8 l2.4 5.6 5.6 2.4-5.6 2.4L70 24l-2.4-5.6L62 16l5.6-2.4Z" fill="#fff" className="hub-twinkle"/>
 </svg>;
}

type CardProps={title:string;tag:string;play:string;accent:string;onOpen:()=>void;index:number;children:React.ReactNode;chips?:Array<{label:string;color:string}>;badge?:string;variant:'hero'|'tile'|'row';rtl:boolean};
function GameCard({title,tag,play,accent,onOpen,index,children,chips,badge,variant,rtl}:CardProps) {
 const base='group relative isolate overflow-hidden border border-amber-200/20 text-start shadow-[0_14px_30px_rgba(0,0,0,.45),inset_0_1px_0_rgba(255,255,255,.12)] active:scale-[.975] transition-transform duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300';
 const bg={background:`radial-gradient(120% 90% at ${rtl?'0%':'100%'} 0%, ${accent}55 0%, transparent 60%), linear-gradient(155deg,#2a1d3f 0%,#1a1230 55%,#110b21 100%)`};
 const shine=<span aria-hidden="true" className="hub-shine pointer-events-none absolute inset-y-0 -left-1/2 z-10 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent"/>;
 const playBtn=<span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#ffe08a] to-[#f59e0b] px-4 py-1.5 text-[11px] font-black text-[#3b2106] shadow-[0_3px_0_#a35c05,0_8px_14px_rgba(245,158,11,.35)]">{play}<span aria-hidden="true">{rtl?'‹':'›'}</span></span>;
 const chipRow=chips&&<div className="mt-2 flex flex-wrap gap-1.5">{chips.map((c,i)=><span key={i} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-black text-white/90"><i className="h-2 w-2 rounded-full" style={{background:c.color}}/>{c.label}</span>)}</div>;
 const badgeEl=badge&&<span className="absolute end-3 top-3 z-20 rounded-full border border-amber-200/40 bg-amber-300/15 px-2 py-0.5 text-[9px] font-black tracking-wide text-amber-200">{badge}</span>;
 const motionProps={initial:{opacity:0,y:22},animate:{opacity:1,y:0},transition:{delay:index*.08,duration:.45,type:'spring' as const,stiffness:190,damping:18}};
 if(variant==='hero') return <motion.button type="button" onClick={onOpen} aria-label={title} {...motionProps} className={base+' col-span-2 flex min-h-[158px] items-center justify-between gap-2 rounded-[28px] p-4'} style={bg}>
  {shine}{badgeEl}
  <div className="relative z-20 min-w-0 flex-1"><h3 className="text-2xl font-black tracking-wide text-white drop-shadow">{title}</h3><p className="mt-1 text-[11px] font-bold leading-5 text-white/65">{tag}</p><div className="mt-3">{playBtn}</div></div>
  <div className="relative z-20 shrink-0">{children}</div>
 </motion.button>;
 if(variant==='row') return <motion.button type="button" onClick={onOpen} aria-label={title} {...motionProps} className={base+' col-span-2 flex items-center gap-3 rounded-[24px] p-3'} style={bg}>
  {shine}
  <div className="relative z-20 h-[62px] w-[78px] shrink-0">{children}</div>
  <div className="relative z-20 min-w-0 flex-1"><h3 className="text-base font-black text-white">{title}</h3><p className="mt-0.5 text-[10.5px] font-bold text-white/60">{tag}</p></div>
  <div className="relative z-20">{playBtn}</div>
 </motion.button>;
 return <motion.button type="button" onClick={onOpen} aria-label={title} {...motionProps} className={base+' flex min-h-[214px] flex-col items-center rounded-[28px] p-3 pt-4'} style={bg}>
  {shine}{badgeEl}
  <div className="hub-float relative z-20 h-[104px] w-[104px]">{children}</div>
  <h3 className="relative z-20 mt-3 text-center text-[17px] font-black text-white">{title}</h3>
  <p className="relative z-20 mt-0.5 line-clamp-2 min-h-[28px] text-center text-[10px] font-bold leading-[14px] text-white/60">{tag}</p>
  {chipRow&&<div className="relative z-20 -mt-1 mb-1 flex justify-center">{chipRow}</div>}
  <div className="relative z-20 mt-auto pt-1">{playBtn}</div>
 </motion.button>;
}

function Overlay({title,onBack,bg,children}:{title:string;onBack:()=>void;bg:string;children:React.ReactNode}) {
 return <motion.div initial={{opacity:0,scale:.985}} animate={{opacity:1,scale:1}} transition={{duration:.18}} className="fixed inset-0 z-50 flex flex-col" style={{background:bg}}>
  <div className="shrink-0 bg-gradient-to-b from-[#38240d] to-[#241605] px-3 pb-2 pt-2 shadow-[0_6px_18px_rgba(0,0,0,.35)]">
   <button type="button" onClick={onBack} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/30 bg-white/5 px-4 py-2 text-sm font-black text-amber-100 active:bg-white/10"><ArrowLeft size={17} className="rtl:rotate-180"/>{title}</button>
  </div>
  <div className="min-h-0 flex-1">{children}</div>
 </motion.div>;
}

export function ArenaHubScreen({initData,isVerified,telegramUserId,openColorWheelRequest,active=true,onGoToStore}:{initData:string;isVerified:boolean;telegramUserId:string;openColorWheelRequest:number;active?:boolean;onGoToStore:(productId?:string)=>void}) {
 const lang=useGame(s=>s.lang); const w=WORDS[lang]??WORDS.en; const x=EXTRA[lang]??EXTRA.en;
 const [section,setSection]=useState<Section>('home');
 const [luckyOpen,setLuckyOpen]=useState(false);
 const reduce=Boolean(useReducedMotion());
 const rtl=lang==='ar'||lang==='ur';
 useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('tab');if(requested==='crash')setSection('crash');else if(requested==='arena')setSection('arena');else if(requested==='colors')setSection('colors');},[]);
 useEffect(()=>{if(openColorWheelRequest>0)setSection('colors');},[openColorWheelRequest]);
 useEffect(()=>{const openCrash=()=>setSection('crash');window.addEventListener('open-crash-game',openCrash);return()=>window.removeEventListener('open-crash-game',openCrash);},[]);
 useEffect(()=>{const toHome=()=>{setSection('home');setLuckyOpen(false);};window.addEventListener('open-plane-tips-store',toHome);return()=>window.removeEventListener('open-plane-tips-store',toHome);},[]);
 const back=()=>setSection('home');
 const goStore=(productId?:string)=>{setSection('home');setLuckyOpen(false);onGoToStore(productId);};
 // Game screens are mounted ONLY while open (and while this tab is visible), so their 1.5s pollers
 // and the TON session never run in the background — this was a major source of slowness.
 const showColors=active&&section==='colors';
 const showArena=active&&section==='arena';
 const showCrash=active&&section==='crash';
 const animate=active&&section==='home'&&!reduce;
 return <div className="relative h-full min-h-0 overflow-y-auto overscroll-contain px-3 pb-8 pt-4" dir={rtl?'rtl':'ltr'} style={{background:'radial-gradient(90% 50% at 50% 0%, #3b2466 0%, transparent 70%), radial-gradient(70% 40% at 100% 100%, #5a3205 0%, transparent 70%), #130c22'}}>
  {animate&&<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-48 overflow-hidden">{[8,22,38,55,71,86].map((l,i)=><i key={i} className="hub-spark absolute top-6 h-1.5 w-1.5 rounded-full bg-amber-200/70" style={{left:l+'%',animationDelay:i*.7+'s'}}/>)}</div>}
  <header className="relative mx-auto mb-4 max-w-md text-center">
   <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#ffe08a] via-[#f59e0b] to-[#c2410c] text-[#3b2106] shadow-[0_0_28px_rgba(245,158,11,.55),inset_0_2px_4px_rgba(255,255,255,.6)]"><Sparkles size={27}/></div>
   <h2 className="bg-gradient-to-b from-[#fff3c4] to-[#f5b83d] bg-clip-text text-[28px] font-black leading-tight text-transparent">{w[0]}</h2>
   <p className="mt-1 text-xs font-bold text-white/55">{w[1]}</p>
  </header>
  <div className="relative mx-auto grid max-w-md grid-cols-2 gap-3">
   <GameCard variant="hero" index={0} rtl={rtl} accent="#38bdf8" title={w[3]} tag={x.crash} play={x.play} badge={x.featured} onOpen={()=>setSection('crash')}><div className="flex flex-col items-center"><div className="mb-1 rounded-lg border border-sky-300/30 bg-black/35 px-2.5 py-0.5 text-lg font-black text-amber-200"><Ticker still={!animate}/></div><CrashArt still={!animate}/></div></GameCard>
   <GameCard variant="tile" index={1} rtl={rtl} accent="#f59e0b" title={w[2]} tag={LUCKY_TAG[lang]??LUCKY_TAG.en} play={x.play} onOpen={()=>setLuckyOpen(true)}><LuckyWheelArt still={!animate}/></GameCard>
   <GameCard variant="tile" index={2} rtl={rtl} accent="#8b5cf6" title={w[4]} tag={x.colors} play={x.play} chips={[{label:'×1.95',color:'#f5cf55'},{label:'×1.95',color:'#a98add'},{label:'×9.5',color:'#65c8b9'}]} onOpen={()=>setSection('colors')}><ColorWheelArt still={!animate}/></GameCard>
   <GameCard variant="row" index={3} rtl={rtl} accent="#10b981" title={w[5]} tag={x.store} play={x.play} onOpen={()=>goStore()}><StoreArt/></GameCard>
    <GameCard variant="row" index={4} rtl={rtl} accent="#f97316" title={ARENA_TITLE[lang]??ARENA_TITLE.en} tag={x.wheel} play={x.play} onOpen={()=>setSection('arena')}><div className="grid h-14 w-14 place-items-center rounded-2xl bg-black/30 text-3xl">⚔️</div></GameCard>
  </div>
  <DailyDollarAds/>
  {showColors&&<Overlay title={w[6]} onBack={back} bg="#130c22"><ColorWheelScreen initData={initData} isVerified={isVerified}/></Overlay>}
  {showArena&&<Overlay title={w[6]} onBack={back} bg="#130c22"><ArenaScreen initData={initData} isVerified={isVerified} telegramUserId={telegramUserId}/></Overlay>}
  {showCrash&&<Overlay title={w[6]} onBack={back} bg="#130c22"><div className="h-full overflow-y-auto overscroll-contain px-3 pb-6 pt-3"><CrashGameScreen initData={initData} isVerified={isVerified} telegramUserId={telegramUserId} onBuyTokens={()=>goStore('arena_tokens_10000')} buyingTokens={false}/></div></Overlay>}
  {active&&luckyOpen&&<LuckyWheel open onClose={()=>setLuckyOpen(false)}/>}
 </div>;
}
