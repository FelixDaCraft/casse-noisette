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

/** Matrice des distances par la route ; `null` si OSRM ne répond pas. */
async function matriceOsrm(points) {
  if (points.length < 2) return null;
  const path = points.map((p) => `${p.lng},${p.lat}`).join(';');
  try {
    const r = await fetch(`${OSRM}/table/v1/driving/${path}?annotations=distance`,
      { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (j.code !== 'Ok' || !j.distances) return null;
    return j.distances.map((row) => row.map((v) => (typeof v === 'number' ? v : NaN)));
  } catch { return null; }
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
    const groupes = [...new Set(panneaux.map((p) => p[champ]))].sort((a, b) =>
      String(a).localeCompare(String(b), 'fr', { numeric: true }),
    );
    console.log(`\n=== ${famille.toUpperCase()} — ${panneaux.length} panneaux, ${groupes.length} groupes`);

    const plan = [];
    for (const g of groupes) {
      const pts = panneaux.filter((p) => p[champ] === g);
      const osrm = await matriceOsrm(pts);
      const d = matrice(pts, osrm);
      const global = tourneeGlobale(d);
      const tailles = decoupage(pts.length);

      let k = 0;
      const tournees = tailles.map((t) => {
        const paquet = global.slice(k, k + t);
        k += t;
        const ordonne = ordreExact(d, paquet);
        const metres = ordonne.slice(1).reduce((s, v, i) => s + d[ordonne[i]][v], 0);
        return { panneaux: ordonne.map((i) => pts[i]), metres };
      });
      plan.push({ groupe: g, tournees });
      console.log(
        `${g} — ${pts.length} panneaux, ${tournees.length} tournée(s)` +
          ` [${osrm ? 'distances routières' : 'vol d’oiseau'}]`,
      );
    }

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
