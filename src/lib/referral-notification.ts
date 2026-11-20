import { getTurso } from '@/lib/turso';

const DIRECT_ENTRY_URL = 'https://t.me/armcooilbot?start=guest_gsasw02';

const COPY: Record<string, { title: string; accepted: string; lifetime: string; invite: string; prize: string; personal: string; direct: string }> = {
  ar: {
    title: '🎉 صديق جديد قبل دعوتك!',
    accepted: '👤 صديقك <b>{name}</b> انضم إلى Armco Oil عبر رابط دعوتك.',
    lifetime: '💰 الآن يمكنك كسب <b>5% من أرباحه داخل التطبيق مدى الحياة</b> وفق شروط التأهل.',
    invite: '🚀 أرسل رابط دعوتك إلى أصدقائك الذين لم ينضموا بعد، واغتنم فرصتك للفوز بما يصل إلى <b>1,000,000 عملة</b> داخل التطبيق!',
    personal: '🔗 رابط دعوتك الخاص:',
    direct: '📲 رابط الدخول المباشر:',
  },
  en: {
    title: '🎉 A new friend accepted your invitation!',
    accepted: '👤 Your friend <b>{name}</b> joined Armco Oil through your invite.',
    lifetime: '💰 You can now earn <b>5% of their in-app earnings for life</b>, subject to the referral qualification rules.',
    invite: '🚀 Share your invite link with friends who have not joined yet for a chance to win up to <b>1,000,000 in-app coins</b>!',
    personal: '🔗 Your personal referral link:',
    direct: '📲 Direct app entry:',
  },
  ru: {
    title: '🎉 Новый друг принял ваше приглашение!',
    accepted: '👤 Ваш друг <b>{name}</b> присоединился к Armco Oil по вашей ссылке.',
    lifetime: '💰 Теперь вы можете получать <b>5% от его дохода в приложении пожизненно</b> при соблюдении условий реферальной программы.',
    invite: '🚀 Отправьте личную ссылку друзьям, которые ещё не присоединились, и получите шанс выиграть до <b>1 000 000 игровых монет</b>!',
    personal: '🔗 Ваша личная реферальная ссылка:',
    direct: '📲 Прямая ссылка для входа:',
  },
  es: {
    title: '🎉 ¡Un amigo aceptó tu invitación!',
    accepted: '👤 Tu amigo <b>{name}</b> se unió a Armco Oil mediante tu enlace.',
    lifetime: '💰 Ahora puedes ganar <b>el 5% de sus ganancias en la aplicación de por vida</b>, sujeto a las condiciones del programa.',
    invite: '🚀 Comparte tu enlace con amigos que aún no se hayan unido y participa por hasta <b>1.000.000 de monedas</b>!',
    personal: '🔗 Tu enlace personal:',
    direct: '📲 Acceso directo:',
  },
  pt: {
    title: '🎉 Um amigo aceitou seu convite!',
    accepted: '👤 Seu amigo <b>{name}</b> entrou no Armco Oil pelo seu link.',
    lifetime: '💰 Agora você pode ganhar <b>5% dos ganhos dele no aplicativo por toda a vida</b>, conforme as regras de qualificação.',
    invite: '🚀 Compartilhe seu link com amigos que ainda não entraram e concorra a até <b>1.000.000 de moedas</b> no aplicativo!',
    personal: '🔗 Seu link pessoal:',
    direct: '📲 Acesso direto:',
  },
  fr: {
    title: '🎉 Un ami a accepté votre invitation !',
    accepted: '👤 Votre ami <b>{name}</b> a rejoint Armco Oil grâce à votre lien.',
    lifetime: '💰 Vous pouvez désormais gagner <b>5 % de ses gains dans l’application à vie</b>, sous réserve des conditions du programme.',
    invite: '🚀 Partagez votre lien avec vos amis qui ne nous ont pas encore rejoints et tentez de gagner jusqu’à <b>1 000 000 de pièces</b> !',
    personal: '🔗 Votre lien personnel :',
    direct: '📲 Accès direct :',
  },
  de: {
    title: '🎉 Ein Freund hat deine Einladung angenommen!',
    accepted: '👤 Dein Freund <b>{name}</b> ist über deinen Einladungslink Armco Oil beigetreten.',
    lifetime: '💰 Du kannst jetzt <b>lebenslang 5 % seiner Einnahmen in der App</b> erhalten, vorbehaltlich der Teilnahmebedingungen.',
    invite: '🚀 Teile deinen Einladungslink mit Freunden und sichere dir die Chance auf bis zu <b>1.000.000 Spielmünzen</b>!',
    personal: '🔗 Dein persönlicher Einladungslink:',
    direct: '📲 Direkter App-Zugang:',
  },
  tr: {
    title: '🎉 Yeni bir arkadaşın davetini kabul etti!',
    accepted: '👤 Arkadaşın <b>{name}</b>, davet bağlantın üzerinden Armco Oil’e katıldı.',
    lifetime: '💰 Artık şartları karşılaması halinde onun uygulama kazançlarının <b>ömür boyu %5’ini</b> kazanabilirsin.',
    invite: '🚀 Henüz katılmamış arkadaşlarınla davet bağlantını paylaş ve uygulamada <b>1.000.000’a kadar coin</b> kazanma şansını yakala!',
    personal: '🔗 Kişisel davet bağlantın:',
    direct: '📲 Doğrudan giriş:',
  },
  zh: {
    title: '🎉 有新朋友接受了你的邀请！',
    accepted: '👤 你的朋友 <b>{name}</b> 通过你的邀请链接加入了 Armco Oil。',
    lifetime: '💰 符合邀请计划条件后，你可以终身获得其应用内收益的 <b>5%</b>。',
    invite: '🚀 将邀请链接分享给尚未加入的朋友，还有机会赢取最高 <b>1,000,000 枚应用金币</b>！',
    personal: '🔗 你的专属邀请链接：',
    direct: '📲 应用直达链接：',
  },
  hi: {
    title: '🎉 आपके नए दोस्त ने आपका आमंत्रण स्वीकार किया!',
    accepted: '👤 आपके दोस्त <b>{name}</b> ने आपके आमंत्रण लिंक से Armco Oil जॉइन किया।',
    lifetime: '💰 पात्रता की शर्तें पूरी होने पर अब आप जीवनभर उसकी ऐप कमाई का <b>5%</b> कमा सकते हैं।',
    invite: '🚀 अपना लिंक उन दोस्तों को भेजें जिन्होंने अभी तक जॉइन नहीं किया है और ऐप में <b>1,000,000 तक कॉइन</b> जीतने का मौका पाएं!',
    personal: '🔗 आपका निजी आमंत्रण लिंक:',
    direct: '📲 ऐप खोलने का सीधा लिंक:',
  },
  id: {
    title: '🎉 Teman baru menerima undanganmu!',
    accepted: '👤 Temanmu <b>{name}</b> bergabung dengan Armco Oil melalui tautan undanganmu.',
    lifetime: '💰 Kini kamu bisa memperoleh <b>5% dari penghasilan dalam aplikasinya seumur hidup</b>, sesuai syarat kualifikasi.',
    invite: '🚀 Bagikan tautanmu kepada teman yang belum bergabung dan dapatkan kesempatan memenangkan hingga <b>1.000.000 koin</b>!',
    personal: '🔗 Tautan undangan pribadimu:',
    direct: '📲 Tautan masuk langsung:',
  },
  bn: {
    title: '🎉 আপনার নতুন বন্ধু আমন্ত্রণ গ্রহণ করেছে!',
    accepted: '👤 আপনার বন্ধু <b>{name}</b> আপনার আমন্ত্রণ লিংক দিয়ে Armco Oil-এ যোগ দিয়েছে।',
    lifetime: '💰 যোগ্যতার শর্ত পূরণ হলে এখন থেকে আজীবন তার অ্যাপের আয়ের <b>৫%</b> পেতে পারেন।',
    invite: '🚀 যারা এখনো যোগ দেয়নি তাদের সঙ্গে আপনার লিংক শেয়ার করুন এবং অ্যাপে <b>১,০০০,০০০ পর্যন্ত কয়েন</b> জেতার সুযোগ নিন!',
    personal: '🔗 আপনার ব্যক্তিগত আমন্ত্রণ লিংক:',
    direct: '📲 সরাসরি প্রবেশের লিংক:',
  },
  ja: {
    title: '🎉 友だちが招待を承認しました！',
    accepted: '👤 友だちの <b>{name}</b> さんが、あなたの招待リンクから Armco Oil に参加しました。',
    lifetime: '💰 紹介条件を満たすと、その友だちのアプリ内収益の <b>5%を生涯獲得</b>できます。',
    invite: '🚀 まだ参加していない友だちに招待リンクを送り、最大 <b>1,000,000 アプリコイン</b>を獲得するチャンス！',
    personal: '🔗 あなた専用の招待リンク：',
    direct: '📲 アプリへの直接リンク：',
  },
  ko: {
    title: '🎉 새 친구가 초대를 수락했어요!',
    accepted: '👤 친구 <b>{name}</b>님이 초대 링크를 통해 Armco Oil에 가입했습니다.',
    lifetime: '💰 추천 자격 조건을 충족하면 친구의 앱 수익 중 <b>5%를 평생 받을 수 있습니다.</b>',
    invite: '🚀 아직 가입하지 않은 친구에게 초대 링크를 공유하고 최대 <b>1,000,000 앱 코인</b>을 받을 기회를 잡으세요!',
    personal: '🔗 나만의 초대 링크:',
    direct: '📲 앱 바로가기:',
  },
  ur: {
    title: '🎉 آپ کے نئے دوست نے دعوت قبول کر لی!',
    accepted: '👤 آپ کے دوست <b>{name}</b> نے آپ کے دعوتی لنک سے Armco Oil جوائن کیا۔',
    lifetime: '💰 اہلیت کی شرائط پوری ہونے پر اب آپ زندگی بھر اس کی ایپ آمدنی کا <b>5%</b> حاصل کر سکتے ہیں۔',
    invite: '🚀 اپنا لنک ان دوستوں کو بھیجیں جو ابھی شامل نہیں ہوئے، اور ایپ میں <b>1,000,000 تک کوائنز</b> جیتنے کا موقع پائیں!',
    personal: '🔗 آپ کا ذاتی دعوتی لنک:',
    direct: '📲 ایپ میں داخلے کا براہِ راست لنک:',
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

export async function notifyReferrerOfNewFriend(referrerId: string, friendName: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('referral_notification_skipped: TELEGRAM_BOT_TOKEN is not configured');
    return;
  }

  const db = getTurso();
  const result = await db.execute({
    sql: `SELECT p.referral_code, s.state_json
          FROM players p
          LEFT JOIN player_game_snapshots s ON s.telegram_id=p.telegram_id
          WHERE p.telegram_id=?`,
    args: [referrerId],
  });
  const row = result.rows[0];
  if (!row) return;

  let lang = 'en';
  try {
    const state = row.state_json ? JSON.parse(String(row.state_json)) as { lang?: string } : {};
    if (state.lang && COPY[state.lang]) lang = state.lang;
  } catch { /* Fall back to English when the saved language is unavailable. */ }

  const copy = COPY[lang];
  const personalLink = row.referral_code
    ? `https://t.me/armcooilbot?start=ref_${encodeURIComponent(String(row.referral_code))}`
    : DIRECT_ENTRY_URL;
  const message = [
    copy.title,
    '',
    copy.accepted.replace('{name}', escapeHtml(friendName || 'Friend')),
    '',
    copy.lifetime,
    '',
    copy.invite,
    '',
    copy.personal,
    `<a href="${personalLink}">${escapeHtml(personalLink)}</a>`,
    '',
    copy.direct,
    `<a href="${DIRECT_ENTRY_URL}">${DIRECT_ENTRY_URL}</a>`,
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      chat_id: referrerId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`referral_telegram_notification_failed:${response.status}:${detail.slice(0, 200)}`);
  }
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!payload?.ok) throw new Error(`referral_telegram_notification_failed:${payload?.description ?? 'unknown'}`);
}
