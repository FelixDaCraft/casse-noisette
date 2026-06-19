# Casse-Noisette — itinéraires de collage (4ème circo 44)

Mini-site qui transforme une **Google My Map** d'itinéraires de collage en **liens cliquables**
ouvrant directement Google Maps en mode navigation, avec tous les panneaux déjà chargés.

🔗 **En ligne :** https://casse-noisette.aynn.fr

## Le problème résolu

Google Maps limite une carte à 10 calques / 10 points par itinéraire, affiche tous les
itinéraires en même temps, et oblige à ajouter chaque point à la main. Ici, un clic = un
itinéraire complet prêt à naviguer.

## Fonctionnalités

- **Ouverture en 1 clic** dans Google Maps (itinéraire complet multi-arrêts).
- **OpenStreetMap** : itinéraire complet aussi (moteur OSRM piéton / vélo / voiture).
- **Partage Telegram** par itinéraire.
- Sélecteur de mode (à pied / vélo / voiture) + option « depuis ma position ».
- Design glassmorphism, couleurs LFI, typographies Fraunces + Inter, animations discrètes.
- **PWA installable** (icône Marx casse-noisette) avec **support hors-ligne** via service worker.

## Comment ça marche

Tout tourne **sur le homelab**, aucune intervention depuis un PC :

1. La carte de référence est une Google My Map (les itinéraires + panneaux y sont édités).
2. Un script Python (`generate.py`) télécharge l'export KML, extrait les itinéraires et
   leurs panneaux, et injecte les données dans `template.html` → `site/index.html`.
3. Un **cron** relance `generate.py` toutes les 15 min : la carte est modifiée → le site
   se met à jour tout seul.
4. nginx sert `site/` en direct ; Cloudflare Tunnel l'expose sur `casse-noisette.aynn.fr`.

```
Google My Map ──(KML)──> generate.py ──> site/index.html ──> nginx ──> Cloudflare ──> casse-noisette.aynn.fr
                            ▲
                         cron (*/15)
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `generate.py` | Télécharge le KML, génère `site/index.html` puis copie `static/` → `site/` |
| `template.html` | Gabarit du site ; `__DATA__` est remplacé par les données au build |
| `static/` | Assets PWA : icônes, `favicon.ico`, `manifest.webmanifest`, `sw.js` |
| `nginx.conf` | Conf nginx (type MIME du manifest, no-cache du service worker) |
| `README.md` | Ce fichier |

Fichiers **générés** (non versionnés, voir `.gitignore`) : `site/`, `data.json`, `source.kml`.

## Mettre à jour le contenu

Rien à faire : édite la Google My Map, le cron régénère dans les 15 min.
Pour forcer tout de suite :

```bash
ssh root@192.168.1.122 "cd /opt/casse-noisette && python3 generate.py"
```

## Modifier le code (template / générateur)

Édite `template.html` ou `generate.py`, puis redéploie sur le homelab :

```bash
scp generate.py template.html root@192.168.1.122:/opt/casse-noisette/
ssh root@192.168.1.122 "cd /opt/casse-noisette && python3 generate.py"
```

## Déploiement (rappel infra)

- Conteneur `casse-noisette` (nginx:alpine) sur `127.0.0.1:3023` (homelab `192.168.1.122`).
- Fichiers dans `/opt/casse-noisette/` ; web root `/opt/casse-noisette/site/`.
- Exposé via Cloudflare Tunnel (`aa7c83ec-…`) : ingress `casse-noisette.aynn.fr → localhost:3023`.
- Cron : `*/15 * * * *` → `generate.py` (log : `/var/log/casse-noisette.log`).

## Notes techniques

- Google Maps plafonne à **10 arrêts par trajet** (position de départ comprise).
- Format des liens : `https://www.google.com/maps/dir/?api=1&travelmode=...&origin=...&destination=...&waypoints=a|b|c`
- Coordonnées en `latitude,longitude` (le KML stocke `lng,lat` → inversion à l'extraction).
