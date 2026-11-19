import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const de: Dict = { ...en,
  navArena: 'Spiele',
  appName: 'Aramco Oil', appTagline: 'Öl fördern · Münzen sammeln',
  settingsTitle: 'Einstellungen', language: 'Sprache', sound: 'Ton', vibration: 'Vibration', about: 'Über das Spiel', back: 'Zurück',
  balance: 'Guthaben', coins: 'Münzen', oil: 'Öl', speed: 'Geschwindigkeit', settings: 'Einstellungen', leaderboard: 'Bestenliste',
  navWallet: 'Wallet', navTasks: 'Aufgaben', navPump: 'Fördern', navFriends: 'Freunde', navStore: 'Shop', navSwap: 'Tauschen',
  swapTitle: 'Münzen tauschen', tapToPump: 'Pumpe antippen', sell: 'Verkaufen', startMining: 'Mining starten',
  tasksTitle: 'Aufgaben', dailyTasks: 'Tägliche Aufgaben', weeklyTasks: 'Wöchentliche Aufgaben', friendsTitle: 'Freunde',
  inviteLink: 'Einladungslink', copyLink: 'Link kopieren', yourReferrals: 'Deine Empfehlungen', noReferrals: 'Noch keine Empfehlungen',
  speedPartsTitle: 'Upgrade-Shop', autoSellPart: "Automatischer Verkauf", autoSellDescription: "Verkauft Öl 30 Tage lang am Ende jedes 12-Stunden-Förderzyklus automatisch, ohne das Spiel zu öffnen. Ein Förderzyklus muss aktiv sein.", autoSellDuration: "30 Tage", crashRecentRounds: 'Letzte 10 Runden',
};

export default de;
