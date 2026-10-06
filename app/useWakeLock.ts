'use client';
// Garde l'écran allumé pendant la navigation (Screen Wake Lock API).
//
// Le système relâche le verrou dès que la page passe en arrière-plan (autre
// appli, écran éteint à la main) : on le redemande au retour, sur
// `visibilitychange`. Un verrou relâché ne se réutilise pas, il faut en
// demander un nouveau.

import { useEffect, useState } from 'react';

export type EtatEcran = 'actif' | 'inactif' | 'non-supporte' | 'refuse';

export function useWakeLock(actif: boolean): EtatEcran {
  const [etat, setEtat] = useState<EtatEcran>('inactif');

  useEffect(() => {
    if (!actif) return;
    const wl = typeof navigator !== 'undefined' ? (navigator as any).wakeLock : undefined;
    if (!wl?.request) {
      setEtat('non-supporte');
      return;
    }
    let vivant = true;
    let verrou: any = null;

    const demander = async () => {
      if (document.visibilityState !== 'visible' || verrou) return;
      try {
        const v = await wl.request('screen');
        if (!vivant) {
          v.release().catch(() => undefined);
          return;
        }
        verrou = v;
        setEtat('actif');
        v.addEventListener('release', () => {
          verrou = null;
          if (vivant) setEtat('inactif');
        });
      } catch {
        // Économie d'énergie, politique du navigateur, page masquée.
        if (vivant) setEtat('refuse');
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') demander();
    };

    demander();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      vivant = false;
      document.removeEventListener('visibilitychange', onVisible);
      verrou?.release().catch(() => undefined);
      verrou = null;
      setEtat('inactif');
    };
  }, [actif]);

  return etat;
}
