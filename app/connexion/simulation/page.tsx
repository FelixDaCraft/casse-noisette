import { notFound } from 'next/navigation';
import { simulationActive } from '@/lib/actionPopulaire';
import { COMPTES_SIMULES } from '@/lib/apSimulation';
import { initiales, ROLE_LIBELLE } from '@/lib/militant';
import { nomDepartement } from '@/lib/departements';

export const dynamic = 'force-dynamic';

/**
 * Écran de consentement simulé, à la place de celui d'Action Populaire tant
 * que le vrai client OAuth n'existe pas. Volontairement neutre : ni le logo ni
 * les couleurs d'AP, pour qu'on ne le confonde jamais avec le vrai.
 */
export default async function SimulationAP({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (!simulationActive()) notFound();
  const { state = '' } = await searchParams;

  return (
    <div className="page sim">
      <header className="sim-tete">
        <span className="sim-fournisseur">Action Populaire (simulation)</span>
        <h1>Autoriser Casse-Noisette&nbsp;?</h1>
        <p>
          Casse-Noisette demande à voir ton profil et tes groupes d’action. Choisis le compte
          fictif avec lequel te connecter.
        </p>
        <ul className="sim-scopes">
          <li>
            <code>toktok</code> · nom affiché et appartenance à un groupe d’action
          </li>
          <li>
            <code>view_membership</code> · tes groupes d’action et ton rôle
          </li>
        </ul>
      </header>

      <main className="corps">
        <div className="liste">
          {COMPTES_SIMULES.map((c) => (
            <form action="/connexion/simulation/autoriser" method="get" key={c.apId}>
              <input type="hidden" name="state" value={state} />
              <input type="hidden" name="compte" value={c.apId} />
              <button className="sim-compte">
                <span className="avatar" aria-hidden="true">
                  {initiales(`${c.prenom} ${c.nom}`)}
                </span>
                <span className="sim-compte-txt">
                  <span className="sim-compte-nom">
                    {c.prenom} {c.nom}
                  </span>
                  <span className="sim-compte-meta">
                    {c.commune} · {nomDepartement(c.departement)}
                  </span>
                  <span className="sim-compte-meta">
                    {c.groupes.length
                      ? c.groupes.map((g) => `${g.nom} (${ROLE_LIBELLE[g.role].toLowerCase()})`).join(' · ')
                      : 'Aucun groupe d’action : connexion refusée'}
                  </span>
                </span>
              </button>
            </form>
          ))}
        </div>

        <form action="/connexion/simulation/autoriser" method="get" style={{ marginTop: 18, textAlign: 'center' }}>
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="refus" value="1" />
          <button className="btn">Refuser</button>
        </form>
      </main>
    </div>
  );
}
