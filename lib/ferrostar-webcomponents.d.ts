// Types de @stadiamaps/ferrostar-webcomponents, réduits à ce que l'appli utilise.
//
// Le paquet livre ses déclarations (dist/main.d.ts) mais son package.json ne
// les annonce pas dans « exports » : TypeScript ne les trouve pas. On redit
// ici, d'après ces déclarations (version 0.57), la partie dont on se sert.

declare module '@stadiamaps/ferrostar-webcomponents' {
  import type { NavigationSession, Route, RouteAdapter, TripState, UserLocation } from '@stadiamaps/ferrostar';

  /** Point de passage tel que l'attend getRoutes. */
  export type PointDePassage = { coordinate: { lat: number; lng: number }; kind: 'Break' | 'Via' };

  /** Cœur de navigation sans rendu (web component Lit). */
  export class FerrostarCore extends HTMLElement {
    valhallaEndpointUrl: string;
    profile: string;
    httpClient?: (url: URL, init: RequestInit) => Promise<Response>;
    locationProvider: unknown;
    options: object;
    onNavigationStart?: () => void;
    onNavigationStop?: () => void;
    onTripStateChange?: (newState: TripState | null) => void;
    useVoiceGuidance: boolean;
    routeAdapter: RouteAdapter | null;
    navigationSession: NavigationSession | null;
    getRoutes(initialLocation: UserLocation, waypoints: PointDePassage[]): Promise<Route[]>;
    startNavigation(route: Route, config: object): void;
    stopNavigation(): Promise<void>;
  }

  export class SimulatedLocationProvider {
    setSimulatedRoute(route: Route): void;
    stop(): void;
  }
  export class BrowserLocationProvider {
    start(): void;
    stop(): void;
  }
  export class FerrostarMap extends HTMLElement {}
}
