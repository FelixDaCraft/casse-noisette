// Renseigne le département (code INSEE) des panneaux, puis celui des tournées.
//
//   node prisma/renseigner-departements.mjs [--dry] [--tout]
//
// Les panneaux sont attribués par point-dans-polygone sur les contours des
// circonscriptions législatives (data.gouv.fr, Licence Ouverte) : le même
// fichier que les importeurs, assez précis pour un panneau posé à deux rues
// d'une limite départementale, et un seul test donne département et circo.
// Un panneau sans circonscription la reçoit au passage.
//
// Une tournée prend le département de la majorité de ses panneaux : une
// tournée de circonscription ne déborde jamais, une tournée relevée à la main
// sur une limite reste rattachée au côté où elle colle le plus.
//
// Relançable (le déploiement le lance après `db push`) : sans --tout, seuls
// les panneaux et tournées sans département sont traités ; avec --tout, tout
// est recalculé.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const TOUT = process.argv.includes('--tout');

const SRC_CIRCO =
  'https://static.data.gouv.fr/resources/contours-geographiques-des-circonscriptions-legislatives/20240613-191520/circonscriptions-legislatives-p10.geojson';
/** Le fichier code l'outre-mer en Z… ; la base garde le code INSEE. */
const OUTRE_MER = { ZA: '971', ZB: '972', ZC: '973', ZD: '974', ZM: '976', ZS: '975' };

/** Point dans polygone (rayon horizontal), trous compris. */
function dansPolygone(lon, lat, poly) {
  const pip = (ring) => {
    let d = false;
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      if ((y1 > lat) !== (y2 > lat)) {
        const xi = ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1;
        if (lon < xi) d = !d;
      }
    }
    return d;
  };
  if (!pip(poly[0])) return false;
  return !poly.slice(1).some(pip);
}

async function main() {
  // Lancé à chaque déploiement : sans rien à faire, on sort sans télécharger
  // les 5 Mo de contours.
  if (!TOUT) {
    const [p, t] = await Promise.all([
      prisma.panel.count({ where: { department: null } }),
      prisma.itinerary.count({ where: { department: null, stops: { some: {} } } }),
    ]);
    if (!p && !t) { console.log('Départements : rien à renseigner.'); return; }
  }
  console.log('Téléchargement des contours des circonscriptions…');
  // data.gouv indisponible : on le dit et on sort sans erreur. Le script tourne
  // dans le déploiement, et un site tiers en panne ne doit pas le bloquer ; les
  // panneaux sans département seront traités au déploiement suivant.
  let circo;
  try {
    const r = await fetch(SRC_CIRCO, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    circo = await r.json();
  } catch (e) {
    console.warn(`  ! contours indisponibles (${e.message}) : départements non renseignés cette fois-ci`);
    return;
  }

  // 559 zones : on écarte d'abord par rectangle englobant, sinon chaque
  // panneau testerait des milliers d'anneaux pour rien.
  const zones = circo.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const code = f.properties.codeDepartement;
    return { dep: OUTRE_MER[code] ?? code, circo: f.properties.nomCirconscription, polys, bbox: [x0, y0, x1, y1] };
  });
  const zoneDe = (lat, lng) =>
    zones.find(
      (z) => lng >= z.bbox[0] && lng <= z.bbox[2] && lat >= z.bbox[1] && lat <= z.bbox[3] &&
        z.polys.some((p) => dansPolygone(lng, lat, p)),
    ) ?? null;

  // ── Panneaux ──
  const panneaux = await prisma.panel.findMany({ where: TOUT ? {} : { department: null } });
  console.log(`${panneaux.length} panneau(x) à traiter`);
  const parDep = new Map();
  const horsZone = [];
  let changes = 0;
  for (const p of panneaux) {
    const z = zoneDe(p.lat, p.lng);
    if (!z) { horsZone.push(p); continue; }
    parDep.set(z.dep, (parDep.get(z.dep) ?? 0) + 1);
    const data = {};
    if (p.department !== z.dep) data.department = z.dep;
    if (!p.district) data.district = z.circo;
    if (!Object.keys(data).length) continue;
    changes++;
    if (!DRY) await prisma.panel.update({ where: { id: p.id }, data });
  }
  for (const [d, n] of [...parDep].sort()) console.log(`  ${d} : ${n} panneau(x)`);
  console.log(`${changes} panneau(x) mis à jour`);
  // En mer, sur une île hors contours, ou coordonnées fausses : à corriger à
  // la main dans le backoffice, on ne devine pas.
  for (const p of horsZone)
    console.warn(`  ! hors de toute circonscription : ${p.name} (${p.lat}, ${p.lng}) [${p.id}]`);

  // ── Tournées ──
  const tournees = await prisma.itinerary.findMany({
    where: TOUT ? {} : { department: null },
    include: { stops: { include: { panel: { select: { department: true } } } } },
  });
  // En --dry, les panneaux n'ont pas été écrits : on relit ce qu'on vient de
  // calculer plutôt que la base.
  const calcule = new Map();
  if (DRY) for (const p of panneaux) calcule.set(p.id, zoneDe(p.lat, p.lng)?.dep ?? null);
  let tChanges = 0, sansDep = 0;
  for (const t of tournees) {
    const votes = new Map();
    for (const s of t.stops) {
      const d = calcule.get(s.panelId) ?? s.panel.department;
      if (d) votes.set(d, (votes.get(d) ?? 0) + 1);
    }
    const dep = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!dep) { sansDep++; continue; }
    if (dep === t.department) continue;
    tChanges++;
    if (!DRY) await prisma.itinerary.update({ where: { id: t.id }, data: { department: dep } });
  }
  console.log(`${tournees.length} tournée(s) examinée(s), ${tChanges} mise(s) à jour` +
    (sansDep ? `, ${sansDep} sans panneau situé (laissée(s) sans département)` : ''));

  if (DRY) console.log('\n(--dry : rien écrit en base)');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
