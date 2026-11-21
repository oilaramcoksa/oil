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
  promoCodeTitle: "プロモコード",
  promoCodePlaceholder: "プロモコードを入力",
  promoApply: "適用",
  promoApplying: "適用中…",
  promoApplied: "プロモコードが適用され、報酬が付与されました",
  promoInvalid: "無効または停止中のプロモコード",
  promoUserLimit: "このコードの利用上限に達しました",
  promoTotalLimit: "このコードの総利用回数の上限に達しました",
  promoExpired: "このプロモコードは期限切れです",
  promoProductMismatch: "このコードは選択した商品には適用できません",
  promoMiningFeePaid: "マイニング手数料はすでに有効です",
  promoGenericError: "プロモコードを適用できませんでした",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: '作業エリアを照明中...',
  sellTransferring: 'ポンプからトラックへ石油を移送中...',
  sellLightsRestore: '照明を復元中...',
  sellDeparting: 'トラックが出発...',
  sellDone: '販売完了!',
};

export default ja;
