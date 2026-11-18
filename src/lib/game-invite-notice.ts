import type { Client } from '@libsql/client';

type InviteGame = 'arena' | 'crash';

function safeName(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
}

export async function broadcastGameInvite(
  db: Client,
  input: { game: InviteGame; roundId: string; playerId: string; playerName: string },
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token || !appUrl) {
    console.warn('game_invite_broadcast_skipped: Telegram bot or app URL is not configured');
    return;
  }

  const recipients = await db.execute({
    sql: "SELECT telegram_id FROM players WHERE status='active' AND telegram_id<>? ORDER BY last_seen_at DESC",
    args: [input.playerId],
  });
  if (!recipients.rows.length) return;

  const url = new URL(appUrl);
  url.searchParams.set('tab', input.game);
  const gameName = input.game === 'arena' ? 'عجلة الحظ' : 'الطائرة';
  const message = [
    '🔥 <b>تحدٍ جديد في ARMCO OIL</b>',
    '',
    '👤 اللاعب <b>' + safeName(input.playerName || 'لاعب') + '</b>',
    'ينتظرك للتحدي في لعبة <b>(' + gameName + ')</b>',
    '',
    'افتح اللعبة وانضم إلى الجولة الآن 👇',
  ].join('\n');

  const ids = recipients.rows.map((row) => String(row.telegram_id));
  for (let offset = 0; offset < ids.length; offset += 20) {
    const batch = ids.slice(offset, offset + 20);
    await Promise.all(batch.map(async (chatId) => {
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
                text: input.game === 'arena' ? '🎡 ادخل عجلة الحظ' : '✈️ ادخل لعبة الطائرة',
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
}
