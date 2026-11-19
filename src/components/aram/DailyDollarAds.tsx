'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, DollarSign, Loader2, Play, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import type { Lang } from '@/lib/i18n';

type Progress = { views:number; limit:number; remaining:number; completed:boolean; usdBalance:string };
const TEXT: Record<Lang, string[]> = {
 ar:['شاهد 100 إعلان','أكمل 100 مشاهدة مؤكدة لتحصل على المكافأة اليومية.','شاهد الإعلان','جارٍ التحقق...','اكتملت مكافأة اليوم','مكافأة الدورة الكاملة','رصيد الدولار','تمت إضافة 0.00121$ إلى محفظتك الدولارية','لا يوجد إعلان متاح الآن.','لم يؤكد Monetag مشاهدة مدفوعة. لم تُحتسب.','أكملت 100 إعلان اليوم. عُد غدًا.','التقدم اليومي','يتجدد يوميًا بتوقيت القاهرة'],
 en:['Watch 100 ads','Complete 100 verified ad views to earn the daily reward.','Watch ad','Verifying ad...','Today’s reward completed','Full-cycle reward','USD wallet balance','$0.00121 was added to your USD wallet','No ad is available right now.','Monetag did not confirm a valued impression. It was not counted.','You completed today’s 100 ads. Come back tomorrow.','Daily progress','Resets daily at Cairo time'],
 ru:['Смотрите 100 реклам','Завершите 100 подтверждённых просмотров для дневной награды.','Смотреть рекламу','Проверка рекламы...','Дневная награда получена','Награда за полный цикл','Баланс USD','0,00121 $ добавлено в USD-кошелёк','Сейчас рекламы нет.','Monetag не подтвердил оплачиваемый показ.','100 реклам на сегодня завершены.','Дневной прогресс','Сброс по времени Каира'],
 es:['Mira 100 anuncios','Completa 100 visualizaciones verificadas para obtener la recompensa diaria.','Ver anuncio','Verificando...','Recompensa de hoy completada','Recompensa del ciclo','Saldo USD','Se añadieron 0,00121 $ a tu cartera USD','No hay anuncios disponibles.','Monetag no confirmó una impresión válida.','Has completado los 100 anuncios de hoy.','Progreso diario','Se reinicia según la hora de El Cairo'],
 pt:['Assista a 100 anúncios','Conclua 100 visualizações verificadas para receber a recompensa diária.','Assistir anúncio','Verificando...','Recompensa de hoje concluída','Recompensa do ciclo','Saldo USD','US$ 0,00121 foi adicionado à carteira USD','Nenhum anúncio disponível agora.','Monetag não confirmou uma impressão válida.','Você concluiu os 100 anúncios de hoje.','Progresso diário','Reinicia no horário do Cairo'],
 fr:['Regardez 100 publicités','Terminez 100 vues vérifiées pour recevoir la récompense quotidienne.','Voir la publicité','Vérification...','Récompense du jour terminée','Récompense du cycle','Solde USD','0,00121 $ ajouté au portefeuille USD','Aucune publicité disponible.','Monetag n’a pas confirmé une impression rémunérée.','Vous avez terminé les 100 publicités du jour.','Progression quotidienne','Réinitialisation à l’heure du Caire'],
 de:['100 Anzeigen ansehen','Schließe 100 bestätigte Aufrufe für die Tagesprämie ab.','Anzeige ansehen','Wird geprüft...','Tagesprämie abgeschlossen','Prämie für den Zyklus','USD-Guthaben','0,00121 $ wurden deinem USD-Wallet gutgeschrieben','Derzeit keine Anzeige verfügbar.','Monetag hat keine vergütete Impression bestätigt.','Du hast heute 100 Anzeigen abgeschlossen.','Tagesfortschritt','Reset nach Kairo-Zeit'],
 tr:['100 reklam izle','Günlük ödül için 100 doğrulanmış görüntülemeyi tamamla.','Reklamı izle','Doğrulanıyor...','Bugünün ödülü tamamlandı','Tam döngü ödülü','USD cüzdan bakiyesi','0,00121 $ USD cüzdanına eklendi','Şu anda reklam yok.','Monetag ücretli gösterimi doğrulamadı.','Bugünkü 100 reklam tamamlandı.','Günlük ilerleme','Kahire saatine göre yenilenir'],
 zh:['观看100个广告','完成100次已验证展示即可获得每日奖励。','观看广告','正在验证...','今日奖励已完成','完整周期奖励','美元钱包余额','已向美元钱包添加0.00121美元','目前没有可用广告。','Monetag未确认有效付费展示。','今天的100个广告已完成。','每日进度','按开罗时间每日重置'],
 hi:['100 विज्ञापन देखें','दैनिक इनाम के लिए 100 सत्यापित दृश्य पूरे करें।','विज्ञापन देखें','जाँच हो रही है...','आज का इनाम पूरा','पूरे चक्र का इनाम','USD वॉलेट बैलेंस','0.00121 डॉलर USD वॉलेट में जोड़े गए','अभी विज्ञापन उपलब्ध नहीं है।','Monetag ने भुगतान वाला दृश्य सत्यापित नहीं किया।','आज के 100 विज्ञापन पूरे हुए।','दैनिक प्रगति','काहिरा समय के अनुसार रीसेट'],
 id:['Tonton 100 iklan','Selesaikan 100 tayangan terverifikasi untuk hadiah harian.','Tonton iklan','Memverifikasi...','Hadiah hari ini selesai','Hadiah siklus penuh','Saldo dompet USD','$0,00121 ditambahkan ke dompet USD','Iklan belum tersedia.','Monetag tidak mengonfirmasi tayangan bernilai.','100 iklan hari ini selesai.','Progres harian','Reset menurut waktu Kairo'],
 bn:['১০০টি বিজ্ঞাপন দেখুন','দৈনিক পুরস্কারের জন্য ১০০টি যাচাইকৃত ভিউ সম্পূর্ণ করুন।','বিজ্ঞাপন দেখুন','যাচাই হচ্ছে...','আজকের পুরস্কার সম্পূর্ণ','সম্পূর্ণ চক্রের পুরস্কার','USD ওয়ালেট ব্যালেন্স','0.00121 ডলার USD ওয়ালেটে যোগ হয়েছে','এখন বিজ্ঞাপন নেই।','Monetag বৈধ পেইড ভিউ নিশ্চিত করেনি।','আজকের ১০০টি বিজ্ঞাপন সম্পূর্ণ।','দৈনিক অগ্রগতি','কায়রো সময়ে প্রতিদিন রিসেট'],
 ja:['広告を100回視聴','確認済み広告を100回完了すると毎日の報酬を獲得できます。','広告を見る','確認中...','本日の報酬を獲得済み','全サイクル報酬','USDウォレット残高','0.00121ドルをUSDウォレットに追加しました','現在広告はありません。','有効な広告表示が確認されませんでした。','本日の広告100回を完了しました。','毎日の進捗','カイロ時間で毎日リセット'],
 ko:['광고 100개 시청','확인된 광고 노출 100회를 완료하면 일일 보상을 받습니다.','광고 보기','확인 중...','오늘 보상 완료','전체 주기 보상','USD 지갑 잔액','0.00121달러가 USD 지갑에 추가되었습니다','현재 광고가 없습니다.','유효한 유료 노출이 확인되지 않았습니다.','오늘 광고 100개를 완료했습니다.','일일 진행률','카이로 시간 기준 매일 초기화'],
 ur:['100 اشتہارات دیکھیں','روزانہ انعام کے لیے 100 تصدیق شدہ اشتہارات مکمل کریں۔','اشتہار دیکھیں','تصدیق ہو رہی ہے...','آج کا انعام مکمل','مکمل سائیکل کا انعام','USD والیٹ بیلنس','0.00121 ڈالر USD والیٹ میں شامل ہوگئے','ابھی اشتہار دستیاب نہیں۔','Monetag نے قابلِ ادائیگی ویو کی تصدیق نہیں کی۔','آج کے 100 اشتہارات مکمل ہوگئے۔','روزانہ پیش رفت','قاہرہ کے وقت کے مطابق روزانہ ری سیٹ'],
};
export function DailyDollarAds() {
 const lang=useGame(s=>s.lang); const words=TEXT[lang]??TEXT.en;
 const [progress,setProgress]=useState<Progress|null>(null); const [busy,setBusy]=useState(false); const [loading,setLoading]=useState(true);
 const [initData,setInitData]=useState('');
 useEffect(()=>{const w=window as Window & {Telegram?:{WebApp?:{initData?:string}}};setInitData(w.Telegram?.WebApp?.initData??'');},[]);
 const load=useCallback(async()=>{if(!initData)return;const r=await fetch('/api/ads/daily-dollar',{headers:{'X-Telegram-Init-Data':initData},cache:'no-store'});if(!r.ok)throw new Error('progress_failed');setProgress(await r.json() as Progress);},[initData]);
 useEffect(()=>{setLoading(true);void load().catch(()=>undefined).finally(()=>setLoading(false));},[load]);
 const watch=async()=>{
  if(busy||!progress||progress.remaining<=0)return;
  const w=window as Window & {show_12295910?:(options?:{ymid?:string;requestVar?:string})=>Promise<{reward_event_type?:string;variable2?:string}|undefined>};
  if(!initData||typeof w.show_12295910!=='function'){toast.error(words[8]);return;}
  setBusy(true);
  try{
   const ymid=crypto.randomUUID();const ad=await w.show_12295910({ymid,requestVar:'daily_usd_reward'});
   if(ad?.reward_event_type==='non_valued'||(ad?.variable2&&ad.variable2!==ymid))throw new Error('not_valued');
   let claimed=false;const delays=[0,700,1200,1800,2500,3500,5000,7000,9000,12000,15000];
   for(const delay of delays){if(delay)await new Promise(resolve=>window.setTimeout(resolve,delay));
    const r=await fetch('/api/ads/daily-dollar',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({ymid}),cache:'no-store'});
    const data=await r.json().catch(()=>({})) as {ok?:boolean;credited?:boolean;error?:string;progress?:Progress};
    if(r.ok&&data.ok&&data.progress){setProgress(data.progress);toast.success(data.credited?words[7]:words[2]);claimed=true;break;}
    if(data.error!=='monetag_postback_not_verified')throw new Error(data.error??'claim_failed');
   }
   if(!claimed)throw new Error('not_valued');
  }catch(error){const reason=error instanceof Error?error.message:'';if(reason==='daily_ad_limit_reached'){await load();toast.info(words[10]);}else if(reason==='not_valued')toast.error(words[9]);else toast.error(words[8]);}
  finally{setBusy(false);void load().catch(()=>undefined);}
 };
 const views=progress?.views??0;
 return <motion.section initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} className="mx-auto mt-5 w-full max-w-md rounded-[26px] border border-white/10 bg-[#24272b] p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,.22)]">
  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[.04] text-white/70"><Tv size={25}/></div><h3 className="text-xl font-black">{words[0]}</h3></div><span className="rounded-xl border border-orange-300/40 bg-orange-400/10 px-3 py-2 text-lg font-black tabular-nums text-orange-300">{views}/100</span></div>
  <p className="mt-4 text-sm leading-7 text-white/55">{words[1]}</p>
  <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3"><div className="mb-2 flex justify-between text-xs"><span className="font-bold text-white/65">{words[11]}</span><b className="tabular-nums">{views} / 100</b></div><div className="h-3 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-emerald-400" initial={false} animate={{width:views+'%'}} transition={{duration:.35}}/></div><div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs text-white/55">{words[5]}</span><b className="text-lg font-black text-emerald-300">$0.00121</b></div></div>
  <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2"><span className="flex items-center gap-1.5 text-xs text-white/55"><DollarSign size={14}/>{words[6]}</span><b className="font-mono text-sm text-emerald-300" dir="ltr">$ {progress?.usdBalance??'0.000000'}</b></div>
  <button type="button" onClick={()=>void watch()} disabled={busy||loading||!progress||progress.remaining<=0||!initData} className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#ffa75e] px-4 py-4 text-base font-black text-[#24170e] shadow-lg transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45">{busy?<Loader2 size={20} className="animate-spin"/>:progress?.completed?<CheckCircle2 size={20}/>:<Play size={20}/>} {busy?words[3]:progress?.completed?words[4]:words[2]}</button>
  <p className="mt-2 text-center text-[10px] text-white/35">{words[12]}</p>
 </motion.section>;
}
