#!/usr/bin/env bash
# Prépare les données de routage de toute la France, région par région.
#
#   cd /opt/osrm-france && ./prepare-regions.sh [REGION…]
#
# Une France d'un bloc demande 20 à 30 Go de RAM à l'extraction : le homelab
# n'en a pas autant. Région par région, le pic reste de quelques Go, et les
# instances servent ensuite les données en --mmap (lues sur le disque SSD au
# besoin) au lieu de tout charger en mémoire.
#
# Geofabrik découpe encore la France en anciennes régions : on les fusionne
# dans les 13 régions actuelles (codes ISO 3166-2), pour qu'un trajet
# Lyon → Clermont reste dans un seul jeu de données. Outre-mer : un jeu par
# territoire.
#
# Relançable : une région déjà prête est sautée. Sans argument, toutes.
# Durée : quelques heures pour tout (4 cœurs). Espace : ~40 Go.

set -euo pipefail
cd "$(dirname "$0")"

GEOFABRIK=https://download.geofabrik.de/europe/france
IMAGE="${IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
# Laisse de la marge aux autres services du homelab.
THREADS="${THREADS:-2}"
NICE="nice -n 15 ionice -c3"

declare -A REGIONS=(
  [ara]="auvergne rhone-alpes"
  [bfc]="bourgogne franche-comte"
  [bre]="bretagne"
  [cvl]="centre"
  [cor]="corse"
  [ges]="alsace champagne-ardenne lorraine"
  [hdf]="nord-pas-de-calais picardie"
  [idf]="ile-de-france"
  [nor]="basse-normandie haute-normandie"
  [naq]="aquitaine limousin poitou-charentes"
  [occ]="languedoc-roussillon midi-pyrenees"
  [pdl]="pays-de-la-loire"
  [pac]="provence-alpes-cote-d-azur"
  [gp]="guadeloupe"
  [mq]="martinique"
  [gf]="guyane"
  [re]="reunion"
  [yt]="mayotte"
)

CIBLES=("$@")
[ ${#CIBLES[@]} -eq 0 ] && CIBLES=("${!REGIONS[@]}")

mkdir -p data sources
for R in "${CIBLES[@]}"; do
  PARTIES=${REGIONS[$R]:?région inconnue : $R}
  D="data/$R"
  if [ -f "$D/foot/region.osrm.mldgr" ] && [ -f "$D/bike/region.osrm.mldgr" ] && [ -f "$D/car/region.osrm.mldgr" ]; then
    echo "==> $R : déjà prête"; continue
  fi
  mkdir -p "$D"

  FICHIERS=()
  for P in $PARTIES; do
    if [ ! -f "sources/$P.osm.pbf" ]; then
      echo "==> $R : téléchargement de $P"
      curl -fsSL -o "sources/$P.osm.pbf.part" "$GEOFABRIK/$P-latest.osm.pbf"
      mv "sources/$P.osm.pbf.part" "sources/$P.osm.pbf"
    fi
    FICHIERS+=("/s/$P.osm.pbf")
  done

  if [ ! -f "$D/region.osm.pbf" ]; then
    if [ ${#FICHIERS[@]} -eq 1 ]; then
      cp "sources/$PARTIES.osm.pbf" "$D/region.osm.pbf"
    else
      echo "==> $R : fusion de $PARTIES"
      docker run --rm -v "$PWD/sources:/s" -v "$PWD/$D:/d" debian:12-slim sh -c \
        "apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null && \
         osmium merge ${FICHIERS[*]} -o /d/region.osm.pbf --overwrite"
    fi
  fi

  for P in car bike foot; do
    case "$P" in
      car)  LUA=/opt/car.lua ;;
      bike) LUA=/opt/bicycle.lua ;;
      foot) LUA=/opt/foot.lua ;;
    esac
    [ -f "$D/$P/region.osrm.mldgr" ] && continue
    echo "==> $R/$P : préparation"
    mkdir -p "$D/$P"
    cp "$D/region.osm.pbf" "$D/$P/region.osm.pbf"
    $NICE docker run --rm -v "$PWD/$D/$P:/data" "$IMAGE" osrm-extract -t "$THREADS" -p "$LUA" /data/region.osm.pbf
    $NICE docker run --rm -v "$PWD/$D/$P:/data" "$IMAGE" osrm-partition -t "$THREADS" /data/region.osrm
    $NICE docker run --rm -v "$PWD/$D/$P:/data" "$IMAGE" osrm-customize -t "$THREADS" /data/region.osrm
    rm -f "$D/$P/region.osm.pbf"
  done
  rm -f "$D/region.osm.pbf"
  echo "==> $R : prête ($(du -sh "$D" | cut -f1))"
done
echo "Terminé. Générer les services : ./generer-compose.sh && docker compose up -d"
