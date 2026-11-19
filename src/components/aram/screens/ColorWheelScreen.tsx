'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Loader2, History, Timer, Trophy, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useGame } from '@/lib/store';
import { dirOf, type Lang } from '@/lib/i18n';

type Color = 'yellow' | 'purple' | 'turquoise';
type Bet = { telegramId: string; username: string; photoUrl: string | null; color: Color; amount: number; payout: number; outcome: string };
type Winner = { telegramId: string; username: string; photoUrl: string | null; payout: number; color: Color; roundId: string };
type RoundHistory = { id: string; color: Color; sector: number; betsCount: number; total: number; completedAt: string };
type LastRoundResults = { id: string; winningColor: Color; completedAt: string; bets: Bet[] } | null;
type WheelState = { round: { id: string; status: 'open' | 'spinning' | 'completed'; startsAt: number | null; spinStartedAt: number | null; winningSector: number | null; winningColor: Color | null }; balance: number; bets: Bet[]; ownBet: Bet | null; winners: Winner[]; history: RoundHistory[]; lastRoundResults?: LastRoundResults; betBalance: number; serverNow: number };

const COLORS: Color[] = ['yellow','purple','yellow','purple','yellow','purple','yellow','turquoise','purple','yellow','purple','yellow','purple','yellow','purple'];
const META: Record<Color,{multiplier:string;className:string;hex:string}> = {
 yellow:{multiplier:'×1.95',className:'border-yellow-300/60 bg-yellow-400/10 text-yellow-200',hex:'#f5cf55'},
 purple:{multiplier:'×1.95',className:'border-violet-300/50 bg-violet-400/10 text-violet-200',hex:'#a98add'},
 turquoise:{multiplier:'×9.5',className:'border-teal-300/60 bg-teal-400/10 text-teal-200',hex:'#65c8b9'},
};
const COPY: Record<Lang,string[]> = {
 ar:['أصفر','بنفسجي','فيروزي نادر','آخر فائزين','بانتظار فائز','فاز بالجولة','عجلة الألوان','','تدور الآن','بانتظار أول رهان','العد التنازلي','تحديد اللون الفائز...','ضع أول رهان وشارك في الجولة','تُغلق الرهانات عند انتهاء العداد','نتائج الجولات السابقة','ستظهر النتائج بعد اكتمال أول جولة','رصيدك','الحد الأدنى للرهان 100','تم تسجيل رهانك','رصيدك غير كافٍ','لقد راهنت في هذه الجولة بالفعل','انتهى وقت الرهان','تعذر تسجيل الرهان','رهانك','الجولة تدور','تم تسجيل الرهان','فرصة نادرة','معامل الربح','رهان واحد لكل لاعب في الجولة · الحد الأدنى 100 عملة','عملة'],
 en:['Yellow','Purple','Rare turquoise','Latest winners','Waiting for a winner','Won this round','Color Wheel','','Spinning','Waiting for the first bet','Countdown','Picking the winning color...','Place the first bet to join the round','Bets close when the timer ends','Previous results','Results appear after the first round','Your balance','Minimum bet is 100','Your bet is placed','Insufficient balance','You already bet in this round','Betting is closed','Could not place your bet','Your bet','Round is spinning','Bet registered','Rare chance','Payout multiplier','One bet per player per round · Minimum 100 coins','coins'],
 ru:['Жёлтый','Фиолетовый','Редкий бирюзовый','Последние победители','Ожидание победителя','Победитель раунда','Цветное колесо','','Вращается','Ожидание первой ставки','Обратный отсчёт','Определяем победный цвет...','Сделайте первую ставку, чтобы начать раунд','Ставки закроются по окончании таймера','Предыдущие результаты','Результаты появятся после первого раунда','Ваш баланс','Минимальная ставка — 100','Ставка принята','Недостаточно средств','Вы уже сделали ставку в этом раунде','Приём ставок закрыт','Не удалось сделать ставку','Ваша ставка','Раунд вращается','Ставка зарегистрирована','Редкий шанс','Множитель выплаты','Одна ставка на игрока за раунд · минимум 100 монет','монет'],
 es:['Amarillo','Morado','Turquesa raro','Últimos ganadores','Esperando ganador','Ganó esta ronda','Ruleta de colores','','Girando','Esperando la primera apuesta','Cuenta atrás','Eligiendo el color ganador...','Haz la primera apuesta para unirte a la ronda','Las apuestas se cierran al terminar el contador','Resultados anteriores','Los resultados aparecerán tras la primera ronda','Tu saldo','La apuesta mínima es 100','Apuesta registrada','Saldo insuficiente','Ya apostaste en esta ronda','Las apuestas están cerradas','No se pudo registrar la apuesta','Tu apuesta','La ronda está girando','Apuesta registrada','Oportunidad rara','Multiplicador de premio','Una apuesta por jugador y ronda · Mínimo 100 monedas','monedas'],
 pt:['Amarelo','Roxo','Turquesa raro','Últimos vencedores','Aguardando vencedor','Venceu esta rodada','Roleta de cores','','Girando','Aguardando a primeira aposta','Contagem regressiva','Definindo a cor vencedora...','Faça a primeira aposta para entrar na rodada','As apostas fecham quando o tempo acabar','Resultados anteriores','Os resultados aparecem após a primeira rodada','Seu saldo','A aposta mínima é 100','Aposta registrada','Saldo insuficiente','Você já apostou nesta rodada','As apostas estão encerradas','Não foi possível registrar a aposta','Sua aposta','A rodada está girando','Aposta registrada','Chance rara','Multiplicador de prêmio','Uma aposta por jogador por rodada · Mínimo 100 moedas','moedas'],
 fr:['Jaune','Violet','Turquoise rare','Derniers gagnants','En attente du gagnant','A remporté la manche','Roue des couleurs','','En rotation','En attente du premier pari','Compte à rebours','Sélection de la couleur gagnante...','Placez le premier pari pour rejoindre la manche','Les paris ferment à la fin du compte à rebours','Résultats précédents','Les résultats apparaîtront après la première manche','Votre solde','Mise minimale : 100','Pari enregistré','Solde insuffisant','Vous avez déjà parié dans cette manche','Les paris sont fermés','Impossible d’enregistrer le pari','Votre pari','La manche tourne','Pari enregistré','Chance rare','Multiplicateur de gain','Un pari par joueur et par manche · Minimum 100 pièces','pièces'],
 de:['Gelb','Lila','Seltenes Türkis','Letzte Gewinner','Warte auf Gewinner','Runde gewonnen','Farbrad','','Dreht sich','Warte auf den ersten Einsatz','Countdown','Gewinnfarbe wird ermittelt...','Setze den ersten Einsatz, um der Runde beizutreten','Einsätze schließen nach Ablauf des Countdowns','Vorherige Ergebnisse','Ergebnisse erscheinen nach der ersten Runde','Dein Guthaben','Mindesteinsatz: 100','Einsatz platziert','Guthaben nicht ausreichend','Du hast in dieser Runde bereits gesetzt','Einsatzzeit ist abgelaufen','Einsatz konnte nicht platziert werden','Dein Einsatz','Runde dreht sich','Einsatz registriert','Seltene Chance','Auszahlungsfaktor','Ein Einsatz pro Spieler und Runde · Minimum 100 Münzen','Münzen'],
 tr:['Sarı','Mor','Nadir turkuaz','Son kazananlar','Kazanan bekleniyor','Bu turun kazananı','Renk Çarkı','','Dönüyor','İlk bahis bekleniyor','Geri sayım','Kazanan renk belirleniyor...','Tura katılmak için ilk bahsi yap','Süre bitince bahisler kapanır','Önceki sonuçlar','İlk turdan sonra sonuçlar burada görünür','Bakiyen','Minimum bahis 100','Bahsin alındı','Yetersiz bakiye','Bu turda zaten bahis yaptın','Bahis süresi kapandı','Bahis yapılamadı','Bahsin','Tur dönüyor','Bahis kaydedildi','Nadir fırsat','Kazanç çarpanı','Tur başına oyuncu başına bir bahis · Minimum 100 jeton','jeton'],
 zh:['黄色','紫色','稀有青绿色','最近获胜者','等待获胜者','赢得本轮','颜色转盘','','旋转中','等待首次下注','倒计时','正在确定获胜颜色...','下注即可加入本轮','倒计时结束后停止下注','往期结果','首轮结束后显示结果','你的余额','最低下注为 100','下注成功','余额不足','你已在本轮下注','下注已结束','下注失败','你的下注','本轮正在旋转','下注已记录','稀有机会','奖金倍率','每位玩家每轮限下注一次 · 最低 100 金币','金币'],
 hi:['पीला','बैंगनी','दुर्लभ फ़िरोज़ी','हाल के विजेता','विजेता की प्रतीक्षा','यह राउंड जीता','रंगीन व्हील','','घूम रहा है','पहली बाज़ी की प्रतीक्षा','उलटी गिनती','विजेता रंग चुना जा रहा है...','राउंड में शामिल होने के लिए पहली बाज़ी लगाएँ','समय समाप्त होने पर बाज़ी बंद होगी','पिछले परिणाम','पहले राउंड के बाद परिणाम दिखेंगे','आपका बैलेंस','न्यूनतम बाज़ी 100 है','बाज़ी दर्ज हुई','अपर्याप्त बैलेंस','आप इस राउंड में पहले ही बाज़ी लगा चुके हैं','बाज़ी बंद है','बाज़ी दर्ज नहीं हो सकी','आपकी बाज़ी','राउंड घूम रहा है','बाज़ी दर्ज हुई','दुर्लभ मौका','इनाम गुणक','प्रति खिलाड़ी प्रति राउंड एक बाज़ी · न्यूनतम 100 सिक्के','सिक्के'],
 id:['Kuning','Ungu','Pirus langka','Pemenang terbaru','Menunggu pemenang','Memenangkan ronde','Roda Warna','','Berputar','Menunggu taruhan pertama','Hitung mundur','Menentukan warna pemenang...','Pasang taruhan pertama untuk bergabung','Taruhan ditutup saat waktu habis','Hasil sebelumnya','Hasil muncul setelah ronde pertama','Saldo Anda','Taruhan minimum 100','Taruhan berhasil dipasang','Saldo tidak cukup','Anda sudah bertaruh di ronde ini','Taruhan ditutup','Taruhan gagal dipasang','Taruhan Anda','Ronde sedang berputar','Taruhan tercatat','Peluang langka','Pengali hadiah','Satu taruhan per pemain per ronde · Minimum 100 koin','koin'],
 bn:['হলুদ','বেগুনি','বিরল ফিরোজা','সর্বশেষ বিজয়ীরা','বিজয়ীর অপেক্ষায়','এই রাউন্ডে জিতেছে','রঙের চাকা','','ঘুরছে','প্রথম বাজির অপেক্ষায়','কাউন্টডাউন','জয়ী রং নির্ধারণ হচ্ছে...','রাউন্ডে যোগ দিতে প্রথম বাজি ধরুন','সময় শেষ হলে বাজি বন্ধ হবে','আগের ফলাফল','প্রথম রাউন্ডের পর ফলাফল দেখা যাবে','আপনার ব্যালেন্স','সর্বনিম্ন বাজি ১০০','বাজি জমা হয়েছে','পর্যাপ্ত ব্যালেন্স নেই','এই রাউন্ডে আপনি ইতিমধ্যে বাজি ধরেছেন','বাজি বন্ধ','বাজি জমা করা যায়নি','আপনার বাজি','রাউন্ড ঘুরছে','বাজি নথিভুক্ত হয়েছে','বিরল সুযোগ','জয়ের গুণক','প্রতি রাউন্ডে প্রতি খেলোয়াড়ের একটি বাজি · সর্বনিম্ন ১০০ কয়েন','কয়েন'],
 ja:['黄色','紫','レアなターコイズ','最近の勝者','勝者を待っています','このラウンドの勝者','カラーホイール','','回転中','最初のベット待ち','カウントダウン','当選色を決定中...','最初のベットでラウンドに参加','タイマー終了でベット受付終了','過去の結果','最初のラウンド後に結果が表示されます','残高','最低ベットは100','ベットを受け付けました','残高不足','このラウンドでは既にベット済みです','ベット受付終了','ベットできませんでした','あなたのベット','ラウンド回転中','ベット登録済み','レアチャンス','配当倍率','1ラウンドにつき1人1回 · 最低100コイン','コイン'],
 ko:['노랑','보라','희귀 청록색','최근 우승자','우승자 대기 중','이번 라운드 승리','컬러 휠','','회전 중','첫 베팅 대기 중','카운트다운','당첨 색상을 결정 중...','첫 베팅으로 라운드에 참여하세요','타이머가 끝나면 베팅이 마감됩니다','이전 결과','첫 라운드가 끝나면 결과가 표시됩니다','내 잔액','최소 베팅은 100입니다','베팅이 등록되었습니다','잔액이 부족합니다','이번 라운드에 이미 베팅했습니다','베팅이 마감되었습니다','베팅에 실패했습니다','내 베팅','라운드 회전 중','베팅 등록 완료','희귀 기회','지급 배율','라운드당 플레이어 한 번 베팅 · 최소 100코인','코인'],
 ur:['پیلا','جامنی','نایاب فیروزی','آخری فاتحین','فاتح کا انتظار','اس راؤنڈ کے فاتح','رنگوں کا پہیہ','','گھوم رہا ہے','پہلی شرط کا انتظار','الٹی گنتی','فاتح رنگ منتخب ہو رہا ہے...','راؤنڈ میں شامل ہونے کے لیے پہلی شرط لگائیں','وقت ختم ہونے پر شرطیں بند ہو جائیں گی','پچھلے نتائج','پہلے راؤنڈ کے بعد نتائج دکھائے جائیں گے','آپ کا بیلنس','کم از کم شرط 100 ہے','آپ کی شرط درج ہو گئی','بیلنس ناکافی ہے','آپ اس راؤنڈ میں پہلے ہی شرط لگا چکے ہیں','شرطیں بند ہو چکی ہیں','شرط درج نہیں ہو سکی','آپ کی شرط','راؤنڈ گھوم رہا ہے','شرط محفوظ ہو گئی','نایاب موقع','انعام کا ضربی تناسب','ہر کھلاڑی کے لیے فی راؤنڈ ایک شرط · کم از کم 100 سکے','سکے'],
};
const RESULT_COPY: Record<Lang,{players:string;empty:string;round:string;won:string;lost:string}> = {
 ar:{players:'المشاركون في الجولة الحالية',empty:'لم يسجل أي لاعب رهانًا بعد',round:'نتائج آخر جولة مكتملة',won:'ربح صافٍ',lost:'خسارة'},
 en:{players:'Players in the current round',empty:'No players have placed a bet yet',round:'Latest completed round results',won:'Net win',lost:'Loss'},
 ru:{players:'Участники текущего раунда',empty:'Пока никто не сделал ставку',round:'Результаты последнего раунда',won:'Чистый выигрыш',lost:'Потеря'},
 es:{players:'Participantes de la ronda actual',empty:'Aún no hay apuestas',round:'Resultados de la última ronda',won:'Ganancia neta',lost:'Pérdida'},
 pt:{players:'Participantes da rodada atual',empty:'Ainda não há apostas',round:'Resultados da última rodada',won:'Lucro líquido',lost:'Perda'},
 fr:{players:'Participants du tour actuel',empty:'Aucune mise pour le moment',round:'Résultats du dernier tour',won:'Gain net',lost:'Perte'},
 de:{players:'Teilnehmer der aktuellen Runde',empty:'Noch keine Einsätze vorhanden',round:'Ergebnisse der letzten Runde',won:'Nettogewinn',lost:'Verlust'},
 tr:{players:'Mevcut turun katılımcıları',empty:'Henüz bahis yok',round:'Son turun sonuçları',won:'Net kazanç',lost:'Kayıp'},
 zh:{players:'本轮参与者',empty:'暂无玩家下注',round:'最近一轮结果',won:'净赢得',lost:'损失'},
 hi:{players:'इस राउंड के खिलाड़ी',empty:'अभी तक कोई दांव नहीं',round:'पिछले पूरे राउंड के परिणाम',won:'शुद्ध जीत',lost:'नुकसान'},
 id:{players:'Peserta ronde saat ini',empty:'Belum ada taruhan',round:'Hasil ronde terakhir',won:'Kemenangan bersih',lost:'Kerugian'},
 bn:{players:'বর্তমান রাউন্ডের অংশগ্রহণকারী',empty:'এখনও কোনো বাজি নেই',round:'সর্বশেষ সম্পন্ন রাউন্ডের ফলাফল',won:'নিট জয়',lost:'ক্ষতি'},
 ja:{players:'現在のラウンド参加者',empty:'まだベットはありません',round:'直近の完了ラウンド結果',won:'純利益',lost:'損失'},
 ko:{players:'현재 라운드 참가자',empty:'아직 베팅이 없습니다',round:'최근 완료된 라운드 결과',won:'순수익',lost:'손실'},
 ur:{players:'موجودہ راؤنڈ کے شرکاء',empty:'ابھی تک کوئی شرط نہیں لگی',round:'آخری مکمل راؤنڈ کے نتائج',won:'خالص جیت',lost:'نقصان'},
};
const BALANCE_COPY: Record<Lang,{regular:string;purchased:string}> = {
 ar:{regular:'المحفظة العادية',purchased:'عملات الرهان المشتراة'},
 en:{regular:'Regular wallet',purchased:'Purchased bet tokens'},
 ru:{regular:'Обычный кошелёк',purchased:'Купленные монеты для ставок'},
 es:{regular:'Billetera normal',purchased:'Fichas de apuesta compradas'},
 pt:{regular:'Carteira normal',purchased:'Fichas de aposta compradas'},
 fr:{regular:'Portefeuille normal',purchased:'Jetons de pari achetés'},
 de:{regular:'Normales Guthaben',purchased:'Gekaufte Einsatz-Token'},
 tr:{regular:'Normal bakiye',purchased:'Satın alınan bahis jetonları'},
 zh:{regular:'普通钱包',purchased:'已购下注代币'},
 hi:{regular:'सामान्य वॉलेट',purchased:'खरीदे गए बेट टोकन'},
 id:{regular:'Dompet biasa',purchased:'Token taruhan yang dibeli'},
 bn:{regular:'সাধারণ ওয়ালেট',purchased:'কেনা বাজির টোকেন'},
 ja:{regular:'通常ウォレット',purchased:'購入したベットトークン'},
 ko:{regular:'일반 지갑',purchased:'구매한 베팅 토큰'},
 ur:{regular:'عام والیٹ',purchased:'خریدے گئے شرط کے سکے'},
};
const SECTOR_DEG = 360 / 15;

export function ColorWheelScreen({initData,isVerified}:{initData:string;isVerified:boolean}) {
 const lang=useGame(s=>s.lang);
 const c=COPY[lang]??COPY.en;
 const resultCopy=RESULT_COPY[lang]??RESULT_COPY.en;
 const colorLabel=(color:Color)=>color==='yellow'?c[0]:color==='purple'?c[1]:c[2];
 const [state,setState]=useState<WheelState|null>(null);
 const [amount,setAmount]=useState('100');
 const [now,setNow]=useState(Date.now());
 const [loading,setLoading]=useState(false);
 const [rotation,setRotation]=useState(0);
 const [spinDuration,setSpinDuration]=useState(7000);
 const animatedRound=useRef<string|null>(null);
 const headers=useMemo(()=>({'X-Telegram-Init-Data':initData}),[initData]);
 const refresh=useCallback(async()=>{
  if(!initData||!isVerified)return;
  const response=await fetch('/api/color-wheel',{headers,cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'color_wheel_unavailable');
  setState(data as WheelState);
 },[headers,initData,isVerified]);
 useEffect(()=>{void refresh().catch(()=>undefined);const poll=window.setInterval(()=>void refresh().catch(()=>undefined),900);const clock=window.setInterval(()=>setNow(Date.now()),200);return()=>{window.clearInterval(poll);window.clearInterval(clock)}},[refresh]);
 useEffect(()=>{
  const round=state?.round;
  if(!round||round.status!=='spinning'||round.winningSector===null||animatedRound.current===round.id)return;
  animatedRound.current=round.id;
  const remaining=Math.max(500,Math.min(7000,(round.spinStartedAt??Date.now())+7000-Date.now()));
  setSpinDuration(remaining);
  const center=round.winningSector*SECTOR_DEG;
  const target=((360-center)%360);
  setRotation(current=>current+360*8+target);
 },[state?.round?.id,state?.round?.status,state?.round?.winningSector,state?.round?.spinStartedAt]);
 const countdown=state?.round.startsAt==null?null:Math.max(0,Math.ceil((state.round.startsAt-now)/1000));
 const isSpinning=state?.round.status==='spinning';
 const placeBet=async(color:Color)=>{
  const value=Number(amount);
  if(!Number.isSafeInteger(value)||value<100){toast.error(c[17]);return}
  if(!state||state.ownBet||loading||state.round.status!=='open'||(state.round.startsAt!==null&&state.round.startsAt<=Date.now()))return;
  setLoading(true);
  try{
   const response=await fetch('/api/color-wheel',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({amount:value,color}),cache:'no-store'});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'bet_failed');
   await refresh();
   toast.success(c[18]);
  }catch(error){
   const code=error instanceof Error?error.message:'';
   toast.error(code==='insufficient_balance'?c[19]:code==='already_bet'?c[20]:code==='betting_closed'?c[21]:c[22]);
   await refresh().catch(()=>undefined);
  }finally{setLoading(false)}
 };
 const totalBalance=(state?.balance??0)+(state?.betBalance??0);
 const presets=[{label:'½',value:Math.max(100,Math.floor(Number(amount||100)/2))},{label:'×2',value:Math.max(100,Number(amount||100)*2)},{label:'MAX',value:totalBalance}];
 const history=state?.history??[];
 const currentBets=state?.bets??[];
 const lastRoundResults=state?.lastRoundResults;
 const ownBet=state?.ownBet;
 const canBet=Boolean(state&&isVerified&&!ownBet&&!loading&&state.round.status==='open'&&(state.round.startsAt===null||state.round.startsAt>Date.now()));
 const wheelGradient=useMemo(()=>`conic-gradient(from -12deg,${COLORS.map((color,index)=>`${META[color].hex} ${index*24}deg ${(index+1)*24}deg`).join(',')})`,[]);
 const rotationStyle={transform:`rotate(${rotation}deg)`,transition:isSpinning?`transform ${spinDuration}ms cubic-bezier(.10,.78,.08,1)`:'none'};
 return <div className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[#191b1d] px-3 pb-6 pt-3 text-white" dir={dirOf(lang)}>
  <div className="mx-auto w-full max-w-md space-y-3">
   <section className="rounded-2xl border border-white/10 bg-[#25282b] p-3 shadow-lg">
    <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-black text-white/65"><Trophy size={15} className="text-amber-300"/> {c[3]}</div><span className="text-[10px] text-white/35">ARMCO OIL</span></div>
    <div className="grid grid-cols-2 gap-2">
     {[0,1].map(index=>{const winner=state?.winners[index];return <div key={winner?winner.roundId+':'+winner.telegramId:index} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
      {winner?.photoUrl?<img src={winner.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover"/>:<div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-black">{winner?.username?.slice(0,1)??'?'}</div>}
      <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold">{winner?.username??c[4]}</div><div className="text-[9px] text-white/40">{c[5]}</div></div>
      <b className="shrink-0 text-[11px] text-amber-300">+{(winner?.payout??0).toLocaleString()}</b>
     </div>})}
    </div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#292b2d] to-[#17191b] p-3 shadow-[0_16px_36px_rgba(0,0,0,.28)]">
    <div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-white/75">{c[6]}</span></div>
    <div className="relative mx-auto aspect-square w-full max-w-[390px] p-1">
     <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#f9e3a2] via-[#8b7541] to-[#1d2023] p-[7px] shadow-[0_15px_32px_rgba(0,0,0,.55)]">
      <div className="h-full w-full rounded-full bg-[#101214] p-[5px] shadow-[inset_0_0_0_3px_rgba(255,255,255,.15)]">
       <motion.div className="relative h-full w-full rounded-full border-[3px] border-[#5d5e5f] shadow-[inset_0_0_0_2px_rgba(0,0,0,.4)]" style={{...rotationStyle,background:wheelGradient}}>
        <div className="absolute inset-0 rounded-full" style={{background:'repeating-conic-gradient(from -12deg, transparent 0deg 23.35deg, rgba(22,22,22,.85) 23.35deg 24deg)'}}/>
        {COLORS.map((color,index)=>{const angle=(index*24+12)*Math.PI/180;const x=50+34*Math.sin(angle);const y=50-34*Math.cos(angle);return <span key={index} className="absolute h-1.5 w-1.5 rounded-full bg-white/50 shadow" style={{left:x+'%',top:y+'%'}}/>})}
       </motion.div>
      </div>
     </div>
     <div className="absolute -top-0.5 left-1/2 z-20 -translate-x-1/2 drop-shadow-[0_3px_5px_rgba(0,0,0,.8)]"><div className="h-0 w-0 border-x-[15px] border-t-[28px] border-x-transparent border-t-orange-400"/></div>
     <div className="absolute left-1/2 top-1/2 z-10 flex h-[35%] w-[35%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-[5px] border-[#47494b] bg-[radial-gradient(circle_at_35%_30%,#34383c,#111315_70%)] shadow-[0_4px_18px_rgba(0,0,0,.7),inset_0_2px_8px_rgba(255,255,255,.08)]">
      <span className="text-4xl font-black tabular-nums text-white drop-shadow-lg">{isSpinning?'':countdown===null?'—':countdown}</span>
      <span className="mt-1 text-[9px] font-bold text-white/45">{isSpinning?c[8]:(state?.bets.length??0)===0?c[9]:c[10]}</span>
     </div>
    </div>
    <div className="mt-1 flex items-center justify-center gap-2 text-[10px] text-white/50"><Timer size={12}/>{isSpinning?c[11]:(state?.bets.length??0)===0?c[12]:c[13]}</div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-[#222528] p-3">
    <div className="mb-2 flex items-center justify-between text-xs"><span className="text-white/55" >{c[16]}</span><b className="flex items-center gap-1 text-amber-300"><Coins size={13}/>{totalBalance.toLocaleString()}</b></div>
    <div className="mb-2 flex items-center justify-between gap-2 text-[9px] text-white/45"><span>{(BALANCE_COPY[lang]??BALANCE_COPY.en).regular}: {(state?.balance??0).toLocaleString()}</span><span>{(BALANCE_COPY[lang]??BALANCE_COPY.en).purchased}: {(state?.betBalance??0).toLocaleString()}</span></div>
    <div className="flex gap-2">
     <input type="number" min={100} step={1} inputMode="numeric" value={amount} onChange={event=>setAmount(event.target.value)} disabled={!canBet} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#171a1c] px-3 py-3 text-lg font-black text-white outline-none focus:border-amber-400 disabled:opacity-60"/>
     {presets.map(item=><button key={item.label} type="button" disabled={!canBet||item.value>totalBalance} onClick={()=>setAmount(String(item.value))} className="min-w-11 rounded-xl border border-white/10 bg-[#2a2e31] px-2 text-xs font-black text-white/65 disabled:opacity-30">{item.label}</button>)}
    </div>
    {ownBet&&<div className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-2 text-xs font-bold text-emerald-200">{c[23]}: {ownBet.amount.toLocaleString()} {c[29]} على {colorLabel(ownBet.color)} · {isSpinning?c[24]:c[25]}</div>}
    <div className="mt-3 grid grid-cols-3 gap-2">
     {(['yellow','turquoise','purple'] as Color[]).map(color=><button key={color} type="button" disabled={!canBet||Number(amount)<100||Number(amount)>totalBalance} onClick={()=>void placeBet(color)} className={'relative flex min-h-[102px] flex-col items-center justify-center rounded-2xl border p-2 transition active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-35 '+META[color].className}>
      {loading?<Loader2 className="mb-1 h-8 w-8 animate-spin"/>:<span className="mb-1 h-9 w-9 rounded-full border-4 border-white/20 shadow-[0_0_18px_currentColor] " style={{background:META[color].hex}}/>}
      <b className="text-xs">{colorLabel(color)}</b><span className="mt-1 text-lg font-black">{META[color].multiplier}</span>
      <span className="text-[9px] opacity-65">{color==='turquoise'?c[26]:c[27]}</span>
     </button>)}
    </div>
    <p className="mt-2 text-center text-[9px] text-white/35" >{c[28]}</p>
   </section>
   <section className="rounded-2xl border border-white/10 bg-[#222528] p-3">
    <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-black text-white/75"><History size={14}/> {c[14]}</h3><span className="text-[10px] text-white/35">{history.length}</span></div>
    <div className="flex flex-wrap gap-2">
     {history.length?history.map(item=><div key={item.id} title={item.color} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 shadow-inner" style={{background:META[item.color].hex}}><span className="text-[9px] font-black text-black/65">{item.sector+1}</span></div>):<span className="py-2 text-[11px] text-white/35" >{c[15]}</span>}
    </div>
   </section>

   <section className="rounded-2xl border border-white/10 bg-[#222528] p-3">
    <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-black text-white/75"><Users size={14}/> {resultCopy.players}</h3><span className="text-[10px] text-amber-300">{currentBets.length}</span></div>
    {currentBets.length===0?<p className="py-3 text-center text-[11px] text-white/40">{resultCopy.empty}</p>:<div className="space-y-2">{currentBets.map(bet=><div key={bet.telegramId} className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/15 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">{bet.photoUrl?<img src={bet.photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover"/>:<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-black">{bet.username.slice(0,1).toUpperCase()}</span>}<div className="min-w-0"><b className="block truncate text-[11px]">{bet.username}</b><span className="text-[9px] text-white/45">{colorLabel(bet.color)}</span></div></div>
      <b className="shrink-0 text-xs text-amber-300">{bet.amount.toLocaleString()} {c[29]}</b>
    </div>)}</div>}
   </section>
   {lastRoundResults&&<section className="rounded-2xl border border-amber-300/20 bg-[#282522] p-3">
    <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-black text-amber-100"><Trophy size={14}/> {resultCopy.round}</h3><span className="rounded-lg px-2 py-1 text-[9px] font-black" style={{background:META[lastRoundResults.winningColor].hex,color:'#21180e'}}>{colorLabel(lastRoundResults.winningColor)}</span></div>
    <div className="space-y-2">{lastRoundResults.bets.map(bet=>{const net=bet.outcome==='win'?bet.payout-bet.amount:-bet.amount;return <div key={bet.telegramId} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">{bet.photoUrl?<img src={bet.photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover"/>:<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-black">{bet.username.slice(0,1).toUpperCase()}</span>}<div className="min-w-0"><b className="block truncate text-[11px]">{bet.username}</b><span className="text-[9px] text-white/45">{colorLabel(bet.color)} · {bet.amount.toLocaleString()} {c[29]}</span></div></div>
      <div className="shrink-0 text-end"><b className={net>=0?'text-sm text-emerald-300':'text-sm text-rose-300'}>{net>=0?'+':''}{net.toLocaleString()}</b><div className="text-[9px] text-white/45">{net>=0?resultCopy.won:resultCopy.lost}</div></div>
    </div>})}</div>
   </section>}

  </div>
 </div>;
}
