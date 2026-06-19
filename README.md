# Casse-Noisette — itinéraires de collage (4ème circo 44)

Mini-site qui transforme une **Google My Map** d'itinéraires de collage en **liens cliquables**
ouvrant directement Google Maps en mode navigation, avec tous les panneaux déjà chargés.

🔗 **En ligne :** https://casse-noisette.aynn.fr

## Le problème résolu

Google Maps limite une carte à 10 calques / 10 points par itinéraire, affiche tous les
itinéraires en même temps, et oblige à ajouter chaque point à la main. Ici, un clic = un
itinéraire complet prêt à naviguer.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | Le site (page statique autonome, données embarquées en JS) |
| `refresh.ps1` | Régénère le site depuis la My Map et le redéploie |
| `data.json` | Données extraites du KML (itinéraires + panneaux) |
| `source.kml` | Export brut de la Google My Map |

## Mettre à jour

Après modification de la My Map (ajout/retrait de panneaux) :

```powershell
pwsh ./refresh.ps1
```

Le script re-télécharge le KML, régénère `index.html` et le redéploie sur le homelab.

## Déploiement

- Conteneur `casse-noisette` (nginx:alpine) sur `127.0.0.1:3023` (homelab).
- Exposé via Cloudflare Tunnel : `casse-noisette.aynn.fr`.
- Fichiers servis depuis `/opt/casse-noisette/site/`.

## Notes techniques

- Google Maps plafonne à **10 arrêts par trajet** (position de départ comprise).
- Format des liens : `https://www.google.com/maps/dir/?api=1&travelmode=...&origin=...&destination=...&waypoints=a|b|c`
- Coordonnées en `latitude,longitude` (le KML stocke `lng,lat` → inversion à l'extraction).
