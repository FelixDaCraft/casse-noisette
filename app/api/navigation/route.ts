// POST /api/navigation (militant connecté) — itinéraire guidé de la position
// du militant jusqu'au prochain panneau, consignes en français comprises, plus
// la longueur des trajets restants de la tournée.
//
// Comme /api/optimize, on passe par le serveur : OSRM n'est jamais exposé au
// navigateur (il n'écoute que sur la boucle locale du serveur), et l'IP du
// militant ne part chez personne.

import { NextResponse } from 'next/server';
import { getCurrentMilitant } from '@/lib/auth';
import { osrmRoute } from '@/lib/osrm';
import { construireTrajet } from '@/lib/trajet';
import { MAX_PANELS, type Mode } from '@/lib/maps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODES: Mode[] = ['walking', 'bicycling', 'driving'];
/** Position + panneaux restants. Marge au-dessus de MAX_PANELS, comme /api/optimize. */
const MAX_POINTS = MAX_PANELS * 3 + 1;

// Garde-fou contre un client qui s'emballe (recalcul en boucle) : l'écran
// lui-même espace ses demandes d'au moins 10 s, il reste donc très en dessous.
const MAX_PAR_FENETRE = 60;
const FENETRE_MS = 5 * 60 * 1000;
const appels = ((globalThis as any).__cnNavAppels ??= new Map<string, number[]>()) as Map<string, number[]>;

function tropDAppels(militantId: string): boolean {
  const maintenant = Date.now();
  const recents = (appels.get(militantId) ?? []).filter((t) => t > maintenant - FENETRE_MS);
  if (recents.length >= MAX_PAR_FENETRE) {
    appels.set(militantId, recents);
    return true;
  }
  recents.push(maintenant);
  appels.set(militantId, recents);
  if (appels.size > 5000) {
    for (const [k, v] of appels) if (!v.some((t) => t > maintenant - FENETRE_MS)) appels.delete(k);
  }
  return false;
}

const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 90;
const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180;

type Body = { mode?: unknown; points?: { lat?: unknown; lng?: unknown }[] };

export async function POST(req: Request) {
  const militant = await getCurrentMilitant();
  if (!militant) return NextResponse.json({ error: 'connexion requise' }, { status: 401 });
  if (tropDAppels(militant.id)) {
    return NextResponse.json({ error: 'trop de recalculs, patiente un instant' }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : 'walking';
  const raw = Array.isArray(body.points) ? body.points : [];
  if (raw.length < 2 || raw.length > MAX_POINTS) {
    return NextResponse.json({ error: 'points invalides' }, { status: 400 });
  }
  const points = raw.map((p) => ({ lat: p?.lat, lng: p?.lng }));
  if (!points.every((p) => isLat(p.lat) && isLng(p.lng))) {
    return NextResponse.json({ error: 'points invalides' }, { status: 400 });
  }

  const reponse = await osrmRoute(points as { lat: number; lng: number }[], mode);
  if (!reponse) {
    return NextResponse.json(
      { statut: 'indisponible' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    return NextResponse.json(construireTrajet(reponse), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[navigation]', err);
    return NextResponse.json({ statut: 'indisponible' }, { status: 500 });
  }
}
