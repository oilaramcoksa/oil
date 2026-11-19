'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useGame } from '@/lib/store';
import type { Lang } from '@/lib/i18n';

const COPY: Record<Lang, { title: string; body: string }> = {
  ar: { title: 'خطوة تأكيد المكافأة', body: 'اضغط زر «Click to get the reward!» الخاص بـ Monetag داخل نافذة الإعلان لإكمال خطوة المكافأة. لا تضغط على الإعلان أو زر التحميل.' },
  en: { title: 'Reward confirmation step', body: 'Press Monetag’s “Click to get the reward!” control in the ad window to complete the reward step. Do not click the ad or its download button.' },
  ru: { title: 'Подтверждение награды', body: 'Нажмите кнопку Monetag «Click to get the reward!» в окне рекламы. Не нажимайте на само объявление или кнопку загрузки.' },
  es: { title: 'Confirmación de recompensa', body: 'Pulsa el control «Click to get the reward!» de Monetag en la ventana del anuncio. No pulses el anuncio ni su botón de descarga.' },
  pt: { title: 'Confirmação da recompensa', body: 'Pressione o controle «Click to get the reward!» da Monetag na janela do anúncio. Não clique no anúncio nem no botão de download.' },
  fr: { title: 'Confirmation de la récompense', body: 'Appuyez sur le contrôle «Click to get the reward!» de Monetag dans la fenêtre publicitaire. Ne cliquez pas sur l’annonce ni sur son bouton de téléchargement.' },
  de: { title: 'Prämie bestätigen', body: 'Tippe im Anzeigenfenster auf Monetags Schaltfläche „Click to get the reward!“. Klicke nicht auf die Anzeige oder den Download-Button.' },
  tr: { title: 'Ödül onayı', body: 'Reklam penceresindeki Monetag “Click to get the reward!” kontrolüne basın. Reklamın kendisine veya indirme düğmesine tıklamayın.' },
  zh: { title: '奖励确认步骤', body: '请在广告窗口中点击 Monetag 的“Click to get the reward!”控件。不要点击广告内容或下载按钮。' },
  hi: { title: 'इनाम की पुष्टि', body: 'विज्ञापन विंडो में Monetag के “Click to get the reward!” नियंत्रण को दबाएँ। विज्ञापन या डाउनलोड बटन पर क्लिक न करें।' },
  id: { title: 'Konfirmasi hadiah', body: 'Tekan kontrol “Click to get the reward!” milik Monetag di jendela iklan. Jangan klik iklan atau tombol unduh.' },
  bn: { title: 'পুরস্কার নিশ্চিতকরণ', body: 'বিজ্ঞাপনের উইন্ডোতে Monetag-এর “Click to get the reward!” বোতামটি চাপুন। বিজ্ঞাপন বা ডাউনলোড বোতামে ক্লিক করবেন না।' },
  ja: { title: '報酬の確認', body: '広告ウィンドウ内のMonetag「Click to get the reward!」操作ボタンを押してください。広告やダウンロードボタンはクリックしないでください。' },
  ko: { title: '보상 확인', body: '광고 창에서 Monetag의 “Click to get the reward!” 컨트롤을 누르세요. 광고나 다운로드 버튼은 클릭하지 마세요.' },
  ur: { title: 'انعام کی تصدیق', body: 'اشتہار کی ونڈو میں Monetag کے “Click to get the reward!” بٹن کو دبائیں۔ اشتہار یا ڈاؤن لوڈ بٹن پر کلک نہ کریں۔' },
};

declare global {
  interface WindowEventMap {
    'armco:monetag-ad-start': Event;
  }
}

export function MonetagAdNotice() {
  const lang = useGame((state) => state.lang);
  const copy = COPY[lang] ?? COPY.en;
  const [visible, setVisible] = useState(false);
  const [instance, setInstance] = useState(0);

  useEffect(() => {
    const show = () => {
      setInstance((value) => value + 1);
      setVisible(true);
      window.setTimeout(() => setVisible(false), 5000);
    };
    window.addEventListener('armco:monetag-ad-start', show);
    return () => window.removeEventListener('armco:monetag-ad-start', show);
  }, []);

  if (!visible) return null;

  return (
    <div key={instance} className="pointer-events-none fixed inset-x-3 z-[2147483647] mx-auto max-w-lg" style={{ top: 'max(env(safe-area-inset-top), 10px)' }} role="status" aria-live="polite">
      <div className="relative overflow-hidden rounded-xl border border-amber-300/80 bg-[#29251b]/[.97] px-4 py-3 text-amber-50 shadow-[0_8px_30px_rgba(0,0,0,.55)]">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1 text-right">
            <p className="text-sm font-black text-amber-200">{copy.title}</p>
            <p className="mt-1 text-xs font-semibold leading-5">{copy.body}</p>
          </div>
          <button type="button" aria-label="Close notice" className="pointer-events-auto rounded p-1 text-amber-100/80" onClick={() => setVisible(false)}><X size={15}/></button>
        </div>
        <div className="absolute bottom-0 left-0 h-1 w-full bg-amber-400/20">
          <div className="h-full origin-left animate-[monetag-notice-progress_5s_linear_forwards] bg-amber-400" />
        </div>
      </div>
      <style jsx>{`@keyframes monetag-notice-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }`}</style>
    </div>
  );
}
