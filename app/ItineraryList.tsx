'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { gmapsUrl, cleanName, isAutoName, type Mode } from '@/lib/maps';
import { useOptimizedOrder, type Status, type Mesure } from './useOptimizedOrder';
import Marque, { DuoVioletDef } from './Marque';
import TourneeDetail, { type NoteOrdre } from './TourneeDetail';

type Panel = { name: string; lat: number; lng: number };
type Kind = 'circo' | 'ville';
type It = { id: string; name: string; city: string | null; kind: Kind; panels: Panel[] };

const VUE: { kind: Kind; label: string }[] = [
  { kind: 'ville', label: 'Par commune' },
  { kind: 'circo', label: 'Par circonscription' },
];

/** « Nantes · Centre-ville » : la commune s'efface, le quartier reste lisible.
 *  Les grandes communes sont découpées en quartiers, et répéter leur nom sur
 *  quinze pastilles noie l'information utile. */
function Lieu({ nom }: { nom: string }) {
  const i = nom.indexOf(' · ');
  if (i < 0) return <>{nom}</>;
  return (
    <>
      <span className="lieu-mere">{nom.slice(0, i)}</span>
      {nom.slice(i + 3)}
    </>
  );
}

const IconNav = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);
const IconChev = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="var(--violet)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IconWalk = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z" />
  </svg>
);
const IconBike = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.4-.4-.9-.6-1.4-.6s-1 .2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z" />
  </svg>
);
const IconCar = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
  </svg>
);
const MODE: Record<Mode, { label: string; icon: ReactNode }> = {
  walking: { label: 'À pied', icon: IconWalk },
  bicycling: { label: 'Vélo', icon: IconBike },
  driving: { label: 'Voiture', icon: IconCar },
};
const MODES: Mode[] = ['walking', 'bicycling', 'driving'];

/** Texte de la pastille de géolocalisation, dans le bandeau. */
function geoLabel(status: Status, approx: boolean, refining: boolean): string {
  switch (status) {
    case 'asking':
      return 'Autorise la localisation';
    case 'locating':
      return 'Recherche de ta position…';
    case 'optimizing':
      return 'Calcul du meilleur ordre…';
    case 'ready':
      if (refining) return 'Affinage par la route…';
      return approx ? 'Ordre adapté (à vol d’oiseau)' : 'Ordre adapté à ta position';
    case 'denied':
      return 'Position refusée · ordre par défaut';
    case 'unavailable':
      return 'Position indisponible · ordre par défaut';
    case 'failed':
      return 'Calcul indisponible · ordre par défaut';
  }
}

/** Couleur du point : jaune en cours, vert prêt, rose refusé. */
function geoPoint(status: Status): string {
  if (status === 'ready') return 'pret';
  if (status === 'denied' || status === 'unavailable' || status === 'failed') return 'refus';
  return 'attente';
}

const km = (m: number) =>
  m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const duree = (s: number) =>
  s < 3600
    ? `≈ ${Math.max(1, Math.round(s / 60))} min`
    : `≈ ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;

export default function ItineraryList({ itineraries }: { itineraries: It[] }) {
  // Le collage urbain se fait à pied : c'est le mode par défaut de la charte.
  const [mode, setMode] = useState<Mode>('walking');
  const [vue, setVue] = useState<Kind>(
    itineraries.some((it) => it.kind === 'ville') ? 'ville' : 'circo',
  );
  const [commune, setCommune] = useState<string | null>(null);

  const duVue = useMemo(() => itineraries.filter((it) => it.kind === vue), [itineraries, vue]);
  // « numeric » pour que 10ème circonscription ne passe pas avant la 1ère.
  const ordreGroupe = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true });
  const communes = useMemo(
    () => [...new Set(duVue.map((it) => it.city?.trim() || 'Autres'))].sort(ordreGroupe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duVue],
  );
  const visibles = useMemo(() => {
    const l = commune ? duVue.filter((it) => (it.city?.trim() || 'Autres') === commune) : duVue;
    return [...l].sort(
      (a, b) =>
        ordreGroupe(a.city?.trim() || 'Autres', b.city?.trim() || 'Autres') ||
        a.name.localeCompare(b.name, 'fr'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duVue, commune]);

  const [ouverte, setOuverte] = useState<string | null>(null);
  const { status, orders, mesures, approx, refining, retry, position } = useOptimizedOrder(
    visibles,
    mode,
  );

  // Le détail est une vue, pas une page : on garde l'ordre déjà calculé et la
  // position, sans recharger. Une entrée d'historique rend le retour du
  // navigateur naturel.
  const fermer = useCallback(() => {
    if (typeof history !== 'undefined' && history.state?.cnDetail) history.back();
    else setOuverte(null);
  }, []);
  const ouvrir = useCallback((id: string) => {
    setOuverte(id);
    history.pushState({ cnDetail: true }, '');
  }, []);
  useEffect(() => {
    const onPop = () => setOuverte(null);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const compte = (k: Kind) => itineraries.filter((it) => it.kind === k).length;
  const canRetry = status === 'denied' || status === 'unavailable' || status === 'failed';

  // Regroupement par commune : la liste arrive déjà triée.
  const groupes: { city: string; items: It[] }[] = [];
  for (const it of visibles) {
    const c = it.city?.trim() || 'Autres';
    const last = groupes[groupes.length - 1];
    if (last && last.city === c) last.items.push(it);
    else groupes.push({ city: c, items: [it] });
  }

  const changerVue = (k: Kind) => {
    setVue(k);
    setCommune(null); // les communes ne sont pas les mêmes d'une vue à l'autre
  };

  const selection = ouverte ? visibles.find((it) => it.id === ouverte) : undefined;
  if (selection) {
    const ordre = orders[selection.id];
    const panels = ordre ? ordre.map((i) => selection.panels[i]) : selection.panels;
    const titre =
      ordre && panels.length > 1 && isAutoName(selection.name)
        ? `${panels[0].name || 'Départ'} → ${panels[panels.length - 1].name || 'Arrivée'}`
        : cleanName(selection.name);
    const commune = selection.city?.trim() || 'Autres';
    const note: NoteOrdre =
      status === 'optimizing' || refining
        ? { texte: 'Calcul en cours…', ton: 'attente' }
        : ordre
          ? { texte: 'Optimisé depuis ta position', ton: 'ok' }
          : { texte: 'Ordre par défaut', ton: 'neutre' };

    return (
      <div className="page">
        <DuoVioletDef />
        <TourneeDetail
          titre={titre}
          kicker={commune}
          panels={panels}
          mode={mode}
          mesure={mesures[selection.id]}
          note={note}
          position={position}
          onRetour={fermer}
          modes={MODES.map((m) => (
            <button
              key={m}
              className={'mode' + (mode === m ? ' actif' : '')}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
            >
              {MODE[m].icon}
              <span>{MODE[m].label}</span>
            </button>
          ))}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <DuoVioletDef />

      <header className="hd">
        <div className="hd-marque">
          <Marque size={40} />
          <span className="hd-nom">Casse-Noisette</span>
        </div>
        <h1>
          On colle où <em>aujourd’hui&nbsp;?</em>
        </h1>
        <div className="geo-ligne">
          <div className="geo" aria-live="polite">
            <span className={'geo-point ' + geoPoint(status)} />
            {geoLabel(status, approx, refining)}
          </div>
          {canRetry && (
            <button type="button" className="geo-retry" onClick={retry}>
              Réessayer
            </button>
          )}
        </div>
      </header>

      <div className="modes">
        {MODES.map((m) => (
          <button
            key={m}
            className={'mode' + (mode === m ? ' actif' : '')}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            title={MODE[m].label}
          >
            {MODE[m].icon}
            <span>{MODE[m].label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '22px 16px 0' }}>
        <div className="vues" role="tablist">
          {VUE.filter((v) => compte(v.kind) > 0).map((v) => (
            <button
              key={v.kind}
              role="tab"
              className="vue"
              aria-selected={vue === v.kind}
              onClick={() => changerVue(v.kind)}
            >
              {v.label}
              <span className="vue-cnt">{compte(v.kind)}</span>
            </button>
          ))}
        </div>

        {communes.length >= 2 && (
          <div className="chips">
            <button
              className={'chip' + (commune === null ? ' actif' : '')}
              onClick={() => setCommune(null)}
            >
              Toutes
            </button>
            {communes.map((c) => (
              <button
                key={c}
                className={'chip' + (commune === c ? ' actif' : '')}
                onClick={() => setCommune(c)}
              >
                <Lieu nom={c} />
              </button>
            ))}
          </div>
        )}
      </div>

      <main className="corps">
        {visibles.length === 0 && <p className="vide">Aucune tournée pour le moment.</p>}

        {groupes.map((g) => (
          <section className="groupe" key={g.city}>
            <h2>
              <span className="lieu-nom"><Lieu nom={g.city} /></span>
              <span>
                {g.items.length} tournée{g.items.length > 1 ? 's' : ''}
              </span>
            </h2>
            <div className="liste">
              {g.items.map((it, i) => (
                <Carte
                  key={it.id}
                  it={it}
                  num={i + 1}
                  mode={mode}
                  ordre={orders[it.id]}
                  mesure={mesures[it.id]}
                  onOuvrir={() => ouvrir(it.id)}
                />
              ))}
            </div>
          </section>
        ))}

        <p className="pied prose">
          La navigation démarre depuis ta position et enchaîne les panneaux dans l’ordre le plus
          court.
        </p>
      </main>
    </div>
  );
}

function Carte({
  it,
  num,
  mode,
  ordre,
  mesure,
  onOuvrir,
}: {
  it: It;
  num: number;
  mode: Mode;
  ordre?: number[];
  mesure?: Mesure;
  onOuvrir: () => void;
}) {
  const panels = ordre ? ordre.map((i) => it.panels[i]) : it.panels;
  const url = gmapsUrl(panels, mode);
  // Un nom auto « de X à Y » ne décrit plus le parcours une fois réordonné :
  // on le recalcule sur les extrémités réelles, un nom saisi à la main est gardé.
  const titre =
    ordre && panels.length > 1 && isAutoName(it.name)
      ? `${panels[0].name || 'Départ'} → ${panels[panels.length - 1].name || 'Arrivée'}`
      : cleanName(it.name);

  return (
    <div className="tournee-ligne">
      <article className="tournee">
        <button type="button" className="tournee-ouvrir" onClick={onOuvrir}>
          <span className="tournee-num">{num}</span>
          <span className="tournee-txt">
            <span className="tournee-titre">{titre}</span>
            <span className="tournee-meta">
              <span>
              {panels.length} panneau{panels.length > 1 ? 'x' : ''}
            </span>
              {mesure && <span>{km(mesure.meters)}</span>}
              {mesure?.seconds != null && <span>{duree(mesure.seconds)}</span>}
            </span>
          </span>
          <span className="tournee-chev">{IconChev}</span>
        </button>
      </article>
      <a className="tournee-gps" href={url} target="_blank" rel="noopener" aria-label="Lancer le GPS">
        {IconNav}
        GPS
      </a>
    </div>
  );
}
