import en from './en';
// المهندس محمد حماد — language pack (loaded on demand)
type Dict = Record<string, string>;
const id: Dict = { ...en,
  navArena: 'Permainan',
  appName: 'Aramco Oil', appTagline: 'Ekstrak minyak · kumpulkan koin',
  settingsTitle: 'Pengaturan', language: 'Bahasa', sound: 'Suara', vibration: 'Getaran', about: 'Tentang', back: 'Kembali',
  balance: 'Saldo', coins: 'Koin', oil: 'Minyak', speed: 'Kecepatan', settings: 'Pengaturan', leaderboard: 'Papan peringkat',
  navWallet: 'Dompet', navTasks: 'Tugas', navPump: 'Pompa', navFriends: 'Teman', navStore: 'Toko', navSwap: 'Tukar',
  swapTitle: 'Penukaran koin', tapToPump: 'Ketuk pompa', sell: 'Jual', startMining: 'Mulai menambang',
  tasksTitle: 'Tugas', dailyTasks: 'Tugas harian', weeklyTasks: 'Tugas mingguan', friendsTitle: 'Teman',
  inviteLink: 'Tautan undangan', copyLink: 'Salin tautan', yourReferrals: 'Referral Anda', noReferrals: 'Belum ada referral',
  speedPartsTitle: 'Toko peningkatan', autoSellPart: "Penjualan otomatis", autoSellDescription: "Menjual minyak secara otomatis di akhir setiap siklus penambangan 12 jam selama 30 hari tanpa membuka game. Siklus penambangan harus sudah aktif.", autoSellDuration: "30 hari", crashRecentRounds: '10 ronde terakhir',
  promoCodeTitle: "Kode promo",
  promoCodePlaceholder: "Masukkan kode promo",
  promoApply: "Terapkan",
  promoApplying: "Menerapkan…",
  promoApplied: "Kode promo berhasil digunakan dan hadiah telah ditambahkan",
  promoInvalid: "Kode promo tidak valid atau tidak aktif",
  promoUserLimit: "Batas penggunaan kode ini untuk Anda telah tercapai",
  promoTotalLimit: "Batas total penggunaan kode ini telah tercapai",
  promoExpired: "Kode promo ini sudah kedaluwarsa",
  promoProductMismatch: "Kode ini tidak berlaku untuk produk yang dipilih",
  promoMiningFeePaid: "Biaya mining sudah diaktifkan",
  promoGenericError: "Kode promo tidak dapat digunakan",

};

export default id;
