# Casse-Noisette — itinéraires de collage (4ème circo 44)

Application web pour gérer et consulter des **itinéraires de collage** : page publique
(liens de navigation Google Maps / OpenStreetMap / partage Telegram) + **backoffice**
complet (édition des itinéraires et panneaux sur carte, gestion des comptes admin).

🔗 **En ligne :** https://casse-noisette.aynn.fr · **Admin :** `/admin`

## Stack

Next.js 15 (App Router, TS) · PostgreSQL + Prisma · Leaflet/OpenStreetMap (éditeur carte) ·
auth maison (sessions signées HMAC, mots de passe scrypt). PWA (installable + hors-ligne).

## Fonctionnalités

**Public** (`/`)
- Itinéraires alimentés par la base de données.
- Bouton **Google Maps** : itinéraire multi-arrêts + lancement direct de la navigation GPS (`dir_action=navigate`).
- **OpenStreetMap** (multi-arrêts) + **partage Telegram** par itinéraire.
- Modes à pied / vélo / voiture, option « depuis ma position ».
- Design glassmorphism couleurs LFI (Fraunces + Inter), PWA installable + hors-ligne.

**Admin** (`/admin`)
- Connexion email + mot de passe (comptes en base, sessions signées).
- Itinéraires : créer / renommer / réordonner / supprimer.
- Panneaux : **carte Leaflet** — clic pour ajouter, glisser pour déplacer ; renommer / réordonner / supprimer.
- Gestion des comptes admin : créer / désactiver / supprimer.

## Modèle de données (`prisma/schema.prisma`)

- `Admin` (email, passwordHash scrypt, active)
- `Itinerary` (name, position) → `Panel[]`
- `Panel` (name, lat, lng, position, itineraryId)

## Développement local

```bash
cp .env.example .env          # renseigner DATABASE_URL + SESSION_SECRET + SEED_ADMIN_*
npm install
npm run db:push               # crée les tables
npm run db:seed               # admin initial + import des itinéraires (prisma/seed-data.json)
npm run dev                   # http://localhost:3000
```

## Déploiement (homelab)

- Conteneurs `casse-noisette-web` (port `127.0.0.1:3024`) + `casse-noisette-db` (Postgres 16, `127.0.0.1:5434`).
- Exposé via le Cloudflare Tunnel : `casse-noisette.aynn.fr` → `http://localhost:3024`.
- Secrets dans `/opt/casse-noisette-app/.env` (hors Git, voir `.env.example`).
- **Auto-deploy par `git push` sur `main`** (`.github/workflows/deploy.yml`, runner self-hosted homelab) :
  `npm ci` → `tsc --noEmit` → build image → `db push` + seed (depuis le runner) → `docker compose up`.

> Les migrations/seed sont lancés **depuis le runner CI**, pas dans le conteneur
> (l'image standalone ne trace que le client Prisma, pas le CLI complet).
