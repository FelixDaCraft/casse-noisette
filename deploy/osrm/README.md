# OSRM auto-hébergé (homelab)

Moteur de calcul d'itinéraires pour l'ordre de passage des panneaux. Sans lui,
l'app utilise l'instance publique FOSSGIS, qui fait patienter ~8 s par requête :
l'ordre s'affiche d'abord au vol d'oiseau puis s'affine. Avec lui, les réponses
tombent en quelques dizaines de millisecondes et **l'ordre exact est prêt avant
même l'affichage de la page**.

Rien n'est exposé sur Internet : les trois services écoutent sur `127.0.0.1`
et ne sont joignables que par l'app Next.js, sur le même hôte. Aucune règle
d'ingress Cloudflare à ajouter.

## Installation (une fois)

```bash
# sur le homelab (192.168.1.122)
mkdir -p /opt/osrm && cd /opt/osrm
# copier docker-compose.yml, prepare.sh et healthcheck.sh depuis deploy/osrm/
./prepare.sh          # télécharge la carte, découpe la zone, prépare les 3 profils
docker compose up -d
./healthcheck.sh      # doit afficher OK sur les trois lignes
```

`prepare.sh` prend 5 à 15 min et occupe ~1,5 Go. Il est **relançable sans
risque** : ce qui est déjà préparé est conservé.

## Branchement côté application

Dans `/opt/casse-noisette-app/.env` :

```bash
OSRM_URL_DRIVING="http://172.17.0.1:5100"
OSRM_URL_BICYCLING="http://172.17.0.1:5101"
OSRM_URL_WALKING="http://172.17.0.1:5102"
```

`172.17.0.1` est l'hôte vu depuis le conteneur `casse-noisette-web` (passerelle
du réseau bridge Docker) ; les ports OSRM n'étant publiés que sur la boucle
locale, c'est cette adresse qu'il faut, pas `127.0.0.1`. Vérifier la passerelle
réelle avec `docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}'`.

Puis `docker compose up -d web` dans `/opt/casse-noisette-app`.

Dès qu'une de ces variables est définie, l'app bascule automatiquement en mode
rapide : plus d'étranglement des requêtes, plus d'affinage différé, le calcul
est attendu et renvoyé directement.

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
