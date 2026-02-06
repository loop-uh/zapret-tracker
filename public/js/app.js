// ========== Zapret Tracker Frontend ==========

const App = {
  token: localStorage.getItem('token'),
  user: null,
  currentView: 'list',
  tags: [],
  config: {},
  authPollInterval: null,

  async init() {
    await this.loadConfig();
    await this.loadTags();
    if (this.token) {
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
      app.innerHTML = this.renderLogin();
      this.bindLogin();
    } else {
      app.innerHTML = this.renderHeader() + '<div class="main" id="content"></div>';
      this.bindHeader();
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
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

  // ========== Header ==========
  renderHeader() {
    const avatarHtml = this.user.photo_url
      ? `<img src="${this.user.photo_url}" class="user-avatar" alt="">`
      : `<div class="user-avatar-placeholder">${(this.user.first_name || '?')[0].toUpperCase()}</div>`;

    return `
      <div class="header">
        <div class="header-left">
          <div class="logo" style="cursor:pointer" data-nav="list">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Zapret Tracker
          </div>
          <nav class="nav">
            <button class="nav-btn ${this.currentView === 'list' ? 'active' : ''}" data-nav="list">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1.5H2V3zm0 4h12v1.5H2V7zm0 4h12v1.5H2V11z"/></svg>
              Список
            </button>
            <button class="nav-btn ${this.currentView === 'kanban' ? 'active' : ''}" data-nav="kanban">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2h3.5v12h-3.5V2zm5 0h3.5v8h-3.5V2zm5 0h3v10h-3V2z"/></svg>
              Канбан
            </button>
          </nav>
        </div>
        <div class="header-right">
          <button class="btn btn-primary" id="new-ticket-btn">+ Новый тикет</button>
          <div class="user-info">
            ${avatarHtml}
            <span>${esc(this.user.first_name)}</span>
            ${this.user.is_admin ? '<span class="admin-badge">Админ</span>' : ''}
            ${!this.user.has_chat_id && this.config.hasBotToken ? '<span class="admin-badge" style="background:var(--warning);font-size:10px" title="Напишите боту /start для получения уведомлений">Нет уведомлений</span>' : ''}
          </div>
          <button class="btn-icon" id="logout-btn" title="Выход">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9"/></svg>
          </button>
        </div>
      </div>
    `;
  },

  bindHeader() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        location.hash = '';
        this.navigate(btn.dataset.nav);
      });
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

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-nav="${view}"]`)?.classList.add('active');

    switch (view) {
      case 'list': this.renderListView(content); break;
      case 'kanban': this.renderKanbanView(content); break;
      case 'ticket': this.renderTicketView(content, data); break;
      default: this.renderListView(content);
    }
  },

  // ========== List View ==========
  async renderListView(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const [stats, ticketData] = await Promise.all([
        this.api('GET', '/api/stats'),
        this.api('GET', '/api/tickets'),
      ]);

      container.innerHTML = `
        ${this.renderStats(stats)}
        ${this.renderToolbar()}
        <div id="ticket-list" class="ticket-list">
          ${this.renderTicketList(ticketData.tickets)}
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

  renderToolbar() {
    const tagOptions = this.tags.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    return `
      <div class="toolbar">
        <input class="search-input" type="text" placeholder="Поиск тикетов..." id="search-input">
        <select class="filter-select" id="filter-type">
          <option value="">Все типы</option>
          <option value="bug">Баги</option>
          <option value="idea">Идеи</option>
          <option value="feature">Фичи</option>
          <option value="improvement">Улучшения</option>
        </select>
        <select class="filter-select" id="filter-status">
          <option value="">Все статусы</option>
          <option value="open">Открыто</option>
          <option value="in_progress">В работе</option>
          <option value="review">На ревью</option>
          <option value="testing">Тестирование</option>
          <option value="closed">Закрыто</option>
          <option value="rejected">Отклонено</option>
        </select>
        <select class="filter-select" id="filter-priority">
          <option value="">Все приоритеты</option>
          <option value="critical">Критический</option>
          <option value="high">Высокий</option>
          <option value="medium">Средний</option>
          <option value="low">Низкий</option>
        </select>
        <select class="filter-select" id="filter-tag">
          <option value="">Все теги</option>
          ${tagOptions}
        </select>
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

    const doFilter = async () => {
      const params = new URLSearchParams();
      if (search.value) params.set('search', search.value);
      if (filterType.value) params.set('type', filterType.value);
      if (filterStatus.value) params.set('status', filterStatus.value);
      if (filterPriority.value) params.set('priority', filterPriority.value);
      if (filterTag.value) params.set('tag_id', filterTag.value);

      try {
        const data = await this.api('GET', `/api/tickets?${params}`);
        document.getElementById('ticket-list').innerHTML = this.renderTicketList(data.tickets);
        this.bindTicketList();
      } catch (e) {
        this.toast(e.message, 'error');
      }
    };

    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(doFilter, 300);
    });

    [filterType, filterStatus, filterPriority, filterTag].forEach(el => {
      el.addEventListener('change', doFilter);
    });
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
      const typeIcons = { bug: 'B', idea: 'I', feature: 'F', improvement: 'U' };
      const tagsHtml = (t.tags || []).map(tag =>
        `<span class="tag" style="color:${tag.color};border-color:${tag.color}40;background:${tag.color}15">${esc(tag.name)}</span>`
      ).join('');

      return `
        <div class="ticket-row" data-id="${t.id}">
          <div class="ticket-type-icon ${t.type}">${typeIcons[t.type]}</div>
          <div class="ticket-info">
            <div class="ticket-title-row">
              <span class="ticket-id">#${t.id}</span>
              <span class="ticket-title">${esc(t.title)}</span>
              ${t.is_private ? '<span class="private-icon" title="Приватный">&#128274;</span>' : ''}
              <span class="ticket-tags">${tagsHtml}</span>
            </div>
            <div class="ticket-meta">
              <span>${esc(t.author_first_name || t.author_username || 'Unknown')}</span>
              <span>${timeAgo(t.created_at)}</span>
            </div>
          </div>
          <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
          <span class="priority-badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
          <button class="vote-btn ${t.user_voted ? 'voted' : ''}" data-vote="${t.id}" onclick="event.stopPropagation()">
            &#9650; ${t.votes_count}
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
          btn.innerHTML = `&#9650; ${res.votes_count}`;
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
    const typeIcons = { bug: 'B', idea: 'I', feature: 'F', improvement: 'U' };
    const tagsHtml = (t.tags || []).slice(0, 3).map(tag =>
      `<span class="tag" style="color:${tag.color};border-color:${tag.color}40;background:${tag.color}15">${esc(tag.name)}</span>`
    ).join('');

    return `
      <div class="kanban-card" data-id="${t.id}">
        <div class="kanban-card-title">
          <span class="ticket-type-icon ${t.type}" style="width:18px;height:18px;font-size:10px;flex-shrink:0">${typeIcons[t.type]}</span>
          <span>${esc(t.title)}</span>
        </div>
        <div class="ticket-tags" style="margin-bottom:6px">${tagsHtml}</div>
        <div class="kanban-card-meta">
          <span>#${t.id} ${esc(t.author_first_name || '')}</span>
          <span class="priority-badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
        </div>
        <div class="kanban-card-footer">
          <span class="vote-btn ${t.user_voted ? 'voted' : ''}" style="font-size:11px;padding:2px 6px">&#9650; ${t.votes_count}</span>
          ${t.is_private ? '<span class="private-icon" style="font-size:12px">&#128274;</span>' : ''}
          <span class="message-count" style="font-size:11px">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.78 1.78 1 2.75 1h10.5c.97 0 1.75.78 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.72A.75.75 0 015 14.25v-2.25H2.75A1.75 1.75 0 011 10.25v-7.5z"/></svg>
            ${t.message_count || 0}
          </span>
        </div>
      </div>
    `;
  },

  // ========== Ticket Detail View ==========
  async renderTicketView(container, { id }) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const ticket = await this.api('GET', `/api/tickets/${id}`);
      container.innerHTML = this.renderTicketDetail(ticket);
      this.bindTicketDetail(ticket);
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${esc(e.message)}</p></div>`;
    }
  },

  renderTicketDetail(t) {
    const typeLabels = { bug: 'Баг', idea: 'Идея', feature: 'Фича', improvement: 'Улучшение' };
    const tagsHtml = (t.tags || []).map(tag =>
      `<span class="tag" style="color:${tag.color};border-color:${tag.color}40;background:${tag.color}15">${esc(tag.name)}</span>`
    ).join('');

    const attachmentsHtml = (t.attachments || []).map(a => {
      if (a.mime_type && a.mime_type.startsWith('image/')) {
        return `<a href="/uploads/${a.filename}" target="_blank"><img src="/uploads/${a.filename}" class="attachment-preview" alt="${esc(a.original_name)}"></a>`;
      }
      return `<a href="/uploads/${a.filename}" target="_blank" class="attachment">&#128206; ${esc(a.original_name)}</a>`;
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
            <span class="ticket-type-icon ${t.type}" style="margin-top:4px">${{ bug: 'B', idea: 'I', feature: 'F', improvement: 'U' }[t.type]}</span>
            ${esc(t.title)}
            ${t.is_private ? '<span class="private-icon">&#128274;</span>' : ''}
          </h1>
          <div class="ticket-header-meta">
            <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
            <span class="priority-badge priority-${t.priority}">${priorityLabel(t.priority)}</span>
            <span>${typeLabels[t.type]}</span>
            <span>Создан ${timeAgo(t.created_at)}</span>
            <span>от ${esc(t.author_first_name || t.author_username || 'Unknown')}</span>
            <button class="vote-btn ${t.user_voted ? 'voted' : ''}" id="vote-btn">&#9650; ${t.votes_count}</button>
            ${tagsHtml}
          </div>
        </div>

        <div class="ticket-body">
          <div>
            <div class="ticket-content">
              <div class="ticket-description">${t.description ? esc(t.description) : '<span style="color:var(--text-muted)">Нет описания</span>'}</div>
              ${attachmentsHtml ? `<div class="ticket-attachments">${attachmentsHtml}</div>` : ''}
            </div>

            <div class="messages-section">
              <h2>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.78 1.78 1 2.75 1h10.5c.97 0 1.75.78 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.72A.75.75 0 015 14.25v-2.25H2.75A1.75 1.75 0 011 10.25v-7.5z"/></svg>
                Обсуждение (${(t.messages || []).filter(m => !m.is_system).length})
              </h2>
              <div class="messages-list" id="messages-list">
                ${(t.messages || []).map(m => this.renderMessage(m)).join('')}
              </div>

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
              <div class="sidebar-field"><label>Тип</label><span>${typeLabels[t.type]}</span></div>
              <div class="sidebar-field"><label>Автор</label><span>${esc(t.author_first_name || t.author_username)}</span></div>
              <div class="sidebar-field"><label>Создан</label><span>${formatDate(t.created_at)}</span></div>
              <div class="sidebar-field"><label>Обновлён</label><span>${formatDate(t.updated_at)}</span></div>
              ${t.closed_at ? `<div class="sidebar-field"><label>Закрыт</label><span>${formatDate(t.closed_at)}</span></div>` : ''}
              <div class="sidebar-field"><label>Голоса</label><span>${t.votes_count}</span></div>
            </div>

            ${canEdit ? `
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
        btn.innerHTML = `&#9650; ${res.votes_count}`;
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

    // File attach
    document.getElementById('attach-btn').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', (e) => {
      for (const file of e.target.files) {
        selectedFiles.push(file);
      }
      this.renderFilePreview(selectedFiles);
      e.target.value = '';
    });

    // Send message
    document.getElementById('send-message-btn').addEventListener('click', async () => {
      const content = document.getElementById('message-input').value.trim();
      if (!content && selectedFiles.length === 0) return;

      const btn = document.getElementById('send-message-btn');
      btn.disabled = true;
      btn.textContent = 'Отправка...';

      const formData = new FormData();
      formData.append('content', content);
      for (const file of selectedFiles) {
        formData.append('files', file);
      }

      try {
        const msg = await this.api('POST', `/api/tickets/${ticket.id}/messages`, formData, true);
        document.getElementById('message-input').value = '';
        selectedFiles.length = 0;
        this.renderFilePreview(selectedFiles);

        const list = document.getElementById('messages-list');
        list.insertAdjacentHTML('beforeend', this.renderMessage(msg));
        list.lastElementChild.scrollIntoView({ behavior: 'smooth' });
        this.toast('Сообщение отправлено', 'success');
      } catch (e) {
        this.toast(e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Отправить';
      }
    });

    // Ctrl+Enter to send
    document.getElementById('message-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        document.getElementById('send-message-btn').click();
      }
    });
  },

  renderMessage(m) {
    if (m.is_system) {
      return `<div class="message system"><span>${esc(m.content)}</span><span class="message-date" style="margin-left:auto">${timeAgo(m.created_at)}</span></div>`;
    }

    const avatarHtml = m.author_photo
      ? `<img src="${m.author_photo}" class="user-avatar" alt="">`
      : `<div class="user-avatar-placeholder">${(m.author_first_name || '?')[0].toUpperCase()}</div>`;

    const attachmentsHtml = (m.attachments || []).map(a => {
      if (a.mime_type && a.mime_type.startsWith('image/')) {
        return `<a href="/uploads/${a.filename}" target="_blank"><img src="/uploads/${a.filename}" class="attachment-preview" alt="${esc(a.original_name)}"></a>`;
      }
      return `<a href="/uploads/${a.filename}" target="_blank" class="attachment">&#128206; ${esc(a.original_name)} (${formatSize(a.size)})</a>`;
    }).join('');

    return `
      <div class="message">
        <div class="message-avatar">${avatarHtml}</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-author">${esc(m.author_first_name || m.author_username || 'Unknown')}</span>
            ${m.author_is_admin ? '<span class="admin-badge">Админ</span>' : ''}
            <span class="message-date">${timeAgo(m.created_at)}</span>
          </div>
          <div class="message-content">${esc(m.content)}</div>
          ${attachmentsHtml ? `<div class="message-attachments">${attachmentsHtml}</div>` : ''}
        </div>
      </div>
    `;
  },

  renderFilePreview(files) {
    const container = document.getElementById('file-preview-list');
    if (!container) return;
    container.innerHTML = files.map((f, i) => `
      <div class="file-preview-item">
        <span>${esc(f.name)}</span>
        <span>(${formatSize(f.size)})</span>
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
                <option value="bug">Баг</option>
                <option value="idea">Идея</option>
                <option value="feature">Фича</option>
                <option value="improvement">Улучшение</option>
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

    // Submit
    document.getElementById('create-submit').addEventListener('click', async () => {
      const title = document.getElementById('create-title').value.trim();
      const description = document.getElementById('create-desc').value.trim();
      const type = document.getElementById('create-type').value;
      const priority = document.getElementById('create-priority').value;
      const is_private = document.getElementById('create-private').checked;

      if (!title) {
        this.toast('Заголовок обязателен', 'error');
        return;
      }

      const submitBtn = document.getElementById('create-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Создание...';

      try {
        const ticket = await this.api('POST', '/api/tickets', {
          title, description, type, priority, is_private,
          tags: Array.from(selectedTags),
        });

        // Upload files
        const files = document.getElementById('create-files').files;
        if (files.length > 0) {
          const formData = new FormData();
          for (const file of files) formData.append('files', file);
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
};

// ========== Utility Functions ==========

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

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

// Global for Telegram widget compatibility
window.App = App;

// Init
App.init();
