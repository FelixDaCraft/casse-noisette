// Matrices de distances routières via OSRM (instance publique FOSSGIS par défaut).
//
// Le service `table` donne les distances réelles par la route : contrairement au
// vol d'oiseau, il tient compte de la Loire, des voies ferrées, des sens uniques
// et des rues piétonnes.
//
// Les serveurs publics FOSSGIS sont offerts pour un usage léger et refusent
// (429) ou ignorent les appels trop rapprochés. On s'y plie strictement :
//   - une seule requête à la fois, espacée d'au moins MIN_GAP_MS ;
//   - une seule nouvelle tentative en cas de 429 / timeout ;
//   - disjoncteur : après plusieurs échecs d'affilée on cesse d'appeler
//     pendant quelques minutes (l'appelant retombe sur le vol d'oiseau).
// Pour un service fiable, pointer OSRM_BASE_URL vers sa propre instance.

import type { Mode } from './maps';

const PROFILE: Record<Mode, string> = {
  walking: 'routed-foot',
  bicycling: 'routed-bike',
  driving: 'routed-car',
};

const BASE = (process.env.OSRM_BASE_URL || 'https://routing.openstreetmap.de').replace(/\/+$/, '');
// L'instance publique ne bloque pas : elle FAIT PATIENTER (~8-9 s dès la deuxième
// requête). Un timeout court ferait échouer des appels qui auraient abouti.
const TIMEOUT_MS = Number(process.env.OSRM_TIMEOUT_MS || 15000);
const MIN_GAP_MS = Number(process.env.OSRM_MIN_GAP_MS || 1200);
const BREAKER_FAILS = 3;
const BREAKER_MS = 3 * 60 * 1000;
// L'instance FOSSGIS ignore les User-Agent génériques : on s'identifie comme le veut sa politique.
const UA = process.env.OSRM_USER_AGENT || 'casse-noisette/1.0 (+https://casse-noisette.aynn.fr)';

export type LngLat = { lat: number; lng: number };

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
): Promise<number[][] | null> {
  if (coords.length < 2 || osrmPaused()) return null;

  const path = coords.map((c) => `${round6(c.lng)},${round6(c.lat)}`).join(';');
  const qs = new URLSearchParams({ annotations: 'distance' });
  if (opts.sources) qs.set('sources', opts.sources.join(';'));
  if (opts.destinations) qs.set('destinations', opts.destinations.join(';'));

  // Le segment de profil dans le chemin est ignoré par FOSSGIS : c'est le
  // préfixe `routed-*` qui choisit le mode de déplacement.
  const url = `${BASE}/${PROFILE[mode]}/table/v1/driving/${path}?${qs}`;

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

async function call(url: string): Promise<number[][] | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null; // 429 compris : on laisse le disjoncteur décider
    const body = (await res.json()) as { code?: string; distances?: (number | null)[][] };
    if (body.code !== 'Ok' || !Array.isArray(body.distances)) return null;
    // Une distance `null` signale un point non rattaché au réseau : on la laisse
    // remonter en NaN pour que l'appelant retombe sur le vol d'oiseau pour cette paire.
    return body.distances.map((row) => row.map((d) => (typeof d === 'number' ? d : NaN)));
  } catch {
    return null; // timeout, DNS, hors-ligne
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6; // ~10 cm, raccourcit l'URL sans perte utile
}
