// Importe l'inventaire officiel des panneaux d'affichage libre de Nantes
// Métropole, et rattache chaque panneau à sa commune et à sa circonscription.
//
//   node prisma/importer-panneaux-metropole.mjs [--dry]
//
// Sources, toutes deux en licence ouverte :
//  - Nantes Métropole, « Panneaux d'affichages libres » (coordonnées, commune,
//    nom de voie, statut) ;
//  - data.gouv.fr, contours des circonscriptions législatives (attribution par
//    point-dans-polygone, aucune table commune→circo à tenir à jour, et les
//    villes découpées entre plusieurs circonscriptions sont traitées justes).
//
// Les panneaux déjà en base sont reconnus par proximité et mis à jour plutôt
// que dupliqués : les tournées existantes ne sont pas touchées. Les panneaux
// démontés ou supprimés de l'inventaire ne sont pas importés.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const SEUIL_M = 60; // un même panneau relevé à la main et par la métropole

const SRC_PANNEAUX =
  'https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_panneaux-affichage-libre-nantes-metropole/exports/json';
const SRC_CIRCO =
  'https://static.data.gouv.fr/resources/contours-geographiques-des-circonscriptions-legislatives/20240613-191520/circonscriptions-legislatives-p10.geojson';

const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

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
  console.log('Téléchargement des sources…');
  const [panneaux, circo] = await Promise.all([
    fetch(SRC_PANNEAUX).then((r) => r.json()),
    fetch(SRC_CIRCO).then((r) => r.json()),
  ]);

  const zones = circo.features
    .filter((f) => f.properties.codeDepartement === '44')
    .map((f) => ({
      nom: f.properties.nomCirconscription,
      polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
    }));

  const circoDe = (lat, lng) =>
    zones.find((z) => z.polys.some((p) => dansPolygone(lng, lat, p)))?.nom ?? null;

  // L'inventaire garde l'historique : on n'importe que ce qui est en place.
  const montes = panneaux.filter((p) => p.statut === 'Monté' && p.geo_point_2d);
  console.log(`${panneaux.length} panneaux dans l'inventaire, ${montes.length} montés\n`);

  const existants = await prisma.panel.findMany();
  let crees = 0, reconnus = 0, completes = 0;
  const parCommune = new Map(), parCirco = new Map();

  for (const p of montes) {
    const lat = +p.geo_point_2d.lat.toFixed(6);
    const lng = +p.geo_point_2d.lon.toFixed(6);
    const commune = (p.commune || '').trim() || null;
    const quartier = (p.quartier || '').trim() || null;
    const district = circoDe(lat, lng);
    const nom = [p.nom_voie, p.complement_adresse].filter(Boolean).join(' — ') || 'Panneau';

    parCommune.set(commune, (parCommune.get(commune) ?? 0) + 1);
    parCirco.set(district, (parCirco.get(district) ?? 0) + 1);

    const proche = existants.find((e) => hav({ lat, lng }, e) <= SEUIL_M);
    if (proche) {
      reconnus++;
      // On complète sans écraser : le nom saisi à la main peut être plus parlant
      // que « Rue X — angle Rue Y », et la position relevée sur le terrain aussi.
      if (!proche.city || !proche.district || (quartier && !proche.quarter)) {
        if (!DRY) {
          await prisma.panel.update({
            where: { id: proche.id },
            data: {
              city: proche.city ?? commune,
              district: proche.district ?? district,
              quarter: proche.quarter ?? quartier,
            },
          });
        }
        proche.city = proche.city ?? commune;
        proche.district = proche.district ?? district;
        proche.quarter = proche.quarter ?? quartier;
        completes++;
      }
      continue;
    }

    if (!DRY) {
      const cree = await prisma.panel.create({ data: { name: nom, lat, lng, city: commune, district, quarter: quartier } });
      existants.push(cree);
    } else {
      existants.push({ id: 'dry', name: nom, lat, lng, city: commune, district, quarter: quartier });
    }
    crees++;
  }

  // Les panneaux relevés à la main que l'inventaire ne connaît pas gardent
  // leur place : on leur attribue au moins une circonscription.
  let orphelins = 0;
  for (const e of existants) {
    if (e.id === 'dry' || e.district) continue;
    const d = circoDe(e.lat, e.lng);
    if (d && !DRY) await prisma.panel.update({ where: { id: e.id }, data: { district: d } });
    if (d) orphelins++;
  }

  console.log(`${crees} panneaux créés`);
  console.log(`${reconnus} déjà présents (reconnus à moins de ${SEUIL_M} m, non dupliqués)`);
  console.log(`${completes} complétés (commune ou circonscription manquante)`);
  console.log(`${orphelins} panneaux hors inventaire rattachés à leur circonscription\n`);

  console.log('communes :', [...parCommune.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · '));
  console.log('\ncirconscriptions :', [...parCirco.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · '));

  if (DRY) console.log('\n(--dry : rien écrit)');
  else console.log(`\nTotal en base : ${await prisma.panel.count()} panneaux`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
