// Calcul de l'ordre de passage optimal, côté serveur.
//
// Économie d'appels OSRM (serveurs publics offerts par la FOSSGIS) :
//  - la matrice panneau↔panneau d'un itinéraire ne dépend pas de l'utilisateur :
//    elle est mise en cache longtemps (elle ne change qu'à l'édition des panneaux) ;
//  - seule la ligne « ma position → chaque panneau » varie, et elle est demandée
//    en UNE requête groupée pour toute la page, puis mise en cache par zone ;
//  - si quoi que ce soit échoue, on retombe sur le vol d'oiseau sans casser la page.
//
// La page ne doit jamais attendre le réseau : une matrice absente du cache est
// calculée en tâche de fond pendant qu'on répond au vol d'oiseau, et la réponse
// porte `pending: true` pour que le client redemande un ordre affiné.

import { createHash } from 'node:crypto';
import { haversine, haversineMatrix, type Coord } from './geo';
import { osrmTable, osrmPaused, OSRM_DEDICATED } from './osrm';
import { solveOpenPath } from './tsp';
import type { Mode } from './maps';

export type ItineraryInput = { id: string; panels: Coord[] };
export type Optimization = { results: ItineraryResult[]; pending: boolean };

export type ItineraryResult = {
  id: string;
  order: number[]; // indices des panneaux d'entrée, dans l'ordre de visite
  meters: number;
  source: 'osrm' | 'haversine';
};

const MATRIX_TTL_MS = 6 * 60 * 60 * 1000; // matrices inter-panneaux : quasi statiques
const ORIGIN_TTL_MS = 10 * 60 * 1000; // lignes depuis une position : le militant bouge
const MAX_ENTRIES = 500;
const DEST_CHUNK = 90; // OSRM public limite le nombre de coordonnées par requête
// Temps que la requête accepte d'attendre le routage. Une instance dédiée
// répond en quelques dizaines de millisecondes : tout arrive dans le budget et
// l'ordre exact est prêt dès le premier affichage. Avec l'instance publique, on
// répond au vol d'oiseau à l'échéance et le calcul se poursuit en fond.
const BUDGET_MS = Number(process.env.OPTIMIZE_BUDGET_MS || (OSRM_DEDICATED ? 4000 : 2500));

type Entry<T> = { value: T; expires: number };
// `globalThis` : survit au rechargement à chaud en développement (même patron que lib/db.ts).
const store = ((globalThis as any).__cnRoutingCache ??= new Map<string, Entry<unknown>>()) as Map<
  string,
  Entry<unknown>
>;

function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T, ttl: number): void {
  if (store.size >= MAX_ENTRIES) {
    // Purge simple : on vide les entrées périmées, sinon la plus ancienne insérée.
    for (const [k, v] of store) if (v.expires < Date.now()) store.delete(k);
    if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  }
  store.set(key, { value, expires: Date.now() + ttl });
}

/** Empreinte des panneaux : change dès qu'un panneau bouge, est ajouté ou supprimé. */
function panelsKey(panels: Coord[]): string {
  const raw = panels.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';');
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/** Position arrondie à ~110 m : deux militants du même coin partagent le cache. */
function originKey(o: Coord): string {
  return `${o.lat.toFixed(3)},${o.lng.toFixed(3)}`;
}

/** Clés dont la matrice est déjà en cours de calcul : évite les doublons. */
const warming = ((globalThis as any).__cnWarming ??= new Set<string>()) as Set<string>;

/** Nombre maximum de coordonnées par requête `table` (limite des serveurs publics). */
const MAX_COORDS = 95;

/**
 * Calcule en tâche de fond les matrices manquantes. Les itinéraires sont
 * regroupés dans le moins de requêtes possible : on demande UNE matrice pour
 * plusieurs itinéraires à la fois, puis on en découpe les blocs diagonaux.
 * Sur un serveur public qui fait patienter plusieurs secondes par appel, c'est
 * la différence entre une poignée de secondes et plusieurs minutes.
 */
function warmMatrices(missing: { key: string; panels: Coord[] }[], mode: Mode): Promise<void> {
  const todo = missing.filter((m) => !warming.has(m.key));
  if (!todo.length || osrmPaused()) return Promise.resolve();
  for (const m of todo) warming.add(m.key);

  return (async () => {
    try {
      for (let i = 0; i < todo.length; ) {
        // Un paquet d'itinéraires entiers, sous la limite de coordonnées.
        const batch: { key: string; panels: Coord[] }[] = [];
        let count = 0;
        while (i < todo.length && count + todo[i].panels.length <= MAX_COORDS) {
          count += todo[i].panels.length;
          batch.push(todo[i++]);
        }
        if (!batch.length) {
          i++; // un itinéraire à lui seul dépasse la limite : on le saute
          continue;
        }

        const coords = batch.flatMap((b) => b.panels);
        const table = await osrmTable(coords, mode);
        if (!table) return; // serveur indisponible : on réessaiera au prochain passage

        let off = 0;
        for (const b of batch) {
          const n = b.panels.length;
          const sub = Array.from({ length: n }, (_, a) =>
            Array.from({ length: n }, (_, c) => table[off + a][off + c]),
          );
          if (sub.every((row) => row.every((v) => Number.isFinite(v)))) {
            cacheSet(`m:${b.key}`, sub, MATRIX_TTL_MS);
          }
          off += n;
        }
      }
    } finally {
      for (const m of todo) warming.delete(m.key);
    }
  })();
}

/** Distances « ma position -> chaque panneau », en une requête (découpée si besoin). */
async function fetchOriginLine(origin: Coord, points: Coord[], mode: Mode): Promise<number[]> {
  const line: number[] = [];
  for (let off = 0; off < points.length; off += DEST_CHUNK) {
    const slice = points.slice(off, off + DEST_CHUNK);
    const table = await osrmTable([origin, ...slice], mode, {
      sources: [0],
      destinations: slice.map((_, i) => i + 1),
    });
    for (let j = 0; j < slice.length; j++) line.push(table ? table[0][j] : NaN);
  }
  return line;
}

export async function optimizeItineraries(
  origin: Coord,
  itineraries: ItineraryInput[],
  mode: Mode,
): Promise<Optimization> {
  const keys = itineraries.map((it) => `${mode}:${panelsKey(it.panels)}`);

  // 1) Matrices panneau↔panneau : celles du cache seulement. Les absentes sont
  //    lancées en arrière-plan, on ne fait pas patienter l'utilisateur.
  const matrices = new Map<string, number[][] | null>();
  const missing: { key: string; panels: Coord[] }[] = [];
  let pending = false;
  for (let i = 0; i < itineraries.length; i++) {
    const key = keys[i];
    if (matrices.has(key)) continue;
    const cached = cacheGet<number[][]>(`m:${key}`);
    matrices.set(key, cached ?? null);
    if (!cached && itineraries[i].panels.length > 1) {
      missing.push({ key, panels: itineraries[i].panels });
      pending = true;
    }
  }


  // 2) Ligne « position → panneaux », en une requête groupée pour toute la page.
  const oKey = originKey(origin);
  const fromOrigin = new Map<string, number[] | null>();
  const toFetch: { key: string; panels: Coord[] }[] = [];
  for (let i = 0; i < itineraries.length; i++) {
    const key = keys[i];
    if (fromOrigin.has(key)) continue;
    const cached = cacheGet<number[]>(`o:${oKey}:${key}`);
    if (cached) fromOrigin.set(key, cached);
    else toFetch.push({ key, panels: itineraries[i].panels });
  }

  // Les deux familles de requêtes partent ensemble, la ligne d'origine en tête
  // (c'est la seule dont dépend le choix du premier panneau).
  // Le résultat est mis en cache DANS le job : même si le budget expire avant,
  // le travail n'est pas perdu et la requête suivante en profite.
  const originJob = toFetch.length
    ? fetchOriginLine(origin, toFetch.flatMap((t) => t.panels), mode).then((l) => {
        let off = 0;
        for (const t of toFetch) {
          const part = l.slice(off, off + t.panels.length);
          if (part.length === t.panels.length && part.every((d) => Number.isFinite(d))) {
            cacheSet(`o:${oKey}:${t.key}`, part, ORIGIN_TTL_MS);
          }
          off += t.panels.length;
        }
        return l;
      })
    : null;
  const matrixJob = warmMatrices(missing, mode);

  // On attend, mais pas plus que le budget : passé ce délai on répond avec ce
  // qu'on a, et les calculs en cours continuent de remplir le cache.
  await Promise.race([
    Promise.all([originJob?.catch(() => null), matrixJob.catch(() => undefined)]),
    new Promise((r) => setTimeout(r, BUDGET_MS)),
  ]);

  // Les matrices arrivées entre-temps sont maintenant dans le cache.
  for (const m of missing) {
    const fresh = cacheGet<number[][]>(`m:${m.key}`);
    if (fresh) matrices.set(m.key, fresh);
  }
  if (missing.every((m) => matrices.get(m.key))) pending = false;

  for (const t of toFetch) {
    const part = cacheGet<number[]>(`o:${oKey}:${t.key}`) ?? null;
    if (!part && !osrmPaused()) pending = true; // ça vaut le coup de redemander
    fromOrigin.set(t.key, part);
  }

  // 3) Assemblage de la matrice de coûts et résolution, itinéraire par itinéraire.
  const results = itineraries.map((it, i) => {
    const key = keys[i];
    const n = it.panels.length;
    if (n === 0) return { id: it.id, order: [], meters: 0, source: 'haversine' as const };

    const matrix = matrices.get(key) ?? null;
    const line = fromOrigin.get(key) ?? null;
    const fallback = haversineMatrix(it.panels);

    // cost[0] = depuis la position ; cost[i+1][j+1] = de panneau à panneau.
    // Le retour vers la position ne sert jamais (parcours ouvert) : laissé à 0.
    const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
    let usedOsrm = true;
    for (let a = 0; a < n; a++) {
      const d = line?.[a];
      if (typeof d === 'number' && Number.isFinite(d)) cost[0][a + 1] = d;
      else {
        cost[0][a + 1] = haversine(origin, it.panels[a]);
        usedOsrm = false;
      }
      for (let b = 0; b < n; b++) {
        const m = matrix?.[a]?.[b];
        if (typeof m === 'number' && Number.isFinite(m)) cost[a + 1][b + 1] = m;
        else {
          cost[a + 1][b + 1] = fallback[a][b];
          if (a !== b) usedOsrm = false;
        }
      }
    }

    const { order, meters } = solveOpenPath(cost);
    return { id: it.id, order, meters, source: usedOsrm ? ('osrm' as const) : ('haversine' as const) };
  });

  return { results, pending };
}
