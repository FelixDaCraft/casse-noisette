// États d'un panneau, partagés entre le serveur (validation des signalements)
// et l'interface (pastilles, feuille de signalement). Sans Prisma ni Node :
// ce fichier part aussi dans le bundle client.

export type Etat = 'colle' | 'recouvert' | 'arrache' | 'tague' | 'vide' | 'absent';

/** Ordre d'affichage dans la feuille : le geste le plus courant d'abord. */
export const ETATS: Etat[] = ['colle', 'recouvert', 'arrache', 'tague', 'vide', 'absent'];

export const ETAT: Record<Etat, { libelle: string; detail: string }> = {
  colle: { libelle: 'Collé par nous', detail: 'Notre affiche est en place' },
  recouvert: { libelle: 'Recouvert', detail: 'Une autre affiche par-dessus' },
  arrache: { libelle: 'Arraché', detail: 'Affiche arrachée ou dégradée' },
  tague: { libelle: 'Tagué', detail: 'Inscription haineuse' },
  vide: { libelle: 'Vide', detail: 'Libre, rien dessus' },
  absent: { libelle: 'Panneau absent', detail: 'Il n’existe plus' },
};

/** Les états qui appellent un nouveau passage avec de la colle. Un panneau
 *  absent n'en fait pas partie : il n'y a plus rien à coller, c'est au
 *  backoffice de le retirer. */
export const A_REPASSER: ReadonlySet<Etat> = new Set(['recouvert', 'arrache', 'tague', 'vide']);

export const estEtat = (v: unknown): v is Etat => typeof v === 'string' && (ETATS as string[]).includes(v);

/** Longueur maximale d'un commentaire : une phrase, pas un rapport. */
export const COMMENTAIRE_MAX = 280;

/** Délai avant qu'un militant puisse re-signaler le même panneau. Seule
 *  exception : « collé » juste après un autre état, c'est la suite naturelle
 *  d'un panneau trouvé vide ou recouvert. */
export const DELAI_RESIGNALEMENT_MIN = 10;

/** À partir de combien de signalements « absent » un panneau remonte au
 *  backoffice comme à retirer en priorité. Un seul peut être une erreur. */
export const SEUIL_ABSENT = 2;

/** État courant d'un panneau, tel que l'interface l'affiche. */
export type EtatCourant = { etat: Etat; date: string; par: string | null; commentaire: string | null };

/** « il y a 2 j », « il y a 5 min », « à l'instant ». */
export function ilYA(date: string | Date, maintenant: number): string {
  const s = Math.max(0, (maintenant - new Date(date).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 60) return `il y a ${Math.floor(s / 86400)} j`;
  return `il y a ${Math.floor(s / (86400 * 30))} mois`;
}

/** Fraîcheur courte pour la liste des tournées : « 2 j », « 3 h », « 5 min ». */
export function fraicheur(date: string | Date, maintenant: number): string {
  const s = Math.max(0, (maintenant - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min`;
  return ilYA(date, maintenant).replace('il y a ', '');
}
