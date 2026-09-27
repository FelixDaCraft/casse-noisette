// Géométrie de base : distance à vol d'oiseau, utilisée comme secours quand OSRM
// ne répond pas (hors-ligne, serveur indisponible, coordonnées non routables).

export type Coord = { lat: number; lng: number };

const R = 6_371_000; // rayon terrestre moyen, en mètres

/** Distance orthodromique entre deux points, en mètres. */
export function haversine(a: Coord, b: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Matrice complète des distances à vol d'oiseau (symétrique). */
export function haversineMatrix(points: Coord[]): number[][] {
  return points.map((a) => points.map((b) => haversine(a, b)));
}
