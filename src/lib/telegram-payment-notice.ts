type NoticeInput = { username?: string | null; firstName?: string | null; telegramId: string; title: string; amount: string; txHash?: string | null; };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

export async function publishPaymentNotice(input: NoticeInput) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('telegram_payment_notice_skipped: TELEGRAM_BOT_TOKEN is not configured');
    return;
  }
  const account = input.username ? '@' + input.username : input.firstName || 'لاعب ' + input.telegramId.slice(-4);
  const time = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short', hour12: true }).format(new Date());
  const lines = [
    '<b>🛢️ ARMCO OIL — ' + escapeHtml(input.title) + '</b>',
    '',
    '👤 <b>الحساب:</b> ' + escapeHtml(account),
    '🆔 <b>رقم اللاعب:</b> <code>' + escapeHtml(input.telegramId) + '</code>',
    '💎 <b>المبلغ:</b> ' + escapeHtml(input.amount),
    ...(input.txHash ? ['🔗 <b>معرّف المعاملة:</b> <code>' + escapeHtml(input.txHash) + '</code>'] : []),
    '🕒 <b>الوقت:</b> ' + escapeHtml(time) + ' (توقيت القاهرة)',
  ];
  const message = lines.join('\\n');
  const destinations = ['@qrmcooil', '@armcooil'];
  const results = await Promise.all(destinations.map(async (chatId) => {
    try {
      const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
      if (!response.ok || result.ok !== true) {
        console.error('telegram_payment_notice_failed', chatId, response.status, result.description ?? 'telegram_send_failed');
        return false;
      }
      return true;
    } catch (error) {
      console.error('telegram_payment_notice_failed', chatId, error);
      return false;
    }
  }));
  if (results.some((sent) => !sent)) console.error('telegram_payment_notice_partial_failure', { channel: results[0], group: results[1] });
}
