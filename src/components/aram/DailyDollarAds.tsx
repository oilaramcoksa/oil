'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, DollarSign, Gift, Loader2, Play, Tv, X } from 'lucide-react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import type { Lang } from '@/lib/i18n';

type Progress = {
  views: number;
  limit: number;
  remaining: number;
  completed: boolean;
  rewardReady?: boolean;
  rewardClaimed?: boolean;
  rewardUsd?: string;
  usdBalance: string;
  cooldownUntil?: number | null;
  adCooldownUntil?: number | null;
};
type Copy = {
  cooldown: string; hint: string; rewardTitle: string; rewardBody: string;
  claim: string; claimed: string; nextCycle: string; claimedToast: string;
  waitAd: string; waitDaily: string; progressDone: string;
};
const TEXT: Record<Lang, string[]> = {
 ar:['شاهد 100 إعلان','أكمل 100 مشاهدة مؤكدة لتحصل على المكافأة اليومية.','شاهد الإعلان','جارٍ التحقق...','اكتملت مكافأة اليوم','مكافأة الدورة الكاملة','رصيد الدولار','تم استلام مكافأة الدورة في محفظتك الدولارية','لا يوجد إعلان متاح الآن.','لم يؤكد Monetag مشاهدة مدفوعة. لم تُحتسب.','أكملت 100 إعلان اليوم.','التقدم اليومي','تُفتح دورة جديدة بعد 24 ساعة من استلام المكافأة.'],
 en:['Watch 100 ads','Complete 100 verified ad views to earn the daily reward.','Watch ad','Verifying ad...','Today’s reward completed','Full-cycle reward','USD wallet balance','The cycle reward was claimed to your USD wallet','No ad is available right now.','Monetag did not confirm a valued impression. It was not counted.','You completed today’s 100 ads.','Daily progress','A new cycle opens 24 hours after claiming the reward.'],
 ru:['Смотрите 100 реклам','Завершите 100 подтверждённых просмотров для дневной награды.','Смотреть рекламу','Проверка рекламы...','Дневная награда получена','Награда за полный цикл','Баланс USD','Награда за цикл получена на USD-кошелёк','Сейчас рекламы нет.','Monetag не подтвердил оплачиваемый показ.','Вы завершили 100 реклам.','Дневной прогресс','Новый цикл откроется через 24 часа после получения награды.'],
 es:['Mira 100 anuncios','Completa 100 visualizaciones verificadas para obtener la recompensa diaria.','Ver anuncio','Verificando...','Recompensa de hoy completada','Recompensa del ciclo','Saldo USD','La recompensa se recibió en tu cartera USD','No hay anuncios disponibles.','Monetag no confirmó una impresión válida.','Has completado los 100 anuncios.','Progreso diario','El próximo ciclo comienza 24 horas después de reclamar.'],
 pt:['Assista a 100 anúncios','Conclua 100 visualizações verificadas para receber a recompensa diária.','Assistir anúncio','Verificando...','Recompensa de hoje concluída','Recompensa do ciclo','Saldo USD','A recompensa foi recebida na carteira USD','Nenhum anúncio disponível agora.','Monetag não confirmou uma impressão válida.','Você concluiu os 100 anúncios.','Progresso diário','O próximo ciclo começa 24 horas após o resgate.'],
 fr:['Regardez 100 publicités','Terminez 100 vues vérifiées pour recevoir la récompense quotidienne.','Voir la publicité','Vérification...','Récompense du jour terminée','Récompense du cycle','Solde USD','La récompense a été reçue dans votre portefeuille USD','Aucune publicité disponible.','Monetag n’a pas confirmé une impression rémunérée.','Vous avez terminé les 100 publicités.','Progression quotidienne','Le prochain cycle commence 24 heures après la réclamation.'],
 de:['100 Anzeigen ansehen','Schließe 100 bestätigte Aufrufe für die Tagesprämie ab.','Anzeige ansehen','Wird geprüft...','Tagesprämie abgeschlossen','Prämie für den Zyklus','USD-Guthaben','Die Prämie wurde deinem USD-Wallet gutgeschrieben','Derzeit keine Anzeige verfügbar.','Monetag hat keine vergütete Impression bestätigt.','Du hast 100 Anzeigen abgeschlossen.','Tagesfortschritt','Der nächste Zyklus beginnt 24 Stunden nach der Abholung.'],
 tr:['100 reklam izle','Günlük ödül için 100 doğrulanmış görüntülemeyi tamamla.','Reklamı izle','Doğrulanıyor...','Bugünün ödülü tamamlandı','Tam döngü ödülü','USD cüzdan bakiyesi','Döngü ödülü USD cüzdanına alındı','Şu anda reklam yok.','Monetag ücretli gösterimi doğrulamadı.','100 reklamı tamamladın.','Günlük ilerleme','Yeni döngü ödül alındıktan 24 saat sonra açılır.'],
 zh:['观看100个广告','完成100次已验证展示即可获得每日奖励。','观看广告','正在验证...','今日奖励已完成','完整周期奖励','美元钱包余额','周期奖励已领取至美元钱包','目前没有可用广告。','Monetag未确认有效付费展示。','已完成100个广告。','每日进度','领取奖励24小时后开启新周期。'],
 hi:['100 विज्ञापन देखें','दैनिक इनाम के लिए 100 सत्यापित दृश्य पूरे करें।','विज्ञापन देखें','जाँच हो रही है...','आज का इनाम पूरा','पूरे चक्र का इनाम','USD वॉलेट बैलेंस','इनाम USD वॉलेट में प्राप्त हुआ','अभी विज्ञापन उपलब्ध नहीं है।','Monetag ने भुगतान वाला दृश्य सत्यापित नहीं किया।','100 विज्ञापन पूरे हुए।','दैनिक प्रगति','इनाम लेने के 24 घंटे बाद नया चक्र शुरू होगा।'],
 id:['Tonton 100 iklan','Selesaikan 100 tayangan terverifikasi untuk hadiah harian.','Tonton iklan','Memverifikasi...','Hadiah hari ini selesai','Hadiah siklus penuh','Saldo dompet USD','Hadiah siklus diterima di dompet USD','Iklan belum tersedia.','Monetag tidak mengonfirmasi tayangan bernilai.','100 iklan telah selesai.','Progres harian','Siklus baru dibuka 24 jam setelah hadiah diklaim.'],
 bn:['১০০টি বিজ্ঞাপন দেখুন','দৈনিক পুরস্কারের জন্য ১০০টি যাচাইকৃত ভিউ সম্পূর্ণ করুন।','বিজ্ঞাপন দেখুন','যাচাই হচ্ছে...','আজকের পুরস্কার সম্পূর্ণ','সম্পূর্ণ চক্রের পুরস্কার','USD ওয়ালেট ব্যালেন্স','পুরস্কার USD ওয়ালেটে জমা হয়েছে','এখন বিজ্ঞাপন নেই।','Monetag বৈধ পেইড ভিউ নিশ্চিত করেনি।','১০০টি বিজ্ঞাপন সম্পূর্ণ হয়েছে।','দৈনিক অগ্রগতি','পুরস্কার নেওয়ার ২৪ ঘণ্টা পরে নতুন চক্র শুরু হবে।'],
 ja:['広告を100回視聴','確認済み広告を100回完了すると毎日の報酬を獲得できます。','広告を見る','確認中...','本日の報酬を獲得済み','全サイクル報酬','USDウォレット残高','報酬がUSDウォレットに追加されました','現在広告はありません。','有効な広告表示が確認されませんでした。','広告100回が完了しました。','毎日の進捗','報酬受取から24時間後に次のサイクルが始まります。'],
 ko:['광고 100개 시청','확인된 광고 노출 100회를 완료하면 일일 보상을 받습니다.','광고 보기','확인 중...','오늘 보상 완료','전체 주기 보상','USD 지갑 잔액','보상이 USD 지갑에 지급되었습니다','현재 광고가 없습니다.','유효한 유료 노출이 확인되지 않았습니다.','광고 100개를 완료했습니다.','일일 진행률','보상 수령 24시간 후 새 주기가 시작됩니다.'],
 ur:['100 اشتہارات دیکھیں','روزانہ انعام کے لیے 100 تصدیق شدہ اشتہارات مکمل کریں۔','اشتہار دیکھیں','تصدیق ہو رہی ہے...','آج کا انعام مکمل','مکمل سائیکل کا انعام','USD والیٹ بیلنس','انعام USD والیٹ میں وصول ہوگیا','ابھی اشتہار دستیاب نہیں۔','Monetag نے قابلِ ادائیگی ویو کی تصدیق نہیں کی۔','100 اشتہارات مکمل ہوگئے۔','روزانہ پیش رفت','انعام وصول کرنے کے 24 گھنٹے بعد نیا سائیکل شروع ہوگا۔'],
};
const EXTRA: Record<Lang, Copy> = {
 ar:{cooldown:'تهدئة',hint:'أكمل المشاهدة من خلال عناصر التحكم الرسمية في نافذة Monetag. لا تنقر على محتوى المعلن للحصول على المكافأة.',rewardTitle:'تم الحصول على المكافأة!',rewardBody:'أكملت 100 مشاهدة إعلان مؤكدة. مكافأتك جاهزة للاستلام.',claim:'استلام',claimed:'تم استلام مكافأة اليوم',nextCycle:'الدورة التالية بعد',claimedToast:'تمت إضافة المكافأة إلى محفظتك الدولارية.',waitAd:'انتظر قبل مشاهدة الإعلان التالي',waitDaily:'انتهت مكافأة اليوم — انتظر انتهاء الراحة',progressDone:'تم الحصول على مكافأة اليوم'},
 en:{cooldown:'Break',hint:'Complete the view using Monetag’s official controls. Do not click advertiser content to obtain a reward.',rewardTitle:'Reward unlocked!',rewardBody:'You completed 100 verified ad views. Your reward is ready to claim.',claim:'Claim',claimed:'Today’s reward claimed',nextCycle:'Next cycle in',claimedToast:'The reward was added to your USD wallet.',waitAd:'Wait before watching the next ad',waitDaily:'Daily reward claimed — rest period active',progressDone:'Today’s reward received'},
 ru:{cooldown:'Пауза',hint:'Завершите просмотр с помощью элементов управления Monetag. Не нажимайте на рекламу ради награды.',rewardTitle:'Награда доступна!',rewardBody:'Вы завершили 100 подтверждённых просмотров. Заберите награду.',claim:'Получить',claimed:'Награда за сегодня получена',nextCycle:'Следующий цикл через',claimedToast:'Награда добавлена в USD-кошелёк.',waitAd:'Подождите перед следующим объявлением',waitDaily:'Награда получена — действует перерыв',progressDone:'Дневная награда получена'},
 es:{cooldown:'Pausa',hint:'Completa la visualización con los controles oficiales de Monetag. No hagas clic en el contenido del anunciante para obtener la recompensa.',rewardTitle:'¡Recompensa desbloqueada!',rewardBody:'Completaste 100 visualizaciones verificadas. Tu recompensa está lista.',claim:'Reclamar',claimed:'Recompensa de hoy reclamada',nextCycle:'Próximo ciclo en',claimedToast:'La recompensa se añadió a tu cartera USD.',waitAd:'Espera antes del siguiente anuncio',waitDaily:'Recompensa reclamada — pausa activa',progressDone:'Recompensa diaria recibida'},
 pt:{cooldown:'Pausa',hint:'Conclua a visualização usando os controles oficiais da Monetag. Não clique no conteúdo do anunciante para receber a recompensa.',rewardTitle:'Recompensa desbloqueada!',rewardBody:'Você concluiu 100 visualizações verificadas. Sua recompensa está pronta.',claim:'Resgatar',claimed:'Recompensa de hoje resgatada',nextCycle:'Próximo ciclo em',claimedToast:'A recompensa foi adicionada à carteira USD.',waitAd:'Aguarde antes do próximo anúncio',waitDaily:'Recompensa resgatada — pausa ativa',progressDone:'Recompensa diária recebida'},
 fr:{cooldown:'Pause',hint:'Terminez la vue avec les commandes officielles de Monetag. Ne cliquez pas sur le contenu de l’annonceur pour obtenir la récompense.',rewardTitle:'Récompense débloquée !',rewardBody:'Vous avez terminé 100 vues vérifiées. Votre récompense est prête.',claim:'Réclamer',claimed:'Récompense du jour réclamée',nextCycle:'Prochain cycle dans',claimedToast:'La récompense a été ajoutée au portefeuille USD.',waitAd:'Attendez avant la prochaine publicité',waitDaily:'Récompense réclamée — pause active',progressDone:'Récompense quotidienne reçue'},
 de:{cooldown:'Pause',hint:'Schließe die Ansicht mit den offiziellen Monetag-Steuerelementen ab. Klicke nicht auf Werbeinhalte, um eine Prämie zu erhalten.',rewardTitle:'Prämie freigeschaltet!',rewardBody:'Du hast 100 bestätigte Anzeigenaufrufe abgeschlossen. Deine Prämie ist bereit.',claim:'Abholen',claimed:'Heutige Prämie abgeholt',nextCycle:'Nächster Zyklus in',claimedToast:'Die Prämie wurde deinem USD-Wallet hinzugefügt.',waitAd:'Warte vor der nächsten Anzeige',waitDaily:'Prämie abgeholt — Pause aktiv',progressDone:'Tagesprämie erhalten'},
 tr:{cooldown:'Mola',hint:'Görüntülemeyi Monetag’ın resmî kontrolleriyle tamamla. Ödül almak için reklam içeriğine tıklama.',rewardTitle:'Ödül açıldı!',rewardBody:'100 doğrulanmış reklam görüntülemesini tamamladın. Ödülün hazır.',claim:'Teslim al',claimed:'Bugünün ödülü alındı',nextCycle:'Sonraki döngü',claimedToast:'Ödül USD cüzdanına eklendi.',waitAd:'Sonraki reklamdan önce bekle',waitDaily:'Ödül alındı — mola devam ediyor',progressDone:'Günlük ödül alındı'},
 zh:{cooldown:'休息',hint:'请使用 Monetag 官方控件完成观看。不要为了领取奖励点击广告内容。',rewardTitle:'奖励已解锁！',rewardBody:'您已完成100次验证观看，奖励可以领取。',claim:'领取',claimed:'今日奖励已领取',nextCycle:'下个周期倒计时',claimedToast:'奖励已添加到美元钱包。',waitAd:'请等待后再观看下一个广告',waitDaily:'奖励已领取 — 正在休息',progressDone:'今日奖励已领取'},
 hi:{cooldown:'विराम',hint:'Monetag के आधिकारिक नियंत्रणों से विज्ञापन पूरा करें। इनाम पाने के लिए विज्ञापन सामग्री पर क्लिक न करें।',rewardTitle:'इनाम अनलॉक हुआ!',rewardBody:'आपने 100 सत्यापित विज्ञापन दृश्य पूरे किए। इनाम लेने के लिए तैयार है।',claim:'प्राप्त करें',claimed:'आज का इनाम प्राप्त हुआ',nextCycle:'अगला चक्र',claimedToast:'इनाम USD वॉलेट में जोड़ दिया गया।',waitAd:'अगले विज्ञापन से पहले प्रतीक्षा करें',waitDaily:'इनाम प्राप्त — विराम जारी',progressDone:'दैनिक इनाम प्राप्त हुआ'},
 id:{cooldown:'Jeda',hint:'Selesaikan tayangan dengan kontrol resmi Monetag. Jangan klik konten pengiklan untuk mendapatkan hadiah.',rewardTitle:'Hadiah terbuka!',rewardBody:'Anda menyelesaikan 100 tayangan terverifikasi. Hadiah siap diklaim.',claim:'Klaim',claimed:'Hadiah hari ini diklaim',nextCycle:'Siklus berikutnya dalam',claimedToast:'Hadiah ditambahkan ke dompet USD.',waitAd:'Tunggu sebelum iklan berikutnya',waitDaily:'Hadiah diklaim — jeda aktif',progressDone:'Hadiah harian diterima'},
 bn:{cooldown:'বিরতি',hint:'Monetag-এর অফিসিয়াল নিয়ন্ত্রণ ব্যবহার করে ভিউ সম্পূর্ণ করুন। পুরস্কারের জন্য বিজ্ঞাপনের কনটেন্টে ক্লিক করবেন না।',rewardTitle:'পুরস্কার আনলক হয়েছে!',rewardBody:'আপনি ১০০টি যাচাইকৃত ভিউ সম্পূর্ণ করেছেন। পুরস্কার নেওয়ার জন্য প্রস্তুত।',claim:'গ্রহণ করুন',claimed:'আজকের পুরস্কার নেওয়া হয়েছে',nextCycle:'পরবর্তী চক্র শুরু হবে',claimedToast:'পুরস্কার USD ওয়ালেটে যোগ হয়েছে।',waitAd:'পরবর্তী বিজ্ঞাপনের আগে অপেক্ষা করুন',waitDaily:'পুরস্কার নেওয়া হয়েছে — বিরতি চলছে',progressDone:'আজকের পুরস্কার পাওয়া গেছে'},
 ja:{cooldown:'休憩',hint:'Monetagの公式コントロールで視聴を完了してください。報酬目的で広告コンテンツをクリックしないでください。',rewardTitle:'報酬を獲得可能！',rewardBody:'確認済み広告を100回視聴しました。報酬を受け取れます。',claim:'受け取る',claimed:'本日の報酬を受け取り済み',nextCycle:'次のサイクルまで',claimedToast:'報酬がUSDウォレットに追加されました。',waitAd:'次の広告までお待ちください',waitDaily:'報酬受取済み — 休憩中',progressDone:'本日の報酬を獲得済み'},
 ko:{cooldown:'휴식',hint:'Monetag 공식 컨트롤로 시청을 완료하세요. 보상을 위해 광고 콘텐츠를 클릭하지 마세요.',rewardTitle:'보상 잠금 해제!',rewardBody:'확인된 광고 100회를 완료했습니다. 보상을 받을 수 있습니다.',claim:'받기',claimed:'오늘 보상 수령 완료',nextCycle:'다음 주기까지',claimedToast:'보상이 USD 지갑에 추가되었습니다.',waitAd:'다음 광고 전에 기다려 주세요',waitDaily:'보상 수령 완료 — 휴식 중',progressDone:'오늘 보상 수령 완료'},
 ur:{cooldown:'وقفہ',hint:'Monetag کے آفیشل کنٹرولز سے ویو مکمل کریں۔ انعام کے لیے اشتہار کے مواد پر کلک نہ کریں۔',rewardTitle:'انعام دستیاب ہے!',rewardBody:'آپ نے 100 تصدیق شدہ اشتہارات مکمل کرلیے۔ انعام وصول کریں۔',claim:'وصول کریں',claimed:'آج کا انعام وصول ہوگیا',nextCycle:'اگلا سائیکل',claimedToast:'انعام USD والیٹ میں شامل ہوگیا۔',waitAd:'اگلے اشتہار سے پہلے انتظار کریں',waitDaily:'انعام وصول — وقفہ جاری ہے',progressDone:'آج کا انعام مل گیا'},
};

function secondsLeft(until?: number | null, now = Date.now()) {
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
function clock(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return h + ':' + m + ':' + s;
}

export function DailyDollarAds() {
  const lang = useGame((s) => s.lang);
  const words = TEXT[lang] ?? TEXT.en;
  const extra = EXTRA[lang] ?? EXTRA.en;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initData, setInitData] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const w = window as Window & { Telegram?: { WebApp?: { initData?: string } } };
    setInitData(w.Telegram?.WebApp?.initData ?? '');
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!initData) return;
    const response = await fetch('/api/ads/daily-dollar', {
      headers: { 'X-Telegram-Init-Data': initData },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('progress_failed');
    setProgress(await response.json() as Progress);
  }, [initData]);

  useEffect(() => {
    setLoading(true);
    void load().catch(() => undefined).finally(() => setLoading(false));
  }, [load]);

  const watch = async () => {
    if (busy || !progress || progress.remaining <= 0 || secondsLeft(progress.adCooldownUntil) > 0 || secondsLeft(progress.cooldownUntil) > 0 || progress.rewardReady) return;
    const w = window as Window & {
      show_12295910?: (options?: { ymid?: string; requestVar?: string }) => Promise<{ reward_event_type?: string; variable2?: string } | undefined>;
    };
    if (!initData || typeof w.show_12295910 !== 'function') {
      toast.error(words[8]);
      return;
    }
    setBusy(true);
    window.dispatchEvent(new Event('armco:monetag-ad-start'));
    try {
      const ymid = crypto.randomUUID();
      const ad = await w.show_12295910({ ymid, requestVar: 'daily_usd_reward' });
      if (ad?.reward_event_type === 'non_valued' || (ad?.variable2 && ad.variable2 !== ymid)) throw new Error('not_valued');

      let accepted = false;
      const delays = [0, 700, 1200, 1800, 2500, 3500, 5000, 7000, 9000, 12000, 15000];
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        const response = await fetch('/api/ads/daily-dollar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
          body: JSON.stringify({ ymid }),
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; progress?: Progress };
        if (response.ok && data.ok && data.progress) {
          setProgress(data.progress);
          accepted = true;
          break;
        }
        if (data.error !== 'monetag_postback_not_verified') throw new Error(data.error ?? 'claim_failed');
      }
      if (!accepted) throw new Error('not_valued');
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'daily_ad_limit_reached') {
        await load();
      } else if (reason === 'ad_cooldown_active') {
        await load();
      } else if (reason === 'not_valued') {
        toast.error(words[9]);
      } else {
        toast.error(words[8]);
      }
    } finally {
      setBusy(false);
      void load().catch(() => undefined);
    }
  };

  const claim = async () => {
    if (claimBusy || !progress?.rewardReady || !initData) return;
    setClaimBusy(true);
    try {
      const response = await fetch('/api/ads/daily-dollar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ action: 'claim' }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; progress?: Progress };
      if (!response.ok || !data.ok || !data.progress) {
        if (data.error === 'daily_reward_not_ready') toast.error(words[9]);
        else toast.error(words[8]);
        await load();
        return;
      }
      setProgress(data.progress);
      toast.success(extra.claimedToast);
    } catch {
      toast.error(words[8]);
    } finally {
      setClaimBusy(false);
    }
  };

  const views = progress?.views ?? 0;
  const adWait = secondsLeft(progress?.adCooldownUntil, now);
  const dailyWait = secondsLeft(progress?.cooldownUntil, now);
  const rewardReady = progress?.rewardReady === true;
  const rewardClaimed = progress?.rewardClaimed === true || progress?.completed === true;

  useEffect(() => {
    if (rewardClaimed && dailyWait === 0) void load().catch(() => undefined);
  }, [dailyWait, rewardClaimed, load]);
  const progressColor = rewardClaimed ? 'bg-emerald-400' : 'bg-emerald-400';

  return <>
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-5 w-full max-w-md rounded-[26px] border border-white/10 bg-[#24272b] p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,.22)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[.04] text-white/70"><Tv size={25}/></div><h3 className="text-xl font-black">{words[0]}</h3></div>
        <span className={'rounded-xl border px-3 py-2 text-lg font-black tabular-nums ' + (rewardClaimed ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-300' : 'border-orange-300/40 bg-orange-400/10 text-orange-300')}>{views}/100</span>
      </div>
      <p className="mt-4 text-sm leading-7 text-white/55">{words[1]}</p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3">
        <div className="mb-2 flex justify-between text-xs"><span className="font-bold text-white/65">{words[11]}</span><b className="tabular-nums">{views} / 100</b></div>
        <div className="h-3 overflow-hidden rounded-full bg-white/10"><motion.div className={'h-full ' + progressColor} initial={false} animate={{ width: views + '%' }} transition={{ duration: .35 }}/></div>
        <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs text-white/55">{words[5]}</span><b className="text-lg font-black text-emerald-300">$0.00121</b></div>
        {rewardClaimed && <p className="mt-2 text-xs font-bold text-emerald-300"><CheckCircle2 size={14} className="mr-1 inline"/>{extra.progressDone}</p>}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2"><span className="flex items-center gap-1.5 text-xs text-white/55"><DollarSign size={14}/>{words[6]}</span><b className="font-mono text-sm text-emerald-300" dir="ltr">$ {progress?.usdBalance ?? '0.000000'}</b></div>

      <button type="button" onClick={() => void watch()} disabled={busy || claimBusy || loading || !progress || !initData || progress.remaining <= 0 || rewardReady || adWait > 0 || dailyWait > 0} className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#ffa75e] px-4 py-4 text-base font-black text-[#24170e] shadow-lg transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45">
        {busy ? <Loader2 size={20} className="animate-spin"/> : adWait > 0 || dailyWait > 0 ? <Clock size={20}/> : rewardClaimed ? <CheckCircle2 size={20}/> : <Play size={20}/>}
        {busy ? words[3] : dailyWait > 0 ? extra.nextCycle + ' ' + clock(dailyWait) : adWait > 0 ? extra.cooldown + ' ' + clock(adWait) : rewardClaimed ? extra.claimed : rewardReady ? extra.rewardTitle : words[2]}
      </button>
      <p className="mt-2 text-center text-[10px] text-white/35">{dailyWait > 0 ? extra.waitDaily : adWait > 0 ? extra.waitAd : words[12]}</p>
    </motion.section>

    {rewardReady && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <motion.div initial={{ opacity: 0, scale: .92, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-sm overflow-hidden rounded-[28px] border border-emerald-300/30 bg-gradient-to-br from-[#0b675b] to-[#073f3a] px-6 py-8 text-center shadow-2xl">
        <div className="mx-auto grid h-28 w-28 place-items-center rounded-[26px] border border-emerald-200/50 bg-emerald-300/20 text-6xl text-white shadow-lg"><Gift size={58}/></div>
        <p className="mt-6 text-xs font-bold tracking-[.25em] text-amber-200">• {extra.rewardTitle} •</p>
        <h2 className="mt-4 text-2xl font-black text-white">{extra.rewardBody}</h2>
        <div className="mt-5 rounded-xl border border-emerald-200/30 bg-emerald-200/10 px-4 py-4 text-xl font-black text-emerald-100" dir="ltr">$0.00121 USD</div>
        <button type="button" onClick={() => void claim()} disabled={claimBusy} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffa75e] px-5 py-4 text-lg font-black text-[#25170e] disabled:opacity-60">{claimBusy ? <Loader2 size={20} className="animate-spin"/> : <Gift size={20}/>} {claimBusy ? words[3] : extra.claim}</button>
      </motion.div>
    </div>}
  </>;
}
