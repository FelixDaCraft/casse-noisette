import { prisma } from '@/lib/db';

/* Département d'un panneau ajouté depuis le backoffice, et de ses tournées.

   Les imports passent par prisma/renseigner-departements.mjs (contours des
   circonscriptions). Ici, un point à la fois : l'API officielle du découpage
   administratif répond en quelques dizaines de millisecondes et sans clé. Si
   elle ne répond pas, le panneau prend le département de son plus proche
   voisin connu — à 20 km près, on ne change presque jamais de département, et
   un panneau laissé sans département disparaîtrait de la page publique. */

const RAYON_VOISIN = 0.2; // ≈ 20 km en latitude

export async function departementDe(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=codeDepartement&format=json`,
      { signal: AbortSignal.timeout(4000), cache: 'no-store' },
    );
    if (r.ok) {
      const j = (await r.json()) as { codeDepartement?: string }[];
      if (j[0]?.codeDepartement) return j[0].codeDepartement;
    }
  } catch {
    /* hors ligne, lent : on retombe sur le voisinage */
  }
  const voisins = await prisma.panel.findMany({
    where: {
      department: { not: null },
      lat: { gte: lat - RAYON_VOISIN, lte: lat + RAYON_VOISIN },
      lng: { gte: lng - RAYON_VOISIN * 1.5, lte: lng + RAYON_VOISIN * 1.5 },
    },
    select: { lat: true, lng: true, department: true },
  });
  const d2 = (p: { lat: number; lng: number }) =>
    (p.lat - lat) ** 2 + ((p.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
  return voisins.sort((a, b) => d2(a) - d2(b))[0]?.department ?? null;
}

/** Recale le département des tournées sur la majorité de leurs panneaux,
 *  après un ajout, un retrait ou un déplacement. */
export async function recalerTournees(ids: (string | null | undefined)[]) {
  for (const id of new Set(ids.filter((x): x is string => !!x))) {
    const stops = await prisma.stop.findMany({
      where: { itineraryId: id },
      select: { panel: { select: { department: true } } },
    });
    const votes = new Map<string, number>();
    for (const s of stops) {
      const d = s.panel.department;
      if (d) votes.set(d, (votes.get(d) ?? 0) + 1);
    }
    const dep = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    // Une tournée vidée garde son département : on la retrouve au même endroit.
    if (dep) await prisma.itinerary.update({ where: { id }, data: { department: dep } });
  }
}
