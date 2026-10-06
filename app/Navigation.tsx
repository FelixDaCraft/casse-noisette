'use client';
// Mode « Tournée » : navigation guidée de panneau en panneau, sans quitter
// l'appli, et validation de chaque panneau sur place.
//
// Déroulé : la position est suivie en continu (watchPosition, haute
// précision) ; le trajet vers le PROCHAIN panneau est calculé par notre OSRM
// via /api/navigation ; le bandeau donne la prochaine manœuvre, la voix
// l'annonce ; si l'on s'écarte du tracé quelques secondes, on recalcule. À
// moins de ~40 m du panneau, la feuille d'arrivée propose « Collé » (la même
// action serveur que le bouton « J'ai collé » du détail), les autres constats
// et « Passer », puis on enchaîne sur le panneau suivant. À la fin, un
// récapitulatif : panneaux collés, temps passé, points gagnés.
//
// L'ordre des panneaux est figé au démarrage : c'est celui calculé depuis le
// point de départ du militant (useOptimizedOrder), on ne le rebat pas en route.

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { gmapsUrl, rueSeule, type Mode } from '@/lib/maps';
import { ETAT, ETATS, type Etat, type EtatCourant } from '@/lib/etatsPanneau';
import { BAREME, FENETRE_TOURNEE_H } from '@/lib/points';
import {
  annonce,
  annonceDue,
  avecSuite,
  distanceCourte,
  dureeCourte,
  estSilencieuse,
  PALIERS,
  type Palier,
} from '@/lib/consignes';
import {
  DetecteurEcart,
  ECART_SEUIL_M,
  distanceM,
  cap as capEntre,
  estArrive,
  prochaineEtape,
  projeter,
  restant,
  RAYON_ARRIVEE,
  RECALCUL_MIN_MS,
  PRECISION_MAX_M,
  type Projection,
  type Pt,
} from '@/lib/guidage';
import type { Trajet } from '@/lib/trajet';
import { useToast } from './admin/Toast';
import { useRecompense } from './Recompense';
import { FeuilleSignalement, LigneEtat, PastilleEtat, envoyerSignalement, type Etats } from './Signalement';
import { useWakeLock } from './useWakeLock';
import { useVoix } from './useVoix';

type Panel = { id: string; name: string; lat: number; lng: number };
type Fix = { lat: number; lng: number; precision: number; cap: number | null; t: number };
type Resultat = { etat?: Etat; passe?: boolean; points: number; tournee: number };
type Phase = 'guidage' | 'arrivee' | 'fin';
type TrajetPour = Trajet & { pour: string };

/** Sans nouvelle position depuis tant de secondes, on parle de signal perdu. */
const SIGNAL_PERDU_MS = 15_000;
/** Délai avant d'enchaîner sur le panneau suivant, le temps de voir les points. */
const ENCHAINER_MS = 1800;
/** Zoom de suivi selon le mode : plus large en voiture, on va plus vite. */
const ZOOM: Record<Mode, number> = { walking: 18, bicycling: 17, driving: 16 };
/** Hors couverture : on retente le calcul quand on a bougé d'autant. */
const REESSAI_DEPLACEMENT_M = 300;

const AUTRES_ETATS = ETATS.filter((e) => e !== 'colle');

const heure = (ms: number) =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

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
  const [trajet, setTrajet] = useState<TrajetPour | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [proj, setProj] = useState<Projection | null>(null);
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

  // Valeurs mutables lues par les rappels du GPS (enregistrés une fois).
  const fixRef = useRef<Fix | null>(null);
  const iRef = useRef(i);
  iRef.current = i;
  const segRef = useRef(0);
  const detecteur = useRef(new DetecteurEcart());
  const annonces = useRef(new Map<number, Palier>());
  const ctrlRef = useRef<AbortController | null>(null);
  const echecs = useRef(0);
  const dernierCalcul = useRef(0);
  const posDernierCalcul = useRef<Pt | null>(null);
  const arriveeIgnoree = useRef<string | null>(null);
  const horsAnnonce = useRef<string | null>(null);
  const introFaite = useRef<string | null>(null);
  const enchainement = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─── Carte ─── */
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const calques = useRef<{ bord: any; trace: any; direct: any; panneaux: any; moi: any; halo: any } | null>(null);
  const suivreRef = useRef(true);
  suivreRef.current = suivre;

  useEffect(() => {
    let annule = false;
    import('leaflet').then((mod) => {
      const L: any = (mod as any).default ?? mod;
      if (annule || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const p0 = panels[0];
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView(
        [p0?.lat ?? 47.218, p0?.lng ?? -1.553],
        ZOOM[mode],
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      // Un geste sur la carte suspend le suivi : on regarde ailleurs, la
      // carte ne doit pas nous ramener de force. « Recentrer » le relance.
      map.on('dragstart', () => setSuivre(false));
      calques.current = {
        bord: L.polyline([], { color: '#fffcf4', weight: 11, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map),
        trace: L.polyline([], { color: '#4C0297', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map),
        direct: L.polyline([], { color: '#4C0297', weight: 4, opacity: 0.8, dashArray: '2 9', lineCap: 'round' }).addTo(map),
        panneaux: L.layerGroup().addTo(map),
        halo: L.circle([0, 0], { radius: 0, color: '#d1271c', weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }),
        moi: L.marker([0, 0], {
          icon: L.divIcon({
            className: '',
            html: '<div class="nav-moi sans-cap"><span class="nav-moi-fleche"></span></div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          }),
          interactive: false,
          zIndexOffset: 1000,
        }),
      };
      mapRef.current = map;
      dessinerPanneaux();
      dessinerTrajet();
      if (fixRef.current) placerMoi(fixRef.current, true);
    });
    return () => {
      annule = true;
      mapRef.current?.remove();
      mapRef.current = null;
      calques.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dessinerPanneaux() {
    const L = LRef.current;
    const c = calques.current;
    if (!L || !c) return;
    c.panneaux.clearLayers();
    panels.forEach((p, k) => {
      const r = resultats[p.id];
      const e = r?.etat ?? etats[p.id]?.etat;
      const classes = ['cn-marker'];
      if (e) classes.push(`etat-${e}`);
      if (k === i && phase !== 'fin') classes.push('nav-cible');
      else if (k < i || r) classes.push('nav-fait');
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="${classes.join(' ')}">${k + 1}</div>`,
          iconSize: k === i ? [40, 40] : [30, 30],
          iconAnchor: k === i ? [20, 20] : [15, 15],
        }),
        interactive: false,
        zIndexOffset: k === i ? 500 : 0,
      }).addTo(c.panneaux);
    });
  }

  function dessinerTrajet() {
    const c = calques.current;
    if (!c) return;
    const f = fixRef.current;
    if (trajet?.statut === 'ok' && trajet.pour === panneau?.id) {
      c.bord.setLatLngs(trajet.ligne);
      c.trace.setLatLngs(trajet.ligne);
      c.direct.setLatLngs([]);
    } else {
      c.bord.setLatLngs([]);
      c.trace.setLatLngs([]);
      // Sans tracé fiable (hors couverture, calcul en cours) : la direction à
      // vol d'oiseau, en pointillés, pour ne pas laisser la carte muette.
      c.direct.setLatLngs(f && panneau && phase === 'guidage' ? [[f.lat, f.lng], [panneau.lat, panneau.lng]] : []);
    }
  }

  function placerMoi(f: Fix, centrer: boolean) {
    const c = calques.current;
    const map = mapRef.current;
    if (!c || !map) return;
    c.moi.setLatLng([f.lat, f.lng]);
    c.halo.setLatLng([f.lat, f.lng]).setRadius(f.precision);
    if (!map.hasLayer(c.moi)) {
      c.halo.addTo(map);
      c.moi.addTo(map);
    }
    const el: HTMLElement | null = c.moi.getElement?.()?.querySelector('.nav-moi') ?? null;
    if (el) {
      el.classList.toggle('sans-cap', f.cap == null);
      if (f.cap != null) el.style.setProperty('--cap', `${Math.round(f.cap)}deg`);
    }
    if (centrer) map.setView([f.lat, f.lng], Math.max(map.getZoom(), ZOOM[mode] - 1), { animate: true });
  }

  useEffect(() => {
    dessinerPanneaux();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, resultats, etats, phase]);
  useEffect(() => {
    dessinerTrajet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajet, i, phase, fix]);

  /* ─── Itinéraire ─── */

  async function calculer(raison: 'depart' | 'ecart' | 'reessai') {
    const f = fixRef.current;
    const p = panels[iRef.current];
    if (!f || !p) return;
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
    posDernierCalcul.current = [f.lat, f.lng];
    const indice = iRef.current;
    setCalcul(true);
    try {
      const r = await fetch('/api/navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          points: [{ lat: f.lat, lng: f.lng }, ...panels.slice(indice).map((q) => ({ lat: q.lat, lng: q.lng }))],
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        echecs.current++;
        setErreur(
          r.status === 401
            ? 'Ta session a expiré : reconnecte-toi.'
            : r.status === 429
              ? 'Beaucoup de recalculs : on patiente un peu.'
              : 'Calcul d’itinéraire indisponible pour l’instant.',
        );
        return;
      }
      const t = (await r.json()) as Trajet;
      if (iRef.current !== indice) return; // on est passé au panneau suivant entre-temps
      echecs.current = 0;
      setErreur(null);
      setTrajet({ ...t, pour: p.id });
      segRef.current = 0;
      detecteur.current.reinitialiser();
      annonces.current.clear();

      // Premier trajet obtenu pour ce panneau : on présente la cible.
      const premier = introFaite.current !== p.id;
      if (t.statut === 'ok') introFaite.current = p.id;
      if (t.statut === 'ok' && (premier || raison === 'ecart')) {
        const nom = rueSeule(p.name);
        let txt = premier ? `Direction panneau ${indice + 1}${nom ? `, ${nom}` : ''}. ` : 'Itinéraire recalculé. ';
        txt += t.etapes[0]?.texte ?? '';
        // La manœuvre suivante est déjà proche : on l'annonce dans la foulée
        // (sinon elle couperait la phrase en cours).
        const e1 = t.etapes[1];
        if (e1 && e1.type !== 'arrive' && e1.debut <= PALIERS[mode].loin) {
          txt += '. ' + annonce(e1.texte, e1.debut);
          annonces.current.set(1, e1.debut <= PALIERS[mode].proche ? 'proche' : 'loin');
        }
        voix.dire(txt);
      } else if (t.statut === 'hors-couverture' && horsAnnonce.current !== p.id) {
        horsAnnonce.current = p.id;
        voix.dire('Ce trajet sort de la zone couverte par notre guidage. Ouvre-le dans Google Maps.');
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      echecs.current++;
      setErreur('Pas de réseau : nouvel essai dans un instant.');
    } finally {
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
      setCalcul(false);
    }
  }

  // Nouveau panneau visé : nouveau trajet, tout de suite.
  useEffect(() => {
    if (phase !== 'guidage') return;
    setTrajet((t) => (t && t.pour === panels[i]?.id ? t : null));
    setProj(null);
    if (fixRef.current) calculer('depart');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, phase]);

  /* ─── Arrivée, signalement, enchaînement ─── */

  function arriver() {
    if (!panneau) return;
    setPhase('arrivee');
    ctrlRef.current?.abort();
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

  useEffect(
    () => () => {
      if (enchainement.current) clearTimeout(enchainement.current);
      ctrlRef.current?.abort();
    },
    [],
  );

  /* ─── Position ─── */

  // Traitement de chaque position : lit toujours l'état du dernier rendu.
  const traiterRef = useRef<(f: Fix) => void>(() => undefined);
  traiterRef.current = (f: Fix) => {
    placerMoi(f, suivreRef.current);
    if (phase !== 'guidage' || !panneau) return;
    const ici: Pt = [f.lat, f.lng];
    const d = distanceM(ici, [panneau.lat, panneau.lng]);

    // Premier trajet, ou nouvel essai après un échec / hors couverture.
    const trajetValide = trajet && trajet.pour === panneau.id;
    if (!trajetValide) {
      calculer('reessai'); // sans effet si un calcul est déjà en cours
    } else if (trajet.statut !== 'ok') {
      const bouge = posDernierCalcul.current ? distanceM(ici, posDernierCalcul.current) : Infinity;
      if (bouge > REESSAI_DEPLACEMENT_M) calculer('reessai');
    } else if (erreur) {
      calculer('reessai');
    }

    let restantPanneau = Infinity;
    if (trajetValide && trajet.statut === 'ok') {
      const p = projeter(ici, trajet.ligne, trajet.cum, segRef.current);
      segRef.current = p.segment;
      setProj(p);
      restantPanneau = restant(p, trajet.cum, trajet.cumTemps).metres;

      // Écart au tracé : recalcul après quelques secondes franchement dehors.
      if (detecteur.current.observer(p.ecart, f.precision, f.t)) calculer('ecart');

      // Annonces vocales de la prochaine manœuvre.
      const debuts = trajet.etapes.map((e) => e.debut);
      const k = prochaineEtape(debuts, p.parcouru);
      const etape = trajet.etapes[k];
      // Loin du tracé, la « prochaine manœuvre » n'a plus de sens : on se tait
      // jusqu'au recalcul.
      if (etape && k > 0 && p.ecart <= ECART_SEUIL_M) {
        const dist = etape.debut - p.parcouru;
        const longueur = etape.debut - (trajet.etapes[k - 1]?.debut ?? 0);
        const due = estSilencieuse(etape.type, etape.modifier)
          ? null
          : annonceDue(mode, dist, annonces.current.get(k) ?? null, longueur);
        if (due) {
          annonces.current.set(k, due);
          const apres = trajet.etapes[k + 1];
          const suite =
            apres && apres.type !== 'arrive' && apres.debut - etape.debut < PALIERS[mode].proche * 1.5 ? apres.texte : null;
          // La manœuvre enchaînée vient d'être dite : pas d'annonce « loin » en plus.
          if (suite && !annonces.current.has(k + 1)) annonces.current.set(k + 1, 'loin');
          const texte = avecSuite(etape.texte, suite);
          voix.dire(due === 'loin' ? annonce(texte, dist) : texte);
        }
      }
    }

    // Arrivée : dans le rayon du panneau, ou au bout du tracé tout près.
    if (arriveeIgnoree.current === panneau.id) {
      if (d > RAYON_ARRIVEE[mode] * 2) arriveeIgnoree.current = null;
    } else if (f.precision <= 100 && (estArrive(d, mode) || (restantPanneau < 10 && d < RAYON_ARRIVEE[mode] * 2))) {
      arriver();
    }
  };

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('indispo');
      return;
    }
    let precedent: Fix | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const t = pos.timestamp || Date.now();
        // Cap : celui du GPS quand on avance, sinon déduit des deux dernières
        // positions (au moins 4 m d'écart, en dessous c'est du bruit).
        let cap: number | null = null;
        if (c.heading != null && Number.isFinite(c.heading) && (c.speed ?? 0) > 0.5) cap = c.heading;
        else if (precedent) {
          const dep = distanceM([precedent.lat, precedent.lng], [c.latitude, c.longitude]);
          cap = dep >= 4 ? capEntre([precedent.lat, precedent.lng], [c.latitude, c.longitude]) : precedent.cap;
        }
        const f: Fix = { lat: c.latitude, lng: c.longitude, precision: c.accuracy, cap, t };
        if (!precedent || distanceM([precedent.lat, precedent.lng], [f.lat, f.lng]) >= 4 || cap !== precedent.cap) {
          precedent = f;
        }
        fixRef.current = f;
        setFix(f);
        setGeo('ok');
        setSignalPerdu(false);
        traiterRef.current(f);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGeo('refus');
        else if (err.code === err.POSITION_UNAVAILABLE) setGeo((g) => (g === 'ok' ? g : 'indispo'));
        // TIMEOUT : on continue d'écouter, la veille « signal perdu » prend le relais.
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 },
    );
    const veille = setInterval(() => {
      const f = fixRef.current;
      setSignalPerdu(!!f && Date.now() - f.t > SIGNAL_PERDU_MS);
    }, 3000);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(veille);
    };
  }, []);

  const recentrer = () => {
    setSuivre(true);
    const f = fixRef.current;
    const map = mapRef.current;
    if (f && map) map.setView([f.lat, f.lng], ZOOM[mode], { animate: true });
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

  const trajetOk = trajet && trajet.pour === panneau?.id && trajet.statut === 'ok' ? trajet : null;
  const horsZone = trajet && trajet.pour === panneau?.id && trajet.statut === 'hors-couverture' ? trajet : null;
  const introuvable = trajet && trajet.pour === panneau?.id && trajet.statut === 'introuvable';
  const dVol = fix && panneau ? distanceM([fix.lat, fix.lng], [panneau.lat, panneau.lng]) : null;

  // Ce qui reste jusqu'au panneau, puis pour toute la tournée.
  let resteM: number | null = null;
  let resteS: number | null = null;
  let prochaine: { type: string; modifier?: string; texte: string; dist: number; suite: string | null } | null = null;
  if (trajetOk) {
    const p = proj ?? { ecart: 0, segment: 0, t: 0, parcouru: 0 };
    const r = restant(p, trajetOk.cum, trajetOk.cumTemps);
    resteM = r.metres;
    resteS = r.secondes;
    const k = prochaineEtape(trajetOk.etapes.map((e) => e.debut), p.parcouru);
    const e = trajetOk.etapes[k];
    if (e) {
      const apres = trajetOk.etapes[k + 1];
      prochaine = {
        type: e.type,
        modifier: e.modifier,
        texte: e.texte,
        dist: Math.max(0, e.debut - p.parcouru),
        suite: apres ? apres.texte : null,
      };
    }
  } else if (dVol != null) {
    resteM = dVol;
  }
  const suite = (trajet && trajet.pour === panneau?.id && trajet.statut !== 'introuvable' ? trajet.suite : []) ?? [];
  const tourneeM = resteM != null ? resteM + suite.reduce((s, j) => s + j.metres, 0) : null;
  const tourneeS = resteS != null ? resteS + suite.reduce((s, j) => s + j.secondes, 0) : null;
  const tourneeApprox = suite.some((j) => j.horsCouverture) || !trajetOk;

  const gmapsTrajet = panneau ? gmapsUrl([panneau], mode) : '#';
  const precisionFaible = fix && fix.precision > PRECISION_MAX_M;

  const alertes: { cle: string; texte: string; ton: 'alerte' | 'neutre' }[] = [];
  if (signalPerdu) alertes.push({ cle: 'signal', texte: 'Signal GPS perdu : position figée', ton: 'alerte' });
  else if (precisionFaible) alertes.push({ cle: 'precision', texte: `Précision faible (± ${Math.round(fix!.precision)} m)`, ton: 'alerte' });
  if (calcul && trajetOk) alertes.push({ cle: 'calcul', texte: 'Recalcul de l’itinéraire…', ton: 'neutre' });
  if (erreur && trajetOk) alertes.push({ cle: 'erreur', texte: erreur, ton: 'alerte' });
  if (ecran === 'non-supporte') alertes.push({ cle: 'ecran', texte: 'Écran : garde-le allumé toi-même (non géré ici)', ton: 'neutre' });
  else if (ecran === 'refuse') alertes.push({ cle: 'ecran', texte: 'L’écran peut se mettre en veille (économie d’énergie)', ton: 'neutre' });

  return (
    <div className="nav">
      <header className="nav-bandeau" aria-live="polite">
        <button type="button" className="nav-fermer" onClick={() => terminer(false)} aria-label="Arrêter la tournée">
          {IconFermer}
        </button>
        {geo === 'refus' ? (
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
              <b>Recherche de ta position…</b>
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
                {horsZone.horsZone.includes(0) ? 'Tu es' : 'Ce panneau est'} hors de la zone couverte par notre GPS
                (Loire-Atlantique) : pas de consignes fiables pour ce trajet.
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
              {erreur && (
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
          {!suivre && fix && (
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
          {total > 1 && tourneeM != null && (
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
          <a className="nav-gmaps" href={gmapsTrajet} target="_blank" rel="noopener">
            {IconGmaps}
            Ouvrir ce trajet dans Google Maps
          </a>
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
