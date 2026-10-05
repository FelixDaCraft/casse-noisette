'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Recompense } from '@/lib/classement';

type Message = { points: number; titre: string; sous: string | null; fete: boolean };

/**
 * Récompense après un signalement : une pastille « +10 » qui saute, en bas
 * d'écran, à la place du toast. Sobre — pas de confettis sur le trottoir —
 * et immobile pour qui a demandé moins d'animations (prefers-reduced-motion,
 * dans globals.css). Un signalement qui ne rapporte rien (même panneau déjà
 * compté aujourd'hui) le dit au lieu de se taire : le barème est transparent.
 */
export function useRecompense(toast: (m: string) => void) {
  const [message, setMessage] = useState<(Message & { cle: number }) | null>(null);

  const montrer = useCallback(
    (r: Recompense | null, colle: boolean, merci: string) => {
      if (!r) return toast(merci);
      if (r.points <= 0) {
        return toast(colle ? 'Merci ! Déjà compté aujourd’hui : pas de points en plus.' : merci);
      }
      const badge = r.badges[0];
      setMessage({
        cle: Date.now(),
        points: r.points,
        titre: r.tournee > 0 ? 'Tournée complète !' : colle ? 'Panneau collé' : 'Constat noté',
        sous: badge
          ? `Badge débloqué : ${badge.nom}`
          : r.tournee > 0
            ? `dont +${r.tournee} de bonus tournée`
            : colle
              ? 'Merci pour l’affiche !'
              : 'Merci, ça aide à savoir où repasser.',
        fete: r.tournee > 0 || !!badge,
      });
    },
    [toast],
  );

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.fete ? 3600 : 2600);
    return () => clearTimeout(t);
  }, [message]);

  const element = message ? (
    <div className={'recompense' + (message.fete ? ' fete' : '')} role="status" key={message.cle}>
      <span className="recompense-pts">
        +{message.points}
        <span className="sr"> points</span>
      </span>
      <span className="recompense-txt">
        <b>{message.titre}</b>
        {message.sous && <span>{message.sous}</span>}
      </span>
    </div>
  ) : null;

  return { montrer, element };
}
