#!/usr/bin/env bash
# OmniAI Workspace — bitta buyruqli deploy.
# Ishlatish (serverda, loyiha papkasida):  ./deploy/deploy.sh sizning-domen.uz
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.prod

if [ ! -f "$ENV_FILE" ]; then
  DOMAIN="${1:-}"
  if [ -z "$DOMAIN" ]; then
    echo "Birinchi marta domen kerak:  ./deploy/deploy.sh sizning-domen.uz" >&2
    exit 1
  fi
  echo "→ $ENV_FILE yaratilmoqda (maxfiy kalitlar avtomatik)…"
  rand() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }
  FERNET=$(python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())")
  umask 077
  cat > "$ENV_FILE" <<ENV
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(rand 24)
ENCRYPTION_KEY=$FERNET
SECRET_KEY=$(rand 48)
ALLOW_REGISTRATION=true
WEB_CONCURRENCY=2
ENV
  echo "  ✓ Saqlandi. Bu faylni YO'QOTMANG va hech kimga bermang (zaxira nusxa oling)."
fi

echo "→ Obrazlar yig'ilmoqda va ishga tushirilmoqda…"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

DOMAIN=$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2)
echo
echo "✓ Tayyor: https://$DOMAIN"
echo "  Birinchi bo'lib o'zingiz ro'yxatdan o'ting. Keyin boshqalarni yopish uchun"
echo "  .env.prod da ALLOW_REGISTRATION=false qilib, skriptni qayta ishga tushiring."
