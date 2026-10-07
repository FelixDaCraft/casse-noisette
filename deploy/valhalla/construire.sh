#!/usr/bin/env bash
# Valhalla France : fusionne les extraits régionaux (qui se recouvrent aux
# frontières) en un seul fichier dédoublonné, puis construit les tuiles.
set -euo pipefail
cd /opt/valhalla-france
SRC=/opt/osrm-france/sources
if [ ! -f fusion/france.osm.pbf ]; then
  echo "==> fusion des extraits"
  nice -n 15 ionice -c3 docker run --rm -v $SRC:/s:ro -v $PWD/fusion:/d debian:12-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null && osmium merge /s/*.osm.pbf -o /d/france.osm.pbf --overwrite"
fi
ln -f fusion/france.osm.pbf custom_files/france.osm.pbf
echo "==> construction des tuiles"
docker run --rm --name valhalla-france-build -v $PWD/custom_files:/custom_files \
  -e server_threads=2 -e build_elevation=False -e build_admins=True -e build_time_zones=True \
  -e build_tar=True -e serve_tiles=False -e force_rebuild=True ghcr.io/valhalla/valhalla-scripted:latest
echo "==> terminé"
