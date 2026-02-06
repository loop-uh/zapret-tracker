const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'tracker.db');

let db;

function init() {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      chat_id INTEGER,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      is_admin INTEGER DEFAULT 0,
      notify_own INTEGER DEFAULT 1,
      notify_subscribed INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      telegram_id INTEGER,
      chat_id INTEGER,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      confirmed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6c757d'
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('bug', 'idea', 'feature', 'improvement')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'review', 'testing', 'closed', 'rejected', 'duplicate')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
      is_private INTEGER DEFAULT 0,
      author_id INTEGER NOT NULL,
      assigned_to INTEGER,
      votes_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      FOREIGN KEY (author_id) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ticket_tags (
      ticket_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, tag_id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT,
      is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      message_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      user_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, ticket_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, ticket_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
    CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_private ON tickets(is_private);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON attachments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_ticket ON subscriptions(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_created ON auth_tokens(created_at);
  `);

  // Insert default tags
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
  const defaultTags = [
    ['UI', '#0d6efd'],
    ['Сеть', '#198754'],
    ['Производительность', '#fd7e14'],
    ['Безопасность', '#dc3545'],
    ['DPI', '#6f42c1'],
    ['DNS', '#20c997'],
    ['VPN', '#0dcaf0'],
    ['Прокси', '#6610f2'],
    ['Документация', '#adb5bd'],
    ['Windows', '#0078d4'],
    ['Linux', '#ffc107'],
    ['Android', '#3ddc84'],
    ['Роутер', '#e83e8c'],
  ];
  const insertMany = db.transaction((tags) => {
    for (const [name, color] of tags) {
      insertTag.run(name, color);
    }
  });
  insertMany(defaultTags);

  // Cleanup old auth tokens (older than 10 minutes)
  db.prepare("DELETE FROM auth_tokens WHERE created_at < datetime('now', '-10 minutes')").run();

  return db;
}

function getDb() {
  if (!db) init();
  return db;
}

// ========== Auth Tokens ==========

function createAuthToken(token) {
  getDb().prepare('INSERT INTO auth_tokens (token) VALUES (?)').run(token);
}

function confirmAuthToken(token, telegramData) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token = ? AND confirmed = 0').get(token);
  if (!row) return false;

  db.prepare(`
    UPDATE auth_tokens SET confirmed = 1, telegram_id = ?, chat_id = ?, username = ?, first_name = ?, last_name = ?, photo_url = ?
    WHERE token = ?
  `).run(
    telegramData.telegram_id, telegramData.chat_id,
    telegramData.username || null, telegramData.first_name || 'User',
    telegramData.last_name || null, telegramData.photo_url || null,
    token
  );
  return true;
}

function getAuthToken(token) {
  return getDb().prepare('SELECT * FROM auth_tokens WHERE token = ?').get(token);
}

function deleteAuthToken(token) {
  getDb().prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
}

function cleanupAuthTokens() {
  getDb().prepare("DELETE FROM auth_tokens WHERE created_at < datetime('now', '-10 minutes')").run();
}

// ========== Users ==========

function findOrCreateUser(telegramData) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramData.id);

  if (existing) {
    db.prepare(`
      UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, chat_id = COALESCE(?, chat_id), last_login = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `).run(
      telegramData.username || null, telegramData.first_name,
      telegramData.last_name || null, telegramData.photo_url || null,
      telegramData.chat_id || null, telegramData.id
    );
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramData.id);
  }

  const isAdmin = telegramData.id === 6483277608 ? 1 : 0;
  db.prepare(`
    INSERT INTO users (telegram_id, chat_id, username, first_name, last_name, photo_url, is_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    telegramData.id, telegramData.chat_id || null,
    telegramData.username || null, telegramData.first_name,
    telegramData.last_name || null, telegramData.photo_url || null, isAdmin
  );

  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramData.id);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByTelegramId(telegramId) {
  return getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function updateUserChatId(telegramId, chatId) {
  getDb().prepare('UPDATE users SET chat_id = ? WHERE telegram_id = ?').run(chatId, telegramId);
}

// ========== Tickets ==========

function createTicket({ title, description, type, priority, is_private, author_id, tags }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO tickets (title, description, type, priority, is_private, author_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description || '', type, priority || 'medium', is_private ? 1 : 0, author_id);

  const ticketId = result.lastInsertRowid;

  if (tags && tags.length > 0) {
    const insertTag = db.prepare('INSERT OR IGNORE INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
    for (const tagId of tags) {
      insertTag.run(ticketId, tagId);
    }
  }

  // Auto-subscribe author
  subscribe(author_id, ticketId);

  return getTicketById(ticketId);
}

function getTicketById(id) {
  const db = getDb();
  const ticket = db.prepare(`
    SELECT t.*, u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
           a.username as assignee_username, a.first_name as assignee_first_name
    FROM tickets t
    JOIN users u ON t.author_id = u.id
    LEFT JOIN users a ON t.assigned_to = a.id
    WHERE t.id = ?
  `).get(id);

  if (!ticket) return null;

  ticket.tags = db.prepare(`
    SELECT tg.* FROM tags tg
    JOIN ticket_tags tt ON tg.id = tt.tag_id
    WHERE tt.ticket_id = ?
  `).all(id);

  ticket.attachments = db.prepare('SELECT * FROM attachments WHERE ticket_id = ? AND message_id IS NULL').all(id);

  return ticket;
}

function getTickets({ status, type, priority, author_id, is_admin, user_id, search, tag_id, page = 1, limit = 50 }) {
  const db = getDb();
  let where = [];
  let params = [];

  if (!is_admin) {
    where.push('(t.is_private = 0 OR t.author_id = ?)');
    params.push(user_id);
  }

  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  if (priority) {
    where.push('t.priority = ?');
    params.push(priority);
  }
  if (author_id) {
    where.push('t.author_id = ?');
    params.push(author_id);
  }
  if (search) {
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag_id) {
    where.push('EXISTS (SELECT 1 FROM ticket_tags tt WHERE tt.ticket_id = t.id AND tt.tag_id = ?)');
    params.push(tag_id);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) as count FROM tickets t ${whereClause}`).get(...params).count;

  const tickets = db.prepare(`
    SELECT t.*, u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
    (SELECT COUNT(*) FROM messages m WHERE m.ticket_id = t.id AND m.is_system = 0) as message_count
    FROM tickets t
    JOIN users u ON t.author_id = u.id
    ${whereClause}
    ORDER BY
      CASE t.status
        WHEN 'open' THEN 1
        WHEN 'in_progress' THEN 2
        WHEN 'review' THEN 3
        WHEN 'testing' THEN 4
        WHEN 'closed' THEN 5
        WHEN 'rejected' THEN 6
        WHEN 'duplicate' THEN 7
      END,
      CASE t.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const getTagsStmt = db.prepare(`
    SELECT tg.* FROM tags tg JOIN ticket_tags tt ON tg.id = tt.tag_id WHERE tt.ticket_id = ?
  `);
  for (const ticket of tickets) {
    ticket.tags = getTagsStmt.all(ticket.id);
  }

  return { tickets, total, page, limit };
}

function updateTicket(id, updates) {
  const db = getDb();
  const allowed = ['title', 'description', 'type', 'status', 'priority', 'is_private', 'assigned_to'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(updates[key]);
    }
  }

  if (updates.status === 'closed' || updates.status === 'rejected') {
    sets.push('closed_at = CURRENT_TIMESTAMP');
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  if (sets.length > 1) {
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  if (updates.tags !== undefined) {
    db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(id);
    const insertTag = db.prepare('INSERT OR IGNORE INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
    for (const tagId of updates.tags) {
      insertTag.run(id, tagId);
    }
  }

  return getTicketById(id);
}

function deleteTicket(id) {
  const db = getDb();
  db.prepare('DELETE FROM subscriptions WHERE ticket_id = ?').run(id);
  return db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
}

// ========== Messages ==========

function addMessage({ ticket_id, author_id, content, is_system = false }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO messages (ticket_id, author_id, content, is_system)
    VALUES (?, ?, ?, ?)
  `).run(ticket_id, author_id, content, is_system ? 1 : 0);

  db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticket_id);

  return db.prepare(`
    SELECT m.*, u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin
    FROM messages m JOIN users u ON m.author_id = u.id WHERE m.id = ?
  `).get(result.lastInsertRowid);
}

function getMessages(ticket_id) {
  const db = getDb();
  const messages = db.prepare(`
    SELECT m.*, u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin
    FROM messages m
    JOIN users u ON m.author_id = u.id
    WHERE m.ticket_id = ?
    ORDER BY m.created_at ASC
  `).all(ticket_id);

  const getAttachments = db.prepare('SELECT * FROM attachments WHERE message_id = ?');
  for (const msg of messages) {
    msg.attachments = getAttachments.all(msg.id);
  }

  return messages;
}

// ========== Attachments ==========

function addAttachment({ ticket_id, message_id, filename, original_name, mime_type, size }) {
  const result = getDb().prepare(`
    INSERT INTO attachments (ticket_id, message_id, filename, original_name, mime_type, size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ticket_id, message_id || null, filename, original_name, mime_type, size);
  return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid);
}

// ========== Votes ==========

function toggleVote(user_id, ticket_id) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM votes WHERE user_id = ? AND ticket_id = ?').get(user_id, ticket_id);

  if (existing) {
    db.prepare('DELETE FROM votes WHERE user_id = ? AND ticket_id = ?').run(user_id, ticket_id);
    db.prepare('UPDATE tickets SET votes_count = votes_count - 1 WHERE id = ?').run(ticket_id);
    return { voted: false };
  } else {
    db.prepare('INSERT INTO votes (user_id, ticket_id) VALUES (?, ?)').run(user_id, ticket_id);
    db.prepare('UPDATE tickets SET votes_count = votes_count + 1 WHERE id = ?').run(ticket_id);
    return { voted: true };
  }
}

function getUserVotes(user_id) {
  return getDb().prepare('SELECT ticket_id FROM votes WHERE user_id = ?').all(user_id).map(r => r.ticket_id);
}

// ========== Subscriptions ==========

function subscribe(user_id, ticket_id) {
  getDb().prepare('INSERT OR IGNORE INTO subscriptions (user_id, ticket_id) VALUES (?, ?)').run(user_id, ticket_id);
}

function unsubscribe(user_id, ticket_id) {
  getDb().prepare('DELETE FROM subscriptions WHERE user_id = ? AND ticket_id = ?').run(user_id, ticket_id);
}

function isSubscribed(user_id, ticket_id) {
  return !!getDb().prepare('SELECT 1 FROM subscriptions WHERE user_id = ? AND ticket_id = ?').get(user_id, ticket_id);
}

function getSubscribers(ticket_id) {
  return getDb().prepare(`
    SELECT u.* FROM users u
    JOIN subscriptions s ON u.id = s.user_id
    WHERE s.ticket_id = ? AND u.chat_id IS NOT NULL AND u.notify_subscribed = 1
  `).all(ticket_id);
}

function getUserSubscriptions(user_id) {
  return getDb().prepare('SELECT ticket_id FROM subscriptions WHERE user_id = ?').all(user_id).map(r => r.ticket_id);
}

// ========== Tags ==========

function getAllTags() {
  return getDb().prepare('SELECT * FROM tags ORDER BY name').all();
}

function createTag(name, color) {
  const result = getDb().prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(name, color || '#6c757d');
  return getDb().prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
}

// ========== Stats ==========

function getStats() {
  const db = getDb();
  return {
    total: db.prepare('SELECT COUNT(*) as c FROM tickets').get().c,
    open: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c,
    in_progress: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'in_progress'").get().c,
    closed: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('closed', 'rejected', 'duplicate')").get().c,
    bugs: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE type = 'bug'").get().c,
    ideas: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE type = 'idea'").get().c,
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
  };
}

module.exports = {
  init,
  getDb,
  // Auth tokens
  createAuthToken,
  confirmAuthToken,
  getAuthToken,
  deleteAuthToken,
  cleanupAuthTokens,
  // Users
  findOrCreateUser,
  getUserById,
  getUserByTelegramId,
  updateUserChatId,
  // Tickets
  createTicket,
  getTicketById,
  getTickets,
  updateTicket,
  deleteTicket,
  // Messages
  addMessage,
  getMessages,
  // Attachments
  addAttachment,
  // Votes
  toggleVote,
  getUserVotes,
  // Subscriptions
  subscribe,
  unsubscribe,
  isSubscribed,
  getSubscribers,
  getUserSubscriptions,
  // Tags
  getAllTags,
  createTag,
  // Stats
  getStats,
};
