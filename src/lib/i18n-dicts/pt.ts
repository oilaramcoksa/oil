import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const pt: Dict = { ...en,
  navArena: 'Jogos',
  appName: 'Aramco Oil', appTagline: 'Extraia petróleo · reúna moedas',
  settingsTitle: 'Configurações', language: 'Idioma', sound: 'Som', vibration: 'Vibração', about: 'Sobre', back: 'Voltar',
  balance: 'Saldo', coins: 'Moedas', oil: 'Petróleo', speed: 'Velocidade', settings: 'Configurações', leaderboard: 'Classificação',
  navWallet: 'Carteira', navTasks: 'Tarefas', navPump: 'Bombear', navFriends: 'Amigos', navStore: 'Loja', navSwap: 'Trocar',
  swapTitle: 'Troca de moedas', tapToPump: 'Toque na bomba', sell: 'Vender', startMining: 'Iniciar mineração',
  tasksTitle: 'Tarefas', dailyTasks: 'Tarefas diárias', weeklyTasks: 'Tarefas semanais', friendsTitle: 'Amigos',
  inviteLink: 'Link de convite', copyLink: 'Copiar link', yourReferrals: 'Seus indicados', noReferrals: 'Nenhum indicado ainda',
  speedPartsTitle: 'Loja de melhorias', autoSellPart: "Venda automática", autoSellDescription: "Vende o petróleo automaticamente ao fim de cada ciclo de mineração de 12 horas por 30 dias, sem abrir o jogo. É necessário ter um ciclo ativo.", autoSellDuration: "30 dias", crashRecentRounds: 'Últimas 10 rodadas',
  promoCodeTitle: "Código promocional",
  promoCodePlaceholder: "Digite o código promocional",
  promoApply: "Aplicar",
  promoApplying: "Aplicando…",
  promoApplied: "Código aplicado e recompensa creditada",
  promoInvalid: "Código inválido ou inativo",
  promoUserLimit: "Você atingiu o limite de uso deste código",
  promoTotalLimit: "O limite total de usos deste código foi atingido",
  promoExpired: "Este código expirou",
  promoProductMismatch: "Este código não se aplica ao produto selecionado",
  promoMiningFeePaid: "A taxa de mineração já está ativada",
  promoGenericError: "Não foi possível resgatar o código",


  // New sell-sequence phases (in-scene 3D HUD)
  sellLightsOn: 'Iluminando a área de trabalho...',
  sellTransferring: 'Transferindo óleo da bomba para o caminhão...',
  sellLightsRestore: 'Restaurando a iluminação...',
  sellDeparting: 'O caminhão saindo...',
  sellDone: 'Venda concluída!',
};

export default pt;
