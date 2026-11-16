'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, BellRing, Youtube, LayoutDashboard, LogOut, Megaphone, RefreshCw, Search, ShieldCheck, ShoppingBag, Users, Wallet, XCircle, Camera, ExternalLink, CheckCircle, XOctagon, MoreHorizontal, Download } from 'lucide-react';

type Section = 'overview' | 'players' | 'referrals' | 'withdrawals' | 'payments' | 'broadcasts' | 'shorts' | 'storyTasks' | 'audit';
type Player = {telegram_id:string;username?:string|null;first_name?:string|null;last_name?:string|null;status:string;coins:number;oil:number;base_oil_per_tap:number;fee_exempt:number;mining_fee_paid_at?:string|null};
type Row = Record<string, unknown>;
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
  const [productRows,setProductRows] = useState<Row[]>([]);
  const [logs,setLogs] = useState<Row[]>([]);
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
  const [reason,setReason] = useState('');
  const [amount,setAmount] = useState('');
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
      if(nextSection==='referrals') setReferralRows(data.referrals||[]);
      if(nextSection==='audit') setLogs(data.logs||[]);
      if(nextSection==='shorts'){setShortsRows(data.shorts||[]);setShortsContest(data.contest||null);}
      if(nextSection==='storyTasks') setStoryRows(data.storyTasks||[]);
    } catch(e){setError(e instanceof Error?e.message:'حدث خطأ');}
    finally{setBusy(false);}
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
  useEffect(()=>{if(token) void load(section);},[token,section,status]);
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
      setNotice(data.delivered !== undefined ? `تم إرسال الرسالة بنجاح إلى ${Number(data.delivered).toLocaleString('ar-EG')} لاعب نشط` : 'تم تنفيذ العملية بنجاح');setReason('');setAmount('');setDecisionReason('');setTxHash('');setActionDialog(null);
      await load(section);
    }catch(e){setError(e instanceof Error?e.message:'حدث خطأ');}
    finally{setBusy(false);}
  }
  const nav=[
    {id:'overview' as const,label:'الرئيسية',icon:LayoutDashboard},
    {id:'players' as const,label:'اللاعبون',icon:Users},
    {id:'referrals' as const,label:'الإحالات',icon:Users},
    {id:'withdrawals' as const,label:'طلبات السحب',icon:Wallet},
    {id:'payments' as const,label:'المشتريات',icon:ShoppingBag},
    {id:'broadcasts' as const,label:'الرسائل والإعلانات',icon:Megaphone},
    {id:'shorts' as const,label:'مسابقة Shorts',icon:Youtube},
    {id:'storyTasks' as const,label:'مراجعة حالات تيليجرام',icon:Camera},
    {id:'audit' as const,label:'سجل الإدارة',icon:Activity}
  ];
  if(!token) return <main dir="rtl" className="min-h-screen bg-[#090d16] text-white grid place-items-center p-5"><form onSubmit={login} className="w-full max-w-md rounded-3xl border border-amber-400/20 bg-[#111827] p-8 shadow-2xl"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-amber-400/10 text-amber-300"><ShieldCheck size={32}/></div><h1 className="text-center text-2xl font-black">Aramco Oil</h1><p className="mb-7 mt-2 text-center text-sm text-slate-400">بوابة الإدارة الآمنة</p>{error&&<p className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p>}<label className="mb-2 block text-sm text-slate-300">كلمة مرور الإدارة</label><input autoFocus type="password" value={input} onChange={e=>setInput(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-amber-400" placeholder="أدخل رمز الدخول"/><button disabled={busy} className="mt-4 w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950 disabled:opacity-60">{busy?'جارٍ التحقق…':'دخول لوحة التحكم'}</button><p className="mt-4 text-center text-xs text-slate-500">يتم التحقق من الرمز على الخادم ولا يُحفظ في المتصفح.</p></form></main>;

  const statCards: Array<[string, unknown, string]> = [
    ['إجمالي اللاعبين',overview.players,'users'],['نشطون آخر 7 أيام',overview.activePlayers,'active'],['العملات المتداولة',overview.coins,'coins'],['النفط المخزن',overview.oil,'oil'],['سحب TON معلّق',overview.tonPending,'ton'],['سحب USDT معلّق',overview.usdtPending,'usdt'],['مشتريات قيد المراجعة',overview.paymentPending,'payments'],['ترقيات مفعّلة',overview.activeUpgrades,'upgrades'],['عملات محجوزة',overview.lockedCoins,'locked'],['إجمالي قيود السجل',overview.ledgerEntries,'ledger'],['لاعبون هذا الشهر',overview.monthPlayers,'monthPlayers'],['عملات مكتسبة هذا الشهر',overview.monthCoinsEarned,'monthCoins'],['ضغطات التعدين هذا الشهر',overview.monthTaps,'monthTaps'],['عمليات البيع هذا الشهر',overview.monthSales,'monthSales']
  ];
  return <div dir="rtl" className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#090d16] text-slate-100">
    <header className="relative z-30 shrink-0 border-b border-white/10 bg-[#0d1422]/95 backdrop-blur"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-slate-950"><ShieldCheck/></div><div><h1 className="font-black">ARAMCO OIL <span className="text-amber-300">ADMIN</span></h1><p className="text-[11px] text-slate-400">مركز التحكم وإدارة اللعبة</p></div></div><div className="flex shrink-0 gap-2"><button onClick={()=>void installAdmin()} className="flex items-center gap-1 rounded-xl border border-amber-400/30 px-2.5 py-2 text-xs font-bold text-amber-200"><Download size={16}/><span className="hidden sm:inline">تثبيت</span></button><button onClick={()=>load()} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/5"><RefreshCw size={18}/></button><button onClick={logout} className="flex items-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-sm text-red-300"><LogOut size={16}/> خروج</button></div></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-0 pb-[calc(6.5rem+env(safe-area-inset-bottom))] [touch-action:pan-y] sm:px-0" style={{WebkitOverflowScrolling:"touch"}}><div className="mx-auto grid max-w-[1500px] gap-4 p-3 sm:p-4 lg:grid-cols-[230px_1fr]">
      <aside className="hidden h-fit rounded-2xl border border-white/10 bg-[#111827] p-3 lg:sticky lg:top-24 lg:block"><p className="mb-3 px-3 text-[10px] font-bold text-slate-500">القائمة الرئيسية</p>{nav.map(n=><button key={n.id} onClick={()=>setSection(n.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold ${section===n.id?'bg-amber-400 text-slate-950':'text-slate-300 hover:bg-white/5'}`}><n.icon size={18}/>{n.label}</button>)}</aside>
      <main className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black sm:text-2xl">{nav.find(n=>n.id===section)?.label}</h2><p className="mt-1 text-xs text-slate-500">إدارة مباشرة لبيانات اللعبة على قاعدة البيانات</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">اتصال إداري مفعّل</span></div>
        {error&&<div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {notice&&<div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}
        {section==='overview'&&<><div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">{statCards.map(([label,value,key])=><div key={String(key)} className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-3 sm:p-4"><p className="text-[11px] leading-5 text-slate-400 sm:text-xs">{label}</p><p className="mt-2 break-words text-xl font-black text-amber-300 sm:mt-3 sm:text-2xl">{money(value)}</p></div>)}</div><div className="rounded-2xl border border-white/10 bg-[#111827] p-5"><h3 className="mb-3 font-black">إجراءات سريعة</h3><div className="grid gap-3 md:grid-cols-2"><ActionBox title="إرسال إعلان لجميع اللاعبين" desc="إشعار رسمي يظهر في صندوق إشعارات اللعبة" onClick={()=>setActionDialog({action:'broadcast'})}/><ActionBox title="توزيع العملات" desc="إضافة رصيد جماعي مع بيان السبب" onClick={()=>setActionDialog({action:'broadcast-coins'})}/></div></div></>}
        {section==='players'&&<><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute right-3 top-3 text-slate-500" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load('players')} placeholder="ابحث بالاسم أو اسم المستخدم أو Telegram ID" className="w-full rounded-xl border border-white/10 bg-[#111827] py-3 pr-10 pl-3 text-sm"/></div><button onClick={()=>load('players')} className="rounded-xl bg-slate-700 px-4">بحث</button></div><div className="space-y-2 md:hidden">{players.map(p=><article key={p.telegram_id} className="rounded-2xl border border-white/10 bg-[#111827] p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-black">{displayName(p)}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-400">{p.telegram_id}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='active'?'bg-emerald-400/10 text-emerald-300':'bg-red-400/10 text-red-300'}`}>{p.status==='active'?'نشط':'محظور'}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-white/[.04] p-2"><span className="text-slate-400">العملات</span><p className="mt-1 font-black text-amber-300">{money(p.coins)}</p></div><div className="rounded-xl bg-white/[.04] p-2"><span className="text-slate-400">النفط</span><p className="mt-1 font-black">{money(p.oil)}</p></div><div className="rounded-xl bg-white/[.04] p-2"><span className="text-slate-400">سرعة الضغطة</span><p className="mt-1 font-bold">{money(p.base_oil_per_tap)}</p></div><div className="rounded-xl bg-white/[.04] p-2"><span className="text-slate-400">رسوم التعدين</span><p className="mt-1 font-bold">{p.fee_exempt?'معفى':'غير معفى'}</p></div></div><button onClick={()=>{setSelected(p);setSpeed(String(p.base_oil_per_tap));setProductRows([]);setActionDialog({action:'player'});void loadPlayerProducts(p.telegram_id);}} className="mt-3 w-full rounded-xl bg-amber-400 py-2.5 text-xs font-black text-slate-950">إدارة اللاعب</button></article>)}</div><div className="hidden overflow-hidden rounded-2xl border border-white/10 bg-[#111827] md:block"><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead className="bg-white/5 text-slate-400"><tr>{['اللاعب','Telegram ID','الحالة','العملات','النفط','سرعة الضغطة','الإجراءات'].map(x=><th className="p-3 text-right" key={x}>{x}</th>)}</tr></thead><tbody>{players.map(p=><tr key={p.telegram_id} className="border-t border-white/5"><td className="p-3 font-bold">{displayName(p)}</td><td className="p-3 font-mono text-xs text-slate-400">{p.telegram_id}</td><td className="p-3">{p.status==='active'?'نشط':'محظور'}</td><td className="p-3 text-amber-300">{money(p.coins)}</td><td className="p-3">{money(p.oil)}</td><td className="p-3">{money(p.base_oil_per_tap)}</td><td className="p-3"><span className={p.fee_exempt?'text-emerald-300':'text-slate-500'}>{p.fee_exempt?'معفى':'غير معفى'}{p.mining_fee_paid_at?' · دافع':''}</span></td><td className="p-3"><button onClick={()=>{setSelected(p);setSpeed(String(p.base_oil_per_tap));setProductRows([]);setActionDialog({action:'player'});void loadPlayerProducts(p.telegram_id);}} className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">إدارة</button></td></tr>)}</tbody></table></div></div></>}
        {section==='referrals'&&<DataTable title="سجل الإحالات" rows={referralRows} columns={['referrer_telegram_id','referrer_name','referee_telegram_id','referee_name','status','reward_coins','created_at']}/>}
        {section==='withdrawals'&&<><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">طلبات TON وUSDT</h3><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="paid">موافق عليه</option><option value="rejected">مرفوض</option><option value="all">الكل</option></select></div><DataTable title="سحب TON" rows={ton} columns={['id','telegram_id','units','coins','ton_address','status','created_at']} action={(r)=>setActionDialog({action:'withdrawal',id:String(r.id),currency:'ton'})}/><DataTable title="سحب USDT" rows={usdt} columns={['id','telegram_id','usd_micros','tron_address','status','created_at']} action={(r)=>setActionDialog({action:'withdrawal',id:String(r.id),currency:'usdt'})}/></>}
        {section==='payments'&&<><div className="flex justify-end"><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="confirmed">موافق عليه</option><option value="rejected">مرفوض</option><option value="all">الكل</option></select></div><DataTable title="طلبات شراء القطع والترقيات" rows={payments} columns={['id','telegram_id','package_id','asset','amount','status','created_at']} action={r=>setActionDialog({action:'payment',id:String(r.id)})}/></>}
        {section==='broadcasts'&&<section className="overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-[#172235] to-[#111827] p-5 sm:p-7">
          <div className="mb-6 flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-300"><BellRing size={24}/></div><div><h3 className="text-lg font-black">مركز الرسائل والإعلانات</h3><p className="mt-1 text-sm leading-6 text-slate-400">أرسل إعلانًا رسميًا يظهر للاعبين داخل اللعبة كإشعار واضح بعنوان ورسالة، دون إرسال رسائل خارجية.</p></div></div>
          <div className="space-y-4 rounded-2xl border border-white/10 bg-black/15 p-4 sm:p-5">
            <div><label className="mb-2 block text-sm font-bold text-slate-300">عنوان الرسالة</label><input maxLength={100} value={broadcastTitle} onChange={e=>setBroadcastTitle(e.target.value)} placeholder="مثال: 🎉 خبر سار لجميع اللاعبين" className="w-full rounded-xl border border-white/10 bg-[#090f1b] px-4 py-3 outline-none focus:border-amber-400"/></div>
            <div><div className="mb-2 flex justify-between"><label className="text-sm font-bold text-slate-300">محتوى الرسالة</label><span className="text-xs text-slate-500">{broadcastMessage.length}/1000</span></div><textarea maxLength={1000} value={broadcastMessage} onChange={e=>setBroadcastMessage(e.target.value)} placeholder="اكتب تفاصيل الإعلان أو التحديث أو التنبيه الذي سيظهر داخل اللعبة..." className="min-h-36 w-full rounded-xl border border-white/10 bg-[#090f1b] px-4 py-3 leading-7 outline-none focus:border-amber-400"/></div>
            <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-slate-500">سيصل الإشعار إلى جميع اللاعبين النشطين، وسيظهر داخل اللعبة عند المزامنة التالية.</p><button disabled={busy||!broadcastTitle.trim()||!broadcastMessage.trim()} onClick={()=>act({action:'broadcast',title:broadcastTitle,message:broadcastMessage})} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3 font-black text-slate-950 shadow-lg shadow-amber-400/10 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"><Megaphone size={18}/> إرسال للجميع</button></div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400"/> الإشعارات تُحفظ في قاعدة البيانات وتُعرض داخل اللعبة</div>
        </section>}
        {section==='shorts'&&<div className="space-y-4">
          <section className="rounded-2xl border border-amber-400/20 bg-[#111827] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="font-black text-amber-200">التحكم في تحدي YouTube Shorts</h3><p className="mt-1 text-xs text-slate-400">التحكم مركزي من الخادم ويؤثر على ظهور الزر لجميع اللاعبين.</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${shortsContest?.status==='active'&&Date.now()<Number(shortsContest?.ends_at)?'bg-emerald-400/10 text-emerald-300':'bg-red-400/10 text-red-300'}`}>{shortsContest?.status==='active'&&Date.now()<Number(shortsContest?.ends_at)?'التحدي نشط':shortsContest?.status==='paused'?'التحدي متوقف مؤقتًا':shortsContest?.status==='cancelled'?'التحدي ملغي':'انتهت المدة'}</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <p>بداية التحدي: <b className="text-slate-200">{shortsContest?.starts_at?new Date(Number(shortsContest.starts_at)).toLocaleString('ar-EG'):'—'}</b></p>
              <p>نهاية التحدي: <b className="text-slate-200">{shortsContest?.ends_at?new Date(Number(shortsContest.ends_at)).toLocaleString('ar-EG'):'—'}</b></p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button disabled={busy||shortsContest?.status==='paused'} onClick={()=>act({action:'shorts_contest',operation:'pause'})} className="rounded-xl bg-amber-400/15 p-3 text-sm font-bold text-amber-200 disabled:opacity-40">إيقاف التحدي مؤقتًا</button>
              <button disabled={busy||shortsContest?.status==='active'} onClick={()=>act({action:'shorts_contest',operation:'activate'})} className="rounded-xl bg-emerald-400/15 p-3 text-sm font-bold text-emerald-200 disabled:opacity-40">تفعيل / استئناف التحدي</button>
              <button disabled={busy||shortsContest?.status==='cancelled'} onClick={()=>{if(window.confirm('هل تريد إلغاء التحدي وإخفاء الزر عن جميع اللاعبين؟'))void act({action:'shorts_contest',operation:'cancel'});}} className="rounded-xl bg-red-400/15 p-3 text-sm font-bold text-red-200 disabled:opacity-40">إلغاء التحدي نهائيًا</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <label className="text-xs text-slate-400">تمديد المدة بالساعات</label>
              <input type="number" min="1" max="2160" value={extensionHours} onChange={e=>setExtensionHours(e.target.value)} className="w-28 rounded-xl border border-white/10 bg-slate-900 p-2 text-sm"/>
              <button disabled={busy||!Number.isInteger(Number(extensionHours))||Number(extensionHours)<1||Number(extensionHours)>2160} onClick={()=>act({action:'shorts_contest',operation:'extend',hours:Number(extensionHours)})} className="rounded-xl bg-sky-400/15 px-4 py-2 text-sm font-bold text-sky-200 disabled:opacity-40">تمديد وإظهار التحدي</button>
              <p className="w-full text-[11px] text-slate-500">التمديد يعيد التحدي إلى الحالة النشطة ويضيف الساعات إلى وقت الانتهاء، بحد أقصى 90 يومًا لكل عملية.</p>
            </div>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-400">مراجعة المشاركات واستبعاد الروابط المخالفة. أرقام المشاهدات مُدخلة من اللاعبين وليست موثقة من YouTube.</p><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="approved">المعتمدة</option><option value="rejected">المستبعدة</option><option value="all">الكل</option></select></div>
          <DataTable title="مشاركات YouTube Shorts" rows={shortsRows} columns={['first_name','username','telegram_id','video_url','declared_views','status','created_at']} action={(row)=>{const raw=window.prompt('أدخل عدد المشاهدات الحالي للموافقة، أو اكتب رفض لاستبعاد الفيديو:',String(row.declared_views??0));if(raw===null)return;if(raw.trim()==='رفض'){void act({action:'shorts_review',id:String(row.id),status:'rejected',views:0});return;}const views=Number(raw.trim());if(!Number.isSafeInteger(views)||views<0||views>2000000000){setError('أدخل عدد مشاهدات صحيحًا أو اكتب رفض');return;}void act({action:'shorts_review',id:String(row.id),status:'approved',views});}}/>
        </div>}
        {section==='storyTasks'&&<section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-400/20 bg-[#111827] p-4">
            <div><h3 className="font-black text-amber-200">مراجعة حالات ARMCO OIL</h3><p className="mt-1 text-xs text-slate-400">افتح رابط الحالة في تيليجرام، تحقق من ظهور بوستر اللعبة ورابط @armcooilbot، ثم وافق أو ارفض.</p></div>
            <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="approved">المعتمدة</option><option value="rejected">المرفوضة</option><option value="all">الكل</option></select>
          </div>
          <div className="space-y-3">
            {storyRows.map(row=><article key={String(row.id)} className="rounded-2xl border border-white/10 bg-[#111827] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-black">{String(row.first_name||row.username||'لاعب')}</p><p className="mt-1 text-xs text-slate-400" dir="ltr">ID: {String(row.telegram_id)}</p><p className="mt-1 text-[11px] text-slate-500">تاريخ الإرسال: {String(row.submitted_at)}</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${row.status==='pending'?'bg-amber-400/10 text-amber-200':row.status==='approved'?'bg-emerald-400/10 text-emerald-200':'bg-red-400/10 text-red-200'}`}>{row.status==='pending'?'قيد المراجعة':row.status==='approved'?'تمت الموافقة':'مرفوضة'}</span>
              </div>
              <a href={String(row.story_url)} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 break-all rounded-xl bg-sky-400/10 p-3 text-xs text-sky-200 underline" dir="ltr"><ExternalLink size={16} className="shrink-0"/> {String(row.story_url)}</a>
              {Boolean(row.review_reason)&&<p className="mt-2 text-xs text-red-300">سبب الرفض: {String(row.review_reason)}</p>}
              {row.status==='pending'&&<div className="mt-3 grid grid-cols-2 gap-2">
                <button disabled={busy} onClick={()=>act({action:'story_review',id:String(row.id),status:'approved'})} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 p-3 text-sm font-black text-emerald-200 disabled:opacity-40"><CheckCircle size={17}/> موافقة وصرف 500</button>
                <button disabled={busy} onClick={()=>act({action:'story_review',id:String(row.id),status:'rejected'})} className="flex items-center justify-center gap-2 rounded-xl bg-red-500/15 p-3 text-sm font-black text-red-200 disabled:opacity-40"><XOctagon size={17}/> رفض</button>
              </div>}
            </article>)}
            {!storyRows.length&&<div className="rounded-2xl border border-white/10 bg-[#111827] p-8 text-center text-sm text-slate-500">لا توجد طلبات في هذا التصنيف.</div>}
          </div>
        </section>}
        {section==='audit'&&<DataTable title="آخر العمليات الإدارية" rows={logs} columns={['action','target_type','target_id','details_json','created_at']}/>}
      </main>
    </div></div>
    <nav aria-label="التنقل في لوحة الإدارة" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0d1422]/95 px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_35px_rgba(0,0,0,.35)] backdrop-blur-xl md:hidden"><div className="mx-auto grid max-w-xl grid-cols-5 gap-1">{[{id:'overview',label:'الرئيسية',icon:LayoutDashboard},{id:'players',label:'اللاعبون',icon:Users},{id:'withdrawals',label:'السحب',icon:Wallet},{id:'payments',label:'المشتريات',icon:ShoppingBag},{id:'more',label:'المزيد',icon:MoreHorizontal}].map(n=><button key={n.id} onClick={()=>{if(n.id==='more'){setMobileMenuOpen(v=>!v);return;}setSection(n.id as Section);setMobileMenuOpen(false);}} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-bold ${section===n.id?'bg-amber-400/15 text-amber-300':'text-slate-400'}`}><n.icon size={20}/><span>{n.label}</span></button>)}</div>{mobileMenuOpen&&<div className="absolute inset-x-3 bottom-[calc(100%+.5rem)] grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#111827] p-3 shadow-2xl">{nav.filter(n=>!['overview','players','withdrawals','payments'].includes(n.id)).map(n=><button key={n.id} onClick={()=>{setSection(n.id);setMobileMenuOpen(false);}} className={`flex min-w-0 items-center gap-2 rounded-xl p-3 text-right text-xs font-bold ${section===n.id?'bg-amber-400 text-slate-950':'bg-white/5 text-slate-200'}`}><n.icon size={17}/><span className="truncate">{n.label}</span></button>)}</div>}</nav>
    {actionDialog&&<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4"><div className="my-6 w-full max-w-xl rounded-2xl border border-white/10 bg-[#111827] p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-black">{actionDialog.action==='player'?'إدارة اللاعب':actionDialog.action==='withdrawal'?'مراجعة طلب السحب':actionDialog.action==='payment'?'مراجعة عملية الشراء':actionDialog.action==='broadcast'?'إرسال إشعار':'توزيع العملات'}</h3><button onClick={()=>setActionDialog(null)}><XCircle/></button></div>
      {actionDialog.action==='player'&&selected&&<div className="space-y-3"><p className="rounded-xl bg-white/5 p-3 text-sm">{displayName(selected)} · {selected.telegram_id}</p><button onClick={()=>act({action:'set_mining_fee_exemption',telegramId:selected.telegram_id,exempt:selected.fee_exempt?'0':'1',reason:reason||'تعديل إعفاء رسوم التعدين من الإدارة'})} className={`w-full rounded-xl p-3 ${selected.fee_exempt?'bg-red-500/15 text-red-200':'bg-emerald-500/15 text-emerald-200'}`}>{selected.fee_exempt?'إلغاء إعفاء رسوم التعدين':'إعفاء اللاعب من رسوم التعدين'}</button><p className="text-xs text-slate-500">{selected.mining_fee_paid_at?'هذا الحساب دفع رسوم التفعيل بالفعل.':'الحساب لم يسجل دفع رسوم التفعيل بعد.'}</p><div className="grid gap-2 sm:grid-cols-2"><button onClick={()=>act({action:selected.status==='active'?'ban':'unban',telegramId:selected.telegram_id,reason:reason||'قرار الإدارة'})} className="rounded-xl bg-red-500/15 p-3 text-red-200">{selected.status==='active'?'حظر اللاعب':'رفع الحظر'}</button><button onClick={()=>act({action:'grant_coins',telegramId:selected.telegram_id,amount:Number(amount),reason})} className="rounded-xl bg-amber-400/15 p-3 text-amber-200">إضافة عملات</button></div><button onClick={()=>act({action:'grant_oil',telegramId:selected.telegram_id,amount:Number(amount),reason})} className="w-full rounded-xl bg-sky-400/10 p-3 text-sky-200">إضافة نفط</button><div><label className="mb-1 block text-xs text-slate-400">السرعة الأساسية لكل ضغطة</label><input value={speed} onChange={e=>setSpeed(e.target.value)} type="number" className="w-full rounded-xl bg-slate-900 p-3"/><button onClick={()=>act({action:'set_speed',telegramId:selected.telegram_id,speed:Number(speed),reason:reason||'تعديل سرعة من الإدارة'})} className="mt-2 w-full rounded-xl bg-purple-400/15 p-3 text-purple-200">حفظ السرعة</button></div><input value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="عدد العملات أو النفط" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="سبب العملية / سبب الحظر" className="min-h-20 w-full rounded-xl bg-slate-900 p-3"/></div>}

      {actionDialog.action==='player'&&selected&&<div className="mt-3 space-y-3 border-t border-white/10 pt-3">
        <h4 className="font-bold text-sm text-amber-200">مشتريات اللاعب والتحكم بها</h4>
        {!productRows.length&&<p className="text-xs text-slate-500">لا توجد مشتريات مؤكدة لهذا اللاعب، أو جارٍ تحميلها.</p>}
        {productRows.map((r,i)=><div key={String(r.purchase_id??i)} className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2 text-xs"><b>{String(r.product_id)}</b><span className={String(r.control_status)==='active'?'text-emerald-300':String(r.control_status)==='paused'?'text-amber-300':'text-red-300'}>{String(r.control_status)}</span></div>
          <p className="text-[11px] text-slate-400">السعر: {String(r.amount??'—')} {String(r.asset??'TON')} · TX: {String(r.tx_hash??'—')}</p>
          <p className="text-[11px] text-slate-500">تاريخ الشراء: {String(r.purchased_at??'—')} {r.expires_at?' · ينتهي: '+String(r.expires_at):''}</p>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={()=>act({action:'product_control',telegramId:selected.telegram_id,productId:String(r.product_id),productType:String(r.product_type),operation:'pause'})} className="rounded-lg bg-amber-400/10 p-2 text-[11px] text-amber-200">إيقاف مؤقت</button>
            <button onClick={()=>act({action:'product_control',telegramId:selected.telegram_id,productId:String(r.product_id),productType:String(r.product_type),operation:'activate'})} className="rounded-lg bg-emerald-400/10 p-2 text-[11px] text-emerald-200">إعادة تفعيل</button>
            <button onClick={()=>act({action:'product_control',telegramId:selected.telegram_id,productId:String(r.product_id),productType:String(r.product_type),operation:'revoke'})} className="rounded-lg bg-red-400/10 p-2 text-[11px] text-red-200">إلغاء</button>
          </div>
          <div className="flex gap-2"><input type="number" min="0" max="100" step="0.05" defaultValue={String(r.speed_multiplier??1)} id={'speed-'+String(r.purchase_id)} className="min-w-0 flex-1 rounded-lg bg-slate-900 p-2 text-xs" /><button onClick={()=>{const el=document.getElementById('speed-'+String(r.purchase_id)) as HTMLInputElement|null;act({action:'product_control',telegramId:selected.telegram_id,productId:String(r.product_id),productType:String(r.product_type),operation:'speed',speedMultiplier:Number(el?.value??1)});}} className="rounded-lg bg-purple-400/15 px-3 text-xs text-purple-200">حفظ معامل السرعة</button></div>
        </div>)}
      </div>}
      {actionDialog.action==='player'&&selected&&<div className="mt-3 space-y-2 border-t border-white/10 pt-3">
        <h4 className="font-bold text-sm text-amber-200">إدارة إحالات هذا اللاعب</h4>
        <p className="text-xs text-slate-400">أدخل Telegram ID للاعب المراد نقله ليصبح هذا اللاعب هو الداعي الجديد.</p>
        <input value={referralMemberId} onChange={e=>setReferralMemberId(e.target.value)} placeholder="Telegram ID للاعب المحال" className="w-full rounded-xl bg-slate-900 p-3 text-sm"/>
        <button disabled={!referralMemberId.trim()||busy} onClick={()=>act({action:'move_referral',telegramId:selected.telegram_id,refereeTelegramId:referralMemberId.trim(),reason:'نقل إحالة من لوحة الإدارة'})} className="w-full rounded-xl bg-sky-400/15 p-3 text-sky-200 disabled:opacity-40">نقل اللاعب إلى إحالات هذا العضو</button>
      </div>}
      {actionDialog.action==='withdrawal'&&<div className="space-y-3"><input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="معرّف المعاملة TX Hash (مطلوب عند الموافقة)" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder="سبب الرفض أو ملاحظة الإدارة" className="min-h-24 w-full rounded-xl bg-slate-900 p-3"/><div className="grid grid-cols-2 gap-2"><button onClick={()=>act({action:'withdrawal',id:actionDialog.id,currency:actionDialog.currency,status:'paid',txHash,reason:decisionReason||'تمت الموافقة'})} className="rounded-xl bg-emerald-500/20 p-3 text-emerald-200">موافقة</button><button onClick={()=>act({action:'withdrawal',id:actionDialog.id,currency:actionDialog.currency,status:'rejected',reason:decisionReason})} className="rounded-xl bg-red-500/20 p-3 text-red-200">رفض الطلب</button></div></div>}
      {actionDialog.action==='payment'&&<div className="space-y-3"><input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="TX Hash / مرجع التحويل" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder="سبب الرفض" className="min-h-20 w-full rounded-xl bg-slate-900 p-3"/><div className="grid grid-cols-2 gap-2"><button onClick={()=>act({action:'payment',id:actionDialog.id,status:'confirmed',txHash})} className="rounded-xl bg-emerald-500/20 p-3 text-emerald-200">تأكيد الدفع والتفعيل</button><button onClick={()=>act({action:'payment',id:actionDialog.id,status:'rejected',reason:decisionReason||'تعذر التحقق من الدفعة'})} className="rounded-xl bg-red-500/20 p-3 text-red-200">رفض الشراء</button></div></div>}
      {(actionDialog.action==='broadcast'||actionDialog.action==='broadcast-coins')&&<div className="space-y-3"><input value={broadcastTitle} onChange={e=>setBroadcastTitle(e.target.value)} placeholder="عنوان الإشعار" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={broadcastMessage} onChange={e=>setBroadcastMessage(e.target.value)} placeholder="نص الإشعار أو سبب المكافأة" className="min-h-28 w-full rounded-xl bg-slate-900 p-3"/><input value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="عدد العملات (في التوزيع)" className="w-full rounded-xl bg-slate-900 p-3"/><button onClick={()=>act(actionDialog.action==='broadcast'?{action:'broadcast',title:broadcastTitle,message:broadcastMessage}:{action:'broadcast_coins',amount:Number(amount),reason:broadcastMessage,title:broadcastTitle})} className="w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950">تنفيذ</button></div>}
    </div></div>}
    {busy&&<div className="fixed bottom-4 left-4 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 shadow-xl">جارٍ تنفيذ العملية…</div>}
  </div>;
}

function ActionBox({title,desc,onClick}:{title:string;desc:string;onClick:()=>void}){return <button onClick={onClick} className="rounded-xl border border-white/10 bg-white/[.03] p-4 text-right hover:bg-white/[.06]"><p className="font-bold">{title}</p><p className="mt-1 text-xs text-slate-400">{desc}</p></button>}
function DataTable({title,rows,columns,action}:{title:string;rows:Row[];columns:string[];action?:(row:Row)=>void}){return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]"><div className="border-b border-white/10 p-3 font-black sm:p-4">{title} <span className="text-xs text-slate-500">({rows.length})</span></div><div className="space-y-2 p-2 md:hidden">{rows.map((r,i)=><article key={String(r.id??i)} className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-3"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{columns.map(col=><div key={col} className="min-w-0"><p className="text-[10px] font-bold text-slate-500">{col}</p><p className="mt-0.5 break-all text-xs text-slate-200">{String(r[col]??'—')}</p></div>)}</div>{action&&<button onClick={()=>action(r)} className="mt-3 w-full rounded-lg bg-amber-400/10 px-3 py-2.5 text-xs font-black text-amber-200">مراجعة الطلب</button>}</article>)}{!rows.length&&<p className="p-5 text-center text-xs text-slate-500">لا توجد سجلات</p>}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[850px] text-xs"><thead className="bg-white/5 text-slate-400"><tr>{columns.map(c=><th key={c} className="p-3 text-right">{c}</th>)}{action&&<th className="p-3">الإجراء</th>}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.id??i)} className="border-t border-white/5">{columns.map(c=><td key={c} className="max-w-[220px] truncate p-3">{String(r[c]??'—')}</td>)}{action&&<td className="p-3"><button onClick={()=>action(r)} className="rounded-lg bg-amber-400/10 px-3 py-2 font-bold text-amber-200">مراجعة</button></td>}</tr>)}{!rows.length&&<tr><td colSpan={columns.length+(action?1:0)} className="p-6 text-center text-slate-500">لا توجد سجلات</td></tr>}</tbody></table></div></section>}