import { redirect } from 'next/navigation';
import { getCurrentMilitant } from '@/lib/auth';
import { simulationActive } from '@/lib/actionPopulaire';
import AuthShell from '../admin/AuthShell';
import OublierHorsLigne from './OublierHorsLigne';
import { suiteSure } from './commun';

export const dynamic = 'force-dynamic';

const ERREURS: Record<string, string> = {
  pas_membre:
    'Ton compte Action Populaire n’est membre d’aucun groupe d’action. Rejoins-en un sur Action Populaire, puis reviens.',
  annule: 'Connexion annulée.',
  etat: 'La connexion a expiré ou a été ouverte dans un autre onglet. Recommence.',
  echange: 'Action Populaire n’a pas validé la connexion. Recommence.',
  profil: 'Impossible de lire ton profil Action Populaire pour le moment. Réessaie dans un instant.',
  non_configure: 'La connexion Action Populaire n’est pas encore configurée sur ce serveur.',
};

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; erreur?: string; sortie?: string }>;
}) {
  const { suite, erreur, sortie } = await searchParams;
  if (await getCurrentMilitant()) redirect(suiteSure(suite));
  const simulation = simulationActive();
  const depart = '/connexion/ap' + (suite ? `?suite=${encodeURIComponent(suiteSure(suite))}` : '');

  return (
    <AuthShell
      titre={
        <>
          On colle <em>ensemble</em>
        </>
      }
      texte="Les tournées de collage des panneaux d’affichage libre, réservées aux militantes et militants insoumis."
      pied="La France insoumise · Action Populaire"
    >
      <OublierHorsLigne />
      <h2>Connexion</h2>
      <p className="sous">
        Casse-Noisette est réservé aux membres d’un groupe d’action. Connecte-toi avec ton compte
        Action Populaire : rien d’autre à créer.
      </p>
      {sortie === '1' && !erreur && (
        <p className="succes" style={{ marginBottom: 16 }}>
          Tu es déconnecté·e.
        </p>
      )}
      {erreur && (
        <p className="erreur" style={{ marginBottom: 16 }} role="alert">
          {ERREURS[erreur] ?? ERREURS.profil}
        </p>
      )}
      {/* Lien et non formulaire : c'est une navigation vers AP, pas un envoi. */}
      <a href={depart} className="btn-auth btn-ap">
        Se connecter avec Action Populaire
      </a>
      {simulation && (
        <p className="note-simulation">
          <span className="badge alerte">Simulation</span> Aucun vrai compte n’est utilisé : tu
          choisiras un compte fictif à l’étape suivante.
        </p>
      )}
    </AuthShell>
  );
}
