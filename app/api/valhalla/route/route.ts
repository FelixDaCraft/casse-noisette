// POST /api/valhalla/route (militant connecté) — relais vers notre Valhalla
// pour le mode « Tournée ».
//
// Ferrostar, dans le navigateur, rédige lui-même la requête Valhalla (format
// « osrm » avec consignes visuelles et vocales) et la poste ici comme il la
// posterait à Valhalla. On ne la transmet PAS telle quelle : on la reconstruit
// à partir des seuls champs attendus (mode, points, cap au départ), la langue
// est imposée, et le reste est ignoré. Valhalla n'est jamais exposé au
// navigateur (il n'écoute que sur la boucle locale du serveur) et l'IP du
// militant ne part chez personne.
//
// La réponse repart au format attendu par Ferrostar, consignes nettoyées
// (lib/guidage.ts). Hors zone couverte (aujourd'hui les Pays de la Loire),
// on répond 422 « hors-couverture » : l'écran propose Google Maps au lieu
// d'un faux guidage.

import { NextResponse } from 'next/server';
import { getCurrentMilitant } from '@/lib/auth';
import { MAX_PANELS } from '@/lib/maps';
import { horsCouverture, nettoyerConsigne } from '@/lib/guidage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALHALLA = (process.env.VALHALLA_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.VALHALLA_TIMEOUT_MS || 10_000);
/** Une requête Ferrostar fait ~1 Ko ; au-delà, ce n'est pas lui. */
const MAX_OCTETS = 16_000;
/** Position + panneaux restants. Marge au-dessus de MAX_PANELS, comme /api/optimize. */
const MAX_POINTS = MAX_PANELS * 3 + 1;
const COSTINGS = ['pedestrian', 'bicycle', 'auto'] as const;
type Costing = (typeof COSTINGS)[number];

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
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

const sansCache = { 'Cache-Control': 'no-store' };
const reponse = (corps: object, status: number) => NextResponse.json(corps, { status, headers: sansCache });

type Lieu = { lat?: unknown; lon?: unknown; type?: unknown; heading?: unknown };

/** Requête Valhalla propre, ou null si celle reçue ne tient pas debout. */
function requeteValhalla(brut: unknown): object | null {
  if (!brut || typeof brut !== 'object') return null;
  const b = brut as { costing?: unknown; locations?: unknown };
  const costing = COSTINGS.includes(b.costing as Costing) ? (b.costing as Costing) : null;
  const lieux = Array.isArray(b.locations) ? (b.locations as Lieu[]) : [];
  if (!costing || lieux.length < 2 || lieux.length > MAX_POINTS) return null;
  if (!lieux.every((l) => l && isLat(l.lat) && isLng(l.lon))) return null;

  const locations = lieux.map((l, k) => {
    const lieu: Record<string, unknown> = { lat: r6(l.lat as number), lon: r6(l.lon as number), type: 'break' };
    // Le cap n'a de sens qu'au départ et sur la route : à pied, on fait
    // demi-tour sur place, inutile de contraindre le départ.
    if (k === 0 && costing !== 'pedestrian' && typeof l.heading === 'number' && Number.isFinite(l.heading)) {
      lieu.heading = Math.round(((l.heading % 360) + 360) % 360);
      lieu.heading_tolerance = 60;
    }
    return lieu;
  });

  return {
    locations,
    costing,
    format: 'osrm',
    language: 'fr-FR',
    units: 'kilometers',
    banner_instructions: true,
    voice_instructions: true,
    // Mêmes annotations que celles que demande Ferrostar (durée et longueur
    // de chaque segment) : rien de plus.
    filters: {
      action: 'include',
      attributes: [
        'shape_attributes.speed',
        'shape_attributes.speed_limit',
        'shape_attributes.time',
        'shape_attributes.length',
      ],
    },
  };
}

type Reponse = {
  code?: string;
  error_code?: number;
  waypoints?: { distance?: number }[];
  routes?: {
    legs?: {
      steps?: {
        maneuver?: { instruction?: string };
        voiceInstructions?: { announcement?: string; ssmlAnnouncement?: string }[];
        bannerInstructions?: { primary?: { text?: string } }[];
      }[];
    }[];
  }[];
};

/** Nettoie en place les textes que lira et dira l'écran. */
function nettoyer(corps: Reponse) {
  for (const route of corps.routes ?? []) {
    for (const jambe of route.legs ?? []) {
      for (const etape of jambe.steps ?? []) {
        if (etape.maneuver?.instruction) etape.maneuver.instruction = nettoyerConsigne(etape.maneuver.instruction);
        for (const v of etape.voiceInstructions ?? []) {
          if (v.announcement) v.announcement = nettoyerConsigne(v.announcement);
          if (v.ssmlAnnouncement) v.ssmlAnnouncement = v.ssmlAnnouncement.replace(/\.{2,}/g, '.');
        }
        for (const b of etape.bannerInstructions ?? []) {
          if (b.primary?.text) b.primary.text = nettoyerConsigne(b.primary.text);
        }
      }
    }
  }
}

export async function POST(req: Request) {
  const militant = await getCurrentMilitant();
  if (!militant) return reponse({ error: 'connexion requise' }, 401);
  if (tropDAppels(militant.id)) return reponse({ error: 'trop de recalculs, patiente un instant' }, 429);
  if (!VALHALLA) return reponse({ statut: 'indisponible' }, 503);

  // Ferrostar poste du JSON sans en-tête Content-Type : on lit le texte brut.
  const texte = await req.text();
  if (texte.length > MAX_OCTETS) return reponse({ error: 'requête trop longue' }, 413);
  let requete: object | null = null;
  try {
    requete = requeteValhalla(JSON.parse(texte));
  } catch {
    // JSON invalide : traité comme une requête invalide ci-dessous.
  }
  if (!requete) return reponse({ error: 'requête invalide' }, 400);

  let corps: Reponse;
  try {
    const res = await fetch(`${VALHALLA}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requete),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    // 400 : Valhalla répond en JSON (NoSegment, NoRoute…), c'est une réponse utile.
    if (!res.ok && res.status !== 400) {
      console.warn(`[valhalla] HTTP ${res.status}`);
      return reponse({ statut: 'indisponible' }, 503);
    }
    corps = (await res.json()) as Reponse;
  } catch (err: any) {
    console.warn('[valhalla]', err?.name === 'TimeoutError' ? 'délai dépassé' : err?.message ?? err);
    return reponse({ statut: 'indisponible' }, 503);
  }

  if (corps.code !== 'Ok' || !corps.routes?.length) {
    // NoSegment / erreur 171 : un point ne s'accroche à aucune route connue,
    // il est hors de la zone préparée. DistanceExceeded (à pied, plus de
    // 250 km) : à l'échelle d'une tournée, c'est aussi qu'un point est ailleurs.
    // Le reste : pas de chemin dans ce mode.
    const hors = ['NoSegment', 'DistanceExceeded'].includes(corps.code ?? '') || [154, 171].includes(corps.error_code ?? 0);
    return reponse(hors ? { statut: 'hors-couverture', horsZone: [] } : { statut: 'introuvable' }, 422);
  }

  // Un point accroché à des centaines de mètres de la route est hors zone :
  // Valhalla l'a rattaché au bord de sa carte, le trajet serait absurde.
  const hors = horsCouverture((corps.waypoints ?? []).map((w) => w.distance));
  if (hors.length) return reponse({ statut: 'hors-couverture', horsZone: hors }, 422);

  nettoyer(corps);
  return reponse(corps, 200);
}
