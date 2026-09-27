#!/usr/bin/env bash
# Base de test locale : un Postgres jetable chargé avec une copie des données de
# production. La prod n'est jamais touchée — on ne fait que relire un dump.
#
#   sudo ./scripts/dev-db.sh            # crée et charge la base
#   sudo ./scripts/dev-db.sh stop       # arrête (les données restent)
#   sudo ./scripts/dev-db.sh reset      # supprime tout et recharge le dump
#
# sudo est nécessaire seulement parce que le compte n'est pas dans le groupe
# docker. Une fois lancée, la base est joignable sur 127.0.0.1:5435.

set -euo pipefail

NAME=casse-noisette-dev-db
PORT=5435
USER=casse
PASS=dev
DB=casse_noisette_dev
DUMP="${DUMP:-$(cd "$(dirname "$0")/../.." && pwd)/casse-noisette-dev-data/prod-dump.sql}"

case "${1:-up}" in
  stop)
    docker stop "$NAME" >/dev/null && echo "arrêtée (les données sont conservées)"
    exit 0
    ;;
  reset)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    ;;
  up) ;;
  *) echo "usage: $0 [up|stop|reset]" >&2; exit 2 ;;
esac

if [ ! -f "$DUMP" ]; then
  echo "Dump introuvable : $DUMP" >&2
  echo "Le régénérer depuis la prod (lecture seule) :" >&2
  echo "  ssh root@192.168.1.122 'docker exec casse-noisette-db pg_dump -U casse -d casse_noisette' > \"$DUMP\"" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker start "$NAME" >/dev/null
  echo "Base déjà présente, redémarrée."
else
  echo "==> Démarrage de Postgres 16 sur 127.0.0.1:$PORT"
  docker run -d --name "$NAME" \
    -e POSTGRES_USER="$USER" -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_DB="$DB" \
    -p "127.0.0.1:$PORT:5432" postgres:16-alpine >/dev/null

  echo "==> Attente de la base"
  for _ in $(seq 1 30); do
    docker exec "$NAME" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1 && break
    sleep 1
  done

  echo "==> Chargement de la copie de production"
  docker exec -i "$NAME" psql -q -U "$USER" -d "$DB" < "$DUMP" >/dev/null
fi

echo "==> Contenu"
for T in Itinerary Panel Admin; do
  N=$(docker exec "$NAME" psql -U "$USER" -d "$DB" -tAc "select count(*) from \"$T\";" 2>/dev/null || echo '?')
  printf '    %-10s %s\n' "$T" "$N"
done

cat <<EOF

Base prête. Dans .env :

    DATABASE_URL="postgresql://$USER:$PASS@127.0.0.1:$PORT/$DB?schema=public"

Puis :  npm run dev
EOF
