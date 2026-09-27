// Résout un lien Google Maps (court ou long) en liste d'étapes.
//
// Les liens `maps.app.goo.gl` ne peuvent pas être suivis depuis le navigateur
// (pas de CORS) : la redirection est suivie ici, en n'acceptant que des
// domaines Google et avec un délai borné.
// POST { url } -> { points: { lat?, lng?, q?, name? }[] }
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { parseGoogleLink } from '@/lib/googleLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = /^(https?:\/\/)?((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

export async function POST(req: Request) {
  await requireAdmin();
  const { url } = await req.json().catch(() => ({ url: '' }));
  if (typeof url !== 'string' || !ALLOWED.test(url.trim())) {
    return NextResponse.json({ error: 'Lien Google Maps attendu.' }, { status: 400 });
  }
  let finalUrl = url.trim();
  // Liens courts : on suit les redirections côté serveur (max 5 sauts, 5 s).
  if (/maps\.app\.goo\.gl|goo\.gl\//i.test(finalUrl)) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(finalUrl, { redirect: 'follow', signal: ctrl.signal });
      finalUrl = r.url;
    } catch {
      return NextResponse.json({ error: 'Impossible d’ouvrir ce lien court.' }, { status: 502 });
    } finally {
      clearTimeout(t);
    }
  }
  const points = parseGoogleLink(finalUrl);
  if (!points.length) return NextResponse.json({ error: 'Aucune étape trouvée dans ce lien.' }, { status: 422 });
  return NextResponse.json({ points, resolvedUrl: finalUrl });
}
