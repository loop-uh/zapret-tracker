// ========== Zapret Tracker Frontend ==========

// Detect Telegram WebApp
const TG = window.Telegram?.WebApp;
const isTgWebApp = !!(TG && TG.initData && TG.initData.length > 0);

const App = {
  token: localStorage.getItem('token'),
  user: null,
  currentView: 'list',
  tags: [],
  ticketTypes: [],
  config: {},
  authPollInterval: null,
  // Presence tracking
  _heartbeatInterval: null,
  _presencePollInterval: null,
  _onlineUsers: [],
  _onlineCount: 0,

  async init() {
    // Telegram WebApp setup
    if (isTgWebApp) {
      TG.ready();
      TG.expand();
      document.body.classList.add('tg-webapp');
    }

    await this.loadConfig();
    await this.loadTags();
    await this.loadTicketTypes();

    // Try WebApp auth first (instant, no polling)
    if (isTgWebApp && !this.token) {
      try {
        const res = await this.api('POST', '/api/auth/webapp', { initData: TG.initData });
        this.token = res.token;
        this.user = res.user;
        localStorage.setItem('token', res.token);
      } catch {
        // Fall through to existing token check
      }
    }

    // Check existing session
    if (this.token && !this.user) {
      try {
        const res = await this.api('GET', '/api/auth/me');
        this.user = res.user;
      } catch {
        this.token = null;
        localStorage.removeItem('token');
      }
    }

    // Check hash-based navigation
    this.checkHash();
    this.render();
    window.addEventListener('hashchange', () => this.checkHash());
  },

  checkHash() {
    const hash = location.hash;
    if (hash.startsWith('#ticket-')) {
      const id = hash.replace('#ticket-', '');
      if (id && this.user) {
        this.currentView = 'ticket';
        this._pendingTicketId = id;
      }
    }
  },

  async loadConfig() {
    try {
      const res = await fetch('/api/config');
      this.config = await res.json();
    } catch {}
  },

  async loadTags() {
    try {
      const res = await fetch('/api/tags');
      this.tags = await res.json();
    } catch {}
  },

  async loadTicketTypes() {
    try {
      const res = await fetch('/api/ticket-types');
      this.ticketTypes = await res.json();
    } catch {}
  },

  // Helper: get type labels/emoji map from loaded ticketTypes
  getTypeLabels() {
    const labels = {};
    for (const t of this.ticketTypes) labels[t.key] = t.name;
    return labels;
  },

  getTypeEmojis() {
    const emojis = {};
    for (const t of this.ticketTypes) emojis[t.key] = t.emoji;
    return emojis;
  },

  getTypeColors() {
    const colors = {};
    for (const t of this.ticketTypes) colors[t.key] = t.color;
    return colors;
  },

  // ========== API Helper ==========
  async api(method, url, body, isFormData = false) {
    const opts = { method, headers: {} };
    if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
    if (body) {
      if (isFormData) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  // ========== Toast ==========
  toast(message, type = 'info') {
    const container = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  // ========== Render ==========
  render() {
    const app = document.getElementById('app');
    if (!this.user) {
      this.stopPresence();
      app.innerHTML = this.renderLogin();
      this.bindLogin();
    } else {
      app.innerHTML = this.renderHeader() + '<div class="main" id="content"></div>';
      this.bindHeader();
      this.startPresence();
      if (this._pendingTicketId) {
        const id = this._pendingTicketId;
        this._pendingTicketId = null;
        this.navigate('ticket', { id });
      } else {
        this.navigate(this.currentView);
      }
    }
  },

  // ========== Login ==========
  renderLogin() {
    return `
      <div class="header">
        <div class="header-left">
          <div class="logo">
            <div class="logo-icon">Z</div>
            Zapret Tracker
          </div>
        </div>
      </div>
      <div class="login-page">
        <h1>Zapret Tracker</h1>
        <p>Платформа для отслеживания багов и идей проекта Zapret. Войдите через Telegram чтобы начать.</p>
        <div class="login-card" id="login-card">
          <h2>Вход</h2>
          <p>Авторизуйтесь через Telegram для доступа к трекеру</p>
          <div id="login-content">
            <button class="tg-login-btn" id="tg-login-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.57 8.15l-1.96 9.24c-.15.67-.54.83-1.09.52l-3.02-2.22-1.45 1.4c-.16.16-.3.3-.61.3l.22-3.05 5.55-5.01c.24-.22-.05-.33-.37-.13L8.35 13.7l-2.95-.92c-.64-.2-.65-.64.14-.95l11.52-4.44c.53-.2 1 .13.82.95l-.31.01z"/></svg>
              Войти через Telegram
            </button>
          </div>
          <div id="login-waiting" style="display:none">
            <div class="loading" style="padding:20px"><div class="spinner"></div></div>
            <p style="margin-top:12px">Ожидание подтверждения в Telegram...</p>
            <p style="font-size:12px;color:var(--text-muted);margin-top:8px">Нажмите Start в боте и вернитесь сюда</p>
            <button class="btn" id="cancel-login-btn" style="margin-top:16px">Отмена</button>
          </div>
          ${!this.config.hasBotToken ? `
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
              <button class="btn" id="dev-login-btn" style="width:100%">Dev Login (бот не настроен)</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  bindLogin() {
    // Telegram bot login
    document.getElementById('tg-login-btn')?.addEventListener('click', async () => {
      try {
        const res = await this.api('POST', '/api/auth/request');

        if (res.botLink) {
          // Open bot link in new tab
          window.open(res.botLink, '_blank');

          // Show waiting UI
          document.getElementById('login-content').style.display = 'none';
          document.getElementById('login-waiting').style.display = 'block';

          // Poll for confirmation
          this.startAuthPolling(res.token);
        } else {
          this.toast('Бот не настроен. Установите BOT_USERNAME в .env', 'error');
        }
      } catch (e) {
        this.toast('Ошибка: ' + e.message, 'error');
      }
    });

    // Cancel login
    document.getElementById('cancel-login-btn')?.addEventListener('click', () => {
      this.stopAuthPolling();
      document.getElementById('login-content').style.display = 'block';
      document.getElementById('login-waiting').style.display = 'none';
    });

    // Dev login
    document.getElementById('dev-login-btn')?.addEventListener('click', async () => {
      const id = prompt('Telegram ID:', '6483277608');
      const name = prompt('Имя:', 'Admin');
      if (id && name) {
        try {
          const res = await this.api('POST', '/api/auth/dev', {
            id: parseInt(id), first_name: name, username: name.toLowerCase(),
          });
          this.token = res.token;
          this.user = res.user;
          localStorage.setItem('token', res.token);
          this.toast('Успешный вход!', 'success');
          this.render();
        } catch (e) {
          this.toast('Ошибка: ' + e.message, 'error');
        }
      }
    });
  },

  startAuthPolling(authToken) {
    this.stopAuthPolling();
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes

    this.authPollInterval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        this.stopAuthPolling();
        document.getElementById('login-content').style.display = 'block';
        document.getElementById('login-waiting').style.display = 'none';
        this.toast('Время ожидания истекло. Попробуйте снова.', 'error');
        return;
      }

      try {
        const res = await this.api('GET', `/api/auth/check/${authToken}`);
        if (res.expired) {
          this.stopAuthPolling();
          document.getElementById('login-content').style.display = 'block';
          document.getElementById('login-waiting').style.display = 'none';
          this.toast('Ссылка устарела. Попробуйте снова.', 'error');
          return;
        }
        if (res.confirmed) {
          this.stopAuthPolling();
          this.token = res.token;
          this.user = res.user;
          localStorage.setItem('token', res.token);
          this.toast('Успешный вход!', 'success');
          this.render();
        }
      } catch {}
    }, 1000);
  },

  stopAuthPolling() {
    if (this.authPollInterval) {
      clearInterval(this.authPollInterval);
      this.authPollInterval = null;
    }
  },

  // ========== Presence Tracking ==========
  startPresence() {
    this.stopPresence();
    if (!this.token) return;

    // Poll presence every 10s
    this._presencePollInterval = setInterval(() => this.pollPresence(), 10000);
    this.pollPresence();

    // Heartbeat every 15s
    this._heartbeatInterval = setInterval(() => this.sendHeartbeat(), 15000);
    this.sendHeartbeat();
  },

  stopPresence() {
    if (this._heartbeatInterval) { clearInterval(this._heartbeatInterval); this._heartbeatInterval = null; }
    if (this._presencePollInterval) { clearInterval(this._presencePollInterval); this._presencePollInterval = null; }
  },

  async sendHeartbeat() {
    if (!this.token) return;
    const view = this.currentView;
    const ticketId = this._currentTicketId || null;
    const ticketTitle = this._currentTicketTitle || null;
    try {
      await this.api('POST', '/api/presence/heartbeat', { view, ticketId, ticketTitle });
    } catch {}
  },

  async pollPresence() {
    if (!this.token) return;
    try {
      const data = await this.api('GET', '/api/presence/online');
      this._onlineUsers = data.users;
      this._onlineCount = data.count;
      this.updateOnlineBadge();
      // If on ticket view, refresh readers indicator
      if (this.currentView === 'ticket') {
        this.renderReadingIndicator();
      }
      // If on users/online view, refresh
      if (this.currentView === 'online') {
        const content = document.getElementById('content');
        if (content) this.renderOnlineView(content);
      }
    } catch {}
  },

  updateOnlineBadge() {
    const badge = document.getElementById('online-count-badge');
    if (badge) badge.textContent = this._onlineCount;
  },

  // ========== Header ==========
  renderHeader() {
    const effectiveAvatar = this.user.display_avatar === 'hidden' ? null : (this.user.display_avatar || this.user.photo_url);
    const displayName = this.user.display_name || this.user.first_name;
    const avatarHtml = effectiveAvatar
      ? `<img src="${effectiveAvatar}" class="user-avatar" alt="">`
      : `<div class="user-avatar-placeholder">${(displayName || '?')[0].toUpperCase()}</div>`;

    return `
      <div class="header">
        <div class="header-left">
          <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
          <div class="logo" style="cursor:pointer" data-nav="list">
            <div class="logo-icon">Z</div>
            <span class="logo-text">Zapret Tracker</span>
          </div>
          <nav class="nav" id="main-nav">
            <button class="nav-btn ${this.currentView === 'list' ? 'active' : ''}" data-nav="list">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1.5H2V3zm0 4h12v1.5H2V7zm0 4h12v1.5H2V11z"/></svg>
              Список
            </button>
            <button class="nav-btn ${this.currentView === 'kanban' ? 'active' : ''}" data-nav="kanban">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2h3.5v12h-3.5V2zm5 0h3.5v8h-3.5V2zm5 0h3v10h-3V2z"/></svg>
              Канбан
            </button>
            <button class="nav-btn ${this.currentView === 'archive' ? 'active' : ''}" data-nav="archive">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
              Архив
            </button>
            <button class="nav-btn ${this.currentView === 'resource' ? 'active' : ''}" data-nav="resource">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
              Добавление своих сайтов/игр
            </button>
            <button class="nav-btn ${this.currentView === 'online' ? 'active' : ''}" data-nav="online">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
              <span>Онлайн</span>
              <span class="online-badge" id="online-count-badge">${this._onlineCount}</span>
            </button>
            <button class="nav-btn ${this.currentView === 'users' ? 'active' : ''}" data-nav="users">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Пользователи
            </button>
            <button class="nav-btn ${this.currentView === 'settings' ? 'active' : ''}" data-nav="settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
              Настройки
            </button>
            <button class="nav-btn ${this.currentView === 'about' ? 'active' : ''}" data-nav="about">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              О проекте
            </button>
            ${this.user.is_admin ? `
            <button class="nav-btn admin-nav-btn ${this.currentView === 'admin' ? 'active' : ''}" data-nav="admin">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              Админ-панель
            </button>
            ` : ''}
            <div class="mobile-nav-extra">
              <button class="btn btn-primary" data-mobile-action="new-ticket" style="width:100%">+ Новый тикет</button>
              <div class="user-info" style="padding:8px 0">
                ${avatarHtml}
                <span>${esc(displayName)}</span>
                ${this.user.is_admin ? '<span class="admin-badge">Админ</span>' : ''}
              </div>
              <button class="btn btn-sm" data-mobile-action="logout" style="width:100%;justify-content:center">Выход</button>
            </div>
          </nav>
        </div>
        <div class="header-right">
          <button class="btn btn-primary" id="new-ticket-btn">+ Новый тикет</button>
          <div class="user-info">
            ${avatarHtml}
            <span>${esc(displayName)}</span>
            ${this.user.is_admin ? '<span class="admin-badge">Админ</span>' : ''}
            ${!this.user.has_chat_id && this.config.hasBotToken ? '<span class="admin-badge" style="background:var(--warning);font-size:10px" title="Напишите боту /start для получения уведомлений">Нет уведомлений</span>' : ''}
          </div>
          <button class="btn-icon" id="logout-btn" title="Выход">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9"/></svg>
          </button>
        </div>
      </div>
      <div class="mobile-nav-overlay" id="mobile-nav-overlay"></div>
    `;
  },

  bindHeader() {
    const nav = document.getElementById('main-nav');
    const hamburger = document.getElementById('hamburger-btn');
    const overlay = document.getElementById('mobile-nav-overlay');

    const closeMenu = () => {
      nav?.classList.remove('open');
      hamburger?.classList.remove('open');
      overlay?.classList.remove('open');
    };

    hamburger?.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      overlay?.classList.toggle('open', isOpen);
    });

    overlay?.addEventListener('click', closeMenu);

    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeMenu();
        location.hash = '';
        this.navigate(btn.dataset.nav);
      });
    });

    // Mobile nav extra actions
    document.querySelector('[data-mobile-action="new-ticket"]')?.addEventListener('click', () => {
      closeMenu();
      this.showCreateModal();
    });
    document.querySelector('[data-mobile-action="logout"]')?.addEventListener('click', async () => {
      closeMenu();
      try { await this.api('POST', '/api/auth/logout'); } catch {}
      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
      location.hash = '';
      this.render();
    });

    document.getElementById('new-ticket-btn')?.addEventListener('click', () => this.showCreateModal());
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      try { await this.api('POST', '/api/auth/logout'); } catch {}
      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
      location.hash = '';
      this.render();
    });
  },

  // ========== Navigation ==========
  navigate(view, data) {
    this.currentView = view;
    const content = document.getElementById('content');
    if (!content) return;

    // Cleanup typing poll, message poll, and new-messages badge from previous ticket view
    if (this._typingPollInterval) {
      clearInterval(this._typingPollInterval);
      this._typingPollInterval = null;
    }
    if (this._messagePollInterval) {
      clearInterval(this._messagePollInterval);
      this._messagePollInterval = null;
    }
    document.getElementById('new-messages-badge')?.remove();

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-nav="${view}"]`)?.classList.add('active');

    // Track current ticket for presence
    if (view === 'ticket' && data) {
      this._currentTicketId = data.id || null;
      this._currentTicketTitle = data.title || null;
    } else {
      this._currentTicketId = null;
      this._currentTicketTitle = null;
    }

    switch (view) {
      case 'list': this.renderListView(content); break;
      case 'archive': this.renderArchiveView(content); break;
      case 'kanban': this.renderKanbanView(content); break;
      case 'resource': this.renderResourceRequestView(content); break;
      case 'online': this.renderOnlineView(content); break;
      case 'users': this.renderUsersView(content); break;
      case 'settings': this.renderSettingsView(content); break;
      case 'about': this.renderAboutView(content); break;
      case 'admin': this.renderAdminView(content); break;
      case 'ticket': this.renderTicketView(content, data); break;
      default: this.renderListView(content);
    }

    // Send heartbeat on navigation
    this.sendHeartbeat();
  },

  // ========== Filter Persistence ==========
  _filterKey() {
    return `zt_filters_${this.user?.id || 'anon'}`;
  },
  loadFilters() {
    try {
      const raw = localStorage.getItem(this._filterKey());
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },
  saveFilters(filters) {
    try {
      localStorage.setItem(this._filterKey(), JSON.stringify(filters));
    } catch {}
  },

  // ========== List View ==========
  async renderListView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const saved = this.loadFilters();

    try {
      const params = new URLSearchParams();
      params.set('is_resource_request', '0');
      params.set('exclude_archived', '1');
      if (saved.type) params.set('type', saved.type);
      if (saved.status) params.set('status', saved.status);
      if (saved.priority) params.set('priority', saved.priority);
      if (saved.tag_id) params.set('tag_id', saved.tag_id);
      if (saved.sort) params.set('sort', saved.sort);
      if (saved.search) params.set('search', saved.search);

      const [stats, ticketData] = await Promise.all([
        this.api('GET', '/api/stats'),
        this.api('GET', `/api/tickets?${params}`),
      ]);

      container.innerHTML = `
        ${this.renderStats(stats)}
        ${this.renderToolbar(saved)}
        <div id="ticket-list" class="ticket-list">
          ${saved.group_by ? this.renderGroupedTicketList(ticketData.tickets, saved.group_by) : this.renderTicketList(ticketData.tickets)}
        </div>
        ${ticketData.total > ticketData.limit ? this.renderPagination(ticketData) : ''}
      `;

      this.bindToolbar();
      this.bindTicketList();
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  renderStats(stats) {
    return `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Всего</div></div>
        <div class="stat-card open"><div class="stat-value">${stats.open}</div><div class="stat-label">Открыто</div></div>
        <div class="stat-card progress"><div class="stat-value">${stats.in_progress}</div><div class="stat-label">В работе</div></div>
        <div class="stat-card closed"><div class="stat-value">${stats.closed}</div><div class="stat-label">Закрыто</div></div>
        <div class="stat-card bugs"><div class="stat-value">${stats.bugs}</div><div class="stat-label">Баги</div></div>
        <div class="stat-card ideas"><div class="stat-value">${stats.ideas}</div><div class="stat-label">Идеи</div></div>
        <div class="stat-card"><div class="stat-value">${stats.users}</div><div class="stat-label">Пользователей</div></div>
      </div>
    `;
  },

  renderToolbar(saved = {}) {
    const tagOptions = this.tags.map(t => `<option value="${t.id}" ${saved.tag_id == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const sel = (val, cur) => val === cur ? 'selected' : '';
    return `
      <div class="toolbar">
        <input class="search-input" type="text" placeholder="Поиск тикетов..." id="search-input" value="${esc(saved.search || '')}">
        <select class="filter-select" id="filter-type">
          <option value="">Все типы</option>
          ${this.ticketTypes.map(tt => `<option value="${tt.key}" ${sel(tt.key, saved.type)}>${tt.emoji ? tt.emoji + ' ' : ''}${esc(tt.name)}</option>`).join('')}
        </select>
        <select class="filter-select" id="filter-status">
          <option value="">Все статусы</option>
          <option value="open" ${sel('open', saved.status)}>Открыто</option>
          <option value="in_progress" ${sel('in_progress', saved.status)}>В работе</option>
          <option value="review" ${sel('review', saved.status)}>На ревью</option>
          <option value="testing" ${sel('testing', saved.status)}>Тестирование</option>
        </select>
        <select class="filter-select" id="filter-priority">
          <option value="">Все приоритеты</option>
          <option value="critical" ${sel('critical', saved.priority)}>Критический</option>
          <option value="high" ${sel('high', saved.priority)}>Высокий</option>
          <option value="medium" ${sel('medium', saved.priority)}>Средний</option>
          <option value="low" ${sel('low', saved.priority)}>Низкий</option>
        </select>
        <select class="filter-select" id="filter-tag">
          <option value="">Все теги</option>
          ${tagOptions}
        </select>
      </div>
      <div class="toolbar toolbar-secondary">
        <select class="filter-select" id="filter-sort">
          <option value="" ${sel('', saved.sort)}>Сортировка: по умолчанию</option>
          <option value="newest" ${sel('newest', saved.sort)}>Сначала новые</option>
          <option value="oldest" ${sel('oldest', saved.sort)}>Сначала старые</option>
          <option value="most_voted" ${sel('most_voted', saved.sort)}>По голосам</option>
          <option value="most_commented" ${sel('most_commented', saved.sort)}>По комментариям</option>
          <option value="priority" ${sel('priority', saved.sort)}>По приоритету</option>
          <option value="updated" ${sel('updated', saved.sort)}>По обновлению</option>
        </select>
        <select class="filter-select" id="filter-group">
          <option value="" ${sel('', saved.group_by)}>Группировка: нет</option>
          <option value="status" ${sel('status', saved.group_by)}>По статусу</option>
          <option value="type" ${sel('type', saved.group_by)}>По типу</option>
          <option value="priority" ${sel('priority', saved.group_by)}>По приоритету</option>
        </select>
        <button class="btn btn-sm" id="clear-filters-btn" title="Сбросить фильтры">Сбросить</button>
      </div>
    `;
  },

  bindToolbar() {
    let debounce = null;
    const search = document.getElementById('search-input');
    const filterType = document.getElementById('filter-type');
    const filterStatus = document.getElementById('filter-status');
    const filterPriority = document.getElementById('filter-priority');
    const filterTag = document.getElementById('filter-tag');
    const filterSort = document.getElementById('filter-sort');
    const filterGroup = document.getElementById('filter-group');
    const clearBtn = document.getElementById('clear-filters-btn');

    const getCurrentFilters = () => ({
      search: search?.value || '',
      type: filterType?.value || '',
      status: filterStatus?.value || '',
      priority: filterPriority?.value || '',
      tag_id: filterTag?.value || '',
      sort: filterSort?.value || '',
      group_by: filterGroup?.value || '',
    });

    const doFilter = async () => {
      const filters = getCurrentFilters();
      this.saveFilters(filters);

      const params = new URLSearchParams();
      params.set('is_resource_request', '0');
      params.set('exclude_archived', '1');
      if (filters.search) params.set('search', filters.search);
      if (filters.type) params.set('type', filters.type);
      if (filters.status) params.set('status', filters.status);
      if (filters.priority) params.set('priority', filters.priority);
      if (filters.tag_id) params.set('tag_id', filters.tag_id);
      if (filters.sort) params.set('sort', filters.sort);

      try {
        const data = await this.api('GET', `/api/tickets?${params}`);
        const listEl = document.getElementById('ticket-list');
        if (filters.group_by) {
          listEl.innerHTML = this.renderGroupedTicketList(data.tickets, filters.group_by);
        } else {
          listEl.innerHTML = this.renderTicketList(data.tickets);
        }
        this.bindTicketList();
      } catch (e) {
        this.toast(e.message, 'error');
      }
    };

    search?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(doFilter, 300);
    });

    [filterType, filterStatus, filterPriority, filterTag, filterSort, filterGroup].forEach(el => {
      el?.addEventListener('change', doFilter);
    });

    clearBtn?.addEventListener('click', () => {
      if (search) search.value = '';
      [filterType, filterStatus, filterPriority, filterTag, filterSort, filterGroup].forEach(el => {
        if (el) el.value = '';
      });
      this.saveFilters({});
      doFilter();
    });
  },

  // ========== Archive View ==========
  async renderArchiveView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const params = new URLSearchParams();
      params.set('is_resource_request', '0');
      params.set('only_archived', '1');
      if (this._archiveSearch) params.set('search', this._archiveSearch);
      const data = await this.api('GET', `/api/tickets?${params}`);
      container.innerHTML = `
        <div style="margin-bottom:16px">
          <h2 style="margin-bottom:4px">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
            Архив (${data.total})
          </h2>
          <p style="color:var(--text-muted);font-size:13px">Закрытые, отклонённые и дублированные тикеты. Ответить на них нельзя.</p>
        </div>
        <div class="toolbar" style="margin-bottom:12px">
          <input class="search-input" type="text" placeholder="Поиск в архиве..." id="archive-search-input" value="${esc(this._archiveSearch || '')}">
        </div>
        <div id="ticket-list" class="ticket-list">
          ${this.renderTicketList(data.tickets)}
        </div>
        ${data.total > data.limit ? this.renderPagination(data) : ''}
      `;
      this.bindTicketList();
      let debounce = null;
      document.getElementById('archive-search-input')?.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          this._archiveSearch = e.target.value;
          this.renderArchiveView(container);
        }, 300);
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  renderGroupedTicketList(tickets, groupBy) {
    if (!tickets.length) return this.renderTicketList(tickets);

    const groups = {};
    const typeGroupLabels = {};
    for (const tt of this.ticketTypes) typeGroupLabels[tt.key] = (tt.emoji ? tt.emoji + ' ' : '') + tt.name;
    const groupLabels = {
      status: { open: 'Открыто', in_progress: 'В работе', review: 'На ревью', testing: 'Тестирование', closed: 'Закрыто', rejected: 'Отклонено', duplicate: 'Дубликат' },
      type: typeGroupLabels,
      priority: { critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' },
    };
    const labels = groupLabels[groupBy] || {};

    for (const t of tickets) {
      const key = t[groupBy] || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }

    let html = '';
    for (const [key, items] of Object.entries(groups)) {
      const label = labels[key] || key;
      html += `<div class="ticket-group">
        <div class="ticket-group-header">
          <span class="ticket-group-label">${esc(label)}</span>
          <span class="ticket-group-count">${items.length}</span>
        </div>
        ${this.renderTicketList(items)}
      </div>`;
    }
    return html;
  },

  renderTicketList(tickets) {
    if (!tickets.length) {
      return `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <h3>Тикетов пока нет</h3>
          <p>Создайте первый тикет нажав кнопку "+ Новый тикет"</p>
        </div>
      `;
    }

    return tickets.map(t => {
      const icon = ticketIcon(t, false, this.ticketTypes);
      const colorStyle = t.color ? `border-left: 3px solid ${t.color};` : '';
      const tagsHtml = (t.tags || []).map(tag =>
        `<span class="tag" style="color:${tag.color};border-color:${tag.color}40;background:${tag.color}15">${esc(tag.name)}</span>`
      ).join('');
      const typeInfo = this.ticketTypes.find(tt => tt.key === t.type);
      const typeBadgeHtml = typeInfo
        ? `<span class="type-badge" style="color:${typeInfo.color};border-color:${typeInfo.color}40;background:${typeInfo.color}15">${typeInfo.emoji ? typeInfo.emoji + ' ' : ''}${esc(typeInfo.name)}</span>`
        : `<span class="type-badge">${esc(t.type)}</span>`;

      return `
        <div class="ticket-row" data-id="${t.id}" style="${colorStyle}">
          ${icon}
          <div class="ticket-info">
            <div class="ticket-title-row">
              <span class="ticket-id">#${t.id}</span>
              <span class="ticket-title">${esc(t.title)}</span>
              ${typeBadgeHtml}
              <span class="ticket-tags">${tagsHtml}</span>
            </div>
            <div class="ticket-meta">
              <span>${esc(t.author_first_name || t.author_username || 'Unknown')}</span>
              <span>${timeAgo(t.created_at)}</span>
            </div>
          </div>
          <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
          <span class="priority-badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
          <button class="vote-btn ${t.user_voted ? 'voted' : ''}" data-vote="${t.id}" onclick="event.stopPropagation()" title="Голосовать за тикет">
            <svg class="dolphin-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 4c-.5.5-1.5 1-3 1-1 0-2.5-.5-3.5-1C14 3 12.5 2 10 2 6 2 3 5 2 9c-.5 2 0 4 1 5.5C4 16 5 17 5 19v3h2v-3c0-1.5.5-3 1.5-4C10 14 12 13 14 13c1 0 2-.5 2.5-1 .5-.5 1-1.5 1-2.5 0-.5 0-1-.5-1.5 1-.5 2-1 3-2 .5-.5 1.5-1 2-2z"/><circle cx="7" cy="8" r="1"/></svg>
            ${t.votes_count}
          </button>
          <span class="message-count">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.78 1.78 1 2.75 1h10.5c.97 0 1.75.78 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.72A.75.75 0 015 14.25v-2.25H2.75A1.75 1.75 0 011 10.25v-7.5z"/></svg>
            ${t.message_count || 0}
          </span>
        </div>
      `;
    }).join('');
  },

  bindTicketList() {
    document.querySelectorAll('.ticket-row').forEach(row => {
      row.addEventListener('click', () => {
        location.hash = `ticket-${row.dataset.id}`;
        this.navigate('ticket', { id: row.dataset.id });
      });
    });

    document.querySelectorAll('[data-vote]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.vote;
        try {
          const res = await this.api('POST', `/api/tickets/${id}/vote`);
          btn.classList.toggle('voted', res.voted);
          btn.innerHTML = `<svg class="dolphin-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 4c-.5.5-1.5 1-3 1-1 0-2.5-.5-3.5-1C14 3 12.5 2 10 2 6 2 3 5 2 9c-.5 2 0 4 1 5.5C4 16 5 17 5 19v3h2v-3c0-1.5.5-3 1.5-4C10 14 12 13 14 13c1 0 2-.5 2.5-1 .5-.5 1-1.5 1-2.5 0-.5 0-1-.5-1.5 1-.5 2-1 3-2 .5-.5 1.5-1 2-2z"/><circle cx="7" cy="8" r="1"/></svg> ${res.votes_count}`;
        } catch (e) {
          this.toast(e.message, 'error');
        }
      });
    });
  },

  renderPagination(data) {
    const totalPages = Math.ceil(data.total / data.limit);
    let html = '<div class="pagination">';
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="btn btn-sm ${i === data.page ? 'btn-primary' : ''}" data-page="${i}">${i}</button>`;
    }
    html += '</div>';
    return html;
  },

  // ========== Kanban View ==========
  async renderKanbanView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const data = await this.api('GET', '/api/tickets/kanban');
      const columns = [
        { key: 'open', label: 'Открыто', color: '#3fb950' },
        { key: 'in_progress', label: 'В работе', color: '#d29922' },
        { key: 'review', label: 'На ревью', color: '#8957e5' },
        { key: 'testing', label: 'Тестирование', color: '#58a6ff' },
        { key: 'closed', label: 'Закрыто', color: '#8b949e' },
      ];

      container.innerHTML = `
        <div class="kanban-board">
          ${columns.map(col => `
            <div class="kanban-column" data-status="${col.key}">
              <div class="kanban-column-header">
                <span style="color:${col.color}">${col.label}</span>
                <span class="kanban-count">${(data[col.key] || []).length}</span>
              </div>
              <div class="kanban-cards">
                ${(data[col.key] || []).map(t => this.renderKanbanCard(t)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;

      document.querySelectorAll('.kanban-card').forEach(card => {
        card.addEventListener('click', () => {
          location.hash = `ticket-${card.dataset.id}`;
          this.navigate('ticket', { id: card.dataset.id });
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  renderKanbanCard(t) {
    const iconSmall = ticketIcon(t, true, this.ticketTypes);
    const colorStyle = t.color ? `border-left: 3px solid ${t.color};` : '';
    const tagsHtml = (t.tags || []).slice(0, 3).map(tag =>
      `<span class="tag" style="color:${tag.color};border-color:${tag.color}40;background:${tag.color}15">${esc(tag.name)}</span>`
    ).join('');

    return `
      <div class="kanban-card" data-id="${t.id}" style="${colorStyle}">
        <div class="kanban-card-title">
          ${iconSmall}
          <span>${esc(t.title)}</span>
        </div>
        <div class="ticket-tags" style="margin-bottom:6px">${tagsHtml}</div>
        <div class="kanban-card-meta">
          <span>#${t.id} ${esc(t.author_first_name || '')}</span>
          <span class="priority-badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
        </div>
        <div class="kanban-card-footer">
          <span class="vote-btn ${t.user_voted ? 'voted' : ''}" style="font-size:11px;padding:2px 6px" title="Голосовать за тикет"><svg class="dolphin-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 4c-.5.5-1.5 1-3 1-1 0-2.5-.5-3.5-1C14 3 12.5 2 10 2 6 2 3 5 2 9c-.5 2 0 4 1 5.5C4 16 5 17 5 19v3h2v-3c0-1.5.5-3 1.5-4C10 14 12 13 14 13c1 0 2-.5 2.5-1 .5-.5 1-1.5 1-2.5 0-.5 0-1-.5-1.5 1-.5 2-1 3-2 .5-.5 1.5-1 2-2z"/><circle cx="7" cy="8" r="1"/></svg> ${t.votes_count}</span>
          <span class="message-count" style="font-size:11px">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.78 1.78 1 2.75 1h10.5c.97 0 1.75.78 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.72A.75.75 0 015 14.25v-2.25H2.75A1.75 1.75 0 011 10.25v-7.5z"/></svg>
            ${t.message_count || 0}
          </span>
        </div>
      </div>
    `;
  },

  // ========== Resource Request View ==========
  async renderResourceRequestView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const rrData = await this.api('GET', '/api/tickets?is_resource_request=1');

      container.innerHTML = `
        <div class="resource-view">
          <div class="resource-view-tabs">
            <button class="view-tab active" data-rr-tab="list">Все запросы (${rrData.total})</button>
            <button class="view-tab" data-rr-tab="choose">+ Новый запрос</button>
          </div>

          <div id="rr-tab-list" class="rr-tab-content">
            <div class="toolbar" style="margin-bottom:12px">
              <input class="search-input" type="text" placeholder="Поиск сайтов/игр..." id="rr-search-input">
              <select class="filter-select" id="rr-filter-status">
                <option value="">Все статусы</option>
                <option value="open">Открыто</option>
                <option value="in_progress">В работе</option>
                <option value="closed">Закрыто</option>
                <option value="rejected">Отклонено</option>
              </select>
            </div>
            <div id="rr-ticket-list" class="ticket-list">
              ${this.renderTicketList(rrData.tickets)}
            </div>
          </div>

          <!-- Type selection step -->
          <div id="rr-tab-choose" class="rr-tab-content" style="display:none">
            <div class="request-type-chooser">
              <h2 style="font-size:20px;margin-bottom:6px;text-align:center">Какой тип запроса вы хотите создать?</h2>
              <p style="color:var(--text-muted);text-align:center;margin-bottom:24px;font-size:14px;line-height:1.6">
                Выберите тип в зависимости от причины, по которой сайт или сервис недоступен из России.
              </p>
              <div class="request-type-cards">
                <div class="request-type-card" id="choose-category">
                  <div class="request-type-icon" style="background:rgba(77,163,255,.15);color:#4da3ff">&#128230;</div>
                  <h3>Категория для Zapret GUI</h3>
                  <p class="request-type-desc">Сайт/игра <strong>заблокированы Роскомнадзором</strong> (DPI-блокировка). Для обхода нужны файлы ipset/hostlist, протокол и порты.</p>
                  <div class="request-type-example">
                    <span style="font-weight:600">Примеры:</span> Discord, YouTube, Instagram, игры заблокированные в РФ
                  </div>
                  <div class="request-type-tag" style="background:rgba(77,163,255,.15);color:#4da3ff">Блокировка РКН</div>
                </div>
                <div class="request-type-card" id="choose-geo">
                  <div class="request-type-icon" style="background:rgba(245,158,11,.15);color:#f59e0b">&#127760;</div>
                  <h3>Гео-ограничение</h3>
                  <p class="request-type-desc"><strong>Сам сайт или сервис блокирует</strong> доступ для пользователей из России (санкции, гео-блокировка со стороны сервиса). РКН тут ни при чём.</p>
                  <div class="request-type-example">
                    <span style="font-weight:600">Примеры:</span> ChatGPT, Notion, Figma, Adobe, сервисы ушедшие из РФ
                  </div>
                  <div class="request-type-tag" style="background:rgba(245,158,11,.15);color:#f59e0b">Гео-блокировка</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Category form (existing) -->
          <div id="rr-tab-form" class="rr-tab-content" style="display:none">
            <div class="ticket-detail" style="max-width:820px;margin:0">
              <div class="ticket-content">
                <button class="btn" id="rr-back-to-choose" style="margin-bottom:16px">&larr; Назад к выбору типа</button>
                <h2 style="font-size:22px;margin-bottom:8px">Добавление категории для Zapret GUI</h2>
                <p style="color:var(--text-muted);margin-bottom:4px">
                  Для сайтов/игр, заблокированных Роскомнадзором (DPI). Обязательно укажите протокол, порты и прикрепите файлы (ipset/hostlist).
                </p>
                <div class="info-box info-box-blue" style="margin-bottom:16px">
                  <strong>Что это?</strong> Сайт заблокирован на уровне провайдера по решению РКН. Для обхода Zapret использует DPI-обход, для чего нужны технические данные: протокол, порты и файлы с доменами/IP.
                </div>

                <div class="form-group">
                  <a class="btn" href="https://publish.obsidian.md/zapret/Zapret/%D0%A1%D0%BE%D0%B7%D0%B4%D0%B0%D0%BD%D0%B8%D0%B5+%D1%81%D0%B2%D0%BE%D0%B5%D0%B9+%D0%BA%D0%B0%D1%82%D0%B5%D0%B3%D0%BE%D1%80%D0%B8%D0%B8" target="_blank" rel="noopener noreferrer">
                    Инструкция по созданию категории
                  </a>
                </div>

                <div class="form-group">
                  <label>Название сайта/игры *</label>
                  <input class="form-input" id="rr-name" placeholder="Например: Roblox">
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Протокол *</label>
                    <select class="form-select" id="rr-protocol">
                      <option value="">Выберите протокол</option>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                      <option value="tcp,udp">TCP + UDP</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Порты *</label>
                    <input class="form-input" id="rr-ports" placeholder="443 или 40000-65535 или 443,444,3000-3010">
                  </div>
                </div>

                <div class="form-group">
                  <label>Описание запроса</label>
                  <textarea class="form-textarea" id="rr-message" placeholder="Опишите проверку, что уже тестировали, замечания..."></textarea>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Можно вставлять картинки через Ctrl+V</div>
                </div>

                <div class="form-group">
                  <label>Файлы (обязательно) *</label>
                  <input type="file" id="rr-files" multiple>
                  <div class="file-preview-list" id="rr-file-preview"></div>
                </div>

                <div class="form-group">
                  <label class="form-checkbox">
                    <input type="checkbox" id="rr-private">
                    Приватный запрос (видит только админ и вы)
                  </label>
                </div>

                <div style="display:flex;gap:8px;align-items:center">
                  <button class="btn btn-primary" id="rr-submit">Отправить запрос</button>
                  <span style="font-size:12px;color:var(--text-muted)">Без файлов и валидных портов отправка запрещена</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Geo-restriction form (new) -->
          <div id="rr-tab-geo" class="rr-tab-content" style="display:none">
            <div class="ticket-detail" style="max-width:820px;margin:0">
              <div class="ticket-content">
                <button class="btn" id="geo-back-to-choose" style="margin-bottom:16px">&larr; Назад к выбору типа</button>
                <h2 style="font-size:22px;margin-bottom:8px">Добавление сайта с гео-ограничением</h2>
                <p style="color:var(--text-muted);margin-bottom:4px">
                  Для сайтов/сервисов, которые сами ограничивают доступ для пользователей из России.
                </p>
                <div class="info-box info-box-amber" style="margin-bottom:16px">
                  <strong>Что это?</strong> Сам сайт или сервис блокирует пользователей из России (из-за санкций или по собственному решению). Провайдер и РКН тут ни при чём &mdash; блокировка происходит на стороне самого сервиса. Для обхода достаточно указать домены/субдомены.
                </div>

                <div class="form-group">
                  <label>Название сайта/сервиса *</label>
                  <input class="form-input" id="geo-name" placeholder="Например: ChatGPT, Adobe, Figma">
                </div>

                <div class="form-group">
                  <label>URL сайта/сервиса *</label>
                  <input class="form-input" id="geo-url" placeholder="Например: https://chat.openai.com">
                </div>

                <div class="form-group">
                  <label>Субдомены *</label>
                  <textarea class="form-textarea" id="geo-subdomains" rows="3" placeholder="Перечислите субдомены через запятую или с новой строки, например:&#10;chat.openai.com&#10;api.openai.com&#10;auth.openai.com"></textarea>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Укажите все домены и субдомены, к которым нужен доступ</div>
                </div>

                <div class="form-group">
                  <label>Описание (необязательно)</label>
                  <textarea class="form-textarea" id="geo-message" placeholder="Дополнительная информация, как именно сервис блокирует доступ, что пробовали..."></textarea>
                </div>

                <div class="form-group">
                  <label class="form-checkbox">
                    <input type="checkbox" id="geo-private">
                    Приватный запрос (видит только админ и вы)
                  </label>
                </div>

                <div style="display:flex;gap:8px;align-items:center">
                  <button class="btn btn-primary" id="geo-submit">Отправить запрос</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Tab switching (list / choose)
      const showTab = (tabName) => {
        document.querySelectorAll('[data-rr-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-rr-tab="${tabName}"]`)?.classList.add('active');
        ['list', 'choose', 'form', 'geo'].forEach(t => {
          const el = document.getElementById(`rr-tab-${t}`);
          if (el) el.style.display = t === tabName ? '' : 'none';
        });
      };

      document.querySelectorAll('[data-rr-tab]').forEach(tab => {
        tab.addEventListener('click', () => showTab(tab.dataset.rrTab));
      });

      // Type selection cards
      document.getElementById('choose-category')?.addEventListener('click', () => showTab('form'));
      document.getElementById('choose-geo')?.addEventListener('click', () => showTab('geo'));

      // Back buttons
      document.getElementById('rr-back-to-choose')?.addEventListener('click', () => showTab('choose'));
      document.getElementById('geo-back-to-choose')?.addEventListener('click', () => showTab('choose'));

      // Resource request list filtering
      let rrDebounce = null;
      const rrSearch = document.getElementById('rr-search-input');
      const rrFilterStatus = document.getElementById('rr-filter-status');

      const doRrFilter = async () => {
        const params = new URLSearchParams();
        params.set('is_resource_request', '1');
        if (rrSearch.value) params.set('search', rrSearch.value);
        if (rrFilterStatus.value) params.set('status', rrFilterStatus.value);

        try {
          const data = await this.api('GET', `/api/tickets?${params}`);
          document.getElementById('rr-ticket-list').innerHTML = this.renderTicketList(data.tickets);
          this.bindTicketList();
        } catch (e) { this.toast(e.message, 'error'); }
      };

      rrSearch?.addEventListener('input', () => {
        clearTimeout(rrDebounce);
        rrDebounce = setTimeout(doRrFilter, 300);
      });
      rrFilterStatus?.addEventListener('change', doRrFilter);

      this.bindTicketList();
      this.bindResourceRequestForm();
      this.bindGeoRequestForm();
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  bindResourceRequestForm() {
    const rrFiles = [];
    const renderRrFiles = () => {
      const box = document.getElementById('rr-file-preview');
      if (!box) return;
      box.innerHTML = rrFiles.map((f, i) => `
        <div class="file-preview-item">
          <span>${esc(getAttachmentName(f, i))}</span>
          <span>(${formatSize(f.size || 0)})</span>
          <span class="remove-file" data-i="${i}">&times;</span>
        </div>
      `).join('');
      box.querySelectorAll('.remove-file').forEach(x => x.addEventListener('click', () => {
        rrFiles.splice(Number(x.dataset.i), 1);
        renderRrFiles();
      }));
    };

    const filesInput = document.getElementById('rr-files');
    filesInput?.addEventListener('change', (e) => {
      const accepted = filterOversizedFiles(Array.from(e.target.files), (msg, type) => this.toast(msg, type));
      for (const f of accepted) rrFiles.push(f);
      e.target.value = '';
      renderRrFiles();
    });

    // Paste images from clipboard (multiple)
    const msgArea = document.getElementById('rr-message');
    msgArea?.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgs = items.filter(i => i.type.startsWith('image/'));
      if (imgs.length === 0) return;
      e.preventDefault();
      const ts = Date.now();
      let idx = 0;
      const pastedFiles = [];
      for (const item of imgs) {
        const blob = item.getAsFile();
        if (!blob) continue;
        pastedFiles.push(makePastedImageFile(blob, ts, idx++));
      }
      const accepted = filterOversizedFiles(pastedFiles, (msg, type) => this.toast(msg, type));
      for (const f of accepted) rrFiles.push(f);
      renderRrFiles();
      if (accepted.length > 0) this.toast(`Добавлено изображений: ${accepted.length}`, 'success');
    });

    document.getElementById('rr-submit')?.addEventListener('click', async () => {
      const resource_name = document.getElementById('rr-name').value.trim();
      const protocol = document.getElementById('rr-protocol').value;
      const ports = document.getElementById('rr-ports').value.trim();
      const message = document.getElementById('rr-message').value.trim();
      const is_private = document.getElementById('rr-private').checked;

      if (!resource_name) return this.toast('Укажите название сайта/игры', 'error');
      if (!protocol) return this.toast('Укажите протокол', 'error');
      if (!isValidPortsInput(ports)) return this.toast('Неверный формат портов', 'error');
      if (rrFiles.length === 0) return this.toast('Нужно прикрепить хотя бы один файл', 'error');

      const btn = document.getElementById('rr-submit');
      btn.disabled = true;
      btn.textContent = 'Отправка...';

      try {
        const fd = new FormData();
        fd.append('resource_name', resource_name);
        fd.append('protocol', protocol);
        fd.append('ports', ports);
        fd.append('message', message);
        fd.append('is_private', is_private ? '1' : '0');
        rrFiles.forEach((f, i) => {
          fd.append('files', f, getAttachmentName(f, i));
        });

        const ticket = await this.api('POST', '/api/resource-requests', fd, true);
        this.toast('Запрос отправлен', 'success');
        location.hash = `ticket-${ticket.id}`;
        this.navigate('ticket', { id: ticket.id });
      } catch (e) {
        this.toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Отправить запрос';
      }
    });
  },

  bindGeoRequestForm() {
    document.getElementById('geo-submit')?.addEventListener('click', async () => {
      const resource_name = document.getElementById('geo-name').value.trim();
      const geo_url = document.getElementById('geo-url').value.trim();
      const geo_subdomains = document.getElementById('geo-subdomains').value.trim();
      const message = document.getElementById('geo-message').value.trim();
      const is_private = document.getElementById('geo-private').checked;

      if (!resource_name) return this.toast('Укажите название сайта/сервиса', 'error');
      if (!geo_url) return this.toast('Укажите URL сайта/сервиса', 'error');
      if (!geo_subdomains) return this.toast('Укажите субдомены', 'error');

      const btn = document.getElementById('geo-submit');
      btn.disabled = true;
      btn.textContent = 'Отправка...';

      try {
        const fd = new FormData();
        fd.append('resource_name', resource_name);
        fd.append('geo_url', geo_url);
        fd.append('geo_subdomains', geo_subdomains);
        fd.append('message', message);
        fd.append('is_private', is_private ? '1' : '0');

        const ticket = await this.api('POST', '/api/geo-requests', fd, true);
        this.toast('Запрос отправлен', 'success');
        location.hash = `ticket-${ticket.id}`;
        this.navigate('ticket', { id: ticket.id });
      } catch (e) {
        this.toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Отправить запрос';
      }
    });
  },

  // ========== Ticket Detail View ==========
  async renderTicketView(container, { id }) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const ticket = await this.api('GET', `/api/tickets/${id}`);
      // Update presence with ticket info
      this._currentTicketId = ticket.id;
      this._currentTicketTitle = ticket.title;
      this.sendHeartbeat();
      this.pollPresence();

      container.innerHTML = this.renderTicketDetail(ticket);
      this.bindTicketDetail(ticket);
      this.renderReadingIndicator(ticket.id);
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  renderTicketDetail(t) {
    const typeLabels = this.getTypeLabels();
    const tagsHtml = (t.tags || []).map(tag =>
      `<span class="tag" style="color:${tag.color};border-color:${tag.color}40;background:${tag.color}15">${esc(tag.name)}</span>`
    ).join('');

    const attachmentsHtml = (t.attachments || []).map(a => {
      if (isImageAttachment(a)) {
        return `<div class="attachment-preview lightbox-trigger" data-src="/uploads/${a.filename}" data-alt="${esc(a.original_name)}" style="background-image:url('/uploads/${a.filename}')"></div>`;
      }
      return `<a href="/uploads/${a.filename}" target="_blank" rel="noopener noreferrer" class="attachment">&#128206; ${esc(a.original_name)}</a>`;
    }).join('');

    const canEdit = this.user.is_admin || t.author_id === this.user.id;

    const statusOptions = ['open', 'in_progress', 'review', 'testing', 'closed', 'rejected', 'duplicate']
      .map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('');

    const priorityOptions = ['low', 'medium', 'high', 'critical']
      .map(p => `<option value="${p}" ${p === t.priority ? 'selected' : ''}>${priorityLabel(p)}</option>`).join('');

    return `
      <div class="ticket-detail">
        <button class="back-btn" id="back-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"/></svg>
          Назад к списку
        </button>

        <div class="ticket-header">
          <h1>
            ${ticketIcon(t, false, this.ticketTypes)}
            <span id="ticket-title-text">${esc(t.title)}</span>
            ${canEdit ? '<button class="btn-icon" id="edit-title-btn" title="Редактировать" style="font-size:14px;margin-left:4px;opacity:.5">&#9998;</button>' : ''}
          </h1>
          <div class="ticket-header-meta">
            <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
            <span class="priority-badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
            <span>${(() => { const ti = this.ticketTypes.find(tt => tt.key === t.type); return ti ? (ti.emoji ? ti.emoji + ' ' : '') + esc(ti.name) : (typeLabels[t.type] || t.type); })()}</span>
            <span>Создан ${timeAgo(t.created_at)}</span>
            <span>от ${esc(t.author_first_name || t.author_username || 'Unknown')}</span>
            <button class="vote-btn ${t.user_voted ? 'voted' : ''}" id="vote-btn" title="Голосовать за тикет"><svg class="dolphin-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 4c-.5.5-1.5 1-3 1-1 0-2.5-.5-3.5-1C14 3 12.5 2 10 2 6 2 3 5 2 9c-.5 2 0 4 1 5.5C4 16 5 17 5 19v3h2v-3c0-1.5.5-3 1.5-4C10 14 12 13 14 13c1 0 2-.5 2.5-1 .5-.5 1-1.5 1-2.5 0-.5 0-1-.5-1.5 1-.5 2-1 3-2 .5-.5 1.5-1 2-2z"/><circle cx="7" cy="8" r="1"/></svg> ${t.votes_count}</button>
            ${tagsHtml}
          </div>
        </div>

        <div class="ticket-body">
          <div>
            <div class="ticket-content">
              <div class="ticket-description-wrap">
                <div class="message-avatar">
                  ${t.author_photo
                    ? `<img src="${t.author_photo}" class="user-avatar" alt="">`
                    : `<div class="user-avatar-placeholder">${(t.author_first_name || '?')[0].toUpperCase()}</div>`}
                </div>
                <div class="ticket-description-body">
                  <div class="ticket-description-author">
                    <span class="message-author">${esc(t.author_first_name || t.author_username || 'Unknown')}</span>
                    <span class="message-date">${timeAgo(t.created_at)}</span>
                  </div>
                  <div class="ticket-description">${t.description ? esc(t.description) : '<span style="color:var(--text-muted)">Нет описания</span>'}</div>
                  ${attachmentsHtml ? `<div class="ticket-attachments">${attachmentsHtml}</div>` : ''}
                </div>
              </div>
            </div>

            <div class="messages-section">
              <h2>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.78 1.78 1 2.75 1h10.5c.97 0 1.75.78 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.72A.75.75 0 015 14.25v-2.25H2.75A1.75 1.75 0 011 10.25v-7.5z"/></svg>
                Обсуждение (<span id="discussion-count">${(t.messages || []).filter(m => !m.is_system).length}</span>)
                <span class="reading-indicator" id="reading-indicator" style="display:none"></span>
              </h2>
              <div class="messages-list" id="messages-list">
                ${(t.messages || []).map(m => this.renderMessage(m)).join('')}
              </div>

              <div class="typing-indicator" id="typing-indicator" style="display:none"></div>

              ${['closed', 'rejected', 'duplicate'].includes(t.status) ? `
              <div class="message-form-closed" style="text-align:center;padding:20px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius-lg);margin-top:8px">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                Тикет закрыт — отправка сообщений недоступна
              </div>
              ` : `
              <div class="message-form" id="message-form">
                <textarea class="message-textarea" id="message-input" placeholder="Написать сообщение... (Ctrl+Enter для отправки)"></textarea>
                <div class="file-preview-list" id="file-preview-list"></div>
                <div class="message-form-footer">
                  <div>
                    <input type="file" id="file-input" multiple hidden accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z,.log,.conf,.json,.xml,.csv,.mp4,.webm">
                    <button class="file-upload-btn" id="attach-btn">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                      Прикрепить файл
                    </button>
                  </div>
                  <button class="btn btn-primary" id="send-message-btn">Отправить</button>
                </div>
              </div>
              `}
            </div>
          </div>

          <div class="ticket-sidebar">
            <div class="sidebar-section">
              <h3>Подписка</h3>
              <button class="btn ${t.user_subscribed ? 'btn-primary' : ''}" id="subscribe-btn" style="width:100%">
                ${t.user_subscribed ? '&#128276; Вы подписаны' : '&#128277; Подписаться'}
              </button>
              <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
                ${t.user_subscribed
                  ? 'Вы получаете уведомления о новых сообщениях в этом тикете'
                  : 'Подпишитесь чтобы получать уведомления в Telegram'}
              </p>
            </div>

            ${this.user.is_admin ? `
              <div class="sidebar-section">
                <h3>Управление</h3>
                <div class="sidebar-field">
                  <label>Статус</label>
                  <select class="sidebar-select" id="change-status">${statusOptions}</select>
                </div>
                <div class="sidebar-field">
                  <label>Приоритет</label>
                  <select class="sidebar-select" id="change-priority">${priorityOptions}</select>
                </div>
                <div class="sidebar-field" style="margin-top:12px">
                  <label class="form-checkbox">
                    <input type="checkbox" id="change-private" ${t.is_private ? 'checked' : ''}>
                    Приватный
                  </label>
                </div>
              </div>
            ` : ''}

            <div class="sidebar-section">
              <h3>Информация</h3>
              <div class="sidebar-field"><label>ID</label><span>#${t.id}</span></div>
              <div class="sidebar-field"><label>Тип</label><span>${(() => { const ti = this.ticketTypes.find(tt => tt.key === t.type); return ti ? (ti.emoji ? ti.emoji + ' ' : '') + esc(ti.name) : (typeLabels[t.type] || t.type); })()}</span></div>
              <div class="sidebar-field"><label>Автор</label><span>${esc(t.author_first_name || t.author_username)}</span></div>
              <div class="sidebar-field"><label>Создан</label><span>${formatDate(t.created_at)}</span></div>
              <div class="sidebar-field"><label>Обновлён</label><span>${formatDate(t.updated_at)}</span></div>
              ${t.closed_at ? `<div class="sidebar-field"><label>Закрыт</label><span>${formatDate(t.closed_at)}</span></div>` : ''}
              <div class="sidebar-field"><label>Голоса</label><span>${t.votes_count}</span></div>
            </div>

            ${canEdit ? `
              <div class="sidebar-section">
                <h3>Оформление</h3>
                <div class="sidebar-field">
                  <label>Эмодзи</label>
                  <button class="btn btn-sm" id="change-emoji-btn" style="font-size:18px;min-width:40px">${t.emoji || '+'}</button>
                </div>
                <div class="sidebar-field">
                  <label>Цвет</label>
                  <input type="color" id="change-color" value="${t.color || '#0074e8'}" style="width:36px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-tertiary);cursor:pointer;padding:2px">
                  ${t.color ? '<button class="btn-icon" id="clear-color-btn" title="Убрать цвет" style="font-size:13px;color:var(--danger)">&times;</button>' : ''}
                </div>
              </div>
              <div class="sidebar-section">
                <button class="btn btn-danger" id="delete-ticket-btn" style="width:100%">Удалить тикет</button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  bindTicketDetail(ticket) {
    const selectedFiles = [];

    document.getElementById('back-btn').addEventListener('click', () => {
      location.hash = '';
      this.navigate('list');
    });

    // Vote
    document.getElementById('vote-btn').addEventListener('click', async () => {
      try {
        const res = await this.api('POST', `/api/tickets/${ticket.id}/vote`);
        const btn = document.getElementById('vote-btn');
        btn.classList.toggle('voted', res.voted);
        btn.innerHTML = `<svg class="dolphin-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 4c-.5.5-1.5 1-3 1-1 0-2.5-.5-3.5-1C14 3 12.5 2 10 2 6 2 3 5 2 9c-.5 2 0 4 1 5.5C4 16 5 17 5 19v3h2v-3c0-1.5.5-3 1.5-4C10 14 12 13 14 13c1 0 2-.5 2.5-1 .5-.5 1-1.5 1-2.5 0-.5 0-1-.5-1.5 1-.5 2-1 3-2 .5-.5 1.5-1 2-2z"/><circle cx="7" cy="8" r="1"/></svg> ${res.votes_count}`;
      } catch (e) { this.toast(e.message, 'error'); }
    });

    // Subscribe/Unsubscribe
    document.getElementById('subscribe-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('subscribe-btn');
      const isSubscribed = btn.classList.contains('btn-primary');

      try {
        if (isSubscribed) {
          await this.api('POST', `/api/tickets/${ticket.id}/unsubscribe`);
          btn.classList.remove('btn-primary');
          btn.innerHTML = '&#128277; Подписаться';
          btn.nextElementSibling.textContent = 'Подпишитесь чтобы получать уведомления в Telegram';
          this.toast('Вы отписались от тикета', 'info');
        } else {
          await this.api('POST', `/api/tickets/${ticket.id}/subscribe`);
          btn.classList.add('btn-primary');
          btn.innerHTML = '&#128276; Вы подписаны';
          btn.nextElementSibling.textContent = 'Вы получаете уведомления о новых сообщениях в этом тикете';
          this.toast('Вы подписались на тикет', 'success');
        }
      } catch (e) { this.toast(e.message, 'error'); }
    });

    // Admin controls
    if (this.user.is_admin) {
      document.getElementById('change-status')?.addEventListener('change', async (e) => {
        try {
          await this.api('PUT', `/api/tickets/${ticket.id}`, { status: e.target.value });
          this.toast('Статус обновлён', 'success');
          this.navigate('ticket', { id: ticket.id });
        } catch (e) { this.toast(e.message, 'error'); }
      });

      document.getElementById('change-priority')?.addEventListener('change', async (e) => {
        try {
          await this.api('PUT', `/api/tickets/${ticket.id}`, { priority: e.target.value });
          this.toast('Приоритет обновлён', 'success');
        } catch (e) { this.toast(e.message, 'error'); }
      });

      document.getElementById('change-private')?.addEventListener('change', async (e) => {
        try {
          await this.api('PUT', `/api/tickets/${ticket.id}`, { is_private: e.target.checked ? 1 : 0 });
          this.toast('Видимость обновлена', 'success');
        } catch (e) { this.toast(e.message, 'error'); }
      });
    }

    // Delete
    document.getElementById('delete-ticket-btn')?.addEventListener('click', async () => {
      if (!confirm('Удалить этот тикет? Это действие необратимо.')) return;
      try {
        await this.api('DELETE', `/api/tickets/${ticket.id}`);
        this.toast('Тикет удалён', 'success');
        location.hash = '';
        this.navigate('list');
      } catch (e) { this.toast(e.message, 'error'); }
    });

    // Edit title inline
    document.getElementById('edit-title-btn')?.addEventListener('click', () => {
      const titleEl = document.getElementById('ticket-title-text');
      const current = ticket.title;
      const input = document.createElement('input');
      input.className = 'form-input';
      input.value = current;
      input.style.cssText = 'font-size:22px;font-weight:700;padding:4px 8px;flex:1';
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      document.getElementById('edit-title-btn').style.display = 'none';

      const save = async () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== current) {
          try {
            await this.api('PUT', `/api/tickets/${ticket.id}`, { title: newTitle });
            this.toast('Заголовок обновлён', 'success');
            this.navigate('ticket', { id: ticket.id });
          } catch (e) { this.toast(e.message, 'error'); }
        } else {
          this.navigate('ticket', { id: ticket.id });
        }
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') this.navigate('ticket', { id: ticket.id }); });
    });

    // Emoji picker
    document.getElementById('change-emoji-btn')?.addEventListener('click', () => {
      this.showEmojiPicker(async (emoji) => {
        try {
          await this.api('PUT', `/api/tickets/${ticket.id}`, { emoji });
          this.toast('Эмодзи обновлён', 'success');
          this.navigate('ticket', { id: ticket.id });
        } catch (e) { this.toast(e.message, 'error'); }
      });
    });

    // Color picker
    let colorDebounce = null;
    document.getElementById('change-color')?.addEventListener('input', (e) => {
      clearTimeout(colorDebounce);
      colorDebounce = setTimeout(async () => {
        try {
          await this.api('PUT', `/api/tickets/${ticket.id}`, { color: e.target.value });
          this.toast('Цвет обновлён', 'success');
        } catch (e2) { this.toast(e2.message, 'error'); }
      }, 500);
    });

    document.getElementById('clear-color-btn')?.addEventListener('click', async () => {
      try {
        await this.api('PUT', `/api/tickets/${ticket.id}`, { color: '' });
        this.toast('Цвет убран', 'success');
        this.navigate('ticket', { id: ticket.id });
      } catch (e) { this.toast(e.message, 'error'); }
    });

    // File attach & message form (only if ticket is not archived)
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-message-btn');

    // Typing indicator polling for this ticket
    this._typingPollInterval = setInterval(async () => {
      try {
        const data = await this.api('GET', `/api/presence/typing/${ticket.id}`);
        this.renderTypingIndicator(data.typing);
      } catch {}
    }, 2000);
    this.api('GET', `/api/presence/typing/${ticket.id}`)
      .then(data => this.renderTypingIndicator(data.typing))
      .catch(() => {});

    // Live message polling — auto-fetch new messages every 5s
    const allMsgEls = document.querySelectorAll('.message[data-msg-id]');
    let lastMsgId = 0;
    allMsgEls.forEach(el => {
      const id = parseInt(el.dataset.msgId);
      if (id > lastMsgId) lastMsgId = id;
    });
    this._messagePollInterval = setInterval(async () => {
      try {
        const data = await this.api('GET', `/api/tickets/${ticket.id}/messages/poll?after=${lastMsgId}`);
        if (data.messages && data.messages.length > 0) {
          const list = document.getElementById('messages-list');
          if (!list) return;
          let addedNonSystem = 0;
          for (const msg of data.messages) {
            // Skip if already rendered
            if (document.querySelector(`.message[data-msg-id="${msg.id}"]`)) continue;
            list.insertAdjacentHTML('beforeend', this.renderMessage(msg));
            if (!msg.is_system) addedNonSystem++;
            if (msg.id > lastMsgId) lastMsgId = msg.id;
          }

          if (addedNonSystem > 0) {
            const countEl = document.getElementById('discussion-count');
            if (countEl) {
              const cur = parseInt(countEl.textContent) || 0;
              countEl.textContent = cur + addedNonSystem;
            }
          }
          this.bindMessageActions(ticket);
          // Auto-scroll only if user is near bottom (reading latest messages)
          const docEl = document.documentElement;
          const distanceFromBottom = docEl.scrollHeight - docEl.scrollTop - docEl.clientHeight;
          if (distanceFromBottom < 300) {
            list.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
          } else if (addedNonSystem > 0) {
            // User is reading history — show a non-intrusive "new messages" badge
            this.showNewMessagesBadge(list);
          }
        }
      } catch {}
    }, 5000);

    if (attachBtn && fileInput && messageInput && sendBtn) {
      // Send typing event on keystroke (throttled)
      let typingThrottle = null;
      messageInput.addEventListener('input', () => {
        if (typingThrottle) return;
        typingThrottle = setTimeout(() => { typingThrottle = null; }, 2500);
        this.api('POST', '/api/presence/typing', { ticketId: ticket.id }).catch(() => {});
      });

      attachBtn.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        const accepted = filterOversizedFiles(Array.from(e.target.files), (msg, type) => this.toast(msg, type));
        for (const file of accepted) {
          selectedFiles.push(file);
        }
        this.renderFilePreview(selectedFiles);
        e.target.value = '';
      });

      // Paste images from clipboard (Ctrl+V), supports multiple
      messageInput.addEventListener('paste', (e) => {
        const items = Array.from(e.clipboardData?.items || []);
        const images = items.filter(i => i.type.startsWith('image/'));
        if (images.length === 0) return;

        e.preventDefault();
        const ts = Date.now();
        let idx = 0;
        const pastedFiles = [];
        for (const item of images) {
          const blob = item.getAsFile();
          if (!blob) continue;
          pastedFiles.push(makePastedImageFile(blob, ts, idx++));
        }
        const accepted = filterOversizedFiles(pastedFiles, (msg, type) => this.toast(msg, type));
        for (const f of accepted) selectedFiles.push(f);
        this.renderFilePreview(selectedFiles);
        if (accepted.length > 0) this.toast(`Добавлено изображений: ${accepted.length}`, 'success');
      });

      // Send message
      sendBtn.addEventListener('click', async () => {
        const content = messageInput.value.trim();
        if (!content && selectedFiles.length === 0) return;

        sendBtn.disabled = true;
        sendBtn.textContent = 'Отправка...';

        const formData = new FormData();
        formData.append('content', content);
        selectedFiles.forEach((file, i) => {
          formData.append('files', file, getAttachmentName(file, i));
        });

        try {
          const msg = await this.api('POST', `/api/tickets/${ticket.id}/messages`, formData, true);
          messageInput.value = '';
          selectedFiles.length = 0;
          this.renderFilePreview(selectedFiles);

          const list = document.getElementById('messages-list');
          list.insertAdjacentHTML('beforeend', this.renderMessage(msg));
          list.lastElementChild.scrollIntoView({ behavior: 'smooth' });
          this.bindMessageActions(ticket);
          this.toast('Сообщение отправлено', 'success');
        } catch (e) {
          this.toast(e.message, 'error');
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Отправить';
        }
      });

      // Ctrl+Enter to send
      messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) sendBtn.click();
      });
    }

    // Message edit/delete actions
    this.bindMessageActions(ticket);
  },

  bindMessageActions(ticket) {
    // Bind reactions (always available)
    this.bindReactionButtons();

    // Edit message
    document.querySelectorAll('.msg-edit-btn').forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgId = btn.dataset.msgId;
        const contentEl = document.getElementById(`msg-content-${msgId}`);
        if (!contentEl) return;

        const currentText = contentEl.textContent;
        const textarea = document.createElement('textarea');
        textarea.className = 'message-edit-textarea';
        textarea.value = currentText;

        const btnRow = document.createElement('div');
        btnRow.className = 'message-edit-actions';
        btnRow.innerHTML = `
          <button class="btn btn-primary btn-sm msg-save-btn">Сохранить</button>
          <button class="btn btn-sm msg-cancel-btn">Отмена</button>
        `;

        contentEl.style.display = 'none';
        contentEl.parentNode.insertBefore(textarea, contentEl.nextSibling);
        contentEl.parentNode.insertBefore(btnRow, textarea.nextSibling);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        const cancel = () => {
          textarea.remove();
          btnRow.remove();
          contentEl.style.display = '';
        };

        btnRow.querySelector('.msg-cancel-btn').addEventListener('click', cancel);

        textarea.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') cancel();
          if (ev.key === 'Enter' && ev.ctrlKey) btnRow.querySelector('.msg-save-btn').click();
        });

        btnRow.querySelector('.msg-save-btn').addEventListener('click', async () => {
          const newContent = textarea.value.trim();
          if (!newContent) return;
          if (newContent === currentText) { cancel(); return; }

          try {
            const updated = await this.api('PUT', `/api/messages/${msgId}`, { content: newContent });
            contentEl.textContent = updated.content;
            cancel();
            this.toast('Сообщение отредактировано', 'success');
          } catch (e) {
            this.toast(e.message, 'error');
          }
        });
      });
    });

    // Delete message
    document.querySelectorAll('.msg-delete-btn').forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Удалить это сообщение?')) return;

        const msgId = btn.dataset.msgId;
        try {
          await this.api('DELETE', `/api/messages/${msgId}`);
          const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
          if (msgEl) {
            msgEl.style.transition = 'opacity .2s';
            msgEl.style.opacity = '0';
            setTimeout(() => msgEl.remove(), 200);
          }
          this.toast('Сообщение удалено', 'success');
        } catch (e) {
          this.toast(e.message, 'error');
        }
      });
    });
  },

  renderMessage(m) {
    if (m.is_system) {
      return `<div class="message system" data-msg-id="${m.id}"><span>${esc(m.content)}</span><span class="message-date" style="margin-left:auto">${timeAgo(m.created_at)}</span></div>`;
    }

    const avatarHtml = m.author_photo
      ? `<img src="${m.author_photo}" class="user-avatar" alt="">`
      : `<div class="user-avatar-placeholder">${(m.author_first_name || '?')[0].toUpperCase()}</div>`;

    const attachmentsHtml = (m.attachments || []).map(a => {
      if (isImageAttachment(a)) {
        return `<div class="attachment-preview lightbox-trigger" data-src="/uploads/${a.filename}" data-alt="${esc(a.original_name)}" style="background-image:url('/uploads/${a.filename}')"></div>`;
      }
      return `<a href="/uploads/${a.filename}" target="_blank" rel="noopener noreferrer" class="attachment">&#128206; ${esc(a.original_name)} (${formatSize(a.size)})</a>`;
    }).join('');

    const canManage = this.user && (this.user.is_admin || m.author_id === this.user.id);
    const actionsHtml = `
      <div class="message-actions">
        <button class="msg-action-btn msg-reaction-btn" data-msg-id="${m.id}" title="Реакция">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>
        ${canManage ? `
        <button class="msg-action-btn msg-edit-btn" data-msg-id="${m.id}" title="Редактировать">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="msg-action-btn msg-delete-btn" data-msg-id="${m.id}" title="Удалить">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
        ` : ''}
      </div>
    `;

    const reactionsHtml = this.renderReactions(m.reactions || [], m.id);

    return `
      <div class="message" data-msg-id="${m.id}">
        <div class="message-avatar">${avatarHtml}</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-author">${esc(m.author_first_name || m.author_username || 'Unknown')}</span>
            ${m.author_is_admin ? '<span class="admin-badge">Админ</span>' : ''}
            <span class="message-date">${timeAgo(m.created_at)}</span>
            ${actionsHtml}
          </div>
          <div class="message-content" id="msg-content-${m.id}">${esc(m.content)}</div>
          ${attachmentsHtml ? `<div class="message-attachments">${attachmentsHtml}</div>` : ''}
          <div class="message-reactions" id="msg-reactions-${m.id}">${reactionsHtml}</div>
        </div>
      </div>
    `;
  },

  renderFilePreview(files) {
    const container = document.getElementById('file-preview-list');
    if (!container) return;
    container.innerHTML = files.map((f, i) => `
      <div class="file-preview-item">
        <span>${esc(getAttachmentName(f, i))}</span>
        <span>(${formatSize(f.size || 0)})</span>
        <span class="remove-file" data-index="${i}">&times;</span>
      </div>
    `).join('');

    container.querySelectorAll('.remove-file').forEach(btn => {
      btn.addEventListener('click', () => {
        files.splice(parseInt(btn.dataset.index), 1);
        this.renderFilePreview(files);
      });
    });
  },

  // ========== Reactions ==========
  _reactionEmojis: ['\uD83D\uDC4D', '\uD83D\uDC4E', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDE4F', '\uD83D\uDD25', '\uD83C\uDF89', '\uD83E\uDD14'],

  renderReactions(reactions, msgId) {
    if (!reactions || reactions.length === 0) return '';
    return reactions.map(r => {
      const userNames = r.users.map(u => u.name).join(', ');
      return `<button class="reaction-btn ${r.user_reacted ? 'reacted' : ''}" data-msg-id="${msgId}" data-emoji="${r.emoji}" title="${esc(userNames)}">${r.emoji} <span class="reaction-count">${r.count}</span></button>`;
    }).join('');
  },

  showReactionPicker(msgId, anchorEl) {
    // Remove any existing picker
    document.querySelector('.reaction-picker')?.remove();

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.innerHTML = this._reactionEmojis.map(e => `<button class="reaction-picker-btn" data-emoji="${e}">${e}</button>`).join('');

    // Position near the anchor button
    const rect = anchorEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.left = Math.max(8, rect.left - 80) + 'px';
    picker.style.zIndex = '500';

    document.body.appendChild(picker);

    // Handle emoji click
    picker.addEventListener('click', async (e) => {
      const btn = e.target.closest('.reaction-picker-btn');
      if (!btn) return;
      const emoji = btn.dataset.emoji;
      picker.remove();
      await this.toggleReaction(msgId, emoji);
    });

    // Close on click outside
    const close = (e) => {
      if (!picker.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  },

  async toggleReaction(msgId, emoji) {
    try {
      const res = await this.api('POST', `/api/messages/${msgId}/reactions`, { emoji });
      // Update reactions in the DOM
      const container = document.getElementById(`msg-reactions-${msgId}`);
      if (container) {
        container.innerHTML = this.renderReactions(res.reactions, msgId);
        this.bindReactionButtons();
      }
    } catch (e) {
      this.toast(e.message, 'error');
    }
  },

  bindReactionButtons() {
    // Bind reaction toggle (clicking existing reaction)
    document.querySelectorAll('.reaction-btn').forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgId = btn.dataset.msgId;
        const emoji = btn.dataset.emoji;
        this.toggleReaction(msgId, emoji);
      });
    });

    // Bind reaction picker button (smiley icon in message actions)
    document.querySelectorAll('.msg-reaction-btn').forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgId = btn.dataset.msgId;
        this.showReactionPicker(msgId, btn);
      });
    });
  },

  showNewMessagesBadge(list) {
    if (document.getElementById('new-messages-badge')) return; // already shown
    const badge = document.createElement('button');
    badge.id = 'new-messages-badge';
    badge.className = 'new-messages-badge';
    badge.textContent = 'Новые сообщения \u2193';
    badge.addEventListener('click', () => {
      list.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
      badge.remove();
    });
    // Remove badge automatically when user scrolls to bottom
    const onScroll = () => {
      const docEl = document.documentElement;
      if (docEl.scrollHeight - docEl.scrollTop - docEl.clientHeight < 300) {
        badge.remove();
        window.removeEventListener('scroll', onScroll);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.body.appendChild(badge);
  },

  renderTypingIndicator(typers) {
    const el = document.getElementById('typing-indicator');
    if (!el) return;

    if (!typers || typers.length === 0) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const avatars = typers.map(u => {
      const baseTitle = (u.first_name || u.username || '').trim();
      const adminTitle = (this.user?.is_admin && u._real_first_name && u._real_first_name !== u.first_name)
        ? `${baseTitle} (реально: ${u._real_first_name}${u._real_username ? ` @${u._real_username}` : ''})`
        : baseTitle;

      if (u.photo_url) {
        return `<img src="${u.photo_url}" class="typing-avatar" alt="" title="${esc(adminTitle)}">`;
      }
      return `<div class="typing-avatar-placeholder" title="${esc(adminTitle)}">${(u.first_name || '?')[0].toUpperCase()}</div>`;
    }).join('');

    const names = typers.map(u => esc(u.first_name || u.username || 'Кто-то'));
    let text;
    if (names.length === 1) {
      text = `${names[0]} печатает`;
    } else if (names.length === 2) {
      text = `${names[0]} и ${names[1]} печатают`;
    } else {
      text = `${names[0]} и ещё ${names.length - 1} печатают`;
    }

    const isAdmin = !!this.user?.is_admin;
    const adminParts = isAdmin
      ? typers
        .filter(u => u._real_first_name)
        .map(u => {
          const real = `${esc(u._real_first_name)}${u._real_username ? ` <span class=\"online-user-username\">@${esc(u._real_username)}</span>` : ''}`;
          const shown = `${esc(u.first_name || '')}${u.username ? ` <span class=\"online-user-username\">@${esc(u.username)}</span>` : ''}`;
          if (u._real_first_name === u.first_name && (u._real_username || null) === (u.username || null)) return null;
          return `${shown} → ${real}`;
        })
        .filter(Boolean)
      : [];

    const adminLine = adminParts.length > 0
      ? `<div class="typing-admin admin-real-line">реально: ${adminParts.join(', ')}</div>`
      : '';

    el.style.display = 'flex';
    el.innerHTML = `
      <div class="typing-avatars">${avatars}</div>
      <div class="typing-text">
        <div class="typing-main">
          <span>${text}</span>
          <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
        ${adminLine}
      </div>
    `;
  },

  renderReadingIndicator(ticketId) {
    const el = document.getElementById('reading-indicator');
    if (!el) return;

    const tid = ticketId || this._currentTicketId;
    if (!tid) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const users = this._onlineUsers || [];
    const readersAll = users.filter(u => u.currentView === 'ticket' && String(u.currentTicketId) === String(tid));
    const readers = readersAll.filter(u => !this.user || u.id !== this.user.id);

    if (readers.length === 0) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const max = 5;
    const slice = readers.slice(0, max);
    const more = readers.length - slice.length;

    const avatars = slice.map(u => {
      let title = esc(u.first_name || '');
      if (u.username) {
        title = title ? `${title} (@${esc(u.username)})` : `@${esc(u.username)}`;
      }
      if (!title) title = 'Unknown';

      if (u.photo_url) {
        return `<img src="${u.photo_url}" class="reading-avatar" alt="" title="${title}">`;
      }
      const letter = (u.first_name || u.username || '?')[0].toUpperCase();
      return `<div class="reading-avatar-placeholder" title="${title}">${esc(letter)}</div>`;
    }).join('');

    const moreHtml = more > 0 ? `<div class="reading-more" title="Еще ${more}">+${more}</div>` : '';

    el.style.display = 'flex';
    el.innerHTML = `
      <span class="reading-label">Читают</span>
      <span class="reading-avatars">${avatars}${moreHtml}</span>
    `;
  },

  // ========== Online View ==========
  renderOnlineView(container) {
    const users = this._onlineUsers || [];
    const viewLabels = {
      list: 'Список тикетов',
      kanban: 'Канбан',
      archive: 'Архив',
      resource: 'Сайты/Игры',
      online: 'Онлайн',
      users: 'Пользователи',
      ticket: 'Просмотр тикета',
    };

    container.innerHTML = `
      <div class="online-view">
        <div class="online-header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
            Онлайн сейчас
            <span class="online-total-badge">${users.length}</span>
          </h2>
          <p style="color:var(--text-muted);font-size:13px;margin-top:4px">Пользователи, которые сейчас на сайте, и что они просматривают</p>
        </div>

        ${users.length === 0 ? `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>
            </svg>
            <h3>Никого нет онлайн</h3>
            <p>Сейчас на сайте нет других пользователей</p>
          </div>
        ` : `
          <div class="online-users-grid">
            ${users.map(u => {
              const avatarHtml = u.photo_url
                ? `<img src="${u.photo_url}" class="online-user-avatar" alt="">`
                : `<div class="online-user-avatar-placeholder">${(u.first_name || '?')[0].toUpperCase()}</div>`;

              const viewText = !u.currentView
                ? '<span style="color:var(--text-muted);font-style:italic">Активность скрыта</span>'
                : (u.currentView === 'ticket' && u.currentTicketTitle
                  ? `${viewLabels.ticket}: <span class="online-ticket-link" data-ticket-id="${u.currentTicketId}">#${u.currentTicketId} ${esc(u.currentTicketTitle)}</span>`
                  : esc(viewLabels[u.currentView] || u.currentView));

              return `
                <div class="online-user-card">
                  <div class="online-user-info">
                    <div class="online-avatar-wrap">
                      ${avatarHtml}
                      <span class="online-dot"></span>
                    </div>
                    <div class="online-user-details">
                      <div class="online-user-name">
                        ${esc(u.first_name || u.username || 'Unknown')}
                        ${u.username ? `<span class="online-user-username">@${esc(u.username)}</span>` : ''}
                        ${u.is_admin ? '<span class="admin-badge">Админ</span>' : ''}
                      </div>
                      ${this.user?.is_admin && u._real_first_name ? `
                        <div class="admin-real-line">реально: ${esc(u._real_first_name)}${u._real_username ? ` <span class=\"online-user-username\">@${esc(u._real_username)}</span>` : ''}</div>
                      ` : ''}
                      <div class="online-user-location">${viewText}</div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Bind ticket links
    container.querySelectorAll('.online-ticket-link').forEach(link => {
      link.style.cursor = 'pointer';
      link.addEventListener('click', () => {
        const id = link.dataset.ticketId;
        location.hash = `ticket-${id}`;
        this.navigate('ticket', { id });
      });
    });
  },

  // ========== All Users View ==========
  async renderUsersView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const data = await this.api('GET', '/api/users');
      const users = data.users;

      container.innerHTML = `
        <div class="users-view">
          <div class="online-header">
            <h2>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Все пользователи
              <span class="online-total-badge" style="background:var(--bg-tertiary);color:var(--text-muted)">${users.length}</span>
            </h2>
            <p style="color:var(--text-muted);font-size:13px;margin-top:4px">Список всех зарегистрированных пользователей</p>
          </div>

          <div class="toolbar" style="margin-bottom:12px">
            <input class="search-input" type="text" placeholder="Поиск пользователей..." id="users-search-input">
          </div>

          <div class="users-list" id="users-list-container">
            ${this.renderUsersList(users)}
          </div>
        </div>
      `;

      // Search
      let debounce = null;
      document.getElementById('users-search-input')?.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const q = e.target.value.toLowerCase();
          const filtered = users.filter(u =>
            (u.first_name || '').toLowerCase().includes(q) ||
            (u.username || '').toLowerCase().includes(q) ||
            (u.last_name || '').toLowerCase().includes(q)
          );
          document.getElementById('users-list-container').innerHTML = this.renderUsersList(filtered);
        }, 200);
      });
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  renderUsersList(users) {
    if (!users.length) {
      return `<div class="empty-state"><h3>Пользователей не найдено</h3></div>`;
    }

    // Find online user locations
    const onlineMap = new Map();
    for (const u of (this._onlineUsers || [])) {
      onlineMap.set(u.id, u);
    }

    const viewLabels = {
      list: 'Список тикетов',
      kanban: 'Канбан',
      archive: 'Архив',
      resource: 'Сайты/Игры',
      online: 'Онлайн',
      users: 'Пользователи',
      ticket: 'Просмотр тикета',
    };

    return users.map(u => {
      const avatarHtml = u.photo_url
        ? `<img src="${u.photo_url}" class="online-user-avatar" alt="">`
        : `<div class="online-user-avatar-placeholder">${(u.first_name || '?')[0].toUpperCase()}</div>`;

      const onlineInfo = onlineMap.get(u.id);
      const statusHtml = u.is_online
        ? `<span class="user-status-online">онлайн</span>`
        : `<span class="user-status-offline">оффлайн</span>`;

      let locationHtml = '';
      if (onlineInfo) {
        if (!onlineInfo.currentView) {
          locationHtml = `<span class="user-current-location">Активность скрыта</span>`;
        } else if (onlineInfo.currentView === 'ticket' && onlineInfo.currentTicketTitle) {
          locationHtml = `<span class="user-current-location">${viewLabels.ticket}: #${onlineInfo.currentTicketId} ${esc(onlineInfo.currentTicketTitle)}</span>`;
        } else {
          locationHtml = `<span class="user-current-location">${esc(viewLabels[onlineInfo.currentView] || onlineInfo.currentView)}</span>`;
        }
      }

      return `
        <div class="user-list-row ${u.is_online ? 'is-online' : ''}">
          <div class="online-avatar-wrap">
            ${avatarHtml}
            ${u.is_online ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="user-list-info">
            <div class="user-list-name">
              ${esc(u.first_name || 'Unknown')}
              ${u.last_name ? ` ${esc(u.last_name)}` : ''}
              ${u.username ? `<span class="online-user-username">@${esc(u.username)}</span>` : ''}
              ${u.is_admin ? '<span class="admin-badge">Админ</span>' : ''}
            </div>
            ${this.user?.is_admin && u._real_first_name ? `
              <div class="admin-real-line">реально: ${esc(u._real_first_name)}${u._real_username ? ` <span class=\"online-user-username\">@${esc(u._real_username)}</span>` : ''}</div>
            ` : ''}
            <div class="user-list-meta">
              ${statusHtml}
              ${locationHtml}
              <span class="user-list-date">Регистрация: ${timeAgo(u.created_at)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // ========== Settings View ==========
  async renderSettingsView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const s = await this.api('GET', '/api/settings');

      const currentAvatar = s.display_avatar === 'hidden' ? null : (s.display_avatar || s.real_photo_url);
      const avatarPreview = currentAvatar
        ? `<img src="${currentAvatar}" class="settings-avatar-preview" alt="">`
        : `<div class="settings-avatar-placeholder">${(s.display_name || s.real_first_name || '?')[0].toUpperCase()}</div>`;

      container.innerHTML = `
        <div class="settings-view">
          <div class="online-header">
            <h2>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Настройки
            </h2>
          </div>

          <!-- Profile section -->
          <div class="settings-section">
            <h3>Профиль</h3>
            <p class="settings-hint">Ваши данные из Telegram: <strong>${esc(s.real_first_name)}</strong>${s.real_username ? ` (@${esc(s.real_username)})` : ''}</p>

            <div class="settings-profile-row">
              <div class="settings-avatar-wrap" id="settings-avatar-wrap">
                ${avatarPreview}
                <div class="settings-avatar-actions">
                  <button class="btn btn-sm" id="settings-upload-avatar">Загрузить</button>
                  <button class="btn btn-sm btn-danger" id="settings-hide-avatar" ${s.display_avatar === 'hidden' ? 'style="opacity:.5"' : ''}>Скрыть</button>
                  ${s.display_avatar ? '<button class="btn btn-sm" id="settings-reset-avatar">Сбросить</button>' : ''}
                </div>
                <input type="file" id="settings-avatar-file" accept="image/*" hidden>
              </div>
            </div>

            <div class="form-group" style="margin-top:14px">
              <label>Отображаемое имя</label>
              <input class="form-input" id="settings-display-name" value="${esc(s.display_name)}" placeholder="${esc(s.real_first_name)} (по умолчанию)">
              <span class="settings-hint">Другие пользователи будут видеть это имя вместо вашего имени из Telegram</span>
            </div>
          </div>

          <!-- Privacy section -->
          <div class="settings-section">
            <h3>Приватность</h3>

            <label class="settings-toggle">
              <input type="checkbox" id="settings-hide-all" ${s.privacy_hidden ? 'checked' : ''}>
              <span class="settings-toggle-slider"></span>
              <div>
                <span class="settings-toggle-label">Полностью скрыт</span>
                <span class="settings-hint">Вас не будет видно в списке пользователей, как будто вы не зарегистрированы</span>
              </div>
            </label>

            <label class="settings-toggle">
              <input type="checkbox" id="settings-hide-online" ${s.privacy_hide_online ? 'checked' : ''}>
              <span class="settings-toggle-slider"></span>
              <div>
                <span class="settings-toggle-label">Скрыть статус онлайн</span>
                <span class="settings-hint">Вы не будете отображаться в списке онлайн, но будете видны в списке пользователей</span>
              </div>
            </label>

            <label class="settings-toggle">
              <input type="checkbox" id="settings-hide-activity" ${s.privacy_hide_activity ? 'checked' : ''}>
              <span class="settings-toggle-slider"></span>
              <div>
                <span class="settings-toggle-label">Скрыть активность</span>
                <span class="settings-hint">Другие не увидят, какую страницу или тикет вы сейчас просматриваете</span>
              </div>
            </label>

            ${this.user.is_admin ? '<p class="settings-hint" style="margin-top:10px;color:var(--warning)">Администраторы всегда видят всех пользователей и их настоящие данные</p>' : ''}
          </div>

          <!-- Notifications -->
          <div class="settings-section">
            <h3>Уведомления</h3>

            <label class="settings-toggle">
              <input type="checkbox" id="settings-notify-own" ${s.notify_own ? 'checked' : ''}>
              <span class="settings-toggle-slider"></span>
              <div>
                <span class="settings-toggle-label">Свои тикеты</span>
                <span class="settings-hint">Получать уведомления по своим тикетам</span>
              </div>
            </label>

            <label class="settings-toggle">
              <input type="checkbox" id="settings-notify-sub" ${s.notify_subscribed ? 'checked' : ''}>
              <span class="settings-toggle-slider"></span>
              <div>
                <span class="settings-toggle-label">Подписки</span>
                <span class="settings-hint">Получать уведомления по тикетам, на которые вы подписаны</span>
              </div>
            </label>
          </div>

          <div style="margin-top:18px">
            <button class="btn btn-primary btn-lg" id="settings-save">Сохранить настройки</button>
          </div>
        </div>
      `;

      this.bindSettings(s);
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  bindSettings(currentSettings) {
    // Upload avatar
    document.getElementById('settings-upload-avatar')?.addEventListener('click', () => {
      document.getElementById('settings-avatar-file')?.click();
    });

    document.getElementById('settings-avatar-file')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        this.toast(`Файл превышает лимит 5 МБ: ${file.name} (${formatSize(file.size)})`, 'error');
        return;
      }
      const formData = new FormData();
      formData.append('avatar', file);
      try {
        const res = await this.api('POST', '/api/settings/avatar', formData, true);
        this.toast('Аватар обновлён', 'success');
        this.navigate('settings');
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // Hide avatar
    document.getElementById('settings-hide-avatar')?.addEventListener('click', async () => {
      try {
        await this.api('PUT', '/api/settings', { display_avatar: 'hidden' });
        this.toast('Аватар скрыт', 'success');
        this.navigate('settings');
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // Reset avatar
    document.getElementById('settings-reset-avatar')?.addEventListener('click', async () => {
      try {
        await this.api('PUT', '/api/settings', { display_avatar: '' });
        this.toast('Аватар сброшен', 'success');
        this.navigate('settings');
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // Save all settings
    document.getElementById('settings-save')?.addEventListener('click', async () => {
      const btn = document.getElementById('settings-save');
      btn.disabled = true;
      btn.textContent = 'Сохранение...';

      try {
        await this.api('PUT', '/api/settings', {
          display_name: document.getElementById('settings-display-name')?.value || '',
          privacy_hidden: document.getElementById('settings-hide-all')?.checked || false,
          privacy_hide_online: document.getElementById('settings-hide-online')?.checked || false,
          privacy_hide_activity: document.getElementById('settings-hide-activity')?.checked || false,
          notify_own: document.getElementById('settings-notify-own')?.checked || false,
          notify_subscribed: document.getElementById('settings-notify-sub')?.checked || false,
        });

        // Refresh user data
        try {
          const res = await this.api('GET', '/api/auth/me');
          this.user = res.user;
        } catch {}

        this.toast('Настройки сохранены', 'success');
      } catch (err) {
        this.toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить настройки';
      }
    });
  },

  // ========== About View ==========
  renderAboutView(container) {
    container.innerHTML = `
      <div class="about-view">
        <div class="about-header">
          <div class="logo-icon" style="width:64px;height:64px;font-size:28px;margin:0 auto 16px;border-radius:16px;background:linear-gradient(135deg,#0074e8,#4da3ff);display:flex;align-items:center;justify-content:center;font-weight:800">Z</div>
          <h1>Zapret GUI</h1>
          <p>Инструмент для обхода блокировок интернет-ресурсов в России</p>
        </div>
        <div class="about-links">
          <a class="about-link-card" href="https://publish.obsidian.md/zapret" target="_blank" rel="noopener noreferrer">
            <div class="about-link-icon" style="background:rgba(77,163,255,.15);color:#4da3ff">&#128214;</div>
            <div class="about-link-info">
              <h3>Wiki / База знаний</h3>
              <p>Документация, инструкции по настройке, FAQ и полезные материалы</p>
            </div>
          </a>
          <a class="about-link-card" href="https://t.me/bypassblock" target="_blank" rel="noopener noreferrer">
            <div class="about-link-icon" style="background:rgba(34,197,94,.15);color:#22c55e">&#128172;</div>
            <div class="about-link-info">
              <h3>Telegram-группа</h3>
              <p>Основная группа для обсуждения, помощи и новостей проекта</p>
            </div>
          </a>
          <a class="about-link-card" href="https://t.me/zapretnetdiscordyoutube" target="_blank" rel="noopener noreferrer">
            <div class="about-link-icon" style="background:rgba(124,92,224,.15);color:#7c5ce0">&#128229;</div>
            <div class="about-link-info">
              <h3>Скачать все версии</h3>
              <p>Telegram-группа с архивами всех версий Zapret GUI для скачивания</p>
            </div>
          </a>
          <a class="about-link-card" href="https://t.me/vpndiscordyooutube" target="_blank" rel="noopener noreferrer">
            <div class="about-link-icon" style="background:rgba(245,158,11,.15);color:#f59e0b">&#128274;</div>
            <div class="about-link-info">
              <h3>VPN-группа</h3>
              <p>Telegram-группа, посвящённая VPN-решениям и обходу блокировок</p>
            </div>
          </a>
          <a class="about-link-card" href="https://t.me/zapretvpns_bot" target="_blank" rel="noopener noreferrer">
            <div class="about-link-icon" style="background:rgba(232,54,77,.15);color:#e8364d">&#129302;</div>
            <div class="about-link-info">
              <h3>VPN-бот</h3>
              <p>Telegram-бот для получения VPN-конфигураций</p>
            </div>
          </a>
        </div>
      </div>
    `;
  },

  // ========== Admin Panel View ==========
  async renderAdminView(container) {
    if (!this.user || !this.user.is_admin) {
      container.innerHTML = '<div class="empty-state"><h3>Доступ запрещён</h3><p>Эта страница доступна только администраторам</p></div>';
      return;
    }

    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      await this.loadTicketTypes();
      const types = this.ticketTypes;

      container.innerHTML = `
        <div class="admin-view">
          <div class="online-header">
            <h2>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              Админ-панель
            </h2>
            <p style="color:var(--text-muted);font-size:13px;margin-top:4px">Управление типами тикетов</p>
          </div>

          <div class="admin-section">
            <div class="admin-section-header">
              <h3>Типы тикетов</h3>
              <button class="btn btn-primary btn-sm" id="admin-add-type-btn">+ Добавить тип</button>
            </div>
            <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">У каждого типа есть эмодзи, имя и цвет. Они отображаются в списке тикетов, фильтрах и при создании.</p>

            <div class="admin-types-list" id="admin-types-list">
              ${types.map(tt => `
                <div class="admin-type-row" data-type-id="${tt.id}">
                  <div class="admin-type-preview">
                    <span class="admin-type-emoji">${esc(tt.emoji)}</span>
                    <span class="admin-type-name" style="color:${tt.color}">${esc(tt.name)}</span>
                    <span class="admin-type-key">${esc(tt.key)}</span>
                  </div>
                  <div class="admin-type-color-preview" style="background:${tt.color}" title="${tt.color}"></div>
                  <div class="admin-type-actions">
                    <button class="btn btn-sm admin-edit-type-btn" data-type-id="${tt.id}">Редактировать</button>
                    <button class="btn btn-sm btn-danger admin-delete-type-btn" data-type-id="${tt.id}" data-type-key="${tt.key}">Удалить</button>
                  </div>
                </div>
              `).join('')}
              ${types.length === 0 ? '<div class="empty-state" style="padding:30px"><h3>Нет типов</h3><p>Добавьте первый тип тикета</p></div>' : ''}
            </div>
          </div>
        </div>
      `;

      this.bindAdminView();
    } catch (e) {
      container.innerHTML = '<div class="empty-state"><h3>Ошибка</h3><p>' + esc(e.message) + '</p></div>';
    }
  },

  bindAdminView() {
    // Add type
    document.getElementById('admin-add-type-btn')?.addEventListener('click', () => {
      this.showTypeModal(null, async (data) => {
        try {
          await this.api('POST', '/api/ticket-types', data);
          await this.loadTicketTypes();
          this.toast('Тип добавлен', 'success');
          this.navigate('admin');
        } catch (e) { this.toast(e.message, 'error'); }
      });
    });

    // Edit type
    document.querySelectorAll('.admin-edit-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.typeId);
        const typeData = this.ticketTypes.find(t => t.id === id);
        if (!typeData) return;
        this.showTypeModal(typeData, async (data) => {
          try {
            await this.api('PUT', `/api/ticket-types/${id}`, data);
            await this.loadTicketTypes();
            this.toast('Тип обновлён', 'success');
            this.navigate('admin');
          } catch (e) { this.toast(e.message, 'error'); }
        });
      });
    });

    // Delete type
    document.querySelectorAll('.admin-delete-type-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.typeId);
        const key = btn.dataset.typeKey;
        if (!confirm(`Удалить тип "${key}"? Тикеты с этим типом сохранятся, но тип не будет отображаться.`)) return;
        try {
          await this.api('DELETE', `/api/ticket-types/${id}`);
          await this.loadTicketTypes();
          this.toast('Тип удалён', 'success');
          this.navigate('admin');
        } catch (e) { this.toast(e.message, 'error'); }
      });
    });
  },

  showTypeModal(existing, callback) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2>${isEdit ? 'Редактировать тип' : 'Новый тип тикета'}</h2>
          <button class="btn-icon modal-close" style="font-size:20px">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Ключ (латиница, без пробелов) *</label>
            <input class="form-input" id="type-key" placeholder="bug, idea, task..." value="${existing ? esc(existing.key) : ''}" ${isEdit ? 'readonly style="opacity:.6"' : ''}>
          </div>
          <div class="form-group">
            <label>Название *</label>
            <input class="form-input" id="type-name" placeholder="Баг, Идея, Задача..." value="${existing ? esc(existing.name) : ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Эмодзи</label>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="btn" id="type-emoji-btn" style="font-size:22px;min-width:44px;min-height:38px" type="button">${existing && existing.emoji ? esc(existing.emoji) : '+'}</button>
                <input type="hidden" id="type-emoji" value="${existing ? esc(existing.emoji) : ''}">
              </div>
            </div>
            <div class="form-group">
              <label>Цвет</label>
              <input type="color" id="type-color" value="${existing ? existing.color : '#6c757d'}" style="width:44px;height:38px;border:1px solid var(--border);border-radius:6px;background:var(--bg-tertiary);cursor:pointer;padding:2px">
            </div>
          </div>
          <div class="form-group">
            <label>Порядок сортировки</label>
            <input class="form-input" type="number" id="type-sort" value="${existing ? existing.sort_order : '0'}" min="0" placeholder="0">
          </div>
          <div class="admin-type-preview-box" style="margin-top:12px;padding:12px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius);display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:var(--text-muted)">Предпросмотр:</span>
            <span class="type-badge" id="type-preview-badge" style="color:#6c757d;border-color:#6c757d40;background:#6c757d15">${existing ? (existing.emoji ? esc(existing.emoji) + ' ' : '') + esc(existing.name) : 'Тип'}</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn modal-close">Отмена</button>
          <button class="btn btn-primary" id="type-submit">${isEdit ? 'Сохранить' : 'Создать'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Emoji picker
    document.getElementById('type-emoji-btn')?.addEventListener('click', () => {
      this.showEmojiPicker((emoji) => {
        document.getElementById('type-emoji').value = emoji;
        document.getElementById('type-emoji-btn').textContent = emoji || '+';
        updatePreview();
      });
    });

    const updatePreview = () => {
      const name = document.getElementById('type-name')?.value || 'Тип';
      const emoji = document.getElementById('type-emoji')?.value || '';
      const color = document.getElementById('type-color')?.value || '#6c757d';
      const badge = document.getElementById('type-preview-badge');
      if (badge) {
        badge.style.color = color;
        badge.style.borderColor = color + '40';
        badge.style.background = color + '15';
        badge.textContent = (emoji ? emoji + ' ' : '') + name;
      }
    };

    document.getElementById('type-name')?.addEventListener('input', updatePreview);
    document.getElementById('type-color')?.addEventListener('input', updatePreview);

    // Submit
    document.getElementById('type-submit')?.addEventListener('click', () => {
      const key = document.getElementById('type-key')?.value.trim();
      const name = document.getElementById('type-name')?.value.trim();
      const emoji = document.getElementById('type-emoji')?.value || '';
      const color = document.getElementById('type-color')?.value || '#6c757d';
      const sort_order = parseInt(document.getElementById('type-sort')?.value) || 0;

      if (!key || !name) {
        this.toast('Ключ и название обязательны', 'error');
        return;
      }

      overlay.remove();
      callback({ key, name, emoji, color, sort_order });
    });
  },

  // ========== Create Modal ==========
  showCreateModal() {
    const tagsHtml = this.tags.map(t =>
      `<div class="tag-option" data-tag-id="${t.id}" style="color:${t.color};border-color:${t.color}40">${esc(t.name)}</div>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Новый тикет</h2>
          <button class="btn-icon modal-close" style="font-size:20px">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Заголовок *</label>
            <input class="form-input" id="create-title" placeholder="Краткое описание проблемы или идеи" autofocus>
          </div>
          <div class="form-group">
            <label>Описание</label>
            <textarea class="form-textarea" id="create-desc" placeholder="Подробное описание проблемы, шаги воспроизведения, ожидаемое поведение..."></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Тип *</label>
              <select class="form-select" id="create-type">
                ${this.ticketTypes.map((tt, i) => `<option value="${tt.key}" ${i === 0 ? 'selected' : ''}>${tt.emoji ? tt.emoji + ' ' : ''}${esc(tt.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Приоритет</label>
              <select class="form-select" id="create-priority">
                <option value="low">Низкий</option>
                <option value="medium" selected>Средний</option>
                <option value="high">Высокий</option>
                <option value="critical">Критический</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Теги</label>
            <div class="tags-select" id="create-tags">${tagsHtml}</div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Эмодзи</label>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="btn" id="create-emoji-btn" style="font-size:22px;min-width:44px;min-height:38px" type="button">+</button>
                <span style="font-size:12px;color:var(--text-muted)">Иконка тикета</span>
              </div>
              <input type="hidden" id="create-emoji" value="">
            </div>
            <div class="form-group">
              <label>Цвет</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="color" id="create-color" value="#0074e8" style="width:44px;height:38px;border:1px solid var(--border);border-radius:6px;background:var(--bg-tertiary);cursor:pointer;padding:2px">
                <label class="form-checkbox" style="font-size:12px">
                  <input type="checkbox" id="create-color-enabled">
                  Цветная метка
                </label>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-checkbox">
              <input type="checkbox" id="create-private">
              Приватный (видит только админ и вы)
            </label>
          </div>
          <div class="form-group">
            <label>Файлы</label>
            <input type="file" id="create-files" multiple>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn modal-close">Отмена</button>
          <button class="btn btn-primary" id="create-submit">Создать тикет</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close
    overlay.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => overlay.remove());
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    });

    // Tags toggle
    const selectedTags = new Set();
    overlay.querySelectorAll('.tag-option').forEach(el => {
      el.addEventListener('click', () => {
        const tagId = parseInt(el.dataset.tagId);
        if (selectedTags.has(tagId)) {
          selectedTags.delete(tagId);
          el.classList.remove('selected');
        } else {
          selectedTags.add(tagId);
          el.classList.add('selected');
        }
      });
    });

    // Emoji in create modal
    document.getElementById('create-emoji-btn')?.addEventListener('click', () => {
      this.showEmojiPicker((emoji) => {
        document.getElementById('create-emoji').value = emoji;
        document.getElementById('create-emoji-btn').textContent = emoji;
      });
    });

    // Submit
    document.getElementById('create-submit').addEventListener('click', async () => {
      const title = document.getElementById('create-title').value.trim();
      const description = document.getElementById('create-desc').value.trim();
      const type = document.getElementById('create-type').value;
      const priority = document.getElementById('create-priority').value;
      const is_private = document.getElementById('create-private').checked;
      const emoji = document.getElementById('create-emoji').value || null;
      const colorEnabled = document.getElementById('create-color-enabled').checked;
      const color = colorEnabled ? document.getElementById('create-color').value : null;

      if (!title) {
        this.toast('Заголовок обязателен', 'error');
        return;
      }

      const submitBtn = document.getElementById('create-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Создание...';

      try {
        const ticket = await this.api('POST', '/api/tickets', {
          title, description, type, priority, is_private, emoji, color,
          tags: Array.from(selectedTags),
        });

        // Upload files
        const rawFiles = Array.from(document.getElementById('create-files').files);
        const acceptedFiles = filterOversizedFiles(rawFiles, (msg, type) => this.toast(msg, type));
        if (acceptedFiles.length > 0) {
          const formData = new FormData();
          acceptedFiles.forEach((file, i) => formData.append('files', file, getAttachmentName(file, i)));
          await this.api('POST', `/api/tickets/${ticket.id}/upload`, formData, true);
        }

        overlay.remove();
        this.toast('Тикет создан!', 'success');
        location.hash = `ticket-${ticket.id}`;
        this.navigate('ticket', { id: ticket.id });
      } catch (e) {
        this.toast(e.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Создать тикет';
      }
    });
  },

  // ========== Emoji Picker ==========
  showEmojiPicker(callback) {
    const emojis = [
      '&#128027;', '&#128161;', '&#9889;', '&#128640;', '&#128736;', '&#128295;', '&#9881;', '&#128301;',
      '&#128274;', '&#128275;', '&#128226;', '&#128172;', '&#127919;', '&#127942;', '&#128640;', '&#128187;',
      '&#129302;', '&#128736;', '&#128679;', '&#128680;', '&#128681;', '&#9888;', '&#10060;', '&#9989;',
      '&#128308;', '&#128992;', '&#128993;', '&#128994;', '&#128309;', '&#128995;', '&#9899;', '&#11035;',
      '&#127775;', '&#128142;', '&#128293;', '&#10024;', '&#128171;', '&#127752;', '&#9729;', '&#9731;',
      '&#128065;', '&#128064;', '&#129513;', '&#128218;', '&#128196;', '&#128203;', '&#128206;', '&#128269;',
      '&#128736;', '&#128296;', '&#128297;', '&#128298;', '&#128299;', '&#128300;', '&#129691;', '&#129520;',
    ];
    // Decode HTML entities to real emoji chars for display
    const tmp = document.createElement('div');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <h2>Выберите эмодзи</h2>
          <button class="btn-icon modal-close" style="font-size:20px">&times;</button>
        </div>
        <div class="modal-body" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center">
          ${emojis.map(e => `<button class="emoji-pick-btn" data-emoji="${e}" style="font-size:24px;width:44px;height:44px;border:1px solid var(--border);border-radius:8px;background:var(--bg-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:var(--transition)">${e}</button>`).join('')}
        </div>
        <div class="modal-footer">
          <button class="btn" id="emoji-clear-btn">Убрать эмодзи</button>
          <button class="btn modal-close">Отмена</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.emoji-pick-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--accent-glow)'; btn.style.borderColor = 'var(--accent)'; btn.style.transform = 'scale(1.15)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--bg-tertiary)'; btn.style.borderColor = 'var(--border)'; btn.style.transform = 'scale(1)'; });
      btn.addEventListener('click', () => {
        tmp.innerHTML = btn.dataset.emoji;
        callback(tmp.textContent);
        overlay.remove();
      });
    });

    document.getElementById('emoji-clear-btn')?.addEventListener('click', () => {
      callback('');
      overlay.remove();
    });
  },
};

// ========== Utility Functions ==========

function ticketIcon(t, small = false, ticketTypes = []) {
  const s = small ? 'width:18px;height:18px;font-size:10px;flex-shrink:0' : '';
  // If ticket has a custom emoji set, use it
  if (t.emoji) {
    const size = small ? 'font-size:14px' : 'font-size:18px';
    return `<span style="${size};line-height:1;flex-shrink:0" title="${t.type}">${esc(t.emoji)}</span>`;
  }
  // Try to use emoji from dynamic ticket type
  const typeInfo = ticketTypes.find(tt => tt.key === t.type);
  if (typeInfo && typeInfo.emoji) {
    const size = small ? 'font-size:14px' : 'font-size:18px';
    return `<span style="${size};line-height:1;flex-shrink:0" title="${esc(typeInfo.name)}">${esc(typeInfo.emoji)}</span>`;
  }
  // Fallback: letter icon with dynamic color
  const fallbackLetter = typeInfo ? typeInfo.name[0].toUpperCase() : (t.type || '?')[0].toUpperCase();
  const bgColor = typeInfo ? typeInfo.color : '#6c757d';
  if (small) {
    return `<span class="ticket-type-icon" style="${s};background:${bgColor}">${fallbackLetter}</span>`;
  }
  return `<div class="ticket-type-icon" style="background:${bgColor}">${fallbackLetter}</div>`;
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function statusLabel(status) {
  const labels = {
    open: 'Открыто', in_progress: 'В работе', review: 'На ревью',
    testing: 'Тестирование', closed: 'Закрыто', rejected: 'Отклонено', duplicate: 'Дубликат',
  };
  return labels[status] || status;
}

function priorityLabel(priority) {
  const labels = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический' };
  return labels[priority] || priority;
}

function timeAgo(date) {
  const now = new Date();
  const d = new Date(date + (date.includes('Z') || date.includes('+') ? '' : 'Z'));
  const diff = (now - d) / 1000;

  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} дн. назад`;
  return d.toLocaleDateString('ru-RU');
}

function formatDate(date) {
  if (!date) return '\u2014';
  const d = new Date(date + (date.includes('Z') || date.includes('+') ? '' : 'Z'));
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Filter out files exceeding MAX_FILE_SIZE, show toast for rejected. Returns accepted files. */
function filterOversizedFiles(files, toastFn) {
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      rejected.push(f);
    } else {
      accepted.push(f);
    }
  }
  if (rejected.length > 0) {
    const names = rejected.map(f => `${f.name || 'file'} (${formatSize(f.size)})`).join(', ');
    toastFn(`Файлы превышают лимит 5 МБ: ${names}`, 'error');
  }
  return accepted;
}

function getAttachmentName(file, idx = 0) {
  return file?._preferredName || file?.name || `attachment-${Date.now()}-${idx}.png`;
}

function makePastedImageFile(blob, ts, idx) {
  const extRaw = (blob?.type || 'image/png').split('/')[1] || 'png';
  const ext = extRaw.replace(/[^a-zA-Z0-9]/g, '') || 'png';
  const name = `pasted-${ts}-${idx}.${ext}`;

  try {
    return new File([blob], name, { type: blob.type || 'image/png' });
  } catch {
    // Fallback for environments where File constructor is limited
    blob._preferredName = name;
    return blob;
  }
}

function isImageAttachment(att) {
  const mt = (att?.mime_type || '').toLowerCase();
  if (mt) return mt.startsWith('image/');
  const name = (att?.original_name || att?.filename || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

// Broken background-image previews: detect load failures via hidden probe img
(function() {
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!node.querySelectorAll) continue;
        const previews = node.classList && node.classList.contains('attachment-preview')
          ? [node] : node.querySelectorAll('.attachment-preview');
        previews.forEach(el => {
          const src = el.dataset.src;
          if (!src) return;
          const probe = new Image();
          probe.onerror = () => {
            const name = el.dataset.alt || 'attachment';
            const span = document.createElement('span');
            span.className = 'attachment';
            span.textContent = `\u{1F4CE} ${name}`;
            el.replaceWith(span);
          };
          probe.src = src;
        });
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();

// ========== Image Lightbox ==========
(function() {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = '<button class="lightbox-close" title="Close">&times;</button><img src="" alt="">';
  document.body.appendChild(overlay);

  const lbImg = overlay.querySelector('img');
  const lbClose = overlay.querySelector('.lightbox-close');

  // Block context menu on lightbox image to prevent URL leak
  lbImg.addEventListener('contextmenu', (e) => e.preventDefault());
  lbImg.setAttribute('draggable', 'false');

  function openLightbox(src) {
    lbImg.src = src;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    lbImg.src = '';
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === lbClose) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('active')) closeLightbox();
  });

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.lightbox-trigger');
    if (trigger) {
      e.preventDefault();
      const src = trigger.dataset.src || trigger.src;
      if (src) openLightbox(src);
    }
  });
})();

function isValidPortsInput(input) {
  if (!input || !input.trim()) return false;
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(s => s.trim());
      const n1 = Number(a);
      const n2 = Number(b);
      if (!Number.isInteger(n1) || !Number.isInteger(n2)) return false;
      if (n1 < 0 || n1 > 65535 || n2 < 0 || n2 > 65535) return false;
      if (n1 > n2) return false;
    } else {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 0 || n > 65535) return false;
    }
  }
  return true;
}

// Global for Telegram widget compatibility
window.App = App;

// Init
App.init();
