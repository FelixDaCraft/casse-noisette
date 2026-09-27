'use client';
import { useEffect } from 'react';

/**
 * Fenêtre de confirmation du backoffice, à la place de `confirm()` : elle
 * permet d'expliquer ce qui va réellement se passer (un panneau utilisé
 * ailleurs n'est pas supprimé, seulement retiré de la tournée).
 */
export default function Confirm({
  titre,
  texte,
  action = 'Supprimer',
  onConfirmer,
  onAnnuler,
}: {
  titre: string;
  texte: string;
  action?: string;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnnuler();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onAnnuler]);

  return (
    <div className="voile" onClick={onAnnuler} role="dialog" aria-modal="true">
      <div className="modale" onClick={(e) => e.stopPropagation()}>
        <h3>{titre}</h3>
        <p>{texte}</p>
        <div className="modale-actions">
          <button type="button" className="btn btn-sm" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={onConfirmer}>
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
