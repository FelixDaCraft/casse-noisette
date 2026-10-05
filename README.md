<div align="center">

# 🥜 Casse-Noisette

### Itinéraires de collage — toute la France, département par département

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

### 🪪 Espace militant (`/connexion`, `/profil`)
- 🔒 **Réservé aux militants FI** : sans session, toute page renvoie vers `/connexion`
  (`middleware.ts` + `requireMilitant()` côté serveur ; `/api/optimize` répond 401).
- 🔑 Connexion **par Action Populaire** (OAuth2 *authorization code* + PKCE, `state` anti-CSRF).
  Le fournisseur est derrière une interface (`lib/actionPopulaire.ts`) : **simulation** hors
  production (faux comptes, `/connexion/simulation`), vrai AP dès que le client OAuth est
  configuré (`AP_CLIENT_ID` / `AP_CLIENT_SECRET`). Accès refusé à qui n'est membre d'aucun
  groupe d'action (comme TokTok).
- 👤 **Profil** : identité, département, groupes d'action et rôle, repris d'AP à chaque
  connexion ; « Mon activité » liste ses derniers signalements.

### 🌍 Tournées (`/`, militants connectés)
- 🇫🇷 **Un département à la fois** — la page ne charge que les tournées du département
  choisi (`/?dep=44`), sinon du dernier consulté sur l'appareil (cookie `cn_dep`), sinon
  de celui du militant. Un département sans tournée ouvre la carte avec un message.
- 🗺️ **Carte de France** (`/carte`) — SVG cliquable, métropole + encarts outre-mer et
  Paris/petite couronne ; départements avec tournées en violet, compteurs au toucher.
  Recherche texte (commune, quartier, circonscription, département, code).
- 🧭 **Ordre de passage adapté au point de départ** — les panneaux sont réordonnés
  automatiquement pour que le trajet soit le plus court **depuis là où tu te trouves**,
  sur les **distances réelles par la route** (à pied / vélo / voiture).
- 🚩 **État des panneaux, signalé par les militants** — collé par nous, recouvert,
  arraché, tagué (à photographier pour une plainte), vide, absent. Dans le détail d'une
  tournée, chaque panneau montre son état courant (« Tagué · il y a 2 j par Camille L. »)
  et deux gestes : **« J'ai collé »** en un tap, ou **« Signaler »**, qui ouvre une feuille
  avec les états en gros boutons (le marqueur sur la carte l'ouvre aussi). La liste
  affiche le nombre de panneaux **à repasser** par tournée et l'âge du dernier constat, et
  un filtre « À repasser » (`/?filtre=repasser`). Historique complet conservé ; l'état
  courant est le dernier signalement. Anti-abus : pas deux signalements du même panneau
  par le même militant en moins de 10 min (sauf « collé » juste après un autre état),
  30 max par 5 min.
- 🗺️ **Google Maps** — itinéraire multi-arrêts + **lancement direct du GPS** (`dir_action=navigate`), toujours depuis la position de l'utilisateur.
- 📨 **Partage Telegram** par itinéraire.
- 🚶🚲🚗 Sélecteur de mode + option « depuis ma position ».
- 💎 Charte LFI 2027 (violet, rouge, crème ; *Public Sans* + *Gowun Batang*).
- 📲 **PWA** installable + **fonctionne hors-ligne** (service worker).

### 🔐 Backoffice (`/admin`)
- 🔑 Connexion **email + mot de passe** (comptes en base, sessions signées HMAC).
- 📋 Itinéraires : **créer / renommer / réordonner / supprimer**.
- 📍 Panneaux : **carte Leaflet** — clic pour ajouter, glisser-déposer pour déplacer ;
  renommer / réordonner / supprimer. **Max 10 panneaux** par itinéraire (limite Google Maps).
- 🚫 **Signalés absents** (`/admin/absents`) : panneaux dont le dernier état est « absent »,
  ceux signalés 2 fois ou plus en tête, avec la suppression (de toutes les tournées).
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

Itinerary ──< Stop >── Panel
  Itinerary  id, name, city (groupe), kind (ville|circo), department, position
  Stop       itineraryId, panelId, position        (max 10 / itinéraire)
  Panel      id, name, lat, lng, city, district, quarter, department

  department = code INSEE (« 44 », « 2A », « 974 ») ; `city` d'une tournée
  (« 4ème circonscription », « Nantes · Centre-ville ») n'est unique qu'au sein
  de son département.

PasswordReset
  id, adminId, tokenHash, expiresAt, usedAt   (usage unique, 1 h)

Militant ──< Membership >── ActionGroup
  Militant    apId (unique), email?, firstName?, lastName?, displayName,
              image?, department?, postalCode?, city?, active, lastLoginAt
  ActionGroup apId (unique), name, type, department?, city?
  Membership  role : abonne | membre | gestionnaire | animateur

Panel ──< Report >── Militant
  Report      panelId, militantId? (SetNull), status, comment?, createdAt
  status      colle | recouvert | arrache | tague | vide | absent
  L'état courant d'un panneau = son dernier Report (DISTINCT ON, lib/signalements.ts).
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
npm run db:seed             # admin initial + import des itinéraires
npm run dev                 # → http://localhost:3000
```

> Nécessite un PostgreSQL accessible via `DATABASE_URL`.

### Tester sur les vraies données

`scripts/dev-db.sh` monte un Postgres local chargé avec une **copie** des données
de production, pour travailler sur les vrais itinéraires sans jamais toucher à
la prod :

```bash
# dump de la prod (lecture seule), à refaire quand on veut rafraîchir la copie
ssh root@192.168.1.122 'docker exec casse-noisette-db pg_dump -U casse -d casse_noisette' \
  > ../casse-noisette-dev-data/prod-dump.sql

sudo ./scripts/dev-db.sh     # Postgres jetable sur 127.0.0.1:5435
npm run dev
```

`sudo` n'est requis que parce que le compte n'est pas dans le groupe `docker`.
`sudo ./scripts/dev-db.sh reset` recharge le dump à neuf, `stop` arrête la base.

---

## 🔧 Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres (docker-compose) |
| `SESSION_SECRET` | Clé HMAC des sessions admin (`openssl rand -hex 32`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Compte admin créé au 1ᵉʳ seed |
| `NEXT_PUBLIC_SITE_URL` | URL publique (liens dans les emails) |
| `SITE_URL` | URL publique lue à l'exécution : `redirect_uri` de la connexion Action Populaire |
| `AP_CLIENT_ID` / `AP_CLIENT_SECRET` | Client OAuth Action Populaire (à demander à l'équipe numérique LFI) |
| `AP_MOCK` | `1` force la simulation (même en prod, à éviter), `0` la coupe en dev |
| `AP_SCOPES` / `AP_BASE_URL` / `AP_*_URL` | Réglages fins du fournisseur (valeurs par défaut d'après le code d'AP) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP (Resend) — optionnel |
| `MAIL_FROM` | Expéditeur des emails de reset |
| `OSRM_URL_DRIVING` / `OSRM_URL_BICYCLING` / `OSRM_URL_WALKING` | Instance OSRM auto-hébergée, une URL par mode (voir `deploy/osrm/`) — active le mode instantané |
| `OSRM_BASE_URL` | Serveur de routage de repli (défaut : instance publique FOSSGIS) |
| `OSRM_TIMEOUT_MS` / `OSRM_MIN_GAP_MS` / `OPTIMIZE_BUDGET_MS` | Réglages fins du routage (valeurs par défaut adaptées automatiquement) |

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
        │      ⏱ au-delà de OPTIMIZE_BUDGET_MS on n'attend plus (le calcul
        │         continue en fond ; avec une instance dédiée, tout tient
        │         largement dans le budget et rien n'est différé)
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

### Deux vitesses selon le moteur de routage

| | Instance dédiée (`deploy/osrm/`) | Instance publique FOSSGIS (défaut) |
|---|---|---|
| Temps de réponse | ~20 ms | ~8,5 s dès la 2ᵉ requête (mesuré) |
| Ce que voit le militant | l'ordre exact **dès l'affichage** | ordre au vol d'oiseau, puis affinage ~10 s après |
| Requêtes par page | 2, sans file d'attente | 2, sérialisées et espacées |
| Mise en place | `deploy/osrm/README.md` | aucune |

L'application bascule toute seule dès qu'une variable `OSRM_URL_*` est définie.
Sans aucun routage disponible, tout continue de fonctionner au vol d'oiseau.

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
        ├─ renseigner-departements     (idempotent, sort aussitôt si rien à faire)
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
- Hors-ligne **seulement pour un militant déjà connecté** : seules `/` et `/profil` sont
  gardées, jamais une redirection vers la connexion ; l'API et les données RSC ne passent
  pas par le cache ; l'écran de connexion efface ces pages (téléphone prêté, déconnexion).
- Mise à jour des icônes : **cache-busting versionné** (`?v=N`) pour passer outre le cache
  Cloudflare sans purge + **bump du nom de cache** du service worker.

---

## 🧠 Notes & pièges (à ne pas refaire)

- 🔟 **Limite de 10 panneaux** par itinéraire (limite Google Maps) — gardée **côté serveur**
  *et* dans l'éditeur.
- 🧩 `prisma db push` (pas de fichiers de migration), comme un `drizzle-kit push`.
- 📂 Le dossier `public/` doit exister (sinon le `COPY` du Dockerfile échoue).
- 🔁 Les **artefacts générés** (`site/`, `.next/`, `node_modules/`) ne sont pas versionnés.

### 🇫🇷 Départements et carte de France

```bash
node prisma/renseigner-departements.mjs [--dry] [--tout]   # département des panneaux puis des tournées
node prisma/generer-tournees.mjs [--ville] [--circo] [--dep=44]   # groupes propres à chaque département
node scripts/generer-carte-france.mjs                      # régénère app/carteFrance.json (Etalab, ODbL)
```

- Les panneaux sont rattachés par point-dans-polygone sur les contours des
  circonscriptions (data.gouv, codes `ZA…ZS` convertis en `971…975`). Une tournée prend
  le département de la majorité de ses panneaux.
- Depuis le backoffice, un panneau créé ou déplacé reçoit son département via
  `geo.api.gouv.fr` (repli : son plus proche voisin connu), puis ses tournées sont recalées.
