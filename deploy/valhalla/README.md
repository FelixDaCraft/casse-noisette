# Valhalla — guidage du mode Tournée

Moteur d'itinéraire de la navigation guidée (consignes et voix en français,
voiture / vélo / marche dans un seul jeu de données, toute la France).
OSRM (`deploy/osrm/`) reste le moteur du calcul des tournées.

## Construire les tuiles (homelab)

```bash
mkdir -p /opt/valhalla-france && cp construire.sh /opt/valhalla-france/
cd /opt/valhalla-france && ./construire.sh     # ~1 h, ~15 Go
```

Le script fusionne les extraits Geofabrik déjà téléchargés par
`deploy/osrm/prepare-regions.sh` (`/opt/osrm-france/sources`) en un seul
`france.osm.pbf` : donnés tels quels, ces extraits se recouvrent aux frontières
et font planter `valhalla_build_tiles` sur des tuiles incohérentes.

## Servir

```bash
mkdir -p /opt/valhalla && cp docker-compose.yml /opt/valhalla/
cd /opt/valhalla && docker compose up -d
```

Le conteneur `valhalla` rejoint le réseau `osrm-net` ; l'appli le vise par
`VALHALLA_URL="http://valhalla:8002"` (en dev : tunnel SSH `-L 8002:127.0.0.1:8002`).
Le navigateur ne l'appelle jamais : tout passe par `/api/valhalla/route`.
