'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEP_COOKIE } from '@/lib/departements';
import { gmapsUrl, cleanName, isAutoName, rueSeule, type Mode } from '@/lib/maps';
import { useOptimizedOrder, type Status, type Mesure } from './useOptimizedOrder';
import { useFavoris } from './useFavoris';
import Marque, { DuoVioletDef } from './Marque';
import TourneeDetail, { type NoteOrdre } from './TourneeDetail';
import { debloquerVoix } from './useVoix';
import { demanderBoussole } from './boussole';
import HdMoi from './HdMoi';
import { fraicheur, type EtatCourant } from '@/lib/etatsPanneau';
import { bilan, type Etats } from './Signalement';

// Le mode « Tournée » embarque MapLibre et Ferrostar (WebAssembly compris) :
// chargé seulement quand on le lance, jamais côté serveur.
const Navigation = dynamic(() => import('./Navigation'), {
  ssr: false,
  loading: () => (
    <div className="nav nav-chargement" role="status">
      Préparation du guidage…
    </div>
  ),
});

type Panel = { id: string; name: string; lat: number; lng: number; city: string | null };
type Kind = 'circo' | 'ville';
type It = { id: string; name: string; city: string | null; kind: Kind; panels: Panel[] };

const VUE: { kind: Kind; label: string }[] = [
  { kind: 'ville', label: 'Par commune' },
  { kind: 'circo', label: 'Par circonscription' },
];

/** « Nantes · Centre-ville » : la commune donne le ton, le quartier la précise
 *  dans un corps plus petit. Les deux restent en gras, l'un pour se repérer
 *  d'un coup d'œil dans la liste, l'autre pour savoir où l'on colle. */
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

const IconNav = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);
const IconEtoile = ({ plein, taille = 18 }: { plein: boolean; taille?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={taille}
    height={taille}
    fill={plein ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polygon points="12 2 15.1 8.6 22 9.6 17 14.6 18.2 21.6 12 18.3 5.8 21.6 7 14.6 2 9.6 8.9 8.6" />
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

const IconCarte = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6" />
    <line x1="8" y1="3" x2="8" y2="18" />
    <line x1="16" y1="6" x2="16" y2="21" />
  </svg>
);

const IconOk = (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const groupeDe = (it: It) => it.city?.trim() || 'Autres';

export default function ItineraryList({
  itineraries,
  etats: etatsInitiaux,
  maintenant: rendu,
  moi,
  departement,
  initial = {},
}: {
  /** Les tournées d'un seul département : la page ne charge que celui-là. */
  itineraries: It[];
  /** État courant des panneaux de ces tournées (dernier signalement). */
  etats: Etats;
  /** Heure du rendu serveur : « il y a 2 j » se calcule pareil des deux côtés. */
  maintenant: number;
  moi: { nom: string; image: string | null };
  departement: { code: string; nom: string };
  /** Vue et commune demandées par l'URL (résultat de recherche). */
  initial?: { vue?: Kind; lieu?: string; repasser?: boolean };
}) {
  // Les signalements faits depuis cette page s'y ajoutent sans recharger.
  const [etats, setEtats] = useState<Etats>(etatsInitiaux);
  const [maintenant, setMaintenant] = useState(rendu);
  const onSignale = useCallback((panelId: string, e: EtatCourant) => {
    setEtats((cur) => ({ ...cur, [panelId]: e }));
    setMaintenant(Date.now());
  }, []);
  // Les durées « il y a… » vieillissent avec la page restée ouverte.
  useEffect(() => {
    setMaintenant(Date.now());
    const t = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const aRepasser = useCallback(
    (it: It) => bilan(it.panels.map((p) => p.id), etats).aRepasser,
    [etats],
  );
  // Filtre « à repasser » : seulement les tournées où il reste du travail.
  const [repasser, setRepasser] = useState(Boolean(initial.repasser));

  // Le collage urbain se fait à pied : c'est le mode par défaut de la charte.
  const [mode, setMode] = useState<Mode>('walking');
  const [vue, setVue] = useState<Kind>(() => {
    if (initial.vue && itineraries.some((it) => it.kind === initial.vue)) return initial.vue;
    return itineraries.some((it) => it.kind === 'ville') ? 'ville' : 'circo';
  });
  // Une commune inconnue dans cette vue viderait la liste : on l'ignore.
  const [commune, setCommune] = useState<string | null>(() =>
    initial.lieu && itineraries.some((it) => it.kind === vue && groupeDe(it) === initial.lieu)
      ? initial.lieu
      : null,
  );

  // Le département affiché devient celui de l'appareil : rouvrir l'appli
  // ramène ici, même sans paramètre dans l'adresse (écran d'accueil de la PWA).
  useEffect(() => {
    document.cookie = `${DEP_COOKIE}=${encodeURIComponent(departement.code)}; path=/; max-age=31536000; samesite=lax`;
  }, [departement.code]);

  // Arrivé par la recherche sur une commune : sa pastille peut être loin à
  // droite dans la rangée, on l'amène sous les yeux.
  useEffect(() => {
    if (initial.lieu) document.querySelector('.chips .chip.actif')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { favoris, basculer } = useFavoris();

  const deLaVue = useMemo(() => itineraries.filter((it) => it.kind === vue), [itineraries, vue]);
  const nbARepasser = useMemo(() => deLaVue.filter((it) => aRepasser(it) > 0).length, [deLaVue, aRepasser]);
  const duVue = useMemo(
    () => (repasser ? deLaVue.filter((it) => aRepasser(it) > 0) : deLaVue),
    // Le filtre ne se recalcule pas à chaque signalement : une tournée qu'on
    // vient de finir ne doit pas disparaître de sous le doigt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deLaVue, repasser],
  );
  // Une commune et une circonscription peuvent porter le même nom, et « 4ème
  // circonscription » existe dans chaque département : le favori retient donc
  // aussi l'onglet et le département d'où il vient.
  const cleFavori = (nom: string) => `${departement.code}:${vue}:${nom}`;
  const estFavori = (nom: string) => favoris.includes(cleFavori(nom));
  // « numeric » pour que 10ème circonscription ne passe pas avant la 1ère.
  const ordreGroupe = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true });
  // Les secteurs mis en favori remontent en tête : on ouvre l'app sur le sien.
  const ordreAffiche = (a: string, b: string) =>
    Number(estFavori(b)) - Number(estFavori(a)) || ordreGroupe(a, b);
  const communes = useMemo(
    () => [...new Set(duVue.map((it) => it.city?.trim() || 'Autres'))].sort(ordreAffiche),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duVue, favoris, vue],
  );
  const visibles = useMemo(() => {
    const l = commune ? duVue.filter((it) => (it.city?.trim() || 'Autres') === commune) : duVue;
    return [...l].sort(
      (a, b) =>
        ordreAffiche(a.city?.trim() || 'Autres', b.city?.trim() || 'Autres') ||
        a.name.localeCompare(b.name, 'fr'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duVue, commune, favoris, vue]);

  const [ouverte, setOuverte] = useState<string | null>(null);
  const { status, orders, mesures, approx, refining, retry, position } = useOptimizedOrder(
    visibles,
    mode,
  );

  // Le détail est une vue, pas une page : on garde l'ordre déjà calculé et la
  // position, sans recharger. Une entrée d'historique rend le retour du
  // navigateur naturel. Le revers, c'est qu'aucune navigation ne remet le
  // défilement à zéro : sans ça, ouvrir une tournée prise en bas de liste
  // affichait son détail déjà défilé, carte coupée.
  const placeDansListe = useRef(0);
  const venaitDuDetail = useRef(false);

  const fermer = useCallback(() => {
    if (typeof history !== 'undefined' && history.state?.cnDetail) history.back();
    else setOuverte(null);
  }, []);

  // Mode « Tournée » (navigation guidée) : une vue de plus par-dessus le
  // détail, avec son entrée d'historique — le retour du téléphone en sort.
  // Panneaux, titre et mode sont figés au démarrage : l'ordre de passage ne
  // se rebat pas en route.
  const [navigation, setNavigation] = useState<{ titre: string; panels: Panel[]; mode: Mode } | null>(null);
  const quitterNavigation = useCallback(() => {
    if (typeof history !== 'undefined' && history.state?.cnNav) history.back();
    else setNavigation(null);
  }, []);
  const ouvrir = useCallback((id: string) => {
    placeDansListe.current = scrollY;
    setOuverte(id);
    history.pushState({ cnDetail: true }, '');
    scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => {
      const s = history.state;
      if (!s?.cnNav) setNavigation(null);
      if (!s?.cnDetail) setOuverte(null);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  // Au retour, la liste reprend là où elle était — remonter le militant en
  // haut de 62 tournées serait aussi pénible que l'inverse.
  useEffect(() => {
    if (ouverte) {
      venaitDuDetail.current = true;
      return;
    }
    if (!venaitDuDetail.current) return; // premier rendu : ne rien imposer
    venaitDuDetail.current = false;
    scrollTo(0, placeDansListe.current);
  }, [ouverte]);
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

    if (navigation) {
      return (
        <Navigation
          titre={navigation.titre}
          panels={navigation.panels}
          mode={navigation.mode}
          etats={etats}
          maintenant={maintenant}
          onSignale={onSignale}
          onQuitter={quitterNavigation}
        />
      );
    }

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
          etats={etats}
          maintenant={maintenant}
          onSignale={onSignale}
          onRetour={fermer}
          onDemarrer={() => {
            // Tout ce qui exige un geste de l'utilisateur, avant de quitter ce clic :
            // la boussole (permission sur iOS), la voix (Safari), le plein écran
            // (Android ; ni l'iPhone ni les vieux navigateurs : on reste en standalone).
            demanderBoussole();
            debloquerVoix();
            try {
              document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => undefined);
            } catch {}
            setNavigation({ titre, panels, mode });
            history.pushState({ cnDetail: true, cnNav: true }, '');
          }}
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
          <HdMoi nom={moi.nom} image={moi.image} />
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
        <Link href="/carte" className="dep-choix">
          <span className="tournee-num dep-code">{departement.code}</span>
          <span className="tournee-txt">
            <span className="tournee-titre">{departement.nom}</span>
            <span className="tournee-meta">
              {itineraries.length} tournée{itineraries.length > 1 ? 's' : ''}
            </span>
          </span>
          <span className="dep-choix-action">
            {IconCarte}
            Changer
          </span>
        </Link>

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

        {(nbARepasser > 0 || repasser) && (
          <button
            type="button"
            className={'filtre-repasser' + (repasser ? ' actif' : '')}
            aria-pressed={repasser}
            onClick={() => {
              // Une commune sans rien à repasser viderait la liste : on la lâche.
              if (!repasser && commune && !deLaVue.some((it) => groupeDe(it) === commune && aRepasser(it) > 0)) {
                setCommune(null);
              }
              setRepasser(!repasser);
            }}
          >
            <span className="pastille-etat etat-arrache" aria-hidden="true" />
            À repasser
            <span className="vue-cnt">{nbARepasser}</span>
          </button>
        )}

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
                {estFavori(c) && (
                  <span className="etoile">
                    <IconEtoile plein taille={12} />
                  </span>
                )}
                <Lieu nom={c} />
              </button>
            ))}
          </div>
        )}
      </div>

      <main className="corps">
        {visibles.length === 0 && (
          <p className="vide">
            {repasser ? 'Rien à repasser ici : tous les panneaux signalés sont en place.' : 'Aucune tournée pour le moment.'}
          </p>
        )}

        {groupes.map((g) => (
          <section className="groupe" key={g.city}>
            <h2>
              <span className="lieu-nom"><Lieu nom={g.city} /></span>
              <span>
                {g.items.length} tournée{g.items.length > 1 ? 's' : ''}
              </span>
              <button
                className={'fav' + (estFavori(g.city) ? ' actif' : '')}
                onClick={() => basculer(cleFavori(g.city))}
                aria-pressed={estFavori(g.city)}
                title={estFavori(g.city) ? 'Retirer des favoris' : 'Mettre en favori'}
              >
                <IconEtoile plein={estFavori(g.city)} />
                <span className="sr">
                  {estFavori(g.city) ? 'Retirer des favoris' : 'Mettre en favori'}
                </span>
              </button>
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
                  etats={etats}
                  maintenant={maintenant}
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
  etats,
  maintenant,
  onOuvrir,
}: {
  it: It;
  num: number;
  mode: Mode;
  ordre?: number[];
  mesure?: Mesure;
  etats: Etats;
  maintenant: number;
  onOuvrir: () => void;
}) {
  const { aRepasser, dernier } = bilan(it.panels.map((p) => p.id), etats);
  const panels = ordre ? ordre.map((i) => it.panels[i]) : it.panels;
  const url = gmapsUrl(panels, mode);
  // Un nom auto « de X à Y » ne décrit plus le parcours une fois réordonné :
  // on le recalcule sur les extrémités réelles, un nom saisi à la main est gardé.
  // Seules les rues : le complément d'adresse est réservé au détail.
  const titre =
    panels.length > 1 && isAutoName(it.name)
      ? `${rueSeule(panels[0].name) || 'Départ'} → ${rueSeule(panels[panels.length - 1].name) || 'Arrivée'}`
      : cleanName(it.name);

  // Une tournée de circonscription traverse plusieurs communes : on choisit
  // d'abord sur elles, donc elles passent en titre et les rues descendent en
  // sous-titre. Une tournée de commune n'a rien à dire là-dessus — sa carte
  // laisse alors les rues s'étaler sur les deux lignes libres et se lire en
  // entier au lieu d'être coupées.
  const communes =
    it.kind === 'circo'
      ? [...new Set(panels.map((p) => p.city?.trim()).filter(Boolean))].join(' · ')
      : '';

  return (
    <div className="tournee-ligne">
      <article className="tournee">
        <button type="button" className="tournee-ouvrir" onClick={onOuvrir}>
          <span className="tournee-num">{num}</span>
          <span className="tournee-txt">
            <span className="tournee-titre">{communes || titre}</span>
            {communes && <span className="tournee-meta">{titre}</span>}
          </span>
          {dernier && (
            // Pastille rouge : panneaux à repasser ; verte : tout est en
            // place. Dessous, l'âge du dernier constat sur la tournée.
            <span className="tournee-etat" title={`Dernier signalement il y a ${fraicheur(dernier, maintenant)}`}>
              <span className={'tournee-etat-cnt' + (aRepasser > 0 ? '' : ' ok')}>
                {aRepasser > 0 ? aRepasser : IconOk}
                <span className="sr">
                  {aRepasser > 0 ? ` panneau${aRepasser > 1 ? 'x' : ''} à repasser` : ' tout est en place'}
                </span>
              </span>
              <span className="tournee-etat-age">{fraicheur(dernier, maintenant)}</span>
            </span>
          )}
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
