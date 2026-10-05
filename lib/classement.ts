import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { Etat } from '@/lib/etatsPanneau';
import { nomCourt } from '@/lib/signalements';
import {
  MEME_PANNEAU_H,
  VERIFICATION_J,
  badges,
  bilan,
  calculerGains,
  debutPeriode,
  type Gain,
  type Periode,
} from '@/lib/points';

/* Chargement des signalements et classements. Le barème lui-même est dans
   lib/points.ts ; ici, on va chercher en base ce qu'il faut pour l'appliquer. */

/** Marge avant le début de la période : les plafonds (même panneau en
 *  24 h, tournée en 6 h) dépendent des signalements qui la précèdent. */
const MARGE_MS = MEME_PANNEAU_H * 3600_000;

/**
 * Gains depuis `depuis`, pour tous les militants ou seulement ceux donnés.
 * Exact dans les deux cas : un plafond ne dépend que des signalements du
 * militant lui-même.
 */
async function calculer(depuis: Date, militantIds?: string[]): Promise<Gain[]> {
  const debut = new Date(depuis.getTime() - MARGE_MS);
  // Le signalement précédent de chaque panneau (LAG), par n'importe qui :
  // c'est lui qui dit si un « collé » colle ou confirme. La fenêtre est
  // calculée avant le filtre extérieur, sur VERIFICATION_J jours de plus.
  const lignes = await prisma.$queryRaw<Ligne[]>`
    SELECT * FROM (
      SELECT r."id", r."militantId", r."panelId", r."status"::text AS "status", r."createdAt",
        p."department",
        LAG(r."status"::text) OVER w AS "precStatus",
        LAG(r."createdAt") OVER w AS "precDate"
      FROM "Report" r
      JOIN "Panel" p ON p."id" = r."panelId"
      WHERE r."createdAt" >= ${new Date(debut.getTime() - VERIFICATION_J * 86400_000)}
      WINDOW w AS (PARTITION BY r."panelId" ORDER BY r."createdAt", r."id")
    ) x
    WHERE x."createdAt" >= ${debut} AND x."militantId" IS NOT NULL
    ${militantIds ? Prisma.sql`AND x."militantId" IN (${Prisma.join(militantIds)})` : Prisma.empty}`;

  // Seules comptent les tournées qui passent par un panneau collé.
  const colles = [...new Set(lignes.filter((r) => r.status === 'colle').map((r) => r.panelId))];
  const tournees = colles.length
    ? await prisma.itinerary.findMany({
        where: { stops: { some: { panelId: { in: colles } } } },
        select: { id: true, department: true, stops: { select: { panelId: true } } },
      })
    : [];
  const gains = calculerGains(
    lignes.map((r) => ({
      id: r.id,
      militantId: r.militantId,
      panelId: r.panelId,
      status: r.status,
      createdAt: r.createdAt,
      department: r.department,
      precedent: r.precStatus && r.precDate ? { status: r.precStatus, createdAt: r.precDate } : null,
    })),
    tournees.map((t) => ({ id: t.id, department: t.department, panelIds: t.stops.map((s) => s.panelId) })),
  );
  return gains.filter((g) => g.date >= depuis);
}

type Ligne = {
  id: string;
  militantId: string;
  panelId: string;
  status: Etat;
  createdAt: Date;
  department: string | null;
  precStatus: Etat | null;
  precDate: Date | null;
};

/* Les classements relisent tous les signalements de la période : une minute
   de cache suffit à ce qu'une page rechargée en boucle ne coûte rien, sans
   qu'un collage mette longtemps à apparaître. Même idée que le cache de
   lib/routing.ts, sur globalThis pour survivre au rechargement à chaud. */
const TTL_MS = 60_000;
const g = globalThis as unknown as { __cnGains?: Map<string, { t: number; gains: Promise<Gain[]> }> };
const cache = (g.__cnGains ??= new Map());

export function gainsPeriode(p: Periode): Promise<Gain[]> {
  const depuis = debutPeriode(p);
  const cle = depuis.toISOString();
  const hit = cache.get(cle);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.gains;
  const gains = calculer(depuis);
  cache.set(cle, { t: Date.now(), gains });
  gains.catch(() => cache.delete(cle));
  return gains;
}

/** Gains d'un militant sur toute la campagne (profil, récompense). */
export function gainsMilitant(militantId: string): Promise<Gain[]> {
  return calculer(debutPeriode('campagne'), [militantId]);
}

export type Recompense = {
  points: number;
  /** Bonus de tournée complète, compris dans `points`. */
  tournee: number;
  badges: { id: string; nom: string }[];
};

/** Ce que vient de rapporter un signalement : ses points, le bonus de
 *  tournée qu'il déclenche, et les badges qu'il fait passer. */
export async function recompenseDe(militantId: string, reportId: string): Promise<Recompense> {
  const gains = await gainsMilitant(militantId);
  const siens = gains.filter((x) => x.reportId === reportId);
  const avant = badges(bilan(gains.filter((x) => x.reportId !== reportId)));
  const apres = badges(bilan(gains));
  return {
    points: siens.reduce((s, x) => s + x.points, 0),
    tournee: siens.filter((x) => x.type === 'tournee').reduce((s, x) => s + x.points, 0),
    badges: apres
      .filter((b, i) => b.obtenu && !avant[i].obtenu)
      .map(({ badge }) => ({ id: badge.id, nom: badge.nom })),
  };
}

/* ─── Classements ────────────────────────────────────────────────────────── */

export type LigneClassement = {
  id: string;
  nom: string;
  sous?: string;
  points: number;
  colles: number;
  rang: number;
  moi?: boolean;
};

/** Rang « olympique » : deux ex æquo partagent la place, la suivante saute. */
function classer(lignes: Omit<LigneClassement, 'rang'>[]): LigneClassement[] {
  const tri = [...lignes].sort((a, b) => b.points - a.points || b.colles - a.colles || a.nom.localeCompare(b.nom, 'fr'));
  let rang = 0;
  return tri.map((l, i) => {
    if (i === 0 || l.points !== tri[i - 1].points || l.colles !== tri[i - 1].colles) rang = i + 1;
    return { ...l, rang };
  });
}

function totaux(gains: Gain[], cle: (x: Gain) => string | null) {
  const t = new Map<string, { points: number; colles: number }>();
  for (const x of gains) {
    const k = cle(x);
    if (!k) continue;
    const v = t.get(k) ?? { points: 0, colles: 0 };
    v.points += x.points;
    if (x.type === 'colle') v.colles++;
    t.set(k, v);
  }
  return t;
}

const ROLES_ACTIFS = ['membre', 'gestionnaire', 'animateur'] as const;

/** Groupes d'action d'un département, sur les points de leurs membres
 *  (abonné·es exclu·es). Un militant de deux groupes compte pour les deux.
 *  Les boucles départementales (type D), qui réunissent tout le département,
 *  n'y figurent pas : elles écraseraient le classement. */
export async function classementGroupes(gains: Gain[], dep: string, mesGroupes: string[]) {
  const groupes = await prisma.actionGroup.findMany({
    // `NOT { type: 'D' }` seul écarterait aussi les groupes sans type (NULL).
    where: { department: dep, OR: [{ type: null }, { type: { not: 'D' } }] },
    select: {
      id: true,
      name: true,
      city: true,
      memberships: { where: { role: { in: [...ROLES_ACTIFS] } }, select: { militantId: true } },
    },
  });
  const parMilitant = totaux(gains, (x) => x.militantId);
  return classer(
    groupes.map((gr) => {
      const v = { points: 0, colles: 0 };
      for (const m of gr.memberships) {
        const t = parMilitant.get(m.militantId);
        if (t) {
          v.points += t.points;
          v.colles += t.colles;
        }
      }
      const n = gr.memberships.length;
      return {
        id: gr.id,
        nom: gr.name,
        sous: `${n} militant${n > 1 ? 's' : ''}`,
        ...v,
        moi: mesGroupes.includes(gr.id),
      };
    }),
  ).filter((l) => l.points > 0 || l.moi);
}

/** Départements, sur les points marqués sur leurs panneaux. Aucun nom de
 *  militant : c'est le seul classement national. */
export function classementDepartements(gains: Gain[], noms: Record<string, string>, monDep: string | null) {
  const t = totaux(gains, (x) => x.department);
  return classer(
    [...t].map(([code, v]) => ({ id: code, nom: noms[code] ?? code, sous: code, ...v, moi: code === monDep })),
  );
}

type MilitantNommable = { id: string; firstName: string | null; lastName: string | null; displayName: string };

/** Militants d'un groupe (tous rôles), sur tous leurs points. Prénom et
 *  initiale seulement. */
export async function classementDansGroupe(gains: Gain[], groupId: string, moiId: string) {
  const membres = await prisma.membership.findMany({
    where: { groupId },
    select: { militant: { select: { id: true, firstName: true, lastName: true, displayName: true, active: true } } },
  });
  const t = totaux(gains, (x) => x.militantId);
  return classer(
    membres
      .filter(({ militant: m }) => m.active)
      .map(({ militant: m }) => ({
        id: m.id,
        nom: nomCourt(m),
        ...(t.get(m.id) ?? { points: 0, colles: 0 }),
        moi: m.id === moiId,
      })),
  );
}

/** Militants ayant marqué des points sur les panneaux d'un département.
 *  Prénom et initiale seulement. */
export async function classementDansDepartement(gains: Gain[], dep: string, moiId: string) {
  const t = totaux(gains, (x) => (x.department === dep ? x.militantId : null));
  if (!t.has(moiId)) t.set(moiId, { points: 0, colles: 0 });
  const militants: MilitantNommable[] = await prisma.militant.findMany({
    where: { id: { in: [...t.keys()] }, active: true },
    select: { id: true, firstName: true, lastName: true, displayName: true },
  });
  return classer(
    militants.map((m) => ({ id: m.id, nom: nomCourt(m), ...t.get(m.id)!, moi: m.id === moiId })),
  ).filter((l) => l.points > 0 || l.moi);
}

/** Rang d'une ligne marquée `moi`, ou null. */
export const maPlace = (l: LigneClassement[]) => l.find((x) => x.moi) ?? null;
