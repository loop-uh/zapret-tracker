#!/bin/bash
set -e

# ============================================================
# Zapret Tracker — Deploy to Server
#
# Использование:
#   ./deploy.sh                   — деплой на 88.210.52.47
#   ./deploy.sh root@my-server    — деплой на свой сервер
#   ./deploy.sh root@my-server install  — полная установка
# ============================================================

SERVER="${1:-root@88.210.52.47}"
ACTION="${2:-auto}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Zapret Tracker — Deploy${NC}"
echo -e "${CYAN}========================================${NC}"
echo -e "  Сервер: ${GREEN}${SERVER}${NC}"
echo ""

# ---- Upload update script and run ----
echo -e "${YELLOW}[1/2] Загрузка скриптов на сервер...${NC}"

# Создаём минимальный пакет со скриптами
tar czf /tmp/zt-deploy.tar.gz install.sh update.sh setup-domain.sh package.json server.js database.js public/

scp -q /tmp/zt-deploy.tar.gz "${SERVER}:/tmp/"
rm -f /tmp/zt-deploy.tar.gz

echo -e "${YELLOW}[2/2] Запуск на сервере...${NC}"
echo ""

ssh -t "$SERVER" << 'REMOTE_SCRIPT'
  set -e
  
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  NC='\033[0m'

  cd /tmp
  mkdir -p zt-deploy && cd zt-deploy
  tar xzf /tmp/zt-deploy.tar.gz
  chmod +x install.sh update.sh

  if systemctl is-active --quiet zapret-tracker 2>/dev/null; then
    echo -e "${GREEN}Сервис найден — обновление...${NC}"
    bash update.sh
  elif [ -d "/opt/zapret-tracker/data" ]; then
    echo -e "${YELLOW}Установка найдена но сервис не запущен — обновление...${NC}"
    bash update.sh
  else
    echo -e "${YELLOW}Первая установка...${NC}"
    bash install.sh
  fi

  cd /tmp && rm -rf zt-deploy zt-deploy.tar.gz
REMOTE_SCRIPT

echo ""
echo -e "${GREEN}Deploy завершён!${NC}"
echo -e "Сайт: ${CYAN}http://88.210.52.47${NC}"
