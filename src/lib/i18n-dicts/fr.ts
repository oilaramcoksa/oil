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
  promoCodeTitle: "Code promo",
  promoCodePlaceholder: "Saisissez le code promo",
  promoApply: "Appliquer",
  promoApplying: "Application…",
  promoApplied: "Code appliqué et récompense créditée",
  promoInvalid: "Code invalide ou inactif",
  promoUserLimit: "Vous avez atteint la limite d’utilisation de ce code",
  promoTotalLimit: "La limite totale d’utilisations de ce code est atteinte",
  promoExpired: "Ce code a expiré",
  promoProductMismatch: "Ce code ne s’applique pas au produit sélectionné",
  promoMiningFeePaid: "Les frais de minage sont déjà activés",
  promoGenericError: "Impossible d’utiliser le code promo",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: 'Éclairage de la zone de travail...',
  sellTransferring: 'Transfert du pétrole de la pompe vers le camion...',
  sellLightsRestore: 'Restauration de l\'éclairage...',
  sellDeparting: 'Le camion part...',
  sellDone: 'Vente terminée !',
};

export default fr;
