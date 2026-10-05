import { prisma } from '@/lib/db';

export type StatsDep = Record<string, { tournees: number; panneaux: number }>;
/** Un groupe de tournées, tel que la page d'accueil l'affiche. */
export type LieuIndex = { dep: string; kind: 'ville' | 'circo'; nom: string; n: number };

/** Ce qu'il faut pour la carte de France et la recherche, sans charger une
 *  seule tournée : un compte par département et la liste des groupes
 *  (communes, quartiers, circonscriptions). Trois agrégats indexés, quelques
 *  Ko même à l'échelle du pays. */
export async function indexFrance(): Promise<{ stats: StatsDep; lieux: LieuIndex[] }> {
  const [groupes, panneaux] = await Promise.all([
    prisma.itinerary.groupBy({
      by: ['department', 'kind', 'city'],
      where: { department: { not: null }, stops: { some: {} } },
      _count: { _all: true },
    }),
    prisma.panel.groupBy({
      by: ['department'],
      where: { department: { not: null }, stops: { some: {} } },
      _count: { _all: true },
    }),
  ]);
  const stats: StatsDep = {};
  const lieux: LieuIndex[] = [];
  for (const g of groupes) {
    const dep = g.department!;
    stats[dep] ??= { tournees: 0, panneaux: 0 };
    stats[dep].tournees += g._count._all;
    lieux.push({ dep, kind: g.kind, nom: g.city?.trim() || 'Autres', n: g._count._all });
  }
  for (const p of panneaux) if (stats[p.department!]) stats[p.department!].panneaux = p._count._all;
  return { stats, lieux };
}
