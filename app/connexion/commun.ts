import type { NextRequest } from 'next/server';

/** Cookie de la tentative en cours : `state` anti-CSRF, vérificateur PKCE et
 *  page où revenir. Signé, et limité aux routes de connexion. */
export const ETAT_COOKIE = 'cn_ap_etat';
export const ETAT_TTL_SECONDS = 10 * 60;

export type Tentative = { state: string; codeVerifier: string; suite: string };

/** Adresse publique du site : derrière le proxy, l'origine vue par Next est
 *  celle du conteneur, pas celle du navigateur. Doit être stable : AP compare
 *  `redirect_uri` à l'octet près avec celle déclarée pour le client.
 *  `SITE_URL` d'abord, lu à l'exécution ; `NEXT_PUBLIC_SITE_URL`, lui, est figé
 *  dans le code au moment du build. */
export function origine(req: NextRequest): string {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '');
}

export const urlRetour = (req: NextRequest) => `${origine(req)}/connexion/retour`;

/** Page où revenir après connexion : chemin interne uniquement, jamais une
 *  autre origine (`//exemple.org`) ni la connexion elle-même. */
export function suiteSure(s: unknown): string {
  if (typeof s !== 'string' || !s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return '/';
  if (s.startsWith('/connexion')) return '/';
  return s;
}
