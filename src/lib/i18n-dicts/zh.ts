import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const zh: Dict = { ...en,
  navArena: '游戏',
  appName: 'Aramco Oil', appTagline: '开采石油 · 收集金币',
  settingsTitle: '设置', language: '语言', sound: '声音', vibration: '震动', about: '关于', back: '返回',
  balance: '余额', coins: '金币', oil: '石油', speed: '速度', settings: '设置', leaderboard: '排行榜',
  navWallet: '钱包', navTasks: '任务', navPump: '开采', navFriends: '好友', navStore: '商店', navSwap: '兑换',
  swapTitle: '金币兑换', tapToPump: '点击油泵', sell: '出售', startMining: '开始开采',
  tasksTitle: '任务', dailyTasks: '每日任务', weeklyTasks: '每周任务', friendsTitle: '好友',
  inviteLink: '邀请链接', copyLink: '复制链接', yourReferrals: '邀请好友', noReferrals: '暂无邀请记录',
  speedPartsTitle: '升级商店', autoSellPart: "自动出售", autoSellDescription: "无需打开游戏，在30天内每个12小时采油周期结束时自动出售石油。必须先启动采油周期。", autoSellDuration: "30天", crashRecentRounds: '最近 10 局',
};

export default zh;
