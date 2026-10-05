import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { Etat, EtatCourant } from '@/lib/etatsPanneau';

type Nommable = { firstName: string | null; lastName: string | null; displayName: string };

/** « Camille L. » : assez pour se reconnaître entre militants du coin, sans
 *  afficher le nom complet de chacun à tout le département. */
export function nomCourt(m: Nommable): string {
  if (m.firstName) return m.lastName ? `${m.firstName} ${m.lastName[0].toUpperCase()}.` : m.firstName;
  const [prenom, nom] = m.displayName.split(/\s+/).filter(Boolean);
  if (!prenom) return m.displayName;
  return nom ? `${prenom} ${nom[0].toUpperCase()}.` : prenom;
}

type Ligne = {
  panelId: string;
  status: Etat;
  comment: string | null;
  createdAt: Date;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
};

/** État courant (dernier signalement) de chaque panneau demandé. Un panneau
 *  jamais signalé est absent du résultat.
 *  `DISTINCT ON` plutôt que `distinct` de Prisma, qui charge tout l'historique
 *  puis filtre en mémoire : ici, l'index (panelId, createdAt) suffit. */
export async function etatsCourants(panelIds: string[]): Promise<Record<string, EtatCourant>> {
  if (panelIds.length === 0) return {};
  const lignes = await prisma.$queryRaw<Ligne[]>`
    SELECT DISTINCT ON (r."panelId")
      r."panelId", r."status"::text AS "status", r."comment", r."createdAt",
      m."firstName", m."lastName", m."displayName"
    FROM "Report" r
    LEFT JOIN "Militant" m ON m."id" = r."militantId"
    WHERE r."panelId" IN (${Prisma.join(panelIds)})
    ORDER BY r."panelId", r."createdAt" DESC`;
  const etats: Record<string, EtatCourant> = {};
  for (const l of lignes) {
    etats[l.panelId] = {
      etat: l.status,
      date: l.createdAt.toISOString(),
      par: l.displayName ? nomCourt({ ...l, displayName: l.displayName }) : null,
      commentaire: l.comment,
    };
  }
  return etats;
}

export type PanneauAbsent = {
  id: string;
  name: string;
  city: string | null;
  department: string | null;
  lat: number;
  lng: number;
  signalements: number;
  militants: number;
  dernier: Date;
};

/** Panneaux dont l'état courant est « absent », avec le nombre de
 *  signalements « absent » reçus depuis le dernier constat contraire : un
 *  « collé » plus récent annule les anciens (le panneau était bien là). */
export async function panneauxAbsents(): Promise<PanneauAbsent[]> {
  const lignes = await prisma.$queryRaw<
    (Omit<PanneauAbsent, 'signalements' | 'militants'> & { signalements: bigint; militants: bigint })[]
  >`
    WITH dernier_autre AS (
      SELECT "panelId", MAX("createdAt") AS t FROM "Report"
      WHERE "status" <> 'absent' GROUP BY "panelId"
    )
    SELECT p."id", p."name", p."city", p."department", p."lat", p."lng",
      COUNT(*) AS "signalements",
      COUNT(DISTINCT r."militantId") AS "militants",
      MAX(r."createdAt") AS "dernier"
    FROM "Report" r
    JOIN "Panel" p ON p."id" = r."panelId"
    LEFT JOIN dernier_autre d ON d."panelId" = r."panelId"
    WHERE r."status" = 'absent' AND (d.t IS NULL OR r."createdAt" > d.t)
    GROUP BY p."id"
    ORDER BY COUNT(*) DESC, MAX(r."createdAt") DESC`;
  return lignes.map((l) => ({ ...l, signalements: Number(l.signalements), militants: Number(l.militants) }));
}
