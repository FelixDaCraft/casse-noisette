#!/usr/bin/env bash
# Écrit docker-compose.yml pour les régions déjà préparées par prepare-regions.sh :
# trois instances par région (voiture, vélo, pied) et la passerelle devant.
#
#   cd /opt/osrm-france && ./generer-compose.sh && docker compose up -d --remove-orphans
#
# À relancer après chaque région préparée : la passerelle n'annonce que les
# régions servies, les autres répondent 503 et l'appli prend ses secours.
#
# Les instances lisent leurs données en --mmap : 54 instances tiennent dans la
# RAM du homelab, le système ne garde en mémoire que les zones réellement
# interrogées. Aucune n'est publiée sur l'hôte ; seule la passerelle l'est, sur
# 127.0.0.1:5099 (tunnels SSH et générateur de tournées).

set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
PRETES=()
for D in data/*/; do
  R=$(basename "$D")
  [ -f "$D/car/region.osrm.mldgr" ] && [ -f "$D/bike/region.osrm.mldgr" ] && [ -f "$D/foot/region.osrm.mldgr" ] && PRETES+=("$R")
done
[ ${#PRETES[@]} -eq 0 ] && { echo "Aucune région prête." >&2; exit 1; }

{
  echo "# Généré par generer-compose.sh — ne pas modifier à la main."
  echo "services:"
  for R in "${PRETES[@]}"; do
    for P in car bike foot; do
      cat <<EOF
  osrm-$P-$R:
    image: $IMAGE
    container_name: osrm-$P-$R
    restart: unless-stopped
    command: osrm-routed --algorithm mld --mmap --max-table-size 600 /data/region.osrm
    volumes:
      - ./data/$R/$P:/data:ro
    networks: [osrm-net]
EOF
    done
  done
  cat <<EOF
  osrm-passerelle:
    image: node:22-alpine
    container_name: osrm-passerelle
    restart: unless-stopped
    working_dir: /app
    command: node serveur.mjs
    environment:
      REGIONS: "${PRETES[*]}"
    volumes:
      - ./passerelle:/app:ro
    ports:
      - '127.0.0.1:5099:5000'
    networks: [osrm-net]
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:5000/sante']
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  osrm-net:
    external: true
EOF
} > docker-compose.yml

echo "Régions servies : ${PRETES[*]}"
