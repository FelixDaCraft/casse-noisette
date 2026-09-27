# OSRM auto-hébergé (homelab)

Moteur de calcul d'itinéraires pour l'ordre de passage des panneaux. Sans lui,
l'app utilise l'instance publique FOSSGIS, qui fait patienter ~8 s par requête :
l'ordre s'affiche d'abord au vol d'oiseau puis s'affine. Avec lui, les réponses
tombent en quelques dizaines de millisecondes et **l'ordre exact est prêt avant
même l'affichage de la page**.

Rien n'est exposé sur Internet ni sur le LAN. Les applications y accèdent par
un réseau Docker partagé (`osrm-net`), et l'hôte par des ports publiés sur
`127.0.0.1`. Aucune règle d'ingress Cloudflare à ajouter.

## Installation (une fois)

```bash
# sur le homelab (192.168.1.122)
mkdir -p /opt/osrm && cd /opt/osrm
# copier docker-compose.yml, prepare.sh et healthcheck.sh depuis deploy/osrm/
docker network create osrm-net   # une seule fois, partagé avec les applications
./prepare.sh          # télécharge la carte, découpe la zone, prépare les 3 profils
docker compose up -d
./healthcheck.sh      # doit afficher OK sur les trois lignes
```

`prepare.sh` prend 5 à 15 min et occupe ~1,5 Go. Il est **relançable sans
risque** : ce qui est déjà préparé est conservé.

## Branchement côté application

Dans `/opt/casse-noisette-app/.env` :

```bash
OSRM_URL_DRIVING="http://osrm-car:5000"
OSRM_URL_BICYCLING="http://osrm-bike:5000"
OSRM_URL_WALKING="http://osrm-foot:5000"
```

Le `docker-compose.yml` de l'app joint déjà le réseau `osrm-net`, ce qui rend
ces noms résolvables. **Ne pas utiliser `127.0.0.1:510x` ni la passerelle
`172.17.0.1`** : les ports OSRM n'écoutent que sur la loopback de l'hôte, qu'un
conteneur ne peut pas atteindre, et chaque projet a son propre réseau bridge.

Puis `docker compose up -d web` dans `/opt/casse-noisette-app`.

Pour brancher un autre projet : ajouter `osrm-net` (en `external: true`) à ses
réseaux et appeler les mêmes noms de service.

Dès qu'une de ces variables est définie, l'app bascule automatiquement en mode
rapide : plus d'étranglement des requêtes, plus d'affinage différé, le calcul
est attendu et renvoyé directement.

## Tester depuis le poste de dev

Les ports n'écoutent que sur la boucle locale du homelab. Pour les atteindre
depuis le poste, ouvrir un tunnel SSH le temps du test :

```bash
ssh -N -L 5100:127.0.0.1:5100 -L 5101:127.0.0.1:5101 -L 5102:127.0.0.1:5102 root@192.168.1.122
```

puis renseigner `OSRM_URL_*` sur `http://127.0.0.1:510x` dans le `.env` local.

## Mise à jour de la carte

Une à deux fois par an suffit pour des panneaux d'affichage :

```bash
cd /opt/osrm
rm -rf data/source.osm.pbf data/region.osm.pbf data/car data/bike data/foot
./prepare.sh && docker compose up -d --force-recreate
```

## Réglages

| Variable | Rôle |
|---|---|
| `BBOX` | Zone préparée, `ouest,sud,est,nord`. Par défaut l'agglomération nantaise élargie. L'agrandir couvre plus de terrain au prix du temps de préparation. |
| `REGION_URL` | Extrait Geofabrik source (par défaut Pays de la Loire). |
| `--max-table-size` | Dans `docker-compose.yml` : 200 points par matrice, large devant les ~95 demandés au maximum. |

## Dépannage

- **`healthcheck.sh` en échec** : `docker compose logs osrm-foot` — le plus
  souvent, `prepare.sh` n'a pas fini ou a manqué de mémoire.
- **Coordonnées hors zone** : OSRM renvoie une distance `null`, et l'app retombe
  toute seule sur le vol d'oiseau pour ces points. Élargir `BBOX` si des
  panneaux sortent de la zone.
- **L'app n'utilise pas l'instance** : vérifier les variables dans le `.env` de
  l'app puis recréer le conteneur web (les variables sont lues au démarrage).
