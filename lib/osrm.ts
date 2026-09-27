// Matrices de distances routières via OSRM (instance publique FOSSGIS par défaut).
//
// Le service `table` donne les distances réelles par la route : contrairement au
// vol d'oiseau, il tient compte de la Loire, des voies ferrées, des sens uniques
// et des rues piétonnes.
//
// Deux configurations possibles :
//
//  1. INSTANCE DÉDIÉE (recommandé, voir deploy/osrm/) — une URL par profil via
//     OSRM_URL_WALKING / OSRM_URL_BICYCLING / OSRM_URL_DRIVING. Réponses en
//     quelques dizaines de millisecondes : pas d'étranglement, pas d'attente,
//     l'ordre exact est calculé avant même l'affichage de la page.
//
//  2. INSTANCE PUBLIQUE FOSSGIS (repli par défaut, sans configuration) — offerte
//     pour un usage léger : elle refuse (429) ou fait patienter ~8 s les appels
//     rapprochés. On s'y plie strictement : une requête à la fois espacée de
//     MIN_GAP_MS, une seule nouvelle tentative, et un disjoncteur qui suspend
//     les appels après plusieurs échecs (l'appelant retombe sur le vol d'oiseau).

import type { Mode } from './maps';

const PROFILE: Record<Mode, string> = {
  walking: 'routed-foot',
  bicycling: 'routed-bike',
  driving: 'routed-car',
};

/** Instance dédiée : une URL par mode, chacune servant son propre profil. */
const DEDICATED: Record<Mode, string | undefined> = {
  walking: process.env.OSRM_URL_WALKING,
  bicycling: process.env.OSRM_URL_BICYCLING,
  driving: process.env.OSRM_URL_DRIVING,
};
/** Vrai dès qu'au moins une instance dédiée est configurée : on peut aller vite. */
export const OSRM_DEDICATED = Object.values(DEDICATED).some(Boolean);

const BASE = (process.env.OSRM_BASE_URL || 'https://routing.openstreetmap.de').replace(/\/+$/, '');
// L'instance publique ne bloque pas : elle FAIT PATIENTER (~8-9 s dès la deuxième
// requête), d'où un timeout long et un espacement strict. Une instance dédiée
// n'a besoin ni de l'un ni de l'autre.
const TIMEOUT_MS = Number(process.env.OSRM_TIMEOUT_MS || (OSRM_DEDICATED ? 5000 : 15000));
const MIN_GAP_MS = Number(process.env.OSRM_MIN_GAP_MS || (OSRM_DEDICATED ? 0 : 1200));
const BREAKER_FAILS = 3;
const BREAKER_MS = 3 * 60 * 1000;
// L'instance FOSSGIS ignore les User-Agent génériques : on s'identifie comme le veut sa politique.
const UA = process.env.OSRM_USER_AGENT || 'casse-noisette/1.0 (+https://casse-noisette.aynn.fr)';

export type LngLat = { lat: number; lng: number };
/** Distances en mètres et durées en secondes, même indexation. */
export type Table = { distances: number[][]; durations: number[][] | null };

type Breaker = { chain: Promise<unknown>; last: number; fails: number; openUntil: number };
const state = ((globalThis as any).__cnOsrm ??= {
  chain: Promise.resolve(),
  last: 0,
  fails: 0,
  openUntil: 0,
} as Breaker) as Breaker;

/** Vrai si le disjoncteur est ouvert : inutile d'insister pour l'instant. */
export function osrmPaused(): boolean {
  return Date.now() < state.openUntil;
}

/** File d'attente : garantit un seul appel à la fois, espacé de MIN_GAP_MS. */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  if (MIN_GAP_MS <= 0) return fn(); // instance dédiée : pas de file d'attente
  const run = state.chain.then(async () => {
    const wait = state.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    state.last = Date.now();
    return fn();
  });
  state.chain = run.catch(() => undefined); // un échec ne casse pas la file
  return run;
}

/**
 * Distances routières en mètres, ou `null` si OSRM est injoignable ou surchargé :
 * l'appelant bascule alors sur le vol d'oiseau.
 *
 * `sources` / `destinations` sont des indices dans `coords` ; les omettre demande
 * la matrice complète. Les restreindre évite de faire calculer au serveur des
 * paires qu'on ne lira pas.
 */
export async function osrmTable(
  coords: LngLat[],
  mode: Mode,
  opts: { sources?: number[]; destinations?: number[] } = {},
): Promise<Table | null> {
  if (coords.length < 2 || osrmPaused()) return null;

  const path = coords.map((c) => `${round6(c.lng)},${round6(c.lat)}`).join(';');
  // Les durées servent à afficher « ≈ 45 min » sur les cartes de tournée ;
  // elles tiennent compte du mode (marche, vélo, voiture), pas seulement de la
  // distance. Même requête, aucun appel supplémentaire.
  const qs = new URLSearchParams({ annotations: 'distance,duration' });
  if (opts.sources) qs.set('sources', opts.sources.join(';'));
  if (opts.destinations) qs.set('destinations', opts.destinations.join(';'));

  // Instance dédiée : chaque URL sert déjà son profil. Sinon, chez FOSSGIS,
  // c'est le préfixe `routed-*` qui choisit le mode (le segment de profil dans
  // le chemin, lui, est ignoré dans les deux cas).
  const host = DEDICATED[mode];
  const url = host
    ? `${host.replace(/\/+$/, '')}/table/v1/driving/${path}?${qs}`
    : `${BASE}/${PROFILE[mode]}/table/v1/driving/${path}?${qs}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await serialize(() => call(url));
    if (out) {
      state.fails = 0;
      return out;
    }
    if (osrmPaused()) break;
  }

  if (++state.fails >= BREAKER_FAILS) {
    state.openUntil = Date.now() + BREAKER_MS;
    state.fails = 0;
    console.warn(`[osrm] trop d'échecs : pause de ${BREAKER_MS / 1000}s, repli sur le vol d'oiseau`);
  }
  return null;
}

async function call(url: string): Promise<Table | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null; // 429 compris : on laisse le disjoncteur décider
    const body = (await res.json()) as {
      code?: string;
      distances?: (number | null)[][];
      durations?: (number | null)[][];
    };
    if (body.code !== 'Ok' || !Array.isArray(body.distances)) return null;
    // Une valeur `null` signale un point non rattaché au réseau : on la laisse
    // remonter en NaN pour que l'appelant retombe sur le vol d'oiseau pour cette paire.
    const nb = (m: (number | null)[][]) => m.map((row) => row.map((d) => (typeof d === 'number' ? d : NaN)));
    return {
      distances: nb(body.distances),
      durations: Array.isArray(body.durations) ? nb(body.durations) : null,
    };
  } catch {
    return null; // timeout, DNS, hors-ligne
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6; // ~10 cm, raccourcit l'URL sans perte utile
}
