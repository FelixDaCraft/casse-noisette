// Lecture des coordonnées saisies à la main et des liens d'itinéraire Google
// Maps. Utilisé par l'import de panneaux du backoffice, côté serveur comme
// côté navigateur (aucune dépendance).
export type LinkPoint = { lat?: number; lng?: number; q?: string; name?: string };

const ok = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }
    : null;

/** Décimal (« 47.18, -1.55 », « 47,18 -1,55 », « @47.18,-1.55,17z ») ou DMS (« 47°11'14"N 1°33'04"W »). */
export function parseCoord(input: string): { lat: number; lng: number } | null {
  let s = input;
  try { s = decodeURIComponent(input); } catch {}
  const dms = /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)?\s*["″]?\s*([NS])[\s,;]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)?\s*["″]?\s*([EOW])/i.exec(s);
  if (dms) {
    const f = (d: string, m: string, x: string | undefined, h: string) => {
      const v = +d + +m / 60 + +(x || '0').replace(',', '.') / 3600;
      return /[SWO]/i.test(h) ? -v : v;
    };
    return ok(f(dms[1], dms[2], dms[3], dms[4]), f(dms[5], dms[6], dms[7], dms[8]));
  }
  const m = /(-?\d{1,2}(?:[.,]\d+))\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+))/.exec(s);
  return m ? ok(+m[1].replace(',', '.'), +m[2].replace(',', '.')) : null;
}

/** Formats gérés : /maps/dir/A/B/C/@…/data=…  et  /maps/dir/?api=1&origin&waypoints&destination. */
export function parseGoogleLink(url: string): LinkPoint[] {
  const seg = (x: string): LinkPoint => {
    const c = parseCoord(x);
    return c ? c : { q: x, name: x.split(',')[0].trim() };
  };
  let u: URL;
  try { u = new URL(url); } catch { const c = parseCoord(url); return c ? [c] : []; }
  const pts: LinkPoint[] = [];
  if (u.searchParams.get('api') === '1' || u.searchParams.get('destination')) {
    const w = (u.searchParams.get('waypoints') || '').split('|').filter(Boolean);
    [u.searchParams.get('origin'), ...w, u.searchParams.get('destination')]
      .filter((x): x is string => !!x)
      .forEach((x) => pts.push(seg(x)));
    return pts;
  }
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch {}
  const i = path.indexOf('/dir/');
  if (i < 0) { const c = parseCoord(url); return c ? [c] : []; }
  path.slice(i + 5).split('/')
    .filter((x) => x && !x.startsWith('@') && !x.startsWith('data=') && !/^am=/.test(x))
    .forEach((x) => pts.push(seg(x.replace(/\+/g, ' '))));
  // Les lieux nommés ont leurs coordonnées dans data=…!1d<lng>!2d<lat>, dans l'ordre.
  let data = url;
  try { data = decodeURIComponent(url); } catch {}
  const re = /!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g;
  const cs: { lat: number; lng: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(data))) cs.push({ lng: +m[1], lat: +m[2] });
  let k = 0;
  for (const p of pts) {
    if (p.q !== undefined) { if (cs[k]) Object.assign(p, cs[k]); k++; }
  }
  return pts;
}
