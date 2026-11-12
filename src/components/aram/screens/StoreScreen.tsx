'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '@/lib/store';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Store, Zap, Check, Copy, ChevronLeft, Loader2, Sparkles, Coins, Droplet, Clock } from 'lucide-react';
import { PACKAGES, WALLETS, packageTotal, type UpgradePackage, type CryptoWallet } from '@/lib/wallets';
import { CryptoIcon } from '@/components/aram/CryptoIcon';
import { useTelegram } from '@/hooks/use-telegram';
import { toast } from 'sonner';

export function StoreScreen() {
  const lang = useGame((s) => s.lang);
  const upgrades = useGame((s) => s.upgrades);
  const { haptic, notify } = useTelegram();

  const [selected, setSelected] = useState<UpgradePackage | null>(null);
  const [selectedPart, setSelectedPart] = useState<{ id: 'oil_pump' | 'fuel_station' | 'oil_truck'; name: string; price: number; multiplier: string; icon: string; description: string } | null>(null);
  const [partVerifying, setPartVerifying] = useState(false);
  const [partFailed, setPartFailed] = useState(false);
  const [wallet, setWallet] = useState<CryptoWallet | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const openPackage = (p: UpgradePackage) => {
    haptic('medium');
    setSelected(p);
    setWallet(null);
    setVerifying(false);
    setPaymentFailed(false);
  };

  const closePackage = () => {
    if (verifying) return;
    haptic('light');
    setSelected(null);
    setWallet(null);
    setPaymentFailed(false);
  };

  const selectWallet = (w: CryptoWallet) => {
    haptic('light');
    setWallet(w);
  };

  const copyAddr = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopiedAddr(true);
      haptic('medium');
      toast.success(t(lang, 'addressCopied'));
      setTimeout(() => setCopiedAddr(false), 2000);
    } catch {
      toast.error('Copy failed');
    }
  };

  const confirmPaid = async () => {
    if (!selected || !wallet || verifying) return;
    const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData ?? '' : '';
    if (!initData) {
      toast.error('يجب فتح التطبيق من خلال بوت تيليجرام');
      return;
    }
    setVerifying(true);
    setPaymentFailed(false);
    haptic('heavy');
    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ packageId: selected.id, walletCode: wallet.code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.payment?.id) throw new Error(data.error ?? 'payment_request_failed');
      const paymentId = String(data.payment.id);
      const startedAt = Date.now();

      const checkStatus = async (): Promise<void> => {
        try {
          const statusResponse = await fetch('/api/payments?id=' + encodeURIComponent(paymentId), {
            headers: { 'X-Telegram-Init-Data': initData },
            cache: 'no-store',
          });
          const statusData = await statusResponse.json().catch(() => ({}));
          if (!statusResponse.ok) throw new Error(statusData.error ?? 'payment_status_unavailable');
          if (statusData.payment?.status === 'confirmed') {
            // Only a server-confirmed payment may activate an upgrade.
            toast.success('تم تأكيد الدفع من الخادم');
            setVerifying(false);
            return;
          }
          if (statusData.payment?.status === 'expired' || statusData.payment?.status === 'rejected') {
            setVerifying(false);
            setPaymentFailed(true);
            notify('error');
            toast.error('فشل الدفع: لم يتم التحقق من وصول المبلغ خلال ساعة');
            return;
          }
          if (Date.now() - startedAt >= 60 * 60 * 1000 + 5000) {
            setVerifying(false);
            setPaymentFailed(true);
            toast.error('انتهت مهلة التحقق. لم يتم تفعيل الترقية');
            return;
          }
          window.setTimeout(() => { void checkStatus(); }, 15000);
        } catch {
          if (Date.now() - startedAt >= 60 * 60 * 1000 + 5000) {
            setVerifying(false);
            setPaymentFailed(true);
            toast.error('تعذر التحقق من الدفع. لم يتم تفعيل الترقية');
          } else {
            window.setTimeout(() => { void checkStatus(); }, 15000);
          }
        }
      };
      toast.info('تم تسجيل طلب التحقق. سيظل الدفع قيد المراجعة لمدة ساعة');
      void checkStatus();
    } catch (error) {
      setVerifying(false);
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل طلب الدفع');
    }
  };

  const shopParts = [
    { id: 'oil_pump' as const, name: 'مضخة البترول', price: 0.5, multiplier: '×3', image: '/images/shop/oil-pump.png', description: 'تضاعف سرعة الإنتاج ثلاث مرات' },
    { id: 'fuel_station' as const, name: 'محطة الوقود', price: 0.3, multiplier: '×2', image: '/images/shop/fuel-station.png', description: 'تضاعف سرعة الإنتاج مرتين' },
    { id: 'oil_truck' as const, name: 'شاحنة نقل البترول', price: 0.1, multiplier: '×1.5', image: '/images/shop/oil-truck.png', description: 'ترفع سرعة الإنتاج إلى مرة ونصف' },
  ];

  const buyPart = async () => {
    if (!selectedPart || partVerifying) return;
    const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData ?? '' : '';
    if (!initData) { toast.error('يجب فتح التطبيق من خلال بوت تيليجرام'); return; }
    setPartVerifying(true);
    setPartFailed(false);
    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ itemId: selectedPart.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.payment?.id) throw new Error(data.error ?? 'تعذر إنشاء طلب الدفع');
      await navigator.clipboard?.writeText(data.payment.destination).catch(() => undefined);
      toast.info('تم تسجيل طلبك. أرسل المبلغ المحدد إلى عنوان TON الظاهر، وسيستمر التحقق لمدة ساعة');
      const paymentId = String(data.payment.id);
      const startedAt = Date.now();
      const poll = async (): Promise<void> => {
        try {
          const res = await fetch('/api/payments?id=' + encodeURIComponent(paymentId), {
            headers: { 'X-Telegram-Init-Data': initData }, cache: 'no-store',
          });
          const status = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error('status_unavailable');
          if (status.payment?.status === 'confirmed') {
            setPartVerifying(false);
            toast.success('تم تأكيد الدفع');
            return;
          }
          if (status.payment?.status === 'expired' || status.payment?.status === 'rejected' || Date.now() - startedAt >= 3605000) {
            setPartVerifying(false); setPartFailed(true); notify('error');
            toast.error('فشل الدفع: لم يتم التحقق من وصول التحويل خلال ساعة');
            return;
          }
          window.setTimeout(() => { void poll(); }, 15000);
        } catch {
          if (Date.now() - startedAt >= 3605000) {
            setPartVerifying(false); setPartFailed(true);
            toast.error('انتهت مهلة التحقق دون تأكيد الدفع');
          } else window.setTimeout(() => { void poll(); }, 15000);
        }
      };
      void poll();
    } catch (e) {
      setPartVerifying(false);
      toast.error(e instanceof Error ? e.message : 'تعذر بدء التحقق');
    }
  };

  return (
    <div className="max-w-md mx-auto w-full px-3 pt-2 pb-6 aram-scroll" style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
      {/* Title */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg">
          <Store className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-black text-[#2a1c0a]">{t(lang, 'storeTitle')}</h2>
          <p className="text-[11px] text-amber-900/60 font-bold">{t(lang, 'upgradePackages')}</p>
        </div>
      </div>

      {/* Disclaimer banner */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="aram-card rounded-2xl p-3 mb-3 border-amber-300"
      >
        <p className="text-[11px] text-amber-900/80 font-bold leading-relaxed">
          ⓘ {t(lang, 'aboutText').split('.').slice(0, 2).join('.')}
        </p>
      </motion.div>

      {/* Speed parts shop */}
      <div className="mb-3">
        <h3 className="text-sm font-black text-[#2a1c0a] mb-2">قطع زيادة السرعة</h3>
        <div className="grid grid-cols-3 gap-2">
          {shopParts.map((part) => (
            <motion.button key={part.id} whileTap={{ scale: 0.97 }} onClick={() => { setSelectedPart(part); setPartFailed(false); setPartVerifying(false); }}
              className="aram-card rounded-2xl p-2 text-center border border-amber-300">
              <div className="h-20 flex items-center justify-center mb-1"><img src={part.image} alt={part.name} className="max-h-20 max-w-full object-contain" /></div>
              <div className="text-[11px] font-black text-[#2a1c0a] leading-tight">{part.name}</div>
              <div className="text-lg font-black text-emerald-700 my-1">{part.multiplier}</div>
              <div className="text-[11px] font-bold text-amber-900">{part.price} TON</div>
              <div className="text-[9px] text-amber-900/60 mt-1">شراء القطعة</div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Package cards */}
      <div className="space-y-2 mb-3">
        {PACKAGES.map((p, i) => {
          const total = packageTotal(p);
          const owned = upgrades.filter((u) => u.packageId === p.id).length;
          return (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => openPackage(p)}
              className="aram-card rounded-2xl p-3 w-full text-left hover:scale-[1.01] transition-transform"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center text-white shadow-lg`}>
                    <Zap className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-[#2a1c0a]">
                      {t(lang, 'speedPackage')} {p.id.replace('_', ' ').toUpperCase()}
                    </div>
                    <div className="text-[11px] text-amber-900/60 font-bold">
                      ${p.priceUSD} · {p.bonusPct > 0 ? `+${p.bonusPct}% ${t(lang, 'bonus')}` : t(lang, 'basePower')}
                    </div>
                  </div>
                </div>
                {p.badge && (
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${
                    p.badge === 'best' ? 'bg-fuchsia-500/15 text-fuchsia-700' : 'bg-amber-500/15 text-amber-700'
                  }`}>
                    {p.badge === 'best' ? '★ BEST' : '★ POPULAR'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-amber-50 py-1">
                  <div className="text-[9px] text-amber-900/60 font-bold uppercase">{t(lang, 'basePower')}</div>
                  <div className="text-xs font-black text-[#2a1c0a] tabular-nums">{p.speedBase.toLocaleString()}</div>
                </div>
                <div className="rounded-lg bg-amber-50 py-1">
                  <div className="text-[9px] text-amber-900/60 font-bold uppercase">+{p.bonusPct}%</div>
                  <div className="text-xs font-black text-emerald-600 tabular-nums">
                    +{Math.round(p.speedBase * p.bonusPct / 100).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg bg-amber-900/10 py-1">
                  <div className="text-[9px] text-amber-900/60 font-bold uppercase">{t(lang, 'total')}</div>
                  <div className="text-xs font-black text-purple-600 tabular-nums">{total.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[10px] text-amber-900/70 font-bold">
                  <span className="flex items-center gap-0.5"><Droplet className="w-3 h-3" /> +{p.oilPerTap}/{t(lang, 'oilPerTap')}</span>
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> +{p.perHour} {t(lang, 'coinsPerHour')}</span>
                </div>
                <span className="text-[10px] text-amber-900/50 font-bold">
                  {owned > 0 ? `×${owned} ${t(lang, 'active')}` : ''}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Active upgrades summary */}
      <div className="aram-card rounded-2xl p-3">
        <h3 className="text-sm font-black text-[#2a1c0a] mb-2 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-500" /> {t(lang, 'activeUpgrades')}
        </h3>
        {upgrades.length === 0 ? (
          <p className="text-amber-900/50 text-xs font-bold text-center py-3">{t(lang, 'noUpgrades')}</p>
        ) : (
          <div className="space-y-1">
            {upgrades.map((u, i) => {
              const pkg = PACKAGES.find((p) => p.id === u.packageId);
              if (!pkg) return null;
              const w = WALLETS.find((x) => x.code === u.paidWith);
              const now = Date.now();
              const expired = u.expiresAt <= now;
              const msLeft = Math.max(0, u.expiresAt - now);
              const daysLeft = Math.floor(msLeft / 86400000);
              const hoursLeft = Math.floor((msLeft % 86400000) / 3600000);
              const minsLeft = Math.floor((msLeft % 3600000) / 60000);
              const expiresLabel = expired
                ? t(lang, 'expired')
                : `${daysLeft}${t(lang, 'days')} ${hoursLeft}${t(lang, 'hours')} ${minsLeft}${t(lang, 'minutes')}`;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                    expired ? 'bg-red-50/60 opacity-60' : 'bg-amber-50/50'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${pkg.color} flex items-center justify-center text-white ${expired ? 'grayscale' : ''}`}>
                    <Zap className="w-3 h-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#2a1c0a]">{pkg.id.replace('_', ' ').toUpperCase()} · ${pkg.priceUSD}</div>
                    <div className="flex items-center gap-1 text-[10px] text-amber-900/50 truncate">
                      {w && <CryptoIcon code={w.code} className="w-3 h-3 flex-shrink-0" />}
                      <span className="truncate">{w?.label} · {u.txHash.slice(0, 10)}...</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {expired ? (
                      <span className="text-[10px] text-red-600 font-bold">{t(lang, 'expired')}</span>
                    ) : (
                      <>
                        <div className="text-[9px] text-amber-900/60 font-bold uppercase">{t(lang, 'upgradeExpiresIn')}</div>
                        <div className="text-[10px] font-black text-amber-700 tabular-nums">{expiresLabel}</div>
                      </>
                    )}
                  </div>
                  {!expired && <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedPart && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
            onClick={() => { if (!partVerifying) setSelectedPart(null); }}>
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-gradient-to-b from-[#2a1c0a] to-[#0c0703] p-5 text-center">
              <div className="h-36 flex items-center justify-center mb-2"><img src={selectedPart.image} alt={selectedPart.name} className="max-h-36 max-w-full object-contain" /></div>
              <h3 className="text-amber-100 font-black text-lg">{selectedPart.name}</h3>
              <div className="text-3xl font-black text-emerald-300 my-2">{selectedPart.multiplier}</div>
              <p className="text-amber-200/70 text-xs mb-3">{selectedPart.description}</p>
              <div className="rounded-xl bg-black/30 p-3 text-left mb-3">
                <div className="text-amber-200/60 text-[10px] mb-1">أرسل المبلغ إلى محفظة TON الحالية</div>
                <div className="text-amber-100 text-xs break-all font-mono">{WALLETS.find((w) => w.code === 'gram')?.address}</div>
                <div className="text-emerald-300 font-black text-xl mt-2">{selectedPart.price} TON</div>
              </div>
              {partVerifying ? (
                <div className="text-amber-100 text-sm font-bold py-3"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />جاري التحقق من الدفع لمدة تصل إلى ساعة...</div>
              ) : (
                <Button disabled={partFailed} onClick={buyPart} className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black">
                  {partFailed ? 'فشل الدفع - لم يتم تفعيل القطعة' : 'تأكيد الدفع'}
                </Button>
              )}
              <button disabled={partVerifying} onClick={() => setSelectedPart(null)} className="text-amber-200/60 text-xs mt-3 disabled:opacity-30">إغلاق</button>
              <p className="text-[9px] text-amber-200/40 mt-2">لن تُضاف القطعة إلى حسابك إلا بعد تأكيد التحويل من الخادم.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Purchase modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
            onClick={closePackage}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 220 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md bg-gradient-to-b from-[#2a1c0a] to-[#0c0703] rounded-t-3xl sm:rounded-3xl overflow-hidden aram-safe-bottom max-h-[92vh] overflow-y-auto aram-scroll"
            >
              {/* Header */}
              <div className="sticky top-0 z-10 bg-[#2a1c0a]/95 backdrop-blur-md border-b border-amber-500/20 px-4 py-3 flex items-center justify-between">
                <button onClick={closePackage} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
                  <ChevronLeft className="w-4 h-4" style={{ transform: lang === 'ar' ? 'scaleX(-1)' : 'none' }} />
                </button>
                <h3 className="text-amber-100 font-black text-sm">
                  {t(lang, 'speedPackage')} {selected.id.replace('_', ' ').toUpperCase()}
                </h3>
                <div className="w-8" />
              </div>

              <div className="p-4 space-y-3">
                {/* Package summary */}
                <div className="aram-card-dark rounded-2xl p-4">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${selected.color} flex items-center justify-center text-white shadow-xl mb-3`}>
                    <Zap className="w-8 h-8" />
                  </div>
                  <div className="space-y-1.5">
                    <Row label={t(lang, 'basePower')} value={selected.speedBase.toLocaleString()} />
                    <Row label={`${t(lang, 'bonus')} (+${selected.bonusPct}%)`} value={`+${Math.round(selected.speedBase * selected.bonusPct / 100).toLocaleString()}`} valueClass="text-emerald-300" />
                    <div className="border-t border-amber-500/20 pt-1.5 mt-1.5">
                      <Row label={t(lang, 'total')} value={packageTotal(selected).toLocaleString()} labelClass="text-amber-100" valueClass="text-amber-300 font-black text-lg" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="rounded-lg bg-amber-500/10 p-2 text-center">
                        <Droplet className="w-3 h-3 text-amber-400 mx-auto mb-0.5" />
                        <div className="text-[9px] text-amber-200/60 font-bold uppercase">{t(lang, 'oilPerTap')}</div>
                        <div className="text-xs font-black text-amber-300">+{selected.oilPerTap}</div>
                      </div>
                      <div className="rounded-lg bg-amber-500/10 p-2 text-center">
                        <Clock className="w-3 h-3 text-amber-400 mx-auto mb-0.5" />
                        <div className="text-[9px] text-amber-200/60 font-bold uppercase">{t(lang, 'coinsPerHour')}</div>
                        <div className="text-xs font-black text-amber-300">+{selected.perHour}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payment currency picker */}
                {!wallet ? (
                  <div>
                    <h4 className="text-amber-100 font-bold text-xs mb-2 uppercase">{t(lang, 'selectCurrency')}</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {WALLETS.map((w) => (
                        <button
                          key={w.code}
                          onClick={() => selectWallet(w)}
                          className="aram-card-dark rounded-xl p-3 hover:border-amber-400 transition-colors text-left"
                        >
                          <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center mb-1.5 overflow-hidden ring-1 ring-white/10">
                            <CryptoIcon code={w.code} className="w-8 h-8" />
                          </div>
                          <div className="text-amber-100 font-black text-sm">{w.label}</div>
                          <div className="text-[10px] text-amber-200/50 font-bold">{w.network}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="aram-card-dark rounded-2xl p-3"
                  >
                    {/* Selected wallet */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center ring-1 ring-white/10 overflow-hidden">
                        <CryptoIcon code={wallet.code} className="w-7 h-7" />
                      </div>
                      <div className="flex-1">
                        <div className="text-amber-100 font-black text-sm">{wallet.label}</div>
                        <div className="text-[10px] text-amber-200/60 font-bold">{wallet.network}</div>
                      </div>
                      <button
                        onClick={() => setWallet(null)}
                        className="text-[10px] text-amber-200/70 font-bold underline"
                      >
                        {t(lang, 'cancel')}
                      </button>
                    </div>

                    {/* Address */}
                    <div className="text-amber-200/70 text-[10px] font-bold mb-1">{t(lang, 'payToAddress')}</div>
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/40 border border-amber-500/20 mb-2">
                      <span className="text-[10px] text-amber-100 font-mono truncate flex-1 break-all">{wallet.address}</span>
                      <button onClick={copyAddr} className="flex-shrink-0 w-7 h-7 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 flex items-center justify-center text-amber-300">
                        {copiedAddr ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Amount */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-[10px] text-amber-200/60 font-bold uppercase">USD</span>
                      <span className="text-amber-300 font-black tabular-nums">${selected.priceUSD}</span>
                    </div>

                    {/* Note */}
                    <div className="px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-2">
                      <p className="text-[10px] text-amber-200/80 font-bold leading-relaxed">
                        ⓘ {t(lang, 'paymentNote')}
                      </p>
                    </div>

                    {/* Confirm */}
                    <Button
                      onClick={confirmPaid}
                      disabled={verifying || paymentFailed}
                      className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-sm disabled:opacity-50"
                    >
                      {verifying ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          جاري التحقق من الدفع...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {paymentFailed ? 'انتهت مهلة الدفع - لم يتم التفعيل' : `${t(lang, 'iPaid')} ${selected.priceUSD}`}
                        </>
                      )}
                    </Button>
                  </motion.div>
                )}

                {/* Tiny reminder */}
                <p className="text-[9px] text-amber-200/40 font-bold text-center leading-relaxed">
                  ⚠ {t(lang, 'disclaimerBody')}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value, labelClass = 'text-amber-200/70', valueClass = 'text-amber-100' }: { label: string; value: string; labelClass?: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[11px] font-bold ${labelClass}`}>{label}</span>
      <span className={`text-sm font-black tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
