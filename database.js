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
      resource_name TEXT,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('bug', 'idea', 'feature', 'improvement')),
      is_resource_request INTEGER DEFAULT 0,
      resource_protocol TEXT,
      resource_ports TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'review', 'testing', 'closed', 'rejected', 'duplicate')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
      emoji TEXT,
      color TEXT,
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

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ticket_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#6c757d',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
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
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_id);

    CREATE TABLE IF NOT EXISTS pinned_tickets (
      ticket_id INTEGER PRIMARY KEY,
      pinned_by INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (pinned_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS thread_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      parent_message_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pinned_tickets_order ON pinned_tickets(sort_order);
    CREATE INDEX IF NOT EXISTS idx_thread_replies_parent ON thread_replies(parent_message_id);
    CREATE INDEX IF NOT EXISTS idx_thread_replies_ticket ON thread_replies(ticket_id);

    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      author_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS preset_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_presets_author ON presets(author_id);
    CREATE INDEX IF NOT EXISTS idx_preset_comments_preset ON preset_comments(preset_id);
    CREATE INDEX IF NOT EXISTS idx_preset_comments_author ON preset_comments(author_id);
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

  // Insert default ticket types
  const insertType = db.prepare('INSERT OR IGNORE INTO ticket_types (key, name, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?)');
  const defaultTypes = [
    ['bug', 'Баг', '\uD83D\uDC1B', '#e8364d', 1],
    ['idea', 'Идея', '\uD83D\uDCA1', '#4da3ff', 2],
    ['feature', 'Фича', '\uD83D\uDE80', '#22c55e', 3],
    ['improvement', 'Улучшение', '\u2B50', '#8b5cf6', 4],
  ];
  const insertManyTypes = db.transaction((types) => {
    for (const [key, name, emoji, color, sort_order] of types) {
      insertType.run(key, name, emoji, color, sort_order);
    }
  });
  insertManyTypes(defaultTypes);

  // Migrations: add columns safely
  const migrations = [
    "ALTER TABLE tickets ADD COLUMN emoji TEXT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN color TEXT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN is_resource_request INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN resource_protocol TEXT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN resource_ports TEXT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN resource_name TEXT DEFAULT NULL",
    // Geo-restriction requests
    "ALTER TABLE tickets ADD COLUMN is_geo_request INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN geo_url TEXT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN geo_subdomains TEXT DEFAULT NULL",
    // Privacy settings
    "ALTER TABLE users ADD COLUMN privacy_hidden INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN privacy_hide_online INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN privacy_hide_activity INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN display_avatar TEXT DEFAULT NULL",
    // Megathread support
    "ALTER TABLE tickets ADD COLUMN is_megathread INTEGER DEFAULT 0",
  ];

  // Migration: remove CHECK constraint on tickets.type by recreating the table
  // This allows dynamic ticket types managed from the admin panel
  try {
    const hasCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tickets'").get();
    if (hasCheck && hasCheck.sql && hasCheck.sql.includes("CHECK(type IN")) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tickets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          resource_name TEXT,
          description TEXT,
          type TEXT NOT NULL,
          is_resource_request INTEGER DEFAULT 0,
          resource_protocol TEXT,
          resource_ports TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'review', 'testing', 'closed', 'rejected', 'duplicate')),
          priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
          emoji TEXT,
          color TEXT,
          is_private INTEGER DEFAULT 0,
          author_id INTEGER NOT NULL,
          assigned_to INTEGER,
          votes_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          is_geo_request INTEGER DEFAULT 0,
          geo_url TEXT,
          geo_subdomains TEXT,
          FOREIGN KEY (author_id) REFERENCES users(id),
          FOREIGN KEY (assigned_to) REFERENCES users(id)
        );
        INSERT INTO tickets_new SELECT id, title, resource_name, description, type, is_resource_request, resource_protocol, resource_ports, status, priority, emoji, color, is_private, author_id, assigned_to, votes_count, created_at, updated_at, closed_at, is_geo_request, geo_url, geo_subdomains FROM tickets;
        DROP TABLE tickets;
        ALTER TABLE tickets_new RENAME TO tickets;
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);
        CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_private ON tickets(is_private);
      `);
    }
  } catch (e) {
    // Migration may fail if already applied or column mismatch — that's ok
    console.log('Type CHECK migration note:', e.message);
  }
  for (const sql of migrations) {
    try { db.exec(sql); } catch {}
  }

  // Cleanup old auth tokens (older than 10 minutes)
  db.prepare("DELETE FROM auth_tokens WHERE created_at < datetime('now', '-10 minutes')").run();

  // Cleanup old sessions (older than 90 days)
  db.prepare("DELETE FROM sessions WHERE created_at < datetime('now', '-90 days')").run();

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

// ========== Sessions (persistent) ==========

function createSession(token, userId) {
  getDb().prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
}

function getSession(token) {
  return getDb().prepare('SELECT * FROM sessions WHERE token = ?').get(token);
}

function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanupSessions() {
  getDb().prepare("DELETE FROM sessions WHERE created_at < datetime('now', '-90 days')").run();
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

function createTicket({
  title,
  description,
  type,
  priority,
  is_private,
  author_id,
  tags,
  emoji,
  color,
  is_resource_request,
  resource_protocol,
  resource_ports,
  resource_name,
  is_geo_request,
  geo_url,
  geo_subdomains,
  is_megathread,
}) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO tickets (title, resource_name, description, type, is_resource_request, resource_protocol, resource_ports, priority, is_private, author_id, emoji, color, is_geo_request, geo_url, geo_subdomains, is_megathread)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    resource_name || null,
    description || '',
    type,
    is_resource_request ? 1 : 0,
    resource_protocol || null,
    resource_ports || null,
    priority || 'medium',
    is_private ? 1 : 0,
    author_id,
    emoji || null,
    color || null,
    is_geo_request ? 1 : 0,
    geo_url || null,
    geo_subdomains || null,
    is_megathread ? 1 : 0,
  );

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
    SELECT t.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden,
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

function getTickets({ status, type, priority, author_id, is_admin, user_id, search, tag_id, is_resource_request, exclude_archived, only_archived, sort, page = 1, limit = 50 }) {
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
  if (is_resource_request !== undefined) {
    where.push('t.is_resource_request = ?');
    params.push(is_resource_request ? 1 : 0);
  }
  if (exclude_archived) {
    where.push("t.status NOT IN ('closed', 'rejected', 'duplicate')");
  }
  if (only_archived) {
    where.push("t.status IN ('closed', 'rejected', 'duplicate')");
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) as count FROM tickets t ${whereClause}`).get(...params).count;

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'newest':
      orderBy = 't.created_at DESC';
      break;
    case 'oldest':
      orderBy = 't.created_at ASC';
      break;
    case 'most_voted':
      orderBy = 't.votes_count DESC, t.created_at DESC';
      break;
    case 'most_commented':
      orderBy = 'message_count DESC, t.created_at DESC';
      break;
    case 'priority':
      orderBy = `CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, t.created_at DESC`;
      break;
    case 'updated':
      orderBy = 't.updated_at DESC';
      break;
    default:
      orderBy = `CASE t.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'review' THEN 3 WHEN 'testing' THEN 4 WHEN 'closed' THEN 5 WHEN 'rejected' THEN 6 WHEN 'duplicate' THEN 7 END,
      CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
      t.created_at DESC`;
  }

  const tickets = db.prepare(`
    SELECT t.*,
    u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
    u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden,
    (SELECT COUNT(*) FROM messages m WHERE m.ticket_id = t.id AND m.is_system = 0) as message_count,
    (CASE WHEN EXISTS (SELECT 1 FROM pinned_tickets p WHERE p.ticket_id = t.id) THEN 1 ELSE 0 END) as is_pinned
    FROM tickets t
    JOIN users u ON t.author_id = u.id
    ${whereClause}
    ORDER BY ${orderBy}
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
  const allowed = ['title', 'description', 'type', 'status', 'priority', 'is_private', 'assigned_to', 'emoji', 'color', 'resource_name', 'resource_protocol', 'resource_ports', 'is_megathread'];
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
    SELECT m.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM messages m JOIN users u ON m.author_id = u.id WHERE m.id = ?
  `).get(result.lastInsertRowid);
}

function getMessages(ticket_id) {
  const db = getDb();
  const messages = db.prepare(`
    SELECT m.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
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

function getMessageById(id) {
  return getDb().prepare(`
    SELECT m.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM messages m JOIN users u ON m.author_id = u.id WHERE m.id = ?
  `).get(id);
}

function updateMessage(id, content) {
  const db = getDb();
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
  return getMessageById(id);
}

function deleteMessage(id) {
  const db = getDb();
  // Delete attachments linked to this message
  db.prepare('DELETE FROM attachments WHERE message_id = ?').run(id);
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
}

// ========== Message Reactions ==========

function toggleReaction(messageId, userId, emoji) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, userId, emoji);

  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
    return { added: false };
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, userId, emoji);
    return { added: true };
  }
}

function getReactionsForMessage(messageId) {
  const db = getDb();
  return db.prepare(`
    SELECT mr.emoji, mr.user_id, u.first_name, u.username, u.display_name, u.privacy_hidden
    FROM message_reactions mr
    JOIN users u ON mr.user_id = u.id
    WHERE mr.message_id = ?
    ORDER BY mr.created_at ASC
  `).all(messageId);
}

function getReactionsForMessages(messageIds) {
  if (!messageIds || messageIds.length === 0) return {};
  const db = getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT mr.message_id, mr.emoji, mr.user_id, u.first_name, u.username, u.display_name, u.privacy_hidden
    FROM message_reactions mr
    JOIN users u ON mr.user_id = u.id
    WHERE mr.message_id IN (${placeholders})
    ORDER BY mr.created_at ASC
  `).all(...messageIds);

  const result = {};
  for (const row of rows) {
    if (!result[row.message_id]) result[row.message_id] = [];
    result[row.message_id].push(row);
  }
  return result;
}

function getReactionsForTicket(ticketId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT mr.message_id, mr.emoji, mr.user_id, u.first_name, u.username, u.display_name, u.privacy_hidden
    FROM message_reactions mr
    JOIN users u ON mr.user_id = u.id
    JOIN messages m ON mr.message_id = m.id
    WHERE m.ticket_id = ?
    ORDER BY mr.created_at ASC
  `).all(ticketId);

  const result = {};
  for (const row of rows) {
    if (!result[row.message_id]) result[row.message_id] = [];
    result[row.message_id].push(row);
  }
  return result;
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

// ========== User Settings ==========

function getUserSettings(userId) {
  return getDb().prepare(`
    SELECT privacy_hidden, privacy_hide_online, privacy_hide_activity, display_name, display_avatar,
           notify_own, notify_subscribed
    FROM users WHERE id = ?
  `).get(userId);
}

function updateUserSettings(userId, settings) {
  const allowed = ['privacy_hidden', 'privacy_hide_online', 'privacy_hide_activity', 'display_name', 'display_avatar', 'notify_own', 'notify_subscribed'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (settings[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(settings[key]);
    }
  }
  if (sets.length === 0) return;
  params.push(userId);
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// Get messages newer than a given message id for a ticket
function getMessagesSince(ticketId, afterId) {
  const db = getDb();
  const messages = db.prepare(`
    SELECT m.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM messages m
    JOIN users u ON m.author_id = u.id
    WHERE m.ticket_id = ? AND m.id > ?
    ORDER BY m.created_at ASC
  `).all(ticketId, afterId);

  const getAttachments = db.prepare('SELECT * FROM attachments WHERE message_id = ?');
  for (const msg of messages) {
    msg.attachments = getAttachments.all(msg.id);
  }
  return messages;
}

// ========== Ticket Types ==========

function getAllTicketTypes() {
  return getDb().prepare('SELECT * FROM ticket_types ORDER BY sort_order ASC, id ASC').all();
}

function getTicketTypeByKey(key) {
  return getDb().prepare('SELECT * FROM ticket_types WHERE key = ?').get(key);
}

function createTicketType({ key, name, emoji, color, sort_order }) {
  const db = getDb();
  const result = db.prepare('INSERT INTO ticket_types (key, name, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?)').run(
    key, name, emoji || '', color || '#6c757d', sort_order || 0
  );
  return db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(result.lastInsertRowid);
}

function updateTicketType(id, updates) {
  const db = getDb();
  const allowed = ['key', 'name', 'emoji', 'color', 'sort_order'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(updates[k]);
    }
  }
  if (sets.length === 0) return getDb().prepare('SELECT * FROM ticket_types WHERE id = ?').get(id);
  params.push(id);
  db.prepare(`UPDATE ticket_types SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM ticket_types WHERE id = ?').get(id);
}

function deleteTicketType(id) {
  return getDb().prepare('DELETE FROM ticket_types WHERE id = ?').run(id);
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

// ========== Pinned Tickets ==========

function pinTicket(ticketId, userId) {
  const db = getDb();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM pinned_tickets').get().m;
  db.prepare('INSERT OR REPLACE INTO pinned_tickets (ticket_id, pinned_by, sort_order, pinned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .run(ticketId, userId, maxOrder + 1);
}

function unpinTicket(ticketId) {
  getDb().prepare('DELETE FROM pinned_tickets WHERE ticket_id = ?').run(ticketId);
}

function isPinned(ticketId) {
  return !!getDb().prepare('SELECT 1 FROM pinned_tickets WHERE ticket_id = ?').get(ticketId);
}

function getPinnedTickets({ is_admin, user_id }) {
  const db = getDb();
  let privacyFilter = '';
  const params = [];
  if (!is_admin) {
    privacyFilter = 'AND (t.is_private = 0 OR t.author_id = ?)';
    params.push(user_id);
  }

  const tickets = db.prepare(`
    SELECT t.*,
      u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
      u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden,
      p.pinned_at, p.sort_order as pin_order,
      (SELECT COUNT(*) FROM messages m WHERE m.ticket_id = t.id AND m.is_system = 0) as message_count
    FROM pinned_tickets p
    JOIN tickets t ON p.ticket_id = t.id
    JOIN users u ON t.author_id = u.id
    WHERE 1=1 ${privacyFilter}
    ORDER BY p.sort_order ASC
  `).all(...params);

  const getTagsStmt = db.prepare('SELECT tg.* FROM tags tg JOIN ticket_tags tt ON tg.id = tt.tag_id WHERE tt.ticket_id = ?');
  for (const ticket of tickets) {
    ticket.tags = getTagsStmt.all(ticket.id);
    ticket.is_pinned = true;
  }

  return tickets;
}

function reorderPinnedTickets(ticketIds) {
  const db = getDb();
  const stmt = db.prepare('UPDATE pinned_tickets SET sort_order = ? WHERE ticket_id = ?');
  const txn = db.transaction((ids) => {
    ids.forEach((id, i) => stmt.run(i + 1, id));
  });
  txn(ticketIds);
}

// ========== Thread Replies (Sub-threads for Megathreads) ==========

function addThreadReply({ ticket_id, parent_message_id, author_id, content }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO thread_replies (ticket_id, parent_message_id, author_id, content)
    VALUES (?, ?, ?, ?)
  `).run(ticket_id, parent_message_id, author_id, content);

  db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticket_id);

  return db.prepare(`
    SELECT tr.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM thread_replies tr JOIN users u ON tr.author_id = u.id WHERE tr.id = ?
  `).get(result.lastInsertRowid);
}

function getThreadReplies(parentMessageId) {
  return getDb().prepare(`
    SELECT tr.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM thread_replies tr
    JOIN users u ON tr.author_id = u.id
    WHERE tr.parent_message_id = ?
    ORDER BY tr.created_at ASC
  `).all(parentMessageId);
}

function getThreadRepliesForTicket(ticketId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tr.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM thread_replies tr
    JOIN users u ON tr.author_id = u.id
    WHERE tr.ticket_id = ?
    ORDER BY tr.created_at ASC
  `).all(ticketId);

  // Group by parent_message_id
  const result = {};
  for (const row of rows) {
    if (!result[row.parent_message_id]) result[row.parent_message_id] = [];
    result[row.parent_message_id].push(row);
  }
  return result;
}

function getThreadReplyById(id) {
  return getDb().prepare(`
    SELECT tr.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM thread_replies tr JOIN users u ON tr.author_id = u.id WHERE tr.id = ?
  `).get(id);
}

function deleteThreadReply(id) {
  getDb().prepare('DELETE FROM thread_replies WHERE id = ?').run(id);
}

function getThreadReplyCountsForTicket(ticketId) {
  const rows = getDb().prepare(`
    SELECT parent_message_id, COUNT(*) as count FROM thread_replies WHERE ticket_id = ? GROUP BY parent_message_id
  `).all(ticketId);
  const result = {};
  for (const r of rows) result[r.parent_message_id] = r.count;
  return result;
}

// ========== Presets ==========

function createPreset({ title, description, author_id, filename, original_name, file_size }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO presets (title, description, author_id, filename, original_name, file_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description || '', author_id, filename, original_name, file_size || 0);
  return getPresetById(result.lastInsertRowid);
}

function getPresetById(id) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden,
           (SELECT COUNT(*) FROM preset_comments pc WHERE pc.preset_id = p.id) as comment_count
    FROM presets p
    JOIN users u ON p.author_id = u.id
    WHERE p.id = ?
  `).get(id);
}

function getPresets({ search, author_id, sort, page = 1, limit = 20 }) {
  const db = getDb();
  let where = [];
  let params = [];

  if (search) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (author_id) {
    where.push('p.author_id = ?');
    params.push(author_id);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) as count FROM presets p ${whereClause}`).get(...params).count;

  let orderBy;
  switch (sort) {
    case 'oldest': orderBy = 'p.created_at ASC'; break;
    case 'most_downloaded': orderBy = 'p.download_count DESC, p.created_at DESC'; break;
    case 'most_commented': orderBy = 'comment_count DESC, p.created_at DESC'; break;
    default: orderBy = 'p.created_at DESC';
  }

  const presets = db.prepare(`
    SELECT p.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden,
           (SELECT COUNT(*) FROM preset_comments pc WHERE pc.preset_id = p.id) as comment_count
    FROM presets p
    JOIN users u ON p.author_id = u.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { presets, total, page, limit };
}

function updatePreset(id, updates) {
  const db = getDb();
  const allowed = ['title', 'description'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(updates[key]);
    }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  if (sets.length > 1) {
    db.prepare(`UPDATE presets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  return getPresetById(id);
}

function deletePreset(id) {
  const db = getDb();
  db.prepare('DELETE FROM preset_comments WHERE preset_id = ?').run(id);
  return db.prepare('DELETE FROM presets WHERE id = ?').run(id);
}

function incrementPresetDownload(id) {
  getDb().prepare('UPDATE presets SET download_count = download_count + 1 WHERE id = ?').run(id);
}

// ========== Preset Comments ==========

function addPresetComment({ preset_id, author_id, content }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO preset_comments (preset_id, author_id, content)
    VALUES (?, ?, ?)
  `).run(preset_id, author_id, content);

  db.prepare('UPDATE presets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(preset_id);

  return db.prepare(`
    SELECT pc.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM preset_comments pc JOIN users u ON pc.author_id = u.id WHERE pc.id = ?
  `).get(result.lastInsertRowid);
}

function getPresetComments(presetId) {
  return getDb().prepare(`
    SELECT pc.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM preset_comments pc
    JOIN users u ON pc.author_id = u.id
    WHERE pc.preset_id = ?
    ORDER BY pc.created_at ASC
  `).all(presetId);
}

function getPresetCommentById(id) {
  return getDb().prepare(`
    SELECT pc.*,
           u.username as author_username, u.first_name as author_first_name, u.photo_url as author_photo, u.is_admin as author_is_admin,
           u.display_name as author_display_name, u.display_avatar as author_display_avatar, u.privacy_hidden as author_privacy_hidden
    FROM preset_comments pc JOIN users u ON pc.author_id = u.id WHERE pc.id = ?
  `).get(id);
}

function deletePresetComment(id) {
  getDb().prepare('DELETE FROM preset_comments WHERE id = ?').run(id);
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
  // Sessions
  createSession,
  getSession,
  deleteSession,
  cleanupSessions,
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
  getMessageById,
  updateMessage,
  deleteMessage,
  // Attachments
  addAttachment,
  // Message Reactions
  toggleReaction,
  getReactionsForMessage,
  getReactionsForMessages,
  getReactionsForTicket,
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
  // Ticket Types
  getAllTicketTypes,
  getTicketTypeByKey,
  createTicketType,
  updateTicketType,
  deleteTicketType,
  // User settings
  getUserSettings,
  updateUserSettings,
  getMessagesSince,
  // Stats
  getStats,
  // Pinned Tickets
  pinTicket,
  unpinTicket,
  isPinned,
  getPinnedTickets,
  reorderPinnedTickets,
  // Thread Replies (Megathreads)
  addThreadReply,
  getThreadReplies,
  getThreadRepliesForTicket,
  getThreadReplyById,
  deleteThreadReply,
  getThreadReplyCountsForTicket,
  // Presets
  createPreset,
  getPresetById,
  getPresets,
  updatePreset,
  deletePreset,
  incrementPresetDownload,
  // Preset Comments
  addPresetComment,
  getPresetComments,
  getPresetCommentById,
  deletePresetComment,
};
