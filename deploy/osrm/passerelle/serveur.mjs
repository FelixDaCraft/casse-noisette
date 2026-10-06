// Passerelle OSRM : une seule adresse pour toutes les régions de France.
//
// OSRM ne sert qu'un jeu de données par instance, et la France est préparée
// région par région (prepare-regions.sh). La passerelle lit les coordonnées
// de la requête, trouve la région et transmet à l'instance qui la sert :
//
//   GET /car/table/v1/driving/-1.55,47.21;-1.54,47.20?annotations=…
//     → http://osrm-car-pdl:5000/table/v1/driving/…
//
// L'appli et le générateur de tournées n'en savent rien : leurs variables
// OSRM_URL_DRIVING / _BICYCLING / _WALKING pointent ici (…/car, …/bike, …/foot)
// au lieu d'une instance.
//
// Région d'une requête : celle de la majorité de ses points, et à égalité celle
// du dernier (la destination : un militant venu d'ailleurs va vers un panneau).
// Un point hors de toute région (en mer, à la frontière simplifiée) prend la
// région du contour le plus proche. Une région pas encore préparée répond 503 :
// l'appli retombe alors sur ses solutions de secours.
//
// Sans dépendance : node serveur.mjs (port PORT, défaut 5000).
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 5000);
const CIBLE = process.env.OSRM_CIBLE || 'http://osrm-{profil}-{region}:5000';
const DISPONIBLES = new Set((process.env.REGIONS || '').split(/[\s,]+/).filter(Boolean));
const PROFILS = new Set(['car', 'bike', 'foot']);

const contours = JSON.parse(readFileSync(new URL('./regions.geojson', import.meta.url), 'utf-8')).features.map((f) => ({
  region: f.properties.region,
  polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
}));

/** Outre-mer : un cadre suffit, chaque territoire est isolé. */
const OUTRE_MER = [
  { region: 're', o: 55.1, s: -21.5, e: 55.9, n: -20.8 },
  { region: 'yt', o: 45, s: -13.1, e: 45.4, n: -12.6 },
  { region: 'gp', o: -61.9, s: 15.8, e: -61, n: 16.6 },
  { region: 'mq', o: -61.3, s: 14.3, e: -60.7, n: 14.9 },
  { region: 'gf', o: -54.7, s: 2, e: -51.5, n: 6 },
];

function dansAnneau(lon, lat, anneau) {
  let d = false;
  for (let i = 0, n = anneau.length; i < n; i++) {
    const [x1, y1] = anneau[i];
    const [x2, y2] = anneau[(i + 1) % n];
    if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) d = !d;
  }
  return d;
}

function regionDe(lon, lat) {
  const om = OUTRE_MER.find((b) => lon >= b.o && lon <= b.e && lat >= b.s && lat <= b.n);
  if (om) return om.region;
  for (const c of contours) {
    if (c.polys.some((p) => dansAnneau(lon, lat, p[0]) && !p.slice(1).some((t) => dansAnneau(lon, lat, t)))) return c.region;
  }
  // Hors contour : le sommet le plus proche (distance approchée, suffisante ici).
  let meilleure = null, min = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const c of contours) for (const p of c.polys) for (const [x, y] of p[0]) {
    const d = ((x - lon) * k) ** 2 + (y - lat) ** 2;
    if (d < min) { min = d; meilleure = c.region; }
  }
  return min < 0.25 ? meilleure : null; // ~50 km : au-delà, ce n'est pas la France
}

function regionDeRequete(segment) {
  const points = decodeURIComponent(segment).split(';').map((c) => c.split(',').map(Number));
  if (!points.length || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  const regions = points.map(([x, y]) => regionDe(x, y));
  const compte = new Map();
  for (const r of regions) if (r) compte.set(r, (compte.get(r) ?? 0) + 1);
  if (!compte.size) return null;
  const max = Math.max(...compte.values());
  const derniere = regions.at(-1);
  return compte.get(derniere) === max ? derniere : [...compte.entries()].find(([, n]) => n === max)[0];
}

function repondre(res, statut, corps) {
  res.writeHead(statut, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corps));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://passerelle');
  if (url.pathname === '/sante') return repondre(res, 200, { regions: [...DISPONIBLES] });
  // /{profil}/{service}/{version}/{profil-osrm}/{coordonnées}
  const [, profil, service, version, profilOsrm, coords] = url.pathname.split('/');
  if (!PROFILS.has(profil) || !coords) return repondre(res, 400, { code: 'InvalidUrl', message: 'attendu /{car|bike|foot}/{service}/v1/{profil}/{coordonnées}' });

  const region = regionDeRequete(coords);
  if (!region) return repondre(res, 400, { code: 'InvalidQuery', message: 'coordonnées hors de France' });
  if (DISPONIBLES.size && !DISPONIBLES.has(region)) return repondre(res, 503, { code: 'NoRegion', message: `région ${region} pas encore préparée` });

  const cible = CIBLE.replace('{profil}', profil).replace('{region}', region) +
    `/${service}/${version}/${profilOsrm}/${coords}${url.search}`;
  try {
    const r = await fetch(cible, { signal: AbortSignal.timeout(60_000) });
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json', 'X-Osrm-Region': region });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    repondre(res, 502, { code: 'Unreachable', message: `${region}/${profil} : ${e.message}` });
  }
}).listen(PORT, () => console.log(`passerelle OSRM sur :${PORT}, régions : ${[...DISPONIBLES].join(' ') || 'toutes'}`));
