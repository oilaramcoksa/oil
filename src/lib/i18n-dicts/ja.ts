import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const ja: Dict = { ...en,
  navArena: 'ゲーム',
  appName: 'Aramco Oil', appTagline: '石油を採掘 · コインを集める',
  settingsTitle: '設定', language: '言語', sound: 'サウンド', vibration: '振動', about: 'このアプリについて', back: '戻る',
  balance: '残高', coins: 'コイン', oil: '石油', speed: '速度', settings: '設定', leaderboard: 'ランキング',
  navWallet: 'ウォレット', navTasks: 'タスク', navPump: '採掘', navFriends: '友達', navStore: 'ショップ', navSwap: '交換',
  swapTitle: 'コイン交換', tapToPump: 'ポンプをタップ', sell: '売却', startMining: '採掘を開始',
  tasksTitle: 'タスク', dailyTasks: 'デイリータスク', weeklyTasks: 'ウィークリータスク', friendsTitle: '友達',
  inviteLink: '招待リンク', copyLink: 'リンクをコピー', yourReferrals: '紹介した友達', noReferrals: '紹介はまだありません',
  speedPartsTitle: 'アップグレードショップ', autoSellPart: "自動販売", autoSellDescription: "ゲームを開かなくても、30日間、12時間の採掘サイクル終了時に石油を自動販売します。採掘サイクルを開始しておく必要があります。", autoSellDuration: "30日間", crashRecentRounds: '直近10ラウンド',
};

export default ja;
