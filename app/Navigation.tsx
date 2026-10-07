'use client';
// Mode « Tournée » : navigation guidée de panneau en panneau, sans quitter
// l'appli, et validation de chaque panneau sur place.
//
// Moteur : Ferrostar (Stadia Maps, libre) suit le tracé, avance d'étape en
// étape, détecte l'écart et choisit les annonces ; l'itinéraire et ses
// consignes en français viennent de notre Valhalla, via /api/valhalla/route
// (jamais appelé directement par le navigateur). Carte : MapLibre GL JS sur
// un fond vectoriel OpenFreeMap, orientée dans le sens de la marche et
// inclinée (app/carteNav.ts). Tout ce lourd (MapLibre, Ferrostar et son
// WebAssembly) n'est chargé qu'à l'entrée dans ce mode.
//
// Déroulé : l'itinéraire enchaîne tous les panneaux restants, ce qui chiffre
// la tournée entière, mais le guidage s'arrête au PROCHAIN panneau : à moins
// de ~40 m, la feuille d'arrivée propose « Collé » (la même action serveur
// que le bouton « J'ai collé » du détail), les autres constats et « Passer »,
// puis on recalcule depuis là vers les suivants. Si l'on s'écarte du tracé
// quelques secondes, on recalcule. À la fin, un récapitulatif : panneaux
// collés, temps passé, points gagnés.
//
// L'ordre des panneaux est figé au démarrage : c'est celui calculé depuis le
// point de départ du militant (useOptimizedOrder), on ne le rebat pas en route.

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Route, TripState } from '@stadiamaps/ferrostar';
import type { FerrostarCore, PointDePassage } from '@stadiamaps/ferrostar-webcomponents';
import { gmapsUrl, rueSeule, type Mode } from '@/lib/maps';
import { ETAT, ETATS, type Etat, type EtatCourant } from '@/lib/etatsPanneau';
import { BAREME, FENETRE_TOURNEE_H } from '@/lib/points';
import {
  COSTING,
  ECART_DUREE_MS,
  ECART_SEUIL_M,
  PRECISION_MAX_M,
  RAYON_ARRIVEE,
  RECALCUL_MIN_MS,
  distanceCourte,
  distanceM,
  dureeCourte,
  estArrive,
  etapeArrivee,
  jusquAuPanneau,
  nettoyerConsigne,
  sansPoint,
  type Pt,
} from '@/lib/guidage';
import { useToast } from './admin/Toast';
import { useRecompense } from './Recompense';
import { FeuilleSignalement, LigneEtat, PastilleEtat, envoyerSignalement, type Etats } from './Signalement';
import { useWakeLock } from './useWakeLock';
import { useVoix } from './useVoix';
import { CarteNav } from './carteNav';
import { PositionNav, type Fix, type Simulateur } from './positionNav';
import { diagBoussole, ecouterBoussole } from './boussole';

type Panel = { id: string; name: string; lat: number; lng: number };
type Resultat = { etat?: Etat; passe?: boolean; points: number; tournee: number };
type Phase = 'guidage' | 'arrivee' | 'fin';
type EnRoute = Extract<TripState, { Navigating: unknown }>['Navigating'];
type Guidage =
  | {
      statut: 'ok';
      pour: string;
      route: Route;
      /** Indice de l'étape qui arrive au prochain panneau. */
      arrivee: number;
      /** Panneaux suivants hors zone : le total de la tournée est incomplet. */
      partiel: boolean;
    }
  | { statut: 'hors-couverture'; pour: string; horsZone: number[] }
  | { statut: 'introuvable'; pour: string };

/** Réponse non 2xx de /api/valhalla/route, avec son corps. */
class ErreurRelais extends Error {
  constructor(
    readonly status: number,
    readonly corps: { statut?: string; horsZone?: number[] } | null,
  ) {
    super(`relais ${status}`);
  }
}

/** Sans nouvelle position depuis tant de secondes, on parle de signal perdu. */
const SIGNAL_PERDU_MS = 15_000;
/** Délai avant d'enchaîner sur le panneau suivant, le temps de voir les points. */
const ENCHAINER_MS = 1800;
/** Au-delà de cette vitesse (m/s), le cap du GPS prime sur la boussole : fiable
 *  en mouvement, quand la boussole est perturbée (carrosserie, moteur) ou
 *  balancée au bout du bras. À l'arrêt, même en voiture, c'est la boussole :
 *  sinon la flèche reste figée quand on tourne le téléphone. */
const VITESSE_CAP_GPS = 2;
/** En voiture, le GPS reprend la main dès qu'on roule au pas. */
const VITESSE_CAP_GPS_VOITURE = 1;
/** Position recalée sur le tracé : affichée seulement si elle est à moins de
 *  cette distance de la position GPS brute, et le GPS assez précis. Au-delà,
 *  le recalage collait sur la rue de l'itinéraire un militant qui marchait
 *  dans la rue d'à côté. */
const RECALAGE_MAX_M: Record<Mode, number> = { walking: 12, bicycling: 15, driving: 20 };
const RECALAGE_PRECISION_MAX_M = 25;
/** Mesure de boussole plus vieille que ça : on ne s'y fie plus. */
const BOUSSOLE_FRAICHE_MS = 2000;
/** Échecs de calcul d'affilée au-delà desquels on propose Google Maps. */
const ECHECS_SECOURS = 3;
/** Hors couverture : on retente le calcul quand on a bougé d'autant. */
const REESSAI_DEPLACEMENT_M = 300;

const AUTRES_ETATS = ETATS.filter((e) => e !== 'colle');

const heure = (ms: number) =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * Réglages du suivi Ferrostar. Les distances sont celles d'un militant qui
 * marche ou roule en ville : on passe à la consigne suivante une dizaine de
 * mètres avant le carrefour (vingt-cinq en voiture), on se déclare hors du
 * tracé au-delà de ECART_SEUIL_M, et seulement si le GPS est assez précis
 * pour en juger.
 */
function reglages(mode: Mode) {
  return {
    stepAdvanceCondition: {
      DistanceEntryExit: {
        minimumHorizontalAccuracy: 30,
        distanceToEndOfStep: mode === 'driving' ? 25 : 12,
        distanceAfterEndStep: 5,
        hasReachedEndOfCurrentStep: false,
      },
    },
    arrivalStepAdvanceCondition: {
      DistanceToEndOfStep: { distance: RAYON_ARRIVEE[mode] / 2, minimumHorizontalAccuracy: 30 },
    },
    routeDeviationTracking: {
      StaticThreshold: { minimumHorizontalAccuracy: PRECISION_MAX_M, maxAcceptableDeviation: ECART_SEUIL_M },
    },
    snappedLocationCourseFiltering: 'SnapToRoute',
    waypointAdvance: { WaypointWithinRange: RAYON_ARRIVEE[mode] },
  };
}

/* ─── Icônes ─────────────────────────────────────────────────────────────── */

/** Flèche de manœuvre : un fût vertical, la tête orientée selon le virage. */
function FlecheManoeuvre({ type, modifier }: { type: string; modifier?: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (type === 'arrive') {
    return (
      <svg viewBox="0 0 24 24" width={44} height={44} aria-hidden="true" {...p}>
        <path d="M5 22V4c4-2 8 2 13 0v10c-5 2-9-2-13 0" />
      </svg>
    );
  }
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    return (
      <svg viewBox="0 0 24 24" width={44} height={44} aria-hidden="true" {...p}>
        <circle cx="12" cy="10" r="4.5" />
        <path d="M12 22v-7.5M15.2 6.8 19 3M14.5 3H19v4.5" />
      </svg>
    );
  }
  if (modifier === 'uturn') {
    return (
      <svg viewBox="0 0 24 24" width={44} height={44} aria-hidden="true" {...p}>
        <path d="M8 22V9a4 4 0 0 1 8 0v6M12.5 11.5 16 15l3.5-3.5" />
      </svg>
    );
  }
  const angle: Record<string, number> = {
    'slight left': -45,
    left: -90,
    'sharp left': -135,
    'slight right': 45,
    right: 90,
    'sharp right': 135,
  };
  const a = type === 'depart' ? 0 : (angle[modifier ?? ''] ?? 0);
  return (
    <svg viewBox="0 0 24 24" width={44} height={44} aria-hidden="true" {...p}>
      <path d="M12 22v-8" />
      <g transform={`rotate(${a} 12 14)`}>
        <path d="M12 14V4M7 9l5-5 5 5" />
      </g>
    </svg>
  );
}

const IconVoix = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
    {active ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 6 6M22 9l-6 6" />}
  </svg>
);
const IconViser = (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
  </svg>
);
const IconFermer = (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const IconCheck = (
  <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconGmaps = (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
  </svg>
);


/* ─── Écran ──────────────────────────────────────────────────────────────── */

/**
 * Diagnostic de la boussole, pour les essais sur téléphone : ouvrir l'appli avec
 * `?diag=boussole` l'active (retenu sur l'appareil), `?diag=0` l'enlève. Montre
 * ce que le capteur envoie vraiment, sans console de développement.
 */
function DiagBoussole({ mode, vitesse, gps, position, precisionFix }: {
  mode: Mode;
  vitesse: number | null;
  gps: boolean;
  position: { precision: number; ecart: number } | null;
  precisionFix: number | null;
}) {
  const [actif, setActif] = useState(false);
  const [, rafraichir] = useState(0);
  useEffect(() => {
    try {
      const q = new URLSearchParams(location.search).get('diag');
      if (q === 'boussole') localStorage.setItem('cn-diag', 'boussole');
      if (q === '0') localStorage.removeItem('cn-diag');
      setActif(localStorage.getItem('cn-diag') === 'boussole');
    } catch {}
  }, []);
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => rafraichir((n) => n + 1), 400);
    return () => clearInterval(t);
  }, [actif]);
  if (!actif) return null;
  const d = diagBoussole;
  const DOE = (globalThis as any).DeviceOrientationEvent;
  return (
    <pre className="nav-diag">
      {[
        `ua      ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 60)}`,
        `api     DOE=${DOE ? 'oui' : 'non'} requestPermission=${typeof DOE?.requestPermission === 'function' ? 'oui' : 'non'} absolu=${'ondeviceorientationabsolute' in window ? 'oui' : 'non'}`,
        `perm    ${d.permission}`,
        `écoute  ${d.ecoute}`,
        `évts    ${d.evenements}  source ${d.source}`,
        `brut    ${d.brut == null ? '-' : Math.round(d.brut)}°  écran ${d.angleEcran}°  cap ${d.cap ?? '-'}°`,
        `mode    ${mode}  vitesse ${vitesse == null ? '-' : vitesse.toFixed(1)} m/s  → ${gps ? 'cap GPS' : 'boussole'}`,
        `gps     ± ${precisionFix == null ? '-' : Math.round(precisionFix)} m  recalage ${position ? Math.round(position.ecart) + ' m' + (position.ecart <= RECALAGE_MAX_M[mode] && position.precision <= RECALAGE_PRECISION_MAX_M ? ' (retenu)' : ' (ignoré)') : '-'}`,
      ].join('\n')}
    </pre>
  );
}

export default function Navigation({
  titre,
  panels,
  mode,
  etats,
  maintenant,
  onSignale,
  onQuitter,
}: {
  titre: string;
  /** Panneaux dans l'ordre de passage retenu au démarrage. */
  panels: Panel[];
  mode: Mode;
  etats: Etats;
  maintenant: number;
  onSignale: (panelId: string, e: EtatCourant) => void;
  onQuitter: () => void;
}) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>('guidage');
  const [fix, setFix] = useState<Fix | null>(null);
  const [geo, setGeo] = useState<'attente' | 'ok' | 'refus' | 'indispo'>('attente');
  const [signalPerdu, setSignalPerdu] = useState(false);
  const [moteurPret, setMoteurPret] = useState<'attente' | 'ok' | 'echec'>('attente');
  const [carteKo, setCarteKo] = useState(false);
  const [guidage, setGuidage] = useState<Guidage | null>(null);
  const [enRoute, setEnRoute] = useState<EnRoute | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [suivre, setSuivre] = useState(true);
  const [resultats, setResultats] = useState<Record<string, Resultat>>({});
  const [aSignaler, setASignaler] = useState<Etat | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [debut] = useState(() => Date.now());
  const [fin, setFin] = useState<number | null>(null);

  const ecran = useWakeLock(phase !== 'fin');
  const voix = useVoix();
  const { toast, element: toastEl } = useToast();
  const { montrer, element: recompenseEl } = useRecompense(toast);

  const panneau = panels[i] as Panel | undefined;
  const total = panels.length;

  // Valeurs mutables lues par les rappels du GPS et de Ferrostar (enregistrés une fois).
  const iRef = useRef(i);
  iRef.current = i;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const suivreRef = useRef(true);
  suivreRef.current = suivre;
  const fixRef = useRef<Fix | null>(null);
  const moteur = useRef<{ core: FerrostarCore; position: PositionNav } | null>(null);
  const carte = useRef<CarteNav | null>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const echecs = useRef(0);
  const dernierCalcul = useRef(0);
  const posDernierCalcul = useRef<Pt | null>(null);
  const ecartDepuis = useRef<number | null>(null);
  /** Le tracé courant a-t-il été rejoint (au moins une position dessus) ? */
  const rejoint = useRef(false);
  const derniereAnnonce = useRef<string | null>(null);
  const intro = useRef<string | null>(null);
  const arriveeIgnoree = useRef<string | null>(null);
  const horsAnnonce = useRef<string | null>(null);
  const introFaite = useRef<string | null>(null);
  const enchainement = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guidageRef = useRef(guidage);
  guidageRef.current = guidage;
  const enRouteRef = useRef(enRoute);
  enRouteRef.current = enRoute;
  /** Dernier cap de la boussole (lissé) et son heure. */
  const boussole = useRef<{ cap: number; t: number } | null>(null);
  /** Pour le diagnostic : précision du GPS et écart du recalage, en mètres. */
  const diagPosition = useRef<{ precision: number; ecart: number } | null>(null);

  /* ─── Chargement du moteur et de la carte ─── */

  useEffect(() => {
    let annule = false;
    // `?simulation=1` (développement seulement) : la position suit le trajet
    // calculé au lieu du GPS.
    const simulation = process.env.NODE_ENV !== 'production' && new URLSearchParams(location.search).has('simulation');

    Promise.all([import('maplibre-gl'), import('@stadiamaps/ferrostar-webcomponents'), import('@stadiamaps/ferrostar')])
      .then(([ml, fs, coeur]) => {
        if (annule) return;
        const position = new PositionNav(
          (f) => traiterRef.current(f),
          (e) => setGeo((g) => (e === 'refus' ? 'refus' : g === 'ok' ? g : 'indispo')),
          simulation ? (coeur as unknown as Simulateur) : null,
        );
        // FerrostarCore est un élément HTML (web component) sans rendu : on
        // s'en sert comme d'un objet, sans l'insérer dans la page.
        const core = new fs.FerrostarCore();
        core.valhallaEndpointUrl = new URL('/api/valhalla/route', location.href).href;
        core.profile = COSTING[mode];
        core.options = { language: 'fr-FR', units: 'kilometers' };
        core.httpClient = relais;
        core.locationProvider = position;
        core.useVoiceGuidance = false; // la voix passe par useVoix (voix française, bouton couper)
        core.onTripStateChange = (ts: TripState | null) => surEtatRef.current(ts);
        moteur.current = { core, position };

        if (mapEl.current) {
          try {
            const p0 = panels[0];
            carte.current = new CarteNav(ml, mapEl.current, { lat: p0?.lat ?? 47.218, lng: p0?.lng ?? -1.553 }, mode, () =>
              setSuivre(false),
            );
            carte.current.map.on('error', (e: any) => console.warn('[carte]', e?.error?.message ?? e));
            dessinerPanneaux();
          } catch (e) {
            // Pas de WebGL (vieux téléphone, économie d'énergie) : le guidage
            // reste utilisable sans carte.
            console.warn('[carte]', e);
            setCarteKo(true);
          }
        }
        setMoteurPret('ok');
        position.start();
        if (simulation) {
          // Sans position émulée par le navigateur, on part à ~400 m au sud du premier panneau.
          setTimeout(() => {
            const p0 = panels[0];
            if (!annule && !position.lastLocation && p0) position.placer(p0.lat - 0.0036, p0.lng);
          }, 3500);
        }
      })
      .catch((e) => {
        console.error('[navigation]', e);
        if (!annule) setMoteurPret('echec');
      });

    const veille = setInterval(() => {
      const f = fixRef.current;
      setSignalPerdu(!!f && !moteur.current?.position.simulation && Date.now() - f.t > SIGNAL_PERDU_MS);
    }, 3000);

    return () => {
      annule = true;
      clearInterval(veille);
      if (enchainement.current) clearTimeout(enchainement.current);
      ctrlRef.current?.abort();
      const m = moteur.current;
      moteur.current = null;
      if (m) {
        m.core.onTripStateChange = undefined;
        if (m.core.navigationSession) m.core.stopNavigation();
        m.position.stop();
      }
      carte.current?.detruire();
      carte.current = null;
      // Plein écran demandé au démarrage (ItineraryList) : on en sort avec la tournée.
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Client HTTP de Ferrostar : notre relais, annulable, qui lève une
   *  ErreurRelais lisible au lieu de laisser Ferrostar parser une erreur. */
  async function relais(url: URL | string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrlRef.current?.signal,
    });
    if (!res.ok) {
      let corps = null;
      try {
        corps = await res.json();
      } catch {}
      throw new ErreurRelais(res.status, corps);
    }
    return res;
  }

  /* ─── Carte ─── */

  function dessinerPanneaux() {
    carte.current?.placerPanneaux(
      panels.map((p, k) => {
        const r = resultats[p.id];
        const e = r?.etat ?? etats[p.id]?.etat;
        const classes = ['cn-marker'];
        if (e) classes.push(`etat-${e}`);
        const cible = k === i && phase !== 'fin';
        if (cible) classes.push('nav-cible');
        else if (k < i || r) classes.push('nav-fait');
        return { lat: p.lat, lng: p.lng, num: k + 1, classes: classes.join(' '), cible };
      }),
    );
  }

  useEffect(() => {
    dessinerPanneaux();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, resultats, etats, phase]);

  // Tracé : celui du trajet en cours, sinon la direction à vol d'oiseau.
  const routeAffichee = guidage?.statut === 'ok' && guidage.pour === panneau?.id && phase === 'guidage' ? guidage.route : null;
  useEffect(() => {
    carte.current?.tracer(routeAffichee?.geometry ?? null);
  }, [routeAffichee, moteurPret]);
  // Sur un trajet, c'est le suivi Ferrostar qui gère le pointillé (jusqu'au
  // début du tracé tant qu'on ne l'a pas rejoint).
  useEffect(() => {
    if (routeAffichee) return;
    const f = fixRef.current;
    carte.current?.directVers(phase === 'guidage' && f ? f : null, panneau ?? null);
  }, [routeAffichee, phase, fix, panneau, moteurPret]);

  // À l'arrivée, vue à plat sur le panneau et nous.
  useEffect(() => {
    if (phase !== 'arrivee' || !panneau) return;
    const f = fixRef.current;
    carte.current?.cadrer(f ? [panneau, f] : [panneau]);
  }, [phase, panneau]);

  /** Le cap à montrer : la boussole à l'arrêt et à pied, le GPS en voiture
   *  ou dès qu'on va vite ; l'un à défaut de l'autre. */
  function gpsPrime(vitesse: number | null | undefined) {
    return (vitesse ?? 0) >= (mode === 'driving' ? VITESSE_CAP_GPS_VOITURE : VITESSE_CAP_GPS);
  }
  function capRetenu(capGps: number | null | undefined, vitesse: number | null | undefined): number | null {
    const b = boussole.current && Date.now() - boussole.current.t < BOUSSOLE_FRAICHE_MS ? boussole.current.cap : null;
    return gpsPrime(vitesse) ? (capGps ?? b) : (b ?? capGps ?? null);
  }

  /** Où dessiner « moi » : la position recalée sur le tracé si elle est
   *  crédible (tout près de la position GPS, GPS précis), sinon la position
   *  GPS telle quelle. Ferrostar recale dès qu'il ne voit pas d'écart, et il ne
   *  juge pas l'écart quand le GPS est imprécis. */
  function positionAffichee(n: { deviation: unknown; snappedUserLocation: any; userLocation: any }) {
    const brut = n.userLocation;
    const recale = n.snappedUserLocation;
    const precision = brut.horizontalAccuracy ?? fixRef.current?.precision ?? Infinity;
    const ecart = distanceM([brut.coordinates.lat, brut.coordinates.lng], [recale.coordinates.lat, recale.coordinates.lng]);
    diagPosition.current = { precision, ecart };
    const credible = n.deviation === 'NoDeviation' && precision <= RECALAGE_PRECISION_MAX_M && ecart <= RECALAGE_MAX_M[mode];
    return credible ? recale : brut;
  }

  /** Place « moi » et, si on suit, la caméra. Sur le tracé, la position
   *  recalée sur la route (Ferrostar) : le point ne flotte pas dans les maisons. */
  function placerMoi(pos: { lat: number; lng: number }, capGps: number | null | undefined) {
    const c = carte.current;
    if (!c) return;
    const capDeg = capRetenu(capGps, fixRef.current?.vitesse);
    c.placerMoi(pos, capDeg);
    if (suivreRef.current && phaseRef.current === 'guidage') c.suivre(pos, capDeg);
  }

  // Boussole : entre deux positions, la flèche et (en suivi) la carte
  // tournent avec le téléphone. Refusée ou absente : le cap du GPS suffit.
  useEffect(() => {
    if (moteurPret !== 'ok') return;
    return ecouterBoussole((cap) => {
      boussole.current = { cap, t: Date.now() };
      const f = fixRef.current;
      if (gpsPrime(f?.vitesse)) return;
      const c = carte.current;
      c?.orienterMoi(cap);
      if (suivreRef.current && phaseRef.current === 'guidage') c?.orienter(cap);
    });
  }, [moteurPret, mode]);

  /* ─── Itinéraire ─── */

  async function calculer(raison: 'depart' | 'ecart' | 'reessai') {
    const m = moteur.current;
    const loc = m?.position.lastLocation;
    const indice = iRef.current;
    const p = panels[indice];
    if (!m || !loc || !p || phaseRef.current !== 'guidage') return;
    const t0 = Date.now();
    if (raison !== 'depart') {
      // Anti-rebond : jamais deux appels rapprochés, et de plus en plus
      // espacés si le serveur ne répond pas.
      const attente = RECALCUL_MIN_MS * 2 ** Math.min(echecs.current, 3);
      if (ctrlRef.current || t0 - dernierCalcul.current < attente) return;
    }
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    dernierCalcul.current = t0;
    posDernierCalcul.current = [loc.coordinates.lat, loc.coordinates.lng];
    setCalcul(true);

    const restants = panels.slice(indice);
    const etape = (q: Panel): PointDePassage => ({ coordinate: { lat: q.lat, lng: q.lng }, kind: 'Break' });
    // Un seul calcul en vol (garde ci-dessus) : on peut libérer l'adaptateur
    // (mémoire WebAssembly) du calcul précédent, que Ferrostar remplace sans le libérer.
    const libererAdaptateur = () => {
      const a = m.core.routeAdapter;
      m.core.routeAdapter = null;
      a?.free();
    };
    try {
      libererAdaptateur();
      let routes: Route[];
      let partiel = false;
      try {
        routes = await m.core.getRoutes(loc, restants.map(etape));
      } catch (e) {
        // Un panneau plus loin est hors zone : on guide quand même jusqu'au prochain.
        const hz = e instanceof ErreurRelais && e.corps?.statut === 'hors-couverture' ? e.corps.horsZone ?? [] : [];
        if (restants.length > 1 && hz.length > 0 && hz.every((k) => k >= 2)) {
          libererAdaptateur();
          routes = await m.core.getRoutes(loc, [etape(p)]);
          partiel = true;
        } else throw e;
      }
      if (ctrl.signal.aborted || iRef.current !== indice || phaseRef.current !== 'guidage' || moteur.current !== m) return;
      const route = routes[0];
      if (!route) {
        setGuidage({ statut: 'introuvable', pour: p.id });
        return;
      }
      echecs.current = 0;
      setErreur(null);

      // Premier trajet obtenu pour ce panneau : on présente la cible, en tête
      // de la première consigne de Ferrostar.
      const premier = introFaite.current !== p.id;
      introFaite.current = p.id;
      const nom = rueSeule(p.name);
      intro.current = premier
        ? `Direction panneau ${indice + 1}${nom ? `, ${nom}` : ''}. `
        : raison === 'ecart'
          ? 'Itinéraire recalculé. '
          : null;
      derniereAnnonce.current = null;
      ecartDepuis.current = null;
      rejoint.current = false;

      const ancienne = m.core.navigationSession;
      setGuidage({ statut: 'ok', pour: p.id, route, arrivee: etapeArrivee(route.steps), partiel });
      m.core.startNavigation(route, reglages(mode));
      ancienne?.free();
      m.position.simuler(route);
      // Pas de consigne à dire tout de suite : l'intro seule.
      if (intro.current) {
        voix.dire(intro.current.trim());
        intro.current = null;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || ctrl.signal.aborted) return;
      if (e instanceof ErreurRelais && e.status === 422) {
        echecs.current = 0;
        setErreur(null);
        if (m.core.navigationSession) m.core.stopNavigation();
        if (e.corps?.statut === 'hors-couverture') {
          setGuidage({ statut: 'hors-couverture', pour: p.id, horsZone: e.corps.horsZone ?? [] });
          if (horsAnnonce.current !== p.id) {
            horsAnnonce.current = p.id;
            voix.dire('Ce trajet sort de la zone couverte par notre guidage. Ouvre-le dans Google Maps.');
          }
        } else {
          setGuidage({ statut: 'introuvable', pour: p.id });
        }
        return;
      }
      echecs.current++;
      if (e instanceof ErreurRelais) {
        setErreur(
          e.status === 401
            ? 'Ta session a expiré : reconnecte-toi.'
            : e.status === 429
              ? 'Beaucoup de recalculs : on patiente un peu.'
              : 'Calcul d’itinéraire indisponible pour l’instant.',
        );
      } else {
        console.warn('[navigation]', e);
        setErreur(navigator.onLine === false ? 'Pas de réseau : nouvel essai dans un instant.' : 'Calcul d’itinéraire indisponible pour l’instant.');
      }
    } finally {
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
      setCalcul(false);
    }
  }

  // Nouveau panneau visé : nouveau trajet, tout de suite.
  useEffect(() => {
    if (phase !== 'guidage') return;
    setGuidage((g) => (g && g.pour === panels[i]?.id ? g : null));
    setEnRoute(null);
    if (moteur.current?.position.lastLocation) calculer('depart');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, phase, moteurPret]);

  /* ─── Suivi Ferrostar : écart, voix, caméra ─── */

  const surEtatRef = useRef<(ts: TripState | null) => void>(() => undefined);
  surEtatRef.current = (ts) => {
    if (!ts || !('Navigating' in ts)) {
      setEnRoute(null);
      // Fin du dernier trajet : on est au bout, donc au panneau.
      if (ts && 'Complete' in ts && phaseRef.current === 'guidage') {
        const f = fixRef.current;
        if (panneau && f && distanceM([f.lat, f.lng], [panneau.lat, panneau.lng]) < RAYON_ARRIVEE[mode] * 2) arriver();
      }
      return;
    }
    const n = ts.Navigating;
    setEnRoute(n);
    const surLaRoute = n.deviation === 'NoDeviation';

    const loc = positionAffichee(n);
    placerMoi(loc.coordinates, loc.courseOverGround?.degrees ?? fixRef.current?.cap);

    // Écart au tracé : recalcul après quelques secondes franchement dehors
    // (Ferrostar ne juge l'écart que si le GPS est assez précis). Tant qu'on
    // n'a pas encore rejoint le tracé (départ d'un parc, d'une cour, d'un
    // parking), recalculer ne changerait rien : un pointillé y mène.
    if (surLaRoute) rejoint.current = true;
    const g = guidageRef.current;
    carte.current?.directVers(
      !rejoint.current && g?.statut === 'ok' ? n.userLocation.coordinates : null,
      g?.statut === 'ok' ? g.route.geometry[0] : null,
    );
    if (!surLaRoute && rejoint.current) {
      const t = Date.now();
      if (ecartDepuis.current == null) ecartDepuis.current = t;
      else if (t - ecartDepuis.current >= ECART_DUREE_MS) {
        ecartDepuis.current = null;
        calculer('ecart');
      }
    } else {
      ecartDepuis.current = null;
    }

    // Annonce vocale : Ferrostar choisit le moment, Valhalla a rédigé le texte.
    // Loin du tracé, la consigne n'a plus de sens : on se tait jusqu'au recalcul.
    const s = n.spokenInstruction;
    if (s && surLaRoute && s.utteranceId !== derniereAnnonce.current) {
      derniereAnnonce.current = s.utteranceId;
      voix.dire((intro.current ?? '') + nettoyerConsigne(s.text));
      intro.current = null;
    }
  };

  /* ─── Arrivée, signalement, enchaînement ─── */

  function arriver() {
    if (!panneau) return;
    setPhase('arrivee');
    ctrlRef.current?.abort();
    const m = moteur.current;
    if (m?.core.navigationSession) m.core.stopNavigation();
    m?.position.figer();
    voix.dire(`Panneau ${i + 1} : tu y es.`);
  }

  function suivant() {
    if (enchainement.current) clearTimeout(enchainement.current);
    enchainement.current = null;
    setASignaler(null);
    if (i + 1 < total) {
      setI(i + 1);
      setPhase('guidage');
    } else {
      terminer(true);
    }
  }

  function terminer(complete: boolean) {
    if (enchainement.current) clearTimeout(enchainement.current);
    ctrlRef.current?.abort();
    const m = moteur.current;
    if (m?.core.navigationSession) m.core.stopNavigation();
    m?.position.figer();
    setFin(Date.now());
    setPhase('fin');
    voix.dire(complete ? 'Tournée terminée. Bravo et merci !' : 'Tournée arrêtée.');
  }

  function noter(panelId: string, etat: Etat, r: { points: number; tournee: number } | null) {
    setResultats((cur) => {
      const avant = cur[panelId];
      return {
        ...cur,
        [panelId]: {
          etat,
          points: (avant?.points ?? 0) + (r?.points ?? 0),
          tournee: (avant?.tournee ?? 0) + (r?.tournee ?? 0),
        },
      };
    });
  }

  async function colle() {
    if (!panneau || envoi) return;
    setEnvoi(true);
    const p = panneau;
    const err = await envoyerSignalement(p.id, 'colle', undefined, onSignale, (r) => {
      noter(p.id, 'colle', r);
      montrer(r, true, 'Merci ! Panneau marqué collé.');
    });
    setEnvoi(false);
    if (err) {
      toast(err);
      return;
    }
    voix.dire(i + 1 < total ? 'Merci ! Panneau collé. On passe au suivant.' : 'Merci ! Panneau collé.');
    enchainement.current = setTimeout(suivant, ENCHAINER_MS);
  }

  function passer() {
    if (!panneau) return;
    setResultats((cur) => (cur[panneau.id] ? cur : { ...cur, [panneau.id]: { passe: true, points: 0, tournee: 0 } }));
    if (phase === 'guidage') {
      // Depuis le guidage, « Passer » saute ce panneau sans y être allé.
      voix.dire('Panneau passé.');
    }
    suivant();
  }

  /* ─── Position ─── */

  // Chaque position du GPS : lit toujours l'état du dernier rendu.
  const traiterRef = useRef<(f: Fix) => void>(() => undefined);
  traiterRef.current = (f: Fix) => {
    fixRef.current = f;
    setFix(f);
    setGeo('ok');
    setSignalPerdu(false);
    // Hors trajet suivi, la caméra suit la position brute ; sur un trajet,
    // c'est l'état Ferrostar (position recalée) qui la mène.
    if (!moteur.current?.core.navigationSession) placerMoi(f, f.cap);
    if (phaseRef.current !== 'guidage' || !panneau) return;
    const ici: Pt = [f.lat, f.lng];
    const d = distanceM(ici, [panneau.lat, panneau.lng]);

    // Premier trajet, ou nouvel essai après un échec / hors couverture.
    const g = guidageRef.current;
    const valide = g && g.pour === panneau.id;
    if (!valide) {
      calculer('reessai'); // sans effet si un calcul est déjà en cours
    } else if (g.statut !== 'ok') {
      const bouge = posDernierCalcul.current ? distanceM(ici, posDernierCalcul.current) : Infinity;
      if (bouge > REESSAI_DEPLACEMENT_M) calculer('reessai');
    } else if (erreur) {
      calculer('reessai');
    }

    // Reste jusqu'au panneau sur le tracé (état Ferrostar du dernier fix).
    let resteTrace = Infinity;
    const n = enRouteRef.current;
    if (valide && g.statut === 'ok' && n) {
      const courante = g.route.steps.length - n.remainingSteps.length;
      resteTrace = jusquAuPanneau(g.route.steps, g.arrivee, courante, n.progress.distanceToNextManeuver).metres;
    }

    // Arrivée : dans le rayon du panneau, ou au bout du tracé tout près.
    if (arriveeIgnoree.current === panneau.id) {
      if (d > RAYON_ARRIVEE[mode] * 2) arriveeIgnoree.current = null;
    } else if (f.precision <= 100 && (estArrive(d, mode) || (resteTrace < 10 && d < RAYON_ARRIVEE[mode] * 2))) {
      arriver();
    }
  };

  const recentrer = () => {
    setSuivre(true);
    const f = fixRef.current;
    if (!f || !carte.current) return;
    const n = enRouteRef.current;
    const loc = n ? positionAffichee(n).coordinates : f;
    carte.current.suivre(loc, capRetenu(n?.snappedUserLocation.courseOverGround?.degrees ?? f.cap, f.vitesse));
  };

  /* ─── Rendu ─── */

  if (phase === 'fin') {
    return (
      <Recapitulatif
        titre={titre}
        panels={panels}
        resultats={resultats}
        duree={(fin ?? Date.now()) - debut}
        complete={Object.keys(resultats).length >= total}
        onReprendre={() => {
          // Reprendre au premier panneau sans résultat.
          const k = panels.findIndex((p) => !resultats[p.id]);
          setFin(null);
          setI(k >= 0 ? k : 0);
          setPhase('guidage');
        }}
        onQuitter={onQuitter}
      />
    );
  }

  const g = guidage && guidage.pour === panneau?.id ? guidage : null;
  const routeOk = g?.statut === 'ok' ? g : null;
  const horsZone = g?.statut === 'hors-couverture' ? g : null;
  const introuvable = g?.statut === 'introuvable';
  const dVol = fix && panneau ? distanceM([fix.lat, fix.lng], [panneau.lat, panneau.lng]) : null;

  // Ce qui reste jusqu'au panneau, puis pour toute la tournée.
  let resteM: number | null = null;
  let resteS: number | null = null;
  let tourneeM: number | null = null;
  let tourneeS: number | null = null;
  let prochaine: { type: string; modifier?: string; texte: string; dist: number; suite: string | null } | null = null;
  if (routeOk && enRoute) {
    const etapes = routeOk.route.steps;
    const courante = etapes.length - enRoute.remainingSteps.length;
    const r = jusquAuPanneau(etapes, routeOk.arrivee, courante, enRoute.progress.distanceToNextManeuver);
    resteM = r.metres;
    resteS = r.secondes;
    tourneeM = enRoute.progress.distanceRemaining;
    tourneeS = enRoute.progress.durationRemaining;
    // La manœuvre qui vient est décrite par l'étape qui la suit (« Tournez à
    // gauche dans la rue X ») ; la flèche, par la consigne visuelle en cours.
    // Loin de la manœuvre (ou loin du tracé), Ferrostar n'a pas encore de
    // consigne visuelle « active » : on prend celle de l'étape.
    const vi = (enRoute.visualInstruction ?? enRoute.remainingSteps[0]?.visualInstructions[0])?.primaryContent;
    const apres = enRoute.remainingSteps[1];
    const ensuite = courante + 1 < routeOk.arrivee ? enRoute.remainingSteps[2] : undefined;
    prochaine = {
      type: courante >= routeOk.arrivee ? 'arrive' : (vi?.maneuverType ?? 'continue'),
      modifier: vi?.maneuverModifier,
      texte: sansPoint(apres?.instruction ?? enRoute.remainingSteps[0]?.instruction ?? ''),
      dist: Math.max(0, enRoute.progress.distanceToNextManeuver),
      suite: ensuite ? sansPoint(ensuite.instruction) : null,
    };
  } else if (dVol != null) {
    resteM = dVol;
  }
  const tourneeApprox = !routeOk || routeOk.partiel || !enRoute;
  if (tourneeM == null && resteM != null && total - i > 1) {
    // Sans trajet : la tournée à vol d'oiseau, panneau après panneau.
    tourneeM = panels.slice(i + 1).reduce((s, p, k) => s + distanceM([panels[i + k].lat, panels[i + k].lng], [p.lat, p.lng]), resteM);
  }

  const gmapsTrajet = panneau ? gmapsUrl([panneau], mode) : '#';
  const precisionFaible = fix && fix.precision > PRECISION_MAX_M;

  const alertes: { cle: string; texte: string; ton: 'alerte' | 'neutre' }[] = [];
  if (signalPerdu) alertes.push({ cle: 'signal', texte: 'Signal GPS perdu : position figée', ton: 'alerte' });
  else if (precisionFaible) alertes.push({ cle: 'precision', texte: `Précision faible (± ${Math.round(fix!.precision)} m)`, ton: 'alerte' });
  if (calcul && routeOk) alertes.push({ cle: 'calcul', texte: 'Recalcul de l’itinéraire…', ton: 'neutre' });
  if (erreur && routeOk) alertes.push({ cle: 'erreur', texte: erreur, ton: 'alerte' });
  if (carteKo) alertes.push({ cle: 'carte', texte: 'Carte indisponible sur ce téléphone : suis les consignes', ton: 'neutre' });
  if (moteur.current?.position.simulation) alertes.push({ cle: 'simu', texte: 'Simulation (développement)', ton: 'neutre' });
  if (ecran === 'non-supporte') alertes.push({ cle: 'ecran', texte: 'Écran : garde-le allumé toi-même (non géré ici)', ton: 'neutre' });
  else if (ecran === 'refuse') alertes.push({ cle: 'ecran', texte: 'L’écran peut se mettre en veille (économie d’énergie)', ton: 'neutre' });

  return (
    <div className="nav">
      <DiagBoussole mode={mode} vitesse={fix?.vitesse ?? null} gps={gpsPrime(fix?.vitesse)} position={diagPosition.current} precisionFix={fix?.precision ?? null} />
      <header className="nav-bandeau" aria-live="polite">
        <button type="button" className="nav-fermer" onClick={() => terminer(false)} aria-label="Arrêter la tournée">
          {IconFermer}
        </button>
        {moteurPret === 'echec' ? (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>Guidage indisponible</b>
              <span>Le guidage n’a pas pu se charger (réseau ?). Tu peux quand même valider chaque panneau.</span>
              <a className="nav-gmaps-fort" href={gmapsTrajet} target="_blank" rel="noopener">
                {IconGmaps}
                Ouvrir dans Google Maps
              </a>
            </div>
          </div>
        ) : geo === 'refus' ? (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>Localisation refusée</b>
              <span>Autorise-la dans les réglages du navigateur pour être guidé·e. Tu peux quand même valider chaque panneau.</span>
            </div>
          </div>
        ) : geo === 'indispo' && !fix ? (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>Position indisponible</b>
              <span>Ce téléphone ne donne pas sa position. Valide les panneaux à la main.</span>
            </div>
          </div>
        ) : !fix ? (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>{moteurPret === 'attente' ? 'Préparation du guidage…' : 'Recherche de ta position…'}</b>
              <span>Sors à découvert si ça dure.</span>
            </div>
          </div>
        ) : phase === 'arrivee' ? (
          <div className="nav-consigne">
            <span className="nav-fleche">
              <FlecheManoeuvre type="arrive" />
            </span>
            <div className="nav-consigne-txt">
              <b>Tu y es</b>
              <span>Panneau {i + 1} sur {total}</span>
            </div>
          </div>
        ) : horsZone ? (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>Hors de la zone guidée</b>
              <span>
                {horsZone.horsZone.includes(0) ? 'Tu es hors' : horsZone.horsZone.includes(1) ? 'Ce panneau est hors' : 'Ce trajet sort'} de
                la zone couverte par notre GPS : pas de consignes fiables pour ce trajet.
              </span>
              <a className="nav-gmaps-fort" href={gmapsTrajet} target="_blank" rel="noopener">
                {IconGmaps}
                Ouvrir ce trajet dans Google Maps
              </a>
            </div>
          </div>
        ) : introuvable ? (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>Pas d’itinéraire trouvé</b>
              <span>Aucun chemin {mode === 'walking' ? 'à pied' : mode === 'bicycling' ? 'à vélo' : 'en voiture'} jusqu’à ce panneau.</span>
              <a className="nav-gmaps-fort" href={gmapsTrajet} target="_blank" rel="noopener">
                {IconGmaps}
                Ouvrir dans Google Maps
              </a>
            </div>
          </div>
        ) : prochaine ? (
          <div className="nav-consigne">
            <span className="nav-fleche">
              <FlecheManoeuvre type={prochaine.type} modifier={prochaine.modifier} />
            </span>
            <div className="nav-consigne-txt">
              <span className="nav-dist">{distanceCourte(prochaine.dist)}</span>
              <b>{prochaine.texte}</b>
              {prochaine.suite && prochaine.type !== 'arrive' && <span className="nav-puis">Puis : {prochaine.suite}</span>}
            </div>
          </div>
        ) : (
          <div className="nav-consigne">
            <div className="nav-consigne-txt">
              <b>{erreur ?? 'Calcul de l’itinéraire…'}</b>
              {erreur && echecs.current >= ECHECS_SECOURS && (
                <a className="nav-gmaps-fort" href={gmapsTrajet} target="_blank" rel="noopener">
                  {IconGmaps}
                  Ouvrir dans Google Maps
                </a>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="nav-carte">
        <div ref={mapEl} className="nav-map" />
        {/* Mention exigée par OpenFreeMap (fond de carte) et par la licence
            ODbL d'OpenStreetMap (données) : une ligne discrète, sans lien
            ni bouton qui gênerait la lecture de la carte. */}
        {!carteKo && <p className="nav-credit">OpenFreeMap © OpenMapTiles · données © OpenStreetMap</p>}
        {alertes.length > 0 && (
          <div className="nav-alertes" role="status">
            {alertes.map((a) => (
              <span key={a.cle} className={'nav-alerte ' + a.ton}>
                {a.texte}
              </span>
            ))}
          </div>
        )}
        <div className="nav-boutons">
          {voix.supportee && (
            <button
              type="button"
              className={'rond' + (voix.active ? ' actif' : '')}
              onClick={voix.basculer}
              aria-pressed={voix.active}
              aria-label={voix.active ? 'Couper la voix' : 'Activer la voix'}
            >
              <IconVoix active={voix.active} />
            </button>
          )}
          {!suivre && fix && phase === 'guidage' && (
            <button type="button" className="rond" onClick={recentrer} aria-label="Recentrer sur ma position">
              {IconViser}
            </button>
          )}
        </div>
      </div>

      {panneau && phase === 'guidage' && (
        <section className="nav-pied">
          <div className="nav-cible-ligne">
            <span className="tournee-num">{i + 1}</span>
            <span className="nav-cible-txt">
              <span className="nav-cible-nom">{panneau.name || `Panneau ${i + 1}`}</span>
              <span className="nav-cible-meta">
                Panneau {i + 1} sur {total}
                {resteM != null && (
                  <>
                    {' · '}
                    <b>{distanceCourte(resteM)}</b>
                    {resteS != null ? ` · ${dureeCourte(resteS)}` : ' à vol d’oiseau'}
                  </>
                )}
              </span>
            </span>
          </div>
          {total - i > 1 && tourneeM != null && (
            <p className="nav-tournee">
              Toute la tournée : {tourneeApprox ? '≈ ' : ''}
              {distanceCourte(tourneeM)}
              {tourneeS != null && !tourneeApprox && ` · ${dureeCourte(tourneeS)} · fin vers ${heure(Date.now() + tourneeS * 1000)}`}
            </p>
          )}
          <div className="nav-gestes">
            <button type="button" className="nav-arrive" onClick={arriver}>
              Je suis au panneau
            </button>
            <button type="button" className="geste" onClick={passer}>
              Passer
            </button>
          </div>
        </section>
      )}

      {panneau && phase === 'arrivee' && (
        <section className="nav-pied nav-arrivee" aria-labelledby="nav-arrivee-titre">
          <div className="kicker">
            Panneau {i + 1} sur {total} · Arrivée
          </div>
          <h2 className="signal-titre" id="nav-arrivee-titre">
            {panneau.name || `Panneau ${i + 1}`}
          </h2>
          <LigneEtat courant={etats[panneau.id]} maintenant={maintenant} />
          {resultats[panneau.id]?.etat && resultats[panneau.id]?.etat !== 'colle' && (
            <p className="nav-note">
              Signalé : <b>{ETAT[resultats[panneau.id].etat!].libelle}</b>. Tu peux le coller maintenant, ou passer au suivant.
            </p>
          )}
          <button type="button" className="cta nav-colle" onClick={colle} disabled={envoi}>
            {IconCheck}
            {envoi ? 'Envoi…' : 'Collé'}
          </button>
          <div className="nav-etats" role="group" aria-label="Autre constat">
            {AUTRES_ETATS.map((e) => (
              <button key={e} type="button" className={`nav-etat etat-${e}`} onClick={() => setASignaler(e)}>
                <PastilleEtat etat={e} />
                {ETAT[e].libelle}
              </button>
            ))}
          </div>
          <div className="nav-arrivee-pied">
            <button
              type="button"
              className="lien-sobre"
              onClick={() => {
                arriveeIgnoree.current = panneau.id;
                setSuivre(true);
                setPhase('guidage');
              }}
            >
              Retour au guidage
            </button>
            <button type="button" className="geste nav-passer" onClick={resultats[panneau.id] ? suivant : passer}>
              {resultats[panneau.id] ? (i + 1 < total ? 'Suivant →' : 'Terminer') : 'Passer'}
            </button>
          </div>
        </section>
      )}

      {panneau && aSignaler && (
        <FeuilleSignalement
          panneau={{ id: panneau.id, name: panneau.name, num: i + 1 }}
          courant={etats[panneau.id]}
          maintenant={maintenant}
          initial={aSignaler}
          onSignale={onSignale}
          onRecompense={(r, etat) => {
            noter(panneau.id, etat, r);
            montrer(r, etat === 'colle', 'Merci, c’est noté.');
            if (etat === 'colle' || etat === 'absent') {
              // Rien d'autre à faire ici : on enchaîne.
              enchainement.current = setTimeout(suivant, ENCHAINER_MS);
            }
          }}
          onFermer={() => setASignaler(null)}
        />
      )}
      {recompenseEl ?? toastEl}
    </div>
  );
}

/* ─── Récapitulatif ──────────────────────────────────────────────────────── */

function Recapitulatif({
  titre,
  panels,
  resultats,
  duree,
  complete,
  onReprendre,
  onQuitter,
}: {
  titre: string;
  panels: Panel[];
  resultats: Record<string, Resultat>;
  duree: number;
  complete: boolean;
  onReprendre: () => void;
  onQuitter: () => void;
}) {
  const colles = panels.filter((p) => resultats[p.id]?.etat === 'colle').length;
  const points = Object.values(resultats).reduce((s, r) => s + r.points, 0);
  const bonus = Object.values(resultats).reduce((s, r) => s + r.tournee, 0);
  const minutes = Math.max(1, Math.round(duree / 60_000));
  const bonusPossible = BAREME.tournee.base + BAREME.tournee.parPanneau * panels.length;

  return (
    <div className="nav nav-fin">
      <div className="nav-fin-corps">
        <div className="kicker">{complete ? 'Tournée terminée' : 'Tournée arrêtée'}</div>
        <h1 className="detail-titre">{titre}</h1>

        <div className="stats">
          <div className="stat">
            <div className="stat-val">
              {colles}/{panels.length}
            </div>
            <div className="stat-lib">collés</div>
          </div>
          <div className="stat">
            <div className="stat-val">{minutes < 90 ? minutes : (minutes / 60).toFixed(1).replace('.', ',')}</div>
            <div className="stat-lib">{minutes < 90 ? 'minutes' : 'heures'}</div>
          </div>
          <div className="stat">
            <div className="stat-val">+{points}</div>
            <div className="stat-lib">points</div>
          </div>
        </div>

        {bonus > 0 ? (
          <p className="nav-bonus">
            <b>Tournée complète !</b> Dont +{bonus} points de bonus.
          </p>
        ) : (
          panels.length > 1 && (
            <p className="nav-regle prose">
              Bonus tournée complète : tous les panneaux marqués collés en moins de {FENETRE_TOURNEE_H} h,
              dont la moitié vraiment collés, +{bonusPossible} points.
            </p>
          )
        )}

        <ol className="nav-bilan">
          {panels.map((p, k) => {
            const r = resultats[p.id];
            return (
              <li key={p.id}>
                <span className={'frise-rond' + (r?.etat ? ` etat-${r.etat}` : '')}>{k + 1}</span>
                <span className="nav-bilan-txt">
                  <span className="frise-nom">{p.name || `Panneau ${k + 1}`}</span>
                  <span className="nav-bilan-etat">
                    {r?.etat ? ETAT[r.etat].libelle : r?.passe ? 'Passé' : 'Pas visité'}
                    {r && r.points > 0 && ` · +${r.points} pts`}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="nav-fin-actions">
          {!complete && (
            <button type="button" className="geste" onClick={onReprendre}>
              Reprendre la tournée
            </button>
          )}
          <button type="button" className="cta" onClick={onQuitter}>
            Retour à la tournée
          </button>
        </div>
      </div>
    </div>
  );
}
