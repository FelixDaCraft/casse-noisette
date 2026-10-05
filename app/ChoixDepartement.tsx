'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { DEPARTEMENTS } from '@/lib/departements';
import type { LieuIndex, StatsDep } from '@/lib/indexFrance';
import Marque, { DuoVioletDef } from './Marque';
import HdMoi from './HdMoi';
import CarteFrance, { pluriel } from './CarteFrance';

/* Choix du département : carte de France et recherche.

   C'est l'entrée de l'appli à l'échelle du pays. On y arrive en touchant
   « Changer » depuis la liste, ou d'office quand le département du militant
   n'a encore aucune tournée — une liste vide ne dirait pas quoi faire. */

const IconRetour = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconLoupe = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="20" y1="20" x2="16.2" y2="16.2" />
  </svg>
);
const IconEfface = (
  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);
const IconChev = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="var(--violet)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/** « Saint-Étienne » et « st etienne » doivent se trouver : sans accents, sans
 *  tirets ni apostrophes, en minuscules. */
const norme = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’·]/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/\s+/g, ' ')
    .trim();

const nomDep = (code: string) => DEPARTEMENTS[code] ?? code;
const lienDep = (code: string) => `/?dep=${encodeURIComponent(code)}`;
const lienLieu = (l: LieuIndex) =>
  `/?dep=${encodeURIComponent(l.dep)}&vue=${l.kind}&lieu=${encodeURIComponent(l.nom)}`;

function Lieu({ nom }: { nom: string }) {
  const i = nom.indexOf(' · ');
  if (i < 0) return <>{nom}</>;
  return (
    <>
      <span className="lieu-mere">{nom.slice(0, i)}</span>
      <span className="lieu-quartier">{nom.slice(i + 3)}</span>
    </>
  );
}

export default function ChoixDepartement({
  stats,
  lieux,
  moi,
  monDep,
  actuel = null,
  sansTournee = null,
}: {
  stats: StatsDep;
  lieux: LieuIndex[];
  moi: { nom: string; image: string | null };
  /** Département du militant (Action Populaire), cerclé de rouge. */
  monDep: string | null;
  /** Département affiché avant d'ouvrir la carte : le retour y ramène. */
  actuel?: string | null;
  /** Département demandé qui n'a pas encore de tournée : on le dit. */
  sansTournee?: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [choisi, setChoisi] = useState<string | null>(sansTournee ?? actuel ?? monDep);
  const [survol, setSurvol] = useState<string | null>(null);

  const ouvrir = (code: string) => router.push(lienDep(code));
  const choisir = (code: string, direct: boolean) => {
    if (direct && stats[code]) ouvrir(code);
    else setChoisi(code);
  };

  // Retour possible seulement vers un département qui a des tournées.
  const retour = [actuel, monDep].find((c) => c && stats[c]) ?? null;
  const avecTournees = useMemo(
    () => Object.keys(stats).sort((a, b) => nomDep(a).localeCompare(nomDep(b), 'fr')),
    [stats],
  );

  const nq = norme(q);
  const resultats = useMemo(() => {
    if (!nq) return null;
    const deps = Object.keys(DEPARTEMENTS)
      .filter((c) => norme(DEPARTEMENTS[c]).includes(nq) || c.toLowerCase() === nq)
      .sort(
        (a, b) =>
          Number(!!stats[b]) - Number(!!stats[a]) ||
          Number(norme(DEPARTEMENTS[b]).startsWith(nq)) - Number(norme(DEPARTEMENTS[a]).startsWith(nq)) ||
          nomDep(a).localeCompare(nomDep(b), 'fr'),
      )
      .slice(0, 8);
    const trouves = lieux
      .filter((l) => norme(l.nom).includes(nq))
      .sort(
        (a, b) =>
          // Les communes d'abord : on cherche « Rezé » plus souvent qu'une circo.
          Number(a.kind === 'circo') - Number(b.kind === 'circo') ||
          Number(norme(b.nom).startsWith(nq)) - Number(norme(a.nom).startsWith(nq)) ||
          a.nom.localeCompare(b.nom, 'fr', { numeric: true }),
      )
      .slice(0, 30);
    return { deps, lieux: trouves };
  }, [nq, lieux, stats]);

  const info = survol ?? choisi;
  const infoStats = info ? stats[info] : undefined;

  return (
    <div className="page">
      <DuoVioletDef />
      <header className="hd">
        <div className="hd-marque">
          {retour && (
            <Link href={lienDep(retour)} className="hd-retour" aria-label={`Retour à ${nomDep(retour)}`}>
              {IconRetour}
            </Link>
          )}
          <Marque size={40} />
          <span className="hd-nom">Casse-Noisette</span>
          <HdMoi nom={moi.nom} image={moi.image} />
        </div>
        <h1>
          Choisis ton <em>département</em>
        </h1>
      </header>

      <div className="recherche-barre" role="search">
        {IconLoupe}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Commune, département…"
          aria-label="Chercher une commune ou un département"
          enterKeyHint="search"
          autoComplete="off"
        />
        {q && (
          <button type="button" className="recherche-efface" onClick={() => setQ('')} aria-label="Effacer">
            {IconEfface}
          </button>
        )}
      </div>

      <main className="corps">
        {resultats ? (
          <>
            {resultats.deps.length === 0 && resultats.lieux.length === 0 && (
              <p className="vide">Aucun département ni aucune commune ne correspond à « {q.trim()} ».</p>
            )}
            {resultats.lieux.length > 0 && (
              <section className="groupe">
                <h2>
                  Communes et circonscriptions
                  <span>{resultats.lieux.length}</span>
                </h2>
                <div className="liste">
                  {resultats.lieux.map((l) => (
                    <LigneLien
                      key={`${l.dep}|${l.kind}|${l.nom}`}
                      href={lienLieu(l)}
                      code={l.dep}
                      titre={<Lieu nom={l.nom} />}
                      meta={`${l.kind === 'circo' ? 'Circonscription' : 'Commune'} · ${nomDep(l.dep)} · ${pluriel(l.n, 'tournée')}`}
                    />
                  ))}
                </div>
              </section>
            )}
            {resultats.deps.length > 0 && (
              <section className="groupe">
                <h2>
                  Départements
                  <span>{resultats.deps.length}</span>
                </h2>
                <div className="liste">
                  {resultats.deps.map((c) => (
                    <LigneDep key={c} code={c} stats={stats} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            {sansTournee && (
              <section className="dep-vide" aria-live="polite">
                <span className="kicker">
                  {nomDep(sansTournee)} ({sansTournee})
                </span>
                <h2>Pas encore de tournée ici</h2>
                <p className="prose">
                  Les panneaux d’affichage libre de ce département n’ont pas encore été relevés.
                  Choisis un département en violet sur la carte pour coller ailleurs, ou signale
                  les panneaux de ton secteur à l’équipe qui prépare les tournées.
                </p>
              </section>
            )}

            <section className="carte-france" aria-label="Carte de France">
              <CarteFrance
                stats={stats}
                choisi={choisi}
                survol={survol}
                monDep={monDep}
                onChoisir={choisir}
                onSurvol={setSurvol}
              />
              <div className="dep-info" aria-live="polite">
                {info ? (
                  <>
                    <div className="dep-info-txt">
                      <span className="dep-info-nom">
                        {nomDep(info)} <span className="dep-info-code">{info}</span>
                      </span>
                      <span className="dep-info-meta">
                        {infoStats
                          ? `${pluriel(infoStats.tournees, 'tournée')} · ${pluriel(infoStats.panneaux, 'panneau', 'panneaux')}`
                          : 'Pas encore de tournée'}
                        {info === monDep && ' · ton département'}
                      </span>
                    </div>
                    {infoStats && (
                      <Link href={lienDep(info)} className="btn btn-violet btn-sm dep-info-go">
                        Voir
                      </Link>
                    )}
                  </>
                ) : (
                  <span className="dep-info-meta">Touche un département pour voir ses tournées.</span>
                )}
              </div>
              <div className="legende legende-carte" aria-hidden="true">
                <span>
                  <i className="pastille avec" /> Tournées prêtes
                </span>
                <span>
                  <i className="pastille" /> Pas encore
                </span>
                {monDep && (
                  <span>
                    <i className="pastille moi" /> Ton département
                  </span>
                )}
              </div>
            </section>

            {avecTournees.length > 0 && (
              <section className="groupe">
                <h2>
                  Départements avec des tournées
                  <span>{avecTournees.length}</span>
                </h2>
                <div className="liste">
                  {avecTournees.map((c) => (
                    <LigneDep key={c} code={c} stats={stats} />
                  ))}
                </div>
              </section>
            )}

            <p className="pied prose">
              Contours des départements : Etalab, Licence ODbL.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function LigneDep({ code, stats }: { code: string; stats: StatsDep }) {
  const s = stats[code];
  return (
    <LigneLien
      href={lienDep(code)}
      code={code}
      eteint={!s}
      titre={nomDep(code)}
      meta={s ? `${pluriel(s.tournees, 'tournée')} · ${pluriel(s.panneaux, 'panneau', 'panneaux')}` : 'Pas encore de tournée'}
    />
  );
}

/** Même carte que les tournées, le code du département à la place du numéro. */
function LigneLien({
  href,
  code,
  titre,
  meta,
  eteint = false,
}: {
  href: string;
  code: string;
  titre: ReactNode;
  meta: string;
  eteint?: boolean;
}) {
  return (
    <div className="tournee-ligne">
      <article className="tournee">
        <Link href={href} className="tournee-ouvrir">
          <span className={'tournee-num dep-code' + (eteint ? ' eteint' : '')}>{code}</span>
          <span className="tournee-txt">
            <span className="tournee-titre">{titre}</span>
            <span className="tournee-meta">{meta}</span>
          </span>
          <span className="tournee-chev">{IconChev}</span>
        </Link>
      </article>
    </div>
  );
}
