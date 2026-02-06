#!/bin/bash
set -e

# ============================================================
# Zapret Tracker - Update Script
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR="/opt/zapret-tracker"
APP_USER="zapret-tracker"

echo -e "${YELLOW}Updating Zapret Tracker...${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Run as root${NC}"
  exit 1
fi

# Stop service
echo -e "${YELLOW}Stopping service...${NC}"
systemctl stop zapret-tracker

# Backup database
if [ -f "$APP_DIR/data/tracker.db" ]; then
  BACKUP="$APP_DIR/data/tracker.db.backup.$(date +%Y%m%d%H%M%S)"
  cp "$APP_DIR/data/tracker.db" "$BACKUP"
  echo -e "${GREEN}Database backed up to $BACKUP${NC}"
fi

# Copy new files
echo -e "${YELLOW}Deploying new files...${NC}"
cp -r package.json server.js database.js public/ "$APP_DIR/"

# Install dependencies
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --production 2>&1 | tail -1

# Fix permissions
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Restart
echo -e "${YELLOW}Starting service...${NC}"
systemctl start zapret-tracker

sleep 2
if systemctl is-active --quiet zapret-tracker; then
  echo -e "${GREEN}Update complete! Service is running.${NC}"
else
  echo -e "${RED}Service failed to start. Check: journalctl -u zapret-tracker -f${NC}"
fi
