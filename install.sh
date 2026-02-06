#!/bin/bash
set -e

# ============================================================
# Zapret Tracker - Install & Setup Script
# Server: 88.210.52.47 (works on bare IP, no domain needed)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="/opt/zapret-tracker"
APP_USER="zapret-tracker"
SERVER_IP="88.210.52.47"

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Zapret Tracker - Installation${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Run as root (sudo ./install.sh)${NC}"
  exit 1
fi

# ========== Step 1: System packages ==========
echo -e "${YELLOW}[1/7] Installing system packages...${NC}"
apt-get update -qq
apt-get install -y -qq curl wget nginx build-essential python3 git

# ========== Step 2: Node.js ==========
echo -e "${YELLOW}[2/7] Installing Node.js 20.x...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo -e "${GREEN}  Node.js $(node -v)${NC}"
echo -e "${GREEN}  npm $(npm -v)${NC}"

# ========== Step 3: Create app user ==========
echo -e "${YELLOW}[3/7] Setting up user...${NC}"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --home "$APP_DIR" --shell /bin/false "$APP_USER"
  echo -e "${GREEN}  User $APP_USER created${NC}"
else
  echo -e "${GREEN}  User $APP_USER exists${NC}"
fi

# ========== Step 4: Deploy application ==========
echo -e "${YELLOW}[4/7] Deploying application...${NC}"
mkdir -p "$APP_DIR"
cp -r package.json server.js database.js public/ "$APP_DIR/"
cp setup-domain.sh "$APP_DIR/" 2>/dev/null || true
mkdir -p "$APP_DIR/uploads" "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod 770 "$APP_DIR/uploads" "$APP_DIR/data"

echo -e "${YELLOW}  Installing npm dependencies...${NC}"
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --production 2>&1 | tail -3
echo -e "${GREEN}  Dependencies installed${NC}"

# ========== Step 5: Environment config ==========
echo -e "${YELLOW}[5/7] Configuring...${NC}"

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)

  echo ""
  echo -e "${CYAN}--- Telegram Bot Setup ---${NC}"
  echo -e "Авторизация работает через бота (не нужен домен!)."
  echo -e ""
  echo -e "Инструкция:"
  echo -e "  1. Откройте @BotFather в Telegram"
  echo -e "  2. Отправьте /newbot"
  echo -e "  3. Выберите имя и username для бота"
  echo -e "  4. Скопируйте токен"
  echo ""
  read -p "Bot Token (или Enter чтобы пропустить): " BOT_TOKEN
  read -p "Bot Username (без @, например zapret_tracker_bot): " BOT_USERNAME

  # Detect site URL
  SITE_URL="http://${SERVER_IP}"
  read -p "Site URL [${SITE_URL}]: " CUSTOM_URL
  SITE_URL="${CUSTOM_URL:-$SITE_URL}"

  cat > "$ENV_FILE" << EOF
PORT=3000
HOST=127.0.0.1
BOT_TOKEN=${BOT_TOKEN}
BOT_USERNAME=${BOT_USERNAME}
SITE_URL=${SITE_URL}
SESSION_SECRET=${SESSION_SECRET}
EOF

  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo -e "${GREEN}  Config saved to $ENV_FILE${NC}"
else
  echo -e "${GREEN}  Config exists, skipping${NC}"
fi

# ========== Step 6: Systemd service ==========
echo -e "${YELLOW}[6/7] Setting up systemd service...${NC}"

cat > /etc/systemd/system/zapret-tracker.service << EOF
[Unit]
Description=Zapret Tracker
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zapret-tracker
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/data ${APP_DIR}/uploads
PrivateTmp=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable zapret-tracker
echo -e "${GREEN}  Service configured${NC}"

# ========== Step 7: Nginx ==========
echo -e "${YELLOW}[7/7] Configuring Nginx...${NC}"

cat > /etc/nginx/sites-available/zapret-tracker << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 50M;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location /css/ {
        alias /opt/zapret-tracker/public/css/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location /js/ {
        alias /opt/zapret-tracker/public/js/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000/uploads/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        expires 30d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/zapret-tracker /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
echo -e "${GREEN}  Nginx configured${NC}"

# ========== Install zt CLI ==========
echo -e "${YELLOW}Installing zt CLI...${NC}"
if [ -f "zt" ]; then
  cp zt /usr/local/bin/zt
  chmod +x /usr/local/bin/zt
  echo -e "${GREEN}  zt CLI installed${NC}"
elif [ -f "$APP_DIR/zt" ]; then
  cp "$APP_DIR/zt" /usr/local/bin/zt
  chmod +x /usr/local/bin/zt
  echo -e "${GREEN}  zt CLI installed${NC}"
fi

# Copy update script to app dir
cp update.sh "$APP_DIR/update.sh" 2>/dev/null || true
chmod +x "$APP_DIR/update.sh" 2>/dev/null || true

# ========== Start ==========
echo ""
echo -e "${YELLOW}Starting Zapret Tracker...${NC}"
systemctl restart zapret-tracker
sleep 2

if systemctl is-active --quiet zapret-tracker; then
  echo -e "${GREEN}  Service is running!${NC}"
else
  echo -e "${RED}  Failed to start. Check: journalctl -u zapret-tracker -f${NC}"
fi

# ========== Done ==========
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo -e "  URL:     ${GREEN}http://${SERVER_IP}${NC}"
echo -e "  Config:  ${APP_DIR}/.env"
echo ""
echo -e "  ${YELLOW}Управление (zt CLI):${NC}"
echo -e "  ${GREEN}zt update${NC}     — обновить из GitHub"
echo -e "  ${GREEN}zt restart${NC}    — перезапустить"
echo -e "  ${GREEN}zt status${NC}     — статус"
echo -e "  ${GREEN}zt logs${NC}       — логи (live)"
echo -e "  ${GREEN}zt env${NC}        — редактировать .env"
echo -e "  ${GREEN}zt backup${NC}     — бэкап базы"
echo ""
if [ -z "$BOT_TOKEN" ]; then
  echo -e "  ${YELLOW}Telegram бот не настроен!${NC}"
  echo -e "  1. Создайте бота через @BotFather"
  echo -e "  2. sudo zt env  (вписать BOT_TOKEN и BOT_USERNAME)"
  echo ""
fi
echo -e "  ${YELLOW}Админ:${NC} Telegram ID 6483277608 = автоматический админ"
echo ""
