import type { Client } from '@libsql/client';
import { LANGS, type Lang } from '@/lib/i18n';

type InviteGame = 'arena' | 'crash' | 'colors';

const COPY: Record<Lang,string[]> = {
 ar:['🔥 تحدٍ جديد في ARMCO OIL','اللاعب','ينتظرك للتحدي في لعبة','افتح اللعبة وانضم إلى الجولة الآن 👇','عجلة الألوان','عجلة الحظ','الطائرة','🎨 ادخل عجلة الألوان','🎡 ادخل عجلة الحظ','✈️ ادخل لعبة الطائرة'],
 en:['🔥 New ARMCO OIL challenge','Player','is waiting for you in','Open the game and join the round now 👇','Color Wheel','Lucky Wheel','ARMCOFLY','🎨 Join Color Wheel','🎡 Join Lucky Wheel','✈️ Play ARMCOFLY'],
 ru:['🔥 Новый вызов в ARMCO OIL','Игрок','ждёт тебя в игре','Открой игру и присоединяйся к раунду 👇','Цветное колесо','Колесо удачи','ARMCOFLY','🎨 Играть в цветное колесо','🎡 Играть в колесо удачи','✈️ Играть в ARMCOFLY'],
 es:['🔥 Nuevo desafío en ARMCO OIL','Jugador','te espera en','Abre el juego y únete a la ronda 👇','Ruleta de colores','Ruleta de la suerte','ARMCOFLY','🎨 Entrar a la ruleta de colores','🎡 Entrar a la ruleta de la suerte','✈️ Jugar ARMCOFLY'],
 pt:['🔥 Novo desafio no ARMCO OIL','Jogador','está esperando por você em','Abra o jogo e entre na rodada agora 👇','Roleta de cores','Roleta da sorte','ARMCOFLY','🎨 Entrar na roleta de cores','🎡 Entrar na roleta da sorte','✈️ Jogar ARMCOFLY'],
 fr:['🔥 Nouveau défi sur ARMCO OIL','Un joueur','vous attend dans','Ouvrez le jeu et rejoignez la manche 👇','Roue des couleurs','Roue de la chance','ARMCOFLY','🎨 Rejoindre la roue des couleurs','🎡 Rejoindre la roue de la chance','✈️ Jouer à ARMCOFLY'],
 de:['🔥 Neue Herausforderung bei ARMCO OIL','Ein Spieler','wartet im Spiel auf dich','Öffne das Spiel und tritt der Runde bei 👇','Farbrad','Glücksrad','ARMCOFLY','🎨 Farbrad beitreten','🎡 Glücksrad beitreten','✈️ ARMCOFLY spielen'],
 tr:['🔥 ARMCO OIL’da yeni meydan okuma','Oyuncu','oyununda seni bekliyor','Oyunu aç ve tura hemen katıl 👇','Renk Çarkı','Şans Çarkı','ARMCOFLY','🎨 Renk Çarkına Katıl','🎡 Şans Çarkına Katıl','✈️ ARMCOFLY Oyna'],
 zh:['🔥 ARMCO OIL 新挑战','玩家','正在游戏中等你','打开游戏并立即加入本轮 👇','颜色转盘','幸运转盘','ARMCOFLY','🎨 加入颜色转盘','🎡 加入幸运转盘','✈️ 玩 ARMCOFLY'],
 hi:['🔥 ARMCO OIL में नई चुनौती','खिलाड़ी','गेम में आपका इंतज़ार कर रहा है','गेम खोलें और अभी राउंड में शामिल हों 👇','रंगीन व्हील','लकी व्हील','ARMCOFLY','🎨 रंगीन व्हील में जाएँ','🎡 लकी व्हील में जाएँ','✈️ ARMCOFLY खेलें'],
 id:['🔥 Tantangan baru di ARMCO OIL','Pemain','menunggumu di','Buka game dan bergabung ke ronde sekarang 👇','Roda Warna','Roda Keberuntungan','ARMCOFLY','🎨 Masuk ke Roda Warna','🎡 Masuk ke Roda Keberuntungan','✈️ Mainkan ARMCOFLY'],
 bn:['🔥 ARMCO OIL-এ নতুন চ্যালেঞ্জ','একজন খেলোয়াড়','গেমে আপনার জন্য অপেক্ষা করছে','গেম খুলে এখনই রাউন্ডে যোগ দিন 👇','রঙের চাকা','লাকি হুইল','ARMCOFLY','🎨 রঙের চাকায় যোগ দিন','🎡 লাকি হুইলে যোগ দিন','✈️ ARMCOFLY খেলুন'],
 ja:['🔥 ARMCO OIL の新しいチャレンジ','プレイヤー','であなたを待っています','ゲームを開いてラウンドに参加しましょう 👇','カラーホイール','ラッキーホイール','ARMCOFLY','🎨 カラーホイールに参加','🎡 ラッキーホイールに参加','✈️ ARMCOFLYをプレイ'],
 ko:['🔥 ARMCO OIL 새 도전','플레이어가','게임에서 기다리고 있습니다','게임을 열고 지금 라운드에 참여하세요 👇','컬러 휠','행운의 휠','ARMCOFLY','🎨 컬러 휠 참여','🎡 행운의 휠 참여','✈️ ARMCOFLY 플레이'],
 ur:['🔥 ARMCO OIL میں نیا چیلنج','کھلاڑی','میں آپ کا منتظر ہے','گیم کھولیں اور ابھی راؤنڈ میں شامل ہوں 👇','رنگوں کا پہیہ','قسمت کا پہیہ','ARMCOFLY','🎨 رنگوں کے پہیے میں شامل ہوں','🎡 قسمت کے پہیے میں شامل ہوں','✈️ ARMCOFLY کھیلیں'],
};

function safeName(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
}

export async function broadcastGameInvite(
  db: Client,
  input: { game: InviteGame; roundId: string; playerId: string; playerName: string },
) {
  try {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !appUrl) {
    console.warn('game_invite_broadcast_skipped: Telegram bot or app URL is not configured');
    return;
  }

  const recipients = await db.execute({
    sql: "SELECT telegram_id,locale FROM players WHERE status='active' AND telegram_id<>? ORDER BY last_seen_at DESC",
    args: [input.playerId],
  });
  if (!recipients.rows.length) return;

  const url = new URL(appUrl);
  url.searchParams.set('tab', input.game);
  const ids = recipients.rows.map((row) => ({
    id: String(row.telegram_id),
    lang: LANGS.some((item) => item.code === String(row.locale)) ? String(row.locale) as Lang : 'en',
  }));
  for (let offset = 0; offset < ids.length; offset += 20) {
    const batch = ids.slice(offset, offset + 20);
    await Promise.all(batch.map(async (recipient) => {
      const chatId = recipient.id;
      const copy = COPY[recipient.lang];
      const gameIndex = input.game === 'colors' ? 4 : input.game === 'arena' ? 5 : 6;
      const buttonIndex = input.game === 'colors' ? 7 : input.game === 'arena' ? 8 : 9;
      const gameName = copy[gameIndex];
      const message = [
        '<b>' + copy[0] + '</b>',
        '',
        '👤 ' + copy[1] + ' <b>' + safeName(input.playerName || 'Player') + '</b>',
        copy[2] + ' <b>(' + gameName + ')</b>',
        '',
        copy[3],
      ].join('\\n');
      try {
        const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [[{
                text: copy[buttonIndex],
                web_app: { url: url.toString() },
              }]],
            },
          }),
        });
        if (!response.ok) {
          const details = await response.text().catch(() => '');
          console.warn('game_invite_delivery_failed', { chatId, status: response.status, details: details.slice(0, 180) });
        }
      } catch (error) {
        console.warn('game_invite_delivery_failed', { chatId, error });
      }
    }));
    if (offset + 20 < ids.length) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  } catch (error) {
    console.error('game_invite_broadcast_failed', { game: input.game, roundId: input.roundId, error });
  }
}
