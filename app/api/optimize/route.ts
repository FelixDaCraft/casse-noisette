// POST /api/optimize — renvoie, pour chaque itinéraire, l'ordre de passage des
// panneaux le plus court depuis la position fournie par le navigateur.
//
// Passer par le serveur plutôt que d'appeler OSRM depuis le téléphone permet de
// mutualiser le cache entre tous les militants et de ne pas exposer leur IP au
// service de routage.

import { NextResponse } from 'next/server';
import { optimizeItineraries, type ItineraryInput } from '@/lib/routing';
import { MAX_PANELS, type Mode } from '@/lib/maps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODES: Mode[] = ['walking', 'bicycling', 'driving'];
const MAX_ITINERARIES = 100;

type Body = {
  origin?: { lat?: unknown; lng?: unknown };
  mode?: unknown;
  itineraries?: { id?: unknown; panels?: { lat?: unknown; lng?: unknown }[] }[];
};

const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 90;
const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { lat, lng } = body.origin ?? {};
  if (!isLat(lat) || !isLng(lng)) {
    return NextResponse.json({ error: 'origin invalide' }, { status: 400 });
  }

  const mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : 'driving';

  const raw = Array.isArray(body.itineraries) ? body.itineraries : [];
  if (raw.length > MAX_ITINERARIES) {
    return NextResponse.json({ error: 'trop d itineraires' }, { status: 400 });
  }

  const itineraries: ItineraryInput[] = [];
  for (const it of raw) {
    if (typeof it?.id !== 'string' || !Array.isArray(it.panels)) continue;
    // Marge au-dessus de MAX_PANELS : la limite produit peut évoluer, la garde reste.
    if (it.panels.length > MAX_PANELS * 3) continue;
    const panels = it.panels
      .filter((p) => isLat(p?.lat) && isLng(p?.lng))
      .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
    if (panels.length !== it.panels.length) continue; // un panneau douteux : on ne réordonne pas
    itineraries.push({ id: it.id, panels });
  }

  try {
    const { results, pending } = await optimizeItineraries({ lat, lng }, itineraries, mode);
    // `pending` : des distances routières manquaient et sont en cours de calcul en
    // arrière-plan — le client peut redemander dans quelques secondes pour les avoir.
    return NextResponse.json({ results, pending }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[optimize]', err);
    return NextResponse.json({ error: 'calcul impossible' }, { status: 500 });
  }
}
