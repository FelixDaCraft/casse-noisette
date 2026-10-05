// GET /connexion/ap — démarre la connexion : mémorise la tentative dans un
// cookie signé, puis envoie le navigateur sur l'écran de consentement du
// fournisseur (Action Populaire, ou sa simulation).

import { NextResponse, type NextRequest } from 'next/server';
import { signValue } from '@/lib/auth';
import { fournisseur, nouvelleTentative, RefusAP } from '@/lib/actionPopulaire';
import { ETAT_COOKIE, ETAT_TTL_SECONDS, origine, suiteSure, urlRetour, type Tentative } from '../commun';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { state, codeVerifier, codeChallenge } = nouvelleTentative();
  const suite = suiteSure(req.nextUrl.searchParams.get('suite'));

  let cible: string;
  try {
    cible = fournisseur().urlAutorisation({ state, redirectUri: urlRetour(req), codeChallenge });
  } catch (e) {
    const code = e instanceof RefusAP ? e.code : 'profil';
    return NextResponse.redirect(`${origine(req)}/connexion?erreur=${code}`);
  }

  const res = NextResponse.redirect(new URL(cible, origine(req) + '/'));
  const t: Tentative = { state, codeVerifier, suite };
  res.cookies.set(ETAT_COOKIE, signValue(JSON.stringify(t)), {
    httpOnly: true,
    // `lax` : le retour d'AP est une navigation de premier niveau, le cookie suit.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/connexion',
    maxAge: ETAT_TTL_SECONDS,
  });
  return res;
}
