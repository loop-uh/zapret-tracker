#!/bin/bash
set -e

# ============================================================
# Zapret Tracker — DuckDNS + Let's Encrypt Setup
#
# Запуск: sudo ./setup-domain.sh
#
# Что делает:
#   1. Регистрирует поддомен на DuckDNS
#   2. Ставит certbot и получает SSL сертификат
#   3. Обновляет nginx на HTTPS
#   4. Обновляет .env с новым SITE_URL
#   5. Настраивает автообновление сертификата
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="/opt/zapret-tracker"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Запускай от root: sudo $0${NC}"
  exit 1
fi

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  DuckDNS + HTTPS Setup${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ========== Step 1: DuckDNS ==========
echo -e "${YELLOW}Шаг 1: Настройка DuckDNS${NC}"
echo ""
echo -e "  1. Откройте ${CYAN}https://www.duckdns.org${NC}"
echo -e "  2. Войдите через Google/GitHub/Twitter/Reddit"
echo -e "  3. Создайте поддомен (например: ${GREEN}zapret-tracker${NC})"
echo -e "  4. Убедитесь что IP указан как ${GREEN}$(curl -s ifconfig.me || echo '88.210.52.47')${NC}"
echo -e "  5. Скопируйте ваш token со страницы DuckDNS"
echo ""

read -p "Введите имя поддомена (без .duckdns.org, например zapret-tracker): " DUCK_SUBDOMAIN
read -p "Введите DuckDNS token: " DUCK_TOKEN

if [ -z "$DUCK_SUBDOMAIN" ] || [ -z "$DUCK_TOKEN" ]; then
  echo -e "${RED}Поддомен и токен обязательны${NC}"
  exit 1
fi

DOMAIN="${DUCK_SUBDOMAIN}.duckdns.org"
echo ""
echo -e "${YELLOW}Обновляю DNS запись...${NC}"

RESULT=$(curl -s "https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=")
if [ "$RESULT" = "OK" ]; then
  echo -e "${GREEN}  DNS обновлён: ${DOMAIN} -> $(curl -s ifconfig.me)${NC}"
else
  echo -e "${RED}  Ошибка DuckDNS: ${RESULT}${NC}"
  echo -e "  Проверьте поддомен и токен"
  exit 1
fi

# Setup auto-update cron for DuckDNS
mkdir -p /opt/duckdns
cat > /opt/duckdns/duck.sh << EOF
#!/bin/bash
curl -s "https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=" > /opt/duckdns/duck.log 2>&1
EOF
chmod +x /opt/duckdns/duck.sh

# Add cron job (every 5 minutes)
(crontab -l 2>/dev/null | grep -v duckdns; echo "*/5 * * * * /opt/duckdns/duck.sh") | crontab -
echo -e "${GREEN}  Cron задача для обновления IP добавлена${NC}"

# ========== Step 2: Let's Encrypt ==========
echo ""
echo -e "${YELLOW}Шаг 2: Получение SSL сертификата...${NC}"

# Install certbot
apt-get install -y -qq certbot python3-certbot-nginx

# Temporarily update nginx for certbot verification
cat > /etc/nginx/sites-available/zapret-tracker << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$server_name\$request_uri;
    }
}
NGINXEOF

nginx -t && systemctl reload nginx

# Get certificate
certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --email "admin@${DOMAIN}" || {
  echo -e "${RED}Не удалось получить сертификат${NC}"
  echo -e "Убедитесь что:"
  echo -e "  - Порт 80 открыт"
  echo -e "  - DNS запись уже применилась (подождите 1-2 минуты)"
  echo -e "  - Домен ${DOMAIN} резолвится на этот IP"
  exit 1
}

echo -e "${GREEN}  SSL сертификат получен!${NC}"

# ========== Step 3: HTTPS Nginx ==========
echo ""
echo -e "${YELLOW}Шаг 3: Настройка HTTPS nginx...${NC}"

cat > /etc/nginx/sites-available/zapret-tracker << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN} _;
    return 301 https://${DOMAIN}\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 50M;

    add_header X-Frame-Options "ALLOW-FROM https://web.telegram.org" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

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
        alias /opt/zapret-tracker/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINXEOF

nginx -t && systemctl reload nginx
echo -e "${GREEN}  HTTPS настроен!${NC}"

# ========== Step 4: Update .env ==========
echo ""
echo -e "${YELLOW}Шаг 4: Обновление конфигурации...${NC}"

NEW_URL="https://${DOMAIN}"

if [ -f "$APP_DIR/.env" ]; then
  # Update SITE_URL
  if grep -q "SITE_URL=" "$APP_DIR/.env"; then
    sed -i "s|SITE_URL=.*|SITE_URL=${NEW_URL}|" "$APP_DIR/.env"
  else
    echo "SITE_URL=${NEW_URL}" >> "$APP_DIR/.env"
  fi
  echo -e "${GREEN}  SITE_URL обновлён на ${NEW_URL}${NC}"
fi

# ========== Step 5: Restart ==========
echo ""
echo -e "${YELLOW}Шаг 5: Перезапуск...${NC}"
systemctl restart zapret-tracker
sleep 2

if systemctl is-active --quiet zapret-tracker; then
  echo -e "${GREEN}  Сервис работает!${NC}"
else
  echo -e "${RED}  Ошибка запуска${NC}"
  journalctl -u zapret-tracker -n 5 --no-pager
fi

# ========== Step 6: Auto-renew ==========
# Certbot auto-renew is already set up by default
systemctl enable certbot.timer 2>/dev/null || true

# ========== Done ==========
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  HTTPS Setup Complete!${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "  Домен:   ${GREEN}${DOMAIN}${NC}"
echo -e "  URL:     ${GREEN}${NEW_URL}${NC}"
echo -e "  SSL:     Let's Encrypt (автообновление)"
echo -e "  DuckDNS: автообновление IP каждые 5 мин"
echo ""
echo -e "  ${YELLOW}Следующий шаг — настроить бота:${NC}"
echo -e "  1. Откройте @BotFather"
echo -e "  2. Выберите бота -> Bot Settings -> Menu Button"
echo -e "  3. Или просто перезапустите: ${GREEN}sudo zt restart${NC}"
echo -e "     (бот автоматически установит Menu Button)"
echo ""
echo -e "  ${YELLOW}Telegram Mini App готов!${NC}"
echo -e "  Пользователи нажимают кнопку в боте -> трекер"
echo -e "  открывается прямо внутри Telegram."
echo ""
