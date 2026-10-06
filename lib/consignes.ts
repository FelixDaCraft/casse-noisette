// Consignes de navigation en français, à partir des manœuvres d'OSRM.
//
// OSRM décrit chaque changement de direction par un `type` (turn, fork,
// roundabout…), un `modifier` (left, slight right, uturn…) et le nom de la
// voie qu'on emprunte ensuite. On en tire une phrase courte, au tutoiement
// comme le reste de l'appli, lisible d'un coup d'œil dans le bandeau et
// prononçable telle quelle par la synthèse vocale (« deuxième sortie » plutôt
// que « 2e sortie », que certaines voix lisent mal).
//
// Fichier pur (ni Node, ni navigateur, aucun import à l'exécution) : il sert
// à la route /api/navigation pour rédiger les consignes, à l'écran de
// navigation pour les annonces, et se teste directement avec Node
// (scripts/tester-navigation.mjs).
//
// Référence des manœuvres : http://project-osrm.org/docs/v5.24.0/api/#stepmaneuver-object

import type { Mode } from './maps';

/** Ce qu'on garde d'une étape OSRM pour rédiger la consigne. */
export type Manoeuvre = {
  type: string;
  modifier?: string;
  /** Numéro de sortie d'un rond-point (type roundabout / rotary). */
  exit?: number;
  /** Cap à la sortie de la manœuvre, en degrés (sert au départ). */
  capApres?: number;
  /** Nom de la voie empruntée ensuite (« » si OSRM n'en connaît pas). */
  nom?: string;
  /** Numéro de route (« D 723 »), utile quand la voie n'a pas de nom. */
  ref?: string;
  /** Nom du rond-point lui-même, quand il en a un (type rotary). */
  rondPoint?: string;
  /** Panneaux de direction d'une bretelle (« A 83: Bordeaux, Vertou »). */
  destinations?: string;
};

/* ─── Voies ──────────────────────────────────────────────────────────────── */

// Type de voie -> article. On écrit « sur la rue de la Commune » et pas « sur
// Rue de la Commune » : c'est ce qu'on dirait à voix haute.
const FEMININ = [
  'rue', 'avenue', 'place', 'route', 'allée', 'allee', 'impasse', 'voie', 'ruelle', 'venelle',
  'promenade', 'esplanade', 'chaussée', 'chaussee', 'rocade', 'traverse', 'montée', 'montee',
  'descente', 'cité', 'cite', 'résidence', 'residence', 'sente', 'passerelle', 'piste', 'levée',
  'levee', 'corniche', 'contre-allée', 'contre-allee', 'galerie', 'cour', 'zone',
];
const MASCULIN = [
  'boulevard', 'quai', 'chemin', 'cours', 'pont', 'passage', 'square', 'mail', 'rond-point',
  'carrefour', 'parvis', 'sentier', 'faubourg', 'giratoire', 'parking', 'tunnel', 'périphérique',
  'periphérique', 'peripherique', 'lotissement', 'hameau', 'clos', 'domaine', 'parc', 'jardin',
  'vallon', 'plateau', 'village',
];

/** « Rue de la Commune » -> « la rue de la Commune » ; « Allée X » -> « l'allée X ».
 *  Un nom qui ne commence pas par un type de voie connu reste tel quel
 *  (« Les Trois Croissants », « D 723 »). */
export function voie(nom: string): string {
  const n = nom.trim();
  if (!n) return '';
  const m = /^([\p{L}-]+)(.*)$/u.exec(n);
  if (!m) return n;
  const [, mot, reste] = m;
  const bas = mot.toLowerCase();
  const voyelle = /^[aeiouyhâàéèêîïôûœ]/i.test(bas);
  if (FEMININ.includes(bas)) {
    return (voyelle ? 'l’' : 'la ') + bas + reste;
  }
  if (MASCULIN.includes(bas)) {
    return (voyelle ? 'l’' : 'le ') + bas + reste;
  }
  return n;
}

/** Nom à annoncer pour une étape : la voie, sinon son numéro de route. */
function nomDe(m: Manoeuvre): string {
  const nom = m.nom?.trim();
  if (nom) return voie(nom);
  const ref = m.ref?.split(';')[0]?.trim();
  return ref ?? '';
}

/** « sur la rue X », ou rien si la voie n'a pas de nom. */
const sur = (m: Manoeuvre) => {
  const n = nomDe(m);
  return n ? ` sur ${n}` : '';
};

/** Bretelles et embranchements : « sur la N 165 », sinon « direction Vertou »
 *  d'après les panneaux de direction (« A 83: Bordeaux, Vertou »). */
const surOuVers = (m: Manoeuvre) => {
  const s = sur(m);
  if (s) return s;
  const d = m.destinations?.split(':').pop()?.split(',').slice(0, 2).map((x) => x.trim()).filter(Boolean).join(', ');
  return d ? ` direction ${d}` : '';
};

/* ─── Directions ─────────────────────────────────────────────────────────── */

/** « à gauche », « légèrement à droite »… pour un modifier OSRM. */
export function direction(modifier?: string): string {
  switch (modifier) {
    case 'left':
      return 'à gauche';
    case 'right':
      return 'à droite';
    case 'slight left':
      return 'légèrement à gauche';
    case 'slight right':
      return 'légèrement à droite';
    case 'sharp left':
      return 'fortement à gauche';
    case 'sharp right':
      return 'fortement à droite';
    case 'uturn':
      return 'demi-tour';
    default:
      return 'tout droit';
  }
}

/** Côté seul, sans nuance : « à gauche » / « à droite » / « » (fourches, bretelles). */
function cote(modifier?: string): string {
  if (modifier?.includes('left')) return 'à gauche';
  if (modifier?.includes('right')) return 'à droite';
  return '';
}

/** Le geste de base : « Tourne à gauche », « Continue tout droit », « Fais demi-tour ». */
function geste(modifier?: string): string {
  if (modifier === 'uturn') return 'Fais demi-tour';
  if (!modifier || modifier === 'straight') return 'Continue tout droit';
  return `Tourne ${direction(modifier)}`;
}

const POINTS_CARDINAUX = ['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'];

/** Cap en degrés -> « le nord-est ». */
export function cardinal(cap: number): string {
  const i = Math.round((((cap % 360) + 360) % 360) / 45) % 8;
  return POINTS_CARDINAUX[i];
}

const ORDINAUX = ['première', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'sixième', 'septième', 'huitième', 'neuvième', 'dixième'];

/** 2 -> « deuxième » (en toutes lettres : la synthèse vocale lit mal « 2e »). */
export function ordinal(n: number): string {
  return ORDINAUX[n - 1] ?? `${n}e`;
}

/* ─── Consigne ───────────────────────────────────────────────────────────── */

/**
 * La consigne d'une étape, sans la distance : « Tourne à droite sur la rue
 * de la Commune ». `cible` nomme ce qu'on rejoint à l'arrivée (« au panneau »).
 */
export function consigne(m: Manoeuvre, cible = 'au panneau'): string {
  const mod = m.modifier;
  switch (m.type) {
    case 'depart': {
      const vers = m.capApres != null ? ` vers ${cardinal(m.capApres)}` : '';
      return `Pars${vers}${sur(m)}`;
    }
    case 'arrive': {
      const c = cote(mod);
      return c ? `Tu arrives ${cible}, ${c}` : `Tu arrives ${cible}`;
    }
    case 'turn':
      return `${geste(mod)}${sur(m)}`;
    case 'new name':
      // La voie change de nom sans qu'on tourne vraiment.
      return mod && mod !== 'straight' && mod !== 'uturn'
        ? `Continue ${direction(mod)}${sur(m)}`
        : `Continue${sur(m) || ' tout droit'}`;
    case 'continue': {
      if (mod === 'uturn') return `Fais demi-tour${sur(m)}`;
      if (!mod || mod === 'straight') return `Continue tout droit${sur(m)}`;
      // OSRM : on tourne pour rester sur la même voie.
      const n = nomDe(m);
      return n ? `Tourne ${direction(mod)} pour rester sur ${n}` : `Tourne ${direction(mod)}`;
    }
    case 'merge': {
      const c = cote(mod);
      return `Insère-toi${c ? ' ' + c : ''}${sur(m)}`;
    }
    case 'on ramp': {
      const c = cote(mod);
      return `Prends la bretelle${c ? ' ' + c : ''}${surOuVers(m)}`;
    }
    case 'off ramp': {
      const c = cote(mod);
      return `Prends la sortie${c ? ' ' + c : ''}${surOuVers(m)}`;
    }
    case 'fork': {
      const c = cote(mod) || 'tout droit';
      return `À l’embranchement, garde ${c === 'à gauche' ? 'la gauche' : c === 'à droite' ? 'la droite' : 'le cap'}${surOuVers(m)}`;
    }
    case 'end of road':
      return `Au bout de la voie, ${geste(mod).toLowerCase()}${sur(m)}`;
    case 'roundabout':
    case 'rotary': {
      // « Rond-Point de Vertou » ne doit pas donner « Au rond-point Rond-Point de Vertou ».
      const nomRp = m.rondPoint?.trim().replace(/^rond[- ]point\s+/i, '');
      const au = nomRp ? `Au rond-point ${nomRp}` : 'Au rond-point';
      if (m.exit && m.exit > 0) return `${au}, prends la ${ordinal(m.exit)} sortie${sur(m)}`;
      return `${au}, ${geste(mod).toLowerCase()}${sur(m)}`;
    }
    case 'roundabout turn':
      // Petit rond-point traité comme un carrefour.
      return `Au rond-point, ${geste(mod).toLowerCase()}${sur(m)}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Sors du rond-point${sur(m)}`;
    case 'notification':
    case 'use lane':
    default:
      return `Continue${sur(m) || ' tout droit'}`;
  }
}

/**
 * Étapes qu'on affiche sans les annoncer à voix haute : la voie change de nom
 * mais on va tout droit (chaque pont, chaque carrefour sur un boulevard).
 * Les dire toutes noierait les vraies consignes.
 */
export function estSilencieuse(type: string, modifier?: string): boolean {
  const toutDroit = !modifier || modifier === 'straight';
  return (type === 'new name' || type === 'continue' || type === 'notification' || type === 'use lane') && toutDroit;
}

/* ─── Distances ──────────────────────────────────────────────────────────── */

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

/** Pour la voix : « 200 mètres », « 1,5 kilomètre ». */
export function distanceParlee(m: number): string {
  if (m < 950) return `${arrondi(m)} mètres`;
  const km = Math.round(m / 100) / 10;
  const txt = (km < 10 ? km.toFixed(1).replace(/\.0$/, '') : Math.round(km).toString()).replace('.', ',');
  return `${txt} ${km < 2 ? 'kilomètre' : 'kilomètres'}`;
}

/** Durée : « 1 min », « 12 min », « 1 h 05 ». */
export function dureeCourte(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  const h = Math.floor(s / 3600);
  return `${h} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}

const minuscule = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** « Dans 200 mètres, tourne à droite sur la rue X ». */
export function annonce(texte: string, distance: number): string {
  return `Dans ${distanceParlee(distance)}, ${minuscule(texte)}`;
}

/** Deux manœuvres rapprochées s'annoncent ensemble : « …, puis tourne à gauche ». */
export function avecSuite(texte: string, suivante: string | null): string {
  return suivante ? `${texte}, puis ${minuscule(suivante)}` : texte;
}

/* ─── Annonces vocales ───────────────────────────────────────────────────── */

/**
 * Distances d'annonce selon le mode : une annonce « préparation » (loin) et
 * une annonce « maintenant » (proche). À pied on a le temps ; en voiture, il
 * faut prévenir avant le carrefour, pas dessus.
 */
export const PALIERS: Record<Mode, { loin: number; proche: number }> = {
  walking: { loin: 120, proche: 20 },
  bicycling: { loin: 250, proche: 40 },
  driving: { loin: 600, proche: 80 },
};

export type Palier = 'loin' | 'proche';

/**
 * Annonce à faire maintenant pour la prochaine manœuvre, ou null.
 * `deja` : ce qui a déjà été dit pour cette manœuvre. `longueur` : distance
 * entre la manœuvre précédente et celle-ci — une étape courte n'a pas
 * d'annonce « loin » (elle tomberait avant même la manœuvre précédente).
 */
export function annonceDue(
  mode: Mode,
  distance: number,
  deja: Palier | null,
  longueur = Infinity,
): Palier | null {
  const p = PALIERS[mode];
  if (deja === 'proche') return null;
  if (distance <= p.proche) return 'proche';
  if (deja == null && distance <= p.loin && distance > p.proche * 1.5 && longueur > p.proche * 2) return 'loin';
  return null;
}
