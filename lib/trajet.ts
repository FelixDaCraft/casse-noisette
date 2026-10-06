// Trajet guidé : la réponse d'OSRM mise en forme pour l'écran de navigation.
//
// On ne détaille que la PREMIÈRE jambe (position -> prochain panneau) : tracé,
// consignes en français, distances et durées cumulées sommet par sommet pour
// afficher ce qui reste sans rappeler le serveur. Les jambes suivantes
// (panneau -> panneau) ne donnent que leur longueur et leur durée, pour le
// total « reste de la tournée ».

import type { RouteOsrm } from './osrm';
import { consigne } from './consignes';
import { cumul, horsCouverture, type Pt } from './guidage';

export type EtapeNav = {
  /** Distance le long du tracé où se fait la manœuvre, en mètres. */
  debut: number;
  type: string;
  modifier?: string;
  /** Consigne sans distance : « Tourne à droite sur la rue X ». */
  texte: string;
  lieu: Pt;
};

export type JambeResume = { metres: number; secondes: number; horsCouverture: boolean };

export type Trajet =
  | {
      statut: 'ok';
      ligne: Pt[];
      /** Distance cumulée à chaque sommet de `ligne` (m), puis durée cumulée (s). */
      cum: number[];
      cumTemps: number[];
      metres: number;
      secondes: number;
      etapes: EtapeNav[];
      /** Jambes suivantes, panneau après panneau. */
      suite: JambeResume[];
    }
  | {
      /** Départ ou prochain panneau hors de la zone couverte par notre OSRM. */
      statut: 'hors-couverture';
      /** Distance d'accrochage de chaque point envoyé, en mètres. */
      accroches: number[];
      /** Le point fautif : 0 = la position, 1 = le prochain panneau. */
      horsZone: number[];
      suite: JambeResume[];
    }
  | { statut: 'introuvable' };

const arr = (n: number, p = 1) => Math.round(n * p) / p;

export function construireTrajet(body: RouteOsrm): Trajet {
  const route = body.routes?.[0];
  if (body.code !== 'Ok' || !route || !route.legs.length) return { statut: 'introuvable' };

  const accroches = (body.waypoints ?? []).map((w) => (typeof w.distance === 'number' ? w.distance : NaN));
  const hors = horsCouverture(accroches);
  // Une jambe est hors couverture si l'un de ses deux bouts l'est.
  const suite: JambeResume[] = route.legs.slice(1).map((l, k) => ({
    metres: Math.round(l.distance),
    secondes: Math.round(l.duration),
    horsCouverture: hors.includes(k + 1) || hors.includes(k + 2),
  }));

  const horsPremiere = hors.filter((i) => i <= 1);
  if (horsPremiere.length) {
    return { statut: 'hors-couverture', accroches: accroches.map((a) => arr(a)), horsZone: horsPremiere, suite };
  }

  const jambe = route.legs[0];
  // Tracé de la jambe : les géométries des étapes bout à bout (le dernier
  // point d'une étape est le premier de la suivante).
  const ligne: Pt[] = [];
  const debutsIdx: number[] = [];
  for (const s of jambe.steps) {
    const coords = s.geometry.coordinates;
    debutsIdx.push(Math.max(0, ligne.length - 1));
    for (const [lng, lat] of coords) {
      const der = ligne[ligne.length - 1];
      if (!der || der[0] !== lat || der[1] !== lng) ligne.push([lat, lng]);
    }
  }
  if (ligne.length === 1) ligne.push(ligne[0]); // départ = arrivée : tracé dégénéré
  const cum = cumul(ligne);

  // Durées cumulées : les annotations d'OSRM donnent la durée de chaque
  // segment, au plus juste (feux, vitesses par rue). Si elles ne collent pas
  // au tracé, on répartit la durée de la jambe au prorata de la distance.
  const durees = jambe.annotation?.duration;
  const cumTemps = [0];
  const total = cum[cum.length - 1];
  for (let i = 1; i < ligne.length; i++) {
    const d =
      durees && durees.length === ligne.length - 1
        ? durees[i - 1]
        : total > 0
          ? (jambe.duration * (cum[i] - cum[i - 1])) / total
          : 0;
    cumTemps.push(cumTemps[i - 1] + d);
  }

  // « Sors du rond-point » répète la sortie déjà annoncée au rond-point : on
  // garde la géométrie de ces étapes, pas leur consigne.
  const garder = (t: string) => t !== 'exit roundabout' && t !== 'exit rotary';
  const etapes: EtapeNav[] = jambe.steps.flatMap((s, k) => {
    const m = s.maneuver;
    if (!garder(m.type)) return [];
    return [{
      debut: arr(cum[debutsIdx[k]] ?? 0),
      type: m.type,
      modifier: m.modifier,
      texte: consigne({
        type: m.type,
        modifier: m.modifier,
        exit: m.exit,
        capApres: m.bearing_after,
        nom: s.name,
        ref: s.ref,
        rondPoint: s.rotary_name,
        destinations: s.destinations,
      }),
      lieu: [m.location[1], m.location[0]] as Pt,
    }];
  });

  return {
    statut: 'ok',
    ligne: ligne.map(([la, ln]) => [arr(la, 1e6), arr(ln, 1e6)] as Pt),
    cum: cum.map((c) => arr(c, 10)),
    cumTemps: cumTemps.map((t) => arr(t, 10)),
    metres: Math.round(total),
    secondes: Math.round(cumTemps[cumTemps.length - 1]),
    etapes,
    suite,
  };
}
