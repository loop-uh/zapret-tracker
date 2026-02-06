#!/bin/bash
set -e

# ============================================================
# Zapret Tracker - Update & Restart
# Запускать на сервере: sudo ./update.sh
# Или: sudo /opt/zapret-tracker/update.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="/opt/zapret-tracker"
APP_USER="zapret-tracker"
REPO="https://github.com/loop-uh/zapret-tracker.git"

# Root check
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Запускай от root: sudo $0${NC}"
  exit 1
fi

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Zapret Tracker — Обновление${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ---- 1. Backup DB ----
echo -e "${YELLOW}[1/5] Бэкап базы данных...${NC}"
if [ -f "$APP_DIR/data/tracker.db" ]; then
  BACKUP="$APP_DIR/data/tracker.db.bak.$(date +%Y%m%d_%H%M%S)"
  cp "$APP_DIR/data/tracker.db" "$BACKUP"
  # Храним последние 10 бэкапов
  ls -t "$APP_DIR/data/"*.bak.* 2>/dev/null | tail -n +11 | xargs -r rm --
  echo -e "${GREEN}  -> $BACKUP${NC}"
else
  echo -e "${GREEN}  БД не найдена (первый запуск?)${NC}"
fi

# ---- 2. Get source files ----
echo -e "${YELLOW}[2/5] Загрузка обновлений...${NC}"

# Check if we're running from a deploy directory (deploy.sh uploaded files)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/server.js" ] && [ -f "$SCRIPT_DIR/database.js" ] && [ -d "$SCRIPT_DIR/public" ]; then
  # Use locally available files (from deploy.sh)
  TMPDIR="$SCRIPT_DIR"
  echo -e "${GREEN}  Используются локально загруженные файлы${NC}"
else
  # Fallback: clone from git
  TMPDIR=$(mktemp -d)
  git clone --depth 1 "$REPO" "$TMPDIR" 2>&1 | tail -1
  echo -e "${GREEN}  Код загружен из GitHub${NC}"
fi

# ---- 3. Copy files ----
echo -e "${YELLOW}[3/5] Обновление файлов...${NC}"
cp "$TMPDIR/package.json" "$APP_DIR/"
cp "$TMPDIR/server.js"    "$APP_DIR/"
cp "$TMPDIR/database.js"  "$APP_DIR/"
cp -r "$TMPDIR/public/"   "$APP_DIR/"
[ -f "$TMPDIR/update.sh" ] && cp "$TMPDIR/update.sh" "$APP_DIR/"
[ -f "$TMPDIR/install.sh" ] && cp "$TMPDIR/install.sh" "$APP_DIR/"
[ -f "$TMPDIR/setup-domain.sh" ] && cp "$TMPDIR/setup-domain.sh" "$APP_DIR/" 2>/dev/null || true

# Не трогаем: .env, data/, uploads/, node_modules/
if [ "$TMPDIR" != "$SCRIPT_DIR" ]; then
  rm -rf "$TMPDIR"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
echo -e "${GREEN}  Файлы обновлены${NC}"

# ---- 4. Dependencies ----
echo -e "${YELLOW}[4/5] Проверка зависимостей...${NC}"
cd "$APP_DIR"

# Сравниваем package.json хеш, ставим если изменился
NEW_HASH=$(md5sum "$APP_DIR/package.json" | cut -d' ' -f1)
OLD_HASH=""
[ -f "$APP_DIR/.pkg_hash" ] && OLD_HASH=$(cat "$APP_DIR/.pkg_hash")

if [ "$NEW_HASH" != "$OLD_HASH" ]; then
  echo -e "${YELLOW}  package.json изменился, устанавливаю...${NC}"
  sudo -u "$APP_USER" npm install --production 2>&1 | tail -3
  echo "$NEW_HASH" > "$APP_DIR/.pkg_hash"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.pkg_hash"
else
  echo -e "${GREEN}  Зависимости не изменились${NC}"
fi

# ---- 5. Fix nginx uploads (proxy instead of alias) ----
echo -e "${YELLOW}[5/6] Проверка nginx конфигурации...${NC}"
NGINX_CONF="/etc/nginx/sites-available/zapret-tracker"
if [ -f "$NGINX_CONF" ] && grep -q "alias /opt/zapret-tracker/uploads/" "$NGINX_CONF"; then
  echo -e "${YELLOW}  Фикс: /uploads/ через proxy вместо alias...${NC}"
  # Detect if HTTPS config (has escaped $)
  if grep -q "ssl_certificate" "$NGINX_CONF"; then
    sed -i '/location \/uploads\//,/}/ {
      /alias/c\        proxy_pass http://127.0.0.1:3000/uploads/;\n        proxy_set_header Host \$host;\n        proxy_set_header X-Real-IP \$remote_addr;
    }' "$NGINX_CONF"
  else
    sed -i '/location \/uploads\//,/}/ {
      /alias/c\        proxy_pass http://127.0.0.1:3000/uploads/;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;
    }' "$NGINX_CONF"
  fi
  nginx -t && systemctl reload nginx
  echo -e "${GREEN}  Nginx обновлён${NC}"
else
  echo -e "${GREEN}  Nginx OK${NC}"
fi

# Ensure uploads directory permissions
mkdir -p "$APP_DIR/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/uploads"
chmod 770 "$APP_DIR/uploads"

# ---- 6. Restart ----
echo -e "${YELLOW}[6/6] Перезапуск сервиса...${NC}"
systemctl restart zapret-tracker

sleep 2

if systemctl is-active --quiet zapret-tracker; then
  echo ""
  echo -e "${GREEN}  Обновление завершено! Сервис работает.${NC}"
  echo ""

  # Show version info
  COMMIT=$(cd /tmp && git ls-remote "$REPO" HEAD 2>/dev/null | cut -c1-7 || echo "?")
  echo -e "  Коммит:  ${CYAN}${COMMIT}${NC}"
  echo -e "  Статус:  ${GREEN}$(systemctl is-active zapret-tracker)${NC}"
  echo -e "  Uptime:  $(systemctl show zapret-tracker --property=ActiveEnterTimestamp --value)"
  echo ""
else
  echo ""
  echo -e "${RED}  Сервис не запустился!${NC}"
  echo -e "  Смотри логи: ${YELLOW}journalctl -u zapret-tracker -n 30${NC}"
  echo ""
  exit 1
fi
