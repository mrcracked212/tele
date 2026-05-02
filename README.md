# Telegram Share Promosi Bot

Bot Telegram untuk layanan share promosi dengan dukungan:
- target `group`, `channel`, `target` (group+channel), `user`, `all`
- paket `trial`, `pro`, `vip`
- trial otomatis berbasis valid target gabungan (group + channel)
- voucher, antrian promosi, admin panel command lengkap
- penyimpanan JSON (tanpa SQL) dengan atomic write dan write queue
- **konfigurasi terpusat di `config.js`** (single source of truth)
- **proteksi role**: owner & admin kebal dari ban, warning, filter, rate limit, cooldown, dan limit promosi

---

## 1. Ringkasan Fitur

### Fitur user
- Registrasi awal via `/start` (auto receive promo aktif sesuai config)
- Trial berbasis klaim group/channel valid
- Share promosi via wizard (`/buatpromo`) atau direct command (`/share...`)
- Klaim target pribadi: group/channel
- Cek profil, status paket, cooldown, dan limit harian

### Fitur admin
- Manajemen user, role, package, voucher, delay, limit
- Toggle penerima promo per user (`/receivepromo_on|_off`)
- Broadcast multi-scope (user/group/channel/target/all)
- Manajemen group & channel (cek, refresh, blacklist, remove)
- Log, backup, export data, repair state
- Konfirmasi untuk aksi berbahaya (`cleargroups`, `clearchannels`, `clearlogs`, `shutdown`)

### Keamanan & stabilitas
- Rate limit command (default 1.2 detik per user — bypass untuk privileged)
- Filter banned word + warning + auto-ban (semua bypass untuk privileged)
- Batas panjang pesan promosi (bypass untuk privileged)
- Persistensi session wizard + expiry
- Atomic JSON write untuk mengurangi risiko corrupt data
- Owner & admin **tidak bisa** di-`/ban`, di-`/warn`, atau di-auto-ban

### Silent join & startup sync
- Bot **tidak pernah** mengirim pesan status ke grup/channel saat ditambahkan;
  hasil deteksi (validasi member, status trial, progress) hanya dikirim ke
  private chat user yang menambahkan bot.
- Jika private chat gagal (user belum `/start`), notifikasi disimpan ke
  `data/pending_notifications.json` dan ditampilkan saat user `/start`.
- Saat startup, bot memvalidasi ulang `groups.json` & `channels.json` (member,
  bot status, izin admin/post). Owner dapat menambahkan chat lama via
  `/importgroup`, `/importchannel`, atau `/bulkimport*`.

### Trial Basic group-only
- Trial Basic hanya boleh promosi **ke grup**. Channel/user/all ditolak (lihat
  `MESSAGES.TRIAL_GROUP_ONLY`).
- Syarat aktivasi trial: 3 grup valid (≥30 member tanpa bot) by default.
  Channel **tidak** dihitung.
- UI menu promosi otomatis menyembunyikan tombol non-grup untuk Trial.
- Owner & admin tetap dapat menggunakan semua target tanpa batasan.

---

## 2. Arsitektur Singkat

- Runtime: Node.js 18+
- Telegram library: `node-telegram-bot-api`
- Entry point: `bot.js`
- Konfigurasi tunggal: `config.js`
- Storage helper: `db.js`
- Database JSON di folder `data/`
- Smoke test (offline, tanpa Telegram): `scripts/smoke.js`

File data utama (otomatis dibuat saat pertama kali jalan):
`users.json`, `groups.json`, `channels.json`, `vouchers.json`,
`packages.json`, `promotions.json`, `logs.json`, `sessions.json`,
`settings.json`, `pending_groups.json`, `pending_notifications.json`.
Backup otomatis tersimpan di `data/backups/` (path bisa diubah lewat
`MAINTENANCE.BACKUP_PATH`).

---

## 3. Persiapan & Instalasi

### 3.1 Prasyarat
- Node.js 18+ (disarankan)
- NPM
- Bot Telegram dari [@BotFather](https://t.me/BotFather)

### 3.2 Install dependency
```bash
npm install
```

### 3.3 Edit `config.js`

**Semua pengaturan bot ada di satu file: `config.js`.** Owner cukup buka file itu,
ubah nilainya, lalu restart bot. Tidak ada `.env`, `settings.js`, atau
`constants.js` tambahan. File `data/settings.json` HANYA untuk override runtime
hasil command admin.

Bagian wajib diisi sebelum jalan:

```js
BOT: {
  TOKEN: "ISI_TOKEN_BOT",         // dari BotFather
  NAME: "Bot Jasa Share Promosi",
  COMMAND_PREFIX: "/",
  TIMEZONE: "Asia/Jakarta"
},

OWNER: { ID: 123456789 },          // Telegram ID owner
ADMINS: [123456789, 987654321],    // ID admin tambahan
```

Bagian lain memiliki default yang waras dan boleh dibiarkan.
Lihat [Bagian 4 — Struktur `config.js`](#4-struktur-configjs-canonical) untuk daftar lengkap.

### 3.4 Cek sintaks
```bash
npm run check
```

### 3.5 Jalankan bot
```bash
npm start
```

Jika berhasil, console menampilkan `[BOT] Aktif sebagai @username_bot`.

### 3.6 Smoke test (opsional, tanpa Telegram)
```bash
npm run smoke
```

Harness `scripts/smoke.js` memuat `bot.js` di sandbox VM, mock API Telegram, lalu
menjalankan 33 skenario inti (start/status/trial/buatpromo + privilege protection).
Berguna untuk verifikasi cepat setelah edit config atau refactor.

---

## 4. Struktur `config.js` (canonical)

`config.js` mengekspor satu object besar berisi semua setting. Berikut blok-blok
utamanya beserta arti masing-masing nilai. Edit nilai langsung di file untuk
mengubah perilaku bot — tidak perlu menyentuh kode lain.

### 4.1 `BOT`, `OWNER`, `ADMINS`
- `BOT.TOKEN` — token dari BotFather (wajib).
- `BOT.NAME`, `BOT.COMMAND_PREFIX`, `BOT.TIMEZONE` — identitas bot.
- `OWNER.ID` — Telegram ID owner. Tidak bisa diturunkan role-nya.
- `ADMINS` — array Telegram ID admin tambahan.

### 4.2 `DATABASE`
- `PATH` — folder data JSON (default `./data`).
- `FLUSH_INTERVAL_MS` — interval flush queue ke disk.
- `FILES.*` — nama file untuk masing-masing dataset.

### 4.3 `PACKAGES`
Definisi paket `TRIAL`, `PRO`, `VIP`, `ADMIN`, `OWNER`. Setiap paket punya:
- `ENABLED`, `DELAY_SECONDS`, `DAILY_LIMIT`
- `CAN_SHARE_GROUP|CHANNEL|USER|ALL`
- khusus TRIAL: `DURATION`, `PROMO_LIMIT`, `REQUIRED_TARGETS`,
  `MIN_GROUP_MEMBERS_EXCLUDING_BOT`, `MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT`,
  `ONLY_ONCE`.

### 4.4 `VOUCHER`
- `CODE_LENGTH`, `PREFIX`, `ALLOW_CUSTOM_CODE`
- `DEFAULT_DURATION`, `MAX_CREATE_PER_COMMAND`
- `VALID_PACKAGES`, `EXPIRE_UNUSED_VOUCHER`, `UNUSED_VOUCHER_EXPIRE_AFTER`.

### 4.5 `TRIAL`
Default trial sebelum dipakai per-paket: `DEFAULT_DURATION`, `DEFAULT_PROMO_LIMIT`,
`REQUIRED_VALID_TARGETS`, `MIN_GROUP_MEMBERS_EXCLUDING_BOT`,
`MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT`, `AUTO_DETECT_GROUP|CHANNEL`,
`ALLOW_ADMIN_ASSIGN_TARGET`.

### 4.6 `PROMOTION` & `BROADCAST`
- `PROMOTION.MAX_TEXT_LENGTH`, `MIN_TEXT_LENGTH`, `MAX_URL_BUTTONS`,
  `ALLOW_PHOTO_PROMO`, `ALLOW_VIDEO_PROMO`, `DEFAULT_TARGET`,
  `CONFIRM_BEFORE_SEND`.
- `PROMOTION.SEND_QUEUE.BATCH_SIZE`, `DELAY_BETWEEN_BATCH_MS`,
  `MAX_RETRY_PER_TARGET`, `RETRY_DELAY_MS`.
- `PROMOTION.PROGRESS.UPDATE_INTERVAL_MS`, `EDIT_RETRY_DELAY_MS`,
  `MAX_EDIT_RETRY`.
- `BROADCAST.BATCH_SIZE`, `DELAY_BETWEEN_BATCH_MS`, `MAX_MESSAGE_LENGTH`,
  `MAX_DAILY_BROADCAST`, `ALLOW_CANCEL`, `SHOW_PROGRESS`.

### 4.7 `USERS`, `GROUPS`, `CHANNELS`
- `USERS.AUTO_RECEIVE_PROMO_AFTER_START` — user biasa otomatis menerima promo
  setelah `/start`.
- `USERS.ADMIN_CAN_CUSTOM_RECEIVE_PROMO`, `OWNER_CAN_CUSTOM_RECEIVE_PROMO` —
  hanya owner/admin yang punya tombol on/off receive promo manual.
- `GROUPS.MIN_MEMBERS_FOR_TRIAL_EXCLUDING_BOT`,
  `CHANNELS.MIN_SUBSCRIBERS_FOR_TRIAL_EXCLUDING_BOT` — minimum target valid trial.
- `CHANNELS.REQUIRE_BOT_ADMIN`, `REQUIRE_CAN_POST_MESSAGES` — syarat channel
  diakui sebagai target.

### 4.8 `SECURITY`
Semua filter & rate limit:
- `RATE_LIMIT_ENABLED`, `COMMAND_COOLDOWN_MS`, `COMMAND_MAX_PER_WINDOW`,
  `COMMAND_WINDOW_MS`.
- `MAX_PROMO_PER_USER_PER_DAY_FREE|TRIAL|PRO|VIP`.
- `MAX_PROMO_TEXT_LENGTH`, `MIN_PROMO_TEXT_LENGTH`.
- `BANNED_WORD_FILTER_ENABLED`, `BANNED_WORDS` (array).
- `BLOCK_LINKS_ENABLED`, `ALLOWED_DOMAINS`, `BLOCKED_DOMAINS`.
- `WARNING_ENABLED`, `MAX_WARNING_BEFORE_BAN`, `AUTO_BAN_ENABLED`,
  `AUTO_BAN_REASON`.
- `ANTI_SPAM_ENABLED`, `SAME_MESSAGE_LIMIT`, `SAME_MESSAGE_WINDOW_MS`.
- `ADMIN_ACTION_CONFIRMATION`, `DANGEROUS_COMMAND_CONFIRMATION`.

### 4.9 `LIMITS`, `SESSIONS`, `MENUS`, `LOGGING`, `MAINTENANCE`, `MESSAGES`
- `LIMITS.*` — batas panjang/ jumlah display, log entries, promotion entries.
- `SESSIONS.EXPIRE_AFTER_MS`, `CLEAN_INTERVAL_MS`, `CANCEL_COMMAND`.
- `MENUS.MAIN_MENU.*`, `MENUS.ADMIN_MENU.*` — label tombol inline.
- `LOGGING.MAX_LOGS_PER_FILE`, `CLEAR_LOGS_AFTER_DAYS`.
- `MAINTENANCE.BACKUP_PATH`, `MAX_BACKUP_FILES`, `AUTO_BACKUP_INTERVAL_MS`,
  `PACKAGE_SWEEP_INTERVAL_MS`, `MAINTENANCE_MODE`, `MAINTENANCE_MESSAGE`.
- `MESSAGES.START`, `HELP`, `BANNED`, `NO_ACCESS`, `TRIAL_USED`, `PROMO_SENT`,
  `PROMO_FAILED`, `CONFIRM_SEND_PROMO`, `OWNER_ADMIN_PROTECTED`,
  `TRIAL_GROUP_ONLY`, `JOIN_NOTIFICATION_FOOTER`.

### 4.10 `NOTIFICATIONS` (silent join & pending notification)
Saat bot ditambahkan ke grup/channel, bot **tidak boleh** mengirim pesan status
ke chat tersebut. Semua hasil deteksi (validasi member/subscriber, status trial,
progress) hanya dikirim ke private chat user yang menambahkan bot. Jika gagal
(mis. user belum pernah `/start`), notifikasi disimpan ke
`data/pending_notifications.json` dan ditampilkan saat user `/start`.

Flag yang tersedia:
- `SEND_JOIN_STATUS_TO_GROUP` (default `false`) — biarkan `false`. **Jangan**
  set `true`; kontrak bot adalah silent.
- `SEND_JOIN_STATUS_TO_CHANNEL` (default `false`) — sama dengan di atas.
- `SEND_JOIN_STATUS_TO_INVITER_PRIVATE` (default `true`) — kirim hasil deteksi
  ke private chat inviter.
- `SAVE_PENDING_NOTIFICATION_IF_PRIVATE_FAILED` (default `true`) — saat private
  message ke inviter gagal (403, dll), simpan sebagai pending.
- `SHOW_PENDING_NOTIFICATION_ON_START` (default `true`) — flush pending saat
  user `/start`.
- `MAX_PENDING_PER_USER` (default `50`) — quota antrian pending per user.
- `MAX_RECENT_JOINS_DISPLAY` (default `30`) — limit baris pada `/recentjoins`.

> **Larangan:** jangan ada fallback yang mengirim status ke grup/channel
> meskipun pengiriman private gagal. Pengganti satu-satunya adalah pending
> notification yang disimpan ke `data/pending_notifications.json` dan dapat
> diaudit owner via `/pendingnotifications`.

### 4.11 `STARTUP_SYNC` (validasi ulang chat saat bot start)
Telegram Bot API **tidak menyediakan** endpoint untuk mengambil daftar grup/
channel yang sedang dimasuki bot dari nol. Karena itu bot:

1. Memvalidasi ulang seluruh `groups.json` & `channels.json` saat startup
   (member count, status, izin admin).
2. Auto-save chat dari setiap incoming `message`/`channel_post`/
   `edited_channel_post` (`detected_source: auto_save_from_update`).
3. Menyediakan command admin `/importgroup`, `/importchannel`,
   `/bulkimportgroups`, `/bulkimportchannels` untuk import manual chat lama,
   serta `/syncgroups`, `/syncchannels`, `/syncchats` untuk re-validasi
   manual.

Flag config:
- `STARTUP_SYNC.ENABLED` — master switch untuk startup sync.
- `SYNC_GROUPS_ON_START`, `SYNC_CHANNELS_ON_START` — sub-toggle.
- `VALIDATE_MEMBER_COUNT_ON_START`, `VALIDATE_CHANNEL_PERMISSION_ON_START` —
  pilih validasi penuh atau cek "still member" saja.
- `DELAY_BETWEEN_CHECK_MS`, `MAX_CHECK_PER_START` — atur tempo agar tidak
  kena flood control.
- `LOG_RESULT` — tulis ringkasan ke `logs.json` (`startup_sync_done`).
- `AUTO_SAVE_CHAT_FROM_UPDATE` — auto-save chat dari incoming update.

Field tambahan pada `groups.json`/`channels.json`: `detected_source`,
`last_seen_at`, `last_sync_at`.

### 4.12 Trial Basic group-only (revisi)
- `PACKAGES.TRIAL.CAN_SHARE_GROUP: true` — diizinkan.
- `PACKAGES.TRIAL.CAN_SHARE_CHANNEL: false`, `CAN_SHARE_USER: false`,
  `CAN_SHARE_ALL: false` — **wajib false** untuk Trial Basic.
- `TRIAL.REQUIRED_VALID_GROUPS: 3` (default) — syarat aktivasi trial dihitung
  hanya dari grup valid (≥ `MIN_GROUP_MEMBERS_EXCLUDING_BOT`). Channel **tidak**
  dihitung kecuali `TRIAL.CHANNEL_COUNT_FOR_TRIAL: true`.
- UI menu promosi (`sendPromoTargetPrompt`) otomatis menyembunyikan tombol
  Channel/User/Semua untuk paket Trial Basic.
- Owner & admin tetap bebas menggunakan semua target (lihat `PRIVILEGES`).

### 4.13 `PRIVILEGES` (kekebalan owner/admin)
Lihat [Bagian 9 — Proteksi Role](#9-proteksi-role-owner--admin).

---

## 5. Helper Config Internal

`bot.js` membaca config lewat helper terpadu (lihat header `bot.js`):

| Helper | Fungsi |
|---|---|
| `getConfigValue("DOT.PATH", fallback)` | Baca nilai dari `config.js` (path titik). |
| `getSetting("DOT.PATH", fallback)` | Baca runtime override (`data/settings.json`) → fallback ke `config.js`. |
| `updateSetting("DOT.PATH", value)` | Tulis override runtime + tandai dirty. |
| `loadRuntimeSettings()` | Snapshot `state.settings`. |
| `mergeConfigWithRuntimeSettings()` | Object gabungan efektif. |
| `isOwner(id)` / `isAdmin(id)` / `isPrivileged(id)` | Cek role. |
| `getPrivilegeFlag(id, "FLAG", default=true)` | Baca `PRIVILEGES.{OWNER\|ADMIN}.<flag>`. |

Aturan emas: **setiap titik enforcement memanggil `isPrivileged(userId)` lebih
dulu dan langsung izinkan jika true** (sesuai flag PRIVILEGES). User biasa tetap
dicek penuh.

---

## 6. Alur Penggunaan User

### 6.1 Onboarding awal
1. User buka private chat dengan bot
2. Jalankan `/start` → status receive promo otomatis aktif
   (`USERS.AUTO_RECEIVE_PROMO_AFTER_START`)
3. Cek status akun: `/profile` dan `/status`

> User biasa tidak punya tombol manual untuk on/off receive promo.
> Hanya owner/admin (atau target yang diatur owner/admin) yang bisa diatur via
> `/receivepromo_on|_off`.

### 6.2 Trial Basic (group + channel)
Trial aktif otomatis jika total target valid user mencapai syarat di
`TRIAL.REQUIRED_VALID_TARGETS`.

Syarat default (dapat diubah di `config.js` atau lewat command admin):
- total target valid: `3` (gabungan group + channel)
- group valid: minimal `30` member (tanpa bot)
- channel valid: minimal `50` subscriber + bot admin + bisa post

Command yang relevan:
- `/trial` — lihat progress dan syarat
- `/claimgroup` — klaim group saat dijalankan di group
- `/claimgroup GROUP_ID` — klaim dari private chat
- `/claimchannel` — pilih channel dari inline list di private
- `/claimchannel CHANNEL_ID` — klaim langsung via ID
- `/claimtrial [CHAT_ID]` — helper klaim cepat
- `/mygroups`, `/mychannels`, `/mytargets`

#### Catatan klaim channel
Agar channel valid trial:
- bot harus ada di channel
- bot status admin
- bot punya izin post
- subscriber memenuhi minimum (`CHANNELS.MIN_SUBSCRIBERS_FOR_TRIAL_EXCLUDING_BOT`)

### 6.3 Buat promosi

#### Metode wizard
1. `/buatpromo`
2. isi judul
3. isi body
4. pilih target (`group`, `channel`, `target`, `user`, `all`)
5. konfirmasi kirim

Batalkan wizard kapan saja dengan `/cancel`.

#### Metode direct command
- `/sharegrup JUDUL|ISI`
- `/sharechannel JUDUL|ISI`
- `/sharetarget JUDUL|ISI`
- `/shareuser JUDUL|ISI`
- `/shareall JUDUL|ISI`

### 6.4 Format tombol URL (opsional)
Body promosi mendukung tombol URL dengan format:

```text
button:Nama Tombol|https://contoh.com
```

Contoh:
```text
Diskon 50% untuk member baru.
Berlaku sampai minggu ini.
button:Daftar Sekarang|https://contoh.com/daftar
```

Maksimal jumlah tombol URL diatur di `PROMOTION.MAX_URL_BUTTONS`. URL harus
`http://` atau `https://`.

---

## 7. Matrix Paket & Batasan

Default behavior (dapat diubah di `PACKAGES.*`):

| Paket | Group | Channel | User | All | Daily limit | Cooldown |
|---|:---:|:---:|:---:|:---:|---:|---:|
| trial | ✅ | ✅ | ❌ | ❌ | 3/hari | 60s |
| pro   | ✅ | ✅ | ❌ | ❌ | 20/hari | 30s |
| vip   | ✅ | ✅ | ✅ | ✅ | 50/hari | 15s |

Keterangan:
- `target` = `group + channel`.
- Owner & admin **bypass semua limit/cooldown** (lihat
  [Bagian 9](#9-proteksi-role-owner--admin)).
- Paket `free` tidak bisa membuat promosi.

Format durasi: `10s`, `15m`, `12h`, `7d`, `2w`.

---

## 8. Command User

> Banyak command user bersifat private-only. Pengecualian: `/claimgroup` dan
> `/claimtrial` bisa dipakai sesuai konteks chat.

| Command | Fungsi |
|---|---|
| `/start` | Mulai interaksi + tampilkan menu inline |
| `/help` | Bantuan command |
| `/profile` | Profil user, paket, trial, status ban |
| `/status` | Paket aktif, expired, cooldown, limit harian, queue |
| `/trial` | Info syarat trial dan progress target valid |
| `/redeem KODE` | Aktivasi voucher |
| `/buatpromo` | Wizard pembuatan promosi |
| `/sharegrup JUDUL\|ISI` | Promosi target group |
| `/sharechannel JUDUL\|ISI` | Promosi target channel |
| `/sharetarget JUDUL\|ISI` | Promosi target group+channel |
| `/shareuser JUDUL\|ISI` | Promosi target user opt-in |
| `/shareall JUDUL\|ISI` | Promosi target group+channel+user |
| `/mygroups` | List group yang diklaim user |
| `/mychannels` | List channel yang diklaim user |
| `/mytargets` | Ringkasan group+channel user |
| `/claimgroup [GROUP_ID]` | Klaim group untuk trial |
| `/claimchannel [CHANNEL_ID]` | Klaim channel untuk trial |
| `/claimtrial [CHAT_ID]` | Helper klaim trial by context/ID |
| `/cancel` | Batalkan flow wizard/session |

---

## 9. Proteksi Role Owner & Admin

> **PENTING:** Owner dan admin adalah role terpercaya. Bot tidak akan pernah
> membatasi, memblokir, memban, memberi warning otomatis, atau memfilter pesan
> owner/admin dalam kondisi apa pun. Semua sistem pembatasan **hanya** berlaku
> untuk user biasa.

### 9.1 Hierarki & immutability
- **Owner** adalah role tertinggi dan tidak bisa dihapus, diturunkan, diban,
  atau dibatasi. Hanya owner yang dapat menambah/menghapus admin.
- **Admin** kebal pembatasan tapi tetap di bawah owner. Admin tidak dapat
  mengubah owner, memban admin lain, atau (default) menghapus admin lain.
- Setelah role admin dihapus oleh owner, user tersebut kembali mengikuti aturan
  user biasa.

### 9.2 Flag bypass di `PRIVILEGES`
File `config.js` punya blok `PRIVILEGES.OWNER` dan `PRIVILEGES.ADMIN` yang
mengontrol kekebalan masing-masing role. Default semua flag `true` agar
kontrak "jangan pernah membatasi privileged" tetap dipatuhi walau ada flag
yang lupa diisi.

| Flag | Efek (true = bypass aktif) |
|---|---|
| `IMMUNE_TO_BAN` | Tidak bisa di-/`ban` via command |
| `IMMUNE_TO_AUTO_BAN` | Tidak terkena auto-ban dari akumulasi warning |
| `IMMUNE_TO_WARNING` | `addWarningToUser` di-skip |
| `IMMUNE_TO_FILTER` | Filter banned word di-skip |
| `IMMUNE_TO_RATE_LIMIT` | Cooldown command 1.2s di-skip |
| `IMMUNE_TO_COOLDOWN` | Cooldown delay paket di-skip |
| `IMMUNE_TO_DAILY_LIMIT` | Limit promosi harian di-skip |
| `IMMUNE_TO_PROMO_LIMIT` | Counter promo tidak bertambah |
| `BYPASS_PACKAGE_CHECK` | Boleh promo walau paket `free` |
| `BYPASS_TRIAL_LIMIT` | Limit promo trial di-skip |
| `BYPASS_PROMO_TARGET_LIMIT` | Boleh kirim ke target manapun |
| `BYPASS_TEXT_LENGTH_LIMIT` | Boleh kirim pesan melebihi `MAX_PROMO_TEXT_LENGTH` |
| `CAN_USE_ANY_WORD` | Tidak terkena banned word filter |
| `CAN_USE_ALL_FEATURES` | Akses ke semua fitur user/admin |
| `CAN_MANAGE_ADMINS` | Boleh tambah/hapus admin (default: hanya OWNER) |
| `CAN_MANAGE_OWNER` | Boleh ubah role owner (selalu false) |
| `CAN_RUN_DANGEROUS_COMMANDS` | Boleh `/cleargroups`, `/clearlogs`, `/shutdown`, dll |

### 9.3 Perilaku command admin yang melindungi privileged
- `/ban USER_ID` → menolak jika target adalah owner/admin dengan pesan
  `MESSAGES.OWNER_ADMIN_PROTECTED`.
- `/warn USER_ID` → menolak target privileged dengan pesan yang sama.
- `/setrole USER_ID admin|user` → tidak bisa ubah role owner.
- `/removeadmin USER_ID` → hanya owner yang boleh menjalankan; tidak bisa
  hapus owner.

### 9.4 Auto ban
- User biasa: warning >= `SECURITY.MAX_WARNING_BEFORE_BAN` → otomatis di-ban
  jika `SECURITY.AUTO_BAN_ENABLED = true`.
- Owner/admin: warning di-skip total, auto-ban tidak akan menyentuh.

### 9.5 Audit log
Bypass tertentu mencatat ke logs untuk audit:
- `privileged_warning_skipped` saat warning di-skip.
- `ban_blocked_privileged` saat `/ban` ditolak.

---

## 10. Command Admin

Semua command admin private-only & memerlukan role admin/owner.

### 10.1 Monitoring & statistik
| Command | Fungsi |
|---|---|
| `/admin` | Panel admin + tombol cepat |
| `/stats` | Statistik global user/group/channel/promo |
| `/todaystats` | Statistik promosi hari ini |
| `/botstatus` | Queue, status worker, session aktif, ukuran DB |
| `/healthcheck` | Cek health bot |
| `/users` | Ringkasan daftar user |
| `/user USER_ID` | Detail user |
| `/searchuser KEYWORD` | Cari user by id/username/nama |

### 10.2 Moderasi user & akses
| Command | Fungsi |
|---|---|
| `/ban USER_ID` | Ban user (**ditolak** untuk owner/admin) |
| `/unban USER_ID` | Unban user |
| `/warn USER_ID ALASAN` | Tambah warning (**ditolak** untuk owner/admin) |
| `/warnings USER_ID` | Lihat riwayat warning |
| `/resetwarn USER_ID` | Reset warning user |
| `/setpackage USER_ID PACKAGE DURASI` | Set paket user |
| `/setpackage USER_ID free` | Cabut paket ke free |
| `/extend USER_ID DURASI` | Perpanjang expired paket aktif |
| `/removeaccess USER_ID` | Set user jadi free |
| `/resetlimit USER_ID` | Reset quota harian promosi user |
| `/resetcooldown USER_ID` | Reset cooldown promosi user |
| `/setrole USER_ID admin\|user` | Ubah role runtime (owner-only, owner immutable) |
| `/removeadmin USER_ID` | Hapus admin runtime (owner-only) |
| `/noteuser USER_ID CATATAN` | Simpan catatan admin ke user |
| `/userlogs USER_ID` | Log terkait user |
| `/receivepromo_on [USER_ID]` | Aktifkan receive promo (admin/owner & target) |
| `/receivepromo_off [USER_ID]` | Nonaktifkan receive promo (admin/owner & target) |

> Perubahan role via `/setrole` dan `/removeadmin` bersifat runtime (tidak
> menulis `config.js`). Setelah restart, role mengikuti `OWNER.ID` + `ADMINS` di
> `config.js`.

### 10.3 Voucher
| Command | Fungsi |
|---|---|
| `/createvoucher PACKAGE DURASI JUMLAH` | Generate voucher massal |
| `/createcustomvoucher KODE PACKAGE DURASI` | Buat voucher dengan kode custom |
| `/vouchers` | List voucher |
| `/voucher KODE` | Detail voucher |
| `/deletevoucher KODE` | Hapus voucher |
| `/disablevoucher KODE` | Disable voucher |
| `/enablevoucher KODE` | Enable voucher |
| `/unusedvouchers` | List voucher belum dipakai |
| `/usedvouchers` | List voucher sudah dipakai |
| `/exportvouchers` | Export voucher CSV-like text |

### 10.4 Paket & policy (override runtime)
Command ini menulis ke `data/settings.json` sebagai override `config.js`.

| Command | Fungsi |
|---|---|
| `/packages` | Lihat konfigurasi paket aktif |
| `/setdelay PACKAGE DETIK` | Atur cooldown per paket |
| `/setlimit PACKAGE JUMLAH` | Atur limit harian per paket |
| `/settrialduration DURASI` | Atur durasi trial default |
| `/settriallimit JUMLAH` | Atur limit promo trial |
| `/settrialtarget JUMLAH` | Atur jumlah target valid trial |
| `/setmingroupmembers JUMLAH` | Min member group trial |
| `/setminchannelsubs JUMLAH` | Min subscriber channel trial |
| `/setmintrialmembers JUMLAH` | Alias `setmingroupmembers` |
| `/setmintrialsubs JUMLAH` | Alias `setminchannelsubs` |
| `/setrequiredtrialtarget JUMLAH` | Alias `settrialtarget` |
| `/enablepackage PACKAGE` | Aktifkan paket |
| `/disablepackage PACKAGE` | Nonaktifkan paket |

### 10.5 Broadcast
| Command | Scope |
|---|---|
| `/broadcast PESAN` | user opt-in |
| `/broadcastall PESAN` | semua user non-ban yang pernah start |
| `/broadcastuser PESAN` | user |
| `/broadcastgroup PESAN` | group aktif |
| `/broadcastchannel PESAN` | channel aktif (admin+postable) |
| `/broadcasttarget PESAN` | group + channel |
| `/cancelbroadcast` | minta pembatalan broadcast berjalan |

### 10.6 Manajemen group
| Command | Fungsi |
|---|---|
| `/groups` | List semua group |
| `/activegroups` | List group aktif |
| `/inactivegroups` | List group nonaktif |
| `/group GROUP_ID` | Detail group |
| `/groupinfo GROUP_ID` | Detail group (alias) |
| `/removegroup GROUP_ID` | Hapus group dari DB |
| `/checkgroup GROUP_ID` | Validasi ulang group |
| `/refreshgroups` | Validasi ulang semua group |
| `/blacklistgroup GROUP_ID ALASAN` | Blacklist group |
| `/unblacklistgroup GROUP_ID` | Unblacklist group |
| `/addgrouplink LINK` | Simpan link group sebagai pending |
| `/cleargroups` | Hapus semua group (butuh konfirmasi) |

### 10.7 Manajemen channel
| Command | Fungsi |
|---|---|
| `/channels` | List semua channel |
| `/activechannels` | List channel aktif |
| `/inactivechannels` | List channel nonaktif |
| `/validchannels` | List channel valid trial |
| `/invalidchannels` | List channel tidak valid trial |
| `/channel CHANNEL_ID` | Detail channel |
| `/removechannel CHANNEL_ID` | Hapus channel dari DB |
| `/checkchannel CHANNEL_ID` | Validasi ulang channel |
| `/refreshchannels` | Validasi ulang semua channel |
| `/blacklistchannel CHANNEL_ID ALASAN` | Blacklist channel |
| `/unblacklistchannel CHANNEL_ID` | Unblacklist channel |
| `/clearchannels` | Hapus semua channel (butuh konfirmasi) |

### 10.7b Silent join, startup sync, manual import
| Command | Fungsi |
|---|---|
| `/recentjoins` | Daftar grup & channel yang baru terdeteksi (urut `added_at`). |
| `/recentgroups` | Filter recent: hanya grup. |
| `/recentchannels` | Filter recent: hanya channel. |
| `/pendingnotifications` | Audit notifikasi join yang gagal terkirim ke private inviter. |
| `/importgroup GROUP_ID NAMA_GRUP` | Import manual chat_id grup lama yang belum tercatat di database. |
| `/importchannel CHANNEL_ID NAMA_CHANNEL` | Import manual chat_id channel lama. |
| `/bulkimportgroups` | Bulk import grup; satu baris berisi `GROUP_ID NAMA`. |
| `/bulkimportchannels` | Bulk import channel; satu baris berisi `CHANNEL_ID NAMA`. |
| `/syncgroups` | Re-validasi semua grup di database (member count + bot still in chat). |
| `/syncchannels` | Re-validasi semua channel (subscribers, bot admin, izin post). |
| `/syncchats` | Sync sekaligus grup + channel. |

> Catatan: import manual hanya dibutuhkan jika owner punya chat_id grup/
> channel lama yang belum tercatat di database (bot belum pernah menerima
> update dari chat itu sejak dijalankan). Untuk chat baru, gunakan flow
> normal (tambahkan bot, biarkan auto-save bekerja).

### 10.8 Logs, backup, maintenance
| Command | Fungsi |
|---|---|
| `/logs` | Log terbaru |
| `/errorlogs` | Filter log error |
| `/promologs` | Filter log promosi |
| `/adminlogs` | Filter log admin |
| `/clearlogs` | Hapus semua log (butuh konfirmasi) |
| `/exportlogs` | Export log text |
| `/backup` | Snapshot state ke file backup |
| `/restore` | Placeholder (restore manual) |
| `/exportdb` | Dump seluruh state JSON |
| `/cleancache` | Bersihkan session expired |
| `/repairdb` | Normalisasi shape state |
| `/reloadconfig` | Reload runtime config dari state/settings |
| `/shutdown` | Shutdown bot aman (butuh konfirmasi) |
| `/restartinfo` | Info restart manual |

---

## 11. Menu Inline

`/start` menampilkan inline menu cepat:
- profil, paket, trial, target saya, promosi, bantuan
- toggle receive promo (hanya tampil untuk owner/admin)
- menu admin (khusus admin)

Callback tambahan:
- pilih target wizard promosi
- pilih channel untuk klaim channel
- konfirmasi aksi berbahaya admin

---

## 12. Aturan Trial & Validasi Target

### 12.1 Group
Valid jika:
- bot masih ada di group
- jumlah member (tanpa bot) >= `TRIAL.MIN_GROUP_MEMBERS_EXCLUDING_BOT`

### 12.2 Channel
Valid jika:
- bot admin di channel
- bot bisa post message
- subscriber >= `TRIAL.MIN_CHANNEL_SUBSCRIBERS_EXCLUDING_BOT`

### 12.3 Aktivasi trial otomatis
Trial aktif jika:
- user masih paket `free`
- jumlah `valid_targets` >= `TRIAL.REQUIRED_VALID_TARGETS`

Saat aktif:
- paket user di-set ke `trial`
- durasi trial mengikuti `TRIAL.DEFAULT_DURATION` /
  `PACKAGES.TRIAL.DURATION`.

---

## 13. Moderasi Konten Promosi (User Biasa)

Sebelum promosi user biasa masuk queue, bot cek:
1. akses paket + izin target
2. cooldown + limit harian
3. panjang pesan maksimal (`LIMITS.MAX_PROMO_TEXT_LENGTH`)
4. kata terlarang (`SECURITY.BANNED_WORDS`)
5. format tombol URL

Pelanggaran:
- warning bertambah (`SECURITY.WARNING_ENABLED`)
- jika `warning_count >= SECURITY.MAX_WARNING_BEFORE_BAN` dan
  `SECURITY.AUTO_BAN_ENABLED = true` → user auto-ban.

> Owner/admin di-bypass semua langkah ini sesuai `PRIVILEGES`. Lihat
> [Bagian 9](#9-proteksi-role-owner--admin).

---

## 14. Queue, Delivery, dan Error Handling

- Promosi/broadcast diproses lewat queue global.
- Pengiriman bertahap (batch) sesuai `PROMOTION.SEND_QUEUE.*` /
  `BROADCAST.*`.
- Error fatal saat kirim memicu efek samping otomatis:
  - user block bot → `is_receive_promo` di-set false
  - group/channel inaccessible → ditandai nonaktif / tidak valid

---

## 15. Operasional Harian (Saran)

1. Cek status: `/stats`, `/botstatus`, `/errorlogs`
2. Cek target: `/activegroups`, `/activechannels`
3. Rapikan data berkala: `/refreshgroups`, `/refreshchannels`
4. Backup berkala: `/backup`
5. Verifikasi cepat setelah update: `npm run smoke`

---

## 16. Troubleshooting

### Bot tidak bisa start
- Gejala: `Silakan isi BOT.TOKEN di config.js sebelum menjalankan bot.`
- Solusi: isi `BOT.TOKEN` valid di `config.js`.

### Command ditolak "hanya private chat"
- Jalankan command tersebut dari private chat bot.
- Khusus klaim group/channel, ikuti konteks command masing-masing.

### Klaim channel gagal / tidak valid
Periksa: bot ada di channel, bot admin, izin post, subscriber cukup.

### Promo ditolak
Cek kemungkinan: paket `free`, target tidak diizinkan paket, cooldown belum
selesai, limit harian tercapai, konten melanggar moderasi.

### `/ban USER_ID` muncul "Tidak bisa memban owner/admin"
Itu **expected**. Owner/admin dilindungi oleh `PRIVILEGES`. Kalau ingin
betul-betul men-ban, owner harus terlebih dulu menjalankan
`/removeadmin USER_ID`.

### Role admin hilang setelah restart
Pastikan ID admin ada di `config.js → ADMINS`. Command `/setrole` bersifat
runtime, bukan edit file config.

### Setting yang diubah lewat command kembali ke default
File `data/settings.json` mungkin terhapus. Sumber default tetap `config.js`,
edit di sana untuk perubahan permanen, lalu restart bot.

---

## 17. Checklist Uji Cepat (1× run)

1. `npm install`
2. `npm run check` → tidak ada syntax error
3. `npm run smoke` → 33/33 PASS
4. Edit `config.js` → isi `BOT.TOKEN`, `OWNER.ID`, `ADMINS`
5. `npm start`
6. `/start`, `/status`
7. tambah bot ke group → `/claimgroup`
8. tambah bot ke channel (admin) → `/claimchannel`
9. cek `/trial`, `/mytargets`
10. `/buatpromo` sampai selesai
11. cek admin: `/stats`, `/botstatus`, `/logs`
12. `/backup`

---

## 18. Catatan Kepatuhan

Gunakan bot ini secara legal dan sesuai kebijakan Telegram:
- jangan spam
- hormati persetujuan user (opt-in default + admin override)
- hindari konten terlarang

Project ini dirancang sebagai sistem promosi terkelola (bukan spammer massal
ilegal).

---

## 19. Struktur Folder

```text
.
├── bot.js                # Entry point + handler command
├── config.js             # SUMBER TUNGGAL setting bot
├── db.js                 # Helper baca/tulis JSON (atomic)
├── package.json
├── README.md
├── data/                 # Auto-dibuat: state runtime
│   ├── users.json
│   ├── groups.json
│   ├── channels.json
│   ├── vouchers.json
│   ├── packages.json
│   ├── promotions.json
│   ├── logs.json
│   ├── sessions.json
│   ├── settings.json     # Override runtime hasil command admin
│   ├── pending_groups.json
│   └── backups/
└── scripts/
    └── smoke.js          # Harness smoke test offline (npm run smoke)
```

NPM scripts:
- `npm run check` — `node --check bot.js`
- `npm run smoke` — jalankan 33 skenario smoke test
- `npm start` — jalankan bot
