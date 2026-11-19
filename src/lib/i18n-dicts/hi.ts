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
};

export default hi;
