import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const fr: Dict = { ...en,
  navArena: 'Jeux',
  appName: 'Aramco Oil', appTagline: 'Extrayez du pétrole · gagnez des pièces',
  settingsTitle: 'Paramètres', language: 'Langue', sound: 'Son', vibration: 'Vibrations', about: 'À propos', back: 'Retour',
  balance: 'Solde', coins: 'Pièces', oil: 'Pétrole', speed: 'Vitesse', settings: 'Paramètres', leaderboard: 'Classement',
  navWallet: 'Portefeuille', navTasks: 'Missions', navPump: 'Pomper', navFriends: 'Amis', navStore: 'Boutique', navSwap: 'Échanger',
  swapTitle: 'Échange de pièces', tapToPump: 'Appuyez sur la pompe', sell: 'Vendre', startMining: 'Démarrer le minage',
  tasksTitle: 'Missions', dailyTasks: 'Missions quotidiennes', weeklyTasks: 'Missions hebdomadaires', friendsTitle: 'Amis',
  inviteLink: 'Lien d’invitation', copyLink: 'Copier le lien', yourReferrals: 'Vos filleuls', noReferrals: 'Aucun filleul pour le moment',
  speedPartsTitle: 'Boutique des améliorations', autoSellPart: "Vente automatique", autoSellDescription: "Vend automatiquement le pétrole à la fin de chaque cycle minier de 12 heures pendant 30 jours, sans ouvrir le jeu. Un cycle doit être actif.", autoSellDuration: "30 jours", crashRecentRounds: '10 dernières manches',
};

export default fr;
