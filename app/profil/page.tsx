import Link from 'next/link';
import { requireMilitant } from '@/lib/auth';
import { nomDepartement } from '@/lib/departements';
import { ROLE_LIBELLE } from '@/lib/militant';
import Marque, { DuoVioletDef } from '../Marque';
import Avatar from '../Avatar';
import { deconnexion } from './actions';

export const dynamic = 'force-dynamic';

const IconRetour = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const date = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// Animateurs et gestionnaires d'abord : ce sont les groupes qu'on fait vivre.
const POIDS = { animateur: 0, gestionnaire: 1, membre: 2, abonne: 3 } as const;

export default async function ProfilPage() {
  const m = await requireMilitant('/profil');
  const groupes = [...m.memberships].sort(
    (a, b) => POIDS[a.role] - POIDS[b.role] || a.group.name.localeCompare(b.group.name, 'fr'),
  );
  const nomComplet = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.displayName;
  const lieu = [m.postalCode, m.city].filter(Boolean).join(' ');

  const infos: [string, string | null][] = [
    ['Email', m.email],
    ['Département', nomDepartement(m.department)],
    ['Commune', lieu || null],
    ['Inscrit·e depuis le', date(m.createdAt)],
  ];

  return (
    <div className="page">
      <DuoVioletDef />
      <header className="hd hd-profil">
        <div className="hd-marque">
          <Link href="/" className="hd-retour" aria-label="Retour aux tournées">
            {IconRetour}
          </Link>
          <Marque size={40} />
          <span className="hd-nom">Casse-Noisette</span>
        </div>
        <h1>
          Mon <em>profil</em>
        </h1>
      </header>

      <div className="profil-carte">
        <Avatar nom={nomComplet} image={m.image} className="avatar avatar-lg" />
        <div className="profil-id">
          <span className="profil-nom">{nomComplet}</span>
          <span className="profil-sous">
            {m.displayName !== nomComplet ? `${m.displayName} sur Action Populaire` : 'Compte Action Populaire'}
          </span>
        </div>
      </div>

      <main className="corps">
        <section className="groupe">
          <h2>Mes infos</h2>
          <dl className="profil-infos">
            {infos.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={v ? undefined : 'absent'}>{v ?? 'Non communiqué'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="groupe">
          <h2>
            Mes groupes d’action
            <span>{groupes.length}</span>
          </h2>
          {groupes.length === 0 ? (
            <p className="vide">Aucun groupe d’action.</p>
          ) : (
            <div className="liste">
              {groupes.map(({ group: g, role }) => (
                <div className="profil-ga" key={g.id}>
                  <span className="profil-ga-txt">
                    <span className="profil-ga-nom">{g.name}</span>
                    <span className="profil-ga-meta">
                      {[g.city, nomDepartement(g.department)].filter(Boolean).join(' · ') || 'Sans lieu'}
                    </span>
                  </span>
                  <span className={'badge' + (role === 'membre' || role === 'abonne' ? ' neutre' : '')}>
                    {ROLE_LIBELLE[role]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Réservé : signalements de panneaux et progression viendront ici. */}
        <section className="groupe" id="activite">
          <h2>Mon activité</h2>
          <div className="profil-activite">
            <p className="prose">
              Tes collages et tes signalements de panneaux apparaîtront ici.
            </p>
          </div>
        </section>

        <form action={deconnexion} style={{ marginTop: 30 }}>
          <button className="btn btn-deco">Se déconnecter</button>
        </form>

        <p className="pied prose">
          Ton profil est repris d’Action Populaire à chaque connexion : c’est là-bas qu’il se
          modifie.
        </p>
      </main>
    </div>
  );
}
