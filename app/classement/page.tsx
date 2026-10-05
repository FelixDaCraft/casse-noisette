import Link from 'next/link';
import { requireMilitant } from '@/lib/auth';
import { DEPARTEMENTS, codeDepartement, nomDepartement } from '@/lib/departements';
import { nomCourt } from '@/lib/signalements';
import { CAMPAGNE, PERIODE, PERIODES, estPeriode, niveau, bilan, type Periode } from '@/lib/points';
import {
  classementDansDepartement,
  classementDansGroupe,
  classementDepartements,
  classementGroupes,
  gainsMilitant,
  gainsPeriode,
  maPlace,
  type LigneClassement,
} from '@/lib/classement';
import Marque, { DuoVioletDef } from '../Marque';
import Avatar from '../Avatar';

export const dynamic = 'force-dynamic';

type Params = { [cle: string]: string | string[] | undefined };
const un = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

const IconRetour = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

/* Quatre classements, du plus proche au plus large. Les deux premiers
   nomment des militants, mais seulement entre camarades d'un même groupe ou
   d'un même département, et en « Prénom N. » ; à l'échelle nationale, on ne
   classe que des départements. */
type Vue = 'groupe' | 'departement' | 'groupes' | 'departements';
const VUE: Record<Vue, string> = {
  groupe: 'Mon groupe',
  departement: 'Mon département',
  groupes: 'Groupes d’action',
  departements: 'Départements',
};

/** « 1er septembre », « 15 octobre ». */
function jourEnLettres(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const j = d.getUTCDate();
  return `${j === 1 ? '1er' : j} ${d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })}`;
}

const QUAND: Record<Periode, string> = {
  semaine: 'cette semaine',
  mois: 'ce mois-ci',
  campagne: `depuis le ${jourEnLettres(CAMPAGNE.debut)}`,
};

/** Combien de lignes on montre ; la sienne est ajoutée en dessous si elle
 *  n'y est pas. */
const TETE = 30;

const POIDS = { animateur: 0, gestionnaire: 1, membre: 2, abonne: 3 } as const;

export default async function ClassementPage({ searchParams }: { searchParams: Promise<Params> }) {
  const m = await requireMilitant('/classement');
  const sp = await searchParams;
  const periode: Periode = estPeriode(un(sp.periode)) ? (un(sp.periode) as Periode) : 'semaine';

  const groupes = [...m.memberships]
    .sort((a, b) => POIDS[a.role] - POIDS[b.role] || a.group.name.localeCompare(b.group.name, 'fr'))
    .map((x) => x.group);
  const dep = codeDepartement(m.department) ?? codeDepartement(groupes.find((g) => g.department)?.department);

  const vues = (Object.keys(VUE) as Vue[]).filter(
    (v) => (v !== 'groupe' || groupes.length > 0) && (v === 'departements' || v === 'groupe' || dep),
  );
  const demandee = un(sp.vue) as Vue | undefined;
  const vue: Vue = demandee && vues.includes(demandee) ? demandee : vues[0];
  const groupe = groupes.find((g) => g.id === un(sp.groupe)) ?? groupes[0];

  const lien = (o: { vue?: Vue; periode?: Periode; groupe?: string }) => {
    const q = new URLSearchParams({ vue: o.vue ?? vue, periode: o.periode ?? periode });
    const gr = (o.vue ?? vue) === 'groupe' ? (o.groupe ?? groupe?.id) : undefined;
    if (gr && gr !== groupes[0]?.id) q.set('groupe', gr);
    return `/classement?${q}`;
  };

  const [gains, campagne] = await Promise.all([gainsPeriode(periode), gainsMilitant(m.id)]);
  const mesPoints = gains.filter((g) => g.militantId === m.id).reduce((s, g) => s + g.points, 0);
  const n = niveau(bilan(campagne).points);

  let lignes: LigneClassement[] = [];
  let titre = '';
  if (vue === 'groupe' && groupe) {
    lignes = await classementDansGroupe(gains, groupe.id, m.id);
    titre = groupe.name;
  } else if (vue === 'departement' && dep) {
    lignes = await classementDansDepartement(gains, dep, m.id);
    titre = nomDepartement(dep)!;
  } else if (vue === 'groupes' && dep) {
    lignes = await classementGroupes(gains, dep, groupes.map((g) => g.id));
    titre = `Groupes · ${DEPARTEMENTS[dep]}`;
  } else {
    lignes = classementDepartements(gains, DEPARTEMENTS, dep);
    titre = 'France entière';
  }
  const moi = maPlace(lignes);
  const tete = lignes.slice(0, TETE);
  const horsTete = moi && moi.rang > TETE ? moi : null;
  const personne = lignes.every((l) => l.points === 0);
  // Sur les lignes collectives, « toi » se dit autrement.
  const toi = vue === 'groupes' ? 'ton groupe' : vue === 'departements' ? 'chez toi' : 'toi';

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
          <Link href="/profil" className="hd-moi" title="Mon profil">
            <Avatar nom={m.displayName} image={m.image} className="avatar avatar-sm" />
            <span className="sr">Mon profil</span>
          </Link>
        </div>
        <h1>
          Le <em>classement</em>
        </h1>
      </header>

      <Link href="/profil#points" className="profil-carte classement-moi">
        <Avatar nom={m.displayName} image={m.image} className="avatar" />
        <span className="profil-id">
          <span className="classement-moi-nom">{nomCourt(m)}</span>
          <span className="profil-sous">
            Niveau {n.actuel.rang} · {n.actuel.nom}
          </span>
        </span>
        <span className="classement-moi-pts">
          <b>{mesPoints}</b>
          <span>pts {QUAND[periode]}</span>
        </span>
      </Link>

      <main className="corps">
        <nav className="modes-compact periodes" aria-label="Période">
          {PERIODES.map((p) => (
            <Link
              key={p}
              href={lien({ periode: p })}
              className={'mode' + (p === periode ? ' actif' : '')}
              aria-current={p === periode ? 'page' : undefined}
            >
              {PERIODE[p]}
            </Link>
          ))}
        </nav>

        <nav className="chips" aria-label="Classement">
          {vues.map((v) => (
            <Link
              key={v}
              href={lien({ vue: v })}
              className={'chip' + (v === vue ? ' actif' : '')}
              aria-current={v === vue ? 'page' : undefined}
            >
              {VUE[v]}
            </Link>
          ))}
        </nav>
        {vue === 'groupe' && groupes.length > 1 && (
          <nav className="chips chips-sous" aria-label="Groupe d’action">
            {groupes.map((g) => (
              <Link
                key={g.id}
                href={lien({ groupe: g.id })}
                className={'chip' + (g.id === groupe?.id ? ' actif' : '')}
              >
                {g.name}
              </Link>
            ))}
          </nav>
        )}

        <section className="groupe">
          <h2>
            <span className="lieu-nom">{titre}</span>
            {moi && moi.points > 0 && (
              <span>
                {moi.rang}
                {moi.rang === 1 ? 're' : 'e'} sur {lignes.length}
              </span>
            )}
          </h2>
          {personne ? (
            <p className="vide prose">
              Personne n’a encore marqué de points {QUAND[periode]}. Ouvre une tournée et touche
              « J’ai collé » sur un panneau : tu prends la tête.
            </p>
          ) : (
            <ol className="liste classement">
              {tete.map((l) => (
                <Rang key={l.id} l={l} toi={toi} />
              ))}
              {horsTete && (
                <>
                  <li className="rang-ellipse" aria-hidden="true">
                    ⋯
                  </li>
                  <Rang l={horsTete} toi={toi} />
                </>
              )}
            </ol>
          )}
        </section>

        <p className="pied prose">
          Les points viennent des signalements sur le terrain et se recalculent à chaque visite.
          Prénom et initiale seulement, et pas de classement individuel à l’échelle du pays.{' '}
          <Link href="/profil#badges">Comment gagner des points</Link>
        </p>
      </main>
    </div>
  );
}

function Rang({ l, toi }: { l: LigneClassement; toi: string }) {
  return (
    <li className={'rang-ligne' + (l.moi ? ' moi' : '')} aria-current={l.moi ? 'true' : undefined}>
      <span className={'rang-num' + (l.rang <= 3 && l.points > 0 ? ' podium' : '')}>{l.rang}</span>
      <span className="rang-txt">
        <span className="rang-nom">
          {l.nom}
          {l.moi && <span className="rang-toi">{toi}</span>}
        </span>
        <span className="rang-meta">
          {[l.sous, `${l.colles} collage${l.colles > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="rang-pts">
        {l.points}
        <span>pts</span>
      </span>
    </li>
  );
}
