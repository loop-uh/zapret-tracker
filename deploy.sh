#!/bin/bash
set -e

# ============================================================
# Zapret Tracker - One-line Deploy to Server
# Usage: ./deploy.sh [user@host]
# ============================================================

SERVER="${1:-root@88.210.52.47}"
REMOTE_DIR="/tmp/zapret-tracker-deploy"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Deploying Zapret Tracker to ${SERVER}...${NC}"

# Create archive
echo -e "${YELLOW}Creating archive...${NC}"
tar czf /tmp/zapret-tracker.tar.gz \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='uploads/*.????????????????????????????????????' \
  package.json server.js database.js public/ install.sh update.sh

# Upload
echo -e "${YELLOW}Uploading to server...${NC}"
scp /tmp/zapret-tracker.tar.gz "${SERVER}:/tmp/"

# Extract and install
echo -e "${YELLOW}Installing on server...${NC}"
ssh "$SERVER" << 'REMOTE'
  set -e
  mkdir -p /tmp/zapret-tracker-deploy
  cd /tmp/zapret-tracker-deploy
  tar xzf /tmp/zapret-tracker.tar.gz
  chmod +x install.sh update.sh

  if [ -d "/opt/zapret-tracker/data" ] && [ -f "/opt/zapret-tracker/data/tracker.db" ]; then
    echo "Existing installation found, running update..."
    bash update.sh
  else
    echo "Fresh installation..."
    bash install.sh
  fi

  rm -rf /tmp/zapret-tracker-deploy /tmp/zapret-tracker.tar.gz
REMOTE

rm -f /tmp/zapret-tracker.tar.gz

echo -e "${GREEN}Deploy complete!${NC}"
echo -e "Open: ${GREEN}http://88.210.52.47${NC}"
