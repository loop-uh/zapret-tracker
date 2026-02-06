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
  maxFileSize: 50 * 1024 * 1024, // 50MB
  uploadDir: path.join(__dirname, 'uploads'),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
};

// ========== Init ==========

db.init();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(CONFIG.uploadDir));

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
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|txt|zip|rar|7z|log|conf|json|xml|csv|mp4|webm/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  },
});

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

      // Get user profile photos
      let photoUrl = null;
      try {
        const photos = await tgApi('getUserProfilePhotos', { user_id: userId, limit: 1 });
        if (photos && photos.total_count > 0) {
          const fileId = photos.photos[0][0].file_id;
          const file = await tgApi('getFile', { file_id: fileId });
          if (file) {
            photoUrl = `https://api.telegram.org/file/bot${CONFIG.botToken}/${file.file_path}`;
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
app.post('/api/auth/webapp', (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: 'Missing initData' });

  const tgUser = verifyWebAppData(initData);
  if (!tgUser) return res.status(403).json({ error: 'Invalid WebApp data' });

  const user = db.findOrCreateUser({
    id: tgUser.id,
    username: tgUser.username,
    first_name: tgUser.first_name || 'User',
    last_name: tgUser.last_name,
    photo_url: tgUser.photo_url,
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
  const { status, type, priority, author_id, search, tag_id, page } = req.query;
  const result = db.getTickets({
    status, type, priority, author_id, search, tag_id,
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
    result[status] = data.tickets.map(t => ({ ...t, user_voted: userVotes.includes(t.id) }));
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
  ticket.messages = db.getMessages(ticket.id);

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
  } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'Title and type are required' });
  }

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
  });

  // Notify admin about new ticket (if author is not admin)
  if (!req.user.is_admin) {
    const typeLabels = { bug: 'Баг', idea: 'Идея', feature: 'Фича', improvement: 'Улучшение' };
    const authorName = req.user.username ? `@${req.user.username}` : req.user.first_name;
    notifyAdmin(
      `🆕 Новый ${typeLabels[type]}: <b>${escHtml(title)}</b>\n` +
      `Автор: ${authorName}\n` +
      `Приоритет: ${priority || 'medium'}\n` +
      (is_private ? '🔒 Приватный' : '🌐 Публичный')
    );
  }

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

  if (!resource_name || !resource_name.trim()) {
    return res.status(400).json({ error: 'Название ресурса обязательно' });
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
    `Запрос на добавление ресурса: ${cleanResourceName}`,
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
    content: cleanMessage || 'Заявка на добавление ресурса',
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
      `📦 Новый запрос ресурса: <b>${escHtml(cleanResourceName)}</b>\n` +
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

// --- Messages ---
// Any authenticated user can comment on public open tickets
// Private tickets: only admin and author

app.post('/api/tickets/:id/messages', authMiddleware, upload.array('files', 10), (req, res) => {
  const ticketId = parseInt(req.params.id);
  const ticket = db.getTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  // Access check: private tickets are restricted
  if (ticket.is_private && !req.user.is_admin && ticket.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
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

  res.json(message);
});

// --- File Upload to ticket ---

app.post('/api/tickets/:id/upload', authMiddleware, upload.array('files', 10), (req, res) => {
  const ticketId = parseInt(req.params.id);
  const attachments = [];

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

// --- Stats ---

app.get('/api/stats', authMiddleware, (req, res) => {
  res.json(db.getStats());
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
    return res.status(400).json({ error: `Upload error: ${err.message}` });
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
  };
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

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  } else {
    console.log('WARNING: BOT_TOKEN not set — dev mode (no Telegram auth, no notifications)');
  }
});
