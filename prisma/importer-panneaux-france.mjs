// Importe les panneaux d'affichage libre de toute la France.
//
//   node prisma/importer-panneaux-france.mjs [--dry] [--sans-osm] [--osm=fichier.json]
//
// Il n'existe pas d'inventaire national : on consolide deux familles de sources,
// toutes en licence ouverte.
//  - Les jeux publiés par les communes et métropoles sur data.gouv.fr (Lyon et
//    sa métropole, Paris, Toulouse, Brest, Rennes, Tours, Angers, Mulhouse…).
//    Chacun a son format : on reconnaît les champs usuels plutôt que d'écrire
//    un adaptateur par jeu. Nantes Métropole et Saint-Nazaire ont leurs propres
//    importeurs et ne sont pas repris ici.
//  - OpenStreetMap (ODbL) : panneaux `advertising=board|column|poster_box`
//    marqués `message=opinions;non_profit`. Les panneaux `political` non
//    permanents sont les panneaux électoraux, posés le temps d'un scrutin : on
//    les écarte.
//
// Les sources officielles passent d'abord ; un point OSM à moins de SEUIL_M
// d'un panneau déjà connu (en base ou venu d'une autre source) est un doublon.
// Au sein d'une même source, deux panneaux voisins restent distincts : une
// place en a souvent deux.
//
// Overpass sature souvent sur une requête nationale, même découpée par région :
// `--osm=fichier.json` relit une extraction déjà faite (tableau d'éléments
// Overpass `out center tags`) au lieu d'interroger le serveur.
//
// Commune, quartier (arrondissements de Paris, Lyon, Marseille) et, à défaut
// de mieux, nom de la rue viennent du géocodage inverse de la Base Adresse
// Nationale. Département et circonscription sont attribués ensuite par
// `renseigner-departements.mjs`.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const SANS_OSM = process.argv.includes('--sans-osm');
const OSM_FICHIER = process.argv.find((a) => a.startsWith('--osm='))?.slice(6);
const SEUIL_M = 40;
const UA = { 'User-Agent': 'casse-noisette/1.0 (outil de collage militant)' };

/** Jeux data.gouv.fr retenus (identifiants de jeu : l'URL de la ressource est
 *  relue à chaque import, elle change au gré des republications). */
const JEUX = [
  '5be560f106e3e70c7877c6f4', // Mulhouse
  '6642d42e8c96067c3e003fc2', // Vezin-le-Coquet
  '6580df72a699be26ad75059e', // Échirolles
  '66aad0bb3a4096c26fd5fbde', // La Rochelle
  '68591fb08167b899db48e834', // Soissons
  '5cb5ec689ce2e77ac1bc889f', // Grand Paris Seine Ouest
  '62293fc1204c69cfb83e0c5d', // Anglet
  '61ef3f5530d094f06d86ff5f', // Tours Métropole
  '6ab70c3355b2020a2104fa64', // Roubaix
  '6556e5d7b99444f30002ccba', // Angers Loire Métropole
  '6300257b6d4c45dd5249e2d8', // Saint-Denis (La Réunion)
  '630d7d6f694345811b49e2e7', // Rennes
  '68518df1262be8f490adfe7a', // Fleury-sur-Orne
  '6622ea18d2f7123b5859269a', '651b3e94a84c7347daee1554', '651b3e24f047cada6be20694', // métropole de Lyon…
  '651b3e95fde724e44893a230', '68800a9846da147edd7bb231', '651b3e3c9bb54b498f5b2219',
  '6674a717b3fd9de66ad4640e', '651b3e93837be138d8d7f616', '651b3e94470407ddac4cfefc',
  '670d9555f40b85ffb77b0b87', '651b3e953d4ee8399009851d', '651b3e6c644b7e35fdf8ba8f',
  '651b3e93837be138d8d7f615', '651b3e41644b7e35fdf8ba8d', '66e213999b5af4adf8c7c2db',
  '651b3e9287828b214320a60c', '651b3e63837be138d8d7f613',
  '67f5bad103325228295b7df9', // Talence
  '67f5bad503325228295b7e04', // Le Haillan
  '626a5536ea72f5161893e933', // Antibes
  '595c271aa3a7296408d69b91', // Issy-les-Moulineaux
  '65a71ecc03ae75d2de5aa47f', // Clermont-Ferrand
  '5e9e7096ad642714ec18094a', // Toulouse
];

/** Sources hors data.gouv, ou dont la ressource publiée là-bas est inutilisable. */
const DIRECTES = [
  { nom: 'Paris', url: 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/panneaux_d_affichage_associatifs/exports/json' },
  { nom: 'Brest métropole', url: 'https://geo.brest-metropole.fr/arcgis/rest/services/public/GPB_ESP/MapServer/1410002/query?where=1%3D1&outFields=*&outSR=4326&f=geojson' },
];

/** Régions (ISO 3166-2) interrogées une à une : la France d'un bloc dépasse
 *  le temps accordé par les serveurs Overpass. */
const REGIONS = ['FR-ARA', 'FR-BFC', 'FR-BRE', 'FR-CVL', 'FR-COR', 'FR-GES', 'FR-HDF', 'FR-IDF', 'FR-NOR',
  'FR-NAQ', 'FR-OCC', 'FR-PDL', 'FR-PAC', 'FR-GP', 'FR-MQ', 'FR-GF', 'FR-RE', 'FR-YT'];
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const CLES_NOM = ['adresse', 'adresse_emplacement', 'adresse_localisation', 'localisation', 'localisati', 'lieux',
  'rue', 'rue_d_installation', 'nom_rue', 'nom_voie', 'num_voie', 'libelle', 'nom'];
const CLES_PRECISION = ['infoloc', 'complement_adresse', 'comp_loc', 'details_emplacement', 'precisions', 'quartier'];
const NOMS_GENERIQUES = /^(panneau|affichage|panneau d'affichage libre|panneau d'expression)$/i;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Métropole, Corse et outre-mer : de quoi rejeter les coordonnées inversées
 *  ou en Lambert 93 qu'on trouve dans certains jeux. */
const enFrance = ({ lat, lng }) =>
  (lat > 41 && lat < 51.2 && lng > -5.3 && lng < 9.7) ||
  (lat > -21.5 && lat < -20.8 && lng > 55.1 && lng < 55.9) || // La Réunion
  (lat > 15.8 && lat < 16.6 && lng > -61.9 && lng < -61) || // Guadeloupe
  (lat > 14.3 && lat < 14.9 && lng > -61.3 && lng < -60.7) || // Martinique
  (lat > 2 && lat < 6 && lng > -54.7 && lng < -51.5) || // Guyane
  (lat > -13.1 && lat < -12.6 && lng > 45 && lng < 45.4); // Mayotte

/** Titre « Rue de la Paix » plutôt que « RUE DE LA PAIX ». */
function adoucir(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t !== t.toUpperCase()) return t;
  const petits = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'au', 'aux', 'en', 'sur', "d'", "l'"]);
  return t.toLowerCase().replace(/[\p{L}']+/gu, (m, i) => (i && petits.has(m) ? m : m[0].toUpperCase() + m.slice(1)));
}

/** Coordonnées d'un enregistrement, quel que soit le format du jeu. */
function coordonnees(r) {
  const k = Object.fromEntries(Object.entries(r).map(([c, v]) => [c.toLowerCase().trim(), v]));
  for (const v of Object.values(k)) {
    if (v && typeof v === 'object' && 'lat' in v && ('lon' in v || 'lng' in v)) return { lat: +v.lat, lng: +(v.lon ?? v.lng) };
  }
  for (const c of ['geo_point_2d', 'coordonnees_geo', 'coordinates', 'geo_point', 'coordonnees']) {
    if (typeof k[c] === 'string' && k[c].includes(',')) {
      const [a, b] = k[c].replace(/[[\]]/g, '').split(',').map(Number);
      if (enFrance({ lat: a, lng: b })) return { lat: a, lng: b };
    }
  }
  for (const [a, b] of [['latitude', 'longitude'], ['lat', 'lon'], ['lat', 'lng']]) {
    if (k[a] != null && k[b] != null) return { lat: +String(k[a]).replace(',', '.'), lng: +String(k[b]).replace(',', '.') };
  }
  return null;
}

/** Nom lisible : l'adresse, complétée d'une précision de lieu si le jeu en a. */
function nomDe(r) {
  const k = Object.fromEntries(Object.entries(r).map(([c, v]) => [c.toLowerCase().trim(), v]));
  const nom = CLES_NOM.map((c) => k[c]).find((v) => typeof v === 'string' && v.trim() && !NOMS_GENERIQUES.test(v.trim()));
  if (!nom) return null;
  const prec = CLES_PRECISION.map((c) => k[c]).find((v) => typeof v === 'string' && v.trim());
  const base = adoucir(nom);
  return prec && !base.toLowerCase().includes(String(prec).toLowerCase().trim()) ? `${base} — ${adoucir(prec)}` : base;
}

/** Lit une ressource (GeoJSON, JSON en lignes, CSV) et en tire les points. */
function points(texte) {
  const brut = texte.trim();
  if (brut.startsWith('{') || brut.startsWith('[')) {
    const j = JSON.parse(brut);
    if (j.features) {
      return j.features.flatMap((f) => {
        const g = f.geometry;
        if (!g?.coordinates) return [];
        const c = g.type === 'Point' ? g.coordinates : g.type === 'MultiPoint' ? g.coordinates[0] : null;
        return c ? [{ lat: c[1], lng: c[0], props: f.properties ?? {} }] : [];
      });
    }
    const lignes = Array.isArray(j) ? j : j.results ?? [];
    return lignes.flatMap((r) => { const c = coordonnees(r); return c ? [{ ...c, props: r }] : []; });
  }
  // CSV : séparateur deviné sur la première ligne.
  const [entete, ...lignes] = brut.split(/\r?\n/);
  const sep = (entete.match(/;/g) ?? []).length > (entete.match(/,/g) ?? []).length ? ';' : ',';
  const cols = entete.split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
  return lignes.flatMap((l) => {
    const v = l.split(sep).map((c) => c.replace(/^"|"$/g, ''));
    const r = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    const c = coordonnees(r);
    return c ? [{ ...c, props: r }] : [];
  });
}

const PREFERES = ['geojson', 'json', 'csv'];

async function lireJeu(id) {
  const meta = await (await fetch(`https://www.data.gouv.fr/api/1/datasets/${id}/`, { headers: UA })).json();
  const ressources = (meta.resources ?? [])
    .filter((r) => PREFERES.includes((r.format ?? '').toLowerCase()))
    .sort((a, b) => PREFERES.indexOf(a.format.toLowerCase()) - PREFERES.indexOf(b.format.toLowerCase()));
  for (const r of ressources) {
    try {
      const res = await fetch(r.url, { headers: UA, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) continue;
      const pts = points(await res.text()).filter(enFrance);
      if (pts.length) return { nom: meta.title, pts };
    } catch { /* ressource suivante */ }
  }
  return { nom: meta.title, pts: [] };
}

async function lireDirecte({ nom, url }) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90_000) });
  return { nom, pts: points(await res.text()).filter(enFrance) };
}

/** Panneaux d'expression libre permanents d'OpenStreetMap, région par région. */
async function lireOsm() {
  const vus = new Map();
  if (OSM_FICHIER) for (const e of JSON.parse(readFileSync(OSM_FICHIER, 'utf-8'))) vus.set(`${e.type}/${e.id}`, e);
  for (const region of OSM_FICHIER ? [] : REGIONS) {
    const q = `[out:json][timeout:180];area["ISO3166-2"="${region}"]->.a;` +
      `nwr["advertising"]["message"~"opinion|political|non.profit"](area.a);out center tags;`;
    for (let essai = 1; essai <= 4; essai++) {
      try {
        const res = await fetch(OVERPASS, {
          method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { elements } = await res.json();
        for (const e of elements) vus.set(`${e.type}/${e.id}`, e);
        console.log(`  OSM ${region} : ${elements.length}`);
        break;
      } catch (e) {
        console.warn(`  ! OSM ${region} essai ${essai} : ${e.message}`);
        if (essai === 4) console.warn(`  ! OSM ${region} abandonné : relancer l'import plus tard`);
        else await pause(30_000);
      }
    }
    await pause(3000);
  }
  const garde = (t) => {
    if (!['board', 'column', 'poster_box'].includes(t.advertising)) return false;
    if (t.permanent === 'no') return false; // panneau électoral
    return /opinion|non.profit/.test(t.message ?? '') || t.permanent === 'yes';
  };
  return [...vus.values()].filter((e) => garde(e.tags)).map((e) => ({
    lat: e.lat ?? e.center.lat,
    lng: e.lon ?? e.center.lon,
    props: { nom: e.tags.name, localisation: e.tags.description, infoloc: e.tags['addr:street'] },
  })).filter(enFrance);
}

/** Commune, arrondissement et rue la plus proche (Base Adresse Nationale). */
async function adresseDe({ lat, lng }) {
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const res = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${lng}&lat=${lat}&index=address&limit=1`,
        { headers: UA, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429) { await pause(2000 * essai); continue; }
      const p = (await res.json()).features?.[0]?.properties;
      if (!p || p.distance > 1500) return {};
      return { commune: p.city ?? null, quartier: p.district ?? null, rue: p.street ?? p.name ?? null };
    } catch { await pause(1000 * essai); }
  }
  return {};
}

async function main() {
  const sources = [];
  console.log('Jeux data.gouv.fr…');
  for (const id of JEUX) {
    try {
      const s = await lireJeu(id);
      console.log(`  ${s.pts.length.toString().padStart(4)}  ${s.nom}`);
      sources.push(s);
    } catch (e) { console.warn(`  ! ${id} : ${e.message}`); }
  }
  for (const d of DIRECTES) {
    try {
      const s = await lireDirecte(d);
      console.log(`  ${s.pts.length.toString().padStart(4)}  ${s.nom}`);
      sources.push(s);
    } catch (e) { console.warn(`  ! ${d.nom} : ${e.message}`); }
  }
  if (!SANS_OSM) {
    console.log('OpenStreetMap…');
    sources.push({ nom: 'OpenStreetMap', pts: await lireOsm() });
  }

  // Dédoublonnage : contre la base, puis contre les sources déjà retenues.
  const connus = (await prisma.panel.findMany({ select: { lat: true, lng: true } })).map((p) => ({ ...p, src: 'base' }));
  const grille = new Map(); // ~1 km : évite de comparer chaque point à tous les autres
  const cle = (p, di = 0, dj = 0) => `${Math.floor(p.lat * 100) + di}|${Math.floor(p.lng * 100) + dj}`;
  const ajouterConnu = (p) => { const c = cle(p); if (!grille.has(c)) grille.set(c, []); grille.get(c).push(p); };
  connus.forEach(ajouterConnu);
  const doublon = (p, src) => {
    for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) {
      for (const q of grille.get(cle(p, di, dj)) ?? []) if (q.src !== src && hav(p, q) <= SEUIL_M) return true;
    }
    return false;
  };

  const nouveaux = [];
  let doublons = 0;
  for (const s of sources) {
    const retenus = [];
    for (const p of s.pts) {
      if (doublon(p, s.nom)) { doublons++; continue; }
      retenus.push({ ...p, src: s.nom });
    }
    retenus.forEach(ajouterConnu);
    nouveaux.push(...retenus);
  }
  console.log(`\n${nouveaux.length} panneaux nouveaux, ${doublons} doublons écartés`);

  console.log('Géocodage inverse (Base Adresse Nationale)…');
  const PARALLELE = 8;
  for (let i = 0; i < nouveaux.length; i += PARALLELE) {
    await Promise.all(nouveaux.slice(i, i + PARALLELE).map(async (p) => { p.adresse = await adresseDe(p); }));
    if (i % 400 === 0) console.log(`  ${i}/${nouveaux.length}`);
  }

  const lignes = nouveaux.map((p) => {
    const a = p.adresse ?? {};
    const commune = a.commune ?? p.props.commune ?? p.props.ville ?? null;
    // « Paris 20e Arrondissement » → « 20e arrondissement » : la commune est déjà dans l'en-tête.
    const quartier = a.quartier ? a.quartier.replace(new RegExp(`^${commune}\\s+`), '').replace('Arrondissement', 'arrondissement') : null;
    return {
      name: nomDe(p.props) ?? a.rue ?? 'Panneau d’affichage libre',
      lat: +p.lat.toFixed(6),
      lng: +p.lng.toFixed(6),
      city: commune ? adoucir(commune) : null,
      quarter: quartier,
    };
  });

  const parCommune = new Map();
  for (const l of lignes) parCommune.set(l.city, (parCommune.get(l.city) ?? 0) + 1);
  console.log('Communes les mieux fournies :',
    [...parCommune.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => `${c} ${n}`).join(' · '));
  console.log(`Sans commune : ${parCommune.get(null) ?? 0}`);

  if (DRY) { console.log('\n(--dry : rien écrit)'); return; }
  for (let i = 0; i < lignes.length; i += 500) await prisma.panel.createMany({ data: lignes.slice(i, i + 500) });
  console.log(`\nTotal en base : ${await prisma.panel.count()} panneaux`);
  console.log('Étape suivante : node prisma/renseigner-departements.mjs (département + circonscription)');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
