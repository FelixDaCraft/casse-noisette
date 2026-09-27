// Construction des liens de navigation (utilisable côté client et serveur).

/** Nombre max de panneaux par itinéraire (limite Google Maps : 10 arrêts). */
export const MAX_PANELS = 10;

export type Mode = 'walking' | 'bicycling' | 'driving';
export type Coord = { lat: number; lng: number };

export function latlng(p: Coord): string {
  return `${p.lat},${p.lng}`;
}

/**
 * Lien Google Maps : itinéraire multi-arrêts + lancement direct de la navigation.
 * Part TOUJOURS de la position GPS de l'utilisateur (pas d'`origin` -> position actuelle).
 */
export function gmapsUrl(panels: Coord[], mode: Mode): string {
  if (panels.length === 0) return '#';
  const enc = (s: string) => encodeURIComponent(s);
  const c = panels.map(latlng);
  const dest = c[c.length - 1];
  const wp = c.slice(0, -1); // tous les panneaux sauf le dernier = arrêts intermédiaires
  let u = `https://www.google.com/maps/dir/?api=1&travelmode=${mode}`;
  u += `&destination=${enc(dest)}`;
  if (wp.length) u += `&waypoints=${wp.map(enc).join('%7C')}`;
  u += '&dir_action=navigate';
  return u;
}

/** Lien de partage Telegram. */
export function telegramUrl(name: string, gUrl: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(gUrl)}&text=${encodeURIComponent(
    '🗺️ Itinéraire de collage : ' + name,
  )}`;
}

/**
 * Vrai si le nom a été généré automatiquement à partir des extrémités
 * (« Itinéraire de X à Y ») : il décrit un ordre précis, donc il devient faux
 * dès que le parcours est réordonné depuis un autre point de départ.
 */
export function isAutoName(n: string): boolean {
  return /^Itin[ée]raire de\s+.+\s+à\s+.+/i.test(n);
}

/** « Itinéraire de X à Y » -> « X → Y ». */
export function cleanName(n: string): string {
  return n.replace(/^Itin[ée]raire de\s+/i, '').replace(/\s+à\s+/, ' → ');
}
