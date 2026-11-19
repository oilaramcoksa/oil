import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const es: Dict = { ...en,
  navArena: 'Juegos',
  appName: 'Aramco Oil', appTagline: 'Extrae petróleo · reúne monedas',
  settingsTitle: 'Configuración', language: 'Idioma', sound: 'Sonido', vibration: 'Vibración', about: 'Acerca de', back: 'Volver',
  balance: 'Saldo', coins: 'Monedas', oil: 'Petróleo', speed: 'Velocidad', settings: 'Configuración', leaderboard: 'Clasificación',
  navWallet: 'Billetera', navTasks: 'Tareas', navPump: 'Bombear', navFriends: 'Amigos', navStore: 'Tienda', navSwap: 'Intercambiar',
  swapTitle: 'Intercambio de monedas', tapToPump: 'Toca la bomba', sell: 'Vender', startMining: 'Iniciar minería',
  tasksTitle: 'Tareas', dailyTasks: 'Tareas diarias', weeklyTasks: 'Tareas semanales', friendsTitle: 'Amigos',
  inviteLink: 'Enlace de invitación', copyLink: 'Copiar enlace', yourReferrals: 'Tus referidos', noReferrals: 'Aún no hay referidos',
  speedPartsTitle: 'Tienda de mejoras', autoSellPart: "Venta automática", autoSellDescription: "Vende el petróleo automáticamente al finalizar cada ciclo de minería de 12 horas durante 30 días, sin abrir el juego. Debe haber un ciclo activo.", autoSellDuration: "30 días", crashRecentRounds: 'Últimas 10 rondas',
};

export default es;
