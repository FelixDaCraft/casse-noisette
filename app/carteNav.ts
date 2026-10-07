'use client';
// Carte du mode « Tournée » : MapLibre GL JS, fond vectoriel OpenFreeMap.
//
// Comme un GPS : la carte tourne dans le sens de la marche, s'incline, et
// garde le militant dans le tiers bas de l'écran pour montrer ce qui vient.
// Le tracé et les marqueurs reprennent la charte (violet bordé de crème,
// panneaux numérotés, point rouge pour « moi »). Le tracé passe sous les noms
// de rues pour qu'ils restent lisibles.
//
// OpenFreeMap : gratuit, sans clé ni compte (https://openfreemap.org), données
// OpenStreetMap. Pas de contrôle d'attribution MapLibre (bouton « i » et
// cartouche dépliée par-dessus la carte) : la mention obligatoire est une
// petite ligne de texte posée par l'écran (Navigation.tsx, .nav-credit).

import type { GeoJSONSource, Map as CarteML, Marker } from 'maplibre-gl';
import type { Mode } from '@/lib/maps';

type MapLibre = typeof import('maplibre-gl');

export const STYLE_CARTE = 'https://tiles.openfreemap.org/styles/liberty';

/** Zoom de suivi selon le mode : plus large en voiture, on va plus vite. */
const ZOOM: Record<Mode, number> = { walking: 17.5, bicycling: 16.5, driving: 16 };
const INCLINAISON = 50;

const mouvementReduit = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const VIOLET = '#4c0297';
const CREME = '#fffcf4';

export type MarqueurPanneau = { lat: number; lng: number; num: number; classes: string; cible: boolean };

const ligne = (coords: [number, number][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: coords },
});

export class CarteNav {
  readonly map: CarteML;
  private ml: MapLibre;
  private mode: Mode;
  private pret = false;
  private trace: [number, number][] = [];
  private direct: [number, number][] = [];
  private moi: Marker | null = null;
  private panneaux: Marker[] = [];

  constructor(ml: MapLibre, el: HTMLElement, centre: { lat: number; lng: number }, mode: Mode, surGeste: () => void) {
    this.ml = ml;
    this.mode = mode;
    this.map = new ml.Map({
      container: el,
      style: STYLE_CARTE,
      center: [centre.lng, centre.lat],
      zoom: ZOOM[mode] - 1,
      pitch: 0,
      attributionControl: false,
      fadeDuration: 0,
    });
    // Un geste sur la carte suspend le suivi : on regarde ailleurs, la carte
    // ne doit pas nous ramener de force. « Recentrer » le relance. Les
    // mouvements de caméra lancés par le code n'ont pas d'originalEvent.
    const geste = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) surGeste();
    };
    this.map.on('dragstart', geste);
    this.map.on('rotatestart', geste);
    this.map.on('pitchstart', geste);
    this.map.on('zoomstart', geste);
    // Le style Liberty cite quelques icônes absentes de son sprite (portail,
    // borne…) : une image vide à la place, plutôt qu'un avertissement par icône.
    this.map.on('styleimagemissing', (e: { id: string }) => {
      if (!this.map.hasImage(e.id)) this.map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    this.map.on('load', () => {
      this.pret = true;
      this.ajouterCalques();
    });
  }

  private ajouterCalques() {
    const m = this.map;
    // Sous la première couche de texte : les noms de rues restent au-dessus.
    const avant = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addSource('trajet', { type: 'geojson', data: ligne(this.trace) });
    m.addSource('direct', { type: 'geojson', data: ligne(this.direct) });
    const largeur = (base: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 12, base * 0.45, 16, base, 19, base * 2.2] as any;
    m.addLayer(
      {
        id: 'trajet-bord',
        type: 'line',
        source: 'trajet',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': CREME, 'line-width': largeur(12) },
      },
      avant,
    );
    m.addLayer(
      {
        id: 'trajet',
        type: 'line',
        source: 'trajet',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': VIOLET, 'line-width': largeur(7) },
      },
      avant,
    );
    m.addLayer(
      {
        id: 'direct',
        type: 'line',
        source: 'direct',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': VIOLET, 'line-width': 4, 'line-opacity': 0.8, 'line-dasharray': [0.5, 2.5] },
      },
      avant,
    );
  }

  private maj(source: 'trajet' | 'direct', coords: [number, number][]) {
    if (!this.pret) return;
    (this.map.getSource(source) as GeoJSONSource | undefined)?.setData(ligne(coords));
  }

  /** Tracé de l'itinéraire (null : aucun). */
  tracer(geometrie: { lat: number; lng: number }[] | null) {
    this.trace = (geometrie ?? []).map((c) => [c.lng, c.lat]);
    this.maj('trajet', this.trace);
  }

  /** Sans tracé fiable (hors couverture, calcul en cours) : la direction à vol
   *  d'oiseau, en pointillés, pour ne pas laisser la carte muette. */
  directVers(de: { lat: number; lng: number } | null, vers: { lat: number; lng: number } | null) {
    this.direct = de && vers ? [[de.lng, de.lat], [vers.lng, vers.lat]] : [];
    this.maj('direct', this.direct);
  }

  /** Marqueurs des panneaux, numérotés, couleur de leur état. */
  placerPanneaux(liste: MarqueurPanneau[]) {
    this.panneaux.forEach((m) => m.remove());
    // Le panneau visé passe au-dessus des autres : ajouté en dernier.
    const ordre = [...liste].sort((a, b) => Number(a.cible) - Number(b.cible));
    this.panneaux = ordre.map((p) => {
      const el = document.createElement('div');
      el.className = p.classes;
      el.textContent = String(p.num);
      return new this.ml.Marker({ element: el, anchor: 'center', pitchAlignment: 'viewport' })
        .setLngLat([p.lng, p.lat])
        .addTo(this.map);
    });
  }

  /** Point rouge de la charte, flèche dans le sens de la marche. */
  placerMoi(pos: { lat: number; lng: number }, cap: number | null) {
    if (!this.moi) {
      const el = document.createElement('div');
      el.className = 'nav-moi sans-cap';
      el.innerHTML = '<span class="nav-moi-fleche"></span>';
      this.moi = new this.ml.Marker({ element: el, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' });
      this.moi.setLngLat([pos.lng, pos.lat]).addTo(this.map);
    }
    this.moi.setLngLat([pos.lng, pos.lat]);
    const el = this.moi.getElement();
    el.classList.toggle('sans-cap', cap == null);
    if (cap != null) this.moi.setRotation(cap);
  }

  /** Boussole : la flèche tourne sur place, sans nouvelle position. */
  orienterMoi(cap: number) {
    if (!this.moi) return;
    this.moi.getElement().classList.remove('sans-cap');
    this.moi.setRotation(cap);
  }

  /** Où la caméra de suivi doit être : position et cap visés. */
  private cible: { pos: { lat: number; lng: number }; cap: number | null } | null = null;

  /** Caméra de navigation : centrée sur nous, orientée, inclinée. */
  suivre(pos: { lat: number; lng: number }, cap: number | null) {
    this.cible = { pos, cap: cap ?? this.cible?.cap ?? null };
    this.animer(900);
  }

  private animer(duree: number) {
    const c = this.cible;
    if (!c) return;
    const h = this.map.getContainer().clientHeight;
    this.map.easeTo({
      center: [c.pos.lng, c.pos.lat],
      zoom: ZOOM[this.mode],
      pitch: INCLINAISON,
      bearing: c.cap ?? this.map.getBearing(),
      // Nous dans le tiers bas : la route devant prend l'écran.
      padding: { top: Math.round(h * 0.4), bottom: 0, left: 0, right: 0 },
      duration: mouvementReduit() ? 0 : duree,
      easing: (t) => t,
    });
  }


  /** Vue à plat, nord en haut, sur ces points (arrivée, recentrage sans cap). */
  cadrer(points: { lat: number; lng: number }[]) {
    if (!points.length) return;
    const b = new this.ml.LngLatBounds();
    points.forEach((p) => b.extend([p.lng, p.lat]));
    this.map.fitBounds(b, {
      padding: 70,
      maxZoom: ZOOM[this.mode],
      pitch: 0,
      bearing: 0,
      duration: mouvementReduit() ? 0 : 700,
    });
  }

  detruire() {
    this.panneaux.forEach((m) => m.remove());
    this.moi?.remove();
    this.map.remove();
  }
}
