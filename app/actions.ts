'use server';
import { prisma } from '@/lib/db';
import { getCurrentMilitant } from '@/lib/auth';
import {
  COMMENTAIRE_MAX,
  DELAI_RESIGNALEMENT_MIN,
  estEtat,
  type EtatCourant,
} from '@/lib/etatsPanneau';
import { nomCourt } from '@/lib/signalements';
import { recompenseDe, type Recompense } from '@/lib/classement';

/** Au-delà, on soupçonne un script ou un doigt qui s'emballe : même en tournée
 *  à vélo, personne ne constate 30 panneaux en 5 minutes. */
const MAX_PAR_FENETRE = 30;
const FENETRE_MS = 5 * 60 * 1000;

export type ResultatSignalement =
  | { ok: true; etat: EtatCourant; recompense: Recompense | null }
  | { ok: false; erreur: string };

/**
 * Signale l'état d'un panneau. Tout est revérifié ici, rien n'est cru du
 * client : session militant, état parmi ceux prévus, panneau existant,
 * commentaire raisonnable, et délai entre deux signalements du même panneau.
 * Renvoie le nouvel état courant pour que l'écran se mette à jour sans
 * recharger, et ce que le signalement rapporte (points, tournée, badges).
 */
export async function signalerPanneau(
  panelId: unknown,
  etat: unknown,
  commentaire?: unknown,
): Promise<ResultatSignalement> {
  const militant = await getCurrentMilitant();
  if (!militant) return { ok: false, erreur: 'Ta session a expiré : reconnecte-toi.' };

  if (typeof panelId !== 'string' || panelId.length > 64) return { ok: false, erreur: 'Panneau inconnu.' };
  if (!estEtat(etat)) return { ok: false, erreur: 'État inconnu.' };
  if (commentaire != null && typeof commentaire !== 'string') return { ok: false, erreur: 'Commentaire invalide.' };
  const comment = commentaire?.trim().replace(/\s+/g, ' ') || null;
  if (comment && comment.length > COMMENTAIRE_MAX) {
    return { ok: false, erreur: `Commentaire trop long (${COMMENTAIRE_MAX} caractères maximum).` };
  }

  const panel = await prisma.panel.findUnique({ where: { id: panelId }, select: { id: true } });
  if (!panel) return { ok: false, erreur: 'Ce panneau n’existe plus.' };

  const maintenant = Date.now();
  const [precedent, recents] = await Promise.all([
    prisma.report.findFirst({
      where: { panelId, militantId: militant.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true },
    }),
    prisma.report.count({
      where: { militantId: militant.id, createdAt: { gte: new Date(maintenant - FENETRE_MS) } },
    }),
  ]);
  if (recents >= MAX_PAR_FENETRE) {
    return { ok: false, erreur: 'Beaucoup de signalements d’un coup : patiente quelques minutes.' };
  }
  if (precedent) {
    const attente = precedent.createdAt.getTime() + DELAI_RESIGNALEMENT_MIN * 60_000 - maintenant;
    // « Collé » après « vide » ou « recouvert » : on vient de le coller, c'est
    // le constat qui compte le plus — il passe toujours, une fois.
    const suiteNaturelle = etat === 'colle' && precedent.status !== 'colle';
    if (attente > 0 && !suiteNaturelle) {
      const min = Math.ceil(attente / 60_000);
      return {
        ok: false,
        erreur: `Tu as déjà signalé ce panneau. Réessaie dans ${min} minute${min > 1 ? 's' : ''}.`,
      };
    }
  }

  const r = await prisma.report.create({
    data: { panelId, militantId: militant.id, status: etat, comment },
  });

  // Points recalculés depuis l'historique, comme partout ailleurs : ce qui
  // s'affiche ici est exactement ce que comptera le classement. Un échec du
  // calcul ne doit pas faire croire que le signalement est perdu.
  const recompense = await recompenseDe(militant.id, r.id).catch(() => null);

  // Pas de revalidatePath : il ferait recalculer toute la page d'accueil dans
  // la réponse. La liste se met à jour avec la valeur renvoyée ; le profil et
  // le backoffice, dynamiques, sont de toute façon rendus à chaque visite.
  return {
    ok: true,
    etat: { etat, date: r.createdAt.toISOString(), par: nomCourt(militant), commentaire: comment },
    recompense,
  };
}
