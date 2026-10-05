// GET /connexion/simulation/autoriser?state=…&compte=… (ou &refus=1)
// Réponse de l'écran de consentement simulé : comme AP, renvoie au site avec
// un code à usage court et le `state` reçu, tel quel. Le code est fabriqué au
// clic, pas à l'affichage, pour ne pas expirer pendant qu'on choisit.
//
// Un formulaire GET et une vraie redirection, pas une Server Action : le retour
// doit être une navigation complète, comme depuis le vrai Action Populaire.

import { NextResponse, type NextRequest } from 'next/server';
import { codeSimule, simulationActive } from '@/lib/actionPopulaire';
import { COMPTES_SIMULES } from '@/lib/apSimulation';
import { origine } from '../../commun';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const base = origine(req);
  if (!simulationActive()) return NextResponse.redirect(`${base}/connexion`);
  const q = req.nextUrl.searchParams;
  const state = q.get('state') ?? '';
  const apId = q.get('compte') ?? '';

  const retour = new URLSearchParams(
    q.get('refus') || !COMPTES_SIMULES.some((c) => c.apId === apId)
      ? { error: 'access_denied', state }
      : { code: codeSimule(apId), state },
  );
  return NextResponse.redirect(`${base}/connexion/retour?${retour}`, 303);
}
