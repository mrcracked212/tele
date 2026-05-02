// Harness smoke test lokal tanpa hit Telegram API.
// Jalankan: `node scripts/smoke.js`
// Script ini memuat bot.js di dalam sandbox (vm), mengganti require() untuk
// node-telegram-bot-api + config + db, lalu memicu event utk /start, /trial,
// /receivepromo_on|off, /settrial*, /trialprogress, flow /buatpromo.

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const vm = require("vm");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const botPath = path.join(projectRoot, "bot.js");

  let source = await fs.readFile(botPath, "utf8");

  const startupSnippet = `setupBot().catch(async (error) => {
  console.error("Gagal menjalankan bot:", error.message);
  try {
    addLog("startup_error", { error: error.message });
    await flushDirtyData();
  } catch {
    // ignore
  }
  process.exit(1);
});`;

  if (!source.includes(startupSnippet)) {
    throw new Error("Startup bootstrap snippet tidak ditemukan di bot.js");
  }

  source = source.replace(
    startupSnippet,
    `globalThis.__setupPromise = setupBot().catch(async (error) => {
  globalThis.__setupError = error;
  try {
    addLog("startup_error", { error: error.message });
    await flushDirtyData();
  } catch {
    // ignore
  }
});`
  );

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-smoke-"));
  const testDataPath = path.join(tempDir, "data");

  const testConfig = {
    BOT: { TOKEN: "TEST_TOKEN", NAME: "Bot Smoke Test", COMMAND_PREFIX: "/", TIMEZONE: "Asia/Jakarta" },
    OWNER: { ID: 9001 },
    ADMINS: [9001, 9002],
    DATABASE: {
      PATH: testDataPath,
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
        NAME: "Trial Basic", ENABLED: true, ONLY_ONCE: true, DURATION: "1h",
        CAN_SHARE_GROUP: true, CAN_SHARE_CHANNEL: false, CAN_SHARE_USER: false, CAN_SHARE_ALL: false,
        DELAY_SECONDS: 60, PROMO_LIMIT: 3, REQUIRED_TARGETS: 3, REQUIRED_VALID_GROUPS: 3,
        MIN_GROUP_MEMBERS_EXCLUDING_BOT: 30, MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT: 50,
        CHANNEL_COUNT_FOR_TRIAL: false
      },
      PRO: { NAME: "Pro", ENABLED: true, CAN_SHARE_GROUP: true, CAN_SHARE_CHANNEL: true, CAN_SHARE_USER: false, CAN_SHARE_ALL: false, DELAY_SECONDS: 30, DAILY_LIMIT: 20 },
      VIP: { NAME: "VIP", ENABLED: true, CAN_SHARE_GROUP: true, CAN_SHARE_CHANNEL: true, CAN_SHARE_USER: true, CAN_SHARE_ALL: true, DELAY_SECONDS: 15, DAILY_LIMIT: 50 }
    },
    TRIAL: {
      ENABLED: true, ONLY_ONCE_PER_USER: true,
      DEFAULT_DURATION: "1h", DEFAULT_PROMO_LIMIT: 3,
      REQUIRED_VALID_TARGETS: 3, REQUIRED_VALID_GROUPS: 3, CHANNEL_COUNT_FOR_TRIAL: false,
      CAN_SHARE_GROUP: true, CAN_SHARE_CHANNEL: false, CAN_SHARE_USER: false, CAN_SHARE_ALL: false,
      MIN_GROUP_MEMBERS_EXCLUDING_BOT: 30, MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT: 50,
      AUTO_DETECT_GROUP: true, AUTO_DETECT_CHANNEL: true, ALLOW_ADMIN_ASSIGN_TARGET: true
    },
    NOTIFICATIONS: {
      SEND_JOIN_STATUS_TO_GROUP: false, SEND_JOIN_STATUS_TO_CHANNEL: false,
      SEND_JOIN_STATUS_TO_INVITER_PRIVATE: true,
      SAVE_PENDING_NOTIFICATION_IF_PRIVATE_FAILED: true,
      SHOW_PENDING_NOTIFICATION_ON_START: true,
      MAX_PENDING_PER_USER: 50, MAX_RECENT_JOINS_DISPLAY: 30
    },
    STARTUP_SYNC: {
      ENABLED: true, SYNC_GROUPS_ON_START: true, SYNC_CHANNELS_ON_START: true,
      VALIDATE_MEMBER_COUNT_ON_START: true, VALIDATE_CHANNEL_PERMISSION_ON_START: true,
      DELAY_BETWEEN_CHECK_MS: 0, MAX_CHECK_PER_START: 1000, LOG_RESULT: true,
      AUTO_SAVE_CHAT_FROM_UPDATE: true
    },
    PROMOTION: {
      MAX_TEXT_LENGTH: 3500, MIN_TEXT_LENGTH: 5, ALLOW_URL_BUTTON: true, MAX_URL_BUTTONS: 1,
      DEFAULT_TARGET: "group_channel", CONFIRM_BEFORE_SEND: true,
      SEND_QUEUE: {
        ENABLED: true, BATCH_SIZE: 20, DELAY_BETWEEN_MESSAGES_MS: 10,
        DELAY_BETWEEN_BATCH_MS: 50, MAX_RETRY_PER_TARGET: 2, RETRY_DELAY_MS: 50
      },
      PROGRESS: { ENABLED: true, UPDATE_INTERVAL_MS: 2000, EDIT_RETRY_DELAY_MS: 100, MAX_EDIT_RETRY: 2 }
    },
    BROADCAST: {
      ENABLED: true, ADMIN_ONLY: true, CONFIRM_BEFORE_SEND: true,
      BATCH_SIZE: 20, DELAY_BETWEEN_BATCH_MS: 50, MAX_MESSAGE_LENGTH: 3500,
      ALLOW_CANCEL: true, SHOW_PROGRESS: true
    },
    USERS: {
      AUTO_RECEIVE_PROMO_AFTER_START: true, USER_CAN_OPTOUT: false,
      ADMIN_CAN_CUSTOM_RECEIVE_PROMO: true, OWNER_CAN_CUSTOM_RECEIVE_PROMO: true,
      DEFAULT_ROLE: "user", DEFAULT_PACKAGE: "free"
    },
    SECURITY: {
      RATE_LIMIT_ENABLED: true, COMMAND_COOLDOWN_MS: 1200, COMMAND_MAX_PER_WINDOW: 40, COMMAND_WINDOW_MS: 60000,
      MAX_PROMO_PER_USER_PER_DAY_FREE: 0, MAX_PROMO_PER_USER_PER_DAY_TRIAL: 3,
      MAX_PROMO_PER_USER_PER_DAY_PRO: 20, MAX_PROMO_PER_USER_PER_DAY_VIP: 50,
      MAX_PROMO_TEXT_LENGTH: 3500, MIN_PROMO_TEXT_LENGTH: 5,
      BANNED_WORD_FILTER_ENABLED: true, BANNED_WORDS: ["judi", "slot", "bokep", "scam"],
      WARNING_ENABLED: true, MAX_WARNING_BEFORE_BAN: 3,
      AUTO_BAN_ENABLED: true, AUTO_BAN_REASON: "Mencapai batas maksimal warning"
    },
    LIMITS: {
      MAX_PROMO_TEXT_LENGTH: 3500, MAX_BROADCAST_TEXT_LENGTH: 3500,
      MAX_LOG_ENTRIES_STORED: 2000, MAX_PROMOTION_ENTRIES_STORED: 500
    },
    SESSIONS: { ENABLED: true, EXPIRE_AFTER_MS: 15 * 60 * 1000, CLEAN_INTERVAL_MS: 5 * 60 * 1000 },
    LOGGING: { ENABLED: true, MAX_LOGS_PER_FILE: 2000 },
    MAINTENANCE: { BACKUP_ENABLED: true, BACKUP_PATH: path.join(testDataPath, "backups"), PACKAGE_SWEEP_INTERVAL_MS: 10 * 60 * 1000 },
    MESSAGES: {
      OWNER_ADMIN_PROTECTED: "❌ Tidak bisa memban owner/admin. Role owner dan admin dilindungi dari ban.",
      TRIAL_GROUP_ONLY: "❌ Paket Trial Basic hanya bisa mengirim promosi ke grup.\n\nUntuk promosi ke channel atau user, silakan gunakan paket Pro/VIP sesuai fitur yang tersedia.",
      JOIN_NOTIFICATION_FOOTER: "\n\nCatatan: Bot tidak mengirim pesan status ke dalam grup/channel agar tidak mengganggu anggota."
    },
    PRIVILEGES: {
      OWNER: {
        IMMUNE_TO_BAN: true, IMMUNE_TO_AUTO_BAN: true, IMMUNE_TO_WARNING: true,
        IMMUNE_TO_FILTER: true, IMMUNE_TO_RATE_LIMIT: true, IMMUNE_TO_COOLDOWN: true,
        IMMUNE_TO_DAILY_LIMIT: true, IMMUNE_TO_PROMO_LIMIT: true,
        BYPASS_PACKAGE_CHECK: true, BYPASS_TRIAL_LIMIT: true,
        BYPASS_PROMO_TARGET_LIMIT: true, BYPASS_TEXT_LENGTH_LIMIT: true,
        CAN_USE_ANY_WORD: true, CAN_USE_ALL_FEATURES: true,
        CAN_MANAGE_ADMINS: true, CAN_MANAGE_OWNER: false, CAN_RUN_DANGEROUS_COMMANDS: true
      },
      ADMIN: {
        IMMUNE_TO_BAN: true, IMMUNE_TO_AUTO_BAN: true, IMMUNE_TO_WARNING: true,
        IMMUNE_TO_FILTER: true, IMMUNE_TO_RATE_LIMIT: true, IMMUNE_TO_COOLDOWN: true,
        IMMUNE_TO_DAILY_LIMIT: true, IMMUNE_TO_PROMO_LIMIT: true,
        BYPASS_PACKAGE_CHECK: true, BYPASS_TRIAL_LIMIT: true,
        BYPASS_PROMO_TARGET_LIMIT: true, BYPASS_TEXT_LENGTH_LIMIT: true,
        CAN_USE_ANY_WORD: true, CAN_USE_ALL_FEATURES: true,
        CAN_MANAGE_ADMINS: false, CAN_MANAGE_OWNER: false, CAN_RUN_DANGEROUS_COMMANDS: false
      }
    }
  };

  class FakeTelegramBot {
    static instance = null;
    constructor(token, options) {
      this.token = token;
      this.options = options;
      this.handlers = new Map();
      this.messages = [];
      this.edits = [];
      this.callbackAnswers = [];
      this.memberCountByChat = new Map();
      this.chatMembers = new Map();
      this.chats = new Map();
      this.nextMessageId = 1;
      this.pollingStopped = false;
      this.failPrivateForUserIds = new Set();
      FakeTelegramBot.instance = this;
    }
    on(event, handler) { this.handlers.set(event, handler); }
    async emit(event, payload) {
      const handler = this.handlers.get(event);
      if (!handler) throw new Error(`No handler for event: ${event}`);
      return handler(payload);
    }
    async getMe() { return { id: 999001, username: "smoketest_bot" }; }
    async sendMessage(chatId, text, options = {}) {
      const numericId = Number(chatId);
      // Simulasikan kondisi "user belum /start" → bot.sendMessage gagal ke
      // private chat user. Set lewat `bot.failPrivateForUserIds.add(userId)`.
      if (this.failPrivateForUserIds && this.failPrivateForUserIds.has(numericId)) {
        const err = new Error("Forbidden: bot can't initiate conversation with a user");
        err.code = "ETELEGRAM";
        err.response = { body: { error_code: 403 } };
        throw err;
      }
      const record = { message_id: this.nextMessageId++, chat: { id: numericId }, chatId: numericId, text: String(text), options };
      this.messages.push(record);
      return record;
    }
    async editMessageText(text, options = {}) { this.edits.push({ text: String(text), options }); return { ok: true }; }
    async answerCallbackQuery(id, options = {}) { this.callbackAnswers.push({ id, options }); return true; }
    async getChatMemberCount(chatId) { return this.memberCountByChat.get(String(chatId)) ?? 100; }
    async getChatMember(chatId, userId) {
      const key = `${chatId}:${userId}`;
      return this.chatMembers.get(key) ?? { status: "administrator", can_post_messages: true };
    }
    async getChat(chatId) {
      return this.chats.get(String(chatId)) ?? {
        id: Number(chatId), title: `Chat ${chatId}`, username: null,
        type: String(chatId).startsWith("-100") ? "channel" : "supergroup"
      };
    }
    async stopPolling() { this.pollingStopped = true; return true; }
  }

  const dbImpl = {
    ensureFile: async (filePath, defaultValue) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try { await fs.access(filePath); } catch {
        await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
      }
    },
    loadJSON: async (filePath, fallback) => {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw || "null") ?? fallback;
      } catch { return fallback; }
    },
    saveJSON: async (filePath, data) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
    }
  };

  const intervals = new Set();
  const fakeProcess = {
    env: process.env,
    on: () => {},
    exit: () => {},
    cwd: () => projectRoot
  };

  const sandbox = {
    console, Buffer, setTimeout, clearTimeout,
    setInterval: (fn, ms, ...args) => { const id = setInterval(fn, ms, ...args); intervals.add(id); return id; },
    clearInterval: (id) => { intervals.delete(id); clearInterval(id); },
    process: fakeProcess,
    require: (mod) => {
      if (mod === "./config") return testConfig;
      if (mod === "./db") return dbImpl;
      if (mod === "node-telegram-bot-api") return FakeTelegramBot;
      return require(mod);
    }
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: botPath });

  if (sandbox.__setupPromise) await sandbox.__setupPromise;
  if (sandbox.__setupError) throw sandbox.__setupError;

  const bot = FakeTelegramBot.instance;
  if (!bot) throw new Error("Fake bot instance tidak dibuat");

  const users = {
    admin: { id: 9002, first_name: "Admin", username: "admin" },
    regular: { id: 7001, first_name: "User", username: "user" }
  };

  const cmdCooldownByUser = new Map();
  async function emitMessage({ from, chat, text }) {
    await bot.emit("message", { message_id: Date.now(), date: Math.floor(Date.now() / 1000), from, chat, text });
  }
  async function sendCommand(fromUser, text, chatType = "private", chatId = fromUser.id) {
    const waitMs = Math.max(0, 1300 - (Date.now() - (cmdCooldownByUser.get(fromUser.id) || 0)));
    if (waitMs > 0) await sleep(waitMs);
    cmdCooldownByUser.set(fromUser.id, Date.now());
    await emitMessage({ from: { id: fromUser.id, first_name: fromUser.first_name, username: fromUser.username }, chat: { id: chatId, type: chatType }, text });
    await sleep(30);
  }
  async function sendText(fromUser, text, chatType = "private", chatId = fromUser.id) {
    await emitMessage({ from: { id: fromUser.id, first_name: fromUser.first_name, username: fromUser.username }, chat: { id: chatId, type: chatType }, text });
    await sleep(30);
  }
  async function sendCallback(fromUser, data, chatId = fromUser.id) {
    await bot.emit("callback_query", {
      id: `cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      from: { id: fromUser.id, first_name: fromUser.first_name, username: fromUser.username },
      data, message: { message_id: 999, chat: { id: chatId, type: "private" } }
    });
    await sleep(30);
  }
  async function captureChatMessages(chatId, action) {
    const before = bot.messages.length;
    await action();
    await sleep(30);
    return bot.messages.slice(before).filter((m) => Number(m.chatId) === Number(chatId));
  }
  function texts(msgs) { return msgs.map((m) => m.text).join("\n---\n"); }

  const results = [];
  function check(name, condition, detail = "") {
    results.push({ name, pass: !!condition, detail });
  }

  // /start regular
  const startRegular = await captureChatMessages(users.regular.id, () => sendCommand(users.regular, "/start"));
  check("/start regular auto receive promo", texts(startRegular).includes("otomatis masuk daftar penerima promo"), texts(startRegular));

  // /status regular ON
  const statusRegular1 = await captureChatMessages(users.regular.id, () => sendCommand(users.regular, "/status"));
  check("/status regular shows receive promo ON", texts(statusRegular1).includes("Terima promo: Ya"), texts(statusRegular1));

  // /start admin
  const startAdmin = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/start"));
  check("/start admin sees custom toggle info",
    texts(startAdmin).includes("/receivepromo_on") && texts(startAdmin).includes("/receivepromo_off"),
    texts(startAdmin));

  // /receivepromo_off self regular -> blocked
  const offSelfRegular = await captureChatMessages(users.regular.id, () => sendCommand(users.regular, "/receivepromo_off"));
  check("/receivepromo_off self regular blocked",
    texts(offSelfRegular).toLowerCase().includes("tidak punya opsi manual"),
    texts(offSelfRegular));

  // admin OFF target regular
  const offTargetByAdmin = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/receivepromo_off 7001"));
  check("/receivepromo_off admin target user",
    texts(offTargetByAdmin).includes("user 7001 dinonaktifkan"),
    texts(offTargetByAdmin));

  // /status regular -> OFF
  const statusRegular2 = await captureChatMessages(users.regular.id, () => sendCommand(users.regular, "/status"));
  check("/status regular shows receive promo OFF after admin off",
    texts(statusRegular2).includes("Terima promo: Tidak"),
    texts(statusRegular2));

  // admin ON target regular
  const onTargetByAdmin = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/receivepromo_on 7001"));
  check("/receivepromo_on admin target user",
    texts(onTargetByAdmin).includes("user 7001 diaktifkan"),
    texts(onTargetByAdmin));

  // set trial params so bar trial = 1 target, 30 member, 50 subs
  const setDuration = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/settrialduration 2h"));
  check("/settrialduration", texts(setDuration).includes("Durasi Trial Basic di-set ke 2h"), texts(setDuration));

  const setLimit = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/settriallimit 5"));
  check("/settriallimit", texts(setLimit).includes("Limit promo Trial Basic di-set ke 5"), texts(setLimit));

  const setTarget = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/settrialtarget 1"));
  check("/settrialtarget", texts(setTarget).includes("Required target Trial Basic di-set ke 1"), texts(setTarget));

  const setMinGroup = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/setmingroupmembers 10"));
  check("/setmingroupmembers", texts(setMinGroup).includes("Min member grup Trial Basic di-set ke 10"), texts(setMinGroup));

  const setMinChannel = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/setminchannelsubs 20"));
  check("/setminchannelsubs", texts(setMinChannel).includes("Min subscriber channel Trial Basic di-set ke 20"), texts(setMinChannel));

  // /trialprogress before
  const progressBefore = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/trialprogress 7001"));
  check("/trialprogress before valid targets", texts(progressBefore).includes("Progress target: 0/1"), texts(progressBefore));

  // Simulate bot added to valid group -> should auto-activate trial (required 1, default member 100 > 10)
  const beforeActivation = bot.messages.length;
  await bot.emit("my_chat_member", {
    from: { id: users.regular.id, first_name: users.regular.first_name, username: users.regular.username },
    chat: { id: -2001, type: "supergroup", title: "Smoke Group" },
    old_chat_member: { status: "left" },
    new_chat_member: { status: "administrator" }
  });
  await sleep(120);
  const newMsgs = bot.messages.slice(beforeActivation);
  const activationMsgs = newMsgs.filter((m) => Number(m.chatId) === users.regular.id);
  check("auto trial activation after valid target", texts(activationMsgs).includes("Trial Basic aktif"), texts(activationMsgs));

  // Silent join: TIDAK ADA pesan yang dikirim ke chat group (-2001).
  const groupChatMessages = newMsgs.filter((m) => Number(m.chatId) === -2001);
  check("silent join: tidak ada pesan ke grup",
    groupChatMessages.length === 0,
    `Ditemukan ${groupChatMessages.length} pesan ke grup: ${texts(groupChatMessages)}`);

  // Inviter (regular) menerima notifikasi private hasil deteksi.
  check("inviter terima notifikasi private join",
    texts(activationMsgs).includes("Bot berhasil ditambahkan ke grup") &&
      texts(activationMsgs).includes("Status Trial:") &&
      texts(activationMsgs).includes("-2001"),
    texts(activationMsgs));

  // /trial regular after
  const trialRegular = await captureChatMessages(users.regular.id, () => sendCommand(users.regular, "/trial"));
  check("/trial regular after activation",
    texts(trialRegular).includes("Progress total: 1/1") && texts(trialRegular).includes("sudah pernah dipakai"),
    texts(trialRegular));

  // /trialprogress after
  const progressAfter = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/trialprogress 7001"));
  check("/trialprogress after activation",
    texts(progressAfter).includes("Trial aktif: Ya") && texts(progressAfter).includes("Progress target: 1/1"),
    texts(progressAfter));

  // /buatpromo flow
  const startPromo = await captureChatMessages(users.regular.id, () => sendCommand(users.regular, "/buatpromo"));
  check("/buatpromo starts flow", texts(startPromo).includes("Flow promosi dimulai"), texts(startPromo));

  const promoTitle = await captureChatMessages(users.regular.id, () => sendText(users.regular, "Judul Promo Smoke"));
  check("promo step title -> body", texts(promoTitle).includes("Masukkan isi promosi"), texts(promoTitle));

  const promoBody = await captureChatMessages(users.regular.id, () => sendText(users.regular, "Isi promo smoke"));
  // Trial Basic group-only: prompt menyebut "Trial Basic hanya bisa kirim ke grup".
  check("promo step body -> target (trial group-only prompt)",
    texts(promoBody).includes("Pilih target promosi") && texts(promoBody).includes("Trial Basic hanya bisa kirim ke grup"),
    texts(promoBody));

  // Tombol callback untuk channel/user/all WAJIB diblokir untuk Trial Basic.
  const targetChannelDenied = await captureChatMessages(users.regular.id, () => sendCallback(users.regular, "promo_target_channel"));
  check("promo callback target channel ditolak Trial Basic",
    texts(targetChannelDenied).includes("Trial Basic hanya bisa mengirim promosi ke grup"),
    texts(targetChannelDenied));

  const targetUserDenied = await captureChatMessages(users.regular.id, () => sendCallback(users.regular, "promo_target_user"));
  check("promo callback target user ditolak Trial Basic",
    texts(targetUserDenied).includes("Trial Basic hanya bisa mengirim promosi ke grup"),
    texts(targetUserDenied));

  const targetAllDenied = await captureChatMessages(users.regular.id, () => sendCallback(users.regular, "promo_target_all"));
  check("promo callback target all ditolak Trial Basic",
    texts(targetAllDenied).includes("Trial Basic hanya bisa mengirim promosi ke grup"),
    texts(targetAllDenied));

  const targetGroupOk = await captureChatMessages(users.regular.id, () => sendCallback(users.regular, "promo_target_group"));
  check("promo callback target group accepted",
    texts(targetGroupOk).includes("Konfirmasi promosi:") && texts(targetGroupOk).includes("Target: Grup"),
    texts(targetGroupOk));

  const confirmSend = await captureChatMessages(users.regular.id, () => sendCallback(users.regular, "promo_confirm_send"));
  check("promo confirm send queued", texts(confirmSend).includes("Promosi masuk antrian"), texts(confirmSend));

  // ==========================================================================
  // PRIVILEGE PROTECTION (owner/admin)
  // ==========================================================================

  // /ban admin -> ditolak
  const banAdmin = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/ban 9001 spam"));
  check("/ban owner ditolak",
    texts(banAdmin).includes("Tidak bisa memban owner/admin"),
    texts(banAdmin));

  const banAnotherAdmin = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/ban 9002 spam"));
  check("/ban admin lain ditolak",
    texts(banAnotherAdmin).includes("Tidak bisa memban owner/admin"),
    texts(banAnotherAdmin));

  // /warn admin -> ditolak
  const warnAdmin = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/warn 9001 test"));
  check("/warn owner ditolak",
    texts(warnAdmin).includes("Tidak bisa memban owner/admin"),
    texts(warnAdmin));

  // /ban user biasa -> berhasil, lalu /unban
  const banRegular = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/ban 7001 testing"));
  check("/ban user biasa berhasil",
    texts(banRegular).includes("berhasil diban"),
    texts(banRegular));

  const unbanRegular = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/unban 7001"));
  check("/unban user biasa berhasil",
    texts(unbanRegular).includes("berhasil di-unban"),
    texts(unbanRegular));

  // Admin /buatpromo dengan kata banned -> tetap masuk antrian (filter di-bypass)
  const adminPromoStart = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/buatpromo"));
  check("admin /buatpromo starts flow", texts(adminPromoStart).includes("Flow promosi dimulai"), texts(adminPromoStart));

  const adminPromoTitle = await captureChatMessages(users.admin.id, () => sendText(users.admin, "Judul Admin"));
  check("admin promo title -> body", texts(adminPromoTitle).includes("Masukkan isi promosi"), texts(adminPromoTitle));

  const adminPromoBody = await captureChatMessages(users.admin.id, () => sendText(users.admin, "Promo dengan kata judi yang biasanya difilter"));
  check("admin promo body -> target", texts(adminPromoBody).includes("Pilih target promosi"), texts(adminPromoBody));

  const adminTargetAll = await captureChatMessages(users.admin.id, () => sendCallback(users.admin, "promo_target_all"));
  check("admin target all accepted",
    texts(adminTargetAll).includes("Konfirmasi promosi"),
    texts(adminTargetAll));

  const adminConfirm = await captureChatMessages(users.admin.id, () => sendCallback(users.admin, "promo_confirm_send"));
  check("admin promo banned-word bypass + queued",
    texts(adminConfirm).includes("Promosi masuk antrian"),
    texts(adminConfirm));

  // Rate limit: kirim dua /status berturut-turut tanpa cooldown -> admin tidak terkena rate limit
  const adminStatus1 = await captureChatMessages(users.admin.id, () => sendText(users.admin, "/status"));
  const adminStatus2 = await captureChatMessages(users.admin.id, () => sendText(users.admin, "/status"));
  check("admin tidak terkena rate limit",
    texts(adminStatus1).includes("Status") && texts(adminStatus2).includes("Status") &&
      !texts(adminStatus2).includes("Terlalu cepat"),
    `s1=${texts(adminStatus1)} | s2=${texts(adminStatus2)}`);

  // ==========================================================================
  // PENDING NOTIFICATIONS (inviter belum /start)
  // ==========================================================================
  const pendingInviter = { id: 7102, first_name: "Pending", username: "pending" };
  // Paksa private message ke pendingInviter gagal -> simulate Telegram 403.
  bot.failPrivateForUserIds.add(pendingInviter.id);

  const beforePending = bot.messages.length;
  await bot.emit("my_chat_member", {
    from: { id: pendingInviter.id, first_name: pendingInviter.first_name, username: pendingInviter.username },
    chat: { id: -2050, type: "supergroup", title: "Pending Smoke Group" },
    old_chat_member: { status: "left" },
    new_chat_member: { status: "administrator" }
  });
  await sleep(120);
  const pendingPhaseMsgs = bot.messages.slice(beforePending);
  const messagesToPendingPrivate = pendingPhaseMsgs.filter((m) => Number(m.chatId) === pendingInviter.id);
  const messagesToPendingGroup = pendingPhaseMsgs.filter((m) => Number(m.chatId) === -2050);
  check("pending: tidak ada pesan terkirim ke private inviter (gagal)",
    messagesToPendingPrivate.length === 0,
    `pending private msgs: ${texts(messagesToPendingPrivate)}`);
  check("pending: tidak ada fallback ke grup",
    messagesToPendingGroup.length === 0,
    `pending group msgs: ${texts(messagesToPendingGroup)}`);

  // Sekarang user /start -> notifikasi pending harus muncul.
  bot.failPrivateForUserIds.delete(pendingInviter.id);
  const pendingStart = await captureChatMessages(pendingInviter.id, () => sendCommand(pendingInviter, "/start"));
  check("pending notification flush saat /start",
    texts(pendingStart).includes("Notifikasi tertunda") &&
      texts(pendingStart).includes("Bot berhasil ditambahkan ke grup") &&
      texts(pendingStart).includes("-2050"),
    texts(pendingStart));

  // ==========================================================================
  // ADMIN COMMANDS BARU: /importgroup, /syncgroups, /recentjoins, /pendingnotifications
  // ==========================================================================
  const importGroup = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/importgroup -2099 Imported Smoke"));
  check("/importgroup berhasil",
    texts(importGroup).includes("Import Grup") && texts(importGroup).includes("-2099"),
    texts(importGroup));

  const importChannel = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/importchannel -1009999 Imported Channel"));
  check("/importchannel berhasil",
    texts(importChannel).includes("Import Channel") && texts(importChannel).includes("-1009999"),
    texts(importChannel));

  const syncGroups = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/syncgroups"));
  check("/syncgroups menampilkan ringkasan",
    texts(syncGroups).includes("syncgroups selesai") && texts(syncGroups).includes("Grup:"),
    texts(syncGroups));

  const syncChats = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/syncchats"));
  check("/syncchats menampilkan ringkasan grup+channel",
    texts(syncChats).includes("syncchats selesai") && texts(syncChats).includes("Channel:"),
    texts(syncChats));

  const recentJoins = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/recentjoins"));
  check("/recentjoins menampilkan grup terdeteksi",
    texts(recentJoins).includes("Recent Groups") && texts(recentJoins).includes("-2001"),
    texts(recentJoins));

  // /pendingnotifications setelah flush harus 0
  const pendingList = await captureChatMessages(users.admin.id, () => sendCommand(users.admin, "/pendingnotifications"));
  check("/pendingnotifications setelah flush kosong",
    texts(pendingList).includes("Total notifikasi pending: 0"),
    texts(pendingList));

  await sleep(150);
  for (const id of Array.from(intervals)) { clearInterval(id); intervals.delete(id); }
  if (bot && typeof bot.stopPolling === "function") await bot.stopPolling();

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  console.log("=== SMOKE TEST RESULT ===");
  console.log(`Total: ${results.length} | PASS: ${passCount} | FAIL: ${failCount}`);
  for (const r of results) {
    console.log(`- [${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    if (!r.pass && r.detail) {
      console.log(`  Detail: ${String(r.detail).replace(/\n/g, " | ").slice(0, 500)}`);
    }
  }
  if (failCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Smoke test gagal:", error);
  process.exit(1);
});
