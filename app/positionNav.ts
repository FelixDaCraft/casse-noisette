'use client';
// Position du militant pendant le mode « Tournée ».
//
// Un « location provider » au sens de Ferrostar (start/stop, lastLocation,
// getCurrentLocation, updateCallback) : FerrostarCore s'y branche pour suivre
// le tracé. On n'utilise pas le BrowserLocationProvider fourni : il affiche
// une alert() à la moindre erreur de GPS et annonce un cap nord (0°) quand
// le téléphone n'en donne pas, ce qui oriente la carte et le départ de
// travers. Ici les erreurs remontent à l'écran (refus, position
// indisponible), le cap est déduit des déplacements quand le GPS se tait, et
// l'écran reçoit chaque position même quand aucun trajet n'est suivi
// (arrivée, hors couverture).
//
// En développement, `?simulation=1` dans l'URL remplace le GPS par la
// simulation de Ferrostar (locationSimulationFromRoute), qui parcourt le
// trajet calculé : de quoi tester une tournée entière depuis son bureau. On
// n'utilise pas son SimulatedLocationProvider : arrêté pendant son attente,
// il plante (« unreachable ») et ne redémarre plus (Ferrostar 0.57).

import type { Route, UserLocation } from '@stadiamaps/ferrostar';
import { cap as capEntre, distanceM } from '@/lib/guidage';

/** Ce qu'on prend du module @stadiamaps/ferrostar pour simuler un trajet. */
export type Simulateur = {
  locationSimulationFromRoute: (route: Route, resample: number, bias: 'None') => unknown;
  advanceLocationSimulation: (etat: unknown) => unknown;
};

/** Pas de la simulation : 10 m toutes les 0,7 s, un bon pas de vélo. */
const SIMU_PAS_M = 10;
const SIMU_TIC_MS = 700;

export type Fix = { lat: number; lng: number; precision: number; cap: number | null; vitesse: number | null; t: number };
export type ErreurPosition = 'refus' | 'indispo';

/** Position au format attendu par Ferrostar (UserLocation). */
function versFerrostar(f: Fix): UserLocation {
  return {
    coordinates: { lat: f.lat, lng: f.lng },
    horizontalAccuracy: f.precision,
    courseOverGround: f.cap != null ? { degrees: Math.round(f.cap) % 360, accuracy: undefined } : undefined,
    // Ferrostar accepte des millisecondes, comme son propre fournisseur.
    timestamp: f.t as unknown as UserLocation['timestamp'],
    speed: f.vitesse != null ? { value: f.vitesse, accuracy: undefined } : undefined,
  };
}

export class PositionNav {
  /** Dernière position, au format Ferrostar. */
  lastLocation: UserLocation | null = null;
  lastHeading: number | null = null;
  /** Abonné unique de Ferrostar (FerrostarCore.onLocationUpdated). */
  updateCallback: (() => void) | null = null;

  private watchId: number | null = null;
  private precedent: Fix | null = null;
  private etatSimu: unknown = null;
  private minuteur: ReturnType<typeof setInterval> | null = null;

  constructor(
    private surPosition: (f: Fix) => void,
    private surErreur: (e: ErreurPosition) => void,
    /** Fonctions de simulation de Ferrostar (développement seulement). */
    private simu: Simulateur | null = null,
  ) {}

  get simulation(): boolean {
    return !!this.simu;
  }

  /** Démarre le suivi (idempotent : Ferrostar le rappelle à chaque trajet). */
  start(): void {
    if (this.simu) {
      // Point de départ : la vraie position si on l'a (géolocalisation
      // émulée dans les outils du navigateur), sinon l'écran en fournit une.
      if (!this.lastLocation && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => !this.lastLocation && this.recevoir(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, null, null),
          () => undefined,
          { timeout: 3000 },
        );
      }
      return;
    }
    if (this.watchId != null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.surErreur('indispo');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        // Cap du GPS seulement quand on avance : à l'arrêt il est faux ou absent.
        const capGps = c.heading != null && Number.isFinite(c.heading) && (c.speed ?? 0) > 0.5 ? c.heading : null;
        this.recevoir(c.latitude, c.longitude, c.accuracy, capGps, c.speed ?? null, pos.timestamp || Date.now());
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) this.surErreur('refus');
        else if (err.code === err.POSITION_UNAVAILABLE) this.surErreur('indispo');
        // TIMEOUT : on continue d'écouter, la veille « signal perdu » de l'écran prend le relais.
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 },
    );
  }

  stop(): void {
    if (this.watchId != null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
    if (this.minuteur) clearInterval(this.minuteur);
    this.minuteur = null;
    this.etatSimu = null;
  }

  /** Simulation : parcourt ce trajet (le trajet suivant remplace le précédent). */
  simuler(route: Route): void {
    const simu = this.simu;
    if (!simu) return;
    this.etatSimu = simu.locationSimulationFromRoute(route, SIMU_PAS_M, 'None');
    this.minuteur ??= setInterval(() => {
      if (!this.etatSimu) return;
      this.etatSimu = simu.advanceLocationSimulation(this.etatSimu);
      const l = (this.etatSimu as { current_location: UserLocation }).current_location;
      this.recevoir(l.coordinates.lat, l.coordinates.lng, 5, l.courseOverGround?.degrees ?? null, l.speed?.value ?? null);
    }, SIMU_TIC_MS);
  }

  /** Simulation : on s'arrête là (arrivée au panneau), jusqu'au trajet suivant. */
  figer(): void {
    this.etatSimu = null;
  }

  /** Simulation : position de départ imposée par l'écran. */
  placer(lat: number, lng: number): void {
    this.recevoir(lat, lng, 5, null, null);
  }

  async getCurrentLocation(staleMs: number): Promise<UserLocation> {
    const l = this.lastLocation;
    if (l && Date.now() - (l.timestamp as unknown as number) <= staleMs) return l;
    if (this.simu && l) return l;
    return new Promise((ok, ko) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return ko(new Error('géolocalisation absente'));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.recevoir(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, null, pos.coords.speed ?? null);
          ok(this.lastLocation!);
        },
        ko,
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5000 },
      );
    });
  }

  private recevoir(lat: number, lng: number, precision: number, capGps: number | null, vitesse: number | null, t = Date.now()) {
    const p = this.precedent;
    // Sans cap du GPS, on le déduit des deux dernières positions (au moins
    // 4 m d'écart, en dessous c'est du bruit) ; sinon on garde le précédent.
    let cap = capGps;
    if (cap == null && p) {
      const dep = distanceM([p.lat, p.lng], [lat, lng]);
      cap = dep >= 4 ? capEntre([p.lat, p.lng], [lat, lng]) : p.cap;
    }
    const f: Fix = { lat, lng, precision, cap, vitesse, t };
    if (!p || distanceM([p.lat, p.lng], [lat, lng]) >= 4 || cap !== p.cap) this.precedent = f;
    this.lastLocation = versFerrostar(f);
    this.lastHeading = cap;
    this.surPosition(f);
    this.updateCallback?.();
  }
}
