'use client';
import { useEffect } from 'react';

/** Arriver sur la connexion, c'est ne plus être connecté (déconnexion, session
 *  expirée) : on efface les pages militantes gardées pour le hors-ligne, pour
 *  qu'elles ne restent pas lisibles sur un téléphone prêté ou partagé. */
export default function OublierHorsLigne() {
  useEffect(() => {
    if (!('caches' in window)) return;
    caches
      .keys()
      .then((ks) =>
        Promise.all(
          ks.map((k) =>
            caches.open(k).then((c) => Promise.all(['/', '/profil'].map((p) => c.delete(p)))),
          ),
        ),
      )
      .catch(() => {});
  }, []);
  return null;
}
