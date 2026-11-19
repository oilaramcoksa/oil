'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, X, ArrowUpRight } from 'lucide-react';
import { useGame } from '@/lib/store';

type WaitingEntry = { telegramId: string; username: string };
type ArenaSnapshot = {
  round: { id: string; status: string; startsAt: number | null } | null;
  bets: WaitingEntry[];
  ownBet: WaitingEntry | null;
};

type Props = {
  initData: string;
  isVerified: boolean;
  telegramUserId: string;
  onGoToArena: () => void;
};

export function ArenaInviteNotice({ initData, isVerified, telegramUserId, onGoToArena }: Props) {
  const lang = useGame((s) => s.lang);
  const [invite, setInvite] = useState<{ roundId: string; username: string } | null>(null);
  const seenRoundRef = useRef<string | null>(null);
  const dismissedRoundRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isVerified || !initData || !telegramUserId) {
      setInvite(null);
      return;
    }

    let stopped = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch('/api/color-wheel?invite=1', {
          headers: { 'X-Telegram-Init-Data': initData },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json() as ArenaSnapshot;
        if (stopped) return;
        const waiting = data.round?.status === 'open' && data.round.startsAt !== null && !data.ownBet
          ? data.bets?.find((entry) => entry.telegramId !== telegramUserId)
          : undefined;

        if (!waiting || !data.round) {
          setInvite(null);
          return;
        }

        const roundId = data.round.id;
        if (seenRoundRef.current === roundId || dismissedRoundRef.current === roundId) return;
        seenRoundRef.current = roundId;
        setInvite({ roundId, username: waiting.username || 'Player' });
        expiryTimer = setTimeout(() => {
          setInvite((current) => current?.roundId === roundId ? null : current);
        }, 10_000);
      } catch {
        // A temporary network error should not interrupt the game UI.
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 4_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      if (expiryTimer) window.clearTimeout(expiryTimer);
    };
  }, [initData, isVerified, telegramUserId]);

  const close = () => {
    if (invite) dismissedRoundRef.current = invite.roundId;
    setInvite(null);
  };

  const copies: Record<typeof lang,{title:string;body:(name:string)=>string;action:string;close:string}> = {
    ar:{title:'لاعب ينتظرك في الألعاب!',body:(name)=>`${name} دخل عجلة الألوان وينتظر انضمامك إلى الجولة.`,action:'العب الآن',close:'إغلاق الإشعار'},
    en:{title:'A player is waiting in Games!',body:(name)=>`${name} placed a color-wheel bet and is waiting for you to join.`,action:'Play now',close:'Close notification'},
    ru:{title:'Игрок ждёт тебя в играх!',body:(name)=>`${name} сделал ставку в цветном колесе и ждёт тебя.`,action:'Играть сейчас',close:'Закрыть уведомление'},
    es:{title:'¡Un jugador te espera en Juegos!',body:(name)=>`${name} apostó en la ruleta de colores y espera que te unas.`,action:'Jugar ahora',close:'Cerrar notificación'},
    pt:{title:'Um jogador espera por você em Jogos!',body:(name)=>`${name} apostou na roleta de cores e está esperando você entrar.`,action:'Jogar agora',close:'Fechar notificação'},
    fr:{title:'Un joueur vous attend dans Jeux !',body:(name)=>`${name} a parié sur la roue des couleurs et attend votre arrivée.`,action:'Jouer maintenant',close:'Fermer la notification'},
    de:{title:'Ein Spieler wartet in Spiele auf dich!',body:(name)=>`${name} hat beim Farbrad gesetzt und wartet auf deinen Beitritt.`,action:'Jetzt spielen',close:'Benachrichtigung schließen'},
    tr:{title:'Oyunlar’da bir oyuncu seni bekliyor!',body:(name)=>`${name} renk çarkına bahis yaptı ve katılmanı bekliyor.`,action:'Şimdi oyna',close:'Bildirimi kapat'},
    zh:{title:'有玩家正在游戏中等你！',body:(name)=>`${name} 已在颜色转盘下注，正等你加入这一轮。`,action:'立即游戏',close:'关闭通知'},
    hi:{title:'गेम्स में एक खिलाड़ी आपका इंतज़ार कर रहा है!',body:(name)=>`${name} ने रंगीन व्हील पर दांव लगाया है और आपके जुड़ने की प्रतीक्षा कर रहा है।`,action:'अभी खेलें',close:'सूचना बंद करें'},
    id:{title:'Seorang pemain menunggumu di Permainan!',body:(name)=>`${name} memasang taruhan di Roda Warna dan menunggumu bergabung.`,action:'Main sekarang',close:'Tutup notifikasi'},
    bn:{title:'গেমসে একজন খেলোয়াড় আপনার জন্য অপেক্ষা করছে!',body:(name)=>`${name} রঙের চাকায় বাজি ধরেছে এবং আপনার যোগ দেওয়ার অপেক্ষায় আছে।`,action:'এখনই খেলুন',close:'বিজ্ঞপ্তি বন্ধ করুন'},
    ja:{title:'ゲームでプレイヤーが待っています！',body:(name)=>`${name} がカラーホイールにベットし、あなたの参加を待っています。`,action:'今すぐプレイ',close:'通知を閉じる'},
    ko:{title:'게임에서 플레이어가 기다리고 있어요!',body:(name)=>`${name}님이 컬러 휠에 베팅하고 참여를 기다리고 있습니다.`,action:'지금 플레이',close:'알림 닫기'},
    ur:{title:'کھیلوں میں ایک کھلاڑی آپ کا منتظر ہے!',body:(name)=>`${name} نے رنگوں کے پہیے پر شرط لگائی ہے اور آپ کے شامل ہونے کا انتظار کر رہا ہے۔`,action:'ابھی کھیلیں',close:'اطلاع بند کریں'},
  };
  const copy = copies[lang] ?? copies.en;

  return (
    <AnimatePresence>
      {invite && (
        <motion.aside
          key={invite.roundId}
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -18, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          role="status"
          aria-live="polite"
          className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[120] mx-auto max-w-md overflow-hidden rounded-2xl border border-amber-300/70 bg-gradient-to-br from-[#fff8e8] via-[#ffedc5] to-[#f8d79a] p-3 text-[#542b12] shadow-[0_16px_48px_rgba(35,20,5,.32)]"
          dir={lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr'}
        >
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg shadow-orange-900/20">
              <Gamepad2 size={22} strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black tracking-tight">{copy.title}</div>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-[#80502a]">{copy.body(invite.username)}</p>
              <button
                type="button"
                onClick={() => { setInvite(null); onGoToArena(); }}
                className="mt-2.5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#9a4d13] to-[#d97706] px-3.5 py-2 text-xs font-black text-white shadow-md shadow-orange-900/20 transition hover:brightness-110 active:scale-[.98]"
              >
                {copy.action}
                <ArrowUpRight size={15} />
              </button>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={copy.close}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/5 text-[#80502a] transition hover:bg-black/10"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-amber-900/10">
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 10, ease: 'linear' }}
              style={{ transformOrigin: lang === 'ar' || lang === 'ur' ? 'right' : 'left' }}
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600"
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
