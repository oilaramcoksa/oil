import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const ur: Dict = { ...en,
  navArena: 'کھیل',
  appName: 'Aramco Oil', appTagline: 'تیل نکالیں · سکے جمع کریں',
  settingsTitle: 'ترتیبات', language: 'زبان', sound: 'آواز', vibration: 'وائبریشن', about: 'تعارف', back: 'واپس',
  balance: 'بیلنس', coins: 'سکے', oil: 'تیل', speed: 'رفتار', settings: 'ترتیبات', leaderboard: 'درجہ بندی',
  navWallet: 'والیٹ', navTasks: 'مشن', navPump: 'پمپ', navFriends: 'دوست', navStore: 'اسٹور', navSwap: 'تبادلہ',
  swapTitle: 'سکوں کا تبادلہ', tapToPump: 'پمپ کو دبائیں', sell: 'فروخت', startMining: 'مائننگ شروع کریں',
  tasksTitle: 'مشن', dailyTasks: 'روزانہ مشن', weeklyTasks: 'ہفتہ وار مشن', friendsTitle: 'دوست',
  inviteLink: 'دعوتی لنک', copyLink: 'لنک کاپی کریں', yourReferrals: 'آپ کے ریفرلز', noReferrals: 'ابھی کوئی ریفرل نہیں',
  speedPartsTitle: 'اپ گریڈ اسٹور', autoSellPart: "خودکار فروخت", autoSellDescription: "گیم کھولے بغیر 30 دن تک ہر 12 گھنٹے کے مائننگ سائیکل کے اختتام پر تیل خودکار فروخت کرتا ہے۔ مائننگ سائیکل پہلے سے فعال ہونا چاہیے۔", autoSellDuration: "30 دن", crashRecentRounds: 'آخری 10 راؤنڈ',
  on: 'پر',
};

export default ur;
