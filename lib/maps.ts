// Construction des liens de navigation (utilisable côté client et serveur).

/** Nombre max de panneaux par itinéraire (limite Google Maps : 10 arrêts). */
export const MAX_PANELS = 10;

export type Mode = 'walking' | 'bicycling' | 'driving';
export type Coord = { lat: number; lng: number };

export function latlng(p: Coord): string {
  return `${p.lat},${p.lng}`;
}

/** Lien Google Maps : itinéraire multi-arrêts + lancement direct de la navigation. */
export function gmapsUrl(panels: Coord[], mode: Mode, fromHere: boolean): string {
  if (panels.length === 0) return '#';
  const enc = (s: string) => encodeURIComponent(s);
  const c = panels.map(latlng);
  let origin: string | undefined;
  let dest: string;
  let wp: string[];
  if (fromHere) {
    dest = c[c.length - 1];
    wp = c.slice(0, -1);
  } else {
    origin = c[0];
    dest = c[c.length - 1];
    wp = c.slice(1, -1);
  }
  let u = `https://www.google.com/maps/dir/?api=1&travelmode=${mode}`;
  if (origin) u += `&origin=${enc(origin)}`;
  u += `&destination=${enc(dest)}`;
  if (wp.length) u += `&waypoints=${wp.map(enc).join('%7C')}`;
  u += '&dir_action=navigate';
  return u;
}

/** Lien OpenStreetMap : itinéraire multi-arrêts (moteur OSRM selon le mode). */
export function osmUrl(panels: Coord[], mode: Mode): string {
  if (panels.length === 0) return '#';
  const eng =
    mode === 'walking'
      ? 'fossgis_osrm_foot'
      : mode === 'bicycling'
        ? 'fossgis_osrm_bike'
        : 'fossgis_osrm_car';
  return `https://www.openstreetmap.org/directions?engine=${eng}&route=${encodeURIComponent(
    panels.map(latlng).join(';'),
  )}`;
}

/** Lien de partage Telegram. */
export function telegramUrl(name: string, gUrl: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(gUrl)}&text=${encodeURIComponent(
    '🗺️ Itinéraire de collage : ' + name,
  )}`;
}

/** « Itinéraire de X à Y » -> « X → Y ». */
export function cleanName(n: string): string {
  return n.replace(/^Itin[ée]raire de\s+/i, '').replace(/\s+à\s+/, ' → ');
}
