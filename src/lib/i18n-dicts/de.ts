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
  promoCodeTitle: "Promo-Code",
  promoCodePlaceholder: "Promo-Code eingeben",
  promoApply: "Anwenden",
  promoApplying: "Wird angewendet…",
  promoApplied: "Promo-Code angewendet und Prämie gutgeschrieben",
  promoInvalid: "Ungültiger oder inaktiver Promo-Code",
  promoUserLimit: "Du hast das Nutzungslimit für diesen Code erreicht",
  promoTotalLimit: "Das Gesamtnutzungslimit dieses Codes ist erreicht",
  promoExpired: "Dieser Code ist abgelaufen",
  promoProductMismatch: "Dieser Code gilt nicht für das ausgewählte Produkt",
  promoMiningFeePaid: "Die Mining-Gebühr ist bereits aktiviert",
  promoGenericError: "Promo-Code konnte nicht eingelöst werden",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: 'Arbeitsbereich wird beleuchtet...',
  sellTransferring: 'Öl wird von der Pumpe in den LKW gepumpt...',
  sellLightsRestore: 'Beleuchtung wird wiederhergestellt...',
  sellDeparting: 'LKW fährt ab...',
  sellDone: 'Verkauf abgeschlossen!',
};

export default de;
