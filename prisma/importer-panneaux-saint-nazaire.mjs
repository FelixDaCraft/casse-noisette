// Importe l'inventaire officiel des panneaux d'affichage libre de Saint-Nazaire
// (CARENE, licence ouverte) et rattache chaque panneau à sa circonscription et
// à son secteur de collage.
//
//   node prisma/importer-panneaux-saint-nazaire.mjs [--dry]
//
// Les secteurs sont ceux du groupe d'action de Saint-Nazaire (cinq secteurs,
// chacun avec son référent). L'inventaire ne les connaît pas : on les retrouve
// par le nom de voie, et par la position pour les rues qui traversent deux
// secteurs. Ils vont dans `quarter`, comme les quartiers de Nantes.
//
// Comme pour la métropole, un panneau déjà en base est reconnu par proximité
// et complété plutôt que dupliqué. On ne compare qu'à ce qui existait avant
// l'import : place du Commerce, deux panneaux officiels sont à moins de 60 m.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const SEUIL_M = 60;
const COMMUNE = 'Saint-Nazaire';

const SRC_PANNEAUX =
  'https://data.agglo-carene.fr/api/explore/v2.1/catalog/datasets/214401846_panneaux_affichage/exports/json';
const SRC_CIRCO =
  'https://static.data.gouv.fr/resources/contours-geographiques-des-circonscriptions-legislatives/20240613-191520/circonscriptions-legislatives-p10.geojson';

const SECTEURS = {
  1: 'Saint-Marc',
  2: 'Bouletterie - Trébale - Kerlédé - Sautron',
  3: 'Immaculée - Petit Caporal - Cité scolaire',
  4: 'Hyper-centre - Halles - Mairie - Ville-Port',
  5: 'Nord-Est - Méan - Penhoët',
};

/** Voie → secteur, d'après la liste du groupe d'action. */
const SECTEUR_DE_VOIE = {
  "Route du Fort de l'Eve": 1, "Route de l'Océan": 1, 'Rue Adrien Pichon': 1,
  'Chemin des Infirmières': 1, 'Avenue du Commandant Cousteau': 1,
  'Rue Michel Ange': 2, 'Boulevard Emile Broodcoorens': 2, 'Rue Georges Bizet': 2,
  'Rue Ambroise Paré': 2, 'Place du Roussillon': 2, 'Rue Ferdinand Buisson': 2,
  'Rue Marcel Sembat': 2, 'Chemin de Porcé': 2,
  'Avenue Pierre de Coubertin': 3, 'Rue Etienne Jodelle': 3, 'Rue du Docteur Albert Calmette': 3,
  'Chemin du Point du Jour': 3, 'Boulevard du Docteur René Laënnec': 3, 'Rue Baptiste Marcet': 3,
  'Rue René Guillouzo': 4, 'Rue Pierre Girard de La Cantrie': 4, 'Avenue Suzanne Lenglen': 4,
  'Place du Commerce': 4, 'Rue du Bois Savary': 4, 'Rue des Halles': 4,
  "Avenue d'Herbins": 5, 'Boulevard de la Liberté': 5, 'Rue de la Ville Halluard': 5,
  'Rue de Trignac': 5, 'Passerelle de Prézégat': 5, 'Boulevard Emile Zola': 5,
  'Rue Edgar Degas': 5, 'Place Fernand Guériff': 5,
};

/** Panneaux sans nom de voie dans l'inventaire, identifiés sur la liste du
 *  groupe d'action par leur position. */
const SANS_VOIE = {
  'PANNEAU-DE-SIGNALISATION-15428': { nom: 'Kerlédé — devant le jardin du front de mer', secteur: 2 },
  'PANNEAU-DE-SIGNALISATION-15435': { nom: 'Océanis — en bas du McDo', secteur: 2 },
};

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

  const libres = panneaux.filter((p) => p.usage === 'PANNEAU AFFICHAGE LIBRE' && p.geo_point_2d);
  console.log(`${libres.length} panneaux d'affichage libre dans l'inventaire\n`);

  const existants = await prisma.panel.findMany();
  let crees = 0, reconnus = 0;
  const parSecteur = new Map(), parCirco = new Map();

  for (const p of libres) {
    const lat = +p.geo_point_2d.lat.toFixed(6);
    const lng = +p.geo_point_2d.lon.toFixed(6);
    const voie = p.voie && p.voie !== 'Voie non dénommée' ? p.voie.trim() : null;
    const special = SANS_VOIE[p.identifiant];
    const nom = special?.nom ?? voie;
    const num = special?.secteur ?? SECTEUR_DE_VOIE[voie];
    if (!nom || !num) throw new Error(`Panneau ${p.identifiant} (${p.voie ?? 'sans voie'}) : secteur inconnu`);
    const quartier = SECTEURS[num];
    const district = circoDe(lat, lng);

    parSecteur.set(quartier, (parSecteur.get(quartier) ?? 0) + 1);
    parCirco.set(district, (parCirco.get(district) ?? 0) + 1);

    const proche = existants.find((e) => hav({ lat, lng }, e) <= SEUIL_M);
    if (proche) {
      reconnus++;
      if (!DRY && (!proche.city || !proche.district || !proche.quarter)) {
        await prisma.panel.update({
          where: { id: proche.id },
          data: {
            city: proche.city ?? COMMUNE,
            district: proche.district ?? district,
            quarter: proche.quarter ?? quartier,
          },
        });
      }
      continue;
    }

    if (!DRY) await prisma.panel.create({ data: { name: nom, lat, lng, city: COMMUNE, district, quarter: quartier } });
    crees++;
  }

  console.log(`${crees} panneaux créés`);
  console.log(`${reconnus} déjà présents (reconnus à moins de ${SEUIL_M} m, non dupliqués)\n`);
  console.log('secteurs :', [...parSecteur.entries()].map(([s, n]) => `${s} ${n}`).join(' · '));
  console.log('circonscriptions :', [...parCirco.entries()].map(([c, n]) => `${c} ${n}`).join(' · '));

  if (DRY) console.log('\n(--dry : rien écrit)');
  else console.log(`\nTotal en base : ${await prisma.panel.count()} panneaux`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
