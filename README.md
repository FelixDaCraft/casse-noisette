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
- 🧭 **Ordre de passage adapté au point de départ** — les panneaux sont réordonnés
  automatiquement pour que le trajet soit le plus court **depuis là où tu te trouves**,
  sur les **distances réelles par la route** (à pied / vélo / voiture).
- 🗺️ **Google Maps** — itinéraire multi-arrêts + **lancement direct du GPS** (`dir_action=navigate`), toujours depuis la position de l'utilisateur.
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
  🗺️ Google Maps  ·  📨 Telegram  ◄─────────────────────────────────┘
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
| `OSRM_BASE_URL` | Serveur de routage pour l'ordre de passage (défaut : instance publique FOSSGIS) |
| `OSRM_TIMEOUT_MS` / `OSRM_MIN_GAP_MS` | Délai max et espacement des requêtes de routage |
| `OPTIMIZE_BUDGET_MS` | Attente max du routage avant de répondre au vol d'oiseau |

> 🔒 Le `.env` n'est **jamais** committé. En prod il vit dans `/opt/casse-noisette-app/.env`.

---

## 🧭 Ordre de passage adapté au point de départ

Google Maps **ne réordonne jamais** les `waypoints` d'un lien `dir/?api=1` : il les
suit tels quels. L'ordre saisi dans le backoffice était donc toujours appliqué,
quel que soit l'endroit d'où partait le militant — d'où des allers-retours inutiles.

La page publique calcule maintenant elle-même le meilleur ordre :

```
navigateur : position GPS
        │
        ▼
POST /api/optimize  { origin, mode, itineraries }
        │
        ├─ matrice panneau↔panneau  ──► OSRM (cache 6 h, une requête groupée
        │                                pour TOUS les itinéraires d'un coup)
        ├─ ligne « ma position → panneaux » ──► OSRM (cache 10 min par zone
        │                                de ~110 m, une seule requête)
        │      ⏱ au-delà de OPTIMIZE_BUDGET_MS on n'attend plus
        │
        ▼
Held-Karp (optimum exact, ≤ 12 arrêts) ──► ordre des panneaux
        │
        ▼
lien Google Maps construit dans cet ordre
```

- **Optimum exact, pas une approximation** : avec au plus 10 panneaux
  (limite Google Maps), la programmation dynamique sur les sous-ensembles donne
  le meilleur ordre en quelques millisecondes. Parcours **ouvert** : on ne
  revient pas au point de départ. Matrices **asymétriques** (sens uniques) gérées.
- **La page ne bloque jamais** : si le routage tarde, elle répond aussitôt avec
  les distances à vol d'oiseau, puis s'affine toute seule dès que les distances
  réelles sont là (le bandeau affiche « affinage par la route… »).
- **Si la position est refusée ou indisponible**, l'ordre du backoffice est
  conservé et le bandeau l'indique, avec un bouton « Réessayer ».
- **Nommage** : un itinéraire nommé automatiquement « Itinéraire de X à Y » voit
  son titre recalculé sur ses extrémités réelles une fois réordonné ; un nom
  saisi à la main est laissé intact.

> ⚠️ **L'instance publique FOSSGIS fait patienter ~8 s par requête** dès la
> deuxième (mesuré). Le cache et le regroupement ramènent ça à **2 requêtes pour
> toute la page**, mais pour un service rapide il faut héberger sa propre
> instance OSRM et renseigner `OSRM_BASE_URL`. Sans routage disponible, tout
> continue de fonctionner au vol d'oiseau.

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
