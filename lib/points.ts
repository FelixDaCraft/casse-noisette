// Barème des points, niveaux et badges — le seul endroit où ils se décident.
//
// Les points ne sont stockés nulle part : ils se recalculent à partir des
// signalements (`Report`), qui sont des constats datés faits sur le terrain.
// Personne ne peut donc « se donner » des points autrement qu'en signalant,
// et changer le barème ici recalcule tout, rétroactivement, pour tout le monde.
//
// Fichier pur (ni Prisma, ni Node) : il sert au serveur pour calculer, à
// l'interface pour afficher le barème, et aux scripts `prisma/*.mjs` (Node
// lit le TypeScript directement) pour vérifier les points de démo.
//
// Ce qui rapporte, du plus au moins :
//   1. une tournée complétée — tous ses panneaux marqués « collé » par le
//      même militant en moins de FENETRE_TOURNEE_H heures, dont au moins la
//      moitié vraiment collés (pas seulement trouvés en place) : un bonus, en
//      plus des points de chaque collage ;
//   2. un panneau collé ;
//   3. un constat (recouvert, arraché, tagué, vide, absent) : vérifier
//      l'état d'un panneau, c'est ce qui dit où repasser. Un « collé » sur un
//      panneau déjà marqué collé (par n'importe qui) depuis moins de
//      VERIFICATION_J jours est aussi un constat : l'affiche tenait, on l'a
//      vérifiée, on ne l'a pas collée.
//
// Ce qui ne rapporte rien (anti-triche, anti-spam) :
//   - le même panneau, pour le même militant, plus d'une fois par
//     MEME_PANNEAU_H heures (un compteur pour les collages, un pour les
//     constats : trouver un panneau vide puis le coller rapporte les deux) ;
//   - un signalement arrivé moins de RAFALE_S secondes après un signalement
//     d'un autre panneau : personne ne va d'un panneau à l'autre aussi vite ;
//   - au-delà de PLAFOND_JOUR points dans la journée.
// Le serveur refuse déjà, en amont, plus de 30 signalements par 5 minutes et
// deux signalements du même panneau en moins de 10 minutes (app/actions.ts).

import type { Etat } from './etatsPanneau';

export const BAREME = {
  colle: 10,
  constat: 3,
  /** Bonus d'une tournée complète : une base, plus un peu par panneau pour
   *  qu'une longue tournée vaille plus qu'une courte. */
  tournee: { base: 20, parPanneau: 5 },
} as const;

/** Fenêtre dans laquelle tous les panneaux d'une tournée doivent être collés. */
export const FENETRE_TOURNEE_H = 6;
/** Part minimale de vrais collages (hors confirmations) dans une tournée
 *  complète : refaire le tour d'affiches qui tiennent n'est pas la coller. */
export const TOURNEE_PART_COLLEE = 0.5;
/** Une tournée de moins de panneaux ne donne pas de bonus (un panneau seul
 *  serait une « tournée » à chaque collage). */
export const TOURNEE_MIN_PANNEAUX = 2;
/** Un « collé » qui suit un « collé » de moins de tant de jours sur le même
 *  panneau confirme l'affiche : il compte comme un constat. Au-delà, c'est
 *  une nouvelle affiche (nouvelle campagne, ancienne délavée). */
export const VERIFICATION_J = 7;
/** Délai avant qu'un même panneau rapporte à nouveau au même militant. Vaut
 *  aussi pour le bonus d'une même tournée. */
export const MEME_PANNEAU_H = 24;
/** En dessous, deux signalements de panneaux différents sont une rafale. */
export const RAFALE_S = 45;
/** Plafond de points par militant et par jour (heure de Paris). */
export const PLAFOND_JOUR = 400;

/** Début de la campagne : la période « campagne » des classements, et celle
 *  sur laquelle se calcule le niveau. */
export const CAMPAGNE = { nom: 'Campagne 2027', debut: '2026-09-01' } as const;

/* ─── Calcul ─────────────────────────────────────────────────────────────── */

export type SignalementBrut = {
  id: string;
  militantId: string;
  panelId: string;
  status: Etat;
  createdAt: Date;
  /** Département du panneau : c'est là que les points comptent. */
  department: string | null;
  /** Signalement précédent du même panneau, par n'importe quel militant. */
  precedent: { status: Etat; createdAt: Date } | null;
};

export type TourneeBrute = { id: string; panelIds: string[]; department: string | null };

export type TypeGain = 'colle' | 'constat' | 'tournee';

export type Gain = {
  militantId: string;
  type: TypeGain;
  points: number;
  date: Date;
  /** Signalement qui rapporte (pour une tournée : le collage qui la complète). */
  reportId: string;
  panelId: string;
  itineraryId?: string;
  department: string | null;
  status: Etat;
};

const H = 3600_000;

// Formateurs créés une fois : Intl est coûteux à instancier.
const fmtJour = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });

/** « 2026-10-05 », jour civil à Paris. */
export const jourParis = (d: Date) => fmtJour.format(d);
/** Heure (0-23) à Paris. */
export const heureParis = (d: Date) => Number(fmtHeure.format(d).replace(/\D/g, ''));
/** Numéro de semaine absolu (lundi → dimanche, heure de Paris). */
export function semaineParis(d: Date): number {
  const [a, m, j] = jourParis(d).split('-').map(Number);
  const jours = Date.UTC(a, m - 1, j) / 86400_000;
  // Le 1er janvier 1970 était un jeudi : +3 cale les semaines sur le lundi.
  return Math.floor((jours + 3) / 7);
}

/**
 * Points gagnés, signalement par signalement, à partir de l'historique brut.
 * Pour une période, passer aussi les signalements des MEME_PANNEAU_H heures
 * qui la précèdent (les plafonds en dépendent), puis filtrer les gains sur la
 * date : c'est ce que fait `chargerGains` (lib/classement.ts).
 */
export function calculerGains(signalements: SignalementBrut[], tournees: TourneeBrute[]): Gain[] {
  // Une tournée de commune et une tournée de circo peuvent passer par les
  // mêmes panneaux : un seul bonus pour un même ensemble.
  const parPanneau = new Map<string, TourneeBrute[]>();
  const vues = new Set<string>();
  for (const t of tournees) {
    const ids = [...new Set(t.panelIds)];
    if (ids.length < TOURNEE_MIN_PANNEAUX) continue;
    const cle = [...ids].sort().join(',');
    if (vues.has(cle)) continue;
    vues.add(cle);
    const tt = { ...t, panelIds: ids };
    for (const p of ids) {
      if (!parPanneau.has(p)) parPanneau.set(p, []);
      parPanneau.get(p)!.push(tt);
    }
  }

  const parMilitant = new Map<string, SignalementBrut[]>();
  for (const s of signalements) {
    if (!parMilitant.has(s.militantId)) parMilitant.set(s.militantId, []);
    parMilitant.get(s.militantId)!.push(s);
  }

  const gains: Gain[] = [];
  for (const liste of parMilitant.values()) {
    liste.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const candidats: Gain[] = [];
    const dernier = { colle: new Map<string, number>(), constat: new Map<string, number>() };
    // « Collé » retenus pour les tournées : hors rafale, même déjà payés (un
    // panneau recollé le lendemain compte pour finir la tournée du jour) ;
    // `vrai` distingue un collage d'une affiche trouvée en place.
    const collages: (SignalementBrut & { vrai: boolean })[] = [];

    let prec: SignalementBrut | null = null;
    for (const s of liste) {
      const t = s.createdAt.getTime();
      const rafale = prec != null && prec.panelId !== s.panelId && t - prec.createdAt.getTime() < RAFALE_S * 1000;
      prec = s;
      if (rafale) continue;
      const confirmation =
        s.precedent?.status === 'colle' && t - s.precedent.createdAt.getTime() < VERIFICATION_J * 24 * H;
      const type = s.status === 'colle' && !confirmation ? 'colle' : 'constat';
      if (s.status === 'colle') collages.push({ ...s, vrai: !confirmation });

      const avant = dernier[type].get(s.panelId);
      if (avant != null && t - avant < MEME_PANNEAU_H * H) continue;
      dernier[type].set(s.panelId, t);
      candidats.push({
        militantId: s.militantId,
        type,
        points: BAREME[type],
        date: s.createdAt,
        reportId: s.id,
        panelId: s.panelId,
        department: s.department,
        status: s.status,
      });
    }

    // Tournées : fenêtre glissante de FENETRE_TOURNEE_H heures sur les
    // collages de ses panneaux ; complète quand tous y figurent.
    const parTournee = new Map<TourneeBrute, (typeof collages)[number][]>();
    for (const c of collages) {
      for (const tt of parPanneau.get(c.panelId) ?? []) {
        if (!parTournee.has(tt)) parTournee.set(tt, []);
        parTournee.get(tt)!.push(c);
      }
    }
    for (const [tt, evts] of parTournee) {
      if (evts.length < tt.panelIds.length) continue;
      // Par panneau, dans la fenêtre : nombre de « collé », dont vrais.
      const compte = new Map<string, { n: number; vrais: number }>();
      const bouge = (e: (typeof evts)[number], d: 1 | -1) => {
        const c = compte.get(e.panelId) ?? { n: 0, vrais: 0 };
        c.n += d;
        if (e.vrai) c.vrais += d;
        if (c.n) compte.set(e.panelId, c);
        else compte.delete(e.panelId);
      };
      const besoin = Math.ceil(tt.panelIds.length * TOURNEE_PART_COLLEE);
      let gauche = 0;
      let bonusPrec = -Infinity;
      for (const e of evts) {
        const t = e.createdAt.getTime();
        bouge(e, 1);
        while (evts[gauche].createdAt.getTime() < t - FENETRE_TOURNEE_H * H) bouge(evts[gauche++], -1);
        const vrais = [...compte.values()].filter((c) => c.vrais > 0).length;
        if (compte.size === tt.panelIds.length && vrais >= besoin && t - bonusPrec >= MEME_PANNEAU_H * H) {
          bonusPrec = t;
          candidats.push({
            militantId: e.militantId,
            type: 'tournee',
            points: BAREME.tournee.base + BAREME.tournee.parPanneau * tt.panelIds.length,
            date: e.createdAt,
            reportId: e.id,
            panelId: e.panelId,
            itineraryId: tt.id,
            department: tt.department ?? e.department,
            status: 'colle',
          });
        }
      }
    }

    // Plafond journalier, dans l'ordre chronologique (le bonus d'une tournée
    // passe après le collage qui la complète).
    candidats.sort(
      (a, b) => a.date.getTime() - b.date.getTime() || Number(a.type === 'tournee') - Number(b.type === 'tournee'),
    );
    const parJour = new Map<string, number>();
    for (const g of candidats) {
      const j = jourParis(g.date);
      const deja = parJour.get(j) ?? 0;
      const pts = Math.min(g.points, PLAFOND_JOUR - deja);
      if (pts <= 0) continue;
      parJour.set(j, deja + pts);
      gains.push({ ...g, points: pts });
    }
  }
  return gains;
}

/* ─── Bilan, niveaux, badges ─────────────────────────────────────────────── */

export type Bilan = {
  points: number;
  colles: number;
  constats: number;
  tournees: number;
  /** Constats de panneaux tagués. */
  tags: number;
  /** Collages entre 22 h et 5 h (heure de Paris). */
  nuits: number;
  /** Plus longue suite de semaines consécutives passées au même panneau. */
  gardien: number;
};

export function bilan(gains: Gain[]): Bilan {
  const b: Bilan = { points: 0, colles: 0, constats: 0, tournees: 0, tags: 0, nuits: 0, gardien: 0 };
  const semaines = new Map<string, Set<number>>();
  for (const g of gains) {
    b.points += g.points;
    if (g.type === 'tournee') {
      b.tournees++;
      continue;
    }
    if (g.type === 'colle') {
      b.colles++;
      const h = heureParis(g.date);
      if (h >= 22 || h < 5) b.nuits++;
    } else {
      b.constats++;
      if (g.status === 'tague') b.tags++;
    }
    if (!semaines.has(g.panelId)) semaines.set(g.panelId, new Set());
    semaines.get(g.panelId)!.add(semaineParis(g.date));
  }
  for (const s of semaines.values()) {
    const tri = [...s].sort((a, c) => a - c);
    let suite = 1;
    for (let i = 0; i < tri.length; i++) {
      suite = i > 0 && tri[i] === tri[i - 1] + 1 ? suite + 1 : 1;
      if (suite > b.gardien) b.gardien = suite;
    }
  }
  return b;
}

export type Niveau = { rang: number; nom: string; seuil: number };

/** Niveaux, sur les points de la campagne. Des paliers qui s'espacent : le
 *  premier vient en une soirée (une tournée de 10 panneaux : 170 points), le
 *  dernier en une campagne d'engagement régulier. */
export const NIVEAUX: Niveau[] = [
  { rang: 1, nom: 'Pinceau neuf', seuil: 0 },
  { rang: 2, nom: 'Seau de colle', seuil: 100 },
  { rang: 3, nom: 'Colleur·se de quartier', seuil: 300 },
  { rang: 4, nom: 'Brigade du soir', seuil: 800 },
  { rang: 5, nom: 'Mur rouge', seuil: 1800 },
  { rang: 6, nom: 'Légende du pinceau', seuil: 3500 },
];

export function niveau(points: number) {
  let i = 0;
  while (i + 1 < NIVEAUX.length && points >= NIVEAUX[i + 1].seuil) i++;
  const actuel = NIVEAUX[i];
  const suivant = NIVEAUX[i + 1] ?? null;
  const progression = suivant ? (points - actuel.seuil) / (suivant.seuil - actuel.seuil) : 1;
  return { actuel, suivant, progression, reste: suivant ? suivant.seuil - points : 0 };
}

export type IconeBadge = 'tournee' | 'affiche' | 'brigade' | 'oeil' | 'lune' | 'bouclier';

export type Badge = {
  id: string;
  nom: string;
  description: string;
  icone: IconeBadge;
  objectif: number;
  mesure: (b: Bilan) => number;
};

/** Badges, du plus accessible au plus exigeant. Tous se déduisent du bilan. */
export const BADGES: Badge[] = [
  {
    id: 'premiere-tournee',
    nom: 'Première tournée',
    description: `Coller tous les panneaux d’une tournée en moins de ${FENETRE_TOURNEE_H} h`,
    icone: 'tournee',
    objectif: 1,
    mesure: (b) => b.tournees,
  },
  { id: 'colle-10', nom: 'Dix affiches', description: 'Coller 10 panneaux', icone: 'affiche', objectif: 10, mesure: (b) => b.colles },
  { id: 'colle-50', nom: 'Cinquante affiches', description: 'Coller 50 panneaux', icone: 'affiche', objectif: 50, mesure: (b) => b.colles },
  { id: 'colle-100', nom: 'Cent affiches', description: 'Coller 100 panneaux', icone: 'affiche', objectif: 100, mesure: (b) => b.colles },
  {
    id: 'vigie',
    nom: 'Vigie antifasciste',
    description: 'Signaler 5 panneaux tagués',
    icone: 'oeil',
    objectif: 5,
    mesure: (b) => b.tags,
  },
  {
    id: 'couche-tard',
    nom: 'Couche-tard',
    description: 'Coller 5 panneaux entre 22 h et 5 h',
    icone: 'lune',
    objectif: 5,
    mesure: (b) => b.nuits,
  },
  {
    id: 'gardien',
    nom: 'Gardien·ne de panneau',
    description: 'Passer au même panneau 4 semaines de suite',
    icone: 'bouclier',
    objectif: 4,
    mesure: (b) => b.gardien,
  },
  {
    id: 'brigade',
    nom: 'Brigade',
    description: 'Compléter 10 tournées',
    icone: 'brigade',
    objectif: 10,
    mesure: (b) => b.tournees,
  },
];

export function badges(b: Bilan) {
  return BADGES.map((badge) => {
    const val = Math.min(badge.mesure(b), badge.objectif);
    return { badge, val, obtenu: val >= badge.objectif };
  });
}

/* ─── Périodes ───────────────────────────────────────────────────────────── */

export type Periode = 'semaine' | 'mois' | 'campagne';
export const PERIODES: Periode[] = ['semaine', 'mois', 'campagne'];
export const PERIODE: Record<Periode, string> = { semaine: 'Semaine', mois: 'Mois', campagne: 'Campagne' };
export const estPeriode = (v: unknown): v is Periode => typeof v === 'string' && (PERIODES as string[]).includes(v);

/** Minuit à Paris, le jour civil donné (« 2026-10-05 »). */
function minuitParis(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number);
  const utc = Date.UTC(a, m - 1, j);
  // Décalage de Paris à cette date (1 h ou 2 h) : on le lit plutôt que de
  // recoder les règles de l'heure d'été.
  const [a2, m2, j2] = jourParis(new Date(utc)).split('-').map(Number);
  const h = heureParis(new Date(utc));
  const vu = Date.UTC(a2, m2 - 1, j2, h);
  return new Date(utc - (vu - utc));
}

/** Début de la période : lundi de la semaine, 1er du mois (heure de Paris),
 *  ou début de la campagne. */
export function debutPeriode(p: Periode, maintenant = new Date()): Date {
  if (p === 'campagne') return minuitParis(CAMPAGNE.debut);
  const jour = jourParis(maintenant);
  if (p === 'mois') return minuitParis(jour.slice(0, 8) + '01');
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  const lundi = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000);
  return minuitParis(lundi.toISOString().slice(0, 10));
}
