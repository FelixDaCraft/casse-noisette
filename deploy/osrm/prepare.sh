#!/usr/bin/env bash
# Prépare les données de routage pour les trois profils OSRM.
# À lancer UNE FOIS sur le homelab (et à refaire seulement pour mettre à jour
# la carte OpenStreetMap, une ou deux fois par an suffit).
#
#   cd /opt/osrm && ./prepare.sh
#
# Durée : ~5 à 15 min selon la machine. Espace : ~1,5 Go au total.
# Le découpage par zone (BBOX) est ce qui garde le traitement léger : inutile de
# préparer toute la région Pays de la Loire pour des itinéraires de collage
# en Loire-Atlantique.

set -euo pipefail
cd "$(dirname "$0")"

REGION_URL="${REGION_URL:-https://download.geofabrik.de/europe/france/pays-de-la-loire-latest.osm.pbf}"
# Toute la Loire-Atlantique : Saint-Nazaire et la presqu'île sont hors de
# l'agglomération nantaise, et un point hors zone est rattaché en silence à la
# route la plus proche, ce qui fausse les durées sans rien signaler.
# Format : ouest,sud,est,nord
BBOX="${BBOX:--2.65,46.85,-0.90,47.85}"
IMAGE="${IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"

mkdir -p data
cd data

if [ ! -f source.osm.pbf ]; then
  echo "==> Téléchargement de la carte (~400 Mo, une seule fois)"
  curl -fL --progress-bar -o source.osm.pbf "$REGION_URL"
fi

if [ ! -f region.osm.pbf ]; then
  echo "==> Découpage sur la zone $BBOX"
  docker run --rm -v "$PWD:/d" -w /d debian:12-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null && \
     osmium extract -b '$BBOX' source.osm.pbf -o region.osm.pbf --overwrite"
  ls -lh region.osm.pbf
fi

# car / bike / foot : OSRM ne sert qu'un profil par instance, chacun a son jeu
# de données préparé à partir du même extrait.
for P in car bike foot; do
  case "$P" in
    car)  LUA=/opt/car.lua ;;
    bike) LUA=/opt/bicycle.lua ;;
    foot) LUA=/opt/foot.lua ;;
  esac

  if [ -f "$P/region.osrm.mldgr" ]; then
    echo "==> $P : déjà préparé, on passe"
    continue
  fi

  echo "==> $P : préparation ($LUA)"
  mkdir -p "$P"
  cp region.osm.pbf "$P/region.osm.pbf"
  docker run --rm -v "$PWD/$P:/data" "$IMAGE" osrm-extract -p "$LUA" /data/region.osm.pbf
  docker run --rm -v "$PWD/$P:/data" "$IMAGE" osrm-partition /data/region.osrm
  docker run --rm -v "$PWD/$P:/data" "$IMAGE" osrm-customize /data/region.osrm
  rm -f "$P/region.osm.pbf"
  echo "==> $P : prêt"
done

cd ..
echo
echo "Données prêtes. Démarrage :   docker compose up -d"
echo "Vérification :                ./healthcheck.sh"
