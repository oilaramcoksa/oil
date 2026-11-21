import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const ko: Dict = { ...en,
  navArena: '게임',
  appName: 'Aramco Oil', appTagline: '석유 채굴 · 코인 모으기',
  settingsTitle: '설정', language: '언어', sound: '소리', vibration: '진동', about: '정보', back: '뒤로',
  balance: '잔액', coins: '코인', oil: '석유', speed: '속도', settings: '설정', leaderboard: '순위표',
  navWallet: '지갑', navTasks: '미션', navPump: '채굴', navFriends: '친구', navStore: '상점', navSwap: '교환',
  swapTitle: '코인 교환', tapToPump: '펌프 누르기', sell: '판매', startMining: '채굴 시작',
  tasksTitle: '미션', dailyTasks: '일일 미션', weeklyTasks: '주간 미션', friendsTitle: '친구',
  inviteLink: '초대 링크', copyLink: '링크 복사', yourReferrals: '내 추천', noReferrals: '아직 추천한 친구가 없습니다',
  speedPartsTitle: '업그레이드 상점', autoSellPart: "자동 판매", autoSellDescription: "게임에 접속하지 않아도 30일 동안 12시간 채굴 주기가 끝날 때마다 석유를 자동 판매합니다. 채굴 주기가 먼저 시작되어 있어야 합니다.", autoSellDuration: "30일", crashRecentRounds: '최근 10라운드',
  promoCodeTitle: "프로모션 코드",
  promoCodePlaceholder: "프로모션 코드 입력",
  promoApply: "적용",
  promoApplying: "적용 중…",
  promoApplied: "프로모션 코드가 적용되고 보상이 지급되었습니다",
  promoInvalid: "유효하지 않거나 비활성화된 코드",
  promoUserLimit: "이 코드의 사용 한도에 도달했습니다",
  promoTotalLimit: "이 코드의 전체 사용 한도에 도달했습니다",
  promoExpired: "프로모션 코드가 만료되었습니다",
  promoProductMismatch: "선택한 상품에는 이 코드를 적용할 수 없습니다",
  promoMiningFeePaid: "마이닝 수수료가 이미 활성화되었습니다",
  promoGenericError: "프로모션 코드를 적용할 수 없습니다",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: '작업 구역 조명 켜는 중...',
  sellTransferring: '펌프에서 트럭으로 석유 이동 중...',
  sellLightsRestore: '조명 복구 중...',
  sellDeparting: '트럭 출발...',
  sellDone: '판매 완료!',
};

export default ko;
