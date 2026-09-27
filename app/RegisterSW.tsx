'use client';
import { useEffect } from 'react';

/**
 * Enregistre le service worker (mode hors-ligne de la PWA) — en production
 * seulement.
 *
 * En développement, il servait les bundles depuis son cache : les noms de
 * fichiers générés par `next dev` sont stables (pas de hash), donc le
 * navigateur continuait d'exécuter l'ancien code après chaque modification.
 * On perd un temps fou à débugger un code qui n'est plus celui qui tourne.
 * En production les noms portent un hash, le problème ne se pose pas.
 *
 * Un service worker déjà installé sur localhost survivrait à ce changement :
 * on le désinscrit explicitement.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      if ('caches' in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
