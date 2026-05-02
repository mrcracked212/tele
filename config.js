/**
 * ============================================================================
 * CONFIG UTAMA BOT
 * ----------------------------------------------------------------------------
 * Semua pengaturan bot dipusatkan di file ini. Owner cukup edit file ini lalu
 * restart bot. File lain (bot.js, db.js, dll) HANYA membaca dari sini.
 *
 * Jika admin mengubah setting via command, override disimpan di
 * `data/settings.json`. Pada saat runtime, bot akan melakukan:
 *   mergeConfigWithRuntimeSettings() = defaultFromConfig <- override JSON.
 * ============================================================================
 */

const CONFIG = {
  BOT: {
    TOKEN: "ISI_TOKEN_BOT",
    NAME: "Bot Jasa Share Promosi",
    COMMAND_PREFIX: "/",
    TIMEZONE: "Asia/Jakarta"
  },

  OWNER: {
    ID: 123456789
  },

  ADMINS: [
    123456789,
    987654321
  ],

  DATABASE: {
    PATH: "./data",
    AUTO_CREATE_FILE: true,
    ATOMIC_WRITE: true,
    BACKUP_CORRUPT_JSON: true,
    FLUSH_INTERVAL_MS: 5000,
    FILES: {
      USERS: "users.json",
      GROUPS: "groups.json",
      CHANNELS: "channels.json",
      VOUCHERS: "vouchers.json",
      PACKAGES: "packages.json",
      PROMOTIONS: "promotions.json",
      LOGS: "logs.json",
      SESSIONS: "sessions.json",
      SETTINGS: "settings.json",
      PENDING_GROUPS: "pending_groups.json",
      PENDING_NOTIFICATIONS: "pending_notifications.json"
    }
  },

  PACKAGES: {
    TRIAL: {
      NAME: "Trial Basic",
      ENABLED: true,
      ONLY_ONCE: true,
      DURATION: "1h",
      // Trial Basic: hanya boleh kirim promo ke GRUP. Channel/user/all dilarang.
      CAN_SHARE_GROUP: true,
      CAN_SHARE_CHANNEL: false,
      CAN_SHARE_USER: false,
      CAN_SHARE_ALL: false,
      DELAY_SECONDS: 60,
      PROMO_LIMIT: 3,
      // Syarat aktivasi trial: hanya hitung GRUP valid. Channel tidak masuk.
      REQUIRED_TARGETS: 3,
      REQUIRED_VALID_GROUPS: 3,
      MIN_GROUP_MEMBERS_EXCLUDING_BOT: 30,
      MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT: 50,
      CHANNEL_COUNT_FOR_TRIAL: false
    },

    PRO: {
      NAME: "Pro",
      ENABLED: true,
      CAN_SHARE_GROUP: true,
      CAN_SHARE_CHANNEL: true,
      CAN_SHARE_USER: false,
      CAN_SHARE_ALL: false,
      DELAY_SECONDS: 30,
      DAILY_LIMIT: 20
    },

    VIP: {
      NAME: "VIP",
      ENABLED: true,
      CAN_SHARE_GROUP: true,
      CAN_SHARE_CHANNEL: true,
      CAN_SHARE_USER: true,
      CAN_SHARE_ALL: true,
      DELAY_SECONDS: 15,
      DAILY_LIMIT: 50
    },

    ADMIN: {
      BYPASS_DELAY: true,
      BYPASS_LIMIT: true,
      CAN_SHARE_ALL: true,
      CAN_CUSTOM_RECEIVE_PROMO: true
    },

    OWNER: {
      BYPASS_DELAY: true,
      BYPASS_LIMIT: true,
      CAN_SHARE_ALL: true,
      CAN_CUSTOM_RECEIVE_PROMO: true
    }
  },

  VOUCHER: {
    CODE_LENGTH: 10,
    PREFIX: "PROMO",
    ALLOW_CUSTOM_CODE: true,
    DEFAULT_DURATION: "30d",
    MAX_CREATE_PER_COMMAND: 100,
    VALID_PACKAGES: ["trial", "pro", "vip"],
    EXPIRE_UNUSED_VOUCHER: false,
    UNUSED_VOUCHER_EXPIRE_AFTER: "30d"
  },

  TRIAL: {
    ENABLED: true,
    ONLY_ONCE_PER_USER: true,
    DEFAULT_DURATION: "1h",
    DEFAULT_PROMO_LIMIT: 3,
    // Trial Basic: target untuk aktivasi WAJIB grup. Channel tidak dihitung.
    REQUIRED_VALID_TARGETS: 3,
    REQUIRED_VALID_GROUPS: 3,
    CHANNEL_COUNT_FOR_TRIAL: false,
    // Trial Basic hanya boleh share ke GRUP.
    CAN_SHARE_GROUP: true,
    CAN_SHARE_CHANNEL: false,
    CAN_SHARE_USER: false,
    CAN_SHARE_ALL: false,
    MIN_GROUP_MEMBERS_EXCLUDING_BOT: 30,
    MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT: 50,
    AUTO_DETECT_GROUP: true,
    AUTO_DETECT_CHANNEL: true,
    ALLOW_ADMIN_ASSIGN_TARGET: true
  },

  PROMOTION: {
    MAX_TEXT_LENGTH: 3500,
    MIN_TEXT_LENGTH: 5,
    ALLOW_URL_BUTTON: true,
    MAX_URL_BUTTONS: 2,
    ALLOW_PHOTO_PROMO: true,
    ALLOW_VIDEO_PROMO: false,
    DEFAULT_TARGET: "group_channel",
    CONFIRM_BEFORE_SEND: true,

    TARGETS: {
      GROUP: true,
      CHANNEL: true,
      USER: true,
      GROUP_CHANNEL: true,
      ALL: true
    },

    SEND_QUEUE: {
      ENABLED: true,
      BATCH_SIZE: 20,
      DELAY_BETWEEN_MESSAGES_MS: 500,
      DELAY_BETWEEN_BATCH_MS: 3000,
      MAX_RETRY_PER_TARGET: 2,
      RETRY_DELAY_MS: 3000
    },

    PROGRESS: {
      ENABLED: true,
      UPDATE_INTERVAL_MS: 3000,
      EDIT_RETRY_DELAY_MS: 5000,
      MAX_EDIT_RETRY: 3,
      SHOW_GROUP_PROGRESS: true,
      SHOW_CHANNEL_PROGRESS: true,
      SHOW_USER_PROGRESS: true
    }
  },

  BROADCAST: {
    ENABLED: true,
    ADMIN_ONLY: true,
    CONFIRM_BEFORE_SEND: true,
    BATCH_SIZE: 20,
    DELAY_BETWEEN_BATCH_MS: 3000,
    MAX_DAILY_BROADCAST: 5,
    MAX_MESSAGE_LENGTH: 3500,
    ALLOW_CANCEL: true,
    SHOW_PROGRESS: true
  },

  USERS: {
    AUTO_RECEIVE_PROMO_AFTER_START: true,
    USER_CAN_OPTOUT: false,
    ADMIN_CAN_CUSTOM_RECEIVE_PROMO: true,
    OWNER_CAN_CUSTOM_RECEIVE_PROMO: true,
    DEFAULT_ROLE: "user",
    DEFAULT_PACKAGE: "free",
    MARK_INACTIVE_IF_BLOCK_BOT: true
  },

  GROUPS: {
    AUTO_RECEIVE_PROMO_WHEN_BOT_JOINED: true,
    MIN_MEMBERS_FOR_TRIAL_EXCLUDING_BOT: 30,
    SAVE_GROUP_HISTORY: true,
    ALLOW_PROMO_TO_GROUP: true,
    MARK_INACTIVE_IF_BOT_REMOVED: true,
    CHECK_MEMBER_COUNT_ON_JOIN: true,
    ALLOW_BLACKLIST: true
  },

  CHANNELS: {
    AUTO_RECEIVE_PROMO_WHEN_BOT_JOINED: true,
    MIN_SUBSCRIBERS_FOR_TRIAL_EXCLUDING_BOT: 50,
    REQUIRE_BOT_ADMIN: true,
    REQUIRE_CAN_POST_MESSAGES: true,
    SAVE_CHANNEL_HISTORY: true,
    ALLOW_PROMO_TO_CHANNEL: true,
    MARK_INACTIVE_IF_NO_PERMISSION: true,
    CHECK_SUBSCRIBER_COUNT_ON_JOIN: true,
    ALLOW_BLACKLIST: true
  },

  SECURITY: {
    RATE_LIMIT_ENABLED: true,
    COMMAND_COOLDOWN_MS: 1200,
    COMMAND_MAX_PER_WINDOW: 40,
    COMMAND_WINDOW_MS: 60000,

    MAX_PROMO_PER_USER_PER_DAY_FREE: 0,
    MAX_PROMO_PER_USER_PER_DAY_TRIAL: 3,
    MAX_PROMO_PER_USER_PER_DAY_PRO: 20,
    MAX_PROMO_PER_USER_PER_DAY_VIP: 50,

    MAX_PROMO_TEXT_LENGTH: 3500,
    MIN_PROMO_TEXT_LENGTH: 5,

    BANNED_WORD_FILTER_ENABLED: true,
    BANNED_WORDS: [
      "judi",
      "slot",
      "bokep",
      "scam"
    ],

    BLOCK_LINKS_ENABLED: false,
    ALLOWED_DOMAINS: [],
    BLOCKED_DOMAINS: [],

    WARNING_ENABLED: true,
    MAX_WARNING_BEFORE_BAN: 3,
    AUTO_BAN_ENABLED: true,
    AUTO_BAN_REASON: "Mencapai batas maksimal warning",

    ANTI_SPAM_ENABLED: true,
    SAME_MESSAGE_LIMIT: 3,
    SAME_MESSAGE_WINDOW_MS: 60000,

    ADMIN_ACTION_CONFIRMATION: true,
    DANGEROUS_COMMAND_CONFIRMATION: true
  },

  LIMITS: {
    MAX_USERNAME_LENGTH: 32,
    MAX_NAME_LENGTH: 64,
    MAX_PROMO_TEXT_LENGTH: 3500,
    MAX_CAPTION_LENGTH: 1000,
    MAX_BUTTON_TEXT_LENGTH: 50,
    MAX_BUTTON_URL_LENGTH: 300,
    MAX_VOUCHER_CODE_LENGTH: 20,
    MAX_BROADCAST_TEXT_LENGTH: 3500,
    MAX_LOG_ITEMS_DISPLAY: 20,
    MAX_USER_LIST_DISPLAY: 20,
    MAX_GROUP_LIST_DISPLAY: 20,
    MAX_CHANNEL_LIST_DISPLAY: 20,
    MAX_LOG_ENTRIES_STORED: 20000,
    MAX_PROMOTION_ENTRIES_STORED: 5000
  },

  SESSIONS: {
    ENABLED: true,
    EXPIRE_AFTER_MS: 15 * 60 * 1000,
    CLEAN_INTERVAL_MS: 5 * 60 * 1000,
    CANCEL_COMMAND: "/cancel"
  },

  MENUS: {
    USE_INLINE_KEYBOARD: true,
    USE_COMMANDS: true,
    DELETE_OLD_MENU: false,

    MAIN_MENU: {
      PROFILE: "👤 Profil Saya",
      PACKAGE: "💎 Paket Saya",
      TRIAL: "🎁 Trial Basic",
      PROMO: "🚀 Buat Promosi",
      TARGETS: "🎯 Target Saya",
      HELP: "❓ Bantuan"
    },

    ADMIN_MENU: {
      STATS: "📊 Statistik",
      USERS: "👥 Kelola User",
      VOUCHERS: "🎟 Kelola Voucher",
      PACKAGES: "💎 Kelola Paket",
      GROUPS: "📢 Kelola Grup",
      CHANNELS: "📣 Kelola Channel",
      BROADCAST: "📡 Broadcast",
      LOGS: "📜 Logs",
      MAINTENANCE: "🛠 Maintenance"
    }
  },

  LOGGING: {
    ENABLED: true,
    SAVE_ADMIN_LOGS: true,
    SAVE_ERROR_LOGS: true,
    SAVE_PROMO_LOGS: true,
    SAVE_USER_LOGS: true,
    MAX_LOGS_PER_FILE: 5000,
    AUTO_CLEAR_OLD_LOGS: false,
    CLEAR_LOGS_AFTER_DAYS: 30
  },

  MAINTENANCE: {
    BACKUP_ENABLED: true,
    BACKUP_PATH: "./data/backups",
    MAX_BACKUP_FILES: 10,
    AUTO_BACKUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
    PACKAGE_SWEEP_INTERVAL_MS: 10 * 60 * 1000,
    REPAIR_JSON_ON_START: true,
    HEALTHCHECK_ENABLED: true,
    MAINTENANCE_MODE: false,
    MAINTENANCE_MESSAGE: "Bot sedang maintenance, coba lagi sebentar ya."
  },

  /**
   * --------------------------------------------------------------------------
   * Notifikasi join silent
   * --------------------------------------------------------------------------
   * Saat bot ditambahkan ke grup/channel, bot TIDAK BOLEH mengirim pesan status
   * apa pun ke grup/channel itu. Hasil deteksi dikirim ke private chat user
   * yang menambahkan bot. Jika gagal (user belum /start), simpan ke
   * `data/pending_notifications.json` dan tampilkan saat user melakukan /start.
   *
   * PENTING: Jangan pernah fallback kirim status ke grup/channel.
   */
  NOTIFICATIONS: {
    SEND_JOIN_STATUS_TO_GROUP: false,
    SEND_JOIN_STATUS_TO_CHANNEL: false,
    SEND_JOIN_STATUS_TO_INVITER_PRIVATE: true,
    SAVE_PENDING_NOTIFICATION_IF_PRIVATE_FAILED: true,
    SHOW_PENDING_NOTIFICATION_ON_START: true,
    MAX_PENDING_PER_USER: 50,
    MAX_RECENT_JOINS_DISPLAY: 30
  },

  /**
   * --------------------------------------------------------------------------
   * Startup sync grup & channel
   * --------------------------------------------------------------------------
   * Telegram Bot API tidak bisa mengambil semua grup/channel yang sedang
   * dimasuki bot dari nol. Bot hanya bisa memvalidasi ulang chat yang sudah
   * tercatat di `groups.json`/`channels.json`. Karena itu, saat startup:
   *   1. Re-validate semua grup/channel di database (refresh member, status,
   *      izin, dsb).
   *   2. Auto-save chat dari setiap incoming update agar database bertambah
   *      seiring waktu.
   *   3. Sediakan command admin `/importgroup` & `/bulkimportgroups` untuk
   *      import manual chat_id lama yang owner punya.
   */
  STARTUP_SYNC: {
    ENABLED: true,
    SYNC_GROUPS_ON_START: true,
    SYNC_CHANNELS_ON_START: true,
    VALIDATE_MEMBER_COUNT_ON_START: true,
    VALIDATE_CHANNEL_PERMISSION_ON_START: true,
    DELAY_BETWEEN_CHECK_MS: 500,
    MAX_CHECK_PER_START: 1000,
    LOG_RESULT: true,
    AUTO_SAVE_CHAT_FROM_UPDATE: true
  },

  MESSAGES: {
    START: "Selamat datang di Bot Jasa Share Promosi.",
    HELP: "Gunakan tombol menu atau command untuk memakai bot.",
    BANNED: "Akun Anda dibanned dan tidak bisa menggunakan bot.",
    NO_ACCESS: "Paket Anda tidak mendukung fitur ini.",
    TRIAL_USED: "Anda sudah pernah menggunakan Trial Basic. Silakan gunakan paket Pro atau VIP.",
    PROMO_SENT: "Promosi selesai dikirim.",
    PROMO_FAILED: "Promosi gagal dikirim.",
    CONFIRM_SEND_PROMO: "Apakah Anda yakin ingin mengirim promosi ini?",
    OWNER_ADMIN_PROTECTED: "❌ Tidak bisa memban owner/admin. Role owner dan admin dilindungi dari ban.",
    TRIAL_GROUP_ONLY: "❌ Paket Trial Basic hanya bisa mengirim promosi ke grup.\n\nUntuk promosi ke channel atau user, silakan gunakan paket Pro/VIP sesuai fitur yang tersedia.",
    JOIN_NOTIFICATION_FOOTER: "\n\nCatatan: Bot tidak mengirim pesan status ke dalam grup/channel agar tidak mengganggu anggota."
  },

  /**
   * --------------------------------------------------------------------------
   * Hak istimewa role
   * --------------------------------------------------------------------------
   * PENTING: Owner dan admin adalah role terpercaya. Jangan pernah membatasi,
   * memblokir, memban, memberi warning otomatis, atau memfilter pesan owner/
   * admin dalam kondisi apa pun. Semua sistem pembatasan hanya berlaku untuk
   * user biasa. Setiap titik enforcement WAJIB cek `isPrivileged(userId)`
   * lebih dulu dan langsung izinkan jika true.
   */
  PRIVILEGES: {
    OWNER: {
      IMMUNE_TO_BAN: true,
      IMMUNE_TO_AUTO_BAN: true,
      IMMUNE_TO_WARNING: true,
      IMMUNE_TO_FILTER: true,
      IMMUNE_TO_RATE_LIMIT: true,
      IMMUNE_TO_COOLDOWN: true,
      IMMUNE_TO_DAILY_LIMIT: true,
      IMMUNE_TO_PROMO_LIMIT: true,
      BYPASS_PACKAGE_CHECK: true,
      BYPASS_TRIAL_LIMIT: true,
      BYPASS_PROMO_TARGET_LIMIT: true,
      BYPASS_TEXT_LENGTH_LIMIT: true,
      CAN_USE_ANY_WORD: true,
      CAN_USE_ALL_FEATURES: true,
      CAN_MANAGE_ADMINS: true,
      CAN_MANAGE_OWNER: false,
      CAN_RUN_DANGEROUS_COMMANDS: true
    },

    ADMIN: {
      IMMUNE_TO_BAN: true,
      IMMUNE_TO_AUTO_BAN: true,
      IMMUNE_TO_WARNING: true,
      IMMUNE_TO_FILTER: true,
      IMMUNE_TO_RATE_LIMIT: true,
      IMMUNE_TO_COOLDOWN: true,
      IMMUNE_TO_DAILY_LIMIT: true,
      IMMUNE_TO_PROMO_LIMIT: true,
      BYPASS_PACKAGE_CHECK: true,
      BYPASS_TRIAL_LIMIT: true,
      BYPASS_PROMO_TARGET_LIMIT: true,
      BYPASS_TEXT_LENGTH_LIMIT: true,
      CAN_USE_ANY_WORD: true,
      CAN_USE_ALL_FEATURES: true,
      CAN_MANAGE_ADMINS: false,
      CAN_MANAGE_OWNER: false,
      CAN_RUN_DANGEROUS_COMMANDS: false
    }
  }
};

/**
 * ----------------------------------------------------------------------------
 * Legacy alias (BACA-SAJA)
 * ----------------------------------------------------------------------------
 * Tetap diekspor agar kode lama yang masih memakai key flat lama tidak pecah.
 * Nilai dihitung dari struktur kanonik CONFIG di atas. Jangan ubah di sini,
 * ubah di bagian kanonik saja.
 */
const LEGACY_ALIASES = {
  BOT_TOKEN: CONFIG.BOT.TOKEN,
  BOT_NAME: CONFIG.BOT.NAME,
  COMMAND_PREFIX: CONFIG.BOT.COMMAND_PREFIX,
  OWNER_ID: CONFIG.OWNER.ID,
  DATABASE_PATH: CONFIG.DATABASE.PATH,
  MIN_GROUP_MEMBER_FOR_TRIAL: CONFIG.TRIAL.MIN_GROUP_MEMBERS_EXCLUDING_BOT,
  MIN_CHANNEL_SUBSCRIBER_FOR_TRIAL: CONFIG.TRIAL.MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT,
  REQUIRED_TRIAL_GROUPS: CONFIG.TRIAL.REQUIRED_VALID_TARGETS,
  DEFAULT_DELAYS: {
    trial: CONFIG.PACKAGES.TRIAL.DELAY_SECONDS,
    pro: CONFIG.PACKAGES.PRO.DELAY_SECONDS,
    vip: CONFIG.PACKAGES.VIP.DELAY_SECONDS
  },
  PROMO_PROGRESS: {
    UPDATE_INTERVAL_MS: CONFIG.PROMOTION.PROGRESS.UPDATE_INTERVAL_MS,
    EDIT_RETRY_DELAY_MS: CONFIG.PROMOTION.PROGRESS.EDIT_RETRY_DELAY_MS,
    RETRY_DELAY_MS: CONFIG.PROMOTION.SEND_QUEUE.RETRY_DELAY_MS,
    MAX_RETRY: CONFIG.PROMOTION.PROGRESS.MAX_EDIT_RETRY
  }
};

const LEGACY_SECURITY = {
  MAX_PROMO_PER_DAY_TRIAL: CONFIG.SECURITY.MAX_PROMO_PER_USER_PER_DAY_TRIAL,
  MAX_PROMO_PER_DAY_PRO: CONFIG.SECURITY.MAX_PROMO_PER_USER_PER_DAY_PRO,
  MAX_PROMO_PER_DAY_VIP: CONFIG.SECURITY.MAX_PROMO_PER_USER_PER_DAY_VIP
};

module.exports = {
  ...CONFIG,
  ...LEGACY_ALIASES,
  ADMINS: CONFIG.ADMINS,
  BROADCAST: {
    ...CONFIG.BROADCAST,
    MAX_MESSAGE_LENGTH: CONFIG.BROADCAST.MAX_MESSAGE_LENGTH
  },
  SECURITY: {
    ...CONFIG.SECURITY,
    ...LEGACY_SECURITY
  }
};
