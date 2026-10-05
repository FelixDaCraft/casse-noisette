import Link from 'next/link';
import { requireMilitant } from '@/lib/auth';
import { nomDepartement } from '@/lib/departements';
import { ROLE_LIBELLE } from '@/lib/militant';
import { prisma } from '@/lib/db';
import { ETAT, ilYA } from '@/lib/etatsPanneau';
import { rueSeule } from '@/lib/maps';
import Marque, { DuoVioletDef } from '../Marque';
import Avatar from '../Avatar';
import { PastilleEtat } from '../Signalement';
import { CartePoints, GrilleBadges } from '../Badges';
import { badges, bilan, BADGES, BAREME, FENETRE_TOURNEE_H, MEME_PANNEAU_H, PLAFOND_JOUR, CAMPAGNE, VERIFICATION_J } from '@/lib/points';
import {
  classementDansDepartement,
  classementDansGroupe,
  gainsMilitant,
  gainsPeriode,
  maPlace,
} from '@/lib/classement';
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

  const [derniers, total, colles, panneaux] = await Promise.all([
    prisma.report.findMany({
      where: { militantId: m.id },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { panel: { select: { name: true, city: true } } },
    }),
    prisma.report.count({ where: { militantId: m.id } }),
    prisma.report.count({ where: { militantId: m.id, status: 'colle' } }),
    prisma.report.groupBy({ by: ['panelId'], where: { militantId: m.id } }).then((g) => g.length),
  ]);
  const maintenant = Date.now();

  // Points de la campagne, recalculés depuis les signalements (lib/points.ts).
  const monGroupe = groupes.find((x) => x.role !== 'abonne')?.group ?? groupes[0]?.group;
  const [mesGains, gainsCampagne] = await Promise.all([gainsMilitant(m.id), gainsPeriode('campagne')]);
  const b = bilan(mesGains);
  const obtenus = badges(b).filter((x) => x.obtenu).length;
  const [placeGroupe, placeDep] = await Promise.all([
    monGroupe ? classementDansGroupe(gainsCampagne, monGroupe.id, m.id).then(maPlace) : null,
    m.department ? classementDansDepartement(gainsCampagne, m.department, m.id).then(maPlace) : null,
  ]);
  const places = [
    placeGroupe && monGroupe && { rang: placeGroupe.rang, ou: monGroupe.name, vue: 'groupe' },
    placeDep && m.department && { rang: placeDep.rang, ou: nomDepartement(m.department), vue: 'departement' },
  ].filter((x): x is { rang: number; ou: string; vue: string } => !!x && x.rang > 0 && b.points > 0);

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
        <section className="groupe" id="points">
          <h2>
            Mes points
            <span>{CAMPAGNE.nom}</span>
          </h2>
          <CartePoints b={b} />
          <div className="stats activite-chiffres">
            <div className="stat">
              <div className="stat-val">{b.colles}</div>
              <div className="stat-lib">collage{b.colles > 1 ? 's' : ''}</div>
            </div>
            <div className="stat">
              <div className="stat-val">{b.constats}</div>
              <div className="stat-lib">constat{b.constats > 1 ? 's' : ''}</div>
            </div>
            <div className="stat">
              <div className="stat-val">{b.tournees}</div>
              <div className="stat-lib">tournée{b.tournees > 1 ? 's' : ''} complète{b.tournees > 1 ? 's' : ''}</div>
            </div>
          </div>
          {places.length > 0 && (
            <div className="places">
              {places.map((pl) => (
                <Link key={pl.vue} href={`/classement?vue=${pl.vue}&periode=campagne`} className="place">
                  <span className="place-rang">
                    {pl.rang}
                    <sup>{pl.rang === 1 ? 're' : 'e'}</sup>
                  </span>
                  <span className="place-ou">{pl.ou}</span>
                </Link>
              ))}
            </div>
          )}
          <Link href="/classement" className="btn btn-violet btn-classement">
            Voir le classement
          </Link>
        </section>

        <section className="groupe" id="badges">
          <h2>
            Mes badges
            <span>
              {obtenus} sur {BADGES.length}
            </span>
          </h2>
          <GrilleBadges b={b} />
          <details className="bareme">
            <summary>Comment gagner des points</summary>
            <ul className="prose">
              <li>
                <b>+{BAREME.colle}</b> par panneau collé.
              </li>
              <li>
                <b>+{BAREME.constat}</b> par constat (recouvert, arraché, tagué, vide, absent), ou
                pour une affiche trouvée encore en place moins de {VERIFICATION_J} jours après son
                collage.
              </li>
              <li>
                <b>
                  +{BAREME.tournee.base} et +{BAREME.tournee.parPanneau} par panneau
                </b>{' '}
                pour une tournée entièrement marquée « collé » en moins de {FENETRE_TOURNEE_H} h,
                dont au moins la moitié vraiment collée.
              </li>
              <li>
                Un même panneau ne rapporte qu’une fois toutes les {MEME_PANNEAU_H} h, rien pour des
                signalements en rafale, et {PLAFOND_JOUR} points au plus par jour : on gagne en collant,
                pas en tapotant.
              </li>
            </ul>
          </details>
        </section>

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

        <section className="groupe" id="activite">
          <h2>
            Mon activité
            {total > 0 && <span>{total} signalement{total > 1 ? 's' : ''}</span>}
          </h2>
          {total === 0 ? (
            <div className="profil-activite">
              <p className="prose">
                Tes collages et tes signalements de panneaux apparaîtront ici. Ouvre une tournée et
                touche « J’ai collé » ou « Signaler » sur un panneau.
              </p>
            </div>
          ) : (
            <>
              <div className="stats activite-chiffres">
                <div className="stat">
                  <div className="stat-val">{colles}</div>
                  <div className="stat-lib">collé{colles > 1 ? 's' : ''}</div>
                </div>
                <div className="stat">
                  <div className="stat-val">{total - colles}</div>
                  <div className="stat-lib">{total - colles > 1 ? 'autres constats' : 'autre constat'}</div>
                </div>
                <div className="stat">
                  <div className="stat-val">{panneaux}</div>
                  <div className="stat-lib">panneau{panneaux > 1 ? 'x' : ''}</div>
                </div>
              </div>
              <div className="liste">
                {derniers.map((r) => (
                  <div className="activite-ligne" key={r.id}>
                    <PastilleEtat etat={r.status} />
                    <span className="activite-txt">
                      <span className="activite-titre">{rueSeule(r.panel.name) || 'Panneau'}</span>
                      <span className="activite-meta">
                        <b>{ETAT[r.status].libelle}</b>
                        {r.panel.city && ` · ${r.panel.city}`} · {ilYA(r.createdAt, maintenant)}
                      </span>
                      {r.comment && <span className="activite-com prose">« {r.comment} »</span>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
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
