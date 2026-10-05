/* Service worker — Casse-Noisette
   - HTML : réseau d'abord (contenu frais depuis le cron), cache en secours (hors-ligne)
   - Assets (icônes, polices) : cache d'abord, réseau en secours
   Bump CACHE pour forcer le rafraîchissement du shell.

   Les pages sont réservées aux militants connectés :
   - seules les pages militantes (`HORS_LIGNE`) sont gardées, chacune sous son
     propre chemin, et seulement si le serveur les a vraiment servies (pas
     une redirection vers la connexion) ;
   - "/" n'est plus pré-chargé à l'installation : sans session, on aurait
     gardé la page de connexion à sa place ;
   - l'écran de connexion efface ces pages (OublierHorsLigne.tsx) ;
   - ni l'API, ni les données RSC des navigations internes ne passent par le
     cache : elles dépendent de la session. */
const CACHE = "casse-noisette-v7";
// "/" garde le dernier département consulté (/?dep=… est rangé sous "/").
const HORS_LIGNE = ["/", "/carte", "/profil"];
const SHELL = [
  "/manifest.webmanifest?v=4",
  "/icon-192.png?v=3",
  "/icon-512.png?v=3",
  "/apple-touch-icon.png?v=3",
  "/favicon.ico?v=3"
];

self.addEventListener("install", (e) => {
  // add() fichier par fichier + allSettled : l'install réussit même si une ressource échoue
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages : réseau d'abord pour avoir les itinéraires à jour, cache si hors-ligne
  if (req.mode === "navigate") {
    const garder = url.origin === location.origin && HORS_LIGNE.includes(url.pathname);
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (garder && res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(garder ? url.pathname : req)
            .then((r) => r || (garder ? caches.match("/") : undefined))
            .then((r) => r || Response.error())
        )
    );
    return;
  }

  // Dépend de la session : toujours le réseau, jamais le cache.
  if (
    url.origin === location.origin &&
    (url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/connexion") ||
      url.pathname.startsWith("/admin") ||
      url.searchParams.has("_rsc") ||
      req.headers.get("RSC") === "1")
  ) {
    return;
  }

  // Ressources : cache d'abord, sinon réseau (et on met en cache même origine + Google Fonts)
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          const cacheable =
            res.ok &&
            (url.origin === location.origin ||
              url.hostname.endsWith("gstatic.com") ||
              url.hostname.endsWith("googleapis.com"));
          if (cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached)
    )
  );
});
