const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const TelegramBot = require("node-telegram-bot-api");

const config = require("./config");
const { ensureFile, loadJSON, saveJSON } = require("./db");

/**
 * ============================================================================
 * Config accessor helpers
 * ----------------------------------------------------------------------------
 * Semua setting default berasal dari `config.js`. Admin dapat menimpa nilai
 * tertentu via command bot; override disimpan di `state.settings` (file
 * `data/settings.json`). Helper di bawah menyediakan akses terpadu:
 *   - getConfigValue(path, fallback)        baca dari config.js
 *   - getSetting(path, fallback)            baca override runtime (settings.json)
 *                                           fallback ke config.js lalu default
 *   - updateSetting(path, value)            tulis override ke settings.json
 *   - loadRuntimeSettings()                 kembalikan snapshot settings.json
 *   - mergeConfigWithRuntimeSettings()      gabungan efektif (config <- override)
 * ============================================================================
 */
function getByPath(source, dottedPath) {
  if (!source || !dottedPath) return undefined;
  const parts = String(dottedPath).split(".");
  let cursor = source;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setByPath(target, dottedPath, value) {
  if (!target || !dottedPath) return target;
  const parts = String(dottedPath).split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (cursor[key] === null || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
  return target;
}

function getConfigValue(dottedPath, fallback) {
  const value = getByPath(config, dottedPath);
  return value === undefined ? fallback : value;
}

function loadRuntimeSettings() {
  try {
    return (state && state.settings) ? state.settings : {};
  } catch {
    return {};
  }
}

function getSetting(dottedPath, fallback) {
  const override = getByPath(loadRuntimeSettings(), dottedPath);
  if (override !== undefined) return override;
  const fromConfig = getByPath(config, dottedPath);
  if (fromConfig !== undefined) return fromConfig;
  return fallback;
}

function updateSetting(dottedPath, value) {
  if (!state || !state.settings) return false;
  setByPath(state.settings, dottedPath, value);
  markDirty("settings");
  return true;
}

function mergeConfigWithRuntimeSettings() {
  const runtime = loadRuntimeSettings();
  return {
    ...config,
    ...runtime
  };
}

const DATA_DIR = path.resolve(getConfigValue("DATABASE.PATH", getConfigValue("DATABASE_PATH", "./data")));
const DB_FILENAMES = getConfigValue("DATABASE.FILES", {
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
});
const FILES = {
  users: path.join(DATA_DIR, DB_FILENAMES.USERS || "users.json"),
  groups: path.join(DATA_DIR, DB_FILENAMES.GROUPS || "groups.json"),
  channels: path.join(DATA_DIR, DB_FILENAMES.CHANNELS || "channels.json"),
  vouchers: path.join(DATA_DIR, DB_FILENAMES.VOUCHERS || "vouchers.json"),
  packages: path.join(DATA_DIR, DB_FILENAMES.PACKAGES || "packages.json"),
  promotions: path.join(DATA_DIR, DB_FILENAMES.PROMOTIONS || "promotions.json"),
  logs: path.join(DATA_DIR, DB_FILENAMES.LOGS || "logs.json"),
  pendingGroups: path.join(DATA_DIR, DB_FILENAMES.PENDING_GROUPS || "pending_groups.json"),
  pendingNotifications: path.join(
    DATA_DIR,
    DB_FILENAMES.PENDING_NOTIFICATIONS || "pending_notifications.json"
  ),
  sessions: path.join(DATA_DIR, DB_FILENAMES.SESSIONS || "sessions.json"),
  settings: path.join(DATA_DIR, DB_FILENAMES.SETTINGS || "settings.json")
};

const BACKUP_DIR = path.resolve(getConfigValue("MAINTENANCE.BACKUP_PATH", path.join(DATA_DIR, "backups")));

const DEFAULT_TRIAL_DURATION =
  getConfigValue("TRIAL.DEFAULT_DURATION", getConfigValue("PACKAGES.TRIAL.DURATION", "1h"));
const COMMAND_RATE_LIMIT_MS = Number(getConfigValue("SECURITY.COMMAND_COOLDOWN_MS", 1200)) || 1200;
const FLUSH_INTERVAL_MS = Number(getConfigValue("DATABASE.FLUSH_INTERVAL_MS", 5000)) || 5000;
const EXPIRE_SWEEP_INTERVAL_MS =
  Number(getConfigValue("MAINTENANCE.PACKAGE_SWEEP_INTERVAL_MS", 10 * 60 * 1000)) || 10 * 60 * 1000;
const MAX_LOG_ENTRIES =
  Number(getConfigValue("LIMITS.MAX_LOG_ENTRIES_STORED", 20000)) || 20000;
const MAX_PROMOTION_ENTRIES =
  Number(getConfigValue("LIMITS.MAX_PROMOTION_ENTRIES_STORED", 5000)) || 5000;

const ADMIN_SET = new Set((config.ADMINS || []).map((id) => String(id)));

const CONFIG_TRIAL_DURATION = String(
  getConfigValue(
    "TRIAL.DEFAULT_DURATION",
    getConfigValue("PACKAGES.TRIAL.DURATION", DEFAULT_TRIAL_DURATION)
  )
);
const CONFIG_TRIAL_PROMO_LIMIT = Number(
  getConfigValue(
    "TRIAL.DEFAULT_PROMO_LIMIT",
    getConfigValue("PACKAGES.TRIAL.PROMO_LIMIT", 3)
  )
) || 3;
const CONFIG_TRIAL_REQUIRED_TARGETS = Number(
  getConfigValue(
    "TRIAL.REQUIRED_VALID_TARGETS",
    getConfigValue(
      "PACKAGES.TRIAL.REQUIRED_TARGETS",
      getConfigValue("REQUIRED_TRIAL_GROUPS", 3)
    )
  )
) || 3;
const CONFIG_TRIAL_MIN_GROUP = Number(
  getConfigValue(
    "TRIAL.MIN_GROUP_MEMBERS_EXCLUDING_BOT",
    getConfigValue(
      "PACKAGES.TRIAL.MIN_GROUP_MEMBERS_EXCLUDING_BOT",
      getConfigValue("MIN_GROUP_MEMBER_FOR_TRIAL", 30)
    )
  )
) || 30;
const CONFIG_TRIAL_MIN_CHANNEL = Number(
  getConfigValue(
    "TRIAL.MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT",
    getConfigValue(
      "PACKAGES.TRIAL.MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT",
      getConfigValue("MIN_CHANNEL_SUBSCRIBER_FOR_TRIAL", 50)
    )
  )
) || 50;

const DEFAULT_PACKAGES = {
  trial: {
    name: getConfigValue("PACKAGES.TRIAL.NAME", "Trial Basic"),
    can_share_group: !!getConfigValue("PACKAGES.TRIAL.CAN_SHARE_GROUP", true),
    can_share_channel: !!getConfigValue("PACKAGES.TRIAL.CAN_SHARE_CHANNEL", true),
    can_share_user: !!getConfigValue("PACKAGES.TRIAL.CAN_SHARE_USER", false),
    can_share_all: !!getConfigValue("PACKAGES.TRIAL.CAN_SHARE_ALL", false),
    duration: CONFIG_TRIAL_DURATION,
    delay_seconds:
      Number(
        getConfigValue(
          "PACKAGES.TRIAL.DELAY_SECONDS",
          getConfigValue("DEFAULT_DELAYS.trial", 60)
        )
      ) || 60,
    daily_limit:
      Number(
        getConfigValue(
          "SECURITY.MAX_PROMO_PER_USER_PER_DAY_TRIAL",
          getConfigValue("SECURITY.MAX_PROMO_PER_DAY_TRIAL", CONFIG_TRIAL_PROMO_LIMIT)
        )
      ) || CONFIG_TRIAL_PROMO_LIMIT,
    enabled: !!getConfigValue("PACKAGES.TRIAL.ENABLED", true),
    default_duration: CONFIG_TRIAL_DURATION,
    promo_limit: CONFIG_TRIAL_PROMO_LIMIT,
    required_targets: CONFIG_TRIAL_REQUIRED_TARGETS,
    min_group_members: CONFIG_TRIAL_MIN_GROUP,
    min_channel_subscribers: CONFIG_TRIAL_MIN_CHANNEL,
    only_once: !!getConfigValue("PACKAGES.TRIAL.ONLY_ONCE", true)
  },
  pro: {
    name: getConfigValue("PACKAGES.PRO.NAME", "Pro"),
    can_share_group: !!getConfigValue("PACKAGES.PRO.CAN_SHARE_GROUP", true),
    can_share_channel: !!getConfigValue("PACKAGES.PRO.CAN_SHARE_CHANNEL", true),
    can_share_user: !!getConfigValue("PACKAGES.PRO.CAN_SHARE_USER", false),
    can_share_all: !!getConfigValue("PACKAGES.PRO.CAN_SHARE_ALL", false),
    delay_seconds:
      Number(
        getConfigValue(
          "PACKAGES.PRO.DELAY_SECONDS",
          getConfigValue("DEFAULT_DELAYS.pro", 30)
        )
      ) || 30,
    daily_limit:
      Number(
        getConfigValue(
          "PACKAGES.PRO.DAILY_LIMIT",
          getConfigValue(
            "SECURITY.MAX_PROMO_PER_USER_PER_DAY_PRO",
            getConfigValue("SECURITY.MAX_PROMO_PER_DAY_PRO", 20)
          )
        )
      ) || 20,
    enabled: !!getConfigValue("PACKAGES.PRO.ENABLED", true)
  },
  vip: {
    name: getConfigValue("PACKAGES.VIP.NAME", "VIP"),
    can_share_group: !!getConfigValue("PACKAGES.VIP.CAN_SHARE_GROUP", true),
    can_share_channel: !!getConfigValue("PACKAGES.VIP.CAN_SHARE_CHANNEL", true),
    can_share_user: !!getConfigValue("PACKAGES.VIP.CAN_SHARE_USER", true),
    can_share_all: !!getConfigValue("PACKAGES.VIP.CAN_SHARE_ALL", true),
    delay_seconds:
      Number(
        getConfigValue(
          "PACKAGES.VIP.DELAY_SECONDS",
          getConfigValue("DEFAULT_DELAYS.vip", 15)
        )
      ) || 15,
    daily_limit:
      Number(
        getConfigValue(
          "PACKAGES.VIP.DAILY_LIMIT",
          getConfigValue(
            "SECURITY.MAX_PROMO_PER_USER_PER_DAY_VIP",
            getConfigValue("SECURITY.MAX_PROMO_PER_DAY_VIP", 50)
          )
        )
      ) || 50,
    enabled: !!getConfigValue("PACKAGES.VIP.ENABLED", true)
  }
};

const DEFAULT_SETTINGS = {
  trial_settings: {
    duration: CONFIG_TRIAL_DURATION,
    promo_limit: CONFIG_TRIAL_PROMO_LIMIT,
    required_targets: CONFIG_TRIAL_REQUIRED_TARGETS,
    min_group_members: CONFIG_TRIAL_MIN_GROUP,
    min_channel_subscribers: CONFIG_TRIAL_MIN_CHANNEL
  },
  trial: {
    required_target_count: CONFIG_TRIAL_REQUIRED_TARGETS,
    min_group_members: CONFIG_TRIAL_MIN_GROUP,
    min_channel_subscribers: CONFIG_TRIAL_MIN_CHANNEL,
    default_duration: CONFIG_TRIAL_DURATION,
    promo_limit: CONFIG_TRIAL_PROMO_LIMIT
  },
  moderation: {
    max_warning:
      Number(getConfigValue("SECURITY.MAX_WARNING_BEFORE_BAN", 3)) || 3,
    max_promo_length:
      Number(
        getConfigValue(
          "LIMITS.MAX_PROMO_TEXT_LENGTH",
          getConfigValue(
            "SECURITY.MAX_PROMO_TEXT_LENGTH",
            getConfigValue("BROADCAST.MAX_MESSAGE_LENGTH", 3500)
          )
        )
      ) || 3500,
    max_url_buttons:
      Number(getConfigValue("PROMOTION.MAX_URL_BUTTONS", 1)) || 1,
    banned_words: [
      ...(Array.isArray(getConfigValue("SECURITY.BANNED_WORDS", null))
        ? getConfigValue("SECURITY.BANNED_WORDS", [])
        : ["judi", "slot", "bokep", "scam"])
    ]
  },
  sessions: {
    ttl_seconds: Math.max(
      60,
      Math.floor(
        Number(getConfigValue("SESSIONS.EXPIRE_AFTER_MS", 15 * 60 * 1000)) / 1000
      ) || 15 * 60
    )
  }
};

const PRIVATE_ONLY_COMMANDS = new Set([
  "start",
  "help",
  "profile",
  "trial",
  "promo",
  "redeem",
  "optin",
  "optout",
  "receivepromo_on",
  "receivepromo_off",
  "buatpromo",
  "sharegrup",
  "sharechannel",
  "sharetarget",
  "shareuser",
  "shareall",
  "status",
  "mygroups",
  "mychannels",
  "mytargets",
  "claimchannel",
  "admin",
  "stats",
  "todaystats",
  "botstatus",
  "healthcheck",
  "users",
  "user",
  "searchuser",
  "ban",
  "unban",
  "warn",
  "warnings",
  "resetwarn",
  "setpackage",
  "extend",
  "removeaccess",
  "resetlimit",
  "resetcooldown",
  "setrole",
  "removeadmin",
  "noteuser",
  "userlogs",
  "createvoucher",
  "createcustomvoucher",
  "vouchers",
  "voucher",
  "deletevoucher",
  "disablevoucher",
  "enablevoucher",
  "unusedvouchers",
  "usedvouchers",
  "exportvouchers",
  "packages",
  "setdelay",
  "setlimit",
  "settrialduration",
  "settriallimit",
  "settrialtarget",
  "setmingroupmembers",
  "setminchannelsubs",
  "setmintrialmembers",
  "setmintrialsubs",
  "setrequiredtrialtarget",
  "assigntrialtarget",
  "trialprogress",
  "resettrialprogress",
  "forcetrial",
  "removetrial",
  "enablepackage",
  "disablepackage",
  "broadcast",
  "broadcastuser",
  "broadcastgroup",
  "broadcastchannel",
  "broadcasttarget",
  "broadcastall",
  "cancelbroadcast",
  "groups",
  "group",
  "groupinfo",
  "removegroup",
  "enablegroup",
  "disablegroup",
  "checkgroup",
  "refreshgroups",
  "blacklistgroup",
  "unblacklistgroup",
  "cleargroups",
  "channels",
  "channel",
  "activechannels",
  "inactivechannels",
  "validchannels",
  "invalidchannels",
  "removechannel",
  "enablechannel",
  "disablechannel",
  "checkchannel",
  "refreshchannels",
  "blacklistchannel",
  "unblacklistchannel",
  "clearchannels",
  "logs",
  "errorlogs",
  "promologs",
  "adminlogs",
  "clearlogs",
  "exportlogs",
  "backup",
  "restore",
  "exportdb",
  "cleancache",
  "repairdb",
  "reloadconfig",
  "shutdown",
  "restartinfo",
  "activegroups",
  "inactivegroups",
  "addgrouplink",
  "cancel"
]);

const ADMIN_COMMANDS = new Set([
  "admin",
  "stats",
  "todaystats",
  "botstatus",
  "healthcheck",
  "users",
  "user",
  "searchuser",
  "ban",
  "unban",
  "warn",
  "warnings",
  "resetwarn",
  "setpackage",
  "extend",
  "removeaccess",
  "resetlimit",
  "resetcooldown",
  "setrole",
  "removeadmin",
  "noteuser",
  "userlogs",
  "createvoucher",
  "createcustomvoucher",
  "vouchers",
  "voucher",
  "deletevoucher",
  "disablevoucher",
  "enablevoucher",
  "unusedvouchers",
  "usedvouchers",
  "exportvouchers",
  "packages",
  "setdelay",
  "setlimit",
  "settrialduration",
  "settriallimit",
  "settrialtarget",
  "setmingroupmembers",
  "setminchannelsubs",
  "setmintrialmembers",
  "setmintrialsubs",
  "setrequiredtrialtarget",
  "assigntrialtarget",
  "trialprogress",
  "resettrialprogress",
  "forcetrial",
  "removetrial",
  "enablepackage",
  "disablepackage",
  "broadcast",
  "broadcastuser",
  "broadcastgroup",
  "broadcastchannel",
  "broadcasttarget",
  "broadcastall",
  "cancelbroadcast",
  "groups",
  "group",
  "groupinfo",
  "removegroup",
  "enablegroup",
  "disablegroup",
  "checkgroup",
  "refreshgroups",
  "blacklistgroup",
  "unblacklistgroup",
  "cleargroups",
  "channels",
  "channel",
  "activechannels",
  "inactivechannels",
  "validchannels",
  "invalidchannels",
  "removechannel",
  "enablechannel",
  "disablechannel",
  "checkchannel",
  "refreshchannels",
  "blacklistchannel",
  "unblacklistchannel",
  "clearchannels",
  "logs",
  "errorlogs",
  "promologs",
  "adminlogs",
  "clearlogs",
  "exportlogs",
  "backup",
  "restore",
  "exportdb",
  "cleancache",
  "repairdb",
  "reloadconfig",
  "shutdown",
  "restartinfo",
  "activegroups",
  "inactivegroups",
  "addgrouplink",
  // Silent join, startup sync, manual import
  "recentjoins",
  "recentgroups",
  "recentchannels",
  "pendingnotifications",
  "importgroup",
  "importchannel",
  "bulkimportgroups",
  "bulkimportchannels",
  "syncgroups",
  "syncchannels",
  "syncchats"
]);

const state = {
  users: {},
  groups: {},
  channels: {},
  vouchers: {},
  packages: {},
  promotions: [],
  logs: [],
  pendingGroups: [],
  pendingNotifications: {},
  sessions: {},
  settings: {}
};

const sessions = new Map();
const commandRate = new Map();
const dirty = new Set();
const promotionQueue = [];
let cancelBroadcastRequested = false;

let bot = null;
let botId = null;
let botUsername = null;
let isFlushing = false;
let isProcessingPromotionQueue = false;

function nowISO() {
  return new Date().toISOString();
}

function todayKey() {
  return nowISO().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markDirty(key) {
  dirty.add(key);
}

function isOwner(userId) {
  const ownerId = getConfigValue("OWNER.ID", getConfigValue("OWNER_ID", null));
  return String(userId) === String(ownerId);
}

function isAdmin(userId) {
  return isOwner(userId) || ADMIN_SET.has(String(userId));
}

function isPrivileged(userId) {
  return isOwner(userId) || isAdmin(userId);
}

function resolveRole(userId) {
  if (isOwner(userId)) return "owner";
  if (isAdmin(userId)) return "admin";
  return "user";
}

/**
 * Baca flag PRIVILEGES dari config untuk user tertentu.
 * Owner mengikuti `PRIVILEGES.OWNER.<flag>`, admin `PRIVILEGES.ADMIN.<flag>`.
 * User biasa selalu mendapat `false` (tidak ada hak istimewa).
 *
 * Flag default `true` agar bila admin/owner belum punya flag tertentu di
 * config, perilaku aman default-nya tetap "bypass" (sesuai kontrak: jangan
 * pernah membatasi owner/admin).
 */
function getPrivilegeFlag(userId, flag, defaultValue = true) {
  if (isOwner(userId)) {
    const value = getConfigValue(`PRIVILEGES.OWNER.${flag}`, defaultValue);
    return !!value;
  }
  if (isAdmin(userId)) {
    const value = getConfigValue(`PRIVILEGES.ADMIN.${flag}`, defaultValue);
    return !!value;
  }
  return false;
}

function parseCommand(text) {
  if (!text) return null;

  const match = text
    .trim()
    .match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);

  if (!match) return null;

  return {
    command: match[1].toLowerCase(),
    targetBot: match[2] ? match[2].toLowerCase() : null,
    argsText: (match[3] || "").trim()
  };
}

function parseDurationToMs(raw) {
  if (!raw) return null;

  const normalized = String(raw).trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*([smhdw])$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isFinite(amount) || amount <= 0) return null;

  switch (unit) {
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    case "w":
      return amount * 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function formatSeconds(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} detik`;

  const minutes = Math.floor(s / 60);
  const remainSeconds = s % 60;
  if (minutes < 60) {
    return remainSeconds > 0
      ? `${minutes} menit ${remainSeconds} detik`
      : `${minutes} menit`;
  }

  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours} jam ${remainMinutes} menit` : `${hours} jam`;
}

function formatPackageLabel(packageName) {
  const pkg = String(packageName || "free").toLowerCase();
  if (pkg === "owner") return "Owner";
  if (pkg === "trial") return "Trial Basic";
  if (pkg === "pro") return "Pro";
  if (pkg === "vip") return "VIP";
  return "Free";
}

function formatTargetLabel(target) {
  if (target === "group") return "Grup";
  if (target === "channel") return "Channel";
  if (target === "target") return "Grup + Channel";
  if (target === "user") return "User";
  if (target === "all") return "Semua";
  return String(target || "-");
}

function canUserCustomizeReceivePromo(user) {
  const role = String(user?.role || resolveRole(user?.id)).toLowerCase();
  return role === "owner" || role === "admin";
}

function getTrialSettingsSnapshot() {
  const trialSettings = ensureObject(state.settings?.trial_settings, {});
  const legacyTrial = ensureObject(state.settings?.trial, {});
  const trialPackage = ensureObject(state.packages?.trial, {});

  const duration =
    String(
      trialSettings.duration ||
        trialPackage.duration ||
        trialPackage.default_duration ||
        legacyTrial.default_duration ||
        DEFAULT_TRIAL_DURATION
    ).trim() || DEFAULT_TRIAL_DURATION;

  const promoLimit = Math.max(
    1,
    Number(
      trialSettings.promo_limit || trialPackage.promo_limit || trialPackage.daily_limit || legacyTrial.promo_limit || 3
    ) || 3
  );

  const requiredTargets = Math.max(
    1,
    Number(trialSettings.required_targets || trialPackage.required_targets || legacyTrial.required_target_count || 3) ||
      3
  );

  const minGroupMembers = Math.max(
    1,
    Number(trialSettings.min_group_members || trialPackage.min_group_members || legacyTrial.min_group_members || 30) || 30
  );

  const minChannelSubscribers = Math.max(
    1,
    Number(
      trialSettings.min_channel_subscribers ||
        trialPackage.min_channel_subscribers ||
        legacyTrial.min_channel_subscribers ||
        50
    ) || 50
  );

  return {
    duration,
    promo_limit: promoLimit,
    required_targets: requiredTargets,
    min_group_members: minGroupMembers,
    min_channel_subscribers: minChannelSubscribers
  };
}

function getTrialDuration() {
  return getTrialSettingsSnapshot().duration;
}

function getTrialPromoLimit() {
  return getTrialSettingsSnapshot().promo_limit;
}

function getTrialRequiredTargets() {
  return getTrialSettingsSnapshot().required_targets;
}

function getTrialRequiredGroups() {
  // Trial Basic group-only: setting runtime paling spesifik adalah
  // `trial_settings.required_groups`. Jika tidak ada, fallback ke
  // `required_targets` (yang juga di-tune via /settrialtarget).
  const fromSettings = Number(getSetting("trial_settings.required_groups", null));
  if (Number.isFinite(fromSettings) && fromSettings > 0) return fromSettings;
  return getTrialRequiredTargets();
}

function isTrialChannelCounted() {
  return !!getConfigValue(
    "TRIAL.CHANNEL_COUNT_FOR_TRIAL",
    getConfigValue("PACKAGES.TRIAL.CHANNEL_COUNT_FOR_TRIAL", false)
  );
}

function getTrialMinGroupMembers() {
  return getTrialSettingsSnapshot().min_group_members;
}

function getTrialMinChannelSubscribers() {
  return getTrialSettingsSnapshot().min_channel_subscribers;
}

// Hitung progress trial GROUP-ONLY untuk user. Channel tidak dihitung.
function computeUserTrialGroupProgress(userId) {
  const required = getTrialRequiredGroups();
  if (!userId) {
    return { valid_count: 0, required_count: required };
  }
  const user = state.users?.[String(userId)];
  ensureUserTrialState(user || {});
  const validGroups = ensureArray(user?.trial?.valid_groups, []).map(String);
  // Recompute langsung dari state.groups untuk akurasi.
  let validCount = 0;
  for (const gid of validGroups) {
    const g = state.groups?.[gid];
    if (g && g.is_active && g.is_valid_for_trial && !g.is_blacklisted) {
      validCount += 1;
    }
  }
  return { valid_count: validCount, required_count: required };
}

function ensureUserTrialState(user) {
  const base = ensureObject(user?.trial, {});
  const promoLimit = Number(base.promo_limit || getTrialPromoLimit());

  user.trial = {
    is_active: !!base.is_active,
    has_used_trial: !!base.has_used_trial,
    valid_targets: ensureArray(base.valid_targets, []).map((id) => String(id)),
    valid_groups: ensureArray(base.valid_groups, []).map((id) => String(id)),
    valid_channels: ensureArray(base.valid_channels, []).map((id) => String(id)),
    started_at: base.started_at || null,
    expired_at: base.expired_at || null,
    promo_used: Math.max(0, Number(base.promo_used || 0) || 0),
    promo_limit: Math.max(1, Number.isFinite(promoLimit) ? promoLimit : getTrialPromoLimit())
  };
}

function ensureUserReceivePromoState(user) {
  const canCustom = canUserCustomizeReceivePromo(user);
  user.can_custom_receive_promo = canCustom;

  // Jika nilai sudah pernah di-set (baik user custom atau admin override untuk
  // user biasa), jangan timpa. Hanya seed default saat pertama kali.
  if (typeof user.is_receive_promo !== "boolean") {
    if (canCustom) {
      user.is_receive_promo = !!user.is_opt_in;
    } else {
      user.is_receive_promo = !!user.has_started;
    }
  }

  user.is_opt_in = !!user.is_receive_promo;
}

function recomputeGroupReceivePromo(group) {
  group.can_receive_promo =
    !!group.is_active && !group.is_blacklisted && !(group.is_disabled_by_admin === true);
}

function recomputeChannelReceivePromo(channel) {
  channel.can_receive_promo =
    !!channel.is_active &&
    !!channel.bot_is_admin &&
    !!channel.can_post_messages &&
    !channel.is_blacklisted &&
    !(channel.is_disabled_by_admin === true);
}

function buildPromoMessage(title, body) {
  const max =
    Number(
      getSetting(
        "moderation.max_promo_length",
        getConfigValue(
          "LIMITS.MAX_PROMO_TEXT_LENGTH",
          getConfigValue("BROADCAST.MAX_MESSAGE_LENGTH", 3500)
        )
      )
    ) || 3500;
  const text = `📢 ${title}\n\n${body}`;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 18)}\n\n...(dipotong)`;
}

function randomId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function makeVoucherCode(length = 10) {
  let code = "";
  while (code.length < length) {
    code += crypto
      .randomBytes(8)
      .toString("base64")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
  }
  return code.slice(0, length);
}

function parseSharePayload(argsText) {
  const parts = String(argsText || "").split("|");
  if (parts.length < 2) return null;

  const title = parts.shift().trim();
  const body = parts.join("|").trim();

  if (!title || !body) return null;
  return { title, body };
}

function extractTelegramError(error) {
  const code = error?.response?.body?.error_code || error?.code || null;
  const description =
    error?.response?.body?.description || error?.message || "unknown_error";
  return {
    code,
    description: String(description)
  };
}

function splitByChunk(input, chunkSize) {
  const result = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    result.push(input.slice(i, i + chunkSize));
  }
  return result;
}

function ensureArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function normalizeStateShape() {
  state.users = ensureObject(state.users, {});
  state.groups = ensureObject(state.groups, {});
  state.channels = ensureObject(state.channels, {});
  state.vouchers = ensureObject(state.vouchers, {});
  state.packages = ensureObject(state.packages, {});
  state.promotions = ensureArray(state.promotions, []);
  state.logs = ensureArray(state.logs, []);
  state.pendingGroups = ensureArray(state.pendingGroups, []);
  state.pendingNotifications = ensureObject(state.pendingNotifications, {});
  state.sessions = ensureObject(state.sessions, {});
  state.settings = ensureObject(state.settings, {});

  state.packages = {
    ...DEFAULT_PACKAGES,
    ...state.packages,
    trial: {
      ...DEFAULT_PACKAGES.trial,
      ...(state.packages.trial || {})
    },
    pro: {
      ...DEFAULT_PACKAGES.pro,
      ...(state.packages.pro || {})
    },
    vip: {
      ...DEFAULT_PACKAGES.vip,
      ...(state.packages.vip || {})
    }
  };

  state.settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
    trial_settings: {
      ...DEFAULT_SETTINGS.trial_settings,
      ...(state.settings.trial_settings || {})
    },
    trial: {
      ...DEFAULT_SETTINGS.trial,
      ...(state.settings.trial || {})
    },
    moderation: {
      ...DEFAULT_SETTINGS.moderation,
      ...(state.settings.moderation || {})
    },
    sessions: {
      ...DEFAULT_SETTINGS.sessions,
      ...(state.settings.sessions || {})
    }
  };

  const trialSnapshot = getTrialSettingsSnapshot();
  state.settings.trial_settings = {
    ...state.settings.trial_settings,
    duration: trialSnapshot.duration,
    promo_limit: trialSnapshot.promo_limit,
    required_targets: trialSnapshot.required_targets,
    min_group_members: trialSnapshot.min_group_members,
    min_channel_subscribers: trialSnapshot.min_channel_subscribers
  };
  state.settings.trial = {
    ...state.settings.trial,
    required_target_count: trialSnapshot.required_targets,
    min_group_members: trialSnapshot.min_group_members,
    min_channel_subscribers: trialSnapshot.min_channel_subscribers,
    default_duration: trialSnapshot.duration,
    promo_limit: trialSnapshot.promo_limit
  };

  state.packages.trial = {
    ...state.packages.trial,
    default_duration: trialSnapshot.duration,
    duration: trialSnapshot.duration,
    daily_limit: trialSnapshot.promo_limit,
    promo_limit: trialSnapshot.promo_limit,
    required_targets: trialSnapshot.required_targets,
    min_group_members: trialSnapshot.min_group_members,
    min_channel_subscribers: trialSnapshot.min_channel_subscribers,
    only_once: true
  };

  for (const [userId, rawUser] of Object.entries(state.users)) {
    const baseUser = createDefaultUser(userId);
    const sourceUser = ensureObject(rawUser, {});
    const sourceTrial = ensureObject(sourceUser.trial, {});

    const normalizedUser = {
      ...baseUser,
      ...sourceUser,
      id: Number(userId),
      role: resolveRole(userId),
      package: String(sourceUser.package || baseUser.package).toLowerCase(),
      is_banned: !!sourceUser.is_banned,
      is_receive_promo:
        typeof sourceUser.is_receive_promo === "boolean"
          ? sourceUser.is_receive_promo
          : !!sourceUser.is_opt_in,
      can_custom_receive_promo: !!sourceUser.can_custom_receive_promo,
      is_opt_in: !!sourceUser.is_opt_in,
      has_started: !!sourceUser.has_started,
      warning_count: Number(sourceUser.warning_count || 0),
      warnings: ensureArray(sourceUser.warnings, []),
      notes: ensureArray(sourceUser.notes, []),
      daily_promo_count: Number(sourceUser.daily_promo_count || 0),
      trial: {
        ...baseUser.trial,
        ...sourceTrial,
        is_active: !!sourceTrial.is_active,
        has_used_trial: !!sourceTrial.has_used_trial,
        valid_targets: ensureArray(sourceTrial.valid_targets, []).map((id) => String(id)),
        valid_groups: ensureArray(sourceTrial.valid_groups, []).map((id) => String(id)),
        valid_channels: ensureArray(sourceTrial.valid_channels, []).map((id) => String(id)),
        promo_used: Math.max(0, Number(sourceTrial.promo_used || 0) || 0),
        promo_limit: Math.max(
          1,
          Number(sourceTrial.promo_limit || state.settings?.trial_settings?.promo_limit || 3) || 3
        )
      }
    };

    if (!["free", "trial", "pro", "vip", "owner"].includes(normalizedUser.package)) {
      normalizedUser.package = "free";
      normalizedUser.package_started_at = null;
      normalizedUser.package_expired_at = null;
      normalizedUser.trial.is_active = false;
    }

    if (normalizedUser.role === "owner") {
      normalizedUser.package = "owner";
      normalizedUser.package_started_at = null;
      normalizedUser.package_expired_at = null;
    } else if (normalizedUser.package === "owner") {
      normalizedUser.package = "free";
    }

    ensureUserTrialState(normalizedUser);
    ensureUserReceivePromoState(normalizedUser);

    state.users[userId] = normalizedUser;
  }

  for (const [groupId, rawGroup] of Object.entries(state.groups)) {
    const sourceGroup = ensureObject(rawGroup, {});

    state.groups[groupId] = {
      group_id: String(sourceGroup.group_id || groupId),
      title: sourceGroup.title || "Untitled Group",
      username: sourceGroup.username || null,
      member_count: Number(sourceGroup.member_count || 0),
      real_member_count: Number(sourceGroup.real_member_count || sourceGroup.member_count || 0),
      added_by: sourceGroup.added_by || "",
      added_at: sourceGroup.added_at || nowISO(),
      last_checked_at: sourceGroup.last_checked_at || nowISO(),
      left_at: sourceGroup.left_at || null,
      is_active: sourceGroup.is_active === undefined ? true : !!sourceGroup.is_active,
      is_valid_for_trial: !!sourceGroup.is_valid_for_trial,
      claimed_by: sourceGroup.claimed_by ? String(sourceGroup.claimed_by) : "",
      updated_at: sourceGroup.updated_at || nowISO(),
      is_blacklisted: !!sourceGroup.is_blacklisted,
      blacklist_reason: sourceGroup.blacklist_reason || "",
      is_disabled_by_admin: !!sourceGroup.is_disabled_by_admin,
      can_receive_promo:
        sourceGroup.can_receive_promo === undefined ? true : !!sourceGroup.can_receive_promo
    };

    recomputeGroupReceivePromo(state.groups[groupId]);
  }

  for (const [channelId, rawChannel] of Object.entries(state.channels)) {
    const sourceChannel = ensureObject(rawChannel, {});

    state.channels[channelId] = {
      channel_id: String(sourceChannel.channel_id || channelId),
      title: sourceChannel.title || "Untitled Channel",
      username: sourceChannel.username || null,
      subscriber_count: Number(sourceChannel.subscriber_count || 0),
      real_subscriber_count: Number(sourceChannel.real_subscriber_count || sourceChannel.subscriber_count || 0),
      added_at: sourceChannel.added_at || nowISO(),
      added_by: sourceChannel.added_by || null,
      claimed_by: sourceChannel.claimed_by ? String(sourceChannel.claimed_by) : null,
      claimed_at: sourceChannel.claimed_at || null,
      is_active: sourceChannel.is_active === undefined ? true : !!sourceChannel.is_active,
      is_valid_for_trial: !!sourceChannel.is_valid_for_trial,
      bot_is_admin: !!sourceChannel.bot_is_admin,
      can_post_messages: !!sourceChannel.can_post_messages,
      last_checked_at: sourceChannel.last_checked_at || nowISO(),
      status_reason: sourceChannel.status_reason || "unknown",
      updated_at: sourceChannel.updated_at || nowISO(),
      is_blacklisted: !!sourceChannel.is_blacklisted,
      blacklist_reason: sourceChannel.blacklist_reason || "",
      is_disabled_by_admin: !!sourceChannel.is_disabled_by_admin,
      can_receive_promo:
        sourceChannel.can_receive_promo === undefined ? true : !!sourceChannel.can_receive_promo
    };

    recomputeChannelReceivePromo(state.channels[channelId]);
  }

  for (const [code, rawVoucher] of Object.entries(state.vouchers)) {
    const sourceVoucher = ensureObject(rawVoucher, {});

    state.vouchers[code] = {
      code: String(sourceVoucher.code || code).toUpperCase(),
      package: String(sourceVoucher.package || "trial").toLowerCase(),
      duration: String(sourceVoucher.duration || DEFAULT_TRIAL_DURATION),
      is_used: !!sourceVoucher.is_used,
      created_by: sourceVoucher.created_by || null,
      created_at: sourceVoucher.created_at || nowISO(),
      used_by: sourceVoucher.used_by || null,
      used_at: sourceVoucher.used_at || null,
      expired_at: sourceVoucher.expired_at || null
    };
  }

  state.pendingGroups = state.pendingGroups
    .map((rawPending) => {
      const sourcePending = ensureObject(rawPending, {});
      if (!sourcePending.id || !sourcePending.link) return null;
      return {
        id: String(sourcePending.id),
        link: String(sourcePending.link),
        added_by: sourcePending.added_by || "",
        status: sourcePending.status || "pending",
        created_at: sourcePending.created_at || nowISO(),
        matched_group_id: sourcePending.matched_group_id || null,
        matched_at: sourcePending.matched_at || null
      };
    })
    .filter(Boolean);

  const cleanedSessions = {};
  for (const [sessionKey, rawSession] of Object.entries(state.sessions)) {
    const sourceSession = ensureObject(rawSession, {});
    if (!sourceSession.type) continue;
    cleanedSessions[String(sessionKey)] = {
      ...sourceSession,
      updated_at: sourceSession.updated_at || nowISO(),
      expires_at: sourceSession.expires_at || null
    };
  }
  state.sessions = cleanedSessions;
}

async function initializeStorage() {
  await ensureFile(FILES.users, {});
  await ensureFile(FILES.groups, {});
  await ensureFile(FILES.channels, {});
  await ensureFile(FILES.vouchers, {});
  await ensureFile(FILES.packages, DEFAULT_PACKAGES);
  await ensureFile(FILES.promotions, []);
  await ensureFile(FILES.logs, []);
  await ensureFile(FILES.pendingGroups, []);
  await ensureFile(FILES.pendingNotifications, {});
  await ensureFile(FILES.sessions, {});
  await ensureFile(FILES.settings, DEFAULT_SETTINGS);

  state.users = await loadJSON(FILES.users, {});
  state.groups = await loadJSON(FILES.groups, {});
  state.channels = await loadJSON(FILES.channels, {});
  state.vouchers = await loadJSON(FILES.vouchers, {});
  state.packages = await loadJSON(FILES.packages, DEFAULT_PACKAGES);
  state.promotions = await loadJSON(FILES.promotions, []);
  state.logs = await loadJSON(FILES.logs, []);
  state.pendingGroups = await loadJSON(FILES.pendingGroups, []);
  state.pendingNotifications = await loadJSON(FILES.pendingNotifications, {});
  state.sessions = await loadJSON(FILES.sessions, {});
  state.settings = await loadJSON(FILES.settings, DEFAULT_SETTINGS);

  normalizeStateShape();

  for (const [userId, sessionValue] of Object.entries(state.sessions)) {
    sessions.set(String(userId), sessionValue);
  }

  markDirty("packages");
  markDirty("settings");
  await flushDirtyData();
}

async function flushDirtyData() {
  if (isFlushing || dirty.size === 0) return;

  isFlushing = true;
  try {
    if (dirty.has("users")) {
      await saveJSON(FILES.users, state.users);
      dirty.delete("users");
    }

    if (dirty.has("groups")) {
      await saveJSON(FILES.groups, state.groups);
      dirty.delete("groups");
    }

    if (dirty.has("channels")) {
      await saveJSON(FILES.channels, state.channels);
      dirty.delete("channels");
    }

    if (dirty.has("vouchers")) {
      await saveJSON(FILES.vouchers, state.vouchers);
      dirty.delete("vouchers");
    }

    if (dirty.has("packages")) {
      await saveJSON(FILES.packages, state.packages);
      dirty.delete("packages");
    }

    if (dirty.has("promotions")) {
      await saveJSON(FILES.promotions, state.promotions);
      dirty.delete("promotions");
    }

    if (dirty.has("logs")) {
      await saveJSON(FILES.logs, state.logs);
      dirty.delete("logs");
    }

    if (dirty.has("pendingGroups")) {
      await saveJSON(FILES.pendingGroups, state.pendingGroups);
      dirty.delete("pendingGroups");
    }

    if (dirty.has("pendingNotifications")) {
      await saveJSON(FILES.pendingNotifications, state.pendingNotifications);
      dirty.delete("pendingNotifications");
    }

    if (dirty.has("sessions")) {
      await saveJSON(FILES.sessions, state.sessions);
      dirty.delete("sessions");
    }

    if (dirty.has("settings")) {
      await saveJSON(FILES.settings, state.settings);
      dirty.delete("settings");
    }
  } catch (error) {
    console.error("Gagal flush data:", error.message);
  } finally {
    isFlushing = false;
  }
}

async function flushAllData() {
  markDirty("users");
  markDirty("groups");
  markDirty("channels");
  markDirty("vouchers");
  markDirty("packages");
  markDirty("promotions");
  markDirty("logs");
  markDirty("pendingGroups");
  markDirty("sessions");
  markDirty("settings");
  await flushDirtyData();
}

function addLog(type, detail = {}) {
  state.logs.push({
    id: randomId("log"),
    type,
    created_at: nowISO(),
    detail
  });

  if (state.logs.length > MAX_LOG_ENTRIES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
  }

  markDirty("logs");
}

function createDefaultUser(userId) {
  const now = nowISO();
  const role = resolveRole(userId);
  const canCustomReceive = ["owner", "admin"].includes(role);

  return {
    id: Number(userId),
    username: null,
    first_name: "",
    role,
    package: "free",
    package_started_at: null,
    package_expired_at: null,
    is_banned: false,
    is_receive_promo: false,
    can_custom_receive_promo: canCustomReceive,
    is_opt_in: false,
    has_started: false,
    warning_count: 0,
    warnings: [],
    notes: [],
    trial: {
      is_active: false,
      has_used_trial: false,
      valid_targets: [],
      valid_groups: [],
      valid_channels: [],
      started_at: null,
      expired_at: null,
      promo_used: 0,
      promo_limit: getTrialPromoLimit()
    },
    last_promo_at: null,
    daily_promo_count: 0,
    daily_promo_date: null,
    created_at: now,
    updated_at: now
  };
}

function ensureUserById(userId) {
  const key = String(userId);
  if (!state.users[key]) {
    state.users[key] = createDefaultUser(key);
    markDirty("users");
  }
  return state.users[key];
}

function upsertUserFromTelegram(tgUser) {
  if (!tgUser?.id) return null;

  const user = ensureUserById(tgUser.id);
  user.username = tgUser.username || user.username || null;
  user.first_name = tgUser.first_name || user.first_name || "";
  user.role = resolveRole(tgUser.id);
  ensureUserTrialState(user);
  ensureUserReceivePromoState(user);

  if (user.role === "owner") {
    user.package = "owner";
    user.package_started_at = null;
    user.package_expired_at = null;
  }

  user.updated_at = nowISO();
  markDirty("users");
  return user;
}

function getPackageConfig(packageName) {
  return state.packages[packageName] || DEFAULT_PACKAGES[packageName] || null;
}

function getPackageDelaySeconds(packageName) {
  const pkg = getPackageConfig(packageName);
  if (!pkg) return 0;

  const delay = Number(pkg.delay_seconds);
  return Number.isFinite(delay) && delay >= 0 ? delay : 0;
}

function getDailyPromoLimit(packageName) {
  const pkg = getPackageConfig(String(packageName || "").toLowerCase());
  if (!pkg) return 0;
  if (String(packageName || "").toLowerCase() === "trial") {
    const trialLimit = Number(pkg.promo_limit || pkg.daily_limit || getTrialPromoLimit());
    return Number.isFinite(trialLimit) && trialLimit >= 0 ? trialLimit : getTrialPromoLimit();
  }
  const fromPackage = Number(pkg.daily_limit);
  return Number.isFinite(fromPackage) && fromPackage >= 0 ? fromPackage : 0;
}

function resetDailyCounterIfNeeded(user) {
  const today = todayKey();
  if (user.daily_promo_date !== today) {
    user.daily_promo_date = today;
    user.daily_promo_count = 0;
  }
}

function applyPackageToUser(user, packageName, durationText) {
  const targetPackage = String(packageName || "").toLowerCase();
  ensureUserTrialState(user);

  if (targetPackage === "free") {
    user.package = "free";
    user.package_started_at = null;
    user.package_expired_at = null;
    user.trial.is_active = false;
    user.trial.started_at = null;
    user.trial.expired_at = null;
    user.updated_at = nowISO();
    return { ok: true };
  }

  if (!["trial", "pro", "vip"].includes(targetPackage)) {
    return { ok: false, message: "Paket tidak valid." };
  }

  const durationMs = parseDurationToMs(durationText);
  if (!durationMs) {
    return { ok: false, message: "Format durasi tidak valid. Contoh: 1d, 7d, 12h." };
  }

  const startedAt = new Date();
  const expiredAt = new Date(startedAt.getTime() + durationMs);

  user.package = targetPackage;
  user.package_started_at = startedAt.toISOString();
  user.package_expired_at = expiredAt.toISOString();

  if (targetPackage === "trial") {
    user.trial.is_active = true;
    user.trial.has_used_trial = true;
    user.trial.started_at = user.package_started_at;
    user.trial.expired_at = user.package_expired_at;
    user.trial.promo_used = 0;
    user.trial.promo_limit = getTrialPromoLimit();
  } else {
    user.trial.is_active = false;
    user.trial.started_at = null;
    user.trial.expired_at = null;
  }

  user.updated_at = nowISO();
  return { ok: true };
}

function expireUserPackageIfNeeded(userId, user, reason = "auto") {
  if (!user || user.package === "free" || !user.package_expired_at) return false;

  const expTs = Date.parse(user.package_expired_at);
  if (!Number.isFinite(expTs)) return false;
  if (expTs > Date.now()) return false;

  const previousPackage = user.package;
  applyPackageToUser(user, "free");

  addLog("package_expired", {
    user_id: Number(userId),
    previous_package: previousPackage,
    reason
  });

  markDirty("users");
  return true;
}

// ============================================================================
// PENDING NOTIFICATIONS
// ----------------------------------------------------------------------------
// Notifikasi yang gagal dikirim ke private chat inviter (mis. user belum
// pernah /start). Disimpan di state.pendingNotifications agar tampil saat
// user akhirnya /start. Lihat config NOTIFICATIONS.*.
// ============================================================================

function savePendingNotification(userId, payload) {
  if (!userId) return false;
  const key = String(userId);
  if (!state.pendingNotifications || typeof state.pendingNotifications !== "object") {
    state.pendingNotifications = {};
  }
  if (!Array.isArray(state.pendingNotifications[key])) {
    state.pendingNotifications[key] = [];
  }
  const max = Number(getConfigValue("NOTIFICATIONS.MAX_PENDING_PER_USER", 50)) || 50;
  state.pendingNotifications[key].push({
    ...payload,
    created_at: nowISO()
  });
  if (state.pendingNotifications[key].length > max) {
    state.pendingNotifications[key] = state.pendingNotifications[key].slice(-max);
  }
  markDirty("pendingNotifications");
  return true;
}

function getPendingNotifications(userId) {
  if (!userId) return [];
  const key = String(userId);
  return Array.isArray(state.pendingNotifications?.[key])
    ? state.pendingNotifications[key]
    : [];
}

function clearPendingNotifications(userId) {
  if (!userId) return 0;
  const key = String(userId);
  const list = state.pendingNotifications?.[key];
  if (!Array.isArray(list) || list.length === 0) return 0;
  const count = list.length;
  delete state.pendingNotifications[key];
  markDirty("pendingNotifications");
  return count;
}

function countAllPendingNotifications() {
  if (!state.pendingNotifications || typeof state.pendingNotifications !== "object") {
    return 0;
  }
  return Object.values(state.pendingNotifications).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
    0
  );
}

// ============================================================================
// JOIN STATUS FORMATTER
// ----------------------------------------------------------------------------
// Pesan ringkas hasil deteksi bot saat masuk grup/channel. Dipakai untuk
// mengirim ke private chat inviter (BUKAN ke grup/channel). Lihat aturan
// silent-join di config NOTIFICATIONS.
// ============================================================================

function formatJoinStatusMessage(result) {
  if (!result) return "";

  const isGroup = result.type === "group";
  const label = isGroup ? "grup" : "channel";
  const emoji = isGroup ? "👥" : "📢";
  const memberLabel = isGroup ? "Jumlah member" : "Jumlah subscriber";
  const required = Number(result.required_count || 0);
  const validNow = Number(result.valid_count || 0);
  const trialBadge = result.trial_status_valid ? "✅ Valid" : "⚠️ Belum Valid";

  const reasonLines = [];
  if (!result.trial_status_valid && result.reasons?.length) {
    for (const r of result.reasons) reasonLines.push(`- ${r}`);
  }

  const lines = [
    `✅ Bot berhasil ditambahkan ke ${label}.`,
    "",
    `📌 Nama: ${result.title || "Unknown"}`,
    `🆔 ID: ${result.chat_id}`,
    `${emoji} ${memberLabel} tanpa bot: ${result.real_count ?? 0}`,
    "",
    `🎁 Status Trial: ${trialBadge}`
  ];

  if (reasonLines.length > 0) {
    lines.push(...reasonLines);
  }

  if (required > 0) {
    lines.push("", `📊 Progress Trial Anda: ${validNow}/${required} grup valid`);
  }

  const footer = String(getConfigValue("MESSAGES.JOIN_NOTIFICATION_FOOTER", ""));
  if (footer) lines.push(footer);

  return lines.join("\n");
}

// ============================================================================
// SILENT JOIN NOTIFIER
// ----------------------------------------------------------------------------
// Kirim hasil deteksi join ke private chat inviter; jika gagal, simpan ke
// pending. JANGAN PERNAH fallback kirim ke grup/channel.
// ============================================================================

async function notifyInviterAboutJoin(inviterId, result) {
  if (!inviterId) {
    addLog("join_no_inviter", {
      type: result?.type,
      chat_id: result?.chat_id,
      title: result?.title
    });
    return { sent: false, pending: false, reason: "no_inviter" };
  }

  const sendToPrivate = !!getConfigValue(
    "NOTIFICATIONS.SEND_JOIN_STATUS_TO_INVITER_PRIVATE",
    true
  );
  if (!sendToPrivate) {
    return { sent: false, pending: false, reason: "disabled" };
  }

  const text = formatJoinStatusMessage(result);
  if (!text) return { sent: false, pending: false, reason: "empty_text" };

  try {
    if (typeof bot?.sendMessage === "function") {
      await bot.sendMessage(Number(inviterId), text);
    }
    addLog("join_notified_private", {
      type: result.type,
      chat_id: result.chat_id,
      inviter_id: Number(inviterId)
    });
    return { sent: true, pending: false };
  } catch (error) {
    const savePending = !!getConfigValue(
      "NOTIFICATIONS.SAVE_PENDING_NOTIFICATION_IF_PRIVATE_FAILED",
      true
    );
    if (savePending) {
      savePendingNotification(inviterId, {
        type: result.type === "group" ? "bot_joined_group" : "bot_joined_channel",
        chat_id: String(result.chat_id),
        title: result.title || "",
        real_member_count: Number(result.real_count || 0),
        trial_status: result.trial_status_valid ? "valid" : "invalid",
        valid_count: Number(result.valid_count || 0),
        required_count: Number(result.required_count || 0),
        reasons: Array.isArray(result.reasons) ? result.reasons.slice(0, 5) : [],
        text
      });
    }
    addLog("join_notified_failed", {
      type: result.type,
      chat_id: result.chat_id,
      inviter_id: Number(inviterId),
      error: error?.message || String(error)
    });
    return { sent: false, pending: !!savePending, reason: "send_failed" };
  }
}

async function processMyChatMember(update) {
  if (!update?.chat?.id) return;
  const chat = update.chat;
  const actorId = update.from?.id ? String(update.from.id) : "";
  const oldStatus = String(update.old_chat_member?.status || "").toLowerCase();
  const newStatus = String(update.new_chat_member?.status || "").toLowerCase();

  const becameActive = ["member", "administrator", "creator"].includes(newStatus);
  const becameInactive = ["left", "kicked"].includes(newStatus);

  if (["group", "supergroup"].includes(chat.type)) {
    const key = String(chat.id);
    if (becameActive) {
      await ensureGroupSnapshot(key, chat.title || "Unknown Group", actorId || "");
      const group = state.groups[key];
      const wasInactive = !group.is_active;
      group.is_active = true;
      group.left_at = null;
      group.last_checked_at = nowISO();
      group.last_seen_at = nowISO();
      group.detected_source = group.detected_source || "my_chat_member";
      if (!group.added_by && actorId) {
        group.added_by = Number(actorId);
      }
      if (!group.claimed_by && actorId) {
        group.claimed_by = actorId;
      }
      group.updated_at = nowISO();
      recomputeGroupReceivePromo(group);
      markDirty("groups");

      if (group.claimed_by) {
        await claimGroupForUser(group.claimed_by, key, { force: true });
      }

      // SILENT JOIN: kirim status hasil deteksi HANYA ke private chat inviter.
      // Tidak boleh kirim status ke grup. Lihat config NOTIFICATIONS.
      const oldWasMember = ["member", "administrator", "creator"].includes(oldStatus);
      const isFreshJoin = !oldWasMember || wasInactive;
      if (isFreshJoin && actorId) {
        const minTrialMember = getTrialMinGroupMembers();
        const reasons = [];
        if (!group.is_valid_for_trial) {
          reasons.push(
            `Member belum mencukupi (min ${minTrialMember}, terbaca ${group.real_member_count || 0}).`
          );
        }
        const trialProgress = computeUserTrialGroupProgress(actorId);
        await notifyInviterAboutJoin(actorId, {
          type: "group",
          chat_id: key,
          title: group.title,
          real_count: group.real_member_count || 0,
          trial_status_valid: !!group.is_valid_for_trial,
          valid_count: trialProgress.valid_count,
          required_count: trialProgress.required_count,
          reasons
        });
      }
    } else if (becameInactive) {
      const group = state.groups[key] || {
        group_id: key,
        title: chat.title || "Unknown Group",
        username: chat.username || null,
        member_count: 0,
        real_member_count: 0,
        added_by: "",
        added_at: nowISO(),
        last_checked_at: nowISO(),
        left_at: nowISO(),
        is_active: false,
        is_valid_for_trial: false,
        claimed_by: "",
        updated_at: nowISO(),
        is_blacklisted: false,
        blacklist_reason: "",
        is_disabled_by_admin: false,
        can_receive_promo: false
      };
      group.is_active = false;
      group.username = chat.username || group.username || null;
      group.last_checked_at = nowISO();
      group.left_at = nowISO();
      group.updated_at = nowISO();
      recomputeGroupReceivePromo(group);
      state.groups[key] = group;
      markDirty("groups");
    }
    addLog("my_chat_member_group", {
      group_id: key,
      old_status: oldStatus,
      new_status: newStatus
    });
    return;
  }

  if (chat.type === "channel") {
    const key = String(chat.id);
    if (becameActive) {
      await ensureChannelSnapshot(key, chat.title || "Unknown Channel", actorId || "");
      const channel = state.channels[key];
      const wasInactive = !channel.is_active;
      channel.is_active = true;
      channel.last_seen_at = nowISO();
      channel.detected_source = channel.detected_source || "my_chat_member";
      if (!channel.added_by && actorId) {
        channel.added_by = Number(actorId);
      }
      if (!channel.claimed_by && actorId) {
        channel.claimed_by = actorId;
        channel.claimed_at = channel.claimed_at || nowISO();
      }
      channel.updated_at = nowISO();
      recomputeChannelReceivePromo(channel);
      markDirty("channels");

      if (channel.claimed_by) {
        await claimChannelForUser(channel.claimed_by, key, { force: true });
      }

      // SILENT JOIN: kirim status hasil deteksi HANYA ke private chat inviter.
      // Tidak boleh kirim status ke channel. Lihat config NOTIFICATIONS.
      const oldWasMember = ["member", "administrator", "creator"].includes(oldStatus);
      const isFreshJoin = !oldWasMember || wasInactive;
      if (isFreshJoin && actorId) {
        const minSubs = getTrialMinChannelSubscribers();
        const reasons = [];
        if (!channel.bot_is_admin) reasons.push("Bot belum dijadikan admin di channel.");
        else if (!channel.can_post_messages) reasons.push("Bot belum punya izin Post Messages di channel.");
        else if ((channel.real_subscriber_count || 0) < minSubs) {
          reasons.push(
            `Subscriber belum mencukupi (min ${minSubs}, terbaca ${channel.real_subscriber_count || 0}).`
          );
        }
        const trialProgress = computeUserTrialGroupProgress(actorId);
        await notifyInviterAboutJoin(actorId, {
          type: "channel",
          chat_id: key,
          title: channel.title,
          real_count: channel.real_subscriber_count || 0,
          trial_status_valid: !!channel.is_valid_for_trial,
          // Trial Basic group-only: progress trial tetap pakai grup, bukan channel.
          valid_count: trialProgress.valid_count,
          required_count: trialProgress.required_count,
          reasons
        });
      }
    } else if (becameInactive) {
      const channel = state.channels[key] || {
        channel_id: key,
        title: chat.title || "Unknown Channel",
        username: chat.username || null,
        subscriber_count: 0,
        real_subscriber_count: 0,
        added_at: nowISO(),
        added_by: null,
        claimed_by: null,
        claimed_at: null,
        is_active: false,
        is_valid_for_trial: false,
        bot_is_admin: false,
        can_post_messages: false,
        last_checked_at: nowISO(),
        status_reason: "bot_left_or_kicked",
        updated_at: nowISO(),
        is_blacklisted: false,
        blacklist_reason: "",
        is_disabled_by_admin: false,
        can_receive_promo: false
      };
      channel.is_active = false;
      channel.bot_is_admin = false;
      channel.can_post_messages = false;
      channel.is_valid_for_trial = false;
      channel.last_checked_at = nowISO();
      channel.updated_at = nowISO();
      recomputeChannelReceivePromo(channel);
      state.channels[key] = channel;
      markDirty("channels");
    }

    addLog("my_chat_member_channel", {
      channel_id: key,
      old_status: oldStatus,
      new_status: newStatus
    });
  }
}

async function handleIncomingChannelPost(msg) {
  if (!msg?.chat?.id || msg.chat.type !== "channel") return;
  await registerChannelFromCurrentChat(msg.chat, msg.from?.id || "");

  const text = String(msg.text || msg.caption || "");
  if (!text) return;
  const parsed = parseCommand(text);
  if (!parsed) return;

  if (parsed.command === "claimtrial") {
    await sendSafeMessage(
      msg.chat.id,
      "Untuk channel, klaim dilakukan dari private chat dengan /claimchannel setelah bot dijadikan admin."
    );
  }
}

async function sweepExpiredPackages(reason = "interval") {
  let changed = 0;

  for (const [userId, user] of Object.entries(state.users)) {
    if (expireUserPackageIfNeeded(userId, user, reason)) {
      changed += 1;
    }
  }

  if (changed > 0) {
    markDirty("users");
    await flushDirtyData();
  }
}

function checkCommandRateLimit(userId) {
  // Owner/admin bypass rate limit jika `PRIVILEGES.{role}.IMMUNE_TO_RATE_LIMIT`
  // bernilai true (default).
  if (isPrivileged(userId) && getPrivilegeFlag(userId, "IMMUNE_TO_RATE_LIMIT")) {
    return 0;
  }

  const now = Date.now();
  const key = String(userId);
  const prev = commandRate.get(key) || 0;

  if (now - prev < COMMAND_RATE_LIMIT_MS) {
    return COMMAND_RATE_LIMIT_MS - (now - prev);
  }

  commandRate.set(key, now);
  return 0;
}

function canTargetByPackage(user, target) {
  // Owner/admin bypass batasan target jika `BYPASS_PROMO_TARGET_LIMIT` true.
  if (
    isPrivileged(user.id) &&
    (getPrivilegeFlag(user.id, "BYPASS_PROMO_TARGET_LIMIT") ||
      getPrivilegeFlag(user.id, "CAN_USE_ALL_FEATURES"))
  ) {
    return true;
  }

  const pkg = getPackageConfig(user.package);
  if (!pkg || pkg.enabled === false) return false;

  if (target === "group") return !!pkg.can_share_group;
  if (target === "channel") return !!pkg.can_share_channel;
  if (target === "target") return !!pkg.can_share_group && !!pkg.can_share_channel;
  if (target === "user") return !!pkg.can_share_user;
  if (target === "all") return !!pkg.can_share_all;
  return false;
}

function evaluatePromotionAccess(user, target) {
  // Owner/admin tidak boleh dianggap diban oleh sistem; tetap perlakukan
  // is_banned sebagai noise jika role privileged (owner/admin tidak akan
  // pernah di-set is_banned via /ban karena handler menolaknya, tapi guard
  // ini berlaku untuk data legacy).
  if (user.is_banned && !isPrivileged(user.id)) {
    return { ok: false, message: "Akses ditolak. Akun kamu sedang diban." };
  }

  expireUserPackageIfNeeded(user.id, user, "on_command");

  const bypassPackage =
    isPrivileged(user.id) && getPrivilegeFlag(user.id, "BYPASS_PACKAGE_CHECK");
  if (!bypassPackage && (!user.package || user.package === "free")) {
    return { ok: false, message: "Akses promosi hanya untuk paket trial/pro/vip." };
  }

  if (!canTargetByPackage(user, target)) {
    // Trial Basic group-only: berikan pesan spesifik bila user Trial mencoba
    // target selain grup. Lihat config MESSAGES.TRIAL_GROUP_ONLY.
    if (
      user.package === "trial" &&
      !isPrivileged(user.id) &&
      ["channel", "target", "user", "all"].includes(target)
    ) {
      return {
        ok: false,
        message: String(
          getConfigValue(
            "MESSAGES.TRIAL_GROUP_ONLY",
            "❌ Paket Trial Basic hanya bisa mengirim promosi ke grup.\n\nUntuk promosi ke channel atau user, silakan gunakan paket Pro/VIP sesuai fitur yang tersedia."
          )
        )
      };
    }
    return {
      ok: false,
      message: "Target promosi tidak diizinkan untuk paket kamu."
    };
  }

  // Owner/admin: setiap pemeriksaan limit/cooldown dievaluasi terhadap flag
  // privilege individual. Default-nya bypass aktif (lihat helper
  // `getPrivilegeFlag`). User biasa tetap dicek penuh.
  const bypassTrialLimit =
    isPrivileged(user.id) && getPrivilegeFlag(user.id, "BYPASS_TRIAL_LIMIT");
  const bypassDailyLimit =
    isPrivileged(user.id) && getPrivilegeFlag(user.id, "IMMUNE_TO_DAILY_LIMIT");
  const bypassCooldown =
    isPrivileged(user.id) && getPrivilegeFlag(user.id, "IMMUNE_TO_COOLDOWN");

  if (user.package === "trial") {
    ensureUserTrialState(user);

    if (!bypassTrialLimit) {
      const trialLimit = Math.max(1, Number(user.trial.promo_limit || getTrialPromoLimit()) || getTrialPromoLimit());
      if (user.trial.promo_used >= trialLimit) {
        return {
          ok: false,
          message:
            "Limit promosi Trial Basic sudah habis. Gunakan voucher Pro/VIP untuk lanjut promosi."
        };
      }
    }
  } else {
    resetDailyCounterIfNeeded(user);

    if (!bypassDailyLimit) {
      const dailyLimit = getDailyPromoLimit(user.package);
      if (dailyLimit > 0 && user.daily_promo_count >= dailyLimit) {
        return {
          ok: false,
          message: `Limit promosi harian tercapai (${dailyLimit}/hari).`
        };
      }
    }
  }

  if (!bypassCooldown) {
    const delaySeconds = getPackageDelaySeconds(user.package);
    if (delaySeconds > 0 && user.last_promo_at) {
      const elapsedMs = Date.now() - Date.parse(user.last_promo_at);
      const requiredMs = delaySeconds * 1000;
      if (Number.isFinite(elapsedMs) && elapsedMs < requiredMs) {
        const remainSeconds = (requiredMs - elapsedMs) / 1000;
        return {
          ok: false,
          message: `Masih cooldown. Coba lagi dalam ${formatSeconds(remainSeconds)}.`
        };
      }
    }
  }

  return { ok: true };
}

function touchPromotionUsage(user) {
  // Owner/admin tidak ikut dihitung ke counter limit jika `IMMUNE_TO_PROMO_LIMIT`.
  if (isPrivileged(user.id) && getPrivilegeFlag(user.id, "IMMUNE_TO_PROMO_LIMIT")) {
    user.last_promo_at = nowISO();
    user.updated_at = nowISO();
    markDirty("users");
    return;
  }

  if (user.package === "trial") {
    ensureUserTrialState(user);
    user.trial.promo_used = Math.max(0, Number(user.trial.promo_used || 0) || 0) + 1;
    user.trial.promo_limit = Math.max(1, Number(user.trial.promo_limit || getTrialPromoLimit()) || getTrialPromoLimit());
  } else {
    resetDailyCounterIfNeeded(user);
    user.daily_promo_count += 1;
  }

  user.last_promo_at = nowISO();
  user.updated_at = nowISO();
  markDirty("users");
}

function getRecipientsForPromotionTarget(target) {
  const recipients = [];

  if (["group", "target", "all"].includes(target)) {
    for (const group of Object.values(state.groups)) {
      if (!group || !group.is_active) continue;
      if (group.is_blacklisted) continue;
      if (!group.can_receive_promo) continue;
      recipients.push({ chat_id: Number(group.group_id), type: "group" });
    }
  }

  if (["channel", "target", "all"].includes(target)) {
    for (const channel of Object.values(state.channels)) {
      if (!channel || !channel.is_active) continue;
      if (channel.is_blacklisted) continue;
      if (!channel.bot_is_admin) continue;
      if (!channel.can_post_messages) continue;
      if (!channel.can_receive_promo) continue;
      recipients.push({ chat_id: Number(channel.channel_id), type: "channel" });
    }
  }

  if (target === "user" || target === "all") {
    for (const user of Object.values(state.users)) {
      if (!user?.id) continue;
      if (!user.has_started) continue;
      if (user.is_banned) continue;
      if (!user.is_receive_promo) continue;
      recipients.push({ chat_id: Number(user.id), type: "user" });
    }
  }

  return recipients;
}

function getRecipientsForAdminBroadcast(scope) {
  const recipients = [];

  if (["group", "target", "all_targets", "all"].includes(scope)) {
    for (const group of Object.values(state.groups)) {
      if (!group?.group_id) continue;
      if (!group.is_active) continue;
      if (group.is_blacklisted) continue;
      if (!group.can_receive_promo) continue;
      recipients.push({ chat_id: Number(group.group_id), type: "group" });
    }
  }

  if (["channel", "target", "all_targets", "all"].includes(scope)) {
    for (const channel of Object.values(state.channels)) {
      if (!channel?.channel_id) continue;
      if (!channel.is_active) continue;
      if (channel.is_blacklisted) continue;
      if (!channel.bot_is_admin) continue;
      if (!channel.can_post_messages) continue;
      if (!channel.can_receive_promo) continue;
      recipients.push({ chat_id: Number(channel.channel_id), type: "channel" });
    }
  }

  if (["optin", "user", "all_users", "all"].includes(scope)) {
    for (const user of Object.values(state.users)) {
      if (!user?.id) continue;
      if (!user.has_started) continue;
      if (user.is_banned) continue;
      if (["optin", "user", "all"].includes(scope) && !user.is_receive_promo) continue;
      recipients.push({ chat_id: Number(user.id), type: "user" });
    }
  }

  return recipients;
}

function pushPromotionHistory(entry) {
  state.promotions.push(entry);
  if (state.promotions.length > MAX_PROMOTION_ENTRIES) {
    state.promotions.splice(0, state.promotions.length - MAX_PROMOTION_ENTRIES);
  }
  markDirty("promotions");
}

function updatePromotionHistory(id, patch) {
  const idx = state.promotions.findIndex((item) => item.id === id);
  if (idx < 0) return;
  state.promotions[idx] = {
    ...state.promotions[idx],
    ...patch
  };
  markDirty("promotions");
}

async function applySendErrorSideEffects(recipient, errorInfo) {
  const desc = String(errorInfo.description || "").toLowerCase();
  const code = Number(errorInfo.code || 0);

  if (recipient.type === "user") {
    const fatalUserError =
      code === 403 ||
      desc.includes("blocked") ||
      desc.includes("forbidden") ||
      desc.includes("chat not found") ||
      desc.includes("user is deactivated");

    if (fatalUserError) {
      const user = state.users[String(recipient.chat_id)];
      if (user) {
        user.is_receive_promo = false;
        user.is_opt_in = false;
        user.updated_at = nowISO();
        markDirty("users");
      }
    }
  }

  if (recipient.type === "group") {
    const fatalGroupError =
      code === 403 ||
      desc.includes("chat not found") ||
      desc.includes("bot was kicked") ||
      desc.includes("have no rights") ||
      desc.includes("forbidden");

    if (fatalGroupError) {
      const group = state.groups[String(recipient.chat_id)];
      if (group) {
        group.is_active = false;
        group.left_at = nowISO();
        recomputeGroupReceivePromo(group);
        markDirty("groups");
      }
    }
  }

  if (recipient.type === "channel") {
    const fatalChannelError =
      code === 403 ||
      desc.includes("chat not found") ||
      desc.includes("forbidden") ||
      desc.includes("not enough rights") ||
      desc.includes("need administrator rights") ||
      desc.includes("have no rights") ||
      desc.includes("bot is not a member");

    if (fatalChannelError) {
      const channel = state.channels[String(recipient.chat_id)];
      if (channel) {
        channel.is_active = false;
        channel.is_valid_for_trial = false;
        channel.bot_is_admin = false;
        channel.can_post_messages = false;
        channel.status_reason = "send_failed_permission";
        channel.last_checked_at = nowISO();
        channel.updated_at = nowISO();
        recomputeChannelReceivePromo(channel);
        markDirty("channels");
      }
    }
  }
}

function buildRecipientStats(recipients) {
  let groupCount = 0;
  let channelCount = 0;
  let userCount = 0;

  for (const recipient of recipients) {
    if (recipient.type === "group") groupCount += 1;
    if (recipient.type === "channel") channelCount += 1;
    if (recipient.type === "user") userCount += 1;
  }

  return { groupCount, channelCount, userCount, total: recipients.length };
}

async function executePromotionJob(job) {
  const batchSize = Math.max(
    1,
    Number(
      getConfigValue(
        "PROMOTION.SEND_QUEUE.BATCH_SIZE",
        getConfigValue("BROADCAST.BATCH_SIZE", 20)
      )
    ) || 20
  );
  const delayMs = Math.max(
    0,
    Number(
      getConfigValue(
        "PROMOTION.SEND_QUEUE.DELAY_BETWEEN_BATCH_MS",
        getConfigValue("BROADCAST.DELAY_BETWEEN_BATCH_MS", 3000)
      )
    ) || 3000
  );
  const progressIntervalMs = Math.max(
    2000,
    Number(
      getConfigValue(
        "PROMOTION.PROGRESS.UPDATE_INTERVAL_MS",
        getConfigValue("PROMO_PROGRESS.UPDATE_INTERVAL_MS", 3000)
      )
    ) || 3000
  );
  const progressRetryDelayMs = Math.max(
    500,
    Number(
      getConfigValue(
        "PROMOTION.SEND_QUEUE.RETRY_DELAY_MS",
        getConfigValue(
          "PROMO_PROGRESS.RETRY_DELAY_MS",
          getConfigValue("PROMO_PROGRESS.EDIT_RETRY_DELAY_MS", 1500)
        )
      )
    ) || 1500
  );
  const progressMaxRetry = Math.max(
    1,
    Number(
      getConfigValue(
        "PROMOTION.PROGRESS.MAX_EDIT_RETRY",
        getConfigValue("PROMO_PROGRESS.MAX_RETRY", 3)
      )
    ) || 3
  );

  let recipients = [];
  if (job.kind === "promotion") {
    recipients = getRecipientsForPromotionTarget(job.target);
  } else if (job.kind === "admin_broadcast") {
    recipients = getRecipientsForAdminBroadcast(job.scope);
  }

  const recipientStats = buildRecipientStats(recipients);
  const notifyChatId = Number(job.notify_chat_id || 0);

  const buildProgressText = (statusLabel, sentCount, failedCount, totalCount) => {
    const processedCount = sentCount + failedCount;
    const progressPercent = totalCount > 0 ? Math.floor((processedCount / totalCount) * 100) : 100;
    return [
      `📣 ${statusLabel}`,
      `ID: ${job.id}`,
      `Progress: ${processedCount}/${totalCount} (${progressPercent}%)`,
      `✅ Berhasil: ${sentCount}`,
      `❌ Gagal: ${failedCount}`,
      `👥 Grup: ${recipientStats.groupCount} | 📢 Channel: ${recipientStats.channelCount} | 👤 User: ${recipientStats.userCount}`
    ].join("\n");
  };

  const resolveRetryDelayMs = (descriptionText, fallbackMs) => {
    const match = String(descriptionText || "").match(/retry after\s+(\d+)/i);
    if (!match) return fallbackMs;
    const retrySeconds = Number(match[1]);
    if (!Number.isFinite(retrySeconds) || retrySeconds <= 0) return fallbackMs;
    return retrySeconds * 1000;
  };

  let progressMessage = null;
  let lastProgressUpdateAt = 0;

  if (notifyChatId) {
    progressMessage = await sendSafeMessage(
      notifyChatId,
      buildProgressText("Proses promosi dimulai", 0, 0, recipientStats.total)
    );
    if (progressMessage?.message_id) {
      lastProgressUpdateAt = Date.now();
    }
  }

  const updateProgressMessage = async (text, force = false) => {
    if (!notifyChatId || !progressMessage?.message_id) return;

    const nowTs = Date.now();
    if (!force && nowTs - lastProgressUpdateAt < progressIntervalMs) {
      return;
    }

    for (let attempt = 0; attempt <= progressMaxRetry; attempt += 1) {
      try {
        await bot.editMessageText(text, {
          chat_id: notifyChatId,
          message_id: progressMessage.message_id,
          disable_web_page_preview: true
        });
        lastProgressUpdateAt = Date.now();
        return;
      } catch (error) {
        const info = extractTelegramError(error);
        const desc = String(info.description || "").toLowerCase();

        if (desc.includes("message is not modified")) {
          lastProgressUpdateAt = Date.now();
          return;
        }

        const isRateLimited = Number(info.code) === 429 || desc.includes("too many requests");
        if (isRateLimited && attempt < progressMaxRetry) {
          const retryMs = resolveRetryDelayMs(info.description, progressRetryDelayMs);
          await sleep(retryMs);
          continue;
        }

        return;
      }
    }
  };

  updatePromotionHistory(job.id, {
    status: "processing",
    started_at: nowISO(),
    total_targets: recipientStats.total,
    target_groups: recipientStats.groupCount,
    target_channels: recipientStats.channelCount,
    target_users: recipientStats.userCount
  });

  const batches = splitByChunk(recipients, batchSize);
  let sent = 0;
  let failed = 0;
  let cancelled = false;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    if (cancelBroadcastRequested) {
      cancelBroadcastRequested = false;
      cancelled = true;
      break;
    }

    const batch = batches[batchIndex];

    for (const recipient of batch) {
      try {
        await bot.sendMessage(recipient.chat_id, job.text, {
          disable_web_page_preview: true,
          ...(job.options || {})
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        const info = extractTelegramError(error);

        await applySendErrorSideEffects(recipient, info);

        addLog("promotion_failed", {
          promotion_id: job.id,
          recipient_type: recipient.type,
          recipient_id: recipient.chat_id,
          error_code: info.code,
          error_message: info.description
        });
      }
    }

    updatePromotionHistory(job.id, {
      sent_count: sent,
      failed_count: failed
    });
    await updateProgressMessage(
      buildProgressText("Pengiriman promosi berjalan", sent, failed, recipientStats.total)
    );

    if (batchIndex < batches.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  if (cancelled) {
    updatePromotionHistory(job.id, {
      status: "cancelled",
      completed_at: nowISO(),
      sent_count: sent,
      failed_count: failed
    });

    addLog("promotion_cancelled", {
      promotion_id: job.id,
      kind: job.kind,
      sent_count: sent,
      failed_count: failed,
      total_targets: recipients.length
    });

    await updateProgressMessage(
      buildProgressText("Promosi dibatalkan", sent, failed, recipientStats.total),
      true
    );

    await flushDirtyData();
    return;
  }

  updatePromotionHistory(job.id, {
    status: "done",
    completed_at: nowISO(),
    sent_count: sent,
    failed_count: failed
  });

  addLog("promotion_sent", {
    promotion_id: job.id,
    kind: job.kind,
    sent_count: sent,
    failed_count: failed,
    total_targets: recipients.length
  });

  await updateProgressMessage(
    buildProgressText("Promosi selesai", sent, failed, recipientStats.total),
    true
  );

  await flushDirtyData();
}

async function processPromotionQueue() {
  if (isProcessingPromotionQueue) return;

  isProcessingPromotionQueue = true;
  try {
    while (promotionQueue.length > 0) {
      const job = promotionQueue.shift();

      try {
        await executePromotionJob(job);
      } catch (error) {
        console.error("Gagal memproses promotion job:", error.message);

        updatePromotionHistory(job.id, {
          status: "failed",
          completed_at: nowISO(),
          failed_reason: error.message
        });

        addLog("promotion_failed", {
          promotion_id: job.id,
          error_message: error.message
        });
      }
    }
  } finally {
    isProcessingPromotionQueue = false;
  }
}

function queuePromotionJob(job) {
  promotionQueue.push(job);
  processPromotionQueue().catch((error) => {
    console.error("Error queue promotion:", error.message);
  });
}

async function sendSafeMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    const info = extractTelegramError(error);
    addLog("send_message_error", {
      chat_id: chatId,
      error_code: info.code,
      error_message: info.description
    });
    return null;
  }
}

async function sendLongMessage(chatId, text, options = {}) {
  const max =
    Number(
      getConfigValue(
        "BROADCAST.MAX_MESSAGE_LENGTH",
        getConfigValue("LIMITS.MAX_BROADCAST_TEXT_LENGTH", 3500)
      )
    ) || 3500;
  if (!text || text.length <= max) {
    await sendSafeMessage(chatId, text, options);
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const chunk = text.slice(cursor, cursor + max);
    cursor += max;
    await sendSafeMessage(chatId, chunk, options);
  }
}

function buildPackageMenuText() {
  const trial = getTrialSettingsSnapshot();
  return [
    "📦 Paket tersedia:",
    `- Trial Basic: share ke grup + channel (aktif setelah ${trial.required_targets} target valid).`,
    "- Pro: share ke grup + channel.",
    "- VIP: share ke grup + channel + user.",
    "",
    "Gunakan /trial untuk panduan trial, atau /redeem KODE untuk aktivasi voucher."
  ].join("\n");
}

function buildProfileText(user) {
  const expiry = user.package_expired_at ? user.package_expired_at : "-";
  const trialSnapshot = getTrialSettingsSnapshot();
  const trialTargets = ensureArray(user.trial?.valid_targets, []).length;
  const trialGroups = ensureArray(user.trial?.valid_groups, []).length;
  const trialChannels = ensureArray(user.trial?.valid_channels, []).length;
  const trialLimit = Number(user.trial?.promo_limit || trialSnapshot.promo_limit || 3);
  const trialUsed = Number(user.trial?.promo_used || 0);

  return [
    "👤 Profile",
    `ID: ${user.id}`,
    `Username: ${user.username ? `@${user.username}` : "-"}`,
    `Role: ${user.role}`,
    `Paket: ${formatPackageLabel(user.package)}`,
    `Expired paket: ${expiry}`,
    `Terima promosi: ${user.is_receive_promo ? "Ya" : "Tidak"}`,
    `Bisa ubah receive promo: ${user.can_custom_receive_promo ? "Ya" : "Tidak"}`,
    `Status ban: ${user.is_banned ? "Diban" : "Aman"}`,
    `Target trial valid: ${trialTargets}`,
    `Grup trial valid: ${trialGroups}`,
    `Channel trial valid: ${trialChannels}`,
    `Promo trial terpakai: ${trialUsed}/${trialLimit}`,
    `Pernah pakai trial: ${user.trial?.has_used_trial ? "Ya" : "Belum"}`
  ].join("\n");
}

function buildHelpText(adminMode) {
  const userCommands = [
    "/start",
    "/help",
    "/profile",
    "/trial",
    "/redeem KODE",
    "/buatpromo",
    "/sharegrup JUDUL|ISI",
    "/sharechannel JUDUL|ISI",
    "/sharetarget JUDUL|ISI",
    "/shareuser JUDUL|ISI",
    "/shareall JUDUL|ISI",
    "/status",
    "/mygroups",
    "/mychannels",
    "/mytargets"
  ];

  const adminCommands = [
    "/admin",
    "/stats",
    "/users",
    "/user USER_ID",
    "/ban USER_ID",
    "/unban USER_ID",
    "/setpackage USER_ID PACKAGE DURASI",
    "/removeaccess USER_ID",
    "/receivepromo_on [USER_ID]",
    "/receivepromo_off [USER_ID]",
    "/createvoucher PACKAGE DURASI JUMLAH",
    "/vouchers",
    "/setdelay PACKAGE DETIK",
    "/settrialduration DURASI",
    "/settriallimit JUMLAH",
    "/settrialtarget JUMLAH",
    "/setmingroupmembers JUMLAH",
    "/setminchannelsubs JUMLAH",
    "/assigntrialtarget USER_ID TARGET_ID",
    "/trialprogress USER_ID",
    "/resettrialprogress USER_ID",
    "/forcetrial USER_ID [DURASI]",
    "/removetrial USER_ID",
    "/broadcast PESAN",
    "/broadcastall PESAN",
    "/groups",
    "/enablegroup GROUP_ID",
    "/disablegroup GROUP_ID",
    "/channels",
    "/enablechannel CHANNEL_ID",
    "/disablechannel CHANNEL_ID",
    "/groupinfo GROUP_ID",
    "/removegroup GROUP_ID",
    "/activegroups",
    "/inactivegroups",
    "/addgrouplink LINK"
  ];

  const lines = ["📘 Bantuan", "", "Command user:", ...userCommands.map((c) => `- ${c}`)];
  if (adminMode) {
    lines.push("", "Command admin:", ...adminCommands.map((c) => `- ${c}`));
  }
  lines.push("", "Tip: gunakan /cancel untuk membatalkan flow input bertahap.");
  return lines.join("\n");
}

function getMainMenuKeyboard(user) {
  const keyboard = [];

  if (user?.can_custom_receive_promo) {
    keyboard.push([
      { text: "🔔 Receive Promo ON", callback_data: "receivepromo_on" },
      { text: "🔕 Receive Promo OFF", callback_data: "receivepromo_off" }
    ]);
  }

  keyboard.push(
    [
      { text: "👤 Profil Saya", callback_data: "menu_profile" },
      { text: "📦 Paket Saya", callback_data: "menu_packages" }
    ],
    [
      { text: "🎁 Trial Basic", callback_data: "menu_trial" },
      { text: "🎟 Redeem Voucher", callback_data: "menu_redeem" }
    ],
    [
      { text: "📝 Buat Promosi", callback_data: "menu_promo" },
      { text: "🎯 Target Saya", callback_data: "menu_targets" }
    ],
    [
      { text: "📘 Bantuan", callback_data: "menu_help" }
    ]
  );

  if (isAdmin(user.id)) {
    keyboard.push([{ text: "🛠 Menu Admin", callback_data: "menu_admin" }]);
  }

  return { inline_keyboard: keyboard };
}

function normalizeTargetInput(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (["grup", "group", "g"].includes(value)) return "group";
  if (["channel", "ch", "c"].includes(value)) return "channel";
  if (["target", "grup+channel", "group+channel", "gc"].includes(value)) return "target";
  if (["user", "u"].includes(value)) return "user";
  if (["all", "keduanya", "both", "semua"].includes(value)) return "all";
  return null;
}

function parseArgsBySpace(argsText) {
  return String(argsText || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function syncSessionsToState() {
  const next = {};
  for (const [key, value] of sessions.entries()) {
    next[String(key)] = value;
  }
  state.sessions = next;
  markDirty("sessions");
}

function getSessionTTLms() {
  const ttlSeconds = Number(state.settings?.sessions?.ttl_seconds || DEFAULT_SETTINGS.sessions.ttl_seconds);
  return Math.max(60, ttlSeconds) * 1000;
}

function pruneExpiredSessions() {
  const nowTs = Date.now();
  let changed = false;

  for (const [key, value] of sessions.entries()) {
    const expTs = value?.expires_at ? Date.parse(value.expires_at) : 0;
    if (!expTs || expTs > nowTs) continue;
    sessions.delete(key);
    changed = true;
  }

  if (changed) {
    syncSessionsToState();
  }
}

function setSession(userId, payload) {
  const key = String(userId);
  const now = nowISO();
  const expiresAt = new Date(Date.now() + getSessionTTLms()).toISOString();
  sessions.set(key, {
    ...payload,
    updated_at: now,
    expires_at: expiresAt
  });
  syncSessionsToState();
}

function getSession(userId) {
  pruneExpiredSessions();
  return sessions.get(String(userId)) || null;
}

function clearSession(userId) {
  const key = String(userId);
  if (!sessions.has(key)) return;
  sessions.delete(key);
  syncSessionsToState();
}

function isLikelyValidUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return false;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
}

function containsBannedWord(text) {
  const haystack = String(text || "").toLowerCase();
  const words = ensureArray(state.settings?.moderation?.banned_words, []);
  return words.find((word) => word && haystack.includes(String(word).toLowerCase())) || null;
}

function parsePromoBodyMeta(rawBody) {
  const body = String(rawBody || "").trim();
  const lines = body.split("\n").map((line) => line.trim());
  const buttonLine = lines.find((line) => line.toLowerCase().startsWith("button:"));

  if (!buttonLine) return { body, button: null };

  const payload = buttonLine.slice(7).trim();
  const [labelRaw, urlRaw] = payload.split("|").map((x) => String(x || "").trim());
  if (!labelRaw || !urlRaw || !isLikelyValidUrl(urlRaw)) {
    return { body, button: null, invalid_button: true };
  }

  const maxButtons = Number(state.settings?.moderation?.max_url_buttons || 1);
  if (maxButtons < 1) {
    return { body, button: null, invalid_button: true };
  }

  const cleanedBody = lines.filter((line) => line !== buttonLine).join("\n").trim();
  return {
    body: cleanedBody,
    button: {
      text: labelRaw.slice(0, 32),
      url: urlRaw
    }
  };
}

function addWarningToUser(user, reason, actor = "system") {
  // Owner/admin tidak boleh diberi warning otomatis ataupun di-auto-ban.
  // Lihat `PRIVILEGES.{OWNER,ADMIN}.IMMUNE_TO_WARNING` & `IMMUNE_TO_AUTO_BAN`.
  if (isPrivileged(user?.id) && getPrivilegeFlag(user?.id, "IMMUNE_TO_WARNING")) {
    addLog("privileged_warning_skipped", {
      user_id: Number(user?.id) || null,
      role: resolveRole(user?.id),
      reason,
      actor
    });
    return;
  }

  user.warning_count = Number(user.warning_count || 0) + 1;
  user.warnings = ensureArray(user.warnings, []);
  user.warnings.push({
    at: nowISO(),
    reason,
    actor
  });

  const maxWarning = Number(
    getSetting(
      "moderation.max_warning",
      getConfigValue("SECURITY.MAX_WARNING_BEFORE_BAN", 3)
    )
  ) || 3;

  const autoBanEnabled = !!getConfigValue("SECURITY.AUTO_BAN_ENABLED", true);
  if (
    autoBanEnabled &&
    user.warning_count >= maxWarning &&
    !(isPrivileged(user?.id) && getPrivilegeFlag(user?.id, "IMMUNE_TO_AUTO_BAN"))
  ) {
    user.is_banned = true;
  }

  user.updated_at = nowISO();
  markDirty("users");
}

async function getGroupMemberCount(groupId) {
  try {
    const total = await bot.getChatMemberCount(Number(groupId));
    return Math.max(0, Number(total || 0) - 1);
  } catch {
    return 0;
  }
}

async function checkBotStillInGroup(groupId) {
  if (!botId) return false;
  try {
    const member = await bot.getChatMember(Number(groupId), botId);
    const status = String(member?.status || "").toLowerCase();
    return !["left", "kicked"].includes(status);
  } catch {
    return false;
  }
}

async function validateGroupForTrial(groupId) {
  const memberCount = await getGroupMemberCount(groupId);
  const minMember = getTrialMinGroupMembers();
  const inGroup = await checkBotStillInGroup(groupId);
  return {
    ok: inGroup && memberCount >= minMember,
    member_count: memberCount,
    min_member: minMember,
    status_reason: !inGroup ? "bot_not_in_group" : memberCount < minMember ? "member_below_minimum" : "valid"
  };
}

async function isBotAdminInChannel(channelId) {
  if (!botId) return false;
  try {
    const member = await bot.getChatMember(Number(channelId), botId);
    const status = String(member?.status || "").toLowerCase();
    return ["administrator", "creator"].includes(status);
  } catch {
    return false;
  }
}

async function canBotPostInChannel(channelId) {
  if (!botId) return false;
  try {
    const member = await bot.getChatMember(Number(channelId), botId);
    const status = String(member?.status || "").toLowerCase();
    if (status === "creator") return true;
    if (status !== "administrator") return false;
    const rights = member?.can_post_messages;
    return rights === undefined ? true : !!rights;
  } catch {
    return false;
  }
}

async function getChannelSubscriberCount(channelId) {
  try {
    const total = await bot.getChatMemberCount(Number(channelId));
    return Math.max(0, Number(total || 0));
  } catch {
    return 0;
  }
}

async function validateChannelForTrial(channelId) {
  const subscriberCount = await getChannelSubscriberCount(channelId);
  const botIsAdmin = await isBotAdminInChannel(channelId);
  const canPost = await canBotPostInChannel(channelId);
  const minSubs = getTrialMinChannelSubscribers();

  let statusReason = "valid";
  if (!botIsAdmin) statusReason = "bot_not_admin";
  else if (!canPost) statusReason = "bot_cannot_post";
  else if (subscriberCount < minSubs) statusReason = "subscriber_below_minimum";

  return {
    ok: botIsAdmin && canPost && subscriberCount >= minSubs,
    subscriber_count: subscriberCount,
    min_subscriber: minSubs,
    bot_is_admin: botIsAdmin,
    can_post_messages: canPost,
    status_reason: statusReason
  };
}

async function tryActivateTrialForUser(userId) {
  const user = state.users[String(userId)];
  if (!user) return { activated: false, reason: "user_not_found" };
  ensureUserTrialState(user);

  // Trial Basic group-only: syarat aktivasi WAJIB grup valid. Channel tidak
  // dihitung kecuali config `TRIAL.CHANNEL_COUNT_FOR_TRIAL` explicitly true.
  const requiredGroups = getTrialRequiredGroups();
  const channelCounts = isTrialChannelCounted();
  const groupProgress = computeUserTrialGroupProgress(userId);
  const validCount = channelCounts
    ? ensureArray(user.trial?.valid_targets, []).length
    : groupProgress.valid_count;
  const requiredTargets = channelCounts ? getTrialRequiredTargets() : requiredGroups;

  if (validCount < requiredTargets) {
    return { activated: false, reason: "insufficient_targets" };
  }

  if (user.trial.has_used_trial) {
    return { activated: false, reason: "already_used_trial" };
  }

  if (user.package !== "free") {
    return { activated: false, reason: "package_not_free" };
  }

  const trialDuration = getTrialDuration();
  const applied = applyPackageToUser(user, "trial", trialDuration);
  if (!applied.ok) {
    return { activated: false, reason: "apply_failed" };
  }

  user.trial.is_active = true;
  user.trial.has_used_trial = true;
  user.trial.promo_used = 0;
  user.trial.promo_limit = getTrialPromoLimit();
  user.updated_at = nowISO();
  markDirty("users");

  addLog("trial_activated", {
    user_id: Number(userId),
    valid_targets: validCount,
    duration: trialDuration,
    promo_limit: user.trial.promo_limit
  });

  await sendSafeMessage(Number(userId), [
    "🎉 Trial Basic aktif.",
    `Durasi: ${trialDuration}`,
    `Batas kirim promo: ${user.trial.promo_limit}`,
    `Expired: ${user.package_expired_at}`
  ].join("\n"));

  return { activated: true };
}

async function claimGroupForUser(userId, groupId, options = {}) {
  const user = ensureUserById(userId);
  ensureUserTrialState(user);
  const group = state.groups[String(groupId)];

  if (!group) {
    return { ok: false, message: "Grup tidak ditemukan di database." };
  }

  const currentClaim = group.claimed_by ? String(group.claimed_by) : "";
  if (currentClaim && currentClaim !== String(userId) && !options.force) {
    return { ok: false, message: `Grup ini sudah diklaim oleh user ${currentClaim}.` };
  }

  group.claimed_by = String(userId);
  if (!group.added_by) {
    group.added_by = Number(userId);
  }
  group.updated_at = nowISO();
  markDirty("groups");

  user.trial.valid_targets = ensureArray(user.trial.valid_targets, []).map((id) => String(id));
  user.trial.valid_groups = ensureArray(user.trial.valid_groups, []).map((id) => String(id));

  if (group.is_valid_for_trial && !user.trial.valid_groups.includes(String(groupId))) {
    user.trial.valid_groups.push(String(groupId));

    if (!user.trial.valid_targets.includes(String(groupId))) {
      user.trial.valid_targets.push(String(groupId));
    }
  }

  user.updated_at = nowISO();
  markDirty("users");

  const activation = await tryActivateTrialForUser(userId);
  const validCount = ensureArray(user.trial.valid_targets, []).length;

  addLog("group_claimed", {
    user_id: Number(userId),
    group_id: String(groupId),
    is_valid_for_trial: !!group.is_valid_for_trial,
    valid_count: validCount
  });

  return {
    ok: true,
    is_valid_for_trial: !!group.is_valid_for_trial,
    valid_count: validCount,
    required_count: getTrialRequiredTargets(),
    trial_activated: !!activation.activated
  };
}

async function matchPendingGroup(groupId, addedBy) {
  if (!addedBy) return;

  const pending = state.pendingGroups.find(
    (item) => item.status === "pending" && String(item.added_by) === String(addedBy)
  );

  if (!pending) return;

  pending.status = "matched";
  pending.matched_group_id = String(groupId);
  pending.matched_at = nowISO();
  markDirty("pendingGroups");
}

async function registerGroupWhenBotAdded(msg) {
  if (!botId) return;
  if (!["group", "supergroup"].includes(msg.chat?.type)) return;

  const botAdded = ensureArray(msg.new_chat_members, []).some((member) => member.id === botId);
  if (!botAdded) return;

  const groupId = String(msg.chat.id);
  let memberCount = 0;

  try {
    const totalMember = await bot.getChatMemberCount(msg.chat.id);
    memberCount = Math.max(0, Number(totalMember || 0) - 1);
  } catch {
    memberCount = 0;
  }

  const minTrialMember = getTrialMinGroupMembers();
  const isValidForTrial = memberCount >= minTrialMember;
  const existed = state.groups[groupId] || {};
  const adder = msg.from?.id ? Number(msg.from.id) : existed.added_by || "";
  const claimedBy = existed.claimed_by || (adder ? String(adder) : "");
  const nowTs = nowISO();

  state.groups[groupId] = {
    group_id: groupId,
    title: msg.chat.title || existed.title || "Untitled Group",
    username: msg.chat.username || existed.username || null,
    member_count: memberCount,
    real_member_count: memberCount,
    added_by: adder,
    added_at: existed.added_at || nowTs,
    last_checked_at: nowTs,
    last_seen_at: nowTs,
    last_sync_at: existed.last_sync_at || null,
    detected_source: existed.detected_source || "bot_added",
    left_at: null,
    is_active: true,
    is_valid_for_trial: isValidForTrial,
    claimed_by: claimedBy,
    updated_at: nowTs,
    is_blacklisted: !!existed.is_blacklisted,
    blacklist_reason: existed.blacklist_reason || "",
    is_disabled_by_admin: !!existed.is_disabled_by_admin,
    can_receive_promo:
      existed.can_receive_promo === undefined ? true : !!existed.can_receive_promo
  };

  recomputeGroupReceivePromo(state.groups[groupId]);

  markDirty("groups");

  await matchPendingGroup(groupId, adder);

  addLog("group_added", {
    group_id: groupId,
    title: state.groups[groupId].title,
    member_count: memberCount,
    added_by: adder,
    is_valid_for_trial: isValidForTrial
  });

  if (claimedBy) {
    await claimGroupForUser(claimedBy, groupId, { force: true });
  }

  // SILENT JOIN: jangan kirim status apa pun ke grup. Notifikasi hasil deteksi
  // hanya dikirim ke private chat user yang menambahkan bot. Lihat config
  // `NOTIFICATIONS.SEND_JOIN_STATUS_TO_GROUP` (default false) dan
  // `notifyInviterAboutJoin`.
  if (adder) {
    const reasons = [];
    if (!isValidForTrial) {
      reasons.push(`Member belum mencukupi (min ${minTrialMember}, terbaca ${memberCount}).`);
    }
    const trialProgress = computeUserTrialGroupProgress(adder);
    await notifyInviterAboutJoin(adder, {
      type: "group",
      chat_id: groupId,
      title: state.groups[groupId].title,
      real_count: memberCount,
      trial_status_valid: isValidForTrial,
      valid_count: trialProgress.valid_count,
      required_count: trialProgress.required_count,
      reasons
    });
  }
}

async function registerGroupWhenBotLeft(msg) {
  if (!botId) return;
  if (!["group", "supergroup"].includes(msg.chat?.type)) return;
  if (!msg.left_chat_member || msg.left_chat_member.id !== botId) return;

  const groupId = String(msg.chat.id);
  const group = state.groups[groupId] || {
    group_id: groupId,
    title: msg.chat.title || "Untitled Group",
    username: msg.chat.username || null,
    member_count: 0,
    real_member_count: 0,
    added_by: "",
    added_at: nowISO(),
    last_checked_at: nowISO(),
    left_at: nowISO(),
    is_active: false,
    is_valid_for_trial: false,
    claimed_by: "",
    updated_at: nowISO(),
    is_blacklisted: false,
    blacklist_reason: "",
    is_disabled_by_admin: false,
    can_receive_promo: false
  };

  group.title = msg.chat.title || group.title;
  group.username = msg.chat.username || group.username || null;
  group.is_active = false;
  group.last_checked_at = nowISO();
  group.left_at = nowISO();
  group.updated_at = nowISO();
  recomputeGroupReceivePromo(group);

  state.groups[groupId] = group;
  markDirty("groups");

  addLog("group_left", {
    group_id: groupId,
    title: group.title
  });
}

async function ensureGroupSnapshot(groupId, chatTitle, userId) {
  const key = String(groupId);
  const existed = state.groups[key] || null;

  let memberCount = existed?.member_count || 0;
  try {
    const total = await bot.getChatMemberCount(Number(groupId));
    memberCount = Math.max(0, Number(total || 0) - 1);
  } catch {
    memberCount = existed?.member_count || 0;
  }

  const minTrialMember = getTrialMinGroupMembers();
  const isValidForTrial = memberCount >= minTrialMember;
  const nowTs = nowISO();

  state.groups[key] = {
    group_id: key,
    title: chatTitle || existed?.title || "Unknown Group",
    username: existed?.username || null,
    member_count: memberCount,
    real_member_count: memberCount,
    added_by: existed?.added_by || Number(userId),
    added_at: existed?.added_at || nowTs,
    last_checked_at: nowTs,
    last_seen_at: nowTs,
    last_sync_at: existed?.last_sync_at || null,
    detected_source: existed?.detected_source || "snapshot",
    left_at: existed?.left_at || null,
    is_active: existed ? existed.is_active : true,
    is_valid_for_trial: isValidForTrial,
    claimed_by: existed?.claimed_by || "",
    updated_at: nowTs,
    is_blacklisted: !!existed?.is_blacklisted,
    blacklist_reason: existed?.blacklist_reason || "",
    is_disabled_by_admin: !!existed?.is_disabled_by_admin,
    can_receive_promo: existed?.can_receive_promo === undefined ? true : !!existed?.can_receive_promo
  };

  recomputeGroupReceivePromo(state.groups[key]);

  markDirty("groups");
  return state.groups[key];
}

async function ensureChannelSnapshot(channelId, chatTitle, userId) {
  const key = String(channelId);
  const existed = state.channels[key] || null;

  let title = chatTitle || existed?.title || "Unknown Channel";
  let username = existed?.username || null;

  try {
    const chat = await bot.getChat(Number(channelId));
    title = chat?.title || title;
    username = chat?.username || username;
  } catch {
    // ignore
  }

  const validation = await validateChannelForTrial(channelId);

  const nowTs = nowISO();
  state.channels[key] = {
    channel_id: key,
    title,
    username,
    subscriber_count: validation.subscriber_count,
    real_subscriber_count: validation.subscriber_count,
    added_at: existed?.added_at || nowTs,
    added_by: existed?.added_by || Number(userId) || null,
    claimed_by: existed?.claimed_by || null,
    claimed_at: existed?.claimed_at || null,
    is_active: existed ? existed.is_active : true,
    is_valid_for_trial: validation.ok,
    bot_is_admin: validation.bot_is_admin,
    can_post_messages: validation.can_post_messages,
    last_checked_at: nowTs,
    last_seen_at: nowTs,
    last_sync_at: existed?.last_sync_at || null,
    detected_source: existed?.detected_source || "channel_post",
    status_reason: validation.status_reason,
    updated_at: nowTs,
    is_blacklisted: existed?.is_blacklisted || false,
    blacklist_reason: existed?.blacklist_reason || "",
    is_disabled_by_admin: !!existed?.is_disabled_by_admin,
    can_receive_promo: existed?.can_receive_promo === undefined ? true : !!existed?.can_receive_promo
  };

  recomputeChannelReceivePromo(state.channels[key]);

  markDirty("channels");
  return state.channels[key];
}

async function claimChannelForUser(userId, channelId, options = {}) {
  const user = ensureUserById(userId);
  ensureUserTrialState(user);
  const channel = state.channels[String(channelId)];

  if (!channel) {
    return { ok: false, message: "Channel tidak ditemukan di database." };
  }

  const currentClaim = channel.claimed_by ? String(channel.claimed_by) : "";
  if (currentClaim && currentClaim !== String(userId) && !options.force) {
    return { ok: false, message: `Channel ini sudah diklaim oleh user ${currentClaim}.` };
  }

  const validation = await validateChannelForTrial(channelId);

  channel.claimed_by = String(userId);
  channel.claimed_at = channel.claimed_at || nowISO();
  channel.is_valid_for_trial = validation.ok;
  channel.bot_is_admin = validation.bot_is_admin;
  channel.can_post_messages = validation.can_post_messages;
  channel.subscriber_count = validation.subscriber_count;
  channel.last_checked_at = nowISO();
  channel.status_reason = validation.status_reason;
  channel.updated_at = nowISO();
  markDirty("channels");

  user.trial.valid_targets = ensureArray(user.trial.valid_targets, []).map((id) => String(id));
  user.trial.valid_channels = ensureArray(user.trial.valid_channels, []).map((id) => String(id));

  if (validation.ok) {
    if (!user.trial.valid_channels.includes(String(channelId))) {
      user.trial.valid_channels.push(String(channelId));
    }
    if (!user.trial.valid_targets.includes(String(channelId))) {
      user.trial.valid_targets.push(String(channelId));
    }
  }

  user.updated_at = nowISO();
  markDirty("users");

  const activation = await tryActivateTrialForUser(userId);
  const validCount = ensureArray(user.trial.valid_targets, []).length;

  addLog("channel_claimed", {
    user_id: Number(userId),
    channel_id: String(channelId),
    is_valid_for_trial: validation.ok,
    status_reason: validation.status_reason,
    valid_count: validCount
  });

  return {
    ok: true,
    is_valid_for_trial: validation.ok,
    status_reason: validation.status_reason,
    valid_count: validCount,
    required_count: getTrialRequiredTargets(),
    trial_activated: !!activation.activated
  };
}

async function refreshGroupValidity(group, options = {}) {
  const validateMembers = options.validateMembers !== false;
  if (validateMembers) {
    const validation = await validateGroupForTrial(group.group_id);
    group.member_count = validation.member_count;
    group.real_member_count = validation.member_count;
    group.is_valid_for_trial = validation.ok;
  }
  group.is_active = await checkBotStillInGroup(group.group_id);
  if (!group.is_active && !group.left_at) group.left_at = nowISO();
  group.last_checked_at = nowISO();
  if (options.markSync) group.last_sync_at = nowISO();
  group.updated_at = nowISO();
  recomputeGroupReceivePromo(group);
  markDirty("groups");
}

async function refreshChannelValidity(channel, options = {}) {
  const validatePerm = options.validatePermission !== false;
  if (validatePerm) {
    const validation = await validateChannelForTrial(channel.channel_id);
    channel.subscriber_count = validation.subscriber_count;
    channel.real_subscriber_count = validation.subscriber_count;
    channel.is_valid_for_trial = validation.ok;
    channel.bot_is_admin = validation.bot_is_admin;
    channel.can_post_messages = validation.can_post_messages;
    channel.status_reason = validation.status_reason;
  }
  channel.last_checked_at = nowISO();
  if (options.markSync) channel.last_sync_at = nowISO();
  channel.updated_at = nowISO();
  recomputeChannelReceivePromo(channel);
  markDirty("channels");
}

// ============================================================================
// STARTUP SYNC
// ----------------------------------------------------------------------------
// Telegram Bot API tidak menyediakan endpoint untuk mengambil ulang seluruh
// daftar grup/channel yang sedang dimasuki bot. Karena itu, saat startup bot
// hanya bisa MEMVALIDASI ULANG chat yang sudah tercatat di database. Untuk
// chat lama yang belum tercatat, owner harus pakai /importgroup, /importchannel,
// atau /bulkimportgroups|channels. Lihat config STARTUP_SYNC.
// ============================================================================

async function startupSyncChats() {
  if (!getConfigValue("STARTUP_SYNC.ENABLED", true)) return null;

  const syncGroups = !!getConfigValue("STARTUP_SYNC.SYNC_GROUPS_ON_START", true);
  const syncChannels = !!getConfigValue("STARTUP_SYNC.SYNC_CHANNELS_ON_START", true);
  const validateMembers = !!getConfigValue("STARTUP_SYNC.VALIDATE_MEMBER_COUNT_ON_START", true);
  const validatePerm = !!getConfigValue("STARTUP_SYNC.VALIDATE_CHANNEL_PERMISSION_ON_START", true);
  const delayMs = Number(getConfigValue("STARTUP_SYNC.DELAY_BETWEEN_CHECK_MS", 500)) || 0;
  const maxCheck = Math.max(1, Number(getConfigValue("STARTUP_SYNC.MAX_CHECK_PER_START", 1000)) || 1000);
  const logResult = !!getConfigValue("STARTUP_SYNC.LOG_RESULT", true);

  const summary = {
    groups_total: 0,
    groups_checked: 0,
    groups_active: 0,
    groups_inactive: 0,
    groups_failed: 0,
    channels_total: 0,
    channels_checked: 0,
    channels_active: 0,
    channels_inactive: 0,
    channels_failed: 0,
    started_at: nowISO(),
    finished_at: null
  };

  if (syncGroups) {
    const ids = Object.keys(state.groups || {});
    summary.groups_total = ids.length;
    let checked = 0;
    for (const gid of ids) {
      if (checked >= maxCheck) break;
      const group = state.groups[gid];
      if (!group) continue;
      try {
        await refreshGroupValidity(group, {
          validateMembers,
          markSync: true
        });
        summary.groups_checked += 1;
        if (group.is_active) summary.groups_active += 1;
        else summary.groups_inactive += 1;
      } catch (error) {
        summary.groups_failed += 1;
        if (logResult) {
          addLog("startup_sync_group_error", {
            group_id: gid,
            error: error?.message || String(error)
          });
        }
      }
      checked += 1;
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  if (syncChannels) {
    const ids = Object.keys(state.channels || {});
    summary.channels_total = ids.length;
    let checked = 0;
    for (const cid of ids) {
      if (checked >= maxCheck) break;
      const channel = state.channels[cid];
      if (!channel) continue;
      try {
        await refreshChannelValidity(channel, {
          validatePermission: validatePerm,
          markSync: true
        });
        summary.channels_checked += 1;
        if (channel.is_active) summary.channels_active += 1;
        else summary.channels_inactive += 1;
      } catch (error) {
        summary.channels_failed += 1;
        if (logResult) {
          addLog("startup_sync_channel_error", {
            channel_id: cid,
            error: error?.message || String(error)
          });
        }
      }
      checked += 1;
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  summary.finished_at = nowISO();
  if (logResult) addLog("startup_sync_done", summary);

  await flushDirtyData();
  return summary;
}

// ============================================================================
// AUTO-SAVE CHAT FROM UPDATE
// ----------------------------------------------------------------------------
// Setiap kali bot menerima update dari grup/supergroup/channel, simpan/refresh
// data dasar (title, username, last_seen_at, detected_source). Ini melengkapi
// startup sync untuk chat yang belum tercatat.
// ============================================================================

function autoSaveGroupFromUpdate(chat) {
  if (!chat?.id) return;
  if (!["group", "supergroup"].includes(chat.type)) return;
  if (!getConfigValue("STARTUP_SYNC.AUTO_SAVE_CHAT_FROM_UPDATE", true)) return;

  const key = String(chat.id);
  const existed = state.groups[key];
  const nowTs = nowISO();
  if (!existed) {
    state.groups[key] = {
      group_id: key,
      title: chat.title || "Untitled Group",
      username: chat.username || null,
      member_count: 0,
      real_member_count: 0,
      added_by: "",
      added_at: nowTs,
      last_checked_at: nowTs,
      last_seen_at: nowTs,
      last_sync_at: null,
      detected_source: "auto_save_from_update",
      left_at: null,
      is_active: true,
      is_valid_for_trial: false,
      claimed_by: "",
      updated_at: nowTs,
      is_blacklisted: false,
      blacklist_reason: "",
      is_disabled_by_admin: false,
      can_receive_promo: true
    };
    recomputeGroupReceivePromo(state.groups[key]);
  } else {
    existed.title = chat.title || existed.title;
    existed.username = chat.username || existed.username || null;
    existed.last_seen_at = nowTs;
    existed.updated_at = nowTs;
    if (!existed.detected_source) existed.detected_source = "auto_save_from_update";
  }
  markDirty("groups");
}

function autoSaveChannelFromUpdate(chat) {
  if (!chat?.id) return;
  if (chat.type !== "channel") return;
  if (!getConfigValue("STARTUP_SYNC.AUTO_SAVE_CHAT_FROM_UPDATE", true)) return;

  const key = String(chat.id);
  const existed = state.channels[key];
  const nowTs = nowISO();
  if (!existed) {
    state.channels[key] = {
      channel_id: key,
      title: chat.title || "Untitled Channel",
      username: chat.username || null,
      subscriber_count: 0,
      real_subscriber_count: 0,
      added_at: nowTs,
      added_by: null,
      claimed_by: null,
      claimed_at: null,
      is_active: true,
      is_valid_for_trial: false,
      bot_is_admin: false,
      can_post_messages: false,
      last_checked_at: nowTs,
      last_seen_at: nowTs,
      last_sync_at: null,
      detected_source: "auto_save_from_update",
      status_reason: "auto_saved",
      updated_at: nowTs,
      is_blacklisted: false,
      blacklist_reason: "",
      is_disabled_by_admin: false,
      can_receive_promo: true
    };
    recomputeChannelReceivePromo(state.channels[key]);
  } else {
    existed.title = chat.title || existed.title;
    existed.username = chat.username || existed.username || null;
    existed.last_seen_at = nowTs;
    existed.updated_at = nowTs;
    if (!existed.detected_source) existed.detected_source = "auto_save_from_update";
  }
  markDirty("channels");
}

// ============================================================================
// MANUAL IMPORT
// ----------------------------------------------------------------------------
// Owner/admin dapat melakukan import manual chat_id grup/channel lama yang
// sudah dimasuki bot tetapi belum tercatat di database.
// ============================================================================

async function importGroupManual(chatId, title, actorId) {
  const key = String(chatId);
  const existed = state.groups[key] || null;
  const nowTs = nowISO();

  state.groups[key] = {
    group_id: key,
    title: title || existed?.title || "Manual Import Group",
    username: existed?.username || null,
    member_count: existed?.member_count || 0,
    real_member_count: existed?.real_member_count || 0,
    added_by: existed?.added_by || Number(actorId) || "",
    added_at: existed?.added_at || nowTs,
    last_checked_at: nowTs,
    last_seen_at: existed?.last_seen_at || nowTs,
    last_sync_at: null,
    detected_source: "manual_import",
    left_at: existed?.left_at || null,
    is_active: existed ? existed.is_active : true,
    is_valid_for_trial: !!existed?.is_valid_for_trial,
    claimed_by: existed?.claimed_by || "",
    updated_at: nowTs,
    is_blacklisted: !!existed?.is_blacklisted,
    blacklist_reason: existed?.blacklist_reason || "",
    is_disabled_by_admin: !!existed?.is_disabled_by_admin,
    can_receive_promo: existed?.can_receive_promo === undefined ? true : !!existed.can_receive_promo
  };
  recomputeGroupReceivePromo(state.groups[key]);
  markDirty("groups");

  // Validasi langsung jika memungkinkan.
  let valid = false;
  let active = false;
  try {
    await refreshGroupValidity(state.groups[key], {
      validateMembers: true,
      markSync: true
    });
    valid = !!state.groups[key].is_valid_for_trial;
    active = !!state.groups[key].is_active;
  } catch (error) {
    addLog("import_group_validate_failed", {
      group_id: key,
      error: error?.message || String(error)
    });
  }

  addLog("group_imported", {
    group_id: key,
    actor_id: Number(actorId) || null,
    is_valid_for_trial: valid,
    is_active: active
  });

  return { ok: true, is_active: active, is_valid_for_trial: valid, group: state.groups[key] };
}

async function importChannelManual(chatId, title, actorId) {
  const key = String(chatId);
  const existed = state.channels[key] || null;
  const nowTs = nowISO();

  state.channels[key] = {
    channel_id: key,
    title: title || existed?.title || "Manual Import Channel",
    username: existed?.username || null,
    subscriber_count: existed?.subscriber_count || 0,
    real_subscriber_count: existed?.real_subscriber_count || 0,
    added_at: existed?.added_at || nowTs,
    added_by: existed?.added_by || Number(actorId) || null,
    claimed_by: existed?.claimed_by || null,
    claimed_at: existed?.claimed_at || null,
    is_active: existed ? existed.is_active : true,
    is_valid_for_trial: !!existed?.is_valid_for_trial,
    bot_is_admin: !!existed?.bot_is_admin,
    can_post_messages: !!existed?.can_post_messages,
    last_checked_at: nowTs,
    last_seen_at: existed?.last_seen_at || nowTs,
    last_sync_at: null,
    detected_source: "manual_import",
    status_reason: existed?.status_reason || "manual_import",
    updated_at: nowTs,
    is_blacklisted: !!existed?.is_blacklisted,
    blacklist_reason: existed?.blacklist_reason || "",
    is_disabled_by_admin: !!existed?.is_disabled_by_admin,
    can_receive_promo: existed?.can_receive_promo === undefined ? true : !!existed.can_receive_promo
  };
  recomputeChannelReceivePromo(state.channels[key]);
  markDirty("channels");

  let valid = false;
  let active = false;
  try {
    await refreshChannelValidity(state.channels[key], {
      validatePermission: true,
      markSync: true
    });
    valid = !!state.channels[key].is_valid_for_trial;
    active = !!state.channels[key].is_active;
  } catch (error) {
    addLog("import_channel_validate_failed", {
      channel_id: key,
      error: error?.message || String(error)
    });
  }

  addLog("channel_imported", {
    channel_id: key,
    actor_id: Number(actorId) || null,
    is_valid_for_trial: valid,
    is_active: active
  });

  return {
    ok: true,
    is_active: active,
    is_valid_for_trial: valid,
    channel: state.channels[key]
  };
}

async function registerChannelFromCurrentChat(chat, actorId) {
  if (!chat?.id) return null;
  if (chat.type !== "channel") return null;

  const channel = await ensureChannelSnapshot(String(chat.id), chat.title || "Unknown Channel", actorId || "");
  if (!channel) return null;

  channel.is_active = true;
  if (!channel.added_by && actorId) {
    channel.added_by = Number(actorId);
  }
  if (!channel.claimed_by && actorId) {
    channel.claimed_by = String(actorId);
    channel.claimed_at = channel.claimed_at || nowISO();
  }
  channel.updated_at = nowISO();
  recomputeChannelReceivePromo(channel);
  markDirty("channels");

  if (channel.claimed_by) {
    await claimChannelForUser(channel.claimed_by, channel.channel_id, { force: true });
  }

  return channel;
}

async function handleCommandMyChannels(msg, user) {
  const mine = Object.values(state.channels).filter(
    (channel) => String(channel.claimed_by || "") === String(user.id)
  );

  if (mine.length === 0) {
    await sendSafeMessage(msg.chat.id, "Kamu belum memiliki channel yang diklaim.");
    return;
  }

  const lines = ["📢 Channel milik kamu:"];
  for (const channel of mine.slice(0, 120)) {
    lines.push(
      `- ${channel.title} (${channel.channel_id}) | sub:${channel.subscriber_count} | ${
        channel.is_active ? "aktif" : "nonaktif"
      } | trial:${channel.is_valid_for_trial ? "valid" : "tidak"}`
    );
  }

  if (mine.length > 120) {
    lines.push(`... ${mine.length - 120} channel lainnya tidak ditampilkan.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandMyTargets(msg, user) {
  const groups = Object.values(state.groups).filter(
    (group) => String(group.claimed_by || "") === String(user.id)
  );
  const channels = Object.values(state.channels).filter(
    (channel) => String(channel.claimed_by || "") === String(user.id)
  );

  const lines = ["🎯 Target milik kamu", "", `Total grup: ${groups.length}`, `Total channel: ${channels.length}`];

  if (groups.length > 0) {
    lines.push("", "Grup:");
    for (const group of groups.slice(0, 50)) {
      lines.push(`- ${group.title} (${group.group_id})`);
    }
    if (groups.length > 50) lines.push(`... ${groups.length - 50} grup lainnya.`);
  }

  if (channels.length > 0) {
    lines.push("", "Channel:");
    for (const channel of channels.slice(0, 50)) {
      lines.push(`- ${channel.title} (${channel.channel_id})`);
    }
    if (channels.length > 50) lines.push(`... ${channels.length - 50} channel lainnya.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function submitPromotionRequest({ user, chatId, target, title, body, source }) {
  const access = evaluatePromotionAccess(user, target);
  if (!access.ok) {
    await sendSafeMessage(chatId, `❌ ${access.message}`);
    return;
  }

  // Owner/admin bisa bypass batas panjang & filter banned word jika config
  // mengizinkan (`PRIVILEGES.{role}.BYPASS_TEXT_LENGTH_LIMIT`, `IMMUNE_TO_FILTER`,
  // `CAN_USE_ANY_WORD`). Default-nya bypass aktif.
  const bypassLength =
    isPrivileged(user.id) && getPrivilegeFlag(user.id, "BYPASS_TEXT_LENGTH_LIMIT");
  if (!bypassLength) {
    const maxPromoLength = Number(
      getSetting(
        "moderation.max_promo_length",
        getConfigValue(
          "LIMITS.MAX_PROMO_TEXT_LENGTH",
          getConfigValue(
            "SECURITY.MAX_PROMO_TEXT_LENGTH",
            getConfigValue("BROADCAST.MAX_MESSAGE_LENGTH", 3500)
          )
        )
      )
    ) || 3500;
    if (String(title || "").length + String(body || "").length > maxPromoLength) {
      addWarningToUser(user, "promo_message_too_long", "system");
      await sendSafeMessage(chatId, `❌ Pesan terlalu panjang. Maksimal ${maxPromoLength} karakter.`);
      return;
    }
  }

  const bypassFilter =
    isPrivileged(user.id) &&
    (getPrivilegeFlag(user.id, "IMMUNE_TO_FILTER") ||
      getPrivilegeFlag(user.id, "CAN_USE_ANY_WORD"));
  if (!bypassFilter) {
    const bannedWord = containsBannedWord(`${title}\n${body}`);
    if (bannedWord) {
      addWarningToUser(user, `banned_word:${bannedWord}`, "system");
      await sendSafeMessage(chatId, `❌ Konten terdeteksi terlarang (${bannedWord}).`);
      return;
    }
  }

  const bodyMeta = parsePromoBodyMeta(body);
  if (bodyMeta.invalid_button) {
    await sendSafeMessage(chatId, "❌ Format tombol URL tidak valid. Gunakan: button:Nama|https://link");
    return;
  }

  const promotionId = randomId("promo");
  const text = buildPromoMessage(title, bodyMeta.body || body);

  const options = {
    disable_web_page_preview: true
  };

  if (bodyMeta.button) {
    options.reply_markup = {
      inline_keyboard: [[{ text: bodyMeta.button.text, url: bodyMeta.button.url }]]
    };
  }

  pushPromotionHistory({
    id: promotionId,
    kind: "promotion",
    source,
    created_by: Number(user.id),
    target,
    title,
    body,
    status: "queued",
    queued_at: nowISO(),
    started_at: null,
    completed_at: null,
    sent_count: 0,
    failed_count: 0,
    total_targets: 0,
    target_groups: 0,
    target_channels: 0,
    target_users: 0
  });

  queuePromotionJob({
    id: promotionId,
    kind: "promotion",
    target,
    text,
    options,
    created_by: Number(user.id),
    notify_chat_id: Number(chatId)
  });

  touchPromotionUsage(user);

  addLog("promotion_queued", {
    promotion_id: promotionId,
    created_by: Number(user.id),
    target,
    source
  });

  await sendSafeMessage(chatId, [
    "✅ Promosi masuk antrian.",
    `ID: ${promotionId}`,
    `Target: ${target}`,
    `Posisi queue: ${promotionQueue.length}`
  ].join("\n"));
}

async function submitAdminBroadcast({ adminId, chatId, scope, text }) {
  const id = randomId("broadcast");

  pushPromotionHistory({
    id,
    kind: "admin_broadcast",
    source: "admin_command",
    created_by: Number(adminId),
    target: scope === "optin" ? "receive_promo_users" : "all_users",
    title: scope === "optin" ? "Admin Broadcast Receive Promo" : "Admin Broadcast All",
    body: text,
    status: "queued",
    queued_at: nowISO(),
    started_at: null,
    completed_at: null,
    sent_count: 0,
    failed_count: 0,
    total_targets: 0,
    target_groups: 0,
    target_channels: 0,
    target_users: 0
  });

  queuePromotionJob({
    id,
    kind: "admin_broadcast",
    scope,
    text,
    notify_chat_id: Number(chatId)
  });

  addLog("admin_broadcast_queued", {
    broadcast_id: id,
    created_by: Number(adminId),
    scope
  });

  await sendSafeMessage(chatId, `✅ Broadcast (${scope}) masuk antrian. ID: ${id}`);
}

function createPromoSession(userId) {
  setSession(userId, {
    type: "create_promo",
    step: "title",
    data: {
      title: "",
      body: "",
      target: ""
    }
  });
}

function getPromoSession(userId) {
  const session = getSession(userId);
  if (!session || session.type !== "create_promo") return null;
  return session;
}

// Susun keyboard target promosi berdasarkan paket user. Trial Basic: hanya
// "Share ke Grup". Pro: grup/channel/grup+channel. VIP: semua. Owner/admin
// dengan privilege bypass tetap melihat semua opsi.
function buildPromoTargetKeyboardForUser(user) {
  const privilegedFull =
    user &&
    isPrivileged(user.id) &&
    (getPrivilegeFlag(user.id, "BYPASS_PROMO_TARGET_LIMIT") ||
      getPrivilegeFlag(user.id, "CAN_USE_ALL_FEATURES"));
  const pkg = privilegedFull ? null : getPackageConfig(user?.package);

  const allow = privilegedFull
    ? { group: true, channel: true, both: true, user: true, all: true }
    : {
        group: !!pkg?.can_share_group,
        channel: !!pkg?.can_share_channel,
        both: !!pkg?.can_share_group && !!pkg?.can_share_channel,
        user: !!pkg?.can_share_user,
        all: !!pkg?.can_share_all
      };

  const rows = [];
  const row1 = [];
  if (allow.group) row1.push({ text: "Share ke Grup", callback_data: "promo_target_group" });
  if (allow.channel) row1.push({ text: "Share ke Channel", callback_data: "promo_target_channel" });
  if (row1.length) rows.push(row1);

  const row2 = [];
  if (allow.both) row2.push({ text: "Grup + Channel", callback_data: "promo_target_target" });
  if (allow.user) row2.push({ text: "Share ke User", callback_data: "promo_target_user" });
  if (row2.length) rows.push(row2);

  if (allow.all) rows.push([{ text: "Share Semua", callback_data: "promo_target_all" }]);

  if (rows.length === 0) {
    rows.push([{ text: "Tidak ada target tersedia", callback_data: "noop" }]);
  }
  return { inline_keyboard: rows };
}

async function sendPromoTargetPrompt(chatId, user) {
  const isTrial = user?.package === "trial" && !isPrivileged(user?.id);
  const note = isTrial
    ? "Pilih target promosi (Trial Basic hanya bisa kirim ke grup):"
    : "Pilih target promosi:";
  await sendSafeMessage(chatId, note, {
    reply_markup: buildPromoTargetKeyboardForUser(user || {})
  });
}

async function sendPromoConfirmPrompt(chatId, session, user) {
  ensureUserTrialState(user);
  const targetLabel = formatTargetLabel(session.data.target);
  const packageLabel = formatPackageLabel(user.package);
  const delaySeconds = isAdmin(user.id) ? 0 : getPackageDelaySeconds(user.package);

  let quotaText = "∞ (admin)";
  if (!isAdmin(user.id)) {
    if (user.package === "trial") {
      const remaining = Math.max(0, Number(user.trial.promo_limit || 0) - Number(user.trial.promo_used || 0));
      quotaText = `${remaining} sisa (${user.trial.promo_used}/${user.trial.promo_limit} terpakai)`;
    } else {
      resetDailyCounterIfNeeded(user);
      const dailyLimit = getDailyPromoLimit(user.package);
      quotaText = dailyLimit > 0 ? `${Math.max(0, dailyLimit - user.daily_promo_count)} sisa hari ini` : "Tidak dibatasi";
    }
  }

  const summary = [
    "Konfirmasi promosi:",
    `Judul: ${session.data.title}`,
    `Isi: ${session.data.body}`,
    `Target: ${targetLabel}`,
    `Paket: ${packageLabel}`,
    `Sisa limit: ${quotaText}`,
    `Delay paket: ${delaySeconds} detik`,
    "",
    "Kirim sekarang?"
  ].join("\n");

  await sendSafeMessage(chatId, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Kirim", callback_data: "promo_confirm_send" },
          { text: "❌ Batal", callback_data: "promo_confirm_cancel" }
        ]
      ]
    }
  });
}

async function handlePromoSessionText(msg, user) {
  const session = getPromoSession(user.id);
  if (!session) return false;

  const text = String(msg.text || "").trim();
  if (!text) {
    await sendSafeMessage(msg.chat.id, "Input tidak boleh kosong.");
    return true;
  }

  if (session.step === "title") {
    session.data.title = text;
    session.step = "body";
    setSession(user.id, session);
    await sendSafeMessage(msg.chat.id, "Masukkan isi promosi:");
    return true;
  }

  if (session.step === "body") {
    session.data.body = text;
    session.step = "target";
    setSession(user.id, session);
    await sendPromoTargetPrompt(msg.chat.id, user);
    const isTrial = user?.package === "trial" && !isPrivileged(user.id);
    await sendSafeMessage(
      msg.chat.id,
      isTrial
        ? "Ketik juga bisa: grup (Trial Basic hanya boleh ke grup)"
        : "Ketik juga bisa: grup / channel / target / user / all"
    );
    return true;
  }

  if (session.step === "target") {
    const target = normalizeTargetInput(text);
    if (!target) {
      await sendSafeMessage(msg.chat.id, "Target tidak valid. Pilih: grup, channel, target, user, atau all.");
      return true;
    }

    const accessCheck = evaluatePromotionAccess(user, target);
    if (!accessCheck.ok) {
      await sendSafeMessage(msg.chat.id, `❌ ${accessCheck.message}`);
      return true;
    }

    session.data.target = target;
    session.step = "confirm";
    setSession(user.id, session);
    await sendPromoConfirmPrompt(msg.chat.id, session, user);
    await sendSafeMessage(msg.chat.id, "Atau ketik: YA untuk kirim, BATAL untuk batalkan.");
    return true;
  }

  if (session.step === "confirm") {
    const normalized = text.toLowerCase();
    if (["ya", "y", "kirim", "ok"].includes(normalized)) {
      await submitPromotionRequest({
        user,
        chatId: msg.chat.id,
        target: session.data.target,
        title: session.data.title,
        body: session.data.body,
        source: "wizard"
      });
      clearSession(user.id);
      return true;
    }

    if (["batal", "cancel", "tidak", "n"].includes(normalized)) {
      clearSession(user.id);
      await sendSafeMessage(msg.chat.id, "Flow promosi dibatalkan.");
      return true;
    }

    await sendSafeMessage(msg.chat.id, "Ketik YA untuk kirim atau BATAL untuk membatalkan.");
    return true;
  }

  return false;
}

async function handleCommandStart(msg, user) {
  ensureUserTrialState(user);
  const isFirstStart = !user.has_started;
  user.has_started = true;
  ensureUserReceivePromoState(user);

  // Auto receive promo saat pertama /start untuk user biasa (tanpa override)
  const autoReceive = !!getConfigValue("USERS.AUTO_RECEIVE_PROMO_AFTER_START", true);
  if (isFirstStart && autoReceive && !user.can_custom_receive_promo) {
    user.is_receive_promo = true;
    user.is_opt_in = true;
  }

  if (user.role === "owner") {
    user.package = "owner";
    user.package_started_at = null;
    user.package_expired_at = null;
  }

  user.updated_at = nowISO();
  markDirty("users");

  await sendSafeMessage(
    msg.chat.id,
    [
      `Halo ${user.first_name || "teman"}!`,
      "Bot ini adalah jasa share promosi yang aman.",
      "User yang sudah /start otomatis masuk daftar penerima promo.",
      user.can_custom_receive_promo
        ? "Kamu bisa ubah status receive promo via /receivepromo_on atau /receivepromo_off."
        : "Status receive promo user biasa aktif otomatis dan tidak perlu diubah.",
      "Gunakan menu di bawah untuk lanjut."
    ].join("\n"),
    {
      reply_markup: getMainMenuKeyboard(user)
    }
  );

  // Tampilkan notifikasi pending (mis. hasil deteksi bot masuk grup/channel
  // saat user belum pernah /start). Lihat config NOTIFICATIONS.
  await flushPendingNotificationsToUser(msg.chat.id, user.id);
}

async function flushPendingNotificationsToUser(chatId, userId) {
  if (!getConfigValue("NOTIFICATIONS.SHOW_PENDING_NOTIFICATION_ON_START", true)) {
    return 0;
  }
  const list = getPendingNotifications(userId);
  if (!list.length) return 0;

  const header = [
    "📬 Notifikasi tertunda saat kamu belum /start:",
    `Total: ${list.length} notifikasi.`,
    ""
  ].join("\n");
  await sendSafeMessage(chatId, header);

  for (const item of list) {
    const text =
      item.text ||
      formatJoinStatusMessage({
        type: item.type === "bot_joined_channel" ? "channel" : "group",
        chat_id: item.chat_id,
        title: item.title,
        real_count: item.real_member_count,
        trial_status_valid: item.trial_status === "valid",
        valid_count: item.valid_count,
        required_count: item.required_count,
        reasons: item.reasons
      });
    try {
      await sendSafeMessage(chatId, text);
    } catch {
      // ignore
    }
  }

  const cleared = clearPendingNotifications(userId);
  addLog("pending_notifications_flushed", {
    user_id: Number(userId),
    count: cleared
  });
  return cleared;
}

function buildChannelClaimKeyboard(items) {
  const rows = [];
  for (const channel of items.slice(0, 20)) {
    rows.push([
      {
        text: `${channel.title} (${channel.channel_id})`,
        callback_data: `claimchannel_select:${channel.channel_id}`
      }
    ]);
  }
  if (rows.length === 0) {
    rows.push([{ text: "Tidak ada channel", callback_data: "noop" }]);
  }
  return { inline_keyboard: rows };
}

async function handleCommandClaimChannel(msg, user, argsText) {
  if (!isPrivateChat(msg)) {
    await sendSafeMessage(msg.chat.id, "Gunakan /claimchannel di private chat dengan bot.");
    return;
  }

  const directId = parseArgsBySpace(argsText)[0];
  if (directId) {
    if (!state.channels[String(directId)]) {
      await sendSafeMessage(msg.chat.id, "Channel ID belum terdeteksi. Tambahkan bot ke channel dulu.");
      return;
    }
    const result = await claimChannelForUser(user.id, String(directId));
    if (!result.ok) {
      await sendSafeMessage(msg.chat.id, `❌ ${result.message}`);
      return;
    }
    await sendSafeMessage(
      msg.chat.id,
      [
        "✅ Klaim channel berhasil.",
        `Status trial: ${result.is_valid_for_trial ? "valid" : "tidak valid"}`,
        `Alasan status: ${result.status_reason}`,
        `Progress trial: ${result.valid_count}/${result.required_count}`
      ].join("\n")
    );
    return;
  }

  const candidates = Object.values(state.channels)
    .filter((channel) => channel.is_active)
    .filter((channel) => !channel.is_blacklisted)
    .filter(
      (channel) => !channel.claimed_by || String(channel.claimed_by) === String(user.id)
    )
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

  if (candidates.length === 0) {
    await sendSafeMessage(
      msg.chat.id,
      "Belum ada channel yang bisa diklaim. Tambahkan bot ke channel dan jadikan admin dulu."
    );
    return;
  }

  await sendSafeMessage(msg.chat.id, "Pilih channel untuk diklaim:", {
    reply_markup: buildChannelClaimKeyboard(candidates)
  });
}

async function handleCommandClaimTrial(msg, user, argsText) {
  if (["group", "supergroup"].includes(msg.chat.type)) {
    await handleCommandClaimGroup(msg, user, argsText);
    return;
  }

  if (msg.chat.type === "channel") {
    await sendSafeMessage(
      msg.chat.id,
      "Untuk channel, gunakan /claimchannel di private chat setelah bot dijadikan admin."
    );
    return;
  }

  const targetId = parseArgsBySpace(argsText)[0];
  if (!targetId) {
    await sendSafeMessage(
      msg.chat.id,
      "Gunakan /claimtrial di grup, atau dari private dengan /claimtrial CHAT_ID"
    );
    return;
  }

  const key = String(targetId);
  if (state.groups[key]) {
    const result = await claimGroupForUser(user.id, key);
    if (!result.ok) {
      await sendSafeMessage(msg.chat.id, `❌ ${result.message}`);
      return;
    }
    await sendSafeMessage(
      msg.chat.id,
      `✅ Grup ${key} berhasil diklaim. Progress: ${result.valid_count}/${result.required_count}`
    );
    return;
  }

  if (state.channels[key]) {
    const result = await claimChannelForUser(user.id, key);
    if (!result.ok) {
      await sendSafeMessage(msg.chat.id, `❌ ${result.message}`);
      return;
    }
    await sendSafeMessage(
      msg.chat.id,
      `✅ Channel ${key} berhasil diklaim. Progress: ${result.valid_count}/${result.required_count}`
    );
    return;
  }

  await sendSafeMessage(msg.chat.id, "Chat ID tidak ditemukan di database grup/channel.");
}

function formatJsonBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function estimateDatabaseSize() {
  let total = 0;
  const files = Object.values(FILES);
  for (const fp of files) {
    try {
      const stat = await fs.stat(fp);
      total += Number(stat.size || 0);
    } catch {
      // ignore missing files
    }
  }
  return total;
}

function filterChannelsByMode(mode) {
  const channels = Object.values(state.channels);
  if (mode === "active") return channels.filter((item) => item.is_active);
  if (mode === "inactive") return channels.filter((item) => !item.is_active);
  if (mode === "valid") return channels.filter((item) => item.is_valid_for_trial);
  if (mode === "invalid") return channels.filter((item) => !item.is_valid_for_trial);
  return channels;
}

async function handleCommandChannels(msg, mode = "all") {
  const channels = filterChannelsByMode(mode);
  if (channels.length === 0) {
    await sendSafeMessage(msg.chat.id, "Data channel kosong.");
    return;
  }

  const lines = [
    mode === "active"
      ? "📢 Channel aktif"
      : mode === "inactive"
      ? "📭 Channel nonaktif"
      : mode === "valid"
      ? "✅ Channel valid"
      : mode === "invalid"
      ? "⚠️ Channel tidak valid"
      : "📢 Semua channel"
  ];

  for (const channel of channels.slice(0, 180)) {
    lines.push(
      `- ${channel.title} (${channel.channel_id}) | sub:${channel.subscriber_count} | ${
        channel.is_active ? "aktif" : "nonaktif"
      } | trial:${channel.is_valid_for_trial ? "valid" : "tidak"}`
    );
  }

  if (channels.length > 180) {
    lines.push(`... ${channels.length - 180} channel lainnya tidak ditampilkan.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandChannelInfo(msg, argsText) {
  const channelId = parseArgsBySpace(argsText)[0];
  if (!channelId) {
    await sendSafeMessage(msg.chat.id, "Format: /channel CHANNEL_ID");
    return;
  }

  const channel = state.channels[String(channelId)];
  if (!channel) {
    await sendSafeMessage(msg.chat.id, "Channel tidak ditemukan.");
    return;
  }

  await sendSafeMessage(
    msg.chat.id,
    [
      "📢 Detail channel",
      `ID: ${channel.channel_id}`,
      `Title: ${channel.title}`,
      `Username: ${channel.username || "-"}`,
      `Subscriber: ${channel.subscriber_count}`,
      `Aktif: ${channel.is_active ? "Ya" : "Tidak"}`,
      `Bot admin: ${channel.bot_is_admin ? "Ya" : "Tidak"}`,
      `Bisa post: ${channel.can_post_messages ? "Ya" : "Tidak"}`,
      `Valid trial: ${channel.is_valid_for_trial ? "Ya" : "Tidak"}`,
      `Claimed by: ${channel.claimed_by || "-"}`,
      `Status reason: ${channel.status_reason || "-"}`
    ].join("\n")
  );
}

async function requestDangerConfirm(chatId, adminId, action, payload = {}) {
  setSession(adminId, {
    type: "danger_confirm",
    step: "wait",
    data: {
      action,
      payload,
      chat_id: chatId
    }
  });

  await sendSafeMessage(chatId, `Konfirmasi aksi berbahaya: ${action}?`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Ya, lanjutkan", callback_data: `danger_confirm:${action}` },
          { text: "❌ Batal", callback_data: "danger_cancel" }
        ]
      ]
    }
  });
}

async function executeDangerAction(action) {
  if (action === "cleargroups") {
    state.groups = {};
    markDirty("groups");
    return "Semua grup berhasil dibersihkan.";
  }

  if (action === "clearchannels") {
    state.channels = {};
    markDirty("channels");
    return "Semua channel berhasil dibersihkan.";
  }

  if (action === "clearlogs") {
    state.logs = [];
    markDirty("logs");
    return "Semua log berhasil dibersihkan.";
  }

  if (action === "shutdown") {
    setTimeout(() => {
      shutdown("admin_command").catch(() => {
        process.exit(0);
      });
    }, 300);
    return "Bot akan shutdown dengan aman.";
  }

  return "Aksi tidak dikenal.";
}

async function handleExtendedAdminCommand(msg, command, argsText) {
  const args = parseArgsBySpace(argsText);

  if (command === "todaystats") {
    const today = todayKey();
    const promos = state.promotions.filter((item) => String(item.queued_at || "").startsWith(today));
    const success = promos.filter((item) => item.status === "done").length;
    const failed = promos.filter((item) => ["failed", "cancelled"].includes(item.status)).length;
    await sendSafeMessage(
      msg.chat.id,
      [
        "📅 Today Stats",
        `Tanggal: ${today}`,
        `Total promosi: ${promos.length}`,
        `Sukses: ${success}`,
        `Gagal: ${failed}`
      ].join("\n")
    );
    return;
  }

  if (command === "botstatus") {
    const dbBytes = await estimateDatabaseSize();
    await sendSafeMessage(
      msg.chat.id,
      [
        "🤖 Bot Status",
        `Queue: ${promotionQueue.length}`,
        `Processing queue: ${isProcessingPromotionQueue ? "ya" : "tidak"}`,
        `Session aktif: ${sessions.size}`,
        `Ukuran DB JSON: ${formatJsonBytes(dbBytes)}`
      ].join("\n")
    );
    return;
  }

  if (command === "healthcheck") {
    await sendSafeMessage(msg.chat.id, "✅ Healthcheck OK. Bot berjalan normal.");
    return;
  }

  // ==========================================================================
  // SILENT JOIN / STARTUP SYNC / MANUAL IMPORT COMMANDS
  // ==========================================================================
  if (
    command === "recentjoins" ||
    command === "recentgroups" ||
    command === "recentchannels"
  ) {
    const limit = Number(getConfigValue("NOTIFICATIONS.MAX_RECENT_JOINS_DISPLAY", 30)) || 30;
    const groups = command === "recentchannels" ? [] : Object.values(state.groups || {});
    const channels = command === "recentgroups" ? [] : Object.values(state.channels || {});

    const sortByAdded = (a, b) =>
      new Date(b.added_at || 0).getTime() - new Date(a.added_at || 0).getTime();

    const lines = [];
    if (groups.length) {
      lines.push("👥 Recent Groups:");
      for (const g of [...groups].sort(sortByAdded).slice(0, limit)) {
        lines.push(
          `- ${g.title || g.group_id} (${g.group_id}) | aktif:${g.is_active ? "✓" : "✗"} | ` +
            `valid:${g.is_valid_for_trial ? "✓" : "✗"} | member:${g.real_member_count || 0} | ` +
            `src:${g.detected_source || "-"} | added:${g.added_at || "-"}`
        );
      }
      lines.push("");
    }
    if (channels.length) {
      lines.push("📢 Recent Channels:");
      for (const c of [...channels].sort(sortByAdded).slice(0, limit)) {
        lines.push(
          `- ${c.title || c.channel_id} (${c.channel_id}) | aktif:${c.is_active ? "✓" : "✗"} | ` +
            `valid:${c.is_valid_for_trial ? "✓" : "✗"} | sub:${c.real_subscriber_count || 0} | ` +
            `admin:${c.bot_is_admin ? "✓" : "✗"} | post:${c.can_post_messages ? "✓" : "✗"} | ` +
            `src:${c.detected_source || "-"} | added:${c.added_at || "-"}`
        );
      }
    }
    if (!lines.length) lines.push("Belum ada data grup/channel terdeteksi.");
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "pendingnotifications") {
    const total = countAllPendingNotifications();
    const lines = [`📬 Total notifikasi pending: ${total}`];
    const buckets = state.pendingNotifications || {};
    let usersShown = 0;
    for (const [uid, list] of Object.entries(buckets)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      lines.push("", `User ${uid} (${list.length} notifikasi):`);
      for (const item of list.slice(-5)) {
        lines.push(`- [${item.type}] ${item.title || ""} (${item.chat_id}) | ${item.created_at}`);
      }
      usersShown += 1;
      if (usersShown >= 25) {
        lines.push("... (dipotong)");
        break;
      }
    }
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "importgroup") {
    const chatId = args[0];
    const title = args.slice(1).join(" ").trim();
    if (!chatId) {
      await sendSafeMessage(msg.chat.id, "Format: /importgroup GROUP_ID NAMA_GRUP");
      return;
    }
    const result = await importGroupManual(chatId, title || null, msg.from.id);
    await sendSafeMessage(
      msg.chat.id,
      [
        "📥 Import Grup",
        `ID: ${chatId}`,
        `Aktif: ${result.is_active ? "ya" : "tidak"}`,
        `Valid trial: ${result.is_valid_for_trial ? "ya" : "tidak"}`
      ].join("\n")
    );
    return;
  }

  if (command === "importchannel") {
    const chatId = args[0];
    const title = args.slice(1).join(" ").trim();
    if (!chatId) {
      await sendSafeMessage(msg.chat.id, "Format: /importchannel CHANNEL_ID NAMA_CHANNEL");
      return;
    }
    const result = await importChannelManual(chatId, title || null, msg.from.id);
    await sendSafeMessage(
      msg.chat.id,
      [
        "📥 Import Channel",
        `ID: ${chatId}`,
        `Aktif: ${result.is_active ? "ya" : "tidak"}`,
        `Valid trial: ${result.is_valid_for_trial ? "ya" : "tidak"}`
      ].join("\n")
    );
    return;
  }

  if (command === "bulkimportgroups" || command === "bulkimportchannels") {
    const isGroup = command === "bulkimportgroups";
    const lines = String(argsText || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      await sendSafeMessage(
        msg.chat.id,
        [
          `Format: /${command} (multi-line, satu baris satu chat).`,
          isGroup
            ? "Contoh tiap baris: -1001234567890 Nama Grup"
            : "Contoh tiap baris: -1009876543210 Nama Channel"
        ].join("\n")
      );
      return;
    }

    let success = 0;
    let active = 0;
    let valid = 0;
    const failures = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const chatId = parts.shift();
      const title = parts.join(" ").trim();
      if (!chatId) {
        failures.push(line);
        continue;
      }
      try {
        const result = isGroup
          ? await importGroupManual(chatId, title || null, msg.from.id)
          : await importChannelManual(chatId, title || null, msg.from.id);
        if (result.ok) {
          success += 1;
          if (result.is_active) active += 1;
          if (result.is_valid_for_trial) valid += 1;
        } else {
          failures.push(chatId);
        }
      } catch (error) {
        failures.push(`${chatId} (${error?.message || error})`);
      }
    }

    const out = [
      `📥 Bulk Import ${isGroup ? "Grup" : "Channel"}`,
      `Total: ${lines.length} | Sukses: ${success} | Aktif: ${active} | Valid trial: ${valid}`
    ];
    if (failures.length) {
      out.push("Gagal:");
      out.push(...failures.slice(0, 20).map((f) => `- ${f}`));
      if (failures.length > 20) out.push(`... ${failures.length - 20} lainnya.`);
    }
    await sendLongMessage(msg.chat.id, out.join("\n"));
    return;
  }

  if (command === "syncgroups" || command === "syncchannels" || command === "syncchats") {
    const validateMembers = !!getConfigValue("STARTUP_SYNC.VALIDATE_MEMBER_COUNT_ON_START", true);
    const validatePerm = !!getConfigValue("STARTUP_SYNC.VALIDATE_CHANNEL_PERMISSION_ON_START", true);
    const summary = {
      groups_total: 0,
      groups_active: 0,
      groups_failed: 0,
      channels_total: 0,
      channels_active: 0,
      channels_failed: 0
    };
    if (command !== "syncchannels") {
      const ids = Object.keys(state.groups || {});
      summary.groups_total = ids.length;
      for (const gid of ids) {
        try {
          await refreshGroupValidity(state.groups[gid], {
            validateMembers,
            markSync: true
          });
          if (state.groups[gid].is_active) summary.groups_active += 1;
        } catch {
          summary.groups_failed += 1;
        }
      }
    }
    if (command !== "syncgroups") {
      const ids = Object.keys(state.channels || {});
      summary.channels_total = ids.length;
      for (const cid of ids) {
        try {
          await refreshChannelValidity(state.channels[cid], {
            validatePermission: validatePerm,
            markSync: true
          });
          if (state.channels[cid].is_active) summary.channels_active += 1;
        } catch {
          summary.channels_failed += 1;
        }
      }
    }
    await flushDirtyData();
    addLog("manual_sync_done", { command, ...summary, by: Number(msg.from.id) });
    await sendSafeMessage(
      msg.chat.id,
      [
        `🔄 ${command} selesai.`,
        `Grup: ${summary.groups_active}/${summary.groups_total} aktif (gagal: ${summary.groups_failed})`,
        `Channel: ${summary.channels_active}/${summary.channels_total} aktif (gagal: ${summary.channels_failed})`
      ].join("\n")
    );
    return;
  }

  if (command === "searchuser") {
    const keyword = String(argsText || "").trim().toLowerCase();
    if (!keyword) {
      await sendSafeMessage(msg.chat.id, "Format: /searchuser KEYWORD");
      return;
    }
    const found = Object.values(state.users).filter((u) => {
      const idStr = String(u.id || "");
      const username = String(u.username || "").toLowerCase();
      const firstName = String(u.first_name || "").toLowerCase();
      return idStr.includes(keyword) || username.includes(keyword) || firstName.includes(keyword);
    });

    if (found.length === 0) {
      await sendSafeMessage(msg.chat.id, "User tidak ditemukan.");
      return;
    }

    const lines = ["🔎 Hasil search user:"];
    for (const u of found.slice(0, 120)) {
      lines.push(`- ${u.id} | ${u.username ? `@${u.username}` : "-"} | ${u.package}`);
    }
    if (found.length > 120) lines.push(`... ${found.length - 120} user lainnya.`);
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "warn") {
    const targetId = args[0];
    const reason = args.slice(1).join(" ") || "unspecified";
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /warn USER_ID ALASAN");
      return;
    }
    if (isPrivileged(targetId)) {
      const protectedMsg = String(
        getConfigValue(
          "MESSAGES.OWNER_ADMIN_PROTECTED",
          "❌ Tidak bisa memban owner/admin. Role owner dan admin dilindungi dari ban."
        )
      );
      await sendSafeMessage(msg.chat.id, protectedMsg);
      return;
    }
    const targetUser = ensureUserById(targetId);
    addWarningToUser(targetUser, reason, `admin:${msg.from.id}`);
    await sendSafeMessage(
      msg.chat.id,
      `✅ Warning ditambahkan ke user ${targetId}. Total warning: ${targetUser.warning_count}`
    );
    return;
  }

  if (command === "warnings") {
    const targetId = args[0];
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /warnings USER_ID");
      return;
    }
    const targetUser = ensureUserById(targetId);
    const rows = ensureArray(targetUser.warnings, []);
    if (rows.length === 0) {
      await sendSafeMessage(msg.chat.id, "User belum memiliki warning.");
      return;
    }
    const lines = [`⚠️ Warning user ${targetId} (total ${rows.length}):`];
    for (const row of rows.slice(-30)) {
      lines.push(`- ${row.at} | ${row.actor || "system"} | ${row.reason || "-"}`);
    }
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "resetwarn") {
    const targetId = args[0];
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /resetwarn USER_ID");
      return;
    }
    const targetUser = ensureUserById(targetId);
    targetUser.warning_count = 0;
    targetUser.warnings = [];
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ Warning user ${targetId} direset.`);
    return;
  }

  if (command === "extend") {
    const targetId = args[0];
    const duration = args[1];
    if (!targetId || !duration) {
      await sendSafeMessage(msg.chat.id, "Format: /extend USER_ID DURASI");
      return;
    }
    const targetUser = ensureUserById(targetId);
    if (!targetUser.package || targetUser.package === "free") {
      await sendSafeMessage(msg.chat.id, "User belum punya paket aktif.");
      return;
    }
    const ms = parseDurationToMs(duration);
    if (!ms) {
      await sendSafeMessage(msg.chat.id, "Durasi tidak valid.");
      return;
    }
    const currentExpiry = Date.parse(targetUser.package_expired_at || nowISO());
    const base = Number.isFinite(currentExpiry) && currentExpiry > Date.now() ? currentExpiry : Date.now();
    targetUser.package_expired_at = new Date(base + ms).toISOString();
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ Paket user ${targetId} diperpanjang sampai ${targetUser.package_expired_at}`);
    return;
  }

  if (command === "resetlimit") {
    const targetId = args[0];
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /resetlimit USER_ID");
      return;
    }
    const targetUser = ensureUserById(targetId);
    targetUser.daily_promo_count = 0;
    targetUser.daily_promo_date = todayKey();
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ Limit harian user ${targetId} direset.`);
    return;
  }

  if (command === "resetcooldown") {
    const targetId = args[0];
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /resetcooldown USER_ID");
      return;
    }
    const targetUser = ensureUserById(targetId);
    targetUser.last_promo_at = null;
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ Cooldown user ${targetId} direset.`);
    return;
  }

  if (command === "setrole") {
    if (!isOwner(msg.from.id)) {
      await sendSafeMessage(msg.chat.id, "Hanya owner yang boleh mengubah role admin/user.");
      return;
    }
    const targetId = args[0];
    const roleName = String(args[1] || "").toLowerCase();
    if (!targetId || !["admin", "user"].includes(roleName)) {
      await sendSafeMessage(msg.chat.id, "Format: /setrole USER_ID admin|user");
      return;
    }
    const ownerId = getConfigValue("OWNER.ID", getConfigValue("OWNER_ID", null));
    if (String(targetId) === String(ownerId)) {
      await sendSafeMessage(msg.chat.id, "Role owner tidak dapat diubah.");
      return;
    }
    if (roleName === "admin") ADMIN_SET.add(String(targetId));
    else ADMIN_SET.delete(String(targetId));

    const targetUser = ensureUserById(targetId);
    targetUser.role = resolveRole(targetId);
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ Role user ${targetId} diubah ke ${roleName}.`);
    return;
  }

  if (command === "removeadmin") {
    if (!isOwner(msg.from.id)) {
      await sendSafeMessage(msg.chat.id, "Hanya owner yang boleh menghapus admin.");
      return;
    }
    const targetId = args[0];
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /removeadmin USER_ID");
      return;
    }
    const ownerId = getConfigValue("OWNER.ID", getConfigValue("OWNER_ID", null));
    if (String(targetId) === String(ownerId)) {
      await sendSafeMessage(msg.chat.id, "Owner tidak bisa dihapus dari admin.");
      return;
    }
    ADMIN_SET.delete(String(targetId));
    const targetUser = ensureUserById(targetId);
    targetUser.role = resolveRole(targetId);
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ User ${targetId} dihapus dari admin.`);
    return;
  }

  if (command === "noteuser") {
    const targetId = args[0];
    const note = args.slice(1).join(" ");
    if (!targetId || !note) {
      await sendSafeMessage(msg.chat.id, "Format: /noteuser USER_ID CATATAN");
      return;
    }
    const targetUser = ensureUserById(targetId);
    targetUser.notes = ensureArray(targetUser.notes, []);
    targetUser.notes.push({ at: nowISO(), by: Number(msg.from.id), note });
    targetUser.updated_at = nowISO();
    markDirty("users");
    await sendSafeMessage(msg.chat.id, `✅ Catatan untuk user ${targetId} disimpan.`);
    return;
  }

  if (command === "userlogs") {
    const targetId = args[0];
    if (!targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /userlogs USER_ID");
      return;
    }
    const rows = state.logs.filter((l) => JSON.stringify(l.detail || {}).includes(String(targetId))).slice(-120);
    if (rows.length === 0) {
      await sendSafeMessage(msg.chat.id, "Tidak ada log untuk user tersebut.");
      return;
    }
    const lines = [`📜 Log user ${targetId}:`];
    for (const row of rows) {
      lines.push(`- ${row.created_at} | ${row.type}`);
    }
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "createcustomvoucher") {
    const code = String(args[0] || "").toUpperCase();
    const packageName = String(args[1] || "").toLowerCase();
    const duration = args[2];
    if (!code || !packageName || !duration) {
      await sendSafeMessage(msg.chat.id, "Format: /createcustomvoucher KODE PACKAGE DURASI");
      return;
    }
    if (state.vouchers[code]) {
      await sendSafeMessage(msg.chat.id, "Kode voucher sudah ada.");
      return;
    }
    state.vouchers[code] = {
      code,
      package: packageName,
      duration,
      is_used: false,
      created_by: Number(msg.from.id),
      created_at: nowISO(),
      used_by: null,
      used_at: null,
      expired_at: null,
      is_disabled: false
    };
    markDirty("vouchers");
    await sendSafeMessage(msg.chat.id, `✅ Voucher custom ${code} dibuat.`);
    return;
  }

  if (command === "voucher") {
    const code = String(args[0] || "").toUpperCase();
    if (!code) {
      await sendSafeMessage(msg.chat.id, "Format: /voucher KODE");
      return;
    }
    const v = state.vouchers[code];
    if (!v) {
      await sendSafeMessage(msg.chat.id, "Voucher tidak ditemukan.");
      return;
    }
    await sendSafeMessage(
      msg.chat.id,
      [
        `Kode: ${v.code}`,
        `Paket: ${v.package}`,
        `Durasi: ${v.duration}`,
        `Status: ${v.is_used ? "used" : "unused"}`,
        `Disabled: ${v.is_disabled ? "ya" : "tidak"}`
      ].join("\n")
    );
    return;
  }

  if (command === "deletevoucher") {
    const code = String(args[0] || "").toUpperCase();
    if (!code) {
      await sendSafeMessage(msg.chat.id, "Format: /deletevoucher KODE");
      return;
    }
    if (!state.vouchers[code]) {
      await sendSafeMessage(msg.chat.id, "Voucher tidak ditemukan.");
      return;
    }
    delete state.vouchers[code];
    markDirty("vouchers");
    await sendSafeMessage(msg.chat.id, `✅ Voucher ${code} dihapus.`);
    return;
  }

  if (["disablevoucher", "enablevoucher"].includes(command)) {
    const code = String(args[0] || "").toUpperCase();
    if (!code) {
      await sendSafeMessage(msg.chat.id, `Format: /${command} KODE`);
      return;
    }
    const v = state.vouchers[code];
    if (!v) {
      await sendSafeMessage(msg.chat.id, "Voucher tidak ditemukan.");
      return;
    }
    v.is_disabled = command === "disablevoucher";
    markDirty("vouchers");
    await sendSafeMessage(msg.chat.id, `✅ Voucher ${code} ${v.is_disabled ? "dinonaktifkan" : "diaktifkan"}.`);
    return;
  }

  if (command === "unusedvouchers" || command === "usedvouchers") {
    const used = command === "usedvouchers";
    const rows = Object.values(state.vouchers).filter((v) => !!v.is_used === used);
    if (rows.length === 0) {
      await sendSafeMessage(msg.chat.id, used ? "Tidak ada voucher used." : "Tidak ada voucher unused.");
      return;
    }
    const lines = [used ? "🎟 Voucher used" : "🎟 Voucher unused"];
    for (const v of rows.slice(0, 200)) {
      lines.push(`- ${v.code} | ${v.package} ${v.duration}`);
    }
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "exportvouchers") {
    const lines = Object.values(state.vouchers).map((v) => `${v.code},${v.package},${v.duration},${v.is_used}`);
    await sendLongMessage(msg.chat.id, ["code,package,duration,is_used", ...lines].join("\n"));
    return;
  }

  if (command === "packages") {
    const lines = ["📦 Package config:"];
    for (const [k, v] of Object.entries(state.packages)) {
      lines.push(
        `- ${k}: delay=${v.delay_seconds}s limit=${v.daily_limit} enabled=${v.enabled !== false ? "yes" : "no"}`
      );
    }
    await sendLongMessage(msg.chat.id, lines.join("\n"));
    return;
  }

  if (command === "setlimit") {
    const packageName = String(args[0] || "").toLowerCase();
    const amount = Number(args[1]);
    if (!packageName || !Number.isFinite(amount) || amount < 0) {
      await sendSafeMessage(msg.chat.id, "Format: /setlimit PACKAGE JUMLAH_PER_HARI");
      return;
    }
    state.packages[packageName] = {
      ...getPackageConfig(packageName),
      daily_limit: Math.floor(amount)
    };
    markDirty("packages");
    await sendSafeMessage(msg.chat.id, `✅ Daily limit ${packageName} di-set ${Math.floor(amount)}.`);
    return;
  }

  if (
    [
      "settrialduration",
      "settriallimit",
      "settrialtarget",
      "setrequiredtrialtarget",
      "setmingroupmembers",
      "setmintrialmembers",
      "setminchannelsubs",
      "setmintrialsubs"
    ].includes(command)
  ) {
    state.settings.trial_settings = {
      ...DEFAULT_SETTINGS.trial_settings,
      ...ensureObject(state.settings.trial_settings, {})
    };
    state.settings.trial = {
      ...DEFAULT_SETTINGS.trial,
      ...ensureObject(state.settings.trial, {})
    };
    state.packages.trial = {
      ...DEFAULT_PACKAGES.trial,
      ...ensureObject(state.packages.trial, {})
    };

    if (command === "settrialduration") {
      const duration = String(args[0] || "").trim().toLowerCase();
      if (!duration || !parseDurationToMs(duration)) {
        await sendSafeMessage(msg.chat.id, "Format: /settrialduration DURASI");
        return;
      }

      state.settings.trial_settings.duration = duration;
      state.settings.trial.default_duration = duration;
      state.packages.trial.default_duration = duration;
      state.packages.trial.duration = duration;

      markDirty("settings");
      markDirty("packages");
      await sendSafeMessage(msg.chat.id, `✅ Durasi Trial Basic di-set ke ${duration}.`);
      return;
    }

    if (command === "settriallimit") {
      const amount = Math.floor(Number(args[0]));
      if (!Number.isFinite(amount) || amount < 1) {
        await sendSafeMessage(msg.chat.id, "Format: /settriallimit JUMLAH");
        return;
      }

      state.settings.trial_settings.promo_limit = amount;
      state.settings.trial.promo_limit = amount;
      state.packages.trial.promo_limit = amount;
      state.packages.trial.daily_limit = amount;

      for (const targetUser of Object.values(state.users)) {
        ensureUserTrialState(targetUser);
        targetUser.trial.promo_limit = amount;
        targetUser.updated_at = nowISO();
      }

      markDirty("settings");
      markDirty("packages");
      markDirty("users");
      await sendSafeMessage(msg.chat.id, `✅ Limit promo Trial Basic di-set ke ${amount}.`);
      return;
    }

    if (["settrialtarget", "setrequiredtrialtarget"].includes(command)) {
      const amount = Math.floor(Number(args[0]));
      if (!Number.isFinite(amount) || amount < 1) {
        await sendSafeMessage(msg.chat.id, `Format: /${command} JUMLAH`);
        return;
      }

      state.settings.trial_settings.required_targets = amount;
      state.settings.trial.required_target_count = amount;
      state.packages.trial.required_targets = amount;

      markDirty("settings");
      markDirty("packages");
      await sendSafeMessage(msg.chat.id, `✅ Required target Trial Basic di-set ke ${amount}.`);
      return;
    }

    if (["setmingroupmembers", "setmintrialmembers"].includes(command)) {
      const amount = Math.floor(Number(args[0]));
      if (!Number.isFinite(amount) || amount < 1) {
        await sendSafeMessage(msg.chat.id, `Format: /${command} JUMLAH`);
        return;
      }

      state.settings.trial_settings.min_group_members = amount;
      state.settings.trial.min_group_members = amount;
      state.packages.trial.min_group_members = amount;

      markDirty("settings");
      markDirty("packages");
      await sendSafeMessage(msg.chat.id, `✅ Min member grup Trial Basic di-set ke ${amount}.`);
      return;
    }

    if (["setminchannelsubs", "setmintrialsubs"].includes(command)) {
      const amount = Math.floor(Number(args[0]));
      if (!Number.isFinite(amount) || amount < 1) {
        await sendSafeMessage(msg.chat.id, `Format: /${command} JUMLAH`);
        return;
      }

      state.settings.trial_settings.min_channel_subscribers = amount;
      state.settings.trial.min_channel_subscribers = amount;
      state.packages.trial.min_channel_subscribers = amount;

      markDirty("settings");
      markDirty("packages");
      await sendSafeMessage(msg.chat.id, `✅ Min subscriber channel Trial Basic di-set ke ${amount}.`);
      return;
    }
  }

  if (command === "assigntrialtarget") {
    const targetUserId = args[0];
    const targetId = args[1];
    if (!targetUserId || !targetId) {
      await sendSafeMessage(msg.chat.id, "Format: /assigntrialtarget USER_ID TARGET_ID");
      return;
    }

    const targetUser = state.users[String(targetUserId)];
    if (!targetUser) {
      await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
      return;
    }

    if (state.groups[String(targetId)]) {
      const result = await claimGroupForUser(targetUserId, String(targetId), { force: true });
      if (!result.ok) {
        await sendSafeMessage(msg.chat.id, `❌ Assign group gagal: ${result.message}`);
        return;
      }
      await sendSafeMessage(
        msg.chat.id,
        `✅ Target group ${targetId} di-assign ke ${targetUserId}. Progress: ${result.valid_count}/${result.required_count}`
      );
      return;
    }

    if (state.channels[String(targetId)]) {
      const result = await claimChannelForUser(targetUserId, String(targetId), { force: true });
      if (!result.ok) {
        await sendSafeMessage(msg.chat.id, `❌ Assign channel gagal: ${result.message}`);
        return;
      }
      await sendSafeMessage(
        msg.chat.id,
        `✅ Target channel ${targetId} di-assign ke ${targetUserId}. Progress: ${result.valid_count}/${result.required_count}`
      );
      return;
    }

    await sendSafeMessage(msg.chat.id, "TARGET_ID tidak ditemukan di group/channel database.");
    return;
  }

  if (command === "trialprogress") {
    const targetUserId = args[0];
    if (!targetUserId) {
      await sendSafeMessage(msg.chat.id, "Format: /trialprogress USER_ID");
      return;
    }

    const targetUser = state.users[String(targetUserId)];
    if (!targetUser) {
      await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
      return;
    }

    ensureUserTrialState(targetUser);
    const trialSnapshot = getTrialSettingsSnapshot();
    await sendSafeMessage(
      msg.chat.id,
      [
        `🎁 Trial Progress ${targetUserId}`,
        `Paket: ${formatPackageLabel(targetUser.package)}`,
        `Trial aktif: ${targetUser.trial.is_active ? "Ya" : "Tidak"}`,
        `Pernah pakai trial: ${targetUser.trial.has_used_trial ? "Ya" : "Belum"}`,
        `Progress target: ${targetUser.trial.valid_targets.length}/${trialSnapshot.required_targets}`,
        `- Grup valid: ${targetUser.trial.valid_groups.length}`,
        `- Channel valid: ${targetUser.trial.valid_channels.length}`,
        `Promo trial: ${targetUser.trial.promo_used}/${targetUser.trial.promo_limit}`
      ].join("\n")
    );
    return;
  }

  if (command === "resettrialprogress") {
    const targetUserId = args[0];
    if (!targetUserId) {
      await sendSafeMessage(msg.chat.id, "Format: /resettrialprogress USER_ID");
      return;
    }

    const targetUser = state.users[String(targetUserId)];
    if (!targetUser) {
      await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
      return;
    }

    ensureUserTrialState(targetUser);
    targetUser.trial.valid_targets = [];
    targetUser.trial.valid_groups = [];
    targetUser.trial.valid_channels = [];
    targetUser.trial.promo_used = 0;
    targetUser.trial.promo_limit = getTrialPromoLimit();
    targetUser.updated_at = nowISO();
    markDirty("users");

    await sendSafeMessage(msg.chat.id, `✅ Progress trial user ${targetUserId} direset.`);
    return;
  }

  if (command === "forcetrial") {
    const targetUserId = args[0];
    const duration = String(args[1] || getTrialDuration());
    if (!targetUserId) {
      await sendSafeMessage(msg.chat.id, "Format: /forcetrial USER_ID [DURASI]");
      return;
    }

    const targetUser = state.users[String(targetUserId)];
    if (!targetUser) {
      await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
      return;
    }

    const applied = applyPackageToUser(targetUser, "trial", duration);
    if (!applied.ok) {
      await sendSafeMessage(msg.chat.id, `❌ Gagal force trial: ${applied.message}`);
      return;
    }

    targetUser.trial.has_used_trial = true;
    targetUser.trial.promo_used = 0;
    targetUser.trial.promo_limit = getTrialPromoLimit();
    targetUser.updated_at = nowISO();
    markDirty("users");

    await sendSafeMessage(msg.chat.id, `✅ Trial dipaksa aktif untuk user ${targetUserId} (${duration}).`);
    return;
  }

  if (command === "removetrial") {
    const targetUserId = args[0];
    if (!targetUserId) {
      await sendSafeMessage(msg.chat.id, "Format: /removetrial USER_ID");
      return;
    }

    const targetUser = state.users[String(targetUserId)];
    if (!targetUser) {
      await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
      return;
    }

    if (targetUser.package === "trial") {
      applyPackageToUser(targetUser, "free");
    }

    ensureUserTrialState(targetUser);
    targetUser.trial.is_active = false;
    targetUser.trial.started_at = null;
    targetUser.trial.expired_at = null;
    targetUser.trial.promo_used = 0;
    targetUser.updated_at = nowISO();
    markDirty("users");

    await sendSafeMessage(msg.chat.id, `✅ Trial user ${targetUserId} dinonaktifkan.`);
    return;
  }

  if (["enablepackage", "disablepackage"].includes(command)) {
    const packageName = String(args[0] || "").toLowerCase();
    if (!packageName || !state.packages[packageName]) {
      await sendSafeMessage(msg.chat.id, `Format: /${command} PACKAGE`);
      return;
    }
    state.packages[packageName] = {
      ...state.packages[packageName],
      enabled: command === "enablepackage"
    };
    markDirty("packages");
    await sendSafeMessage(
      msg.chat.id,
      `✅ Package ${packageName} ${command === "enablepackage" ? "diaktifkan" : "dinonaktifkan"}.`
    );
    return;
  }

  if (command === "broadcastuser") {
    await handleCommandBroadcast(msg, argsText, "user");
    return;
  }

  if (command === "broadcastgroup") {
    await handleCommandBroadcast(msg, argsText, "group");
    return;
  }

  if (command === "broadcastchannel") {
    await handleCommandBroadcast(msg, argsText, "channel");
    return;
  }

  if (command === "broadcasttarget") {
    await handleCommandBroadcast(msg, argsText, "target");
    return;
  }

  if (command === "group") {
    await handleCommandGroupInfo(msg, argsText);
    return;
  }

  if (command === "checkgroup") {
    const groupId = args[0];
    if (!groupId || !state.groups[String(groupId)]) {
      await sendSafeMessage(msg.chat.id, "Format: /checkgroup GROUP_ID (harus ada di DB)");
      return;
    }
    await refreshGroupValidity(state.groups[String(groupId)]);
    await sendSafeMessage(msg.chat.id, `✅ Grup ${groupId} divalidasi ulang.`);
    return;
  }

  if (command === "refreshgroups") {
    for (const group of Object.values(state.groups)) {
      await refreshGroupValidity(group);
    }
    await sendSafeMessage(msg.chat.id, "✅ Semua grup berhasil divalidasi ulang.");
    return;
  }

  if (command === "blacklistgroup") {
    const groupId = args[0];
    const reason = args.slice(1).join(" ") || "manual_blacklist";
    const group = state.groups[String(groupId)];
    if (!group) {
      await sendSafeMessage(msg.chat.id, "Format: /blacklistgroup GROUP_ID ALASAN (group harus ada)");
      return;
    }
    group.is_blacklisted = true;
    group.blacklist_reason = reason;
    group.updated_at = nowISO();
    markDirty("groups");
    await sendSafeMessage(msg.chat.id, `✅ Grup ${groupId} di-blacklist.`);
    return;
  }

  if (command === "unblacklistgroup") {
    const groupId = args[0];
    const group = state.groups[String(groupId)];
    if (!group) {
      await sendSafeMessage(msg.chat.id, "Format: /unblacklistgroup GROUP_ID");
      return;
    }
    group.is_blacklisted = false;
    group.blacklist_reason = "";
    group.updated_at = nowISO();
    markDirty("groups");
    await sendSafeMessage(msg.chat.id, `✅ Grup ${groupId} dihapus dari blacklist.`);
    return;
  }

  if (["enablegroup", "disablegroup"].includes(command)) {
    const groupId = String(args[0] || "");
    const group = state.groups[groupId];
    if (!group) {
      await sendSafeMessage(msg.chat.id, `Format: /${command} GROUP_ID (harus ada di DB)`);
      return;
    }

    group.is_disabled_by_admin = command === "disablegroup";
    group.updated_at = nowISO();
    recomputeGroupReceivePromo(group);
    markDirty("groups");

    await sendSafeMessage(
      msg.chat.id,
      `✅ Group ${groupId} ${group.is_disabled_by_admin ? "dinonaktifkan" : "diaktifkan"} untuk target promo.`
    );
    return;
  }

  if (command === "cleargroups") {
    await requestDangerConfirm(msg.chat.id, msg.from.id, "cleargroups");
    return;
  }

  if (command === "channels") {
    await handleCommandChannels(msg, "all");
    return;
  }

  if (command === "activechannels") {
    await handleCommandChannels(msg, "active");
    return;
  }

  if (command === "inactivechannels") {
    await handleCommandChannels(msg, "inactive");
    return;
  }

  if (command === "validchannels") {
    await handleCommandChannels(msg, "valid");
    return;
  }

  if (command === "invalidchannels") {
    await handleCommandChannels(msg, "invalid");
    return;
  }

  if (command === "channel") {
    await handleCommandChannelInfo(msg, argsText);
    return;
  }

  if (command === "removechannel") {
    const channelId = args[0];
    if (!channelId || !state.channels[String(channelId)]) {
      await sendSafeMessage(msg.chat.id, "Format: /removechannel CHANNEL_ID (harus ada di DB)");
      return;
    }
    delete state.channels[String(channelId)];
    markDirty("channels");
    await sendSafeMessage(msg.chat.id, `✅ Channel ${channelId} dihapus.`);
    return;
  }

  if (command === "checkchannel") {
    const channelId = args[0];
    if (!channelId || !state.channels[String(channelId)]) {
      await sendSafeMessage(msg.chat.id, "Format: /checkchannel CHANNEL_ID (harus ada di DB)");
      return;
    }
    await refreshChannelValidity(state.channels[String(channelId)]);
    await sendSafeMessage(msg.chat.id, `✅ Channel ${channelId} divalidasi ulang.`);
    return;
  }

  if (command === "refreshchannels") {
    for (const channel of Object.values(state.channels)) {
      await refreshChannelValidity(channel);
    }
    await sendSafeMessage(msg.chat.id, "✅ Semua channel berhasil divalidasi ulang.");
    return;
  }

  if (command === "blacklistchannel") {
    const channelId = args[0];
    const reason = args.slice(1).join(" ") || "manual_blacklist";
    const channel = state.channels[String(channelId)];
    if (!channel) {
      await sendSafeMessage(msg.chat.id, "Format: /blacklistchannel CHANNEL_ID ALASAN (channel harus ada)");
      return;
    }
    channel.is_blacklisted = true;
    channel.blacklist_reason = reason;
    channel.updated_at = nowISO();
    markDirty("channels");
    await sendSafeMessage(msg.chat.id, `✅ Channel ${channelId} di-blacklist.`);
    return;
  }

  if (command === "unblacklistchannel") {
    const channelId = args[0];
    const channel = state.channels[String(channelId)];
    if (!channel) {
      await sendSafeMessage(msg.chat.id, "Format: /unblacklistchannel CHANNEL_ID");
      return;
    }
    channel.is_blacklisted = false;
    channel.blacklist_reason = "";
    channel.updated_at = nowISO();
    markDirty("channels");
    await sendSafeMessage(msg.chat.id, `✅ Channel ${channelId} dihapus dari blacklist.`);
    return;
  }

  if (["enablechannel", "disablechannel"].includes(command)) {
    const channelId = String(args[0] || "");
    const channel = state.channels[channelId];
    if (!channel) {
      await sendSafeMessage(msg.chat.id, `Format: /${command} CHANNEL_ID (harus ada di DB)`);
      return;
    }

    channel.is_disabled_by_admin = command === "disablechannel";
    channel.updated_at = nowISO();
    recomputeChannelReceivePromo(channel);
    markDirty("channels");

    await sendSafeMessage(
      msg.chat.id,
      `✅ Channel ${channelId} ${channel.is_disabled_by_admin ? "dinonaktifkan" : "diaktifkan"} untuk target promo.`
    );
    return;
  }

  if (command === "clearchannels") {
    await requestDangerConfirm(msg.chat.id, msg.from.id, "clearchannels");
    return;
  }

  if (command === "logs") {
    const lines = state.logs.slice(-120).map((l) => `- ${l.created_at} | ${l.type}`);
    await sendLongMessage(msg.chat.id, ["📜 Logs terbaru:", ...lines].join("\n"));
    return;
  }

  if (command === "errorlogs") {
    const rows = state.logs.filter((l) => String(l.type || "").includes("error")).slice(-120);
    const lines = rows.map((l) => `- ${l.created_at} | ${l.type}`);
    await sendLongMessage(msg.chat.id, ["❗ Error logs:", ...lines].join("\n"));
    return;
  }

  if (command === "promologs") {
    const rows = state.logs.filter((l) => String(l.type || "").includes("promotion")).slice(-120);
    const lines = rows.map((l) => `- ${l.created_at} | ${l.type}`);
    await sendLongMessage(msg.chat.id, ["📣 Promo logs:", ...lines].join("\n"));
    return;
  }

  if (command === "adminlogs") {
    const rows = state.logs.filter((l) => JSON.stringify(l.detail || {}).includes("admin")).slice(-120);
    const lines = rows.map((l) => `- ${l.created_at} | ${l.type}`);
    await sendLongMessage(msg.chat.id, ["🛠 Admin logs:", ...lines].join("\n"));
    return;
  }

  if (command === "clearlogs") {
    await requestDangerConfirm(msg.chat.id, msg.from.id, "clearlogs");
    return;
  }

  if (command === "exportlogs") {
    const lines = state.logs.slice(-500).map((l) => `${l.created_at}\t${l.type}\t${JSON.stringify(l.detail || {})}`);
    await sendLongMessage(msg.chat.id, ["timestamp\ttype\tdetail", ...lines].join("\n"));
    return;
  }

  if (command === "backup") {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = nowISO().replace(/[:.]/g, "-");
    const backupPath = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    await fs.writeFile(backupPath, JSON.stringify(state, null, 2), "utf8");
    await sendSafeMessage(msg.chat.id, `✅ Backup dibuat: ${backupPath}`);
    return;
  }

  if (command === "restore") {
    await sendSafeMessage(msg.chat.id, "Restore otomatis tidak diaktifkan. Gunakan manual dari file backup untuk keamanan.");
    return;
  }

  if (command === "exportdb") {
    await sendLongMessage(msg.chat.id, JSON.stringify(state, null, 2));
    return;
  }

  if (command === "cleancache") {
    pruneExpiredSessions();
    await sendSafeMessage(msg.chat.id, "✅ Cache session dibersihkan.");
    return;
  }

  if (command === "repairdb") {
    normalizeStateShape();
    markDirty("users");
    markDirty("groups");
    markDirty("channels");
    markDirty("vouchers");
    markDirty("settings");
    await sendSafeMessage(msg.chat.id, "✅ Repair DB selesai (normalisasi state dijalankan).");
    return;
  }

  if (command === "reloadconfig") {
    normalizeStateShape();
    await sendSafeMessage(msg.chat.id, "✅ Konfigurasi runtime di-reload dari state/settings saat ini.");
    return;
  }

  if (command === "shutdown") {
    await requestDangerConfirm(msg.chat.id, msg.from.id, "shutdown");
    return;
  }

  if (command === "restartinfo") {
    await sendSafeMessage(msg.chat.id, "ℹ️ Restart manual: hentikan proses bot lalu jalankan ulang `npm start`.");
    return;
  }

  await sendSafeMessage(msg.chat.id, `Command /${command} belum tersedia penuh pada build ini.`);
}

let flushInterval = null;
let expireSweepInterval = null;
let shuttingDown = false;

async function shutdown(reason = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[BOT] Menutup bot (${reason})...`);

  try {
    if (flushInterval) clearInterval(flushInterval);
    if (expireSweepInterval) clearInterval(expireSweepInterval);

    await flushAllData();

    if (bot) {
      await bot.stopPolling();
    }
  } catch (error) {
    console.error("Gagal shutdown bot:", error.message);
  } finally {
    process.exit(0);
  }
}

async function setupBot() {
  const botToken = getConfigValue("BOT.TOKEN", getConfigValue("BOT_TOKEN", ""));
  if (!botToken || botToken === "ISI_TOKEN_BOT") {
    throw new Error("Silakan isi BOT.TOKEN di config.js sebelum menjalankan bot.");
  }

  await initializeStorage();

  bot = new TelegramBot(botToken, {
    polling: {
      autoStart: true,
      interval: 300,
      params: {
        timeout: 10
      }
    }
  });

  const me = await bot.getMe();
  botId = Number(me.id);
  botUsername = String(me.username || "");

  console.log(`[BOT] Aktif sebagai @${botUsername} (${botId})`);

  // Startup sync: validasi ulang grup & channel yang sudah tercatat di
  // database. Telegram Bot API tidak bisa mengambil daftar chat dari nol;
  // chat lama yang belum tercatat WAJIB diimport via /importgroup atau
  // /bulkimportgroups. Lihat config STARTUP_SYNC.
  if (getConfigValue("STARTUP_SYNC.ENABLED", true)) {
    try {
      const summary = await startupSyncChats();
      if (summary) {
        console.log(
          `[STARTUP_SYNC] groups: ${summary.groups_active}/${summary.groups_total} aktif, ` +
            `channels: ${summary.channels_active}/${summary.channels_total} aktif`
        );
      }
    } catch (error) {
      addLog("startup_sync_error", { error: error?.message || String(error) });
      console.error("Startup sync error:", error?.message || error);
    }
  }

  bot.on("message", async (msg) => {
    try {
      // Auto-save chat dari setiap pesan grup/supergroup. Lihat
      // STARTUP_SYNC.AUTO_SAVE_CHAT_FROM_UPDATE.
      if (msg?.chat && ["group", "supergroup"].includes(msg.chat.type)) {
        autoSaveGroupFromUpdate(msg.chat);
      }
      await handleIncomingMessage(msg);
    } catch (error) {
      addLog("message_handler_error", {
        error: error.message
      });
      await flushDirtyData();
      console.error("Error handler message:", error.message);
    }
  });

  bot.on("channel_post", async (msg) => {
    try {
      // Auto-save channel dari setiap channel_post.
      if (msg?.chat && msg.chat.type === "channel") {
        autoSaveChannelFromUpdate(msg.chat);
      }
      await handleIncomingChannelPost(msg);
    } catch (error) {
      addLog("channel_post_handler_error", { error: error.message });
      await flushDirtyData();
      console.error("Error handler channel_post:", error.message);
    }
  });

  bot.on("edited_channel_post", async (msg) => {
    try {
      if (msg?.chat && msg.chat.type === "channel") {
        autoSaveChannelFromUpdate(msg.chat);
      }
      await handleIncomingChannelPost(msg);
    } catch (error) {
      addLog("edited_channel_post_handler_error", { error: error.message });
      await flushDirtyData();
      console.error("Error handler edited_channel_post:", error.message);
    }
  });

  bot.on("my_chat_member", async (update) => {
    try {
      await processMyChatMember(update);
      await flushDirtyData();
    } catch (error) {
      addLog("my_chat_member_error", { error: error.message });
      await flushDirtyData();
      console.error("Error handler my_chat_member:", error.message);
    }
  });

  bot.on("callback_query", async (query) => {
    try {
      await handleCallbackQuery(query);
    } catch (error) {
      addLog("callback_handler_error", {
        error: error.message
      });
      await flushDirtyData();
      console.error("Error handler callback:", error.message);
    }
  });

  bot.on("polling_error", (error) => {
    const info = extractTelegramError(error);
    addLog("polling_error", {
      error_code: info.code,
      error_message: info.description
    });
    console.error("Polling error:", info.description);
  });

  flushInterval = setInterval(() => {
    flushDirtyData().catch((error) => {
      console.error("Flush interval error:", error.message);
    });
  }, FLUSH_INTERVAL_MS);

  expireSweepInterval = setInterval(() => {
    sweepExpiredPackages("interval").catch((error) => {
      console.error("Expire sweep error:", error.message);
    });
  }, EXPIRE_SWEEP_INTERVAL_MS);

  await sweepExpiredPackages("startup");

  addLog("bot_started", {
    bot_id: botId,
    bot_username: botUsername
  });

  await flushDirtyData();

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch(() => {
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => {
      process.exit(0);
    });
  });

  process.on("uncaughtException", async (error) => {
    console.error("Uncaught exception:", error);
    addLog("uncaught_exception", { message: error.message });
    await flushDirtyData();
  });

  process.on("unhandledRejection", async (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("Unhandled rejection:", message);
    addLog("unhandled_rejection", { message });
    await flushDirtyData();
  });
}

setupBot().catch(async (error) => {
  console.error("Gagal menjalankan bot:", error.message);
  try {
    addLog("startup_error", { error: error.message });
    await flushDirtyData();
  } catch {
    // ignore
  }
  process.exit(1);
});


function isPrivateChat(msg) {
  return msg.chat?.type === "private";
}

function allowCommandWhenBanned(command) {
  return ["start", "help", "status", "profile", "receivepromo_on", "receivepromo_off", "optout"].includes(command);
}

async function processCommand(msg, user, parsedCommand) {
  const { command, argsText } = parsedCommand;

  if (PRIVATE_ONLY_COMMANDS.has(command) && !isPrivateChat(msg)) {
    await sendSafeMessage(msg.chat.id, "Command ini hanya bisa dipakai di private chat dengan bot.");
    return;
  }

  if (ADMIN_COMMANDS.has(command) && !isAdmin(user.id)) {
    await sendSafeMessage(msg.chat.id, "Command ini khusus admin/owner.");
    return;
  }

  if (user.is_banned && !allowCommandWhenBanned(command)) {
    await sendSafeMessage(msg.chat.id, "Akun kamu sedang diban. Akses bot dibatasi.");
    return;
  }

  switch (command) {
    case "start":
      await handleCommandStart(msg, user);
      break;

    case "help":
      await handleCommandHelp(msg, user);
      break;

    case "profile":
      await handleCommandProfile(msg, user);
      break;

    case "status":
      await handleCommandStatus(msg, user);
      break;

    case "optin":
      await handleCommandReceivePromoOn(msg, user, argsText);
      break;

    case "optout":
      await handleCommandReceivePromoOff(msg, user, argsText);
      break;

    case "receivepromo_on":
      await handleCommandReceivePromoOn(msg, user, argsText);
      break;

    case "receivepromo_off":
      await handleCommandReceivePromoOff(msg, user, argsText);
      break;

    case "trial":
      await handleCommandTrial(msg, user);
      break;

    case "mygroups":
      await handleCommandMyGroups(msg, user);
      break;

    case "mychannels":
      await handleCommandMyChannels(msg, user);
      break;

    case "mytargets":
      await handleCommandMyTargets(msg, user);
      break;

    case "redeem":
      await handleCommandRedeem(msg, user, argsText);
      break;

    case "buatpromo":
      await handleCommandCreatePromo(msg, user);
      break;

    case "sharegrup":
      await handleDirectShareCommand(msg, user, "group", argsText);
      break;

    case "sharechannel":
      await handleDirectShareCommand(msg, user, "channel", argsText);
      break;

    case "sharetarget":
      await handleDirectShareCommand(msg, user, "target", argsText);
      break;

    case "shareuser":
      await handleDirectShareCommand(msg, user, "user", argsText);
      break;

    case "shareall":
      await handleDirectShareCommand(msg, user, "all", argsText);
      break;

    case "claimgroup":
      await handleCommandClaimGroup(msg, user, argsText);
      break;

    case "claimchannel":
      await handleCommandClaimChannel(msg, user, argsText);
      break;

    case "claimtrial":
      await handleCommandClaimTrial(msg, user, argsText);
      break;

    case "cancel":
      clearSession(user.id);
      await sendSafeMessage(msg.chat.id, "Flow dibatalkan.");
      break;

    case "admin":
      await handleCommandAdminPanel(msg);
      break;

    case "stats":
      await handleCommandStats(msg);
      break;

    case "todaystats":
    case "botstatus":
    case "healthcheck":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "users":
      await handleCommandUsers(msg);
      break;

    case "user":
      await handleCommandUserDetail(msg, argsText);
      break;

    case "ban":
      await handleCommandBan(msg, argsText, true);
      break;

    case "unban":
      await handleCommandBan(msg, argsText, false);
      break;

    case "setpackage":
      await handleCommandSetPackage(msg, argsText);
      break;

    case "removeaccess":
      await handleCommandRemoveAccess(msg, argsText);
      break;

    case "createvoucher":
      await handleCommandCreateVoucher(msg, argsText);
      break;

    case "vouchers":
      await handleCommandVouchers(msg);
      break;

    case "channels":
    case "channel":
    case "activechannels":
    case "inactivechannels":
    case "validchannels":
    case "invalidchannels":
    case "removechannel":
    case "checkchannel":
    case "refreshchannels":
    case "blacklistchannel":
    case "unblacklistchannel":
    case "clearchannels":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "group":
    case "checkgroup":
    case "refreshgroups":
    case "blacklistgroup":
    case "unblacklistgroup":
    case "cleargroups":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "broadcastuser":
    case "broadcastgroup":
    case "broadcastchannel":
    case "broadcasttarget":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "cancelbroadcast":
      cancelBroadcastRequested = true;
      await sendSafeMessage(msg.chat.id, "Permintaan pembatalan broadcast diterima.");
      break;

    case "packages":
    case "setlimit":
    case "settrialduration":
    case "settriallimit":
    case "settrialtarget":
    case "setmingroupmembers":
    case "setminchannelsubs":
    case "setmintrialmembers":
    case "setmintrialsubs":
    case "setrequiredtrialtarget":
    case "assigntrialtarget":
    case "trialprogress":
    case "resettrialprogress":
    case "forcetrial":
    case "removetrial":
    case "enablepackage":
    case "disablepackage":
    case "enablegroup":
    case "disablegroup":
    case "enablechannel":
    case "disablechannel":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "searchuser":
    case "warn":
    case "warnings":
    case "resetwarn":
    case "extend":
    case "resetlimit":
    case "resetcooldown":
    case "setrole":
    case "removeadmin":
    case "noteuser":
    case "userlogs":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "createcustomvoucher":
    case "voucher":
    case "deletevoucher":
    case "disablevoucher":
    case "enablevoucher":
    case "unusedvouchers":
    case "usedvouchers":
    case "exportvouchers":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "logs":
    case "errorlogs":
    case "promologs":
    case "adminlogs":
    case "clearlogs":
    case "exportlogs":
    case "backup":
    case "restore":
    case "exportdb":
    case "cleancache":
    case "repairdb":
    case "reloadconfig":
    case "shutdown":
    case "restartinfo":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "recentjoins":
    case "recentgroups":
    case "recentchannels":
    case "pendingnotifications":
    case "importgroup":
    case "importchannel":
    case "bulkimportgroups":
    case "bulkimportchannels":
    case "syncgroups":
    case "syncchannels":
    case "syncchats":
      await handleExtendedAdminCommand(msg, command, argsText);
      break;

    case "setdelay":
      await handleCommandSetDelay(msg, argsText);
      break;

    case "broadcast":
      await handleCommandBroadcast(msg, argsText, "optin");
      break;

    case "broadcastall":
      await handleCommandBroadcast(msg, argsText, "all");
      break;

    case "groups":
      await handleCommandGroups(msg, "all");
      break;

    case "activegroups":
      await handleCommandGroups(msg, "active");
      break;

    case "inactivegroups":
      await handleCommandGroups(msg, "inactive");
      break;

    case "groupinfo":
      await handleCommandGroupInfo(msg, argsText);
      break;

    case "removegroup":
      await handleCommandRemoveGroup(msg, argsText);
      break;

    case "addgrouplink":
      await handleCommandAddGroupLink(msg, argsText);
      break;

    default:
      if (ADMIN_COMMANDS.has(command)) {
        await handleExtendedAdminCommand(msg, command, argsText);
      }
      break;
  }
}

async function processForwardedGroupClaim(msg, user) {
  if (!isPrivateChat(msg)) return false;

  const fwdChat = msg.forward_from_chat;
  if (!fwdChat) return false;
  if (!["group", "supergroup"].includes(fwdChat.type)) return false;

  const groupId = String(fwdChat.id);
  await ensureGroupSnapshot(groupId, fwdChat.title || "Forwarded Group", user.id);

  const result = await claimGroupForUser(user.id, groupId, { force: false });
  if (result.ok) {
    await sendSafeMessage(
      msg.chat.id,
      `✅ Forward grup diterima. Grup ${groupId} berhasil diklaim. Progress trial: ${result.valid_count}/${result.required_count}`
    );
  } else {
    await sendSafeMessage(msg.chat.id, `❌ Klaim grup gagal: ${result.message}`);
  }

  return true;
}

async function handleIncomingMessage(msg) {
  if (!msg?.from?.id) return;

  const user = upsertUserFromTelegram(msg.from);
  if (!user) return;

  try {
    await registerGroupWhenBotAdded(msg);
  } catch (error) {
    addLog("group_event_error", { kind: "added", error: error.message });
  }

  try {
    await registerGroupWhenBotLeft(msg);
  } catch (error) {
    addLog("group_event_error", { kind: "left", error: error.message });
  }

  const text = String(msg.text || "");
  if (!text) {
    if (await processForwardedGroupClaim(msg, user)) {
      await flushDirtyData();
    }
    return;
  }

  const parsed = parseCommand(text);
  if (parsed) {
    if (parsed.targetBot && botUsername && parsed.targetBot !== botUsername.toLowerCase()) {
      return;
    }

    const waitMs = checkCommandRateLimit(user.id);
    if (waitMs > 0) {
      await sendSafeMessage(msg.chat.id, `Terlalu cepat. Tunggu ${formatSeconds(waitMs / 1000)}.`);
      return;
    }

    expireUserPackageIfNeeded(user.id, user, "on_command");

    await processCommand(msg, user, parsed);
    await flushDirtyData();
    return;
  }

  if (await handlePromoSessionText(msg, user)) {
    await flushDirtyData();
    return;
  }

  if (await processForwardedGroupClaim(msg, user)) {
    await flushDirtyData();
  }
}

async function handleCallbackQuery(query) {
  const userId = query?.from?.id;
  const data = String(query?.data || "");
  if (!userId || !data) return;

  const user = ensureUserById(userId);
  user.role = resolveRole(userId);
  user.updated_at = nowISO();
  markDirty("users");

  const chatId = query.message?.chat?.id || userId;

  const safeAnswer = async (text = "OK") => {
    try {
      await bot.answerCallbackQuery(query.id, { text, show_alert: false });
    } catch {
      // ignore
    }
  };

  try {
    if (data === "optin" || data === "receivepromo_on") {
      await handleCommandReceivePromoOn({ chat: { id: chatId } }, user, "");
      await safeAnswer("Receive promo ON");
      return;
    }

    if (data === "optout" || data === "receivepromo_off") {
      await handleCommandReceivePromoOff({ chat: { id: chatId } }, user, "");
      await safeAnswer("Receive promo OFF");
      return;
    }

    if (data === "menu_profile") {
      await sendSafeMessage(chatId, buildProfileText(user));
      await safeAnswer();
      return;
    }

    if (data === "menu_help") {
      await sendLongMessage(chatId, buildHelpText(isAdmin(user.id)));
      await safeAnswer();
      return;
    }

    if (data === "menu_packages") {
      await sendSafeMessage(chatId, buildPackageMenuText());
      await safeAnswer();
      return;
    }

    if (data === "menu_trial") {
      await sendSafeMessage(
        chatId,
        [
          "🎁 Menu Trial",
          "- /trial",
          "- Bot otomatis membaca grup/channel valid",
          "- Tidak perlu /claimtrial manual",
          "- /mytargets"
        ].join("\n")
      );
      await safeAnswer();
      return;
    }

    if (data === "menu_redeem") {
      await sendSafeMessage(chatId, "Gunakan /redeem KODE_VOUCHER untuk aktivasi paket.");
      await safeAnswer();
      return;
    }

    if (data === "menu_targets") {
      await sendSafeMessage(
        chatId,
        "Target kamu:\n- /mygroups\n- /mychannels\n- /mytargets\n(Ter-update otomatis saat bot ditambahkan/keluar)"
      );
      await safeAnswer();
      return;
    }

    if (data === "menu_promo") {
      await sendSafeMessage(
        chatId,
        "Menu promosi:\n- /buatpromo\n- /sharegrup JUDUL|ISI\n- /sharechannel JUDUL|ISI\n- /sharetarget JUDUL|ISI\n- /shareuser JUDUL|ISI\n- /shareall JUDUL|ISI"
      );
      await safeAnswer();
      return;
    }

    if (data === "menu_admin") {
      if (!isAdmin(user.id)) {
        await safeAnswer("Khusus admin/owner");
        return;
      }
      await handleCommandAdminPanel({ chat: { id: chatId }, from: { id: user.id } });
      await safeAnswer();
      return;
    }

    if (data === "admin_stats") {
      if (!isAdmin(user.id)) {
        await safeAnswer("Khusus admin/owner");
        return;
      }
      await handleCommandStats({ chat: { id: chatId } });
      await safeAnswer();
      return;
    }

    if (data === "admin_users") {
      if (!isAdmin(user.id)) {
        await safeAnswer("Khusus admin/owner");
        return;
      }
      await handleCommandUsers({ chat: { id: chatId } });
      await safeAnswer();
      return;
    }

    if (data === "admin_groups") {
      if (!isAdmin(user.id)) {
        await safeAnswer("Khusus admin/owner");
        return;
      }
      await handleCommandGroups({ chat: { id: chatId } }, "all");
      await safeAnswer();
      return;
    }

    if (data === "noop") {
      await safeAnswer();
      return;
    }

    if (data === "danger_cancel") {
      const session = getSession(user.id);
      if (session?.type === "danger_confirm") {
        clearSession(user.id);
      }
      await safeAnswer("Dibatalkan");
      await sendSafeMessage(chatId, "Aksi dibatalkan.");
      return;
    }

    if (data.startsWith("danger_confirm:")) {
      if (!isAdmin(user.id)) {
        await safeAnswer("Khusus admin/owner");
        return;
      }

      const action = data.slice("danger_confirm:".length);
      const session = getSession(user.id);
      if (!session || session.type !== "danger_confirm") {
        await safeAnswer("Sesi konfirmasi tidak aktif.");
        return;
      }

      const expectedAction = String(session?.data?.action || "");
      if (expectedAction !== action) {
        await safeAnswer("Aksi tidak cocok.");
        return;
      }

      clearSession(user.id);
      const resultMessage = await executeDangerAction(action);
      await safeAnswer("Dieksekusi");
      await sendSafeMessage(chatId, `✅ ${resultMessage}`);
      return;
    }

    if (data.startsWith("promo_target_")) {
      const session = getPromoSession(user.id);
      if (!session || session.step !== "target") {
        await safeAnswer("Flow promosi tidak aktif.");
        return;
      }

      const selectedTarget = data.replace("promo_target_", "");
      const accessCheck = evaluatePromotionAccess(user, selectedTarget);
      if (!accessCheck.ok) {
        await sendSafeMessage(chatId, `❌ ${accessCheck.message}`);
        await safeAnswer("Target tidak diizinkan");
        return;
      }

      session.data.target = selectedTarget;
      session.step = "confirm";
      setSession(user.id, session);

      await sendPromoConfirmPrompt(chatId, session, user);
      await safeAnswer("Target disimpan");
      return;
    }

    if (data.startsWith("claimchannel_select:")) {
      const channelId = data.slice("claimchannel_select:".length);
      const result = await claimChannelForUser(user.id, channelId);
      if (!result.ok) {
        await sendSafeMessage(chatId, `❌ ${result.message}`);
        await safeAnswer("Gagal");
        return;
      }

      await sendSafeMessage(
        chatId,
        [
          "✅ Klaim channel berhasil.",
          `Channel ID: ${channelId}`,
          `Status trial: ${result.is_valid_for_trial ? "valid" : "tidak valid"}`,
          `Alasan status: ${result.status_reason}`,
          `Progress trial: ${result.valid_count}/${result.required_count}`
        ].join("\n")
      );

      await safeAnswer("Channel diklaim");
      return;
    }

    if (data === "promo_confirm_cancel") {
      clearSession(user.id);
      await sendSafeMessage(chatId, "Flow promosi dibatalkan.");
      await safeAnswer("Dibatalkan");
      return;
    }

    if (data === "promo_confirm_send") {
      const session = getPromoSession(user.id);
      if (!session || session.step !== "confirm") {
        await safeAnswer("Flow promosi tidak aktif.");
        return;
      }

      await submitPromotionRequest({
        user,
        chatId,
        target: session.data.target,
        title: session.data.title,
        body: session.data.body,
        source: "wizard_callback"
      });

      clearSession(user.id);
      await safeAnswer("Promosi diantrikan");
      return;
    }

    await safeAnswer();
  } catch (error) {
    addLog("callback_error", {
      data,
      user_id: Number(userId),
      error: error.message
    });
    await safeAnswer("Terjadi error");
  } finally {
    await flushDirtyData();
  }
}


async function handleCommandBan(msg, argsText, isBan) {
  const userId = parseArgsBySpace(argsText)[0];
  if (!userId) {
    await sendSafeMessage(msg.chat.id, `Format: ${isBan ? "/ban" : "/unban"} USER_ID`);
    return;
  }

  // Lindungi owner & admin: hanya user biasa yang boleh di-/ban via command.
  // /unban tetap diizinkan terhadap siapa pun (mis. membersihkan flag legacy).
  if (isBan && isPrivileged(userId)) {
    const protectedMsg = String(
      getConfigValue(
        "MESSAGES.OWNER_ADMIN_PROTECTED",
        "❌ Tidak bisa memban owner/admin. Role owner dan admin dilindungi dari ban."
      )
    );
    await sendSafeMessage(msg.chat.id, protectedMsg);
    addLog("ban_blocked_privileged", {
      target_user_id: Number(userId),
      admin_id: Number(msg.from.id),
      target_role: resolveRole(userId)
    });
    return;
  }

  const user = ensureUserById(userId);
  user.is_banned = isBan;
  user.updated_at = nowISO();
  markDirty("users");

  addLog(isBan ? "user_banned" : "user_unbanned", {
    target_user_id: Number(userId),
    admin_id: Number(msg.from.id)
  });

  await sendSafeMessage(
    msg.chat.id,
    isBan ? `✅ User ${userId} berhasil diban.` : `✅ User ${userId} berhasil di-unban.`
  );
}

async function handleCommandSetPackage(msg, argsText) {
  const [userId, packageName, duration] = parseArgsBySpace(argsText);

  if (!userId || !packageName) {
    await sendSafeMessage(msg.chat.id, "Format: /setpackage USER_ID PACKAGE DURASI");
    return;
  }

  const user = ensureUserById(userId);

  let result;
  if (String(packageName).toLowerCase() === "free") {
    result = applyPackageToUser(user, "free");
  } else {
    result = applyPackageToUser(user, packageName, duration);
  }

  if (!result.ok) {
    await sendSafeMessage(msg.chat.id, `❌ ${result.message}`);
    return;
  }

  markDirty("users");

  addLog("set_package", {
    admin_id: Number(msg.from.id),
    user_id: Number(userId),
    package: user.package,
    expired_at: user.package_expired_at
  });

  await sendSafeMessage(
    msg.chat.id,
    `✅ Paket user ${userId} di-set ke ${user.package}${
      user.package_expired_at ? ` (expired ${user.package_expired_at})` : ""
    }.`
  );
}

async function handleCommandRemoveAccess(msg, argsText) {
  const userId = parseArgsBySpace(argsText)[0];
  if (!userId) {
    await sendSafeMessage(msg.chat.id, "Format: /removeaccess USER_ID");
    return;
  }

  const user = ensureUserById(userId);
  applyPackageToUser(user, "free");
  markDirty("users");

  addLog("remove_access", {
    admin_id: Number(msg.from.id),
    user_id: Number(userId)
  });

  await sendSafeMessage(msg.chat.id, `✅ Akses paket user ${userId} dihapus.`);
}

async function handleCommandCreateVoucher(msg, argsText) {
  const [packageNameRaw, duration, qtyRaw] = parseArgsBySpace(argsText);
  const packageName = String(packageNameRaw || "").toLowerCase();
  const qty = Number(qtyRaw || 0);

  if (!["trial", "pro", "vip"].includes(packageName) || !duration || !Number.isFinite(qty) || qty <= 0) {
    await sendSafeMessage(msg.chat.id, "Format: /createvoucher PACKAGE DURASI JUMLAH");
    return;
  }

  if (!parseDurationToMs(duration)) {
    await sendSafeMessage(msg.chat.id, "Durasi tidak valid. Contoh: 1h, 12h, 7d, 30d.");
    return;
  }

  if (qty > 500) {
    await sendSafeMessage(msg.chat.id, "Jumlah maksimal 500 voucher per command.");
    return;
  }

  const createdCodes = [];

  for (let i = 0; i < qty; i += 1) {
    let code = makeVoucherCode(10);
    while (state.vouchers[code]) {
      code = makeVoucherCode(10);
    }

    state.vouchers[code] = {
      code,
      package: packageName,
      duration,
      is_used: false,
      created_by: Number(msg.from.id),
      created_at: nowISO(),
      used_by: null,
      used_at: null,
      expired_at: null
    };

    createdCodes.push(code);
  }

  markDirty("vouchers");

  addLog("voucher_created", {
    admin_id: Number(msg.from.id),
    package: packageName,
    duration,
    quantity: qty
  });

  const preview = createdCodes.slice(0, 20).join(", ");
  await sendLongMessage(
    msg.chat.id,
    `✅ ${qty} voucher dibuat untuk paket ${packageName} (${duration}).\nContoh kode: ${preview}${
      createdCodes.length > 20 ? " ..." : ""
    }`
  );
}

async function handleCommandVouchers(msg) {
  const vouchers = Object.values(state.vouchers);
  if (vouchers.length === 0) {
    await sendSafeMessage(msg.chat.id, "Belum ada voucher.");
    return;
  }

  const lines = ["🎟 Daftar voucher:"];
  for (const voucher of vouchers.slice(0, 150)) {
    lines.push(
      `- ${voucher.code} | ${voucher.package} ${voucher.duration} | ${voucher.is_used ? "used" : "unused"}`
    );
  }

  if (vouchers.length > 150) {
    lines.push(`... ${vouchers.length - 150} voucher lainnya tidak ditampilkan.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandSetDelay(msg, argsText) {
  const [packageNameRaw, secondsRaw] = parseArgsBySpace(argsText);
  const packageName = String(packageNameRaw || "").toLowerCase();
  const seconds = Number(secondsRaw);

  if (!["trial", "pro", "vip"].includes(packageName) || !Number.isFinite(seconds) || seconds < 0) {
    await sendSafeMessage(msg.chat.id, "Format: /setdelay PACKAGE DETIK");
    return;
  }

  state.packages[packageName] = {
    ...getPackageConfig(packageName),
    delay_seconds: Math.floor(seconds)
  };

  markDirty("packages");

  addLog("set_delay", {
    admin_id: Number(msg.from.id),
    package: packageName,
    delay_seconds: Math.floor(seconds)
  });

  await sendSafeMessage(msg.chat.id, `✅ Delay paket ${packageName} diatur ke ${Math.floor(seconds)} detik.`);
}

async function handleCommandBroadcast(msg, argsText, scope) {
  const text = String(argsText || "").trim();
  if (!text) {
    await sendSafeMessage(msg.chat.id, `Format: /${scope === "optin" ? "broadcast" : "broadcastall"} PESAN`);
    return;
  }

  await submitAdminBroadcast({
    adminId: msg.from.id,
    chatId: msg.chat.id,
    scope,
    text
  });
}

function filterGroupsByMode(mode) {
  const groups = Object.values(state.groups);
  if (mode === "active") return groups.filter((group) => group.is_active);
  if (mode === "inactive") return groups.filter((group) => !group.is_active);
  return groups;
}

async function handleCommandGroups(msg, mode = "all") {
  const groups = filterGroupsByMode(mode);
  if (groups.length === 0) {
    await sendSafeMessage(msg.chat.id, "Data grup kosong.");
    return;
  }

  const lines = [
    mode === "active"
      ? "🏘 Grup aktif"
      : mode === "inactive"
      ? "🏚 Grup nonaktif"
      : "🏘 Semua grup"
  ];

  for (const group of groups.slice(0, 150)) {
    lines.push(
      `- ${group.title} (${group.group_id}) | member:${group.member_count} | ${
        group.is_active ? "aktif" : "nonaktif"
      } | trial:${group.is_valid_for_trial ? "valid" : "tidak"}`
    );
  }

  if (groups.length > 150) {
    lines.push(`... ${groups.length - 150} grup lainnya tidak ditampilkan.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandGroupInfo(msg, argsText) {
  const groupId = parseArgsBySpace(argsText)[0];
  if (!groupId) {
    await sendSafeMessage(msg.chat.id, "Format: /groupinfo GROUP_ID");
    return;
  }

  const group = state.groups[String(groupId)];
  if (!group) {
    await sendSafeMessage(msg.chat.id, "Group tidak ditemukan.");
    return;
  }

  const text = [
    "🏘 Detail grup",
    `ID: ${group.group_id}`,
    `Title: ${group.title}`,
    `Member: ${group.member_count}`,
    `Added by: ${group.added_by || "-"}`,
    `Added at: ${group.added_at || "-"}`,
    `Left at: ${group.left_at || "-"}`,
    `Aktif: ${group.is_active ? "Ya" : "Tidak"}`,
    `Valid trial: ${group.is_valid_for_trial ? "Ya" : "Tidak"}`,
    `Claimed by: ${group.claimed_by || "-"}`
  ].join("\n");

  await sendSafeMessage(msg.chat.id, text);
}

async function handleCommandRemoveGroup(msg, argsText) {
  const groupId = parseArgsBySpace(argsText)[0];
  if (!groupId) {
    await sendSafeMessage(msg.chat.id, "Format: /removegroup GROUP_ID");
    return;
  }

  if (!state.groups[String(groupId)]) {
    await sendSafeMessage(msg.chat.id, "Group tidak ditemukan.");
    return;
  }

  delete state.groups[String(groupId)];
  markDirty("groups");

  addLog("group_removed", {
    admin_id: Number(msg.from.id),
    group_id: String(groupId)
  });

  await sendSafeMessage(msg.chat.id, `✅ Group ${groupId} dihapus dari target promosi.`);
}

async function handleCommandAddGroupLink(msg, argsText) {
  const link = String(argsText || "").trim();
  if (!link || !/^https?:\/\//i.test(link) && !/^https:\/\/t\.me\//i.test(link)) {
    await sendSafeMessage(msg.chat.id, "Format: /addgrouplink LINK_GRUP");
    return;
  }

  // Telegram Bot API biasa tidak dapat membuat bot join grup otomatis hanya dari invite link.
  // Link ini hanya disimpan sebagai pending, lalu admin grup harus menambahkan bot secara manual.
  state.pendingGroups.push({
    id: randomId("pending_group"),
    link,
    added_by: Number(msg.from.id),
    status: "pending",
    created_at: nowISO(),
    matched_group_id: null,
    matched_at: null
  });

  markDirty("pendingGroups");

  await sendSafeMessage(
    msg.chat.id,
    [
      "✅ Link grup disimpan sebagai pending.",
      "Silakan tambahkan bot secara manual ke grup tersebut.",
      "Setelah bot benar-benar masuk, sistem akan memvalidasi grup secara otomatis."
    ].join("\n")
  );
}

async function handleCommandMyGroups(msg, user) {
  const mine = Object.values(state.groups).filter(
    (group) => String(group.claimed_by || "") === String(user.id)
  );

  if (mine.length === 0) {
    await sendSafeMessage(msg.chat.id, "Kamu belum memiliki grup yang diklaim.");
    return;
  }

  const lines = ["📌 Grup milik kamu:"];
  for (const group of mine.slice(0, 100)) {
    lines.push(
      `- ${group.title} (${group.group_id}) | ${group.is_active ? "aktif" : "nonaktif"} | trial: ${
        group.is_valid_for_trial ? "valid" : "tidak"
      }`
    );
  }

  if (mine.length > 100) {
    lines.push(`... ${mine.length - 100} grup lainnya tidak ditampilkan.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandRedeem(msg, user, argsText) {
  if (user.is_banned) {
    await sendSafeMessage(msg.chat.id, "Akun kamu diban. Tidak bisa redeem voucher.");
    return;
  }

  const code = String(argsText || "").trim().toUpperCase();
  if (!code) {
    await sendSafeMessage(msg.chat.id, "Format: /redeem KODEVOUCHER");
    return;
  }

  const voucher = state.vouchers[code];
  if (!voucher) {
    await sendSafeMessage(msg.chat.id, "Voucher tidak ditemukan.");
    return;
  }

  if (voucher.is_used) {
    await sendSafeMessage(msg.chat.id, "Voucher sudah terpakai.");
    return;
  }

  ensureUserTrialState(user);
  if (String(voucher.package || "").toLowerCase() === "trial" && user.trial.has_used_trial) {
    await sendSafeMessage(
      msg.chat.id,
      "Trial Basic hanya bisa dipakai sekali. Gunakan voucher Pro/VIP untuk lanjut."
    );
    return;
  }

  const applyResult = applyPackageToUser(user, voucher.package, voucher.duration);
  if (!applyResult.ok) {
    await sendSafeMessage(msg.chat.id, `Voucher tidak valid: ${applyResult.message}`);
    return;
  }

  voucher.is_used = true;
  voucher.used_by = Number(user.id);
  voucher.used_at = nowISO();
  voucher.expired_at = user.package_expired_at;

  markDirty("users");
  markDirty("vouchers");

  addLog("voucher_used", {
    code,
    package: voucher.package,
    used_by: Number(user.id)
  });

  await sendSafeMessage(
    msg.chat.id,
    [
      "✅ Voucher berhasil dipakai.",
      `Paket: ${formatPackageLabel(user.package)}`,
      `Mulai: ${user.package_started_at}`,
      `Expired: ${user.package_expired_at}`
    ].join("\n")
  );
}

async function handleCommandCreatePromo(msg, user) {
  if (!isAdmin(user.id) && (!user.package || user.package === "free")) {
    await sendSafeMessage(msg.chat.id, "Paket free tidak bisa membuat promosi.");
    return;
  }

  createPromoSession(user.id);
  await sendSafeMessage(
    msg.chat.id,
    "Flow promosi dimulai.\n1) Masukkan judul promosi:\n(Ketik /cancel untuk batal)"
  );
}

async function handleDirectShareCommand(msg, user, target, argsText) {
  const payload = parseSharePayload(argsText);
  if (!payload) {
    const commandName =
      target === "group"
        ? "sharegrup"
        : target === "channel"
        ? "sharechannel"
        : target === "target"
        ? "sharetarget"
        : target === "user"
        ? "shareuser"
        : "shareall";
    await sendSafeMessage(msg.chat.id, `Format: /${commandName} JUDUL|ISI`);
    return;
  }

  await submitPromotionRequest({
    user,
    chatId: msg.chat.id,
    target,
    title: payload.title,
    body: payload.body,
    source: "direct_command"
  });
}

async function handleCommandClaimGroup(msg, user, argsText) {
  let groupId = null;

  if (["group", "supergroup"].includes(msg.chat.type)) {
    groupId = String(msg.chat.id);
    await ensureGroupSnapshot(groupId, msg.chat.title || "Unknown Group", user.id);
  } else {
    const arg = parseArgsBySpace(argsText)[0];
    if (!arg) {
      await sendSafeMessage(
        msg.chat.id,
        "Gunakan /claimgroup di grup, atau /claimgroup GROUP_ID dari private chat."
      );
      return;
    }
    groupId = String(arg);
    if (!state.groups[groupId]) {
      await sendSafeMessage(msg.chat.id, "GROUP_ID tidak ditemukan di database.");
      return;
    }
  }

  const result = await claimGroupForUser(user.id, groupId);
  if (!result.ok) {
    await sendSafeMessage(msg.chat.id, `❌ ${result.message}`);
    return;
  }

  const lines = [
    "✅ Klaim grup berhasil.",
    `Group ID: ${groupId}`,
    `Status trial grup: ${result.is_valid_for_trial ? "valid" : "tidak valid"}`,
    `Progress trial: ${result.valid_count}/${result.required_count}`
  ];

  if (result.trial_activated) {
    lines.push("🎉 Trial kamu baru saja aktif.");
  }

  await sendSafeMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandAdminPanel(msg) {
  const text = [
    "🛠 Panel Admin",
    "Gunakan command:",
    "- /stats",
    "- /users",
    "- /createvoucher package durasi jumlah",
    "- /setpackage user_id package durasi",
    "- /setdelay package detik",
    "- /broadcast pesan",
    "- /broadcastall pesan",
    "- /groups"
  ].join("\n");

  await sendSafeMessage(msg.chat.id, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Stats", callback_data: "admin_stats" },
          { text: "👥 Users", callback_data: "admin_users" }
        ],
        [
          { text: "🏘 Groups", callback_data: "admin_groups" },
          { text: "📦 Paket", callback_data: "menu_packages" }
        ]
      ]
    }
  });
}

async function handleCommandStats(msg) {
  const users = Object.values(state.users);
  const groups = Object.values(state.groups);
  const channels = Object.values(state.channels);
  const vouchers = Object.values(state.vouchers);

  const totalUsers = users.length;
  const bannedUsers = users.filter((u) => u.is_banned).length;
  const receivePromoUsers = users.filter((u) => u.has_started && u.is_receive_promo).length;
  const nonReceivePromoUsers = users.filter((u) => u.has_started && !u.is_receive_promo).length;
  const activeUsers = users.filter((u) => u.has_started && !u.is_banned).length;
  const trialUsers = users.filter((u) => u.package === "trial").length;
  const proUsers = users.filter((u) => u.package === "pro").length;
  const vipUsers = users.filter((u) => u.package === "vip").length;

  const totalGroups = groups.length;
  const activeGroups = groups.filter((g) => g.is_active).length;
  const inactiveGroups = groups.filter((g) => !g.is_active).length;

  const totalChannels = channels.length;
  const activeChannels = channels.filter((c) => c.is_active).length;
  const inactiveChannels = channels.filter((c) => !c.is_active).length;
  const validChannels = channels.filter((c) => c.is_valid_for_trial).length;
  const invalidChannels = channels.filter((c) => !c.is_valid_for_trial).length;

  const totalVouchers = vouchers.length;
  const usedVouchers = vouchers.filter((v) => v.is_used).length;
  const unusedVouchers = vouchers.filter((v) => !v.is_used).length;

  const today = todayKey();
  const promotionsToday = state.promotions.filter((p) => String(p.queued_at || "").startsWith(today));
  const totalPromotionsToday = promotionsToday.length;
  const promotionSuccess = promotionsToday.filter((p) => p.status === "done").length;
  const promotionFailed = promotionsToday.filter((p) => ["failed", "cancelled"].includes(p.status)).length;

  const estimatedBytes = Buffer.byteLength(JSON.stringify(state), "utf8");
  const estimatedMB = (estimatedBytes / (1024 * 1024)).toFixed(2);

  const out = [
    "📊 Statistik Bot",
    `Total user: ${totalUsers}`,
    `User banned: ${bannedUsers}`,
    `User receive promo: ${receivePromoUsers}`,
    `User tidak receive promo: ${nonReceivePromoUsers}`,
    `User aktif: ${activeUsers}`,
    `Total grup: ${totalGroups}`,
    `Grup aktif: ${activeGroups}`,
    `Grup tidak aktif: ${inactiveGroups}`,
    `Total channel: ${totalChannels}`,
    `Channel aktif: ${activeChannels}`,
    `Channel tidak aktif: ${inactiveChannels}`,
    `Channel valid: ${validChannels}`,
    `Channel tidak valid: ${invalidChannels}`,
    `Total voucher: ${totalVouchers}`,
    `Voucher terpakai: ${usedVouchers}`,
    `Voucher belum terpakai: ${unusedVouchers}`,
    `User trial: ${trialUsers}`,
    `User pro: ${proUsers}`,
    `User vip: ${vipUsers}`,
    `Total promosi hari ini: ${totalPromotionsToday}`,
    `Promosi sukses hari ini: ${promotionSuccess}`,
    `Promosi gagal hari ini: ${promotionFailed}`,
    `Estimasi ukuran JSON: ${estimatedMB} MB`,
    `Queue saat ini: ${promotionQueue.length}`
  ].join("\n");

  await sendSafeMessage(msg.chat.id, out);
}

async function handleCommandUsers(msg) {
  const users = Object.values(state.users);
  if (users.length === 0) {
    await sendSafeMessage(msg.chat.id, "Belum ada user.");
    return;
  }

  const lines = ["👥 Daftar user:"];
  for (const user of users.slice(0, 120)) {
    lines.push(
      `- ${user.id} | ${user.username ? `@${user.username}` : "-"} | ${formatPackageLabel(
        user.package
      )} | ${user.is_banned ? "banned" : "ok"}`
    );
  }

  if (users.length > 120) {
    lines.push(`... ${users.length - 120} user lainnya tidak ditampilkan.`);
  }

  await sendLongMessage(msg.chat.id, lines.join("\n"));
}

async function handleCommandUserDetail(msg, argsText) {
  const userId = parseArgsBySpace(argsText)[0];
  if (!userId) {
    await sendSafeMessage(msg.chat.id, "Format: /user USER_ID");
    return;
  }

  const user = state.users[String(userId)];
  if (!user) {
    await sendSafeMessage(msg.chat.id, "User tidak ditemukan.");
    return;
  }

  await sendSafeMessage(msg.chat.id, buildProfileText(user));
}

async function handleCommandHelp(msg, user) {
  await sendLongMessage(msg.chat.id, buildHelpText(isAdmin(user.id)));
}

async function handleCommandProfile(msg, user) {
  await sendSafeMessage(msg.chat.id, buildProfileText(user));
}

async function handleCommandStatus(msg, user) {
  expireUserPackageIfNeeded(user.id, user, "status");
  ensureUserTrialState(user);
  ensureUserReceivePromoState(user);

  if (user.package !== "trial") {
    resetDailyCounterIfNeeded(user);
  }

  const delaySec = isAdmin(user.id) ? 0 : getPackageDelaySeconds(user.package);
  let cooldown = 0;
  if (delaySec > 0 && user.last_promo_at) {
    const elapsed = Date.now() - Date.parse(user.last_promo_at);
    const req = delaySec * 1000;
    if (Number.isFinite(elapsed) && elapsed < req) {
      cooldown = (req - elapsed) / 1000;
    }
  }

  const out = [
    "📊 Status",
    `Paket: ${formatPackageLabel(user.package)}`,
    `Expired: ${user.package_expired_at || "-"}`,
    `Cooldown: ${cooldown > 0 ? formatSeconds(cooldown) : "Siap"}`,
    user.package === "trial"
      ? `Promo trial: ${user.trial.promo_used}/${user.trial.promo_limit}`
      : `Promo hari ini: ${user.daily_promo_count}/${isAdmin(user.id) ? "∞" : getDailyPromoLimit(user.package)}`,
    `Terima promo: ${user.is_receive_promo ? "Ya" : "Tidak"}`,
    `Queue global: ${promotionQueue.length}`
  ].join("\n");

  await sendSafeMessage(msg.chat.id, out);
}

async function handleCommandReceivePromoOn(msg, actorUser, argsText = "") {
  const targetArg = parseArgsBySpace(argsText)[0];
  const isSelfToggle = !targetArg || String(targetArg) === String(actorUser.id);

  if (!isSelfToggle && !isAdmin(actorUser.id)) {
    await sendSafeMessage(msg.chat.id, "Command ini khusus admin/owner untuk set user lain.");
    return;
  }

  const targetUser = isSelfToggle ? actorUser : state.users[String(targetArg)];
  if (!targetUser) {
    await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
    return;
  }

  ensureUserReceivePromoState(targetUser);
  if (!targetUser.can_custom_receive_promo && !isAdmin(actorUser.id)) {
    await sendSafeMessage(
      msg.chat.id,
      "User biasa menerima promo otomatis setelah /start dan tidak punya opsi manual ON/OFF."
    );
    return;
  }

  targetUser.has_started = true;
  targetUser.is_receive_promo = true;
  targetUser.is_opt_in = true;
  targetUser.updated_at = nowISO();
  markDirty("users");

  await sendSafeMessage(
    msg.chat.id,
    isSelfToggle
      ? "✅ Receive promo diaktifkan."
      : `✅ Receive promo user ${targetUser.id} diaktifkan.`
  );
}

async function handleCommandReceivePromoOff(msg, actorUser, argsText = "") {
  const targetArg = parseArgsBySpace(argsText)[0];
  const isSelfToggle = !targetArg || String(targetArg) === String(actorUser.id);

  if (!isSelfToggle && !isAdmin(actorUser.id)) {
    await sendSafeMessage(msg.chat.id, "Command ini khusus admin/owner untuk set user lain.");
    return;
  }

  const targetUser = isSelfToggle ? actorUser : state.users[String(targetArg)];
  if (!targetUser) {
    await sendSafeMessage(msg.chat.id, "User target tidak ditemukan.");
    return;
  }

  ensureUserReceivePromoState(targetUser);
  if (!targetUser.can_custom_receive_promo && !isAdmin(actorUser.id)) {
    await sendSafeMessage(
      msg.chat.id,
      "User biasa menerima promo otomatis setelah /start dan tidak punya opsi manual ON/OFF."
    );
    return;
  }

  targetUser.is_receive_promo = false;
  targetUser.is_opt_in = false;
  targetUser.updated_at = nowISO();
  markDirty("users");

  await sendSafeMessage(
    msg.chat.id,
    isSelfToggle
      ? "✅ Receive promo dinonaktifkan."
      : `✅ Receive promo user ${targetUser.id} dinonaktifkan.`
  );
}

async function handleCommandTrial(msg, user) {
  ensureUserTrialState(user);
  const trialSnapshot = getTrialSettingsSnapshot();
  const validCount = ensureArray(user.trial?.valid_targets, []).length;
  const validGroups = ensureArray(user.trial?.valid_groups, []).length;
  const validChannels = ensureArray(user.trial?.valid_channels, []).length;
  const required = trialSnapshot.required_targets;
  const minMember = trialSnapshot.min_group_members;
  const minSubs = trialSnapshot.min_channel_subscribers;

  await sendSafeMessage(
    msg.chat.id,
    [
      "🎁 Trial Basic",
      `Trial aktif jika total ${required} target valid (grup/channel).`,
      `Syarat grup: minimal ${minMember} member (tanpa bot).`,
      `Syarat channel: minimal ${minSubs} subscriber, bot admin + bisa post.`,
      `Durasi trial: ${trialSnapshot.duration}`,
      `Batas kirim promo trial: ${user.trial.promo_limit}`,
      "Aktivasi trial berjalan otomatis setelah target valid terpenuhi.",
      user.trial.has_used_trial
        ? "Status: trial sudah pernah dipakai (hanya 1x per user)."
        : "Status: trial belum pernah dipakai.",
      `Progress total: ${validCount}/${required}`,
      `- Grup valid: ${validGroups}`,
      `- Channel valid: ${validChannels}`
    ].join("\n")
  );
}

