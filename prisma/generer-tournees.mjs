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
// Les distances viennent de l'instance OSRM (profil piéton : le collage urbain
// se fait à pied). Sans OSRM joignable, on retombe sur le vol d'oiseau.
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
const OSRM = process.env.OSRM_URL_WALKING || 'http://127.0.0.1:5102';
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
      const r = await fetch(`${OSRM}/table/v1/driving/${path}?annotations=distance`,
        { headers: { connection: 'close' }, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.code === 'Ok' && j.distances) {
        return j.distances.map((row) => row.map((v) => (typeof v === 'number' ? v : NaN)));
      }
      console.warn(`  ! OSRM ${etiquette} (${points.length} pts) : HTTP ${r.status} ${j.code ?? ''} ${j.message ?? ''}`.trimEnd());
    } catch (e) {
      console.warn(`  ! OSRM ${etiquette} (${points.length} pts) : ${e.name} ${e.message}`);
    }
    if (essai === 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

function matrice(points, osrm) {
  const n = points.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const v = osrm?.[i]?.[j];
      return typeof v === 'number' && Number.isFinite(v) ? v : hav(points[i], points[j]);
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
  let total = tours.reduce((s, t) => s + cout(t), 0);

  /** Meilleur coût d'insertion de `v` dans `t`, et position associée. */
  const meilleureInsertion = (t, v) => {
    let best = { cout: Infinity, pos: 0 };
    for (let k = 0; k <= t.length; k++) {
      const c = cout([...t.slice(0, k), v, ...t.slice(k)]);
      if (c < best.cout) best = { cout: c, pos: k };
    }
    return best;
  };

  for (let passe = 0; passe < 30; passe++) {
    let gagne = false;

    // Déplacements
    for (let a = 0; a < tours.length && !gagne; a++) {
      for (let i = 0; i < tours[a].length && !gagne; i++) {
        const v = tours[a][i];
        const sansV = tours[a].filter((_, k) => k !== i);
        const gainRetrait = cout(tours[a]) - cout(sansV);
        for (let b = 0; b < tours.length; b++) {
          if (b === a || tours[b].length >= maxArrets) continue;
          const ins = meilleureInsertion(tours[b], v);
          const delta = ins.cout - cout(tours[b]) - gainRetrait;
          if (delta < -1) {
            tours[a] = ordreExact(d, sansV);
            tours[b] = ordreExact(d, [...tours[b].slice(0, ins.pos), v, ...tours[b].slice(ins.pos)]);
            // (les deux tournées touchées repassent par l'optimum exact)
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
              const avant = cout(tours[a]) + cout(tours[b]);
              // Évaluation rapide ; la résolution exacte n'a lieu qu'en cas de gain.
              const ra = ordreRapide(d, na); const rb = ordreRapide(d, nb);
              if (cout(ra) + cout(rb) < avant - 1) {
                tours[a] = ordreExact(d, na); tours[b] = ordreExact(d, nb);
                gagne = true;
                break;
              }
            }
          }
        }
      }
    }

    if (!gagne) break;
    total = tours.reduce((s, t) => s + cout(t), 0);
  }
  return { tours, total };
}

/** Tailles de paquets les plus égales possibles, toutes ≤ MAX_ARRETS. */
function decoupage(n) {
  const paquets = Math.ceil(n / MAX_ARRETS);
  const base = Math.floor(n / paquets), reste = n % paquets;
  return Array.from({ length: paquets }, (_, i) => base + (i < reste ? 1 : 0));
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
    let totalAvant = 0, totalApres = 0;
    for (const g of groupes) {
      const pts = panneaux.filter((p) => p.__cle === g);
      const osrm = await matriceOsrm(pts, g);
      const d = matrice(pts, osrm);
      const global = tourneeGlobale(d);
      const tailles = decoupage(pts.length);

      let k = 0;
      let paquets = tailles.map((t) => {
        const p = global.slice(k, k + t);
        k += t;
        return ordreExact(d, p);
      });
      const avant = paquets.reduce((s, t) => s + longueur(d, t), 0);
      const { tours, total } = ameliorer(d, paquets, MAX_ARRETS);
      paquets = tours;

      const tournees = paquets.map((ordonne) => ({
        panneaux: ordonne.map((i) => pts[i]),
        metres: longueur(d, ordonne),
      }));
      plan.push({ groupe: g, tournees });
      const gain = avant > 0 ? Math.round((1 - total / avant) * 100) : 0;
      console.log(
        `${g} — ${pts.length} panneaux, ${tournees.length} tournée(s)` +
          ` [${osrm ? 'distances routières' : 'vol d’oiseau'}]` +
          `  ${(avant / 1000).toFixed(1)} → ${(total / 1000).toFixed(1)} km` +
          (gain > 0 ? `  (−${gain} %)` : ''),
      );
      totalAvant += avant; totalApres += total;
    }

    console.log(
      `TOTAL ${famille} : ${(totalAvant / 1000).toFixed(1)} → ${(totalApres / 1000).toFixed(1)} km` +
        (totalAvant > 0 ? `  (−${Math.round((1 - totalApres / totalAvant) * 100)} %)` : ''),
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
