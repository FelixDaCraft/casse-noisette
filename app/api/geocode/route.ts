// Géocodage via Nominatim, côté serveur.
//
// Passer par le serveur est indispensable : Nominatim impose un User-Agent
// identifiant et une requête par seconde, et bloque sinon — appeler depuis le
// navigateur ferait rate-limiter tous les utilisateurs d'un coup. Le cache de
// 7 jours évite de redemander les mêmes adresses à chaque import.
// GET ?q=Rue+Jean+Jaurès,+Rezé        -> { lat, lng, road, city } | 404
// GET ?lat=47.18&lng=-1.55 (inverse)  -> { road, city }
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA = 'casse-noisette/1.0 (noreply@casse-noisette.aynn.fr)';
// Agglomération nantaise : simple préférence de recherche, non bornante.
const VIEWBOX = '-1.80,47.35,-1.35,47.05';
const cache = new Map<string, { at: number; v: unknown }>();
const TTL = 1000 * 60 * 60 * 24 * 7;
let last = 0;

async function nominatim(path: string) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const wait = Math.max(0, last + 1100 - Date.now());
  last = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const r = await fetch('https://nominatim.openstreetmap.org' + path, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr' },
  });
  const v = await r.json();
  cache.set(path, { at: Date.now(), v });
  return v;
}

const addr = (j: any) => {
  const a = j?.address || {};
  return {
    road: a.road || a.pedestrian || a.square || a.footway || j?.name || '',
    city: a.city || a.town || a.village || a.municipality || '',
  };
};

export async function GET(req: Request) {
  await requireAdmin();
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q');
  if (q) {
    const j: any = await nominatim(
      `/search?format=json&addressdetails=1&limit=1&countrycodes=fr&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`,
    );
    const h = Array.isArray(j) && j[0];
    if (!h) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    return NextResponse.json({ lat: +(+h.lat).toFixed(6), lng: +(+h.lon).toFixed(6), ...addr(h) });
  }
  const lat = Number(sp.get('lat')), lng = Number(sp.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: 'Paramètres' }, { status: 400 });
  const j = await nominatim(`/reverse?format=json&zoom=17&lat=${lat}&lon=${lng}`);
  return NextResponse.json(addr(j));
}
