// GET /connexion/retour?code=…&state=… — retour du fournisseur d'identité.
// Vérifie le `state` contre le cookie de la tentative (anti-CSRF), échange le
// code, lit le profil, crée ou met à jour le militant, puis ouvre la session.

import { NextResponse, type NextRequest } from 'next/server';
import { makeMilitantToken, MILITANT_COOKIE, MILITANT_TTL_SECONDS, unsignValue } from '@/lib/auth';
import { fournisseur, RefusAP } from '@/lib/actionPopulaire';
import { enregistrerMilitant } from '@/lib/militant';
import { ETAT_COOKIE, origine, suiteSure, urlRetour, type Tentative } from '../commun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function lireTentative(brut?: string): Tentative | null {
  const v = unsignValue(brut);
  if (!v) return null;
  try {
    const t = JSON.parse(v);
    return typeof t?.state === 'string' && typeof t?.codeVerifier === 'string' ? t : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const base = origine(req);
  const tentative = lireTentative(req.cookies.get(ETAT_COOKIE)?.value);

  const echec = (code: string) => {
    const res = NextResponse.redirect(`${base}/connexion?erreur=${code}`);
    res.cookies.set(ETAT_COOKIE, '', { path: '/connexion', maxAge: 0 });
    return res;
  };

  // Le `state` doit être celui qu'on a nous-mêmes posé : sinon, quelqu'un
  // essaie de nous faire ouvrir une session à son nom (CSRF de connexion).
  if (!tentative || q.get('state') !== tentative.state) return echec('etat');
  if (q.get('error')) return echec('annule');
  const code = q.get('code');
  if (!code) return echec('echange');

  try {
    const f = fournisseur();
    const jeton = await f.echangerCode({ code, redirectUri: urlRetour(req), codeVerifier: tentative.codeVerifier });
    const profil = await f.profil(jeton);
    const id = await enregistrerMilitant(profil);

    const res = NextResponse.redirect(`${base}${suiteSure(tentative.suite)}`);
    res.cookies.set(ETAT_COOKIE, '', { path: '/connexion', maxAge: 0 });
    res.cookies.set(MILITANT_COOKIE, makeMilitantToken(id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MILITANT_TTL_SECONDS,
    });
    return res;
  } catch (e) {
    if (e instanceof RefusAP) return echec(e.code);
    console.error('[connexion]', e);
    return echec('profil');
  }
}
