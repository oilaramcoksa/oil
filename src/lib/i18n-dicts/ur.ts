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
  promoCodeTitle: "پرومو کوڈ",
  promoCodePlaceholder: "پرومو کوڈ درج کریں",
  promoApply: "لاگو کریں",
  promoApplying: "لاگو ہو رہا ہے…",
  promoApplied: "پرومو کوڈ لاگو ہوگیا اور انعام شامل کردیا گیا",
  promoInvalid: "غلط یا غیر فعال پرومو کوڈ",
  promoUserLimit: "آپ اس کوڈ کے استعمال کی حد تک پہنچ گئے ہیں",
  promoTotalLimit: "اس کوڈ کے کل استعمال کی حد پوری ہوچکی ہے",
  promoExpired: "اس پرومو کوڈ کی میعاد ختم ہوچکی ہے",
  promoProductMismatch: "یہ کوڈ منتخب پروڈکٹ پر لاگو نہیں ہوتا",
  promoMiningFeePaid: "مائننگ فیس پہلے ہی فعال ہے",
  promoGenericError: "پرومو کوڈ استعمال نہیں ہوسکا",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: 'ورک ایریا روشن کیا جا رہا ہے...',
  sellTransferring: 'پمپ سے ٹرک میں تیل منتقل ہو رہا ہے...',
  sellLightsRestore: 'سائٹ لائٹنگ بحال کی جا رہی ہے...',
  sellDeparting: 'ٹرک روانہ ہو رہا ہے...',
  sellDone: 'فروخت مکمل!',
};

export default ur;
