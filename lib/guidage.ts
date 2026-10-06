// Guidage du mode « Tournée » : ce que Ferrostar ne fait pas pour nous.
//
// Ferrostar (moteur de navigation, côté navigateur) suit le tracé, avance
// d'étape en étape, détecte l'écart et choisit les annonces ; Valhalla
// (moteur d'itinéraire, derrière /api/valhalla/route) rédige les consignes en
// français. Restent ici les règles propres à l'appli : quand est-on « au
// panneau », quand un point est-il hors de la zone couverte, combien reste-t-il
// jusqu'au PROCHAIN panneau d'un itinéraire qui les enchaîne tous, et la mise
// en forme des distances et des consignes.
//
// Fichier pur (aucun import à l'exécution) : partagé par la route API et
// l'écran de navigation, et testé directement avec Node
// (scripts/tester-navigation.mjs).

import type { Mode } from './maps';

/** [latitude, longitude]. */
export type Pt = [number, number];

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance orthodromique en mètres (même formule que lib/geo.ts). */
export function distanceM(a: Pt, b: Pt): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap de a vers b, en degrés (0 = nord, 90 = est). */
export function cap(a: Pt, b: Pt): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/* ─── Valhalla ───────────────────────────────────────────────────────────── */

/** Mode de l'appli -> « costing » Valhalla. */
export const COSTING: Record<Mode, 'pedestrian' | 'bicycle' | 'auto'> = {
  walking: 'pedestrian',
  bicycling: 'bicycle',
  driving: 'auto',
};

/**
 * Les consignes françaises de Valhalla ont deux tics : une majuscule après la
 * virgule (« Dans 50 mètres, Tournez à gauche ») et un point doublé quand une
 * phrase en enchâsse une autre (« …dans Allée Cassard.. »). La synthèse vocale
 * s'en accommode mal (pause, intonation de début de phrase) : on les corrige.
 */
export function nettoyerConsigne(t: string): string {
  return t
    .replace(/\.{2,}/g, '.')
    // Seulement après « Dans 200 mètres, » et « Ensuite, » : ailleurs, une
    // majuscule après une virgule est un nom de lieu (« vers A 83, Bordeaux »).
    .replace(
      /((?:^|\. )(?:Dans [^,.]{1,30}|Ensuite), )([A-ZÀÂÉÈÊÎÔÙÛÇ])(?=[a-zàâéèêëîïôöùûüç])/g,
      (_, v: string, l: string) => v + l.toLowerCase(),
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Pour le bandeau : la consigne sans son point final. */
export function sansPoint(t: string): string {
  return t.replace(/\s*\.$/, '');
}

/* ─── Arrivée, couverture ────────────────────────────────────────────────── */

/** Rayon dans lequel on est « au panneau ». Un peu plus large en voiture :
 *  on se gare rarement pile devant. */
export const RAYON_ARRIVEE: Record<Mode, number> = { walking: 40, bicycling: 40, driving: 50 };

export function estArrive(distance: number, mode: Mode): boolean {
  return distance <= RAYON_ARRIVEE[mode];
}

/** Au-delà de cet écart au tracé, pendant ECART_DUREE_MS, on recalcule. */
export const ECART_SEUIL_M = 45;
export const ECART_DUREE_MS = 4000;
/** Jamais deux recalculs plus rapprochés que ça (anti-rebond vers Valhalla). */
export const RECALCUL_MIN_MS = 10_000;
/** Précision GPS au-delà de laquelle on ne décide plus rien sur l'écart. */
export const PRECISION_MAX_M = 60;

/**
 * Hors de sa zone, un moteur d'itinéraire « accroche » un point à la route la
 * plus proche qu'il connaisse, parfois très loin, et renvoie un trajet
 * absurde. Valhalla, comme OSRM, donne pour chaque point la distance de cet
 * accrochage : au-delà d'ACCROCHE_MAX_M, le point est hors couverture et on
 * ne guide pas.
 */
export const ACCROCHE_MAX_M = 300;

/** Indices des points accrochés trop loin (hors couverture). */
export function horsCouverture(accroches: (number | null | undefined)[]): number[] {
  const hors: number[] = [];
  accroches.forEach((d, i) => {
    if (typeof d !== 'number' || !Number.isFinite(d) || d > ACCROCHE_MAX_M) hors.push(i);
  });
  return hors;
}

/* ─── Jusqu'au prochain panneau ──────────────────────────────────────────── */

/** Ce qu'on lit d'une étape Ferrostar (RouteStep) : structure minimale. */
export type EtapeLue = {
  distance: number;
  duration: number;
  visualInstructions: { primaryContent: { maneuverType?: string } }[];
};

/**
 * L'itinéraire enchaîne tous les panneaux restants (une « jambe » par
 * panneau) : la tournée entière se chiffre d'un coup. Le premier panneau est
 * atteint à la fin de la première étape dont la manœuvre est une arrivée.
 * Renvoie son indice dans `etapes`, ou la dernière étape à défaut.
 */
export function etapeArrivee(etapes: EtapeLue[]): number {
  const k = etapes.findIndex((e) => e.visualInstructions.some((v) => v.primaryContent.maneuverType === 'arrive'));
  return k >= 0 ? k : etapes.length - 1;
}

/**
 * Distance et durée jusqu'au prochain panneau.
 * `courante` : indice de l'étape en cours dans `etapes` (celles de la route
 * entière) ; `versManoeuvre` : ce qu'il reste de cette étape, en mètres
 * (progress.distanceToNextManeuver de Ferrostar).
 */
export function jusquAuPanneau(
  etapes: EtapeLue[],
  arrivee: number,
  courante: number,
  versManoeuvre: number,
): { metres: number; secondes: number } {
  if (courante > arrivee) return { metres: 0, secondes: 0 };
  const e = etapes[courante];
  const part = e && e.distance > 0 ? Math.min(1, versManoeuvre / e.distance) : 0;
  let metres = Math.max(0, versManoeuvre);
  let secondes = e ? e.duration * part : 0;
  for (let k = courante + 1; k <= arrivee && k < etapes.length; k++) {
    metres += etapes[k].distance;
    secondes += etapes[k].duration;
  }
  return { metres, secondes };
}

/* ─── Mise en forme ──────────────────────────────────────────────────────── */

/** Arrondi lisible : 10 m près sous 100 m, 50 m sous 500 m, 100 m ensuite. */
function arrondi(m: number): number {
  if (m < 100) return Math.max(10, Math.round(m / 10) * 10);
  if (m < 500) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}

/** Pour l'écran : « 80 m », « 450 m », « 1,2 km », « 12 km ». */
export function distanceCourte(m: number): string {
  if (m < 950) return `${arrondi(m)} m`;
  const km = m / 1000;
  return `${(km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',')} km`;
}

/** Durée : « 1 min », « 12 min », « 1 h 05 ». */
export function dureeCourte(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  const h = Math.floor(s / 3600);
  return `${h} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}
