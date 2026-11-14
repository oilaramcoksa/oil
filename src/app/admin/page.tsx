'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Ban, CheckCircle2, Coins, Gauge, Gift, LayoutDashboard, LogOut, RefreshCw, Search, ShieldCheck, ShoppingBag, Users, Wallet, XCircle } from 'lucide-react';

type Section = 'overview' | 'players' | 'withdrawals' | 'payments' | 'audit';
type Player = {telegram_id:string;username?:string|null;first_name?:string|null;last_name?:string|null;status:string;coins:number;oil:number;base_oil_per_tap:number};
type Row = Record<string, unknown>;

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
  const [logs,setLogs] = useState<Row[]>([]);
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

  const headers = useMemo(()=>({Authorization:`Bearer ${token}`,'Content-Type':'application/json'}),[token]);

  async function load(nextSection:Section=section) {
    if(!token) return;
    setBusy(true); setError('');
    try {
      const params=new URLSearchParams({section:nextSection,status,q:query});
      const res=await fetch('/api/admin/controls?'+params.toString(),{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||'تعذر تحميل البيانات');
      if(nextSection==='overview') setOverview(data.overview||{});
      if(nextSection==='players') setPlayers(data.players||[]);
      if(nextSection==='withdrawals'){setTon(data.ton||[]);setUsdt(data.usdt||[]);}
      if(nextSection==='payments') setPayments(data.payments||[]);
      if(nextSection==='audit') setLogs(data.logs||[]);
    } catch(e){setError(e instanceof Error?e.message:'حدث خطأ');}
    finally{setBusy(false);}
  }
  useEffect(()=>{if(token) void load(section);},[token,section,status]);
  function login(e:React.FormEvent){e.preventDefault();if(!input.trim())return;setToken(input.trim());setInput('');}
  function logout(){setToken('');setOverview({});setPlayers([]);}
  async function act(payload:Record<string,unknown>) {
    setBusy(true);setError('');setNotice('');
    try{
      const res=await fetch('/api/admin/controls',{method:'POST',headers,body:JSON.stringify(payload)});
      const data=await res.json();if(!res.ok)throw new Error(data.error||'فشلت العملية');
      setNotice('تم تنفيذ العملية بنجاح');setReason('');setAmount('');setDecisionReason('');setTxHash('');setActionDialog(null);
      await load(section);
    }catch(e){setError(e instanceof Error?e.message:'حدث خطأ');}
    finally{setBusy(false);}
  }
  const nav=[
    {id:'overview' as const,label:'الرئيسية',icon:LayoutDashboard},
    {id:'players' as const,label:'اللاعبون',icon:Users},
    {id:'withdrawals' as const,label:'طلبات السحب',icon:Wallet},
    {id:'payments' as const,label:'المشتريات',icon:ShoppingBag},
    {id:'audit' as const,label:'سجل الإدارة',icon:Activity}
  ];
  if(!token) return <main dir="rtl" className="min-h-screen bg-[#090d16] text-white grid place-items-center p-5"><form onSubmit={login} className="w-full max-w-md rounded-3xl border border-amber-400/20 bg-[#111827] p-8 shadow-2xl"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-amber-400/10 text-amber-300"><ShieldCheck size={32}/></div><h1 className="text-center text-2xl font-black">Aramco Oil</h1><p className="mb-7 mt-2 text-center text-sm text-slate-400">بوابة الإدارة الآمنة</p><label className="mb-2 block text-sm text-slate-300">رمز الإدارة</label><input autoFocus type="password" value={input} onChange={e=>setInput(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-amber-400" placeholder="أدخل رمز الدخول"/><button className="mt-4 w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950">دخول لوحة التحكم</button><p className="mt-4 text-center text-xs text-slate-500">يتم التحقق من الرمز على الخادم ولا يُحفظ في المتصفح.</p></form></main>;

  const statCards=[
    ['إجمالي اللاعبين',overview.players,'users'],['نشطون آخر 7 أيام',overview.activePlayers,'active'],['العملات المتداولة',overview.coins,'coins'],['النفط المخزن',overview.oil,'oil'],['سحب TON معلّق',overview.tonPending,'ton'],['سحب USDT معلّق',overview.usdtPending,'usdt'],['مشتريات قيد المراجعة',overview.paymentPending,'payments'],['ترقيات مفعّلة',overview.activeUpgrades,'upgrades']
  ];
  return <div dir="rtl" className="min-h-screen bg-[#090d16] text-slate-100">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d1422]/95 backdrop-blur"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-slate-950"><ShieldCheck/></div><div><h1 className="font-black">ARAMCO OIL <span className="text-amber-300">ADMIN</span></h1><p className="text-[11px] text-slate-400">مركز التحكم وإدارة اللعبة</p></div></div><div className="flex gap-2"><button onClick={()=>load()} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/5"><RefreshCw size={18}/></button><button onClick={logout} className="flex items-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-sm text-red-300"><LogOut size={16}/> خروج</button></div></div></header>
    <div className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[230px_1fr]">
      <aside className="h-fit rounded-2xl border border-white/10 bg-[#111827] p-3"><p className="mb-3 px-3 text-[10px] font-bold text-slate-500">القائمة الرئيسية</p>{nav.map(n=><button key={n.id} onClick={()=>setSection(n.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold ${section===n.id?'bg-amber-400 text-slate-950':'text-slate-300 hover:bg-white/5'}`}><n.icon size={18}/>{n.label}</button>)}</aside>
      <main className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{nav.find(n=>n.id===section)?.label}</h2><p className="mt-1 text-xs text-slate-500">إدارة مباشرة لبيانات اللعبة على قاعدة البيانات</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">اتصال إداري مفعّل</span></div>
        {error&&<div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {notice&&<div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}
        {section==='overview'&&<><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{statCards.map(([label,value,key])=><div key={String(key)} className="rounded-2xl border border-white/10 bg-[#111827] p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-3 text-2xl font-black text-amber-300">{money(value)}</p></div>)}</div><div className="rounded-2xl border border-white/10 bg-[#111827] p-5"><h3 className="mb-3 font-black">إجراءات سريعة</h3><div className="grid gap-3 md:grid-cols-2"><ActionBox title="إرسال إعلان لجميع اللاعبين" desc="إشعار رسمي يظهر في صندوق إشعارات اللعبة" onClick={()=>setActionDialog({action:'broadcast'})}/><ActionBox title="توزيع العملات" desc="إضافة رصيد جماعي مع بيان السبب" onClick={()=>setActionDialog({action:'broadcast-coins'})}/></div></div></>}
        {section==='players'&&<><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute right-3 top-3 text-slate-500" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load('players')} placeholder="ابحث بالاسم أو اسم المستخدم أو Telegram ID" className="w-full rounded-xl border border-white/10 bg-[#111827] py-3 pr-10 pl-3 text-sm"/></div><button onClick={()=>load('players')} className="rounded-xl bg-slate-700 px-4">بحث</button></div><div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111827]"><table className="w-full min-w-[780px] text-sm"><thead className="bg-white/5 text-slate-400"><tr>{['اللاعب','Telegram ID','الحالة','العملات','النفط','سرعة الضغطة','الإجراءات'].map(x=><th className="p-3 text-right" key={x}>{x}</th>)}</tr></thead><tbody>{players.map(p=><tr key={p.telegram_id} className="border-t border-white/5"><td className="p-3 font-bold">{displayName(p)}</td><td className="p-3 font-mono text-xs text-slate-400">{p.telegram_id}</td><td className="p-3">{p.status==='active'?'نشط':'محظور'}</td><td className="p-3 text-amber-300">{money(p.coins)}</td><td className="p-3">{money(p.oil)}</td><td className="p-3">{money(p.base_oil_per_tap)}</td><td className="p-3"><button onClick={()=>{setSelected(p);setSpeed(String(p.base_oil_per_tap));setActionDialog({action:'player'});}} className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">إدارة</button></td></tr>)}</tbody></table></div></>}
        {section==='withdrawals'&&<><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">طلبات TON وUSDT</h3><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="paid">موافق عليه</option><option value="rejected">مرفوض</option><option value="all">الكل</option></select></div><DataTable title="سحب TON" rows={ton} columns={['id','telegram_id','units','coins','ton_address','status','created_at']} action={(r)=>setActionDialog({action:'withdrawal',id:String(r.id),currency:'ton'})}/><DataTable title="سحب USDT" rows={usdt} columns={['id','telegram_id','usd_micros','tron_address','status','created_at']} action={(r)=>setActionDialog({action:'withdrawal',id:String(r.id),currency:'usdt'})}/></>}
        {section==='payments'&&<><div className="flex justify-end"><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="confirmed">موافق عليه</option><option value="rejected">مرفوض</option><option value="all">الكل</option></select></div><DataTable title="طلبات شراء القطع والترقيات" rows={payments} columns={['id','telegram_id','package_id','asset','amount','status','created_at']} action={r=>setActionDialog({action:'payment',id:String(r.id)})}/></>}
        {section==='audit'&&<DataTable title="آخر العمليات الإدارية" rows={logs} columns={['action','target_type','target_id','details_json','created_at']}/>}
      </main>
    </div>
    {actionDialog&&<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4"><div className="my-6 w-full max-w-xl rounded-2xl border border-white/10 bg-[#111827] p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-black">{actionDialog.action==='player'?'إدارة اللاعب':actionDialog.action==='withdrawal'?'مراجعة طلب السحب':actionDialog.action==='payment'?'مراجعة عملية الشراء':actionDialog.action==='broadcast'?'إرسال إشعار':'توزيع العملات'}</h3><button onClick={()=>setActionDialog(null)}><XCircle/></button></div>
      {actionDialog.action==='player'&&selected&&<div className="space-y-3"><p className="rounded-xl bg-white/5 p-3 text-sm">{displayName(selected)} · {selected.telegram_id}</p><div className="grid gap-2 sm:grid-cols-2"><button onClick={()=>act({action:selected.status==='active'?'ban':'unban',telegramId:selected.telegram_id,reason:reason||'قرار الإدارة'})} className="rounded-xl bg-red-500/15 p-3 text-red-200">{selected.status==='active'?'حظر اللاعب':'رفع الحظر'}</button><button onClick={()=>act({action:'grant_coins',telegramId:selected.telegram_id,amount:Number(amount),reason})} className="rounded-xl bg-amber-400/15 p-3 text-amber-200">إضافة عملات</button></div><button onClick={()=>act({action:'grant_oil',telegramId:selected.telegram_id,amount:Number(amount),reason})} className="w-full rounded-xl bg-sky-400/10 p-3 text-sky-200">إضافة نفط</button><div><label className="mb-1 block text-xs text-slate-400">السرعة الأساسية لكل ضغطة</label><input value={speed} onChange={e=>setSpeed(e.target.value)} type="number" className="w-full rounded-xl bg-slate-900 p-3"/><button onClick={()=>act({action:'set_speed',telegramId:selected.telegram_id,speed:Number(speed),reason:reason||'تعديل سرعة من الإدارة'})} className="mt-2 w-full rounded-xl bg-purple-400/15 p-3 text-purple-200">حفظ السرعة</button></div><input value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="عدد العملات أو النفط" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="سبب العملية / سبب الحظر" className="min-h-20 w-full rounded-xl bg-slate-900 p-3"/></div>}
      {actionDialog.action==='withdrawal'&&<div className="space-y-3"><input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="معرّف المعاملة TX Hash (مطلوب عند الموافقة)" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder="سبب الرفض أو ملاحظة الإدارة" className="min-h-24 w-full rounded-xl bg-slate-900 p-3"/><div className="grid grid-cols-2 gap-2"><button onClick={()=>act({action:'withdrawal',id:actionDialog.id,currency:actionDialog.currency,status:'paid',txHash,reason:decisionReason||'تمت الموافقة'})} className="rounded-xl bg-emerald-500/20 p-3 text-emerald-200">موافقة</button><button onClick={()=>act({action:'withdrawal',id:actionDialog.id,currency:actionDialog.currency,status:'rejected',reason:decisionReason})} className="rounded-xl bg-red-500/20 p-3 text-red-200">رفض الطلب</button></div></div>}
      {actionDialog.action==='payment'&&<div className="space-y-3"><input value={txHash} onChange={e=>setTxHash(e.target.value)} placeholder="TX Hash / مرجع التحويل" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder="سبب الرفض" className="min-h-20 w-full rounded-xl bg-slate-900 p-3"/><div className="grid grid-cols-2 gap-2"><button onClick={()=>act({action:'payment',id:actionDialog.id,status:'confirmed',txHash})} className="rounded-xl bg-emerald-500/20 p-3 text-emerald-200">تأكيد الدفع والتفعيل</button><button onClick={()=>act({action:'payment',id:actionDialog.id,status:'rejected',reason:decisionReason||'تعذر التحقق من الدفعة'})} className="rounded-xl bg-red-500/20 p-3 text-red-200">رفض الشراء</button></div></div>}
      {(actionDialog.action==='broadcast'||actionDialog.action==='broadcast-coins')&&<div className="space-y-3"><input value={broadcastTitle} onChange={e=>setBroadcastTitle(e.target.value)} placeholder="عنوان الإشعار" className="w-full rounded-xl bg-slate-900 p-3"/><textarea value={broadcastMessage} onChange={e=>setBroadcastMessage(e.target.value)} placeholder="نص الإشعار أو سبب المكافأة" className="min-h-28 w-full rounded-xl bg-slate-900 p-3"/><input value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="عدد العملات (في التوزيع)" className="w-full rounded-xl bg-slate-900 p-3"/><button onClick={()=>act(actionDialog.action==='broadcast'?{action:'broadcast',title:broadcastTitle,message:broadcastMessage}:{action:'broadcast_coins',amount:Number(amount),reason:broadcastMessage,title:broadcastTitle})} className="w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950">تنفيذ</button></div>}
    </div></div>}
    {busy&&<div className="fixed bottom-4 left-4 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 shadow-xl">جارٍ تنفيذ العملية…</div>}
  </div>;
}

function ActionBox({title,desc,onClick}:{title:string;desc:string;onClick:()=>void}){return <button onClick={onClick} className="rounded-xl border border-white/10 bg-white/[.03] p-4 text-right hover:bg-white/[.06]"><p className="font-bold">{title}</p><p className="mt-1 text-xs text-slate-400">{desc}</p></button>}
function DataTable({title,rows,columns,action}:{title:string;rows:Row[];columns:string[];action?:(row:Row)=>void}){return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]"><div className="border-b border-white/10 p-4 font-black">{title} <span className="text-xs text-slate-500">({rows.length})</span></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-xs"><thead className="bg-white/5 text-slate-400"><tr>{columns.map(c=><th key={c} className="p-3 text-right">{c}</th>)}{action&&<th className="p-3">الإجراء</th>}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.id??i)} className="border-t border-white/5">{columns.map(c=><td key={c} className="max-w-[220px] truncate p-3">{String(r[c]??'—')}</td>)}{action&&<td className="p-3"><button onClick={()=>action(r)} className="rounded-lg bg-amber-400/10 px-3 py-2 font-bold text-amber-200">مراجعة</button></td>}</tr>)}{!rows.length&&<tr><td colSpan={columns.length+(action?1:0)} className="p-6 text-center text-slate-500">لا توجد سجلات</td></tr>}</tbody></table></div></section>}
