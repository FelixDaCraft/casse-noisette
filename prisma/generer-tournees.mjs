// Construit les tournées, dans les deux vues du site :
//   --ville  une famille par commune       (kind = ville, city = la commune)
//   --circo  une famille par circonscription (kind = circo, city = la circo)
// Sans option, les deux sont régénérées.
//
// Méthode « tourner d'abord, découper ensuite » : on calcule une grande tournée
// optimale sur tous les panneaux de la commune, puis on la tranche en paquets
// de 10 maximum (limite Google Maps). Les paquets sont ainsi géographiquement
// cohérents — découper au hasard donnerait des tournées qui se croisent.
// L'ordre interne de chaque paquet est ensuite re-résolu exactement.
//
// Tout se calcule en **temps de trajet voiture** : les collages se font
// rarement à pied, et en voiture sens interdits et limitations font qu'un
// chemin plus long peut être plus rapide. Deux critères en découlent : la
// durée totale, et l'écart entre tournées d'un même groupe — un militant ne
// doit pas hériter de 80 minutes quand son voisin en a 25.
//
// Les durées viennent de l'instance OSRM (profil voiture). Sans OSRM
// joignable, on retombe sur le vol d'oiseau à vitesse urbaine.
//
//   node prisma/generer-tournees-ville.mjs [--dry] [--ville] [--circo]
//
// Relançable : seules les familles régénérées sont remplacées.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MAX_ARRETS = 10;
/** Au-delà de ce nombre de panneaux, une commune se découpe par quartier.
 *  Seule Nantes est concernée (202 panneaux, la suivante en compte 48) : une
 *  commune qu'on couvre en quatre ou cinq tournées se tient très bien d'un
 *  bloc, et la découper n'ajoute qu'un niveau de lecture inutile. */
const SEUIL_QUARTIER = 100;
const OSRM = process.env.OSRM_URL_DRIVING || 'http://127.0.0.1:5100';
/** Ce qu'on accepte de perdre en durée totale pour resserrer l'écart entre
 *  tournées : une seconde d'écart pèse autant que POIDS_EQUILIBRE secondes de
 *  trajet. Au-delà, on rallonge tout le monde pour aligner deux tournées. */
const POIDS_EQUILIBRE = 2;
const DRY = process.argv.includes('--dry');
const SEULEMENT = ['ville', 'circo'].filter((k) => process.argv.includes(`--${k}`));
const FAMILLES = SEULEMENT.length ? SEULEMENT : ['ville', 'circo'];

const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Matrice des distances par la route ; `null` si OSRM ne répond pas.
 *  Une matrice manquante dégrade silencieusement la qualité des tournées :
 *  on dit toujours pourquoi, et on réessaie une fois (OSRM refuse parfois une
 *  requête quand la précédente occupe encore tous ses threads). */
async function matriceOsrm(points, etiquette = '') {
  if (points.length < 2) return null;
  const path = points.map((p) => `${p.lng},${p.lat}`).join(';');
  for (let essai = 1; essai <= 2; essai++) {
    try {
      // `connection: close` : plusieurs minutes de calcul séparent deux groupes,
      // OSRM ferme la socket entre-temps et sa réutilisation échoue sèchement.
      const r = await fetch(`${OSRM}/table/v1/driving/${path}?annotations=distance,duration`,
        { headers: { connection: 'close' }, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.code === 'Ok' && j.distances) {
        const nb = (m) => m.map((row) => row.map((v) => (typeof v === 'number' ? v : NaN)));
        return { d: nb(j.distances), t: j.durations ? nb(j.durations) : null };
      }
      console.warn(`  ! OSRM ${etiquette} (${points.length} pts) : HTTP ${r.status} ${j.code ?? ''} ${j.message ?? ''}`.trimEnd());
    } catch (e) {
      console.warn(`  ! OSRM ${etiquette} (${points.length} pts) : ${e.name} ${e.message}`);
    }
    if (essai === 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** Vitesse urbaine de secours, pour estimer une durée quand OSRM ne répond pas
 *  (30 km/h). */
const VITESSE_SECOURS = 8.3; // m/s

function matrice(points, source, defaut) {
  const n = points.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const v = source?.[i]?.[j];
      return typeof v === 'number' && Number.isFinite(v) ? v : defaut(points[i], points[j]);
    }));
}

/** Tournée ouverte sur tous les points : plus proche voisin, puis 2-opt. */
function tourneeGlobale(d) {
  const n = d.length;
  if (n <= 2) return [...Array(n).keys()];
  let best = null;
  for (let depart = 0; depart < Math.min(n, 12); depart++) {
    const vus = new Set([depart]);
    const ordre = [depart];
    while (ordre.length < n) {
      const cur = ordre[ordre.length - 1];
      let k = -1, dk = Infinity;
      for (let j = 0; j < n; j++) if (!vus.has(j) && d[cur][j] < dk) { dk = d[cur][j]; k = j; }
      vus.add(k); ordre.push(k);
    }
    const len = (o) => o.slice(1).reduce((s, v, i) => s + d[o[i]][v], 0);
    let m = len(ordre);
    for (let pass = 0; pass < 60; pass++) {
      let gain = false;
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        const cand = [...ordre.slice(0, i), ...ordre.slice(i, j + 1).reverse(), ...ordre.slice(j + 1)];
        const c = len(cand);
        if (c < m - 1e-9) { ordre.splice(0, n, ...cand); m = c; gain = true; }
      }
      if (!gain) break;
    }
    if (!best || m < best.m) best = { ordre: [...ordre], m };
  }
  return best.ordre;
}

/** Ordre optimal exact d'un paquet (≤ 12 arrêts), départ libre. */
function ordreExact(d, idx) {
  const n = idx.length;
  if (n <= 2) return idx;
  const size = 1 << n, INF = Infinity;
  let meilleur = null;
  for (let depart = 0; depart < n; depart++) {
    const dp = Array.from({ length: size }, () => new Float64Array(n).fill(INF));
    const prev = Array.from({ length: size }, () => new Int8Array(n).fill(-1));
    dp[1 << depart][depart] = 0;
    for (let mask = 1; mask < size; mask++) {
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i)) || dp[mask][i] === INF) continue;
        for (let j = 0; j < n; j++) {
          if (mask & (1 << j)) continue;
          const next = mask | (1 << j), c = dp[mask][i] + d[idx[i]][idx[j]];
          if (c < dp[next][j]) { dp[next][j] = c; prev[next][j] = i; }
        }
      }
    }
    const full = size - 1;
    for (let fin = 0; fin < n; fin++) {
      if (meilleur && dp[full][fin] >= meilleur.cout) continue;
      if (dp[full][fin] === INF) continue;
      const seq = []; let mask = full, cur = fin;
      while (cur >= 0) { seq.push(idx[cur]); const p = prev[mask][cur]; mask ^= 1 << cur; cur = p; }
      meilleur = { cout: dp[full][fin], seq: seq.reverse() };
    }
  }
  return meilleur.seq;
}

/**
 * Longueur d'une tournée : somme des tronçons, sans retour au départ.
 */
function longueur(d, seq) {
  let t = 0;
  for (let i = 1; i < seq.length; i++) t += d[seq[i - 1]][seq[i]];
  return t;
}

/**
 * Ordre correct et rapide, pour évaluer un mouvement candidat : plus proche
 * voisin depuis le meilleur départ, puis 2-opt. Held-Karp donnerait l'optimum
 * mais coûte mille fois plus, et on ne l'applique qu'au mouvement retenu.
 */
function ordreRapide(d, idx) {
  if (idx.length <= 2) return idx;
  let best = null;
  for (const depart of idx) {
    const reste = new Set(idx);
    reste.delete(depart);
    const seq = [depart];
    while (reste.size) {
      const cur = seq[seq.length - 1];
      let k = null, dk = Infinity;
      for (const j of reste) if (d[cur][j] < dk) { dk = d[cur][j]; k = j; }
      reste.delete(k); seq.push(k);
    }
    let m = longueur(d, seq);
    for (let pass = 0; pass < 8; pass++) {
      let gain = false;
      for (let i = 0; i < seq.length - 1; i++)
        for (let j = i + 1; j < seq.length; j++) {
          const c = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
          const v = longueur(d, c);
          if (v < m - 1e-9) { seq.splice(0, seq.length, ...c); m = v; gain = true; }
        }
      if (!gain) break;
    }
    if (!best || m < best.m) best = { seq: [...seq], m };
  }
  return best.seq;
}

/**
 * Améliore le découpage en déplaçant et en échangeant des arrêts d'une tournée
 * à l'autre. Le découpage initial (grande tournée puis tranches) est bon mais
 * arbitraire aux frontières : deux panneaux voisins peuvent se retrouver dans
 * deux tournées différentes. On teste donc, tant que ça progresse :
 *   - déplacer un arrêt vers une autre tournée, à sa meilleure position ;
 *   - échanger deux arrêts entre deux tournées.
 * On garde le mouvement dès qu'il réduit le total, puis on réoptimise
 * exactement les deux tournées touchées.
 */
function ameliorer(d, tours, maxArrets) {
  const cout = (t) => longueur(d, t);
  let couts = tours.map(cout);

  // On ne cherche plus seulement la durée totale la plus basse : à total égal,
  // quatre tournées de 50 minutes valent mieux que 80, 25, 27 et 80.
  const objectif = (cs) => {
    const total = cs.reduce((s, x) => s + x, 0);
    return cs.length < 2 ? total : total + POIDS_EQUILIBRE * (Math.max(...cs) - Math.min(...cs));
  };
  let obj = objectif(couts);

  /** Meilleur coût d'insertion de `v` dans `t`, et position associée. */
  const meilleureInsertion = (t, v) => {
    let best = { cout: Infinity, pos: 0 };
    for (let k = 0; k <= t.length; k++) {
      const c = cout([...t.slice(0, k), v, ...t.slice(k)]);
      if (c < best.cout) best = { cout: c, pos: k };
    }
    return best;
  };

  for (let passe = 0; passe < 60; passe++) {
    let gagne = false;

    // Déplacements
    for (let a = 0; a < tours.length && !gagne; a++) {
      // Vider une tournée la ferait disparaître du plan : on garde au moins
      // un panneau dedans.
      if (tours[a].length <= 1) continue;
      for (let i = 0; i < tours[a].length && !gagne; i++) {
        const v = tours[a][i];
        const reste = tours[a].filter((_, k) => k !== i);
        const coutReste = cout(ordreRapide(d, reste));
        for (let b = 0; b < tours.length; b++) {
          if (b === a || tours[b].length >= maxArrets) continue;
          const ins = meilleureInsertion(tours[b], v);
          const essai = [...couts];
          essai[a] = coutReste; essai[b] = ins.cout;
          if (objectif(essai) < obj - 1) {
            // Les deux tournées touchées repassent par l'optimum exact.
            tours[a] = ordreExact(d, reste);
            tours[b] = ordreExact(d, [...tours[b].slice(0, ins.pos), v, ...tours[b].slice(ins.pos)]);
            couts[a] = cout(tours[a]); couts[b] = cout(tours[b]);
            obj = objectif(couts);
            gagne = true;
            break;
          }
        }
      }
    }

    // Échanges
    if (!gagne) {
      for (let a = 0; a < tours.length && !gagne; a++) {
        for (let b = a + 1; b < tours.length && !gagne; b++) {
          for (let i = 0; i < tours[a].length && !gagne; i++) {
            for (let j = 0; j < tours[b].length; j++) {
              const na = [...tours[a]]; const nb = [...tours[b]];
              [na[i], nb[j]] = [nb[j], na[i]];
              // Évaluation rapide ; la résolution exacte n'a lieu qu'en cas de gain.
              const essai = [...couts];
              essai[a] = cout(ordreRapide(d, na)); essai[b] = cout(ordreRapide(d, nb));
              if (objectif(essai) < obj - 1) {
                tours[a] = ordreExact(d, na); tours[b] = ordreExact(d, nb);
                couts[a] = cout(tours[a]); couts[b] = cout(tours[b]);
                obj = objectif(couts);
                gagne = true;
                break;
              }
            }
          }
        }
      }
    }

    if (!gagne) break;
  }
  return { tours, total: couts.reduce((s, x) => s + x, 0), couts };
}

/** Tailles de paquets les plus égales possibles, toutes ≤ MAX_ARRETS. */
/** Découpe la tournée globale en paquets de durée comparable.
 *
 *  Couper en parts égales en nombre de panneaux donnait, sur une même commune,
 *  des tournées de 25 à 80 minutes : les panneaux ne sont pas répartis
 *  régulièrement sur le terrain, et ce qui coûte du temps c'est le trajet
 *  entre eux, pas leur nombre. On coupe donc là où la durée cumulée atteint sa
 *  part, sans jamais dépasser `maxArrets` ni laisser un paquet vide.
 */
function decoupageEquilibre(global, d, maxArrets) {
  const n = global.length;
  const paquets = Math.ceil(n / maxArrets);
  if (paquets <= 1) return [global];

  const cumul = [0];
  for (let i = 1; i < n; i++) cumul.push(cumul[i - 1] + d[global[i - 1]][global[i]]);
  const cible = cumul[n - 1] / paquets;

  const sortie = [];
  let debut = 0;
  for (let p = 1; p < paquets; p++) {
    const restants = paquets - p;
    const min = Math.max(debut + 1, n - restants * maxArrets);
    const max = Math.min(n - restants, debut + maxArrets);
    let fin = min, ecartMin = Infinity;
    for (let k = min; k <= max; k++) {
      const ecart = Math.abs(cumul[k - 1] - cumul[debut] - cible);
      if (ecart < ecartMin) { ecartMin = ecart; fin = k; }
    }
    sortie.push(global.slice(debut, fin));
    debut = fin;
  }
  sortie.push(global.slice(debut));
  return sortie;
}

async function main() {
  for (const famille of FAMILLES) {
    const champ = famille === 'ville' ? 'city' : 'district';
    const panneaux = await prisma.panel.findMany({ where: { [champ]: { not: null } } });
    // Une commune de 200 panneaux ne se découpe pas d'un bloc : au-delà du
    // seuil, c'est le quartier qui fait le groupe (Nantes, Saint-Herblain).
    // En dessous, découper par quartier donnerait des groupes d'un ou deux
    // panneaux, alors qu'une tournée de commune reste parfaitement tenable.
    const parCommune = new Map();
    for (const p of panneaux) parCommune.set(p.city, (parCommune.get(p.city) ?? 0) + 1);
    const parQuartier = (c) => famille === 'ville' && (parCommune.get(c) ?? 0) > SEUIL_QUARTIER;

    for (const p of panneaux) {
      if (!parQuartier(p.city)) { p.__cle = p[champ]; continue; }
      // Un panneau relevé à la main n'a pas de quartier : on le rattache à
      // celui de son voisin le plus proche plutôt que d'en faire un groupe.
      let q = p.quarter;
      if (!q) {
        const voisins = panneaux.filter((o) => o.city === p.city && o.quarter);
        q = voisins.sort((a, b) => hav(p, a) - hav(p, b))[0]?.quarter ?? null;
      }
      p.__cle = q ? `${p.city} · ${q}` : p[champ];
    }
    const groupes = [...new Set(panneaux.map((p) => p.__cle))].sort((a, b) =>
      String(a).localeCompare(String(b), 'fr', { numeric: true }),
    );
    console.log(`\n=== ${famille.toUpperCase()} — ${panneaux.length} panneaux, ${groupes.length} groupes`);

    const plan = [];
    let ecartAvant = 0, ecartApres = 0;
    for (const g of groupes) {
      const pts = panneaux.filter((p) => p.__cle === g);
      const osrm = await matriceOsrm(pts, g);
      // Deux matrices sur les mêmes points : on optimise des durées, on
      // enregistre des kilomètres.
      const dm = matrice(pts, osrm?.d, (a, b) => hav(a, b));
      const tm = osrm?.t
        ? matrice(pts, osrm.t, (a, b) => hav(a, b) / VITESSE_SECOURS)
        : dm.map((ligne) => ligne.map((m) => m / VITESSE_SECOURS));

      const global = tourneeGlobale(tm);
      let paquets = decoupageEquilibre(global, tm, MAX_ARRETS).map((p) => ordreExact(tm, p));
      const avant = paquets.map((t) => longueur(tm, t));
      const { tours, couts } = ameliorer(tm, paquets, MAX_ARRETS);
      paquets = tours;

      const tournees = paquets.map((ordonne) => ({
        panneaux: ordonne.map((i) => pts[i]),
        metres: longueur(dm, ordonne),
      }));
      plan.push({ groupe: g, tournees });

      const min = (s) => Math.round(s / 60);
      const ecart = (l) => (l.length < 2 ? 0 : Math.max(...l) - Math.min(...l));
      const km = tournees.reduce((s, t) => s + t.metres, 0) / 1000;
      console.log(
        `${g} — ${pts.length} panneaux, ${tournees.length} tournée(s)` +
          ` [${osrm ? (osrm.t ? 'durées routières' : 'distances routières') : 'vol d’oiseau'}]` +
          `  ${km.toFixed(1)} km` +
          `  ·  ${couts.map(min).join('/')} min` +
          (paquets.length > 1 ? `  (écart ${min(ecart(avant))} → ${min(ecart(couts))} min)` : ''),
      );
      ecartAvant += ecart(avant); ecartApres += ecart(couts);
    }

    console.log(
      `TOTAL ${famille} : écart cumulé entre tournées ${Math.round(ecartAvant / 60)} → ` +
        `${Math.round(ecartApres / 60)} min` +
        (ecartAvant > 0 ? `  (−${Math.round((1 - ecartApres / ecartAvant) * 100)} %)` : ''),
    );

    if (DRY) continue;

    const ancien = await prisma.itinerary.deleteMany({ where: { kind: famille } });
    if (ancien.count) console.log(`${ancien.count} tournée(s) remplacée(s)`);

    let pos = 0, creees = 0;
    for (const { groupe, tournees } of plan) {
      for (const t of tournees) {
        const premier = t.panneaux[0].name;
        const dernier = t.panneaux[t.panneaux.length - 1].name;
        await prisma.itinerary.create({
          data: {
            name: `Itinéraire de ${premier} à ${dernier}`,
            city: groupe,
            kind: famille,
            position: pos++,
            stops: { create: t.panneaux.map((p, i) => ({ panelId: p.id, position: i })) },
          },
        });
        creees++;
      }
    }
    console.log(`${creees} tournées créées`);
  }

  if (DRY) console.log('\n(--dry : rien écrit en base)');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
