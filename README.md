<div align="center">

# 🥜 Casse-Noisette

### Itinéraires de collage — 4ᵉ circonscription de Loire-Atlantique

Application web pour **gérer** et **suivre sur le terrain** les itinéraires de collage d'affiches :
une page publique qui ouvre la navigation GPS d'un clic, et un backoffice complet pour
éditer les itinéraires et les panneaux sur une carte.

🔗 **Site :** [casse-noisette.aynn.fr](https://casse-noisette.aynn.fr) · 🔐 **Admin :** [`/admin`](https://casse-noisette.aynn.fr/admin)

`Next.js 15` · `React 19` · `PostgreSQL` · `Prisma` · `Leaflet` · `PWA`

</div>

---

## 📖 Le problème résolu

Google My Maps limite à **10 calques / 10 points** par itinéraire, affiche tout en même temps,
et oblige à ajouter chaque point à la main. Ici : **un clic = un itinéraire complet** qui se
lance directement en navigation GPS, plus un vrai outil de gestion derrière.

---

## ✨ Fonctionnalités

### 🌍 Public (`/`)
- 🗺️ **Google Maps** — itinéraire multi-arrêts + **lancement direct du GPS** (`dir_action=navigate`).
- 🧭 **OpenStreetMap** — itinéraire multi-arrêts (moteur OSRM piéton / vélo / voiture).
- 📨 **Partage Telegram** par itinéraire.
- 🚶🚲🚗 Sélecteur de mode + option « depuis ma position ».
- 💎 Design glassmorphism aux couleurs LFI (typographies *Fraunces* + *Inter*).
- 📲 **PWA** installable + **fonctionne hors-ligne** (service worker).

### 🔐 Backoffice (`/admin`)
- 🔑 Connexion **email + mot de passe** (comptes en base, sessions signées HMAC).
- 📋 Itinéraires : **créer / renommer / réordonner / supprimer**.
- 📍 Panneaux : **carte Leaflet** — clic pour ajouter, glisser-déposer pour déplacer ;
  renommer / réordonner / supprimer. **Max 10 panneaux** par itinéraire (limite Google Maps).
- 👥 Gestion des **comptes admin** : créer / désactiver / supprimer.
- 🔁 **Reset de mot de passe par email** (jetons à usage unique, valables 1 h, via Resend).

---

## 🏗️ Architecture

```
                              ☁️  CLOUDFLARE
                        (DNS + tunnel + TLS au bord)
                                    │
                   casse-noisette.aynn.fr → localhost:3024
                                    │
   📱 Navigateur ──────────────────┼───────────────────────────────┐
        │                          ▼                                │
        │                ┌──────────────────────┐                  │
        │                │  🐳 casse-noisette-web │                  │
        │   (liens nav)  │  Next.js 15 standalone │                  │
        │                │      :3000 (→3024)     │                  │
        │                └───────────┬───────────┘                  │
        │                            │ Prisma                       │
        │                            ▼                              │
        │                ┌──────────────────────┐                  │
        │                │  🐘 casse-noisette-db  │                  │
        │                │     PostgreSQL 16      │                  │
        │                │      :5432 (→5434)     │                  │
        │                └──────────────────────┘                  │
        │                            │                              │
        │                            ▼ SMTP (reset mdp)             │
        │                       ✉️  Resend                          │
        ▼                                                           │
  🗺️ Google Maps / 🧭 OpenStreetMap / 📨 Telegram  ◄───────────────┘
        (la navigation s'ouvre dans l'app/onglet du téléphone)


   🚀 CI/CD :  git push main ─► GitHub Actions (runner self-hosted homelab)
              └─ npm ci → tsc → docker build → db push + seed → docker compose up
```

- **Reverse proxy / TLS** : Cloudflare Tunnel (pas de Traefik ni Let's Encrypt local).
- **`web` ↔ `db`** : réseau Docker privé interne ; les ports `3024` / `5434` ne sont exposés
  que sur `127.0.0.1` de l'hôte (jamais le LAN).

---

## 🧱 Stack technique

| Domaine | Choix |
|---|---|
| 🖥️ Framework | **Next.js 15** (App Router, Server Actions) · **React 19** · TypeScript |
| 🗄️ Base de données | **PostgreSQL 16** + **Prisma** |
| 🗺️ Carte (éditeur) | **Leaflet** + tuiles OpenStreetMap (sans clé API) |
| 🔐 Auth | Maison : sessions **cookie signé HMAC** + mots de passe **scrypt** (stdlib, zéro dépendance native) |
| ✉️ Email | **nodemailer** (SMTP) via **Resend** |
| 🎨 UI | CSS Modules / global, fonts `next/font` (Fraunces + Inter), glassmorphism |
| 📲 PWA | manifest + service worker (offline, cache-busting versionné) |
| 🐳 Run | Docker (multi-stage, image `standalone`) + docker-compose |
| 🚀 CI/CD | GitHub Actions, **runner self-hosted** sur le homelab |

---

## 🗃️ Modèle de données (`prisma/schema.prisma`)

```
Admin ──< PasswordReset
  id, email (unique), passwordHash (scrypt), active

Itinerary ──< Panel
  id, name, position                 (ordre d'affichage)

Panel
  id, name, lat, lng, position, itineraryId   (max 10 / itinéraire)

PasswordReset
  id, adminId, tokenHash, expiresAt, usedAt   (usage unique, 1 h)
```

---

## 📂 Structure du projet

```
casse-noisette/
├─ app/
│  ├─ layout.tsx            # racine, métadonnées PWA, fonts
│  ├─ globals.css           # design (tokens LFI, glassmorphism, admin)
│  ├─ page.tsx              # page publique (server, lit la DB)
│  ├─ ItineraryList.tsx     # liste publique (client : modes, liens)
│  ├─ RegisterSW.tsx        # enregistrement du service worker
│  ├─ api/health/route.ts   # healthcheck conteneur
│  └─ admin/
│     ├─ actions.ts         # Server Actions (auth, CRUD, reset email)
│     ├─ layout.tsx         # chrome admin (nav)
│     ├─ login / forgot / reset   # connexion + reset mot de passe
│     ├─ page.tsx + ItineraryAdminList.tsx   # dashboard itinéraires
│     ├─ itineraries/[id]/  # éditeur (page + Editor.tsx carte Leaflet)
│     └─ admins/            # gestion des comptes admin
├─ lib/
│  ├─ db.ts                 # client Prisma (singleton)
│  ├─ auth.ts               # sessions signées + getCurrentAdmin / requireAdmin
│  ├─ password.ts           # hash/verify scrypt
│  ├─ reset.ts              # jetons de reset
│  ├─ mail.ts               # envoi SMTP (nodemailer)
│  └─ maps.ts               # liens Google/OSM/Telegram + MAX_PANELS
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.mjs              # admin initial + import itinéraires
│  └─ seed-data.json        # snapshot des 9 itinéraires d'origine
├─ public/                  # icônes PWA, favicon, manifest, sw.js
├─ Dockerfile · docker-compose.yml · .dockerignore
└─ .github/workflows/deploy.yml
```

---

## 💻 Développement local

```bash
cp .env.example .env        # renseigner DATABASE_URL, SESSION_SECRET, SEED_ADMIN_*
npm install
npm run db:push             # crée les tables (sans fichiers de migration)
npm run db:seed             # admin initial + import des 9 itinéraires
npm run dev                 # → http://localhost:3000
```

> Nécessite un PostgreSQL accessible via `DATABASE_URL`.

---

## 🔧 Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres (docker-compose) |
| `SESSION_SECRET` | Clé HMAC des sessions admin (`openssl rand -hex 32`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Compte admin créé au 1ᵉʳ seed |
| `NEXT_PUBLIC_SITE_URL` | URL publique (liens dans les emails) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP (Resend) — optionnel |
| `MAIL_FROM` | Expéditeur des emails de reset |

> 🔒 Le `.env` n'est **jamais** committé. En prod il vit dans `/opt/casse-noisette-app/.env`.

---

## 🚀 Déploiement

**Auto-deploy : un `git push` sur `main` suffit.** ✅

```
git push origin main
   └─► GitHub Actions (runner self-hosted "homelab")
        ├─ npm ci
        ├─ npx tsc --noEmit            (typecheck)
        ├─ docker build                (image standalone)
        ├─ docker compose up -d db
        ├─ prisma db push + seed       (depuis le runner)
        ├─ docker compose up -d web
        └─ healthcheck /api/health
```

| Élément | Valeur |
|---|---|
| 🌐 URL | `https://casse-noisette.aynn.fr` |
| 🐳 Conteneurs | `casse-noisette-web` (`127.0.0.1:3024`) · `casse-noisette-db` (Postgres, `127.0.0.1:5434`) |
| 📁 Dossier hôte | `/opt/casse-noisette-app` (contient le `.env` + `docker-compose.yml`) |
| 🔌 Ingress | Cloudflare Tunnel : `casse-noisette.aynn.fr → http://localhost:3024` |

> ⚠️ **Migrations & seed lancés depuis le runner CI, pas dans le conteneur** : l'image
> Next `standalone` ne trace que le *client* Prisma (pas le CLI complet ni ses dépendances).

---

## ✉️ Email (reset de mot de passe)

- Envoi via **Resend** (SMTP), domaine vérifié **`casse-noisette.aynn.fr`** (région UE).
- Expéditeur : `noreply@casse-noisette.aynn.fr`.
- Flux : `/admin/forgot` → email avec lien signé → `/admin/reset` (jeton **usage unique**, **1 h**).
- Réponse générique (ne révèle pas si un compte existe) ; un échec SMTP ne casse pas le flux.

---

## 📲 PWA

- Installable (icône, écran de démarrage), **fonctionne hors-ligne** (service worker :
  réseau d'abord pour le HTML, cache d'abord pour les assets).
- Mise à jour des icônes : **cache-busting versionné** (`?v=N`) pour passer outre le cache
  Cloudflare sans purge + **bump du nom de cache** du service worker.

---

## 🧠 Notes & pièges (à ne pas refaire)

- 🔟 **Limite de 10 panneaux** par itinéraire (limite Google Maps) — gardée **côté serveur**
  *et* dans l'éditeur.
- 🧩 `prisma db push` (pas de fichiers de migration), comme un `drizzle-kit push`.
- 📂 Le dossier `public/` doit exister (sinon le `COPY` du Dockerfile échoue).
- 🔁 Les **artefacts générés** (`site/`, `.next/`, `node_modules/`) ne sont pas versionnés.
