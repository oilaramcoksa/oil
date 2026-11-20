'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plane, Activity, BellRing, Youtube, LayoutDashboard, LogOut, Megaphone, RefreshCw, Search, ShieldCheck, ShoppingBag, Users, Wallet, XCircle, Camera, ExternalLink, CheckCircle, XOctagon, MoreHorizontal, Download, Sparkles } from 'lucide-react';
import { PACKAGES } from '@/lib/wallets';

type Section = 'overview' | 'players' | 'referrals' | 'withdrawals' | 'payments' | 'broadcasts' | 'shorts' | 'storyTasks' | 'crash' | 'audit' | 'promos';
type Player = {telegram_id:string;username?:string|null;first_name?:string|null;last_name?:string|null;status:string;coins:number;oil:number;usd_micros?:number;usd_locked_micros?:number;coins_locked?:number;base_oil_per_tap:number;fee_exempt:number;mining_fee_paid_at?:string|null};
type Row = Record<string, unknown>;
const ADMIN_SHOP_PARTS = [
  {id:'plane_tips',name:'قطعة توصيات الطائرة'}, {id:'oil_pump',name:'قطعة مضخة النفط'},
  {id:'fuel_station',name:'قطعة محطة الوقود'}, {id:'oil_truck',name:'قطعة شاحنة النفط'},
  {id:'new_background',name:'الخلفية الجديدة'}, {id:'vip_badge',name:'شارة VIP'},
  {id:'wheel_expansion',name:'توسعة عجلة الحظ'}, {id:'auto_sell',name:'البيع الآلي'}, {id:'arena_tokens_10000',name:'10,000 عملة للساحة'},
];
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-US');
const displayName = (p: Player) => p.first_name || p.username || p.telegram_id;

export default function AdminPage() {
  const [token,setToken] = useState('');
  const [input,setInput] = useState('');
  const [section,setSection] = useState<Section>('overview');
  const [overview,setOverview] = useState<Row>({});
  const [players,setPlayers] = useState<Player[]>([]);
  const [ton,setTon] = useState<Row[]>([]);
  const [usdt,setUsdt] = useState<Row[]>([]);
  const [payments,setPayments] = useState<Row[]>([]);
  const [promoCodes,setPromoCodes] = useState<Row[]>([]);
  const [promoDraft,setPromoDraft] = useState<Row>({code:'',promoType:'mining_fee',productId:'any',rewardCoins:100,perUserLimit:1,totalLimit:'',active:true});
  const [broadcastRows,setBroadcastRows] = useState<Row[]>([]);
  const [notificationCounts,setNotificationCounts] = useState<Record<string,number>>({});
  const [productRows,setProductRows] = useState<Row[]>([]);
  const [logs,setLogs] = useState<Row[]>([]);
  const [crashRounds,setCrashRounds] = useState<Row[]>([]);
  const [shortsRows,setShortsRows] = useState<Row[]>([]);
  const [storyRows,setStoryRows] = useState<Row[]>([]);
  const [shortsContest,setShortsContest] = useState<Row|null>(null);
  const [extensionHours,setExtensionHours] = useState('24');
  const [referralRows,setReferralRows] = useState<Row[]>([]);
  const [referralMemberId,setReferralMemberId] = useState('');
  const [status,setStatus] = useState('pending');
  const [query,setQuery] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [selected,setSelected] = useState<Player|null>(null);
  const [balanceHistory,setBalanceHistory] = useState<Row[]>([]);
  const [balanceHistoryPlayer,setBalanceHistoryPlayer] = useState<{telegramId:string;name:string}|null>(null);
  const [balanceHistoryAsset,setBalanceHistoryAsset] = useState<'coins'|'oil'|'usd'|null>(null);
  const [balanceHistoryWallet,setBalanceHistoryWallet] = useState<Row|null>(null);
  const [balanceHistoryBusy,setBalanceHistoryBusy] = useState(false);
  const [reason,setReason] = useState('');
  const [amount,setAmount] = useState(''); // Bulk broadcast coin distribution amount.
  const [coinAmount,setCoinAmount] = useState('');
  const [oilAmount,setOilAmount] = useState('');
  const [grantProductId,setGrantProductId] = useState('fast_oil');
  const [grantProductQuantity,setGrantProductQuantity] = useState('1');
  const [referralPickerOpen,setReferralPickerOpen] = useState(false);
  const [referralSearch,setReferralSearch] = useState('');
  const [referralCandidates,setReferralCandidates] = useState<Player[]>([]);
  const [speed,setSpeed] = useState('60');
  const [broadcastTitle,setBroadcastTitle] = useState('');
  const [broadcastMessage,setBroadcastMessage] = useState('');
  const [txHash,setTxHash] = useState('');
  const [decisionReason,setDecisionReason] = useState('');
  const [actionDialog,setActionDialog] = useState<{action:string;id?:string;currency?:string;status?:string}|null>(null);
  const [mobileMenuOpen,setMobileMenuOpen] = useState(false);
  const [installPrompt,setInstallPrompt] = useState<BeforeInstallPromptEvent|null>(null);

  useEffect(()=>{
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }).catch((e)=>console.info('admin_pwa_registration_unavailable',e));
  },[]);
  useEffect(()=>{
    const onInstall=(event:Event)=>{event.preventDefault();setInstallPrompt(event as BeforeInstallPromptEvent);};
    window.addEventListener('beforeinstallprompt',onInstall);
    return ()=>window.removeEventListener('beforeinstallprompt',onInstall);
  },[]);
  async function installAdmin(){
    if(!installPrompt){window.alert('من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».');return;}
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const headers = useMemo(()=>({'Content-Type':'application/json'}),[]);

  async function load(nextSection:Section=section) {
    if(!token) return;
    setBusy(true); setError('');
    try {
      const params=new URLSearchParams({section:nextSection,status,q:query});
      const res=await fetch('/api/admin/controls?'+params.toString(),{headers,credentials:'same-origin',cache:'no-store'});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||'تعذر تحميل البيانات');
      if(nextSection==='overview') setOverview(data.overview||{});
      if(nextSection==='players') setPlayers(data.players||[]);
      if(nextSection==='withdrawals'){setTon(data.ton||[]);setUsdt(data.usdt||[]);}
      if(nextSection==='payments') setPayments(data.payments||[]);
      if(nextSection==='promos') setPromoCodes(data.promoCodes||[]);
      if(nextSection==='broadcasts') setBroadcastRows(data.broadcasts||[]);
      if(nextSection==='referrals') setReferralRows(data.referrals||[]);
      if(nextSection==='audit') setLogs(data.logs||[]);
      if(nextSection==='crash') setCrashRounds(data.crashRounds||[]);
      if(nextSection==='shorts'){setShortsRows(data.shorts||[]);setShortsContest(data.contest||null);}
      if(nextSection==='storyTasks') setStoryRows(data.storyTasks||[]);
    } catch(e){setError(e instanceof Error?e.message:'حدث خطأ');}
    finally{setBusy(false);}
  }
  async function loadReferralCandidates(search:string) {
    if(!token) return;
    try { const params=new URLSearchParams({section:'players',status:'all',q:search}); const res=await fetch('/api/admin/controls?'+params.toString(),{headers,credentials:'same-origin',cache:'no-store'}); const data=await res.json(); if(!res.ok) throw new Error(data.error||'تعذر تحميل قائمة اللاعبين'); setReferralCandidates((data.players||[]).filter((p:Player)=>p.telegram_id!==selected?.telegram_id)); }
    catch(e) { setError(e instanceof Error?e.message:'تعذر تحميل قائمة اللاعبين'); }
  }
  async function loadPlayerProducts(telegramId:string) {
    if(!token) return;
    try {
      const params=new URLSearchParams({section:'playerProducts',telegramId});
      const res=await fetch('/api/admin/controls?'+params.toString(),{headers,credentials:'same-origin',cache:'no-store'});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||'تعذر تحميل مشتريات اللاعب');
      setProductRows(data.products||[]);
    } catch(e) { setError(e instanceof Error?e.message:'تعذر تحميل المشتريات'); }
  }
  async function loadBalanceHistory(telegramId:string,name:string,asset:'coins'|'oil'|'usd') {
    if(!token)return;
    setBalanceHistoryPlayer({telegramId,name});
    setBalanceHistoryAsset(asset);
    setBalanceHistory([]);
    setBalanceHistoryWallet(null);
    setBalanceHistoryBusy(true);
    setError('');
    try {
      const params=new URLSearchParams({section:'playerBalanceHistory',telegramId,asset});
      const res=await fetch('/api/admin/controls?'+params.toString(),{headers,credentials:'same-origin',cache:'no-store'});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||'تعذر تحميل سجل الرصيد');
      setBalanceHistory(data.entries||[]);
      setBalanceHistoryWallet(data.wallet||null);
    } catch(e) {
      setError(e instanceof Error?e.message:'تعذر تحميل سجل الرصيد');
    } finally {setBalanceHistoryBusy(false);}
  }
  async function loadNotificationCounts(){
    if(!token)return;
    try{
      const res=await fetch('/api/admin/controls?section=notificationCounts',{headers,credentials:'same-origin',cache:'no-store'});
      const data=await res.json();
      if(res.ok)setNotificationCounts(data.notifications||{});
    }catch(e){console.info('admin_notification_counts_unavailable',e);}
  }
  async function openSection(next:Section){
    setSection(next);
    if(next==='players'||next==='referrals'){
      setNotificationCounts(prev=>({...prev,[next]:0}));
      try{
        await fetch('/api/admin/controls',{method:'POST',headers,credentials:'same-origin',body:JSON.stringify({action:'mark_notifications_read',section:next})});
      }catch(e){console.info('admin_notification_read_sync_failed',e);}
    }
  }
  const notificationBadge=(key:string)=>{
    const count=Number(notificationCounts[key]||0);
    return count>0?<span className="inline-flex min-w-[19px] h-[19px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white shadow-lg shadow-red-500/20">{count>99?'99+':count}</span>:null;
  };
  useEffect(()=>{if(token) void load(section);},[token,section,status]);
  useEffect(()=>{if(!token)return;void loadNotificationCounts();const timer=window.setInterval(()=>void loadNotificationCounts(),15000);return()=>window.clearInterval(timer);},[token]);
  useEffect(()=>{if(!token||section!=='overview')return;const timer=window.setInterval(()=>void load('overview'),30000);return()=>window.clearInterval(timer);},[token,section]);
  async function login(e:React.FormEvent){
    e.preventDefault(); if(!input.trim()) return; setBusy(true); setError('');
    try{
      const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input})});
      const data=await res.json(); if(!res.ok) throw new Error(data.error==='admin_not_configured'?'إعدادات دخول الإدارة غير مكتملة على الخادم': 'كلمة المرور غير صحيحة');
      setToken('session'); setInput('');
    }catch(e){setError(e instanceof Error?e.message:'فشل تسجيل الدخول');}
    finally{setBusy(false);}
  }
  async function logout(){ await fetch('/api/admin/login',{method:'DELETE'}); setToken('');setOverview({});setPlayers([]);}
  async function act(payload:Record<string,unknown>) {
    setBusy(true);setError('');setNotice('');
    try{
      const res=await fetch('/api/admin/controls',{method:'POST',headers,credentials:'same-origin',body:JSON.stringify(payload)});
      const data=await res.json();if(!res.ok)throw new Error(data.error||'فشلت العملية');
      setNotice(data.delivered !== undefined ? `تم إرسال الرسالة بنجاح إلى ${Number(data.delivered).toLocaleString('ar-EG')} لاعب نشط` : 'تم تنفيذ العملية بنجاح');setReason('');setAmount('');setCoinAmount('');setOilAmount('');setDecisionReason('');setTxHash('');setReferralPickerOpen(false);setActionDialog(null);
      await load(section);
    }catch(e){setError(e instanceof Error?e.message:'حدث خطأ');}
    finally{setBusy(false);}
  }
  async function savePromo(){
    setBusy(true);setError('');setNotice('');
    try{
      const res=await fetch('/api/admin/controls',{method:'POST',headers,credentials:'same-origin',body:JSON.stringify({action:'promo_save',...promoDraft})});
      const data=await res.json();if(!res.ok)throw new Error(data.error||'تعذر حفظ البرومو كود');
      setNotice('تم حفظ البرومو كود في قاعدة البيانات');setPromoDraft({code:'',promoType:'mining_fee',productId:'any',rewardCoins:100,perUserLimit:1,totalLimit:'',active:true});await load('promos');
    }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ البرومو كود');}finally{setBusy(false);}
  }
  const nav=[
    {id:'overview' as const,label:'الرئيسية',icon:LayoutDashboard},
    {id:'players' as const,label:'اللاعبون',icon:Users},
    {id:'referrals' as const,label:'الإحالات',icon:Users},
    {id:'withdrawals' as const,label:'طلبات السحب',icon:Wallet},
    {id:'payments' as const,label:'المشتريات',icon:ShoppingBag},
    {id:'promos' as const,label:'أكواد الخصم والهدايا',icon:Sparkles},
    {id:'broadcasts' as const,label:'الرسائل والإعلانات',icon:Megaphone},
    {id:'shorts' as const,label:'مسابقة Shorts',icon:Youtube},
    {id:'storyTasks' as const,label:'مراجعة حالات تيليجرام',icon:Camera},
    {id:'crash' as const,label:'ARMCOFLY',icon:Plane},
    {id:'audit' as const,label:'سجل الإدارة',icon:Activity}
  ];
  if(!token) return <main dir="rtl" className="min-h-screen bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-100 text-white grid place-items-center p-5"><form onSubmit={login} className="w-full max-w-md rounded-3xl border border-amber-400/20 bg-white shadow-lg shadow-slate-200/60 p-8 shadow-2xl"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-amber-400/10 text-amber-300"><ShieldCheck size={32}/></div><h1 className="text-center text-2xl font-black">Aramco Oil</h1><p className="mb-7 mt-2 text-center text-sm text-slate-500">بوابة الإدارة الآمنة</p>{error&&<p className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p>}<label className="mb-2 block text-sm text-slate-600">كلمة مرور الإدارة</label><input autoFocus type="password" value={input} onChange={e=>setInput(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-50 px-4 py-3 outline-none focus:border-amber-400" placeholder="أدخل رمز الدخول"/><button disabled={busy} className="mt-4 w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950 disabled:opacity-60">{busy?'جارٍ التحقق…':'دخول لوحة التحكم'}</button><p className="mt-4 text-center text-xs text-slate-500">يتم التحقق من الرمز على الخادم ولا يُحفظ في المتصفح.</p></form></main>;

  const statCards: Array<[string, unknown, string]> = [
    ['إجمالي اللاعبين',overview.players,'users'],['نشطون آخر 7 أيام',overview.activePlayers,'active'],['العملات المتداولة',overview.coins,'coins'],['النفط المخزن',overview.oil,'oil'],['سحب TON معلّق',overview.tonPending,'ton'],['سحب USDT معلّق',overview.usdtPending,'usdt'],['مشتريات قيد المراجعة',overview.paymentPending,'payments'],['ترقيات مفعّلة',overview.activeUpgrades,'upgrades'],['عملات محجوزة',overview.lockedCoins,'locked'],['إجمالي قيود السجل',overview.ledgerEntries,'ledger'],['لاعبون هذا الشهر',overview.monthPlayers,'monthPlayers'],['عملات مكتسبة هذا الشهر',overview.monthCoinsEarned,'monthCoins'],['ضغطات التعدين هذا الشهر',overview.monthTaps,'monthTaps'],['عمليات البيع هذا الشهر',overview.monthSales,'monthSales']
  ];
  return <div dir="rtl" className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-100 text-slate-800">
    <header className="relative z-30 shrink-0 border-b border-slate-200 bg-white/90 shadow-lg shadow-indigo-100/60 backdrop-blur"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-slate-950"><ShieldCheck/></div><div><h1 className="font-black">ARAMCO OIL <span className="text-amber-300">ADMIN</span></h1><p className="text-[11px] text-slate-500">مركز التحكم وإدارة اللعبة</p></div></div><div className="flex shrink-0 gap-2"><button onClick={()=>void installAdmin()} className="flex items-center gap-1 rounded-xl border border-amber-400/30 px-2.5 py-2 text-xs font-bold text-amber-200"><Download size={16}/><span className="hidden sm:inline">تثبيت</span></button><button onClick={()=>load()} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-indigo-50"><RefreshCw size={18}/></button><button onClick={logout} className="flex items-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-sm text-red-300"><LogOut size={16}/> خروج</button></div></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-0 pb-[calc(6.5rem+env(safe-area-inset-bottom))] [touch-action:pan-y] sm:px-0" style={{WebkitOverflowScrolling:"touch"}}><div className="mx-auto grid max-w-[1500px] gap-4 p-3 sm:p-4 lg:grid-cols-[230px_1fr]">
      <aside className="hidden h-fit rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-3 lg:sticky lg:top-24 lg:block"><p className="mb-3 px-3 text-[10px] font-bold text-slate-500">القائمة الرئيسية</p>{nav.map(n=><button key={n.id} onClick={()=>void openSection(n.id)} className={`mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm font-bold ${section===n.id?'bg-amber-400 text-slate-950':'text-slate-600 hover:bg-indigo-50'}`}><span className="flex min-w-0 items-center gap-3"><n.icon size={18}/><span>{n.label}</span></span>{notificationBadge(n.id)}</button>)}</aside>
      <main className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black sm:text-2xl">{nav.find(n=>n.id===section)?.label}</h2><p className="mt-1 text-xs text-slate-500">إدارة مباشرة لبيانات اللعبة على قاعدة البيانات</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">اتصال إداري مفعّل</span></div>
        {error&&<div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {notice&&<div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}
        {section==='promos'&&<div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
            <h3 className="mb-3 font-black text-lg">إنشاء برومو كود جديد</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold">كود البرومو<input value={String(promoDraft.code??'')} onChange={e=>setPromoDraft(v=>({...v,code:e.target.value.toUpperCase()}))} placeholder="WELCOME2026" className="mt-1 w-full rounded-xl border p-3" /></label>
              <label className="text-sm font-bold">نوع المكافأة<select value={String(promoDraft.promoType)} onChange={e=>setPromoDraft(v=>({...v,promoType:e.target.value}))} className="mt-1 w-full rounded-xl border p-3"><option value="mining_fee">تجاوز رسوم التعدين</option><option value="free_part">شراء قطعة مجانًا</option><option value="free_package">باقة تسريع مجانية</option><option value="coins">عملات هدية</option></select></label>
              {(promoDraft.promoType==='free_part'||promoDraft.promoType==='free_package')&&<label className="text-sm font-bold">المنتج المستهدف<select value={String(promoDraft.productId??'any')} onChange={e=>setPromoDraft(v=>({...v,productId:e.target.value}))} className="mt-1 w-full rounded-xl border p-3"><option value="any">أي منتج في هذا النوع</option>{(promoDraft.promoType==='free_part'?ADMIN_SHOP_PARTS:PACKAGES.map(p=>({id:p.id,name:p.name}))).map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></label>}
              {promoDraft.promoType==='coins'&&<label className="text-sm font-bold">عدد العملات<input type="number" min="1" value={String(promoDraft.rewardCoins??100)} onChange={e=>setPromoDraft(v=>({...v,rewardCoins:e.target.value}))} className="mt-1 w-full rounded-xl border p-3" /></label>}
              <label className="text-sm font-bold">عدد مرات الاستخدام لكل لاعب<input type="number" min="1" value={String(promoDraft.perUserLimit??1)} onChange={e=>setPromoDraft(v=>({...v,perUserLimit:e.target.value}))} className="mt-1 w-full rounded-xl border p-3" /></label>
              <label className="text-sm font-bold">الحد الإجمالي للاستخدام (اختياري)<input type="number" min="1" value={String(promoDraft.totalLimit??'')} onChange={e=>setPromoDraft(v=>({...v,totalLimit:e.target.value}))} placeholder="اتركه فارغًا بلا حد" className="mt-1 w-full rounded-xl border p-3" /></label>
              <label className="text-sm font-bold">تاريخ انتهاء الصلاحية (اختياري)<input type="datetime-local" value={String(promoDraft.expiresAt??'')} onChange={e=>setPromoDraft(v=>({...v,expiresAt:e.target.value}))} className="mt-1 w-full rounded-xl border p-3" /></label>
            </div>
            <button disabled={busy} onClick={()=>void savePromo()} className="mt-4 w-full rounded-xl bg-amber-400 p-3 font-black text-slate-950 disabled:opacity-50">حفظ البرومو كود</button>
          </div>
          <div className="space-y-2">{promoCodes.map(p=><article key={String(p.id)} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-lg">{String(p.code)}</b><p className="text-xs text-slate-500">{String(p.promo_type)} · استخدام اللاعب: {String(p.per_user_limit)} · إجمالي الاستخدام: {String(p.total_uses)}</p></div><span className={Number(p.active)===1?'text-emerald-600':'text-red-600'}>{Number(p.active)===1?'نشط':'متوقف'}</span></div>
            <div className="mt-3 flex gap-2"><button onClick={()=>void act({action:'promo_toggle',id:p.id})} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">{Number(p.active)===1?'إيقاف':'تفعيل'}</button><button onClick={()=>{if(window.confirm('حذف الكود؟ إذا استُخدم سابقًا سيُوقف بدل حذفه.'))void act({action:'promo_delete',id:p.id});}} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">حذف / إيقاف</button></div>
          </article>)}{!promoCodes.length&&<p className="rounded-xl bg-white p-4 text-center text-sm text-slate-500">لا توجد أكواد حتى الآن.</p>}</div>
        </div>}
        {section==='overview'&&<><div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">{statCards.map(([label,value,key])=><div key={String(key)} className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-3 sm:p-4"><p className="text-[11px] leading-5 text-slate-500 sm:text-xs">{label}</p><p className="mt-2 break-words text-xl font-black text-amber-300 sm:mt-3 sm:text-2xl">{money(value)}</p></div>)}</div><div className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-5"><h3 className="mb-3 font-black">إجراءات سريعة</h3><div className="grid gap-3 md:grid-cols-2"><ActionBox title="إرسال إعلان لجميع اللاعبين" desc="إشعار رسمي يظهر في صندوق إشعارات اللعبة" onClick={()=>setActionDialog({action:'broadcast'})}/><ActionBox title="توزيع العملات" desc="إضافة رصيد جماعي مع بيان السبب" onClick={()=>setActionDialog({action:'broadcast-coins'})}/></div></div></>}
        {section==='players'&&<><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute right-3 top-3 text-slate-500" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load('players')} placeholder="ابحث بالاسم أو اسم المستخدم أو Telegram ID" className="w-full rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 py-3 pr-10 pl-3 text-sm"/></div><button onClick={()=>load('players')} className="rounded-xl bg-slate-700 px-4">بحث</button></div><div className="space-y-2 md:hidden">{players.map(p=><article key={p.telegram_id} className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-black">{displayName(p)}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{p.telegram_id}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='active'?'bg-emerald-400/10 text-emerald-300':'bg-red-400/10 text-red-300'}`}>{p.status==='active'?'نشط':'محظور'}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><button onClick={()=>void loadBalanceHistory(p.telegram_id,displayName(p),'coins')} className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-right hover:bg-amber-100"><span className="text-amber-800">العملات · سجل</span><p className="mt-1 font-black text-amber-700">{money(p.coins)}</p></button><button onClick={()=>void loadBalanceHistory(p.telegram_id,displayName(p),'oil')} className="rounded-xl border border-sky-200 bg-sky-50 p-2 text-right hover:bg-sky-100"><span className="text-sky-800">النفط · سجل</span><p className="mt-1 font-black text-sky-700">{money(p.oil)}</p></button><button onClick={()=>void loadBalanceHistory(p.telegram_id,displayName(p),'usd')} className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-right hover:bg-emerald-100"><span className="text-emerald-800">الدولار · سجل</span><p className="mt-1 font-black text-emerald-700">{(Number(p.usd_micros??0)/1000000).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2})}</p></button><div className="rounded-xl bg-white/[.04] p-2"><span className="text-slate-500">سرعة الضغطة</span><p className="mt-1 font-bold">{money(p.base_oil_per_tap)}</p></div><div className="rounded-xl bg-white/[.04] p-2"><span className="text-slate-500">رسوم التعدين</span><p className="mt-1 font-bold">{p.fee_exempt?'معفى':'غير معفى'}</p></div></div><button onClick={()=>{setSelected(p);setSpeed(String(p.base_oil_per_tap));setProductRows([]);setActionDialog({action:'player'});void loadPlayerProducts(p.telegram_id);}} className="mt-3 w-full rounded-xl bg-amber-400 py-2.5 text-xs font-black text-slate-950">إدارة اللاعب</button></article>)}</div><div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 md:block"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-100 text-slate-500"><tr>{['اللاعب','Telegram ID','الحالة','العملات','النفط','الدولار','سرعة الضغطة','رسوم التعدين','الإجراءات'].map(x=><th className="p-3 text-right" key={x}>{x}</th>)}</tr></thead><tbody>{players.map(p=><tr key={p.telegram_id} className="border-t border-white/5"><td className="p-3 font-bold">{displayName(p)}</td><td className="p-3 font-mono text-xs text-slate-500">{p.telegram_id}</td><td className="p-3">{p.status==='active'?'نشط':'محظور'}</td><td className="p-2"><button onClick={()=>void loadBalanceHistory(p.telegram_id,displayName(p),'coins')} className="rounded-lg px-2 py-1 text-amber-700 hover:bg-amber-50">{money(p.coins)} ↗</button></td><td className="p-2"><button onClick={()=>void loadBalanceHistory(p.telegram_id,displayName(p),'oil')} className="rounded-lg px-2 py-1 text-sky-700 hover:bg-sky-50">{money(p.oil)} ↗</button></td><td className="p-2"><button onClick={()=>void loadBalanceHistory(p.telegram_id,displayName(p),'usd')} className="rounded-lg px-2 py-1 text-emerald-700 hover:bg-emerald-50">{(Number(p.usd_micros??0)/1000000).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2})} ↗</button></td><td className="p-3">{money(p.base_oil_per_tap)}</td><td className="p-3"><span className={p.fee_exempt?'text-emerald-300':'text-slate-500'}>{p.fee_exempt?'معفى':'غير معفى'}{p.mining_fee_paid_at?' · دافع':''}</span></td><td className="p-3"><button onClick={()=>{setSelected(p);setSpeed(String(p.base_oil_per_tap));setProductRows([]);setActionDialog({action:'player'});void loadPlayerProducts(p.telegram_id);}} className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">إدارة</button></td></tr>)}</tbody></table></div></div></>}
        {section==='referrals'&&<DataTable title="سجل الإحالات" rows={referralRows} columns={['referrer_telegram_id','referrer_name','referee_telegram_id','referee_name','status','reward_coins','created_at']}/>}
        {section==='withdrawals'&&<><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">طلبات TON وUSDT</h3><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="paid">موافق عليه</option><option value="rejected">مرفوض</option><option value="all">الكل</option></select></div><DataTable title="سحب TON" rows={ton} columns={['id','telegram_id','units','coins','ton_address','status','created_at']} action={(r)=>setActionDialog({action:'withdrawal',id:String(r.id),currency:'ton'})}/><DataTable title="سحب USDT" rows={usdt} columns={['id','telegram_id','usd_micros','tron_address','status','created_at']} action={(r)=>setActionDialog({action:'withdrawal',id:String(r.id),currency:'usdt'})}/></>}
        {section==='payments'&&<><div className="flex justify-end"><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="confirmed">موافق عليه</option><option value="rejected">مرفوض</option><option value="all">الكل</option></select></div><DataTable title="طلبات شراء القطع والترقيات" rows={payments} columns={['id','telegram_id','package_id','asset','amount','provider','status','created_at']} showAction={r=>String(r.provider??'')!=='tonconnect_auto'} action={r=>{setTxHash('');setDecisionReason('');setActionDialog({action:'payment',id:String(r.id)});}}/></>}
        {section==='broadcasts'&&<><section className="overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-[#172235] to-[#111827] p-5 sm:p-7">
          <div className="mb-6 flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-300"><BellRing size={24}/></div><div><h3 className="text-lg font-black">مركز الرسائل والإعلانات</h3><p className="mt-1 text-sm leading-6 text-slate-500">أرسل إعلانًا رسميًا يظهر للاعبين داخل اللعبة كإشعار واضح بعنوان ورسالة، دون إرسال رسائل خارجية.</p></div></div>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-black/15 p-4 sm:p-5">
            <div><label className="mb-2 block text-sm font-bold text-slate-600">عنوان الرسالة</label><input maxLength={100} value={broadcastTitle} onChange={e=>setBroadcastTitle(e.target.value)} placeholder="مثال: 🎉 خبر سار لجميع اللاعبين" className="w-full rounded-xl border border-slate-200 bg-[#090f1b] px-4 py-3 outline-none focus:border-amber-400"/></div>
            <div><div className="mb-2 flex justify-between"><label className="text-sm font-bold text-slate-600">محتوى الرسالة</label><span className="text-xs text-slate-500">{broadcastMessage.length}/1000</span></div><textarea maxLength={1000} value={broadcastMessage} onChange={e=>setBroadcastMessage(e.target.value)} placeholder="اكتب تفاصيل الإعلان أو التحديث أو التنبيه الذي سيظهر داخل اللعبة..." className="min-h-36 w-full rounded-xl border border-slate-200 bg-[#090f1b] px-4 py-3 leading-7 outline-none focus:border-amber-400"/></div>
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-slate-500">سيصل الإشعار إلى جميع اللاعبين النشطين، وسيظهر داخل اللعبة عند المزامنة التالية.</p><button disabled={busy||!broadcastTitle.trim()||!broadcastMessage.trim()} onClick={()=>act({action:'broadcast',title:broadcastTitle,message:broadcastMessage})} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3 font-black text-slate-950 shadow-lg shadow-amber-400/10 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"><Megaphone size={18}/> إرسال للجميع</button></div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400"/> الإشعارات تُحفظ في قاعدة البيانات وتُعرض داخل اللعبة</div>
        </section>
        <DataTable title="سجل الإعلانات المرسلة" rows={broadcastRows} columns={['action','target_type','target_id','details_json','created_at']}/>
        </>}
        {section==='shorts'&&<div className="space-y-4">
          <section className="rounded-2xl border border-amber-400/20 bg-white shadow-lg shadow-slate-200/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="font-black text-amber-200">التحكم في تحدي YouTube Shorts</h3><p className="mt-1 text-xs text-slate-500">التحكم مركزي من الخادم ويؤثر على ظهور الزر لجميع اللاعبين.</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${shortsContest?.status==='active'&&Date.now()<Number(shortsContest?.ends_at)?'bg-emerald-400/10 text-emerald-300':'bg-red-400/10 text-red-300'}`}>{shortsContest?.status==='active'&&Date.now()<Number(shortsContest?.ends_at)?'التحدي نشط':shortsContest?.status==='paused'?'التحدي متوقف مؤقتًا':shortsContest?.status==='cancelled'?'التحدي ملغي':'انتهت المدة'}</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
              <p>بداية التحدي: <b className="text-slate-200">{shortsContest?.starts_at?new Date(Number(shortsContest.starts_at)).toLocaleString('ar-EG'):'—'}</b></p>
              <p>نهاية التحدي: <b className="text-slate-200">{shortsContest?.ends_at?new Date(Number(shortsContest.ends_at)).toLocaleString('ar-EG'):'—'}</b></p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button disabled={busy||shortsContest?.status==='paused'} onClick={()=>act({action:'shorts_contest',operation:'pause'})} className="rounded-xl bg-amber-400/15 p-3 text-sm font-bold text-amber-200 disabled:opacity-40">إيقاف التحدي مؤقتًا</button>
              <button disabled={busy||shortsContest?.status==='active'} onClick={()=>act({action:'shorts_contest',operation:'activate'})} className="rounded-xl bg-emerald-400/15 p-3 text-sm font-bold text-emerald-200 disabled:opacity-40">تفعيل / استئناف التحدي</button>
              <button disabled={busy||shortsContest?.status==='cancelled'} onClick={()=>{if(window.confirm('هل تريد إلغاء التحدي وإخفاء الزر عن جميع اللاعبين؟'))void act({action:'shorts_contest',operation:'cancel'});}} className="rounded-xl bg-red-400/15 p-3 text-sm font-bold text-red-200 disabled:opacity-40">إلغاء التحدي نهائيًا</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <label className="text-xs text-slate-500">تمديد المدة بالساعات</label>
              <input type="number" min="1" max="2160" value={extensionHours} onChange={e=>setExtensionHours(e.target.value)} className="w-28 rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm"/>
              <button disabled={busy||!Number.isInteger(Number(extensionHours))||Number(extensionHours)<1||Number(extensionHours)>2160} onClick={()=>act({action:'shorts_contest',operation:'extend',hours:Number(extensionHours)})} className="rounded-xl bg-sky-400/15 px-4 py-2 text-sm font-bold text-sky-200 disabled:opacity-40">تمديد وإظهار التحدي</button>
              <p className="w-full text-[11px] text-slate-500">التمديد يعيد التحدي إلى الحالة النشطة ويضيف الساعات إلى وقت الانتهاء، بحد أقصى 90 يومًا لكل عملية.</p>
            </div>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">مراجعة المشاركات واستبعاد الروابط المخالفة. أرقام المشاهدات مُدخلة من اللاعبين وليست موثقة من YouTube.</p><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="approved">المعتمدة</option><option value="rejected">المستبعدة</option><option value="all">الكل</option></select></div>
          <DataTable title="مشاركات YouTube Shorts" rows={shortsRows} columns={['first_name','username','telegram_id','video_url','declared_views','status','created_at']} action={(row)=>{const raw=window.prompt('أدخل عدد المشاهدات الحالي للموافقة، أو اكتب رفض لاستبعاد الفيديو:',String(row.declared_views??0));if(raw===null)return;if(raw.trim()==='رفض'){void act({action:'shorts_review',id:String(row.id),status:'rejected',views:0});return;}const views=Number(raw.trim());if(!Number.isSafeInteger(views)||views<0||views>2000000000){setError('أدخل عدد مشاهدات صحيحًا أو اكتب رفض');return;}void act({action:'shorts_review',id:String(row.id),status:'approved',views});}}/>
        </div>}
        {section==='storyTasks'&&<section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-400/20 bg-white shadow-lg shadow-slate-200/60 p-4">
            <div><h3 className="font-black text-amber-200">مراجعة حالات ARMCO OIL</h3><p className="mt-1 text-xs text-slate-500">افتح رابط الحالة في تيليجرام، تحقق من ظهور بوستر اللعبة ورابط @armcooilbot، ثم وافق أو ارفض.</p></div>
            <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="approved">المعتمدة</option><option value="rejected">المرفوضة</option><option value="all">الكل</option></select>
          </div>
          <div className="space-y-3">
            {storyRows.map(row=><article key={String(row.id)} className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-black">{String(row.first_name||row.username||'لاعب')}</p><p className="mt-1 text-xs text-slate-500" dir="ltr">ID: {String(row.telegram_id)}</p><p className="mt-1 text-[11px] text-slate-500">تاريخ الإرسال: {String(row.submitted_at)}</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${row.status==='pending'?'bg-amber-400/10 text-amber-200':row.status==='approved'?'bg-emerald-400/10 text-emerald-200':'bg-red-400/10 text-red-200'}`}>{row.status==='pending'?'قيد المراجعة':row.status==='approved'?'تمت الموافقة':'مرفوضة'}</span>
              </div>
              <a href={String(row.story_url)} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 break-all rounded-xl bg-sky-400/10 p-3 text-xs text-sky-200 underline" dir="ltr"><ExternalLink size={16} className="shrink-0"/> {String(row.story_url)}</a>
              {Boolean(row.review_reason)&&<p className="mt-2 text-xs text-red-300">سبب الرفض: {String(row.review_reason)}</p>}
              {row.status==='pending'&&<div className="mt-3 grid grid-cols-2 gap-2">
                <button disabled={busy} onClick={()=>act({action:'story_review',id:String(row.id),status:'approved'})} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 p-3 text-sm font-black text-emerald-200 disabled:opacity-40"><CheckCircle size={17}/> موافقة وصرف 500</button>
                <button disabled={busy} onClick={()=>act({action:'story_review',id:String(row.id),status:'rejected'})} className="flex items-center justify-center gap-2 rounded-xl bg-red-500/15 p-3 text-sm font-black text-red-200 disabled:opacity-40"><XOctagon size={17}/> رفض</button>
              </div>}
            </article>)}
            {!storyRows.length&&<div className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-8 text-center text-sm text-slate-500">لا توجد طلبات في هذا التصنيف.</div>}
          </div>
        </section>}
        {section==='crash'&&<section className="space-y-4">
          <div className="rounded-2xl border border-amber-300/20 bg-gradient-to-r from-slate-900 to-indigo-950 p-5 text-white shadow-xl">
            <div className="text-xl font-black">✈️ ARMCOFLY · سجل الجولات</div>
            <p className="mt-1 text-xs text-white/60">نتائج آخر 100 جولة، رهانات المشاركين، الأرباح الصافية ونقطة انفجار الطائرة.</p>
          </div>
          {crashRounds.map((round)=><article key={String(round.id)} className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-black">انفجار عند {Number(round.crashMultiplier).toFixed(2)}x</div><div className="mt-1 text-[10px] text-slate-500">{String(round.createdAt)} · {String(round.id).slice(0,8)}</div></div>
              <div className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-900">{Number(round.participants)} مشارك · إجمالي الرهانات {money(round.totalStakes)}</div>
            </div>
            {Array.isArray(round.players)&&round.players.length>0?<div className="mt-3 space-y-2">{(round.players as Row[]).map((player,i)=><div key={String(player.telegramId)+i} className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-4">
              <div><div className="text-[10px] text-slate-500">اللاعب</div><b>{String(player.username)}</b></div>
              <div><div className="text-[10px] text-slate-500">دخل بكام</div><b>{money(player.amount)} عملة</b></div>
              <div><div className="text-[10px] text-slate-500">النتيجة</div><b className={player.status==='cashed_out'?'text-emerald-600':'text-rose-600'}>{player.status==='cashed_out'?'فاز':'خسر'}</b></div>
              <div><div className="text-[10px] text-slate-500">الربح الصافي / الخسارة</div><b className={Number(player.netProfit)>=0?'text-emerald-600':'text-rose-600'}>{Number(player.netProfit)>0?'+':''}{money(player.netProfit)}</b><div className="text-[10px] text-slate-500">إجمالي ما استلمه: {money(player.payout)}</div></div>
            </div>)}</div>:<div className="mt-3 rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">لم يشارك لاعبون في هذه الجولة.</div>}
            <div className="mt-3 break-all text-[9px] text-slate-400">SHA-256: {String(round.seedHash)}</div>
          </article>)}
          {!crashRounds.length&&<div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">لا توجد جولات مسجلة بعد.</div>}
        </section>}
        {section==='audit'&&<DataTable title="آخر العمليات الإدارية" rows={logs} columns={['action','target_type','target_id','details_json','created_at']}/>}
      </main>
    </div></div>
    <nav aria-label="التنقل في لوحة الإدارة" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/90 shadow-lg shadow-indigo-100/60 px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_35px_rgba(0,0,0,.35)] backdrop-blur-xl md:hidden"><div className="mx-auto grid max-w-xl grid-cols-5 gap-1">{[{id:'overview',label:'الرئيسية',icon:LayoutDashboard},{id:'players',label:'اللاعبون',icon:Users},{id:'withdrawals',label:'السحب',icon:Wallet},{id:'payments',label:'المشتريات',icon:ShoppingBag},{id:'more',label:'المزيد',icon:MoreHorizontal}].map(n=><button key={n.id} onClick={()=>{if(n.id==='more'){setMobileMenuOpen(v=>!v);return;}void openSection(n.id as Section);setMobileMenuOpen(false);}} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-bold ${section===n.id?'bg-amber-400/15 text-amber-300':'text-slate-500'}`}><span className="relative"><n.icon size={20}/>{notificationBadge(n.id)}</span><span>{n.label}</span></button>)}</div>{mobileMenuOpen&&<div className="absolute inset-x-3 bottom-[calc(100%+.5rem)] grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-3 shadow-2xl">{nav.filter(n=>!['overview','players','withdrawals','payments'].includes(n.id)).map(n=><button key={n.id} onClick={()=>{setSection(n.id);setMobileMenuOpen(false);}} className={`flex min-w-0 items-center gap-2 rounded-xl p-3 text-right text-xs font-bold ${section===n.id?'bg-amber-400 text-slate-950':'bg-slate-100 text-slate-200'}`}><span className="relative shrink-0"><n.icon size={17}/>{notificationBadge(n.id)}</span><span className="truncate">{n.label}</span></button>)}</div>}</nav>
    {actionDialog&&<div className="admin-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-md"><div className="my-6 w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-black">{actionDialog.action==='player'?'إدارة اللاعب':actionDialog.action==='withdrawal'?'مراجعة طلب السحب':actionDialog.action==='payment'?'مراجعة عملية الشراء':actionDialog.action==='broadcast'?'إرسال إشعار':'توزيع العملات'}</h3><button onClick={()=>setActionDialog(null)}><XCircle/></button></div>
      {actionDialog.action==='player'&&selected&&<div className="space-y-3"><p className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-bold text-slate-700">اللاعب المحدد: {displayName(selected)} · {selected.telegram_id}</p></div>}

      {actionDialog.action==='player'&&selected&&<div className="mt-3 space-y-4 border-t border-slate-200 pt-4">
<section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2"><h4 className="font-black text-amber-900">إضافة عملات إلى المحفظة</h4><input value={coinAmount} onChange={e=>setCoinAmount(e.target.value)} type="number" min="1" step="1" placeholder="عدد العملات" className="w-full rounded-xl border border-amber-200 bg-white p-3 text-slate-800"/><button disabled={!Number.isSafeInteger(Number(coinAmount))||Number(coinAmount)<=0||busy} onClick={()=>act({action:'grant_coins',telegramId:selected.telegram_id,amount:Number(coinAmount),reason:reason||'مكافأة من الإدارة'})} className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 p-3 font-bold text-white disabled:opacity-40">تأكيد إضافة العملات</button></section>
<section className="rounded-2xl border border-sky-200 bg-sky-50 p-3 space-y-2"><h4 className="font-black text-sky-900">إضافة نفط إلى المحفظة</h4><input value={oilAmount} onChange={e=>setOilAmount(e.target.value)} type="number" min="1" step="1" placeholder="كمية النفط" className="w-full rounded-xl border border-sky-200 bg-white p-3 text-slate-800"/><button disabled={!Number.isSafeInteger(Number(oilAmount))||Number(oilAmount)<=0||busy} onClick={()=>act({action:'grant_oil',telegramId:selected.telegram_id,amount:Number(oilAmount),reason:reason||'مكافأة نفط من الإدارة'})} className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-600 p-3 font-bold text-white disabled:opacity-40">تأكيد إضافة النفط</button></section>
<section className="rounded-2xl border border-purple-200 bg-purple-50 p-3 space-y-2">
  <h4 className="font-black text-purple-900">🎁 منح منتج مجاني من المتجر</h4>
  <p className="text-xs leading-5 text-purple-800">اختر أي قطعة أو باقة تسريع وسيتم تفعيلها مباشرة في حساب اللاعب دون دفع TON.</p>
  <select value={grantProductId} onChange={e=>setGrantProductId(e.target.value)} className="w-full rounded-xl border border-purple-200 bg-white p-3 text-slate-800">
    <optgroup label="باقات التسريع">
      {PACKAGES.map(p=><option key={p.id} value={p.id}>{p.id==='fast_oil'?'Fast Oil':p.id==='king_oil'?'King Oil':'Super Oil'}</option>)}
    </optgroup>
    <optgroup label="قطع المتجر">
      {ADMIN_SHOP_PARTS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </optgroup>
  </select>
  <input value={grantProductQuantity} onChange={e=>setGrantProductQuantity(e.target.value)} type="number" min="1" max="100" step="1" disabled={PACKAGES.some(p=>p.id===grantProductId)} placeholder="الكمية" className="w-full rounded-xl border border-purple-200 bg-white p-3 text-slate-800 disabled:opacity-50"/>
  <button disabled={busy||!Number.isSafeInteger(Number(grantProductQuantity))||Number(grantProductQuantity)<1||Number(grantProductQuantity)>100} onClick={()=>{if(window.confirm('تأكيد منح '+(ADMIN_SHOP_PARTS.find(p=>p.id===grantProductId)?.name??(grantProductId==='fast_oil'?'باقة Fast Oil':grantProductId==='king_oil'?'باقة King Oil':'باقة Super Oil'))+' مجانًا للاعب '+displayName(selected)+'؟'))act({action:'grant_product',telegramId:selected.telegram_id,productId:grantProductId,quantity:PACKAGES.some(p=>p.id===grantProductId)?1:Number(grantProductQuantity),reason:reason||'هدية مجانية من الإدارة'});}} className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 p-3 font-black text-white disabled:opacity-40">منح المنتج مجانًا</button>
</section>
<section className="rounded-2xl border border-rose-200 bg-rose-50 p-3 space-y-2"><h4 className="font-black text-rose-900">حالة الحساب</h4><button onClick={()=>act({action:selected.status==='active'?'ban':'unban',telegramId:selected.telegram_id,reason:reason||'قرار الإدارة'})} className="w-full rounded-xl bg-rose-600 p-3 font-bold text-white">{selected.status==='active'?'حظر اللاعب':'رفع الحظر'}</button></section>
<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-2"><h4 className="font-black text-emerald-900">رسوم التعدين</h4><button onClick={()=>act({action:'set_mining_fee_exemption',telegramId:selected.telegram_id,exempt:selected.fee_exempt?'0':'1',reason:reason||'تعديل إعفاء رسوم التعدين من الإدارة'})} className="w-full rounded-xl bg-emerald-600 p-3 font-bold text-white">{selected.fee_exempt?'إلغاء إعفاء رسوم التعدين':'إعفاء اللاعب من رسوم التعدين'}</button><p className="text-xs text-emerald-800">{selected.mining_fee_paid_at?'هذا الحساب دفع رسوم التفعيل بالفعل.':'الحساب لم يسجل دفع رسوم التفعيل بعد.'}</p></section>
<section className="rounded-2xl border border-violet-200 bg-violet-50 p-3 space-y-2"><h4 className="font-black text-violet-900">سرعة التعدين الأساسية لكل ضغطة</h4><input value={speed} onChange={e=>setSpeed(e.target.value)} type="number" min="1" step="1" className="w-full rounded-xl border border-violet-200 bg-white p-3 text-slate-800"/><button disabled={!Number.isSafeInteger(Number(speed))||Number(speed)<1||busy} onClick={()=>act({action:'set_speed',telegramId:selected.telegram_id,speed:Number(speed),reason:reason||'تعديل سرعة من الإدارة'})} className="w-full rounded-xl bg-violet-600 p-3 font-bold text-white disabled:opacity-40">حفظ السرعة</button></section>
<label className="block text-sm font-bold text-slate-700">سبب العملية / ملاحظة الإدارة</label><textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="اكتب سبب العملية لتسجيله في السجل" className="min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-800"/>
</div>}{actionDialog.action==='player'&&selected&&<div className="mt-4 space-y-3 border-t border-slate-200 pt-4"><h4 className="font-black text-indigo-800">تغيير الداعي لهذا اللاعب</h4><p className="text-xs text-slate-600">اللاعب الذي ستتغير إحالته: <b>{displayName(selected)} · {selected.telegram_id}</b></p><button onClick={()=>{setReferralPickerOpen(v=>!v);if(!referralPickerOpen)void loadReferralCandidates('');}} className="w-full rounded-xl bg-indigo-100 p-3 font-bold text-indigo-800">{referralPickerOpen?'إغلاق قائمة الداعين':'اختيار الداعي الجديد من قائمة اللاعبين'}</button>{referralPickerOpen&&<div className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-3"><div className="flex gap-2"><input value={referralSearch} onChange={e=>setReferralSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void loadReferralCandidates(referralSearch)} placeholder="ابحث بالاسم أو Telegram ID" className="min-w-0 flex-1 rounded-xl border border-indigo-200 bg-white p-3 text-sm text-slate-800"/><button onClick={()=>void loadReferralCandidates(referralSearch)} className="rounded-xl bg-indigo-600 px-4 font-bold text-white">بحث</button></div><div className="max-h-60 space-y-2 overflow-y-auto">{referralCandidates.map(p=><button key={p.telegram_id} onClick={()=>{if(window.confirm('تأكيد تعيين '+displayName(p)+' داعيًا جديدًا للاعب '+displayName(selected)+'؟'))act({action:'move_referral',telegramId:p.telegram_id,refereeTelegramId:selected.telegram_id,reason:reason||'تغيير الداعي من لوحة الإدارة'});}} className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-white p-3 text-right hover:border-indigo-400 hover:bg-indigo-100"><span className="min-w-0"><b className="block truncate text-slate-800">{displayName(p)}</b><small className="block font-mono text-slate-500">{p.telegram_id}</small></span><span className="shrink-0 rounded-lg bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">اختيار الداعي</span></button>)}{!referralCandidates.length&&<p className="p-3 text-center text-xs text-slate-500">لا توجد نتائج. ابحث بالاسم أو رقم تيليجرام.</p>}</div></div>}</div>}{actionDialog.action==='withdrawal'&&<div className="space-y-3"><input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="معرّف المعاملة TX Hash (مطلوب عند الموافقة)" className="w-full rounded-xl bg-slate-50 p-3"/><textarea value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder="سبب الرفض أو ملاحظة الإدارة" className="min-h-24 w-full rounded-xl bg-slate-50 p-3"/><div className="grid grid-cols-2 gap-2"><button onClick={()=>act({action:'withdrawal',id:actionDialog.id,currency:actionDialog.currency,status:'paid',txHash,reason:decisionReason||'تمت الموافقة'})} className="rounded-xl bg-emerald-500/20 p-3 text-emerald-200">موافقة</button><button onClick={()=>act({action:'withdrawal',id:actionDialog.id,currency:actionDialog.currency,status:'rejected',reason:decisionReason})} className="rounded-xl bg-red-500/20 p-3 text-red-200">رفض الطلب</button></div></div>}
      {actionDialog.action==='payment'&&<div className="space-y-3"><input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="TX Hash / مرجع التحويل" className="w-full rounded-xl bg-slate-50 p-3"/><textarea value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder="سبب الرفض" className="min-h-20 w-full rounded-xl bg-slate-50 p-3"/><div className="grid grid-cols-2 gap-2"><button onClick={()=>act({action:'payment',id:actionDialog.id,status:'confirmed',txHash})} className="rounded-xl bg-emerald-500/20 p-3 text-emerald-200">تأكيد الدفع والتفعيل</button><button onClick={()=>act({action:'payment',id:actionDialog.id,status:'rejected',reason:decisionReason||'تعذر التحقق من الدفعة'})} className="rounded-xl bg-red-500/20 p-3 text-red-200">رفض الشراء</button></div></div>}
      {(actionDialog.action==='broadcast'||actionDialog.action==='broadcast-coins')&&<div className="space-y-3"><input value={broadcastTitle} onChange={e=>setBroadcastTitle(e.target.value)} placeholder="عنوان الإشعار" className="w-full rounded-xl bg-slate-50 p-3"/><textarea value={broadcastMessage} onChange={e=>setBroadcastMessage(e.target.value)} placeholder="نص الإشعار أو سبب المكافأة" className="min-h-28 w-full rounded-xl bg-slate-50 p-3"/><input value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="عدد العملات (في التوزيع)" className="w-full rounded-xl bg-slate-50 p-3"/><button onClick={()=>act(actionDialog.action==='broadcast'?{action:'broadcast',title:broadcastTitle,message:broadcastMessage}:{action:'broadcast_coins',amount:Number(amount),reason:broadcastMessage,title:broadcastTitle})} className="w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950">تنفيذ</button></div>}
    </div></div>}
    {balanceHistoryAsset&&balanceHistoryPlayer&&<div className="admin-overlay fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm"><section className="my-4 max-h-[92dvh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl"><header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4"><div className="min-w-0"><h3 className="font-black">سجل حركة الرصيد · {balanceHistoryAsset==='coins'?'العملات':balanceHistoryAsset==='oil'?'النفط':'الدولار'}</h3><p className="truncate text-xs text-slate-500">{balanceHistoryPlayer.name} · {balanceHistoryPlayer.telegramId}</p></div><button onClick={()=>setBalanceHistoryAsset(null)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-200"><XCircle/></button></header><div className="max-h-[calc(92dvh-76px)] space-y-3 overflow-y-auto p-3 sm:p-4">{balanceHistoryWallet&&<div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-amber-50 p-3"><small className="text-amber-800">العملات المتاحة</small><b className="mt-1 block text-amber-700">{money(balanceHistoryWallet.coins)}</b><small className="text-slate-500">محجوز: {money(balanceHistoryWallet.coinsLocked)}</small></div><div className="rounded-xl bg-sky-50 p-3"><small className="text-sky-800">النفط</small><b className="mt-1 block text-sky-700">{money(balanceHistoryWallet.oil)}</b></div><div className="rounded-xl bg-emerald-50 p-3"><small className="text-emerald-800">الدولار المتاح</small><b className="mt-1 block text-emerald-700">{(Number(balanceHistoryWallet.usdMicros??0)/1000000).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2})}</b></div><div className="rounded-xl bg-indigo-50 p-3"><small className="text-indigo-800">الدولار المحجوز</small><b className="mt-1 block text-indigo-700">{(Number(balanceHistoryWallet.usdLockedMicros??0)/1000000).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2})}</b></div></div>}{balanceHistoryBusy?<div className="p-10 text-center text-sm text-slate-500">جارٍ تحميل تفاصيل الرصيد…</div>:!balanceHistory.length?<div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">لا توجد عمليات مسجلة لهذا الرصيد.</div>:<div className="space-y-2">{balanceHistory.map((entry)=>{const amountValue=balanceHistoryAsset==='usd'?Number(entry.amountMicros??0)/1000000:Number(entry.amount??0);const positive=amountValue>=0;const metadata=entry.metadata&&typeof entry.metadata==='object'?JSON.stringify(entry.metadata,null,2):String(entry.metadata??'');const labels:Record<string,string>={oil_tap:'إنتاج نفط من الضخ',oil_passive:'إنتاج نفط تلقائي',oil_sale:'بيع النفط وتحويله إلى عملات',admin_grant:'إضافة من الإدارة',task_reward:'مكافأة مهمة تيليجرام',daily_login_reward:'مكافأة تسجيل الدخول اليومي',referral_commission:'عمولة إحالة من بيع النفط',ad_reward:'مكافأة إعلان Monetag',lucky_wheel:'جائزة عجلة الحظ',color_wheel_prize:'جائزة عجلة الألوان',color_wheel_bet:'رهان عجلة الألوان',arena_prize:'أرباح عجلة الساحة',arena_winner_stake_return:'إرجاع رهان الفائز',arena_entry:'رهان عجلة الساحة',arena_refund:'استرداد رهان الساحة',crash_bet:'رهان ARMCOFLY',crash_payout:'أرباح ARMCOFLY عند السحب',coin_swap:'تحويل العملات إلى دولار',coin_swap_credit:'تحويل العملات إلى دولار',usdt_withdrawal:'طلب سحب USDT',usdt_withdrawal_refund:'استرداد سحب USDT',withdrawal_lock:'حجز رصيد للسحب',withdrawal_refund:'استرداد طلب السحب'};return <article key={String(entry.id)} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><b className="block text-sm">{labels[String(entry.entryType)]??String(entry.entryType??'عملية رصيد')}</b><small className="text-slate-500">{String(entry.createdAt??'')} · {String(entry.referenceType??'')} {entry.referenceId?'مرجع '+String(entry.referenceId):''}</small></div><b className={positive?'text-emerald-700':'text-rose-700'}>{positive?'+':''}{balanceHistoryAsset==='usd'?amountValue.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}):money(amountValue)} {balanceHistoryAsset==='coins'?'عملة':balanceHistoryAsset==='oil'?'وحدة نفط':''}</b></div>{entry.balanceAfter!==undefined&&<p className="mt-2 text-xs text-slate-600">الرصيد بعد العملية: <b>{money(entry.balanceAfter)}</b></p>}{entry.coinsConverted!==undefined&&<p className="mt-1 text-xs text-slate-600">العملات المحوّلة: <b>{money(entry.coinsConverted)}</b></p>}{entry.status !== undefined && entry.status !== null && <p className="mt-1 text-xs text-slate-600">الحالة: {String(entry.status)}</p>}{metadata&&<details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-indigo-700">تفاصيل مصدر الرصيد والبيانات</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-2 text-[10px] leading-5 text-slate-600">{metadata}</pre></details>}</article>})}</div>}<p className="text-[10px] leading-5 text-slate-500">يعرض السجل آخر 300 عملية. الدولار يُسجّل من تحويل العملات إلى USD، وتظهر طلبات السحب والاستردادات من سجل طلبات USDT. أما العملات والنفط فمصدرهما سجل القيود المحاسبي داخل اللعبة. قد لا يظهر مصدر بعض الأرصدة الافتتاحية أو العمليات القديمة التي سبقت تسجيل القيود؛ لن يتم تخمين مصدر غير موجود في السجلات.</p></div></section></div>}
    <style jsx global>{`
.admin-theme button{transition:transform .2s ease,box-shadow .2s ease,background-color .2s ease,border-color .2s ease}.admin-theme button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 22px rgba(99,102,241,.12)}.admin-theme input,.admin-theme textarea{transition:border-color .2s ease,box-shadow .2s ease}.admin-theme input:focus,.admin-theme textarea:focus{outline:none;border-color:#818cf8;box-shadow:0 0 0 3px rgba(129,140,248,.16)}.admin-overlay{animation:adminFade .2s ease both}.admin-dialog{animation:adminPop .28s cubic-bezier(.2,.8,.2,1) both}@keyframes adminFade{from{opacity:0}to{opacity:1}}@keyframes adminPop{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
`}</style>
    {busy&&<div className="fixed bottom-4 left-4 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 shadow-xl">جارٍ تنفيذ العملية…</div>}
  </div>;
}

function ActionBox({title,desc,onClick}:{title:string;desc:string;onClick:()=>void}){return <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white/[.03] p-4 text-right hover:bg-white/[.06]"><p className="font-bold">{title}</p><p className="mt-1 text-xs text-slate-500">{desc}</p></button>}
const columnLabels:Record<string,string>={id:'المعرّف',telegram_id:'رقم تيليجرام',package_id:'الباقة / المنتج',asset:'العملة',amount:'المبلغ',provider:'وسيلة الدفع',status:'الحالة',created_at:'تاريخ الإنشاء',action:'العملية',target_type:'نوع الهدف',target_id:'معرّف الهدف',details_json:'تفاصيل العملية',username:'اسم المستخدم',first_name:'الاسم'};
const actionLabels:Record<string,string>={shorts_contest:'إدارة مسابقة Shorts',set_mining_fee_exemption:'تعديل إعفاء رسوم التعدين',payment:'مراجعة عملية شراء',withdrawal:'مراجعة طلب سحب',broadcast:'إرسال إعلان',broadcast_coins:'توزيع عملات',grant_coins:'إضافة عملات',grant_oil:'إضافة نفط',ban:'حظر لاعب',unban:'رفع حظر لاعب',product_control:'إدارة منتج',mining_fee_settings:'إعدادات رسوم التعدين'};
const detailLabels:Record<string,string>={action:'العملية',operation:'الإجراء',telegramId:'رقم اللاعب',exempt:'الإعفاء',reason:'السبب',amount:'الكمية',title:'العنوان',message:'الرسالة',status:'الحالة',id:'المعرّف',currency:'العملة',txHash:'مرجع التحويل'};
function displayAdminValue(col:string,value:unknown):string{
 if(value===null||value===undefined||value==='')return '—';
 const raw=String(value);
 if(col==='action')return actionLabels[raw]??raw;
 if(col==='target_type')return ({player:'لاعب',payment:'عملية شراء',withdrawal:'طلب سحب',broadcast:'إعلان',contest:'مسابقة',settings:'إعدادات'} as Record<string,string>)[raw]??raw;
 if(col==='provider')return raw==='tonconnect_auto'?'TON — تحقق آلي':raw;
 if(col==='status')return ({pending:'قيد المراجعة',confirmed:'مؤكد',rejected:'مرفوض',active:'نشط',paused:'متوقف',paid:'تم الدفع'} as Record<string,string>)[raw]??raw;
 if(col==='details_json'){
   try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return Object.entries(parsed).map(([k,v])=>`${detailLabels[k]??k}: ${typeof v==='object'?JSON.stringify(v):String(v)}`).join('\\n');return JSON.stringify(parsed,null,2);}catch{return raw;}
 }
 return raw;
}
function DataTable({title,rows,columns,action,showAction}:{title:string;rows:Row[];columns:string[];action?:(row:Row)=>void;showAction?:(row:Row)=>boolean}){
 const canAct=(r:Row)=>Boolean(action)&&(!showAction||showAction(r));
 return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60"><div className="border-b border-slate-200 p-3 font-black sm:p-4">{title} <span className="text-xs text-slate-500">({rows.length})</span></div><div className="space-y-2 p-2 md:hidden">{rows.map((r,i)=><article key={String(r.id??i)} className="min-w-0 rounded-xl border border-slate-200 bg-black/15 p-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{columns.map(col=><div key={col} className="min-w-0"><p className="text-[10px] font-bold text-slate-500">{columnLabels[col]??col}</p><p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">{displayAdminValue(col,r[col])}</p></div>)}</div>{canAct(r)&&<button onClick={()=>action?.(r)} className="mt-3 w-full rounded-lg bg-amber-400/10 px-3 py-2.5 text-xs font-black text-amber-200">مراجعة الطلب</button>}{action&&!canAct(r)&&String(r.provider??'')==='tonconnect_auto'&&<p className="mt-3 rounded-lg bg-sky-400/10 px-3 py-2 text-center text-xs text-sky-200">دفعة TON — تتم مراجعتها وتفعيلها آليًا</p>}</article>)}{!rows.length&&<p className="p-5 text-center text-xs text-slate-500">لا توجد سجلات</p>}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[850px] text-xs"><thead className="bg-slate-100 text-slate-500"><tr>{columns.map(col=><th key={col} className="p-3 text-right">{columnLabels[col]??col}</th>)}{action&&<th className="p-3">الإجراء</th>}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.id??i)} className="border-t border-white/5">{columns.map(col=><td key={col} className="max-w-[260px] whitespace-pre-wrap break-words p-3 leading-6">{displayAdminValue(col,r[col])}</td>)}{action&&<td className="p-3">{canAct(r)?<button onClick={()=>action(r)} className="rounded-lg bg-amber-400/10 px-3 py-2 font-bold text-amber-200">مراجعة</button>:String(r.provider??'')==='tonconnect_auto'?<span className="text-sky-200">تحقق آلي</span>:null}</td>}</tr>)}{!rows.length&&<tr><td colSpan={columns.length+(action?1:0)} className="p-6 text-center text-slate-500">لا توجد سجلات</td></tr>}</tbody></table></div></section>}