import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const tr: Dict = { ...en,
  navArena: 'Oyunlar',
  appName: 'Aramco Oil', appTagline: 'Petrol çıkar · jeton biriktir',
  settingsTitle: 'Ayarlar', language: 'Dil', sound: 'Ses', vibration: 'Titreşim', about: 'Hakkında', back: 'Geri',
  balance: 'Bakiye', coins: 'Jeton', oil: 'Petrol', speed: 'Hız', settings: 'Ayarlar', leaderboard: 'Liderlik tablosu',
  navWallet: 'Cüzdan', navTasks: 'Görevler', navPump: 'Pompalama', navFriends: 'Arkadaşlar', navStore: 'Mağaza', navSwap: 'Takas',
  swapTitle: 'Jeton takası', tapToPump: 'Pompaya dokun', sell: 'Sat', startMining: 'Madenciliği başlat',
  tasksTitle: 'Görevler', dailyTasks: 'Günlük görevler', weeklyTasks: 'Haftalık görevler', friendsTitle: 'Arkadaşlar',
  inviteLink: 'Davet bağlantısı', copyLink: 'Bağlantıyı kopyala', yourReferrals: 'Davet ettiklerin', noReferrals: 'Henüz davet yok',
  speedPartsTitle: 'Yükseltme mağazası', autoSellPart: "Otomatik satış", autoSellDescription: "Oyunu açmadan 30 gün boyunca her 12 saatlik madencilik döngüsünün sonunda petrolü otomatik satar. Önceden etkin bir döngü bulunmalıdır.", autoSellDuration: "30 gün", crashRecentRounds: 'Son 10 tur',
};

export default tr;
