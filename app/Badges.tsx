import type { ReactNode } from 'react';
import { niveau, type Bilan, type IconeBadge, badges } from '@/lib/points';

const trait = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** Une icône par famille de badge, au trait comme le reste de l'interface. */
const ICONES: Record<IconeBadge, ReactNode> = {
  // Itinéraire pointillé entre deux repères
  tournee: (
    <svg {...trait}>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" strokeDasharray="2 3" />
    </svg>
  ),
  // Affiche posée sur un panneau
  affiche: (
    <svg {...trait}>
      <rect x="5" y="3" width="14" height="14" rx="1.5" />
      <path d="M9 8h6M9 12h4M12 17v4M8 21h8" />
    </svg>
  ),
  // Trois silhouettes
  brigade: (
    <svg {...trait}>
      <circle cx="12" cy="7" r="3" />
      <circle cx="5" cy="9" r="2" />
      <circle cx="19" cy="9" r="2" />
      <path d="M7 20v-2a5 5 0 0 1 10 0v2M2 19v-1a3 3 0 0 1 4-2.8M22 19v-1a3 3 0 0 0-4-2.8" />
    </svg>
  ),
  oeil: (
    <svg {...trait}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  lune: (
    <svg {...trait}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  ),
  bouclier: (
    <svg {...trait}>
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" />
      <polyline points="8.5 12 11 14.5 15.5 10" />
    </svg>
  ),
};

/** Badges obtenus d'abord, puis ceux à obtenir avec leur progression. */
export function GrilleBadges({ b }: { b: Bilan }) {
  const liste = badges(b).sort((x, y) => Number(y.obtenu) - Number(x.obtenu));
  return (
    <ul className="badges">
      {liste.map(({ badge, val, obtenu }) => (
        <li key={badge.id} className={'badge-carte' + (obtenu ? ' obtenu' : '')}>
          <span className="badge-medaille">{ICONES[badge.icone]}</span>
          <span className="badge-nom">{badge.nom}</span>
          <span className="badge-desc">{badge.description}</span>
          {obtenu ? (
            <span className="badge-etat">Obtenu</span>
          ) : (
            <span className="badge-prog" aria-label={`${val} sur ${badge.objectif}`}>
              <span className="jauge">
                <span style={{ width: `${(val / badge.objectif) * 100}%` }} />
              </span>
              {val}/{badge.objectif}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Total, niveau et barre jusqu'au niveau suivant. */
export function CartePoints({ b }: { b: Bilan }) {
  const n = niveau(b.points);
  return (
    <div className="points-carte">
      <div className="points-tete">
        <div className="points-total">
          <span className="points-val">{b.points}</span>
          <span className="points-lib">point{b.points > 1 ? 's' : ''}</span>
        </div>
        <div className="points-niveau">
          <span className="kicker">Niveau {n.actuel.rang}</span>
          <span className="points-niveau-nom">{n.actuel.nom}</span>
        </div>
      </div>
      <div
        className="jauge jauge-lg"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(n.progression * 100)}
        aria-label="Progression vers le niveau suivant"
      >
        <span style={{ width: `${Math.max(2, n.progression * 100)}%` }} />
      </div>
      <p className="points-suite">
        {n.suivant ? (
          <>
            Encore <b>{n.reste} pts</b> pour « {n.suivant.nom} »
          </>
        ) : (
          'Niveau maximum : respect.'
        )}
      </p>
    </div>
  );
}
