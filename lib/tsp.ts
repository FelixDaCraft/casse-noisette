// Ordonnancement des arrêts : « chemin ouvert » partant d'un point imposé.
//
// On cherche l'ordre de visite des n panneaux qui minimise la distance totale
// en partant de la position de l'utilisateur, SANS retour au départ (on ne
// revient pas se garer là où on a commencé — c'est une tournée de collage).
//
// La matrice peut être asymétrique (sens uniques) : on indexe toujours
// `cost[depuis][vers]`.
//
// n <= 12 : Held-Karp, résultat exact (2^n * n * n ≈ 590 000 opérations au pire,
//           soit quelques millisecondes ; en pratique n <= 10, la limite Google Maps).
// n >  12 : plus proche voisin puis 2-opt, résultat quasi optimal.

/** Seuil au-delà duquel on bascule sur l'heuristique. */
const EXACT_MAX = 12;

export type Solved = { order: number[]; meters: number };

/**
 * `cost` est de taille (n+1)x(n+1) : l'indice 0 est le point de départ,
 * les indices 1..n les panneaux. L'ordre renvoyé contient les indices des
 * panneaux (base 0, donc `cost` indice - 1) dans l'ordre de visite.
 */
export function solveOpenPath(cost: number[][]): Solved {
  const n = cost.length - 1;
  if (n <= 0) return { order: [], meters: 0 };
  if (n === 1) return { order: [0], meters: cost[0][1] };
  const solved = n <= EXACT_MAX ? heldKarp(cost, n) : twoOpt(cost, n);
  return { order: solved.order.map((i) => i - 1), meters: solved.meters };
}

/** Optimum exact par programmation dynamique sur les sous-ensembles. */
function heldKarp(cost: number[][], n: number): Solved {
  const size = 1 << n; // sous-ensembles de panneaux déjà visités
  const INF = Infinity;
  // dp[mask][i] : coût minimal pour avoir visité `mask` en terminant sur le panneau i.
  const dp: Float64Array[] = Array.from({ length: size }, () => new Float64Array(n).fill(INF));
  const prev: Int8Array[] = Array.from({ length: size }, () => new Int8Array(n).fill(-1));

  for (let i = 0; i < n; i++) dp[1 << i][i] = cost[0][i + 1];

  for (let mask = 1; mask < size; mask++) {
    for (let i = 0; i < n; i++) {
      const base = dp[mask][i];
      if (base === INF || !(mask & (1 << i))) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const next = mask | (1 << j);
        const c = base + cost[i + 1][j + 1];
        if (c < dp[next][j]) {
          dp[next][j] = c;
          prev[next][j] = i;
        }
      }
    }
  }

  const full = size - 1;
  let last = 0;
  let best = INF;
  for (let i = 0; i < n; i++) {
    if (dp[full][i] < best) {
      best = dp[full][i];
      last = i;
    }
  }

  // Remontée du chemin.
  const order: number[] = [];
  let mask = full;
  let cur = last;
  while (cur >= 0) {
    order.push(cur + 1);
    const p = prev[mask][cur];
    mask ^= 1 << cur;
    cur = p;
  }
  order.reverse();
  return { order, meters: best };
}

/** Secours pour les grands itinéraires : plus proche voisin, puis 2-opt. */
function twoOpt(cost: number[][], n: number): Solved {
  const order: number[] = [];
  const seen = new Set<number>();
  let cur = 0;
  for (let k = 0; k < n; k++) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 1; j <= n; j++) {
      if (seen.has(j)) continue;
      if (cost[cur][j] < bestD) {
        bestD = cost[cur][j];
        best = j;
      }
    }
    seen.add(best);
    order.push(best);
    cur = best;
  }

  const total = (o: number[]) => {
    let s = cost[0][o[0]];
    for (let i = 1; i < o.length; i++) s += cost[o[i - 1]][o[i]];
    return s;
  };

  let meters = total(order);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        const m = total(cand);
        if (m < meters - 1e-9) {
          order.splice(0, n, ...cand);
          meters = m;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { order, meters };
}
