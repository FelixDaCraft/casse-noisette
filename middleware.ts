import { NextResponse, type NextRequest } from 'next/server';

/* Casse-Noisette est réservé aux militants : sans session, toute page renvoie
   vers la connexion.

   Contrôle optimiste — présence du cookie seulement. Le middleware tourne sur
   le runtime edge, sans le module `crypto` de Node qui signe les jetons : la
   vraie vérification (signature, expiration, compte actif) est faite par
   `requireMilitant()` dans chaque page et par les routes API elles-mêmes. Le
   but ici est de ne rien rendre, même un instant, à un visiteur anonyme.

   Hors contrôle : la connexion, le backoffice (qui a sa propre session admin),
   les routes API (elles répondent 401 au lieu de rediriger) et les fichiers
   statiques de la PWA (service worker, manifeste, icônes). */

export function middleware(req: NextRequest) {
  // Même nom que MILITANT_COOKIE (lib/auth.ts), qu'on n'importe pas : il
  // tirerait Prisma et `crypto` dans le bundle edge.
  if (req.cookies.has('cn_militant')) return NextResponse.next();
  const url = req.nextUrl.clone();
  const suite = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = '/connexion';
  url.search = suite === '/' ? '' : `?suite=${encodeURIComponent(suite)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Tout chemin hors préfixes ci-dessus et hors fichiers (dernier segment à point).
  matcher: ['/((?!api|_next|admin|connexion|.*\\.[^/]+$).*)'],
};
