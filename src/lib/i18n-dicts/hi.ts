import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const hi: Dict = { ...en,
  navArena: 'खेल',
  appName: 'Aramco Oil', appTagline: 'तेल निकालें · सिक्के जमा करें',
  settingsTitle: 'सेटिंग्स', language: 'भाषा', sound: 'ध्वनि', vibration: 'कंपन', about: 'जानकारी', back: 'वापस',
  balance: 'बैलेंस', coins: 'सिक्के', oil: 'तेल', speed: 'गति', settings: 'सेटिंग्स', leaderboard: 'लीडरबोर्ड',
  navWallet: 'वॉलेट', navTasks: 'कार्य', navPump: 'पंप', navFriends: 'दोस्त', navStore: 'स्टोर', navSwap: 'बदलें',
  swapTitle: 'सिक्कों का विनिमय', tapToPump: 'पंप पर टैप करें', sell: 'बेचें', startMining: 'माइनिंग शुरू करें',
  tasksTitle: 'कार्य', dailyTasks: 'दैनिक कार्य', weeklyTasks: 'साप्ताहिक कार्य', friendsTitle: 'दोस्त',
  inviteLink: 'आमंत्रण लिंक', copyLink: 'लिंक कॉपी करें', yourReferrals: 'आपके रेफ़रल', noReferrals: 'अभी कोई रेफ़रल नहीं',
  speedPartsTitle: 'अपग्रेड स्टोर', autoSellPart: "स्वचालित बिक्री", autoSellDescription: "गेम खोले बिना 30 दिनों तक हर 12 घंटे के खनन चक्र के अंत में तेल अपने आप बेचता है। खनन चक्र पहले से सक्रिय होना चाहिए।", autoSellDuration: "30 दिन", crashRecentRounds: 'पिछले 10 राउंड',
  promoCodeTitle: "प्रोमो कोड",
  promoCodePlaceholder: "प्रोमो कोड दर्ज करें",
  promoApply: "लागू करें",
  promoApplying: "लागू हो रहा है…",
  promoApplied: "प्रोमो कोड लागू हुआ और इनाम जोड़ दिया गया",
  promoInvalid: "अमान्य या निष्क्रिय प्रोमो कोड",
  promoUserLimit: "आप इस कोड की उपयोग सीमा तक पहुँच चुके हैं",
  promoTotalLimit: "इस कोड की कुल उपयोग सीमा पूरी हो गई है",
  promoExpired: "प्रोमो कोड की समय-सीमा समाप्त हो गई है",
  promoProductMismatch: "यह कोड चुने गए उत्पाद पर लागू नहीं होता",
  promoMiningFeePaid: "माइनिंग शुल्क पहले से सक्रिय है",
  promoGenericError: "प्रोमो कोड लागू नहीं हो सका",

};

export default hi;
