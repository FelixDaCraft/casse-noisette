'use client';
import { useCallback, useEffect, useState } from 'react';

const CLE = 'cn:favoris';

/** Communes et circonscriptions mises de côté, retenues par l'appareil.
 *
 *  Pas de compte à créer : un militant colle presque toujours sur les mêmes
 *  secteurs, et le navigateur suffit à s'en souvenir. Le revers assumé est
 *  qu'un changement de téléphone ou de navigateur repart de zéro.
 */
export function useFavoris() {
  const [favoris, setFavoris] = useState<string[]>([]);

  // Lecture après le montage : le serveur ne connaît pas le stockage local, et
  // le lire pendant le rendu ferait diverger le HTML envoyé de celui affiché.
  useEffect(() => {
    try {
      const lu = JSON.parse(localStorage.getItem(CLE) ?? '[]');
      if (Array.isArray(lu)) setFavoris(lu.filter((x) => typeof x === 'string'));
    } catch {
      /* navigation privée ou stockage refusé : on reste sans favoris */
    }
  }, []);

  const basculer = useCallback((cle: string) => {
    setFavoris((avant) => {
      const apres = avant.includes(cle) ? avant.filter((x) => x !== cle) : [...avant, cle];
      try {
        localStorage.setItem(CLE, JSON.stringify(apres));
      } catch {
        /* le choix vaut au moins pour la session en cours */
      }
      return apres;
    });
  }, []);

  return { favoris, basculer };
}
