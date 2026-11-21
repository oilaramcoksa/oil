import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const bn: Dict = { ...en,
  navArena: 'গেম',
  appName: 'Aramco Oil', appTagline: 'তেল উত্তোলন করুন · কয়েন সংগ্রহ করুন',
  settingsTitle: 'সেটিংস', language: 'ভাষা', sound: 'শব্দ', vibration: 'কম্পন', about: 'সম্পর্কে', back: 'ফিরে যান',
  balance: 'ব্যালেন্স', coins: 'কয়েন', oil: 'তেল', speed: 'গতি', settings: 'সেটিংস', leaderboard: 'লিডারবোর্ড',
  navWallet: 'ওয়ালেট', navTasks: 'কাজ', navPump: 'পাম্প', navFriends: 'বন্ধু', navStore: 'দোকান', navSwap: 'বদল',
  swapTitle: 'কয়েন বিনিময়', tapToPump: 'পাম্পে চাপ দিন', sell: 'বিক্রি', startMining: 'মাইনিং শুরু করুন',
  tasksTitle: 'কাজ', dailyTasks: 'দৈনিক কাজ', weeklyTasks: 'সাপ্তাহিক কাজ', friendsTitle: 'বন্ধু',
  inviteLink: 'আমন্ত্রণ লিংক', copyLink: 'লিংক কপি করুন', yourReferrals: 'আপনার রেফারেল', noReferrals: 'এখনও কোনো রেফারেল নেই',
  speedPartsTitle: 'আপগ্রেড স্টোর', autoSellPart: "স্বয়ংক্রিয় বিক্রি", autoSellDescription: "গেম না খুলেই ৩০ দিন প্রতি ১২ ঘণ্টার খনন চক্র শেষে তেল স্বয়ংক্রিয়ভাবে বিক্রি করে। আগে থেকে একটি খনন চক্র চালু থাকতে হবে।", autoSellDuration: "৩০ দিন", crashRecentRounds: 'শেষ ১০ রাউন্ড',
  promoCodeTitle: "প্রোমো কোড",
  promoCodePlaceholder: "প্রোমো কোড লিখুন",
  promoApply: "প্রয়োগ করুন",
  promoApplying: "প্রয়োগ হচ্ছে…",
  promoApplied: "প্রোমো কোড প্রয়োগ হয়েছে এবং পুরস্কার যোগ হয়েছে",
  promoInvalid: "ভুল বা নিষ্ক্রিয় প্রোমো কোড",
  promoUserLimit: "এই কোড ব্যবহারের আপনার সীমা পূর্ণ হয়েছে",
  promoTotalLimit: "এই কোডের মোট ব্যবহারের সীমা পূর্ণ হয়েছে",
  promoExpired: "প্রোমো কোডটির মেয়াদ শেষ",
  promoProductMismatch: "এই কোডটি নির্বাচিত পণ্যের জন্য প্রযোজ্য নয়",
  promoMiningFeePaid: "মাইনিং ফি ইতিমধ্যে সক্রিয়",
  promoGenericError: "প্রোমো কোড ব্যবহার করা যায়নি",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: 'কাজের এলাকা আলোকিত করা হচ্ছে...',
  sellTransferring: 'পাম্প থেকে ট্রাকে তেল স্থানান্তর হচ্ছে...',
  sellLightsRestore: 'সাইট আলো পুনরুদ্ধার করা হচ্ছে...',
  sellDeparting: 'ট্রাক ছেড়ে যাচ্ছে...',
  sellDone: 'বিক্রয় সম্পন্ন!',
};

export default bn;
