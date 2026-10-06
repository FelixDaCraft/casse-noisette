// Géométrie du guidage : où en est-on sur le tracé, s'en est-on écarté,
// est-on arrivé au panneau.
//
// Fichier pur (aucun import à l'exécution) : partagé par la route
// /api/navigation et l'écran de navigation, et testé directement avec Node
// (scripts/tester-navigation.mjs).

import type { Mode } from './maps';

/** [latitude, longitude], l'ordre de Leaflet. */
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

/** Distance cumulée depuis le début du tracé, à chaque sommet. */
export function cumul(ligne: Pt[]): number[] {
  const c = [0];
  for (let i = 1; i < ligne.length; i++) c.push(c[i - 1] + distanceM(ligne[i - 1], ligne[i]));
  return c;
}

export type Projection = {
  /** Distance de la position au tracé, en mètres. */
  ecart: number;
  /** Indice du segment [i, i+1] le plus proche. */
  segment: number;
  /** Position sur ce segment, de 0 (sommet i) à 1 (sommet i+1). */
  t: number;
  /** Distance parcourue le long du tracé jusqu'au point projeté. */
  parcouru: number;
};

/**
 * Projette la position sur le tracé. On cherche à partir du segment courant
 * (`depuis`, un peu en arrière pour encaisser un GPS qui recule) : un tracé
 * qui repasse par la même rue ne doit pas faire sauter le guidage en avant.
 * Si rien n'est proche dans cette fenêtre, on cherche partout.
 */
export function projeter(pos: Pt, ligne: Pt[], cum: number[], depuis = 0): Projection {
  if (ligne.length < 2) {
    return { ecart: ligne.length ? distanceM(pos, ligne[0]) : Infinity, segment: 0, t: 0, parcouru: 0 };
  }
  // Projection plane locale (équirectangulaire) : exacte à quelques
  // centimètres près à l'échelle d'une rue.
  const kx = Math.cos(rad(pos[0])) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  const xy = (p: Pt) => [(p[1] - pos[1]) * kx, (p[0] - pos[0]) * ky] as const;

  const chercher = (debut: number): Projection => {
    let best: Projection = { ecart: Infinity, segment: 0, t: 0, parcouru: 0 };
    for (let i = Math.max(0, debut); i < ligne.length - 1; i++) {
      const [ax, ay] = xy(ligne[i]);
      const [bx, by] = xy(ligne[i + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best.ecart) {
        best = { ecart: d, segment: i, t, parcouru: cum[i] + t * (cum[i + 1] - cum[i]) };
      }
    }
    return best;
  };

  const local = chercher(depuis - 2);
  if (depuis <= 2 || local.ecart < 60) return local;
  const partout = chercher(0);
  return partout.ecart + 20 < local.ecart ? partout : local;
}

/** Ce qui reste à parcourir après la projection, en mètres et en secondes. */
export function restant(p: Projection, cum: number[], cumTemps: number[]): { metres: number; secondes: number } {
  const n = cum.length - 1;
  const i = Math.min(p.segment, Math.max(0, n - 1));
  const tFait = n > 0 ? cumTemps[i] + p.t * ((cumTemps[i + 1] ?? cumTemps[i]) - cumTemps[i]) : 0;
  return {
    metres: Math.max(0, cum[n] - p.parcouru),
    secondes: Math.max(0, cumTemps[n] - tFait),
  };
}

/** Indice de la prochaine manœuvre : la première qui commence devant nous. */
export function prochaineEtape(debuts: number[], parcouru: number, marge = 3): number {
  for (let i = 0; i < debuts.length; i++) if (debuts[i] > parcouru + marge) return i;
  return debuts.length - 1;
}

/* ─── Arrivée, écart, couverture ─────────────────────────────────────────── */

/** Rayon dans lequel on est « au panneau ». Un peu plus large en voiture :
 *  on se gare rarement pile devant. */
export const RAYON_ARRIVEE: Record<Mode, number> = { walking: 40, bicycling: 40, driving: 50 };

export function estArrive(distance: number, mode: Mode): boolean {
  return distance <= RAYON_ARRIVEE[mode];
}

/** Au-delà de cet écart au tracé, pendant ECART_DUREE_MS, on recalcule. */
export const ECART_SEUIL_M = 45;
export const ECART_DUREE_MS = 4000;
/** Jamais deux recalculs plus rapprochés que ça (anti-rebond vers OSRM). */
export const RECALCUL_MIN_MS = 10_000;
/** Précision GPS au-delà de laquelle on ne décide plus rien sur l'écart. */
export const PRECISION_MAX_M = 60;

/**
 * Décide quand on a vraiment quitté le tracé : il faut en être loin, de
 * façon nette au regard de la précision du GPS, et pendant quelques secondes
 * d'affilée. Un point aberrant isolé, un passage sous un pont ou une
 * précision dégradée ne déclenchent rien.
 */
export class DetecteurEcart {
  private depuis: number | null = null;
  private seuil: number;
  private duree: number;
  // Propriétés déclarées à la main (pas de `private` dans le constructeur) :
  // Node, qui exécute ce fichier tel quel pour les tests, ne sait qu'effacer
  // les types, pas transformer cette syntaxe.
  constructor(seuil = ECART_SEUIL_M, duree = ECART_DUREE_MS) {
    this.seuil = seuil;
    this.duree = duree;
  }

  /** Renvoie true quand il faut recalculer (et repart alors de zéro). */
  observer(ecart: number, precision: number, t: number): boolean {
    if (precision > PRECISION_MAX_M) return false; // on ne sait pas : on attend
    const dehors = ecart > this.seuil && ecart - precision * 0.5 > this.seuil * 0.6;
    if (!dehors) {
      this.depuis = null;
      return false;
    }
    if (this.depuis == null) this.depuis = t;
    if (t - this.depuis >= this.duree) {
      this.depuis = null;
      return true;
    }
    return false;
  }

  reinitialiser() {
    this.depuis = null;
  }
}

/**
 * Notre OSRM ne connaît que la Loire-Atlantique : un point hors zone est
 * « accroché » sans erreur à la route la plus proche DE LA ZONE, parfois à
 * des centaines de kilomètres, et le trajet renvoyé est absurde. OSRM donne
 * pour chaque point la distance de cet accrochage : au-delà d'ACCROCHE_MAX_M,
 * le point est hors couverture et on ne guide pas.
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
