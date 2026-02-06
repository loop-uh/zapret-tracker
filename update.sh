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

# ---- 2. Pull from git ----
echo -e "${YELLOW}[2/5] Загрузка обновлений из GitHub...${NC}"
TMPDIR=$(mktemp -d)
git clone --depth 1 "$REPO" "$TMPDIR" 2>&1 | tail -1
echo -e "${GREEN}  Код загружен${NC}"

# ---- 3. Copy files ----
echo -e "${YELLOW}[3/5] Обновление файлов...${NC}"
cp "$TMPDIR/package.json" "$APP_DIR/"
cp "$TMPDIR/server.js"    "$APP_DIR/"
cp "$TMPDIR/database.js"  "$APP_DIR/"
cp -r "$TMPDIR/public/"   "$APP_DIR/"
cp "$TMPDIR/update.sh"    "$APP_DIR/"
cp "$TMPDIR/install.sh"   "$APP_DIR/"
cp "$TMPDIR/setup-domain.sh" "$APP_DIR/" 2>/dev/null || true

# Не трогаем: .env, data/, uploads/, node_modules/
rm -rf "$TMPDIR"

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

# ---- 5. Restart ----
echo -e "${YELLOW}[5/5] Перезапуск сервиса...${NC}"
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
