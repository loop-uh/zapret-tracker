const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./database');

// ========== Config ==========

const CONFIG = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  botToken: process.env.BOT_TOKEN || '',
  botUsername: process.env.BOT_USERNAME || '',
  siteUrl: process.env.SITE_URL || 'http://88.210.52.47',
  adminTelegramId: 6483277608,
  maxFileSize: 5 * 1024 * 1024, // 5MB
  uploadDir: path.join(__dirname, 'uploads'),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
};

// ========== Init ==========

db.init();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Cache-bust version — changes on every server restart to defeat Telegram WebApp cache
const APP_VERSION = Date.now().toString(36);

// Serve index.html BEFORE static middleware — with cache-busting and no-cache headers
app.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>Zapret Tracker — Баги и Идеи</title>
  <link rel="stylesheet" href="/css/style.css?v=${APP_VERSION}">
  <link rel="icon" type="image/x-icon" href="/img/Zapret2.ico">
  <script src="https://telegram.org/js/telegram-web-app.js"><\/script>
  <script>
    // Telegram WebApp may leak CommonJS globals (module/exports) which breaks UMD libs.
    // Temporarily hide them while loading markdown libs.
    window.__md_saved_module = window.module;
    window.__md_saved_exports = window.exports;
    try { window.module = undefined; window.exports = undefined; } catch {}
  <\/script>
  <script src="/js/marked.min.js?v=${APP_VERSION}"><\/script>
  <script>
    // If marked exported into CommonJS, re-export to window
    try {
      if (!window.marked) {
        const m = (typeof module !== 'undefined' && module && module.exports) ? module.exports
          : ((typeof exports !== 'undefined' && exports) ? exports : null);
        if (m) window.marked = m;
      }
    } catch {}
  <\/script>
  <script src="/js/purify.min.js?v=${APP_VERSION}"><\/script>
  <script>
    // If DOMPurify exported into CommonJS, re-export to window
    try {
      if (!window.DOMPurify) {
        const p = (typeof module !== 'undefined' && module && module.exports) ? module.exports
          : ((typeof exports !== 'undefined' && exports) ? exports : null);
        if (p) window.DOMPurify = p.default || p;
      }
    } catch {}
  <\/script>
  <script>
    // Restore possible CommonJS globals
    try {
      window.module = window.__md_saved_module;
      window.exports = window.__md_saved_exports;
    } catch {}
  <\/script>
</head>
<body>
  <div id="app"></div>
  <div class="toast-container" id="toasts"></div>
  <script src="/js/app.js?v=${APP_VERSION}"><\/script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  index: false, // Don't serve index.html from static — our route above handles it
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));
app.use('/uploads', express.static(CONFIG.uploadDir, {
  maxAge: '30d',
  setHeaders(res, filePath) {
    // Prevent MIME sniffing (helps against content-type tricks)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Ensure correct content-type for images
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    };
    if (mimeMap[ext]) res.setHeader('Content-Type', mimeMap[ext]);
  },
}));

// ========== File Upload ==========

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = CONFIG.uploadDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: CONFIG.maxFileSize },
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      'jpeg', 'jpg', 'png', 'gif', 'webp',
      'pdf', 'doc', 'docx', 'txt',
      'zip', 'rar', '7z',
      'log', 'conf', 'json', 'xml', 'csv',
      'mp4', 'webm',
    ]);
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowed.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  },
});

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

function cleanupMulterFiles(files) {
  for (const f of (files || [])) {
    if (f && f.path) safeUnlink(f.path);
  }
}

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const read = fs.readSync(fd, buf, 0, len, pos);
  return read === len ? buf : buf.slice(0, read);
}

function validateImageFileByExt(filePath, ext) {
  const st = fs.statSync(filePath);
  const size = st.size;
  const fd = fs.openSync(filePath, 'r');
  try {
    const e = (ext || '').toLowerCase();

    if (e === '.jpg' || e === '.jpeg') {
      if (size < 4) return false;
      const head = readAt(fd, 0, 2);
      const tail = readAt(fd, Math.max(0, size - 2), 2);
      return head.length === 2 && tail.length === 2 && head[0] === 0xff && head[1] === 0xd8 && tail[0] === 0xff && tail[1] === 0xd9;
    }

    if (e === '.gif') {
      if (size < 7) return false;
      const head = readAt(fd, 0, 6).toString('ascii');
      const tail = readAt(fd, size - 1, 1);
      return (head === 'GIF87a' || head === 'GIF89a') && tail.length === 1 && tail[0] === 0x3b;
    }

    if (e === '.webp') {
      if (size < 12) return false;
      const head = readAt(fd, 0, 12);
      if (head.length < 12) return false;
      if (head.toString('ascii', 0, 4) !== 'RIFF') return false;
      if (head.toString('ascii', 8, 12) !== 'WEBP') return false;
      const riffSize = head.readUInt32LE(4);
      // RIFF chunk size excludes the first 8 bytes
      return size >= riffSize + 8;
    }

    if (e === '.bmp') {
      if (size < 14) return false;
      const head = readAt(fd, 0, 14);
      if (head.length < 14) return false;
      if (head.toString('ascii', 0, 2) !== 'BM') return false;
      const declaredSize = head.readUInt32LE(2);
      return declaredSize >= 14 && declaredSize <= size;
    }

    if (e === '.png') {
      // PNG signature (8 bytes) + IHDR (25 bytes) + IEND (12 bytes)
      if (size < 45) return false;
      const sig = readAt(fd, 0, 8);
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (sig.length !== 8 || !sig.equals(pngSig)) return false;

      let pos = 8;
      let chunks = 0;
      let sawIHDR = false;

      while (pos + 8 <= size) {
        chunks++;
        if (chunks > 200000) return false; // sanity guard

        const hdr = readAt(fd, pos, 8);
        if (hdr.length < 8) return false;
        const len = hdr.readUInt32BE(0);
        const type = hdr.toString('ascii', 4, 8);
        pos += 8;

        // Need len bytes data + 4 bytes CRC
        if (pos + len + 4 > size) return false;

        if (!sawIHDR) {
          if (type !== 'IHDR' || len !== 13) return false;
          sawIHDR = true;
        }

        if (type === 'IEND') {
          return len === 0;
        }

        pos += len + 4;
      }
      return false;
    }

    return false;
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

function classifyAndValidateUpload(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const imageMimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };

  if (imageMimeByExt[ext]) {
    const ok = validateImageFileByExt(file.path, ext);
    if (!ok) return { ok: false, error: 'Invalid image file' };
    return { ok: true, detectedMimeType: imageMimeByExt[ext] };
  }

  return { ok: true, detectedMimeType: null };
}

// ========== Sessions (persistent in SQLite) ==========

function createSessionToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(token, user.id);
  return token;
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const session = db.getSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const user = db.getUserById(session.user_id);
  if (!user) {
    db.deleteSession(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ========== Telegram Bot Polling ==========
// Handles /start commands for auth + captures chat_id for notifications
// Works on bare IP — no domain or webhook needed

let botPollingOffset = 0;
let botPollingActive = false;

async function tgApi(method, body) {
  if (!CONFIG.botToken) return null;
  const fetch = require('node-fetch');
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.ok ? data.result : null;
  } catch (e) {
    console.error(`TG API ${method} error:`, e.message);
    return null;
  }
}

async function sendTgMessage(chatId, text, extra = {}) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function startBotPolling() {
  if (!CONFIG.botToken || botPollingActive) return;
  botPollingActive = true;
  console.log('Telegram bot polling started');

  // Set bot commands
  await tgApi('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть трекер' },
      { command: 'help', description: 'Помощь' },
    ],
  });

  // Set Menu Button (WebApp) — appears as a button near the message input
  const isHttps = CONFIG.siteUrl.startsWith('https://');
  if (isHttps) {
    await tgApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Zapret Tracker',
        web_app: { url: CONFIG.siteUrl },
      },
    });
    console.log('WebApp menu button set');
  } else {
    console.log('SITE_URL is not HTTPS — WebApp menu button disabled (need domain + SSL)');
  }

  pollLoop();
}

async function pollLoop() {
  if (!botPollingActive) return;
  try {
    const updates = await tgApi('getUpdates', {
      offset: botPollingOffset,
      timeout: 25,
      allowed_updates: ['message'],
    });

    if (updates && updates.length > 0) {
      for (const update of updates) {
        botPollingOffset = update.update_id + 1;
        await handleBotUpdate(update);
      }
    }
  } catch (e) {
    console.error('Polling error:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  // Schedule next poll
  setTimeout(pollLoop, 500);
}

async function handleBotUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  // Always update chat_id for known users
  db.updateUserChatId(userId, chatId);

  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const authToken = parts.length > 1 ? parts[1] : null;

    if (authToken) {
      // Auth flow: /start <token>
      const tokenRow = db.getAuthToken(authToken);
      if (!tokenRow) {
        await sendTgMessage(chatId, 'Ссылка для входа устарела. Попробуйте ещё раз на сайте.');
        return;
      }
      if (tokenRow.confirmed) {
        await sendTgMessage(chatId, 'Вы уже авторизованы. Вернитесь на сайт.');
        return;
      }

      // Get user profile photos — download and store locally
      let photoUrl = null;
      try {
        const photos = await tgApi('getUserProfilePhotos', { user_id: userId, limit: 1 });
        if (photos && photos.total_count > 0) {
          const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
          const file = await tgApi('getFile', { file_id: fileId });
          if (file) {
            const localPath = await downloadTgPhoto(file.file_path, userId);
            if (localPath) {
              photoUrl = localPath;
            }
          }
        }
      } catch {}

      // Confirm auth token
      db.confirmAuthToken(authToken, {
        telegram_id: userId,
        chat_id: chatId,
        username: msg.from.username,
        first_name: msg.from.first_name || 'User',
        last_name: msg.from.last_name,
        photo_url: photoUrl,
      });

      await sendTgMessage(chatId,
        `Вы успешно авторизованы в Zapret Tracker!\n\n` +
        `Вернитесь на сайт — вход произойдёт автоматически.\n` +
        `Вы будете получать уведомления о новых сообщениях в ваших тикетах.`
      );
    } else {
      // Just /start without token — show WebApp button
      const siteUrl = CONFIG.siteUrl;
      const isHttps = siteUrl.startsWith('https://');

      const replyMarkup = isHttps ? {
        inline_keyboard: [[{
          text: '🛡 Открыть Zapret Tracker',
          web_app: { url: siteUrl },
        }]],
      } : {
        inline_keyboard: [[{
          text: '🛡 Открыть Zapret Tracker',
          url: siteUrl,
        }]],
      };

      await sendTgMessage(chatId,
        `Добро пожаловать в <b>Zapret Tracker</b>!\n\n` +
        `Трекер багов и идей проекта Zapret.\n\n` +
        `Нажмите кнопку ниже чтобы открыть трекер${isHttps ? ' прямо в Telegram' : ''}.\n\n` +
        `Уведомления:\n` +
        `• Новые сообщения в ваших тикетах\n` +
        `• Изменения статуса\n` +
        `• Сообщения в тикетах, на которые вы подписаны`,
        { reply_markup: replyMarkup }
      );
    }
  } else if (text === '/help') {
    const siteUrl = CONFIG.siteUrl;
    const isHttps = siteUrl.startsWith('https://');

    const replyMarkup = isHttps ? {
      inline_keyboard: [[{
        text: '🛡 Открыть трекер',
        web_app: { url: siteUrl },
      }]],
    } : {
      inline_keyboard: [[{
        text: '🛡 Открыть трекер',
        url: siteUrl,
      }]],
    };

    await sendTgMessage(chatId,
      `<b>Zapret Tracker Bot</b>\n\n` +
      `Трекер багов и идей проекта Zapret.\n\n` +
      `Команды:\n` +
      `/start — Открыть трекер\n` +
      `/help — Помощь`,
      { reply_markup: replyMarkup }
    );
  }
}

// ========== Photo Download ==========

async function downloadTgPhoto(filePath, telegramId) {
  if (!CONFIG.botToken || !filePath) return null;
  const fetch = require('node-fetch');
  try {
    const url = `https://api.telegram.org/file/bot${CONFIG.botToken}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const ext = path.extname(filePath) || '.jpg';
    const filename = `avatar_${telegramId}${ext}`;
    const destPath = path.join(CONFIG.uploadDir, filename);

    if (!fs.existsSync(CONFIG.uploadDir)) fs.mkdirSync(CONFIG.uploadDir, { recursive: true });

    const buffer = await res.buffer();
    fs.writeFileSync(destPath, buffer);
    return `/uploads/${filename}`;
  } catch (e) {
    console.error('Failed to download TG photo:', e.message);
    return null;
  }
}

// Periodically refresh user avatars (every 6 hours)
async function refreshUserAvatars() {
  if (!CONFIG.botToken) return;
  try {
    const users = db.getDb().prepare('SELECT * FROM users WHERE telegram_id IS NOT NULL').all();
    for (const user of users) {
      try {
        const photos = await tgApi('getUserProfilePhotos', { user_id: user.telegram_id, limit: 1 });
        if (photos && photos.total_count > 0) {
          const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
          const file = await tgApi('getFile', { file_id: fileId });
          if (file) {
            const localPath = await downloadTgPhoto(file.file_path, user.telegram_id);
            if (localPath && localPath !== user.photo_url) {
              db.getDb().prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(localPath, user.id);
            }
          }
        }
      } catch {}
      // Rate limit: wait 100ms between users
      await new Promise(r => setTimeout(r, 100));
    }
  } catch (e) {
    console.error('Avatar refresh error:', e.message);
  }
}

// ========== Online Presence Tracking ==========

// Track when each user's profile was last refreshed from Telegram: userId -> timestamp
const profileRefreshTimes = new Map();
const PROFILE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Refresh a single user's profile (avatar + name) from Telegram
async function refreshUserProfile(user) {
  if (!CONFIG.botToken || !user.telegram_id) return user;

  const now = Date.now();
  const lastRefresh = profileRefreshTimes.get(user.id) || 0;
  if (now - lastRefresh < PROFILE_REFRESH_INTERVAL) return user; // too soon

  profileRefreshTimes.set(user.id, now);

  try {
    // Get fresh info via getChat (returns name, username, photo)
    const chat = await tgApi('getChat', { chat_id: user.telegram_id });
    if (!chat) return user;

    const updates = {};
    if (chat.first_name && chat.first_name !== user.first_name) updates.first_name = chat.first_name;
    if ((chat.last_name || null) !== (user.last_name || null)) updates.last_name = chat.last_name || null;
    if ((chat.username || null) !== (user.username || null)) updates.username = chat.username || null;

    // Refresh avatar
    try {
      const photos = await tgApi('getUserProfilePhotos', { user_id: user.telegram_id, limit: 1 });
      if (photos && photos.total_count > 0) {
        const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
        const file = await tgApi('getFile', { file_id: fileId });
        if (file) {
          const localPath = await downloadTgPhoto(file.file_path, user.telegram_id);
          if (localPath && localPath !== user.photo_url) {
            updates.photo_url = localPath;
          }
        }
      }
    } catch {}

    // Apply updates to DB
    if (Object.keys(updates).length > 0) {
      const sets = [];
      const params = [];
      for (const [key, val] of Object.entries(updates)) {
        sets.push(`${key} = ?`);
        params.push(val);
      }
      params.push(user.id);
      db.getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      console.log(`Profile refreshed for ${user.first_name} (${user.telegram_id}):`, Object.keys(updates).join(', '));
      // Return updated user
      return db.getUserById(user.id);
    }
  } catch (e) {
    console.error(`Profile refresh error for user ${user.id}:`, e.message);
  }
  return user;
}

// In-memory store: { sessionToken: { user, currentView, currentTicketId, lastSeen, sseRes } }
const onlineUsers = new Map();
// SSE clients for presence broadcast
const presenceClients = new Set();

// Typing indicators: ticketId -> Map<userId, { user, timestamp }>
const typingUsers = new Map();
const TYPING_TIMEOUT = 4000; // 4s — typing indicator disappears after this

function getTypingInTicket(ticketId, excludeUserId) {
  const map = typingUsers.get(ticketId);
  if (!map) return [];
  const now = Date.now();
  const result = [];
  for (const [uid, entry] of map) {
    if (now - entry.timestamp > TYPING_TIMEOUT) {
      map.delete(uid);
      continue;
    }
    if (uid === excludeUserId) continue;
    result.push({
      id: entry.user.id,
      first_name: entry.user.first_name,
      username: entry.user.username,
      photo_url: entry.user.photo_url,
      display_name: entry.user.display_name || null,
      display_avatar: entry.user.display_avatar || null,
      privacy_hidden: !!entry.user.privacy_hidden,
      privacy_hide_online: !!entry.user.privacy_hide_online,
      privacy_hide_activity: !!entry.user.privacy_hide_activity,
    });
  }
  if (map.size === 0) typingUsers.delete(ticketId);
  return result;
}

function getOnlineList() {
  const now = Date.now();
  const TIMEOUT = 60_000; // 60s — user considered offline after this
  const seen = new Map(); // deduplicate by user.id
  for (const [, entry] of onlineUsers) {
    if (now - entry.lastSeen > TIMEOUT) continue;
    // Keep the most recent entry per user
    const existing = seen.get(entry.user.id);
    if (!existing || entry.lastSeen > existing.lastSeen) {
      seen.set(entry.user.id, entry);
    }
  }
  return Array.from(seen.values()).map(e => ({
    id: e.user.id,
    first_name: e.user.first_name,
    username: e.user.username,
    photo_url: e.user.photo_url,
    is_admin: !!e.user.is_admin,
    currentView: e.currentView || 'list',
    currentTicketId: e.currentTicketId || null,
    currentTicketTitle: e.currentTicketTitle || null,
    lastSeen: e.lastSeen,
    // Privacy fields for filtering
    privacy_hidden: !!e.user.privacy_hidden,
    privacy_hide_online: !!e.user.privacy_hide_online,
    privacy_hide_activity: !!e.user.privacy_hide_activity,
    display_name: e.user.display_name || null,
    display_avatar: e.user.display_avatar || null,
  }));
}

function maskOnlineListForPublic(raw) {
  return raw
    .filter(u => !(u.privacy_hidden || u.privacy_hide_online))
    .map(u => ({
      id: u.id,
      first_name: u.display_name || u.first_name,
      username: u.display_name ? null : u.username,
      photo_url: u.display_avatar === 'hidden' ? null : (u.display_avatar || u.photo_url),
      is_admin: u.is_admin,
      currentView: u.privacy_hide_activity ? null : u.currentView,
      currentTicketId: u.privacy_hide_activity ? null : u.currentTicketId,
      currentTicketTitle: u.privacy_hide_activity ? null : u.currentTicketTitle,
      lastSeen: u.lastSeen,
    }));
}

function broadcastPresence() {
  const raw = getOnlineList();
  const list = maskOnlineListForPublic(raw);
  const data = JSON.stringify({ type: 'presence', users: list, count: list.length });
  for (const client of presenceClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      presenceClients.delete(client);
    }
  }
}

// Periodic cleanup of stale entries and broadcast
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of onlineUsers) {
    if (now - entry.lastSeen > 120_000) { // 2 min — remove completely
      onlineUsers.delete(token);
    }
  }
  broadcastPresence();
}, 10_000); // every 10 seconds

// ========== Notifications ==========

async function notifySubscribers(ticketId, authorUserId, text) {
  if (!CONFIG.botToken) return;

  const subscribers = db.getSubscribers(ticketId);
  for (const sub of subscribers) {
    // Don't notify the author of the message
    if (sub.id === authorUserId) continue;
    if (!sub.chat_id) continue;

    try {
      const ticketUrl = `${CONFIG.siteUrl}/#ticket-${ticketId}`;
      const isHttps = CONFIG.siteUrl.startsWith('https://');
      const btn = isHttps
        ? { text: 'Открыть тикет', web_app: { url: ticketUrl } }
        : { text: 'Открыть тикет', url: ticketUrl };

      await sendTgMessage(sub.chat_id, text, {
        reply_markup: { inline_keyboard: [[btn]] },
      });
    } catch (e) {
      console.error(`Failed to notify user ${sub.id}:`, e.message);
    }
  }
}

async function notifyAdmin(text) {
  if (!CONFIG.botToken) return;
  const admin = db.getUserByTelegramId(CONFIG.adminTelegramId);
  if (admin && admin.chat_id) {
    await sendTgMessage(admin.chat_id, text);
  }
}

// ========== Telegram WebApp Auth ==========

function verifyWebAppData(initData) {
  if (!CONFIG.botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Sort and join
  const dataCheckArr = [];
  for (const [key, val] of [...params.entries()].sort()) {
    dataCheckArr.push(`${key}=${val}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(CONFIG.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // Parse user
  try {
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// ========== API Routes ==========

// --- Auth ---

// WebApp auth — instant, no polling, Telegram verifies the user
app.post('/api/auth/webapp', async (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: 'Missing initData' });

  const tgUser = verifyWebAppData(initData);
  if (!tgUser) return res.status(403).json({ error: 'Invalid WebApp data' });

  // Try to download user's avatar locally
  let photoUrl = tgUser.photo_url || null;
  try {
    const photos = await tgApi('getUserProfilePhotos', { user_id: tgUser.id, limit: 1 });
    if (photos && photos.total_count > 0) {
      const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
      const file = await tgApi('getFile', { file_id: fileId });
      if (file) {
        const localPath = await downloadTgPhoto(file.file_path, tgUser.id);
        if (localPath) photoUrl = localPath;
      }
    }
  } catch {}

  const user = db.findOrCreateUser({
    id: tgUser.id,
    username: tgUser.username,
    first_name: tgUser.first_name || 'User',
    last_name: tgUser.last_name,
    photo_url: photoUrl,
    chat_id: null, // chat_id comes from bot /start, not webapp
  });

  const token = createSessionToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

// Deep-link auth (fallback for direct IP access)
app.post('/api/auth/request', (req, res) => {
  const token = crypto.randomBytes(20).toString('hex');
  db.createAuthToken(token);

  const botLink = CONFIG.botUsername
    ? `https://t.me/${CONFIG.botUsername}?start=${token}`
    : null;

  res.json({ token, botLink });
});

// Step 2: Frontend polls to check if user confirmed in bot
app.get('/api/auth/check/:token', (req, res) => {
  const tokenRow = db.getAuthToken(req.params.token);
  if (!tokenRow) {
    return res.json({ confirmed: false, expired: true });
  }
  if (!tokenRow.confirmed) {
    return res.json({ confirmed: false, expired: false });
  }

  // Create user and session
  const user = db.findOrCreateUser({
    id: tokenRow.telegram_id,
    chat_id: tokenRow.chat_id,
    username: tokenRow.username,
    first_name: tokenRow.first_name,
    last_name: tokenRow.last_name,
    photo_url: tokenRow.photo_url,
  });

  const sessionToken = createSessionToken(user);
  db.deleteAuthToken(req.params.token);

  res.json({ confirmed: true, token: sessionToken, user: sanitizeUser(user) });
});

// Dev login (only works when BOT_TOKEN is not set)
app.post('/api/auth/dev', (req, res) => {
  if (CONFIG.botToken) {
    return res.status(403).json({ error: 'Dev login disabled when bot is configured' });
  }
  const data = req.body;
  if (!data || !data.id) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const user = db.findOrCreateUser({
    id: parseInt(data.id),
    username: data.username,
    first_name: data.first_name || 'Dev User',
    last_name: null,
    photo_url: null,
    chat_id: null,
  });

  const token = createSessionToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  db.deleteSession(token);
  res.json({ ok: true });
});

// --- Tickets ---

app.get('/api/tickets', authMiddleware, (req, res) => {
  const { status, type, priority, author_id, search, tag_id, page, is_resource_request, sort, group_by, exclude_archived, only_archived } = req.query;
  const result = db.getTickets({
    status, type, priority, author_id, search, tag_id,
    is_resource_request: is_resource_request !== undefined ? parseInt(is_resource_request) : undefined,
    exclude_archived: exclude_archived === '1',
    only_archived: only_archived === '1',
    sort: sort || undefined,
    page: parseInt(page) || 1,
    is_admin: req.user.is_admin,
    user_id: req.user.id,
  });
  const userVotes = db.getUserVotes(req.user.id);
  const userSubs = db.getUserSubscriptions(req.user.id);
  result.tickets = result.tickets.map(t => ({
    ...t,
    user_voted: userVotes.includes(t.id),
    user_subscribed: userSubs.includes(t.id),
  }));

  // Apply privacy masking to ticket authors
  for (const t of result.tickets) {
    applyMaskToTicketAuthor(t, req.user);
  }
  res.json(result);
});

app.get('/api/tickets/kanban', authMiddleware, (req, res) => {
  const statuses = ['open', 'in_progress', 'review', 'testing', 'closed'];
  const result = {};
  const userVotes = db.getUserVotes(req.user.id);

  for (const status of statuses) {
    const data = db.getTickets({
      status,
      is_admin: req.user.is_admin,
      user_id: req.user.id,
      limit: 100,
    });
    result[status] = data.tickets.map(t => {
      const row = { ...t, user_voted: userVotes.includes(t.id) };
      applyMaskToTicketAuthor(row, req.user);
      return row;
    });
  }

  res.json(result);
});

app.get('/api/tickets/:id', authMiddleware, (req, res) => {
  const ticket = db.getTicketById(parseInt(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const userVotes = db.getUserVotes(req.user.id);
  ticket.user_voted = userVotes.includes(ticket.id);
  ticket.user_subscribed = db.isSubscribed(req.user.id, ticket.id);
  ticket.is_pinned = db.isPinned(ticket.id);
  ticket.messages = db.getMessages(ticket.id);

  // Attach reactions to messages
  const msgIds = ticket.messages.map(m => m.id);
  const allReactions = db.getReactionsForMessages(msgIds);
  for (const m of ticket.messages) {
    m.reactions = aggregateReactions(allReactions[m.id] || [], req.user);
  }

  // For megathreads, attach thread reply counts per message
  if (ticket.is_megathread) {
    const replyCounts = db.getThreadReplyCountsForTicket(ticket.id);
    for (const m of ticket.messages) {
      m.reply_count = replyCounts[m.id] || 0;
    }
  }

  applyMaskToTicketAuthor(ticket, req.user);
  for (const m of ticket.messages) {
    applyMaskToMessageAuthor(m, req.user);
  }

  res.json(ticket);
});

app.post('/api/tickets', authMiddleware, (req, res) => {
  const {
    title,
    description,
    type,
    priority,
    is_private,
    tags,
    emoji,
    color,
    is_resource_request,
    resource_protocol,
    resource_ports,
    resource_name,
    is_megathread,
  } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'Title and type are required' });
  }

  // Only admins can create megathreads
  const megathread = is_megathread && req.user.is_admin ? true : false;

  const ticket = db.createTicket({
    title, description, type,
    priority: priority || 'medium',
    is_private: is_private ? 1 : 0,
    author_id: req.user.id,
    tags: tags || [],
    emoji: emoji || null,
    color: color || null,
    is_resource_request: !!is_resource_request,
    resource_protocol: resource_protocol || null,
    resource_ports: resource_ports || null,
    resource_name: resource_name || null,
    is_megathread: megathread,
  });

  // Notify admin about new ticket (if author is not admin)
  if (!req.user.is_admin) {
    const allTypes = db.getAllTicketTypes();
    const typeLabels = {};
    for (const tt of allTypes) typeLabels[tt.key] = tt.name;
    const authorName = req.user.username ? `@${req.user.username}` : req.user.first_name;
    const typeObj = allTypes.find(tt => tt.key === type);
    const typeEmoji = typeObj && typeObj.emoji ? typeObj.emoji + ' ' : '';
    notifyAdmin(
      `🆕 ${typeEmoji}Новый ${typeLabels[type] || type}: <b>${escHtml(title)}</b>\n` +
      `Автор: ${authorName}\n` +
      `Приоритет: ${priority || 'medium'}\n` +
      (is_private ? '🔒 Приватный' : '🌐 Публичный')
    );
  }

  applyMaskToTicketAuthor(ticket, req.user);
  res.json(ticket);
});

app.put('/api/tickets/:id', authMiddleware, (req, res) => {
  const ticket = db.getTicketById(parseInt(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  if (!req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const updates = req.body;
  if (!req.user.is_admin) {
    delete updates.status;
    delete updates.assigned_to;
    delete updates.is_private;
  }

  // Log and notify on title change
  if (updates.title && updates.title !== ticket.title) {
    db.addMessage({
      ticket_id: ticket.id,
      author_id: req.user.id,
      content: `Заголовок изменён: «${ticket.title}» → «${updates.title}»`,
      is_system: true,
    });

    notifySubscribers(ticket.id, req.user.id,
      `✏️ Заголовок тикета #${ticket.id} изменён\n` +
      `«${escHtml(ticket.title)}» → «${escHtml(updates.title)}»`
    );
  }

  // Log and notify on status change
  if (updates.status && updates.status !== ticket.status) {
    db.addMessage({
      ticket_id: ticket.id,
      author_id: req.user.id,
      content: `Статус изменён: ${statusLabel(ticket.status)} → ${statusLabel(updates.status)}`,
      is_system: true,
    });

    notifySubscribers(ticket.id, req.user.id,
      `🔄 Статус тикета #${ticket.id} изменён\n` +
      `<b>${escHtml(ticket.title)}</b>\n` +
      `${statusLabel(ticket.status)} → ${statusLabel(updates.status)}`
    );
  }

  const updated = db.updateTicket(parseInt(req.params.id), updates);
  applyMaskToTicketAuthor(updated, req.user);
  res.json(updated);
});

app.delete('/api/tickets/:id', authMiddleware, (req, res) => {
  const ticket = db.getTicketById(parseInt(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  if (!req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.deleteTicket(parseInt(req.params.id));
  res.json({ ok: true });
});

// --- Resource Requests ---
// Dedicated creation endpoint with strict validation:
// - files are required
// - protocol required (tcp/udp/tcp,udp)
// - ports must be valid (single, range, comma list)

app.post('/api/resource-requests', authMiddleware, upload.array('files', 20), (req, res) => {
  const { resource_name, protocol, ports, message, is_private } = req.body;

  // Validate uploads (especially images) and classify mime types
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      const v = classifyAndValidateUpload(f);
      if (!v.ok) {
        cleanupMulterFiles(req.files);
        return res.status(400).json({ error: v.error });
      }
      if (v.detectedMimeType) f._detectedMimeType = v.detectedMimeType;
    }
  }

  if (!resource_name || !resource_name.trim()) {
    return res.status(400).json({ error: 'Название сайта/игры обязательно' });
  }

  const normalizedProtocol = normalizeProtocol(protocol);
  if (!normalizedProtocol) {
    return res.status(400).json({ error: 'Укажите protocol: TCP, UDP или TCP,UDP' });
  }

  if (!isValidPorts(ports || '')) {
    return res.status(400).json({
      error: 'Неверный формат портов. Примеры: 443, 40000-65535, 443,444,3000-3010',
    });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Нужно прикрепить хотя бы один файл (ipset/hostlist)' });
  }

  const cleanResourceName = resource_name.trim();
  const cleanPorts = normalizePorts(ports);
  const cleanMessage = (message || '').trim();

  const description = [
    `Запрос на добавление сайта/игры: ${cleanResourceName}`,
    `Протокол: ${normalizedProtocol.toUpperCase()}`,
    `Порты: ${cleanPorts}`,
    cleanMessage ? '' : null,
    cleanMessage || null,
  ].filter(Boolean).join('\n');

  const ticket = db.createTicket({
    title: cleanResourceName,
    resource_name: cleanResourceName,
    description,
    type: 'feature',
    priority: 'medium',
    is_private: is_private ? 1 : 0,
    author_id: req.user.id,
    tags: [],
    emoji: '📦',
    color: '#4da3ff',
    is_resource_request: true,
    resource_protocol: normalizedProtocol,
    resource_ports: cleanPorts,
  });

  const initialMessage = db.addMessage({
    ticket_id: ticket.id,
    author_id: req.user.id,
    content: cleanMessage || 'Заявка на добавление сайта/игры',
  });

  for (const file of req.files) {
    db.addAttachment({
      ticket_id: ticket.id,
      message_id: initialMessage.id,
      filename: file.filename,
      original_name: file.originalname,
      mime_type: normalizeMimeType(file),
      size: file.size,
    });
  }

  if (!req.user.is_admin) {
    const authorName = req.user.username ? `@${req.user.username}` : req.user.first_name;
    notifyAdmin(
      `📦 Новый запрос сайта/игры: <b>${escHtml(cleanResourceName)}</b>\n` +
      `Автор: ${authorName}\n` +
      `Протокол: ${normalizedProtocol.toUpperCase()}\n` +
      `Порты: ${escHtml(cleanPorts)}\n` +
      `Файлов: ${req.files.length}`
    );
  }

  const fullTicket = db.getTicketById(ticket.id);
  fullTicket.messages = db.getMessages(ticket.id);
  fullTicket.user_voted = false;
  fullTicket.user_subscribed = db.isSubscribed(req.user.id, ticket.id);

  res.json(fullTicket);
});

// --- Geo-restriction Requests ---
// For sites/services that block Russian users themselves (not blocked by RKN)

app.post('/api/geo-requests', authMiddleware, upload.array('files', 20), (req, res) => {
  const { resource_name, geo_url, geo_subdomains, message, is_private } = req.body;

  // Validate uploads if any
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      const v = classifyAndValidateUpload(f);
      if (!v.ok) {
        cleanupMulterFiles(req.files);
        return res.status(400).json({ error: v.error });
      }
      if (v.detectedMimeType) f._detectedMimeType = v.detectedMimeType;
    }
  }

  if (!resource_name || !resource_name.trim()) {
    return res.status(400).json({ error: 'Название сайта/сервиса обязательно' });
  }

  if (!geo_url || !geo_url.trim()) {
    return res.status(400).json({ error: 'URL сайта/сервиса обязателен' });
  }

  if (!geo_subdomains || !geo_subdomains.trim()) {
    return res.status(400).json({ error: 'Субдомены обязательны' });
  }

  const cleanName = resource_name.trim();
  const cleanUrl = geo_url.trim();
  const cleanSubdomains = geo_subdomains.trim();
  const cleanMessage = (message || '').trim();

  const description = [
    `Запрос на добавление гео-ограниченного сайта/сервиса: ${cleanName}`,
    `URL: ${cleanUrl}`,
    `Субдомены: ${cleanSubdomains}`,
    cleanMessage ? '' : null,
    cleanMessage || null,
  ].filter(Boolean).join('\n');

  const ticket = db.createTicket({
    title: cleanName,
    resource_name: cleanName,
    description,
    type: 'feature',
    priority: 'medium',
    is_private: is_private ? 1 : 0,
    author_id: req.user.id,
    tags: [],
    emoji: '\uD83C\uDF10',
    color: '#f59e0b',
    is_resource_request: true,
    is_geo_request: true,
    geo_url: cleanUrl,
    geo_subdomains: cleanSubdomains,
  });

  const initialMessage = db.addMessage({
    ticket_id: ticket.id,
    author_id: req.user.id,
    content: cleanMessage || 'Заявка на добавление гео-ограниченного сайта/сервиса',
  });

  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      db.addAttachment({
        ticket_id: ticket.id,
        message_id: initialMessage.id,
        filename: file.filename,
        original_name: file.originalname,
        mime_type: normalizeMimeType(file),
        size: file.size,
      });
    }
  }

  if (!req.user.is_admin) {
    const authorName = req.user.username ? `@${req.user.username}` : req.user.first_name;
    notifyAdmin(
      `\uD83C\uDF10 Новый запрос гео-ограничения: <b>${escHtml(cleanName)}</b>\n` +
      `Автор: ${authorName}\n` +
      `URL: ${escHtml(cleanUrl)}\n` +
      `Субдомены: ${escHtml(cleanSubdomains)}`
    );
  }

  const fullTicket = db.getTicketById(ticket.id);
  fullTicket.messages = db.getMessages(ticket.id);
  fullTicket.user_voted = false;
  fullTicket.user_subscribed = db.isSubscribed(req.user.id, ticket.id);

  res.json(fullTicket);
});

// --- Messages ---
// Any authenticated user can comment on public open tickets
// Private tickets: only admin and author

app.post('/api/tickets/:id/messages', authMiddleware, upload.array('files', 10), (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  // Validate uploads (especially images) and classify mime types
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      const v = classifyAndValidateUpload(f);
      if (!v.ok) {
        cleanupMulterFiles(req.files);
        return res.status(400).json({ error: v.error });
      }
      if (v.detectedMimeType) f._detectedMimeType = v.detectedMimeType;
    }
  }

  // Access check: private tickets are restricted
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Archived tickets: no new messages (admins can still comment)
  if (['closed', 'rejected', 'duplicate'].includes(ticket.status) && !req.user.is_admin) {
    return res.status(403).json({ error: 'Тикет закрыт — отправка сообщений недоступна' });
  }

  // Public tickets: anyone can comment (no extra restrictions)

  const content = req.body.content;
  if (!content && (!req.files || req.files.length === 0)) {
    return res.status(400).json({ error: 'Content or files required' });
  }

  const message = db.addMessage({
    ticket_id: ticketId,
    author_id: req.user.id,
    content: content || '',
  });

  // Handle file attachments
  if (req.files && req.files.length > 0) {
    message.attachments = [];
    for (const file of req.files) {
      const attachment = db.addAttachment({
        ticket_id: ticketId,
        message_id: message.id,
        filename: file.filename,
        original_name: file.originalname,
        mime_type: normalizeMimeType(file),
        size: file.size,
      });
      message.attachments.push(attachment);
    }
  }

  // New message has no reactions yet
  message.reactions = [];

  // Auto-subscribe commenter to this ticket
  db.subscribe(req.user.id, ticketId);

  // Notify all subscribers (except the author of this message)
  const authorName = req.user.username ? `@${req.user.username}` : req.user.first_name;
  notifySubscribers(ticketId, req.user.id,
    `💬 Новое сообщение в #${ticketId}\n` +
    `<b>${escHtml(ticket.title)}</b>\n` +
    `От: ${authorName}\n\n` +
    `${content ? escHtml(content.substring(0, 300)) : '[файлы]'}`
  );

  applyMaskToMessageAuthor(message, req.user);
  res.json(message);
});

// --- Edit Message ---

app.put('/api/messages/:id', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const message = db.getMessageById(msgId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  // Admin can edit any message; author can edit own
  if (!req.user.is_admin && message.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // System messages cannot be edited
  if (message.is_system) {
    return res.status(400).json({ error: 'Cannot edit system messages' });
  }

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content required' });
  }

  const updated = db.updateMessage(msgId, content.trim());
  applyMaskToMessageAuthor(updated, req.user);
  res.json(updated);
});

// --- Delete Message ---

app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const message = db.getMessageById(msgId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  // Admin can delete any message; author can delete own
  if (!req.user.is_admin && message.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Delete attachment files from disk before removing DB records
  const attachments = db.getDb().prepare('SELECT filename FROM attachments WHERE message_id = ?').all(msgId);
  for (const a of attachments) {
    safeUnlink(path.join(CONFIG.uploadDir, a.filename));
  }

  db.deleteMessage(msgId);
  res.json({ ok: true });
});

// --- Message Reactions ---

app.post('/api/messages/:id/reactions', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const message = db.getMessageById(msgId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  // Check ticket access
  const ticket = db.getTicketById(message.ticket_id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { emoji } = req.body;
  if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ error: 'Invalid emoji' });
  }

  const result = db.toggleReaction(msgId, req.user.id, emoji);

  // Return updated reactions for this message
  const rawReactions = db.getReactionsForMessage(msgId);
  const reactions = aggregateReactions(rawReactions, req.user);
  res.json({ ...result, reactions });
});

// --- Reactions Poll (live updates) ---

app.get('/api/tickets/:id/reactions/poll', authMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const allReactions = db.getReactionsForTicket(ticketId);
  // Aggregate per message: { messageId: [{ emoji, count, users, user_reacted }] }
  const result = {};
  for (const [msgId, rawList] of Object.entries(allReactions)) {
    result[msgId] = aggregateReactions(rawList, req.user);
  }

  res.json({ reactions: result });
});

// --- File Upload to ticket ---

app.post('/api/tickets/:id/upload', authMiddleware, upload.array('files', 10), (req, res) => {
  const ticketId = parseInt(req.params.id);
  const attachments = [];

  // Validate uploads (especially images) and classify mime types
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      const v = classifyAndValidateUpload(f);
      if (!v.ok) {
        cleanupMulterFiles(req.files);
        return res.status(400).json({ error: v.error });
      }
      if (v.detectedMimeType) f._detectedMimeType = v.detectedMimeType;
    }
  }

  if (req.files) {
    for (const file of req.files) {
      const attachment = db.addAttachment({
        ticket_id: ticketId,
        message_id: null,
        filename: file.filename,
        original_name: file.originalname,
        mime_type: normalizeMimeType(file),
        size: file.size,
      });
      attachments.push(attachment);
    }
  }

  res.json({ attachments });
});

// --- Votes ---

app.post('/api/tickets/:id/vote', authMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const result = db.toggleVote(req.user.id, ticketId);
  const updatedTicket = db.getTicketById(ticketId);
  res.json({ ...result, votes_count: updatedTicket.votes_count });
});

// --- Subscriptions ---

app.post('/api/tickets/:id/subscribe', authMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.subscribe(req.user.id, ticketId);
  res.json({ subscribed: true });
});

app.post('/api/tickets/:id/unsubscribe', authMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  db.unsubscribe(req.user.id, ticketId);
  res.json({ subscribed: false });
});

// --- Tags ---

app.get('/api/tags', (req, res) => {
  res.json(db.getAllTags());
});

app.post('/api/tags', authMiddleware, adminMiddleware, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const tag = db.createTag(name, color);
  res.json(tag);
});

// --- Ticket Types ---

app.get('/api/ticket-types', (req, res) => {
  res.json(db.getAllTicketTypes());
});

app.post('/api/ticket-types', authMiddleware, adminMiddleware, (req, res) => {
  const { key, name, emoji, color, sort_order } = req.body;
  if (!key || !name) return res.status(400).json({ error: 'Key and name are required' });
  if (!/^[a-z0-9_]+$/.test(key)) return res.status(400).json({ error: 'Key must be lowercase alphanumeric with underscores' });
  const existing = db.getTicketTypeByKey(key);
  if (existing) return res.status(400).json({ error: 'Type with this key already exists' });
  const type = db.createTicketType({ key, name, emoji: emoji || '', color: color || '#6c757d', sort_order: sort_order || 0 });
  res.json(type);
});

app.put('/api/ticket-types/:id', authMiddleware, adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const { key, name, emoji, color, sort_order } = req.body;
  if (key && !/^[a-z0-9_]+$/.test(key)) return res.status(400).json({ error: 'Key must be lowercase alphanumeric with underscores' });
  if (key) {
    const existing = db.getTicketTypeByKey(key);
    if (existing && existing.id !== id) return res.status(400).json({ error: 'Type with this key already exists' });
  }
  const updated = db.updateTicketType(id, { key, name, emoji, color, sort_order });
  if (!updated) return res.status(404).json({ error: 'Type not found' });
  res.json(updated);
});

app.delete('/api/ticket-types/:id', authMiddleware, adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  db.deleteTicketType(id);
  res.json({ ok: true });
});

// --- Pinned Tickets ---

app.get('/api/pinned', authMiddleware, (req, res) => {
  const pinned = db.getPinnedTickets({
    is_admin: req.user.is_admin,
    user_id: req.user.id,
  });
  const userVotes = db.getUserVotes(req.user.id);
  const userSubs = db.getUserSubscriptions(req.user.id);
  for (const t of pinned) {
    t.user_voted = userVotes.includes(t.id);
    t.user_subscribed = userSubs.includes(t.id);
    applyMaskToTicketAuthor(t, req.user);
  }
  res.json({ tickets: pinned });
});

app.post('/api/tickets/:id/pin', authMiddleware, adminMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  db.pinTicket(ticketId, req.user.id);
  res.json({ pinned: true });
});

app.post('/api/tickets/:id/unpin', authMiddleware, adminMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  db.unpinTicket(ticketId);
  res.json({ pinned: false });
});

app.put('/api/pinned/reorder', authMiddleware, adminMiddleware, (req, res) => {
  const { ticketIds } = req.body;
  if (!Array.isArray(ticketIds)) return res.status(400).json({ error: 'ticketIds array required' });
  db.reorderPinnedTickets(ticketIds);
  res.json({ ok: true });
});

// --- Megathreads / Thread Replies ---

app.post('/api/tickets/:id/megathread', authMiddleware, adminMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const { enable } = req.body;
  db.updateTicket(ticketId, { is_megathread: enable ? 1 : 0 });
  res.json({ is_megathread: !!enable });
});

// Get thread replies for a specific message
app.get('/api/messages/:id/replies', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const message = db.getMessageById(msgId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const ticket = db.getTicketById(message.ticket_id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const replies = db.getThreadReplies(msgId);
  for (const r of replies) {
    applyMaskToMessageAuthor(r, req.user);
  }
  res.json({ replies });
});

// Add reply to a message thread
app.post('/api/messages/:id/replies', authMiddleware, (req, res) => {
  const msgId = parseInt(req.params.id);
  const message = db.getMessageById(msgId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const ticket = db.getTicketById(message.ticket_id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (!ticket.is_megathread) return res.status(400).json({ error: 'Подтреды доступны только в мегатредах' });
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (['closed', 'rejected', 'duplicate'].includes(ticket.status) && !req.user.is_admin) {
    return res.status(403).json({ error: 'Тикет закрыт' });
  }

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content required' });
  }

  const reply = db.addThreadReply({
    ticket_id: ticket.id,
    parent_message_id: msgId,
    author_id: req.user.id,
    content: content.trim(),
  });

  // Auto-subscribe replier
  db.subscribe(req.user.id, ticket.id);

  // Notify subscribers
  const authorName = req.user.username ? `@${req.user.username}` : req.user.first_name;
  notifySubscribers(ticket.id, req.user.id,
    `💬 Ответ в подтреде #${ticket.id}\n` +
    `<b>${escHtml(ticket.title)}</b>\n` +
    `От: ${authorName}\n\n` +
    `${escHtml(content.trim().substring(0, 300))}`
  );

  applyMaskToMessageAuthor(reply, req.user);
  res.json(reply);
});

// Delete thread reply
app.delete('/api/thread-replies/:id', authMiddleware, (req, res) => {
  const replyId = parseInt(req.params.id);
  const reply = db.getThreadReplyById(replyId);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  if (!req.user.is_admin && reply.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.deleteThreadReply(replyId);
  res.json({ ok: true });
});

// --- Stats ---

app.get('/api/stats', authMiddleware, (req, res) => {
  res.json(db.getStats());
});

// --- Online Presence ---

// SSE endpoint: real-time stream of online users
app.get('/api/presence/stream', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: disable buffering
  res.flushHeaders();

  presenceClients.add(res);

  // Send current state immediately (masked for privacy)
  const list = maskOnlineListForPublic(getOnlineList());
  res.write(`data: ${JSON.stringify({ type: 'presence', users: list, count: list.length })}\n\n`);

  req.on('close', () => {
    presenceClients.delete(res);
  });
});

// Heartbeat: frontend sends current view every 15s
app.post('/api/presence/heartbeat', authMiddleware, async (req, res) => {
  const { view, ticketId, ticketTitle } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '');

  // Try to refresh user profile from Telegram (with cooldown)
  const freshUser = await refreshUserProfile(req.user);

  onlineUsers.set(token, {
    user: freshUser,
    currentView: view || 'list',
    currentTicketId: ticketId || null,
    currentTicketTitle: ticketTitle || null,
    lastSeen: Date.now(),
  });

  broadcastPresence();
  res.json({ ok: true });
});

// Typing indicator: user is typing in a ticket
app.post('/api/presence/typing', authMiddleware, (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) return res.json({ ok: true });

  const tid = parseInt(ticketId);
  if (!typingUsers.has(tid)) typingUsers.set(tid, new Map());
  typingUsers.get(tid).set(req.user.id, {
    user: req.user,
    timestamp: Date.now(),
  });

  res.json({ ok: true });
});

// Get who is typing in a specific ticket
app.get('/api/presence/typing/:ticketId', authMiddleware, (req, res) => {
  const tid = parseInt(req.params.ticketId);
  const isAdmin = !!req.user.is_admin;
  const raw = getTypingInTicket(tid, req.user.id);
  const typers = raw
    .filter(u => {
      if (isAdmin) return true;
      if (u.privacy_hidden || u.privacy_hide_online || u.privacy_hide_activity) return false;
      return true;
    })
    .map(u => {
      const masked = {
        id: u.id,
        first_name: u.display_name || u.first_name,
        username: u.display_name ? null : u.username,
        photo_url: u.display_avatar === 'hidden' ? null : (u.display_avatar || u.photo_url),
      };
      if (isAdmin && (u.display_name || u.display_avatar || u.privacy_hidden || u.privacy_hide_online || u.privacy_hide_activity)) {
        masked._real_first_name = u.first_name;
        masked._real_username = u.username;
        masked._real_photo_url = u.photo_url;
        masked._display_name = u.display_name || null;
        masked._display_avatar = u.display_avatar || null;
        masked._privacy_hidden = !!u.privacy_hidden;
        masked._privacy_hide_online = !!u.privacy_hide_online;
        masked._privacy_hide_activity = !!u.privacy_hide_activity;
      }
      return masked;
    });
  res.json({ typing: typers });
});

// GET online users list (for initial load / non-SSE fallback)
app.get('/api/presence/online', authMiddleware, (req, res) => {
  const raw = getOnlineList();
  const isAdmin = !!req.user.is_admin;

  const list = raw
    .filter(u => {
      if (isAdmin) return true;
      if (u.privacy_hidden || u.privacy_hide_online) return false;
      return true;
    })
    .map(u => {
      const masked = {
        id: u.id,
        first_name: u.display_name || u.first_name,
        username: u.display_name ? null : u.username,
        photo_url: u.display_avatar === 'hidden' ? null : (u.display_avatar || u.photo_url),
        is_admin: u.is_admin,
        currentView: u.privacy_hide_activity && !isAdmin ? null : u.currentView,
        currentTicketId: u.privacy_hide_activity && !isAdmin ? null : u.currentTicketId,
        currentTicketTitle: u.privacy_hide_activity && !isAdmin ? null : u.currentTicketTitle,
        lastSeen: u.lastSeen,
      };
      // Admin extras
      if (isAdmin && (u.display_name || u.display_avatar)) {
        masked._real_first_name = u.first_name;
        masked._real_username = u.username;
        masked._real_photo_url = u.photo_url;
        masked._privacy_hidden = u.privacy_hidden;
        masked._privacy_hide_online = u.privacy_hide_online;
        masked._privacy_hide_activity = u.privacy_hide_activity;
      }
      return masked;
    });

  res.json({ users: list, count: list.length });
});

// GET all registered users
app.get('/api/users', authMiddleware, (req, res) => {
  const users = db.getDb().prepare(`
    SELECT id, telegram_id, username, first_name, last_name, photo_url, is_admin, created_at, last_login,
           privacy_hidden, privacy_hide_online, privacy_hide_activity, display_name, display_avatar
    FROM users ORDER BY last_login DESC
  `).all();

  const isAdmin = !!req.user.is_admin;
  const onlineRaw = getOnlineList();
  const onlineIds = new Set(onlineRaw.filter(u => {
    if (isAdmin) return true;
    return !u.privacy_hidden && !u.privacy_hide_online;
  }).map(u => u.id));

  const result = users
    .filter(u => {
      if (isAdmin) return true;
      return !u.privacy_hidden;
    })
    .map(u => {
      const entry = {
        id: u.id,
        first_name: u.display_name || u.first_name,
        last_name: u.display_name ? null : u.last_name,
        username: u.display_name ? null : u.username,
        photo_url: u.display_avatar === 'hidden' ? null : (u.display_avatar || u.photo_url),
        is_admin: !!u.is_admin,
        is_online: onlineIds.has(u.id),
        created_at: u.created_at,
        last_login: u.last_login,
      };
      if (isAdmin && (u.display_name || u.display_avatar || u.privacy_hidden || u.privacy_hide_online || u.privacy_hide_activity)) {
        entry._real_first_name = u.first_name;
        entry._real_username = u.username;
        entry._real_photo_url = u.photo_url;
        entry._privacy_hidden = !!u.privacy_hidden;
        entry._privacy_hide_online = !!u.privacy_hide_online;
        entry._privacy_hide_activity = !!u.privacy_hide_activity;
        entry._display_name = u.display_name;
        entry._display_avatar = u.display_avatar;
      }
      return entry;
    });

  res.json({ users: result, total: result.length });
});

// --- User Settings ---

app.get('/api/settings', authMiddleware, (req, res) => {
  const settings = db.getUserSettings(req.user.id);
  const user = req.user;
  res.json({
    privacy_hidden: !!settings.privacy_hidden,
    privacy_hide_online: !!settings.privacy_hide_online,
    privacy_hide_activity: !!settings.privacy_hide_activity,
    display_name: settings.display_name || '',
    display_avatar: settings.display_avatar || '',
    notify_own: !!settings.notify_own,
    notify_subscribed: !!settings.notify_subscribed,
    // Real data for reference
    real_first_name: user.first_name,
    real_username: user.username,
    real_photo_url: user.photo_url,
  });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const { privacy_hidden, privacy_hide_online, privacy_hide_activity, display_name, display_avatar, notify_own, notify_subscribed } = req.body;
  const updates = {};
  if (privacy_hidden !== undefined) updates.privacy_hidden = privacy_hidden ? 1 : 0;
  if (privacy_hide_online !== undefined) updates.privacy_hide_online = privacy_hide_online ? 1 : 0;
  if (privacy_hide_activity !== undefined) updates.privacy_hide_activity = privacy_hide_activity ? 1 : 0;
  if (display_name !== undefined) {
    const v = String(display_name).replace(/[\r\n\t]/g, ' ').trim();
    updates.display_name = v ? v.slice(0, 40) : null;
  }
  if (display_avatar !== undefined) {
    const v = String(display_avatar).trim();
    if (!v) {
      updates.display_avatar = null;
    } else if (v === 'hidden') {
      updates.display_avatar = 'hidden';
    } else if (v.startsWith('/uploads/') && !/["'<>\s]/.test(v)) {
      updates.display_avatar = v;
    } else {
      return res.status(400).json({ error: 'Invalid avatar value' });
    }
  }
  if (notify_own !== undefined) updates.notify_own = notify_own ? 1 : 0;
  if (notify_subscribed !== undefined) updates.notify_subscribed = notify_subscribed ? 1 : 0;

  db.updateUserSettings(req.user.id, updates);
  res.json({ ok: true });
});

// Upload custom avatar
app.post('/api/settings/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const allowedAvatar = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
  if (!allowedAvatar.has(ext)) {
    safeUnlink(req.file.path);
    return res.status(400).json({ error: 'Avatar must be an image (png/jpg/gif/webp)' });
  }

  const v = classifyAndValidateUpload(req.file);
  if (!v.ok) {
    safeUnlink(req.file.path);
    return res.status(400).json({ error: v.error });
  }
  if (v.detectedMimeType) req.file._detectedMimeType = v.detectedMimeType;

  const url = `/uploads/${req.file.filename}`;
  db.updateUserSettings(req.user.id, { display_avatar: url });
  res.json({ url });
});

// --- Messages Poll (live updates) ---

app.get('/api/tickets/:id/messages/poll', authMiddleware, (req, res) => {
  const ticketId = parseInt(req.params.id);
  const afterId = parseInt(req.query.after) || 0;

  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = db.getMessagesSince(ticketId, afterId);

  // Attach reactions to polled messages
  if (messages.length > 0) {
    const msgIds = messages.map(m => m.id);
    const allReactions = db.getReactionsForMessages(msgIds);
    for (const m of messages) {
      m.reactions = aggregateReactions(allReactions[m.id] || [], req.user);
    }
  }

  for (const m of messages) {
    applyMaskToMessageAuthor(m, req.user);
  }
  res.json({ messages });
});

// --- Config (public) ---

app.get('/api/config', (req, res) => {
  res.json({
    botUsername: CONFIG.botUsername,
    hasBotToken: !!CONFIG.botToken,
    siteUrl: CONFIG.siteUrl,
  });
});

// --- SPA Fallback ---

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Error Handler ==========

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    if (req.file && req.file.path) safeUnlink(req.file.path);
    if (req.files && req.files.length) cleanupMulterFiles(req.files);
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err && String(err.message || '') === 'File type not allowed') {
    return res.status(400).json({ error: 'File type not allowed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ========== Helpers ==========

function normalizeProtocol(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/\s+/g, '');
  if (v === 'tcp') return 'tcp';
  if (v === 'udp') return 'udp';
  if (v === 'tcp,udp' || v === 'udp,tcp' || v === 'both') return 'tcp,udp';
  return null;
}

function isValidPortNumber(n) {
  const num = Number(n);
  return Number.isInteger(num) && num >= 0 && num <= 65535;
}

function isValidPorts(input) {
  if (!input || !String(input).trim()) return false;
  const parts = String(input).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(s => s.trim());
      if (!a || !b || !isValidPortNumber(a) || !isValidPortNumber(b)) return false;
      if (Number(a) > Number(b)) return false;
    } else {
      if (!isValidPortNumber(part)) return false;
    }
  }
  return true;
}

function normalizePorts(input) {
  return String(input)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .join(',');
}

function normalizeMimeType(file) {
  if (file && file._detectedMimeType) return String(file._detectedMimeType).toLowerCase();

  const mt = (file.mimetype || '').toLowerCase();
  if (mt && mt !== 'application/octet-stream') return mt;

  const ext = path.extname(file.originalname || '').toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
  };
  if (map[ext]) return map[ext];

  // Fallback: sniff first bytes from file content
  try {
    if (file.path) {
      const fd = fs.openSync(file.path, 'r');
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);

      // PNG
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
      // JPEG
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
      // GIF
      if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
      // WEBP (RIFF....WEBP)
      if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
      // BMP
      if (buf.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
    }
  } catch {}

  return mt || 'application/octet-stream';
}

function sanitizeUser(user) {
  return {
    id: user.id,
    telegram_id: user.telegram_id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    photo_url: user.photo_url,
    is_admin: !!user.is_admin,
    has_chat_id: !!user.chat_id,
    // Privacy settings for frontend
    privacy_hidden: !!user.privacy_hidden,
    privacy_hide_online: !!user.privacy_hide_online,
    privacy_hide_activity: !!user.privacy_hide_activity,
    display_name: user.display_name || null,
    display_avatar: user.display_avatar || null,
  };
}

// Mask user data for public display based on privacy settings
// viewerIsAdmin: the person LOOKING at this user is an admin
function maskUserForPublic(user, viewerIsAdmin) {
  // Admins always see real data (plus any fake data alongside)
  if (viewerIsAdmin) {
    return {
      ...user,
      _real_first_name: user.first_name,
      _real_username: user.username,
      _real_photo_url: user.photo_url,
      first_name: user.display_name || user.first_name,
      photo_url: user.display_avatar === 'hidden' ? null : (user.display_avatar || user.photo_url),
    };
  }
  // Apply display_name / display_avatar
  return {
    ...user,
    first_name: user.display_name || user.first_name,
    username: user.display_name ? null : user.username, // hide username if custom name set
    photo_url: user.display_avatar === 'hidden' ? null : (user.display_avatar || user.photo_url),
  };
}

function applyMaskToTicketAuthor(ticket, viewer) {
  const viewerIsAdmin = !!viewer?.is_admin;
  const isSelf = ticket.author_id === viewer?.id;

  const src = {
    id: ticket.author_id,
    first_name: ticket.author_first_name,
    username: ticket.author_username,
    photo_url: ticket.author_photo,
    display_name: ticket.author_display_name || null,
    display_avatar: ticket.author_display_avatar || null,
    privacy_hidden: !!ticket.author_privacy_hidden,
  };

  if (!viewerIsAdmin && !isSelf) {
    if (src.privacy_hidden) {
      ticket.author_first_name = 'Скрытый пользователь';
      ticket.author_username = null;
      ticket.author_photo = null;
    } else {
      const masked = maskUserForPublic(src, false);
      ticket.author_first_name = masked.first_name;
      ticket.author_username = masked.username;
      ticket.author_photo = masked.photo_url;
    }
  } else if (isSelf && !viewerIsAdmin) {
    // Even for self, apply display_avatar/display_name so the user sees their masked appearance
    const masked = maskUserForPublic(src, false);
    ticket.author_first_name = masked.first_name;
    ticket.author_username = masked.username;
    ticket.author_photo = masked.photo_url;
  }

  if (!viewerIsAdmin) {
    delete ticket.author_display_name;
    delete ticket.author_display_avatar;
    delete ticket.author_privacy_hidden;
  }

  // Admin: keep real fields; expose fake fields explicitly
  if (viewerIsAdmin) {
    ticket.author_fake_name = src.display_name || null;
    ticket.author_fake_avatar = src.display_avatar || null;
    ticket.author_privacy_hidden = !!src.privacy_hidden;
    // Also apply display mask for visual rendering (admin sees masked version + real data alongside)
    const masked = maskUserForPublic(src, true);
    ticket.author_first_name = masked.first_name;
    ticket.author_photo = masked.photo_url;
  }
}

function applyMaskToMessageAuthor(msg, viewer) {
  const viewerIsAdmin = !!viewer?.is_admin;
  const isSelf = msg.author_id === viewer?.id;

  const src = {
    id: msg.author_id,
    first_name: msg.author_first_name,
    username: msg.author_username,
    photo_url: msg.author_photo,
    display_name: msg.author_display_name || null,
    display_avatar: msg.author_display_avatar || null,
    privacy_hidden: !!msg.author_privacy_hidden,
  };

  if (!viewerIsAdmin && !isSelf) {
    if (src.privacy_hidden) {
      msg.author_first_name = 'Скрытый пользователь';
      msg.author_username = null;
      msg.author_photo = null;
    } else {
      const masked = maskUserForPublic(src, false);
      msg.author_first_name = masked.first_name;
      msg.author_username = masked.username;
      msg.author_photo = masked.photo_url;
    }
  } else if (isSelf && !viewerIsAdmin) {
    // Even for self, apply display_avatar/display_name so the user sees their masked appearance
    const masked = maskUserForPublic(src, false);
    msg.author_first_name = masked.first_name;
    msg.author_username = masked.username;
    msg.author_photo = masked.photo_url;
  }

  if (!viewerIsAdmin) {
    delete msg.author_display_name;
    delete msg.author_display_avatar;
    delete msg.author_privacy_hidden;
  }

  if (viewerIsAdmin) {
    msg.author_fake_name = src.display_name || null;
    msg.author_fake_avatar = src.display_avatar || null;
    msg.author_privacy_hidden = !!src.privacy_hidden;
    // Also apply display mask for visual rendering
    const masked = maskUserForPublic(src, true);
    msg.author_first_name = masked.first_name;
    msg.author_photo = masked.photo_url;
  }
}

function statusLabel(status) {
  const labels = {
    open: 'Открыто',
    in_progress: 'В работе',
    review: 'На ревью',
    testing: 'Тестирование',
    closed: 'Закрыто',
    rejected: 'Отклонено',
    duplicate: 'Дубликат',
  };
  return labels[status] || status;
}

// Aggregate raw reaction rows into a compact format: [{ emoji, count, users: [{id, name}], user_reacted: bool }]
function aggregateReactions(rawReactions, viewer) {
  const map = new Map(); // emoji -> { count, users, user_reacted }
  for (const r of rawReactions) {
    if (!map.has(r.emoji)) {
      map.set(r.emoji, { emoji: r.emoji, count: 0, users: [], user_reacted: false });
    }
    const entry = map.get(r.emoji);
    entry.count++;

    const displayName = (viewer && viewer.is_admin)
      ? (r.first_name || r.username || 'Unknown')
      : (r.display_name || r.first_name || r.username || 'Unknown');

    entry.users.push({ id: r.user_id, name: r.privacy_hidden && !(viewer && viewer.is_admin) && r.user_id !== viewer?.id ? 'Скрытый пользователь' : displayName });

    if (viewer && r.user_id === viewer.id) {
      entry.user_reacted = true;
    }
  }
  return Array.from(map.values());
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ========== Presets API ==========

// Dedicated multer for preset txt files only
const presetUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit for txt files
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .txt files are allowed for presets'), false);
    }
  },
});

// List presets
app.get('/api/presets', authMiddleware, (req, res) => {
  const { search, author_id, sort, page } = req.query;
  const result = db.getPresets({
    search,
    author_id: author_id ? parseInt(author_id) : undefined,
    sort: sort || undefined,
    page: parseInt(page) || 1,
  });

  // Apply privacy masking to preset authors
  for (const p of result.presets) {
    applyMaskToPresetAuthor(p, req.user);
  }
  res.json(result);
});

// Get single preset with comments
app.get('/api/presets/:id', authMiddleware, (req, res) => {
  const preset = db.getPresetById(parseInt(req.params.id));
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  preset.comments = db.getPresetComments(preset.id);
  for (const c of preset.comments) {
    applyMaskToMessageAuthor(c, req.user);
  }
  applyMaskToPresetAuthor(preset, req.user);
  res.json(preset);
});

// Get preset file content (read txt file and return as text)
app.get('/api/presets/:id/content', authMiddleware, (req, res) => {
  const preset = db.getPresetById(parseInt(req.params.id));
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const filePath = path.join(CONFIG.uploadDir, preset.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content, filename: preset.original_name });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Download preset file
app.get('/api/presets/:id/download', authMiddleware, (req, res) => {
  const preset = db.getPresetById(parseInt(req.params.id));
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const filePath = path.join(CONFIG.uploadDir, preset.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  db.incrementPresetDownload(preset.id);
  res.download(filePath, preset.original_name);
});

// Create preset (requires txt file upload)
app.post('/api/presets', authMiddleware, presetUpload.single('file'), (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !title.trim()) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A .txt file is required' });
    }

    const preset = db.createPreset({
      title: title.trim(),
      description: (description || '').trim(),
      author_id: req.user.id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_size: req.file.size,
    });

    applyMaskToPresetAuthor(preset, req.user);
    res.json(preset);
  } catch (e) {
    if (req.file) safeUnlink(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

// Update preset (title/description only)
app.put('/api/presets/:id', authMiddleware, (req, res) => {
  const preset = db.getPresetById(parseInt(req.params.id));
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  if (!req.user.is_admin && preset.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const updated = db.updatePreset(parseInt(req.params.id), req.body);
  applyMaskToPresetAuthor(updated, req.user);
  res.json(updated);
});

// Delete preset
app.delete('/api/presets/:id', authMiddleware, (req, res) => {
  const preset = db.getPresetById(parseInt(req.params.id));
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  if (!req.user.is_admin && preset.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Delete file from disk
  const filePath = path.join(CONFIG.uploadDir, preset.filename);
  safeUnlink(filePath);

  db.deletePreset(parseInt(req.params.id));
  res.json({ ok: true });
});

// Add comment to preset
app.post('/api/presets/:id/comments', authMiddleware, (req, res) => {
  const presetId = parseInt(req.params.id);
  const preset = db.getPresetById(presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const comment = db.addPresetComment({
    preset_id: presetId,
    author_id: req.user.id,
    content: content.trim(),
  });

  applyMaskToMessageAuthor(comment, req.user);
  res.json(comment);
});

// Delete comment
app.delete('/api/preset-comments/:id', authMiddleware, (req, res) => {
  const comment = db.getPresetCommentById(parseInt(req.params.id));
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  if (!req.user.is_admin && comment.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.deletePresetComment(parseInt(req.params.id));
  res.json({ ok: true });
});

// Helper: apply privacy mask to preset author (same pattern as ticket author)
function applyMaskToPresetAuthor(preset, viewer) {
  const viewerIsAdmin = !!viewer?.is_admin;
  const isSelf = preset.author_id === viewer?.id;

  const src = {
    id: preset.author_id,
    first_name: preset.author_first_name,
    username: preset.author_username,
    photo_url: preset.author_photo,
    display_name: preset.author_display_name || null,
    display_avatar: preset.author_display_avatar || null,
    privacy_hidden: !!preset.author_privacy_hidden,
  };

  if (!viewerIsAdmin && !isSelf) {
    if (src.privacy_hidden) {
      preset.author_first_name = 'Скрытый пользователь';
      preset.author_username = null;
      preset.author_photo = null;
    } else {
      const masked = maskUserForPublic(src, false);
      preset.author_first_name = masked.first_name;
      preset.author_username = masked.username;
      preset.author_photo = masked.photo_url;
    }
  } else if (isSelf && !viewerIsAdmin) {
    const masked = maskUserForPublic(src, false);
    preset.author_first_name = masked.first_name;
    preset.author_username = masked.username;
    preset.author_photo = masked.photo_url;
  }

  if (!viewerIsAdmin) {
    delete preset.author_display_name;
    delete preset.author_display_avatar;
    delete preset.author_privacy_hidden;
  }

  if (viewerIsAdmin) {
    preset.author_fake_name = src.display_name || null;
    preset.author_fake_avatar = src.display_avatar || null;
    preset.author_privacy_hidden = !!src.privacy_hidden;
    const masked = maskUserForPublic(src, true);
    preset.author_first_name = masked.first_name;
    preset.author_photo = masked.photo_url;
  }
}

// ========== Cleanup interval ==========

setInterval(() => {
  db.cleanupAuthTokens();
  db.cleanupSessions();
}, 5 * 60 * 1000);

// ========== Start ==========

app.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Zapret Tracker running at http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`Admin Telegram ID: ${CONFIG.adminTelegramId}`);
  if (CONFIG.botToken) {
    console.log(`Bot: @${CONFIG.botUsername}`);
    startBotPolling();
    // Refresh avatars on startup and every 6 hours
    setTimeout(() => refreshUserAvatars(), 10000);
    setInterval(() => refreshUserAvatars(), 6 * 60 * 60 * 1000);
  } else {
    console.log('WARNING: BOT_TOKEN not set — dev mode (no Telegram auth, no notifications)');
  }
});
