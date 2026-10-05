// Génère la carte de France cliquable (app/carteFrance.json) : un tracé SVG
// par département, métropole plus encarts pour l'outre-mer et pour Paris et
// sa petite couronne — quatre départements trop petits pour le doigt.
//
//   node scripts/generer-carte-france.mjs [fichier.geojson]
//
// Source : contours administratifs Etalab, simplifiés à 1000 m (ODbL —
// attribution affichée sous la carte). Les tracés sont projetés une fois pour
// toutes et arrondis à l'unité : le fichier pèse quelques dizaines de Ko et le
// téléphone n'a rien à calculer.
//
// Projection équirectangulaire corrigée de la latitude moyenne : à l'échelle
// d'un département, l'écart avec Lambert 93 ne se voit pas.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/departements-1000m.geojson';
const SORTIE = new URL('../app/carteFrance.json', import.meta.url);

const LARGEUR = 1000;
const MARGE = 10;
// Métropole et Corse
const METRO = { lng: [-5.2, 9.6], lat: [41.3, 51.15] };
// Encart Paris et petite couronne, dans la Manche (vide à cette latitude).
const IDF = ['75', '92', '93', '94'];
const IDF_FENETRE = { lng: [2.0, 2.7], lat: [48.66, 49.04] };
// Outre-mer, une case chacun sous la métropole, dans cet ordre.
const DROM = [
  ['971', 'Guadeloupe'],
  ['972', 'Martinique'],
  ['973', 'Guyane'],
  ['974', 'La Réunion'],
  ['976', 'Mayotte'],
];
const HAUT_LIBELLE = 34;

const geo = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : await fetch(SRC).then((r) => r.json());

const anneaux = (f) =>
  (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0]);
const parCode = new Map(geo.features.map((f) => [f.properties.code, f]));

/** Projection qui fait tenir l'étendue `ext` dans le cadre {x, y, w, h}. */
function projection(ext, cadre) {
  const lat0 = (ext.lat[0] + ext.lat[1]) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const w = (ext.lng[1] - ext.lng[0]) * kx;
  const h = ext.lat[1] - ext.lat[0];
  const s = Math.min(cadre.w / w, cadre.h / h);
  // Centré dans le cadre
  const ox = cadre.x + (cadre.w - w * s) / 2;
  const oy = cadre.y + (cadre.h - h * s) / 2;
  return {
    s,
    hauteur: h * s,
    p: ([lng, lat]) => [Math.round(ox + (lng - ext.lng[0]) * kx * s), Math.round(oy + (ext.lat[1] - lat) * s)],
  };
}

const aire = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
};

/** Douglas-Peucker sur une ligne de points projetés : en dessous d'une unité
 *  d'écart, un sommet n'apporte rien à l'œil, seulement du poids. */
function simplifier(pts, tol) {
  if (pts.length < 4) return pts;
  const garde = new Uint8Array(pts.length);
  garde[0] = garde[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [i, j] = pile.pop();
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1, n = Math.hypot(dx, dy) || 1;
    let k = -1, dmax = tol;
    for (let m = i + 1; m < j; m++) {
      const d = !dx && !dy
        ? Math.hypot(pts[m][0] - x1, pts[m][1] - y1)
        : Math.abs(dy * (pts[m][0] - x1) - dx * (pts[m][1] - y1)) / n;
      if (d > dmax) { dmax = d; k = m; }
    }
    if (k > 0) { garde[k] = 1; pile.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => garde[i]);
}
/** Anneau fermé : on le coupe au sommet le plus éloigné du premier, sinon
 *  Douglas-Peucker n'a pas de corde pour démarrer. */
function simplifierAnneau(pts, tol) {
  let k = 0, dmax = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > dmax) { dmax = d; k = i; }
  }
  const a = simplifier(pts.slice(0, k + 1), tol);
  const b = simplifier([...pts.slice(k), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

/** Tracé SVG d'un département (coordonnées relatives : plus court). Les îlots de moins de `aireMin` unités²
 *  disparaissent (invisibles et impossibles à toucher) ; le plus grand
 *  morceau est toujours gardé. */
function trace(f, proj, aireMin = 3) {
  const morceaux = anneaux(f)
    .map((r) => {
      const pts = [];
      for (const c of r) {
        const q = proj.p(c);
        const d = pts[pts.length - 1];
        if (!d || d[0] !== q[0] || d[1] !== q[1]) pts.push(q);
      }
      return simplifierAnneau(pts, 0.8);
    })
    .filter((pts) => pts.length >= 3)
    .map((pts) => ({ pts, a: aire(pts) }))
    .sort((a, b) => b.a - a.a);
  return morceaux
    .filter((m, i) => i === 0 || m.a >= aireMin)
    .map(({ pts }) =>
      `M${pts[0][0]} ${pts[0][1]}l` +
      pts.slice(1).map(([x, y], i) => `${x - pts[i][0]} ${y - pts[i][1]}`).join(' ') + 'z')
    .join('');
}

const formes = [];
const cadres = [];

// ── Métropole ──
const cadreMetro = { x: MARGE, y: MARGE, w: LARGEUR - 2 * MARGE, h: 2000 };
const metro = projection(METRO, cadreMetro);
// Le cadre est trop haut à dessein : on recolle la carte en haut.
const metroP = projection(METRO, { ...cadreMetro, h: metro.hauteur });
const codesMetro = geo.features
  .map((f) => f.properties.code)
  .filter((c) => c.length === 2) // 01…95, 2A, 2B ; l'outre-mer a trois chiffres
  .sort();
for (const code of codesMetro) formes.push({ code, d: trace(parCode.get(code), metroP) });
let y = MARGE + Math.round(metroP.hauteur) + 14;

// ── Encart Paris et petite couronne ──
const idfCadre = { x: MARGE, y: MARGE, w: 200, h: 200, libelle: 'Paris et couronne' };
cadres.push(idfCadre);
const idfP = projection(IDF_FENETRE, { x: idfCadre.x + 6, y: idfCadre.y + 6, w: idfCadre.w - 12, h: idfCadre.h - 12 - HAUT_LIBELLE });
for (const code of IDF) formes.push({ code, d: trace(parCode.get(code), idfP, 1), encart: true });

// ── Outre-mer ──
const ECART = 12;
const caseL = (LARGEUR - 2 * MARGE - ECART * (DROM.length - 1)) / DROM.length;
const caseH = 150;
DROM.forEach(([code, libelle], i) => {
  const f = parCode.get(code);
  const lngs = [], lats = [];
  for (const r of anneaux(f)) for (const [a, b] of r) { lngs.push(a); lats.push(b); }
  const ext = { lng: [Math.min(...lngs), Math.max(...lngs)], lat: [Math.min(...lats), Math.max(...lats)] };
  const cadre = { x: Math.round(MARGE + i * (caseL + ECART)), y, w: Math.round(caseL), h: caseH, libelle };
  cadres.push(cadre);
  const p = projection(ext, { x: cadre.x + 8, y: cadre.y + 8, w: cadre.w - 16, h: cadre.h - 16 - HAUT_LIBELLE });
  formes.push({ code, d: trace(f, p, 1), encart: true });
});
const hauteur = y + caseH + MARGE;

const sortie = { viewBox: `0 0 ${LARGEUR} ${hauteur}`, cadres, formes };
writeFileSync(SORTIE, JSON.stringify(sortie));
const ko = (JSON.stringify(sortie).length / 1024).toFixed(1);
console.log(`${formes.length} tracés (${codesMetro.length} en métropole), ${ko} Ko → app/carteFrance.json`);
