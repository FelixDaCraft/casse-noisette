'use client';
import { useEffect, useState, useTransition } from 'react';
import {
  A_REPASSER,
  COMMENTAIRE_MAX,
  ETAT,
  ETATS,
  ilYA,
  type Etat,
  type EtatCourant,
} from '@/lib/etatsPanneau';
import type { Recompense } from '@/lib/classement';
import { signalerPanneau } from './actions';

/** id de panneau -> état courant. Un panneau jamais signalé n'y figure pas. */
export type Etats = Record<string, EtatCourant>;

/** Nombre de panneaux à repasser et date du constat le plus récent. */
export function bilan(panelIds: string[], etats: Etats) {
  let aRepasser = 0;
  let dernier: string | null = null;
  for (const id of panelIds) {
    const e = etats[id];
    if (!e) continue;
    if (A_REPASSER.has(e.etat)) aRepasser++;
    if (!dernier || e.date > dernier) dernier = e.date;
  }
  return { aRepasser, dernier };
}

/** Pastille de couleur d'un état (grise et creuse si jamais signalé). */
export function PastilleEtat({ etat }: { etat?: Etat }) {
  return <span className={'pastille-etat ' + (etat ? `etat-${etat}` : 'etat-inconnu')} aria-hidden="true" />;
}

/** « Recouvert · il y a 2 j par Camille L. » */
export function LigneEtat({ courant, maintenant }: { courant?: EtatCourant; maintenant: number }) {
  if (!courant) {
    return (
      <span className="etat-ligne inconnu">
        <PastilleEtat />
        Pas encore signalé
      </span>
    );
  }
  return (
    <span className={'etat-ligne' + (A_REPASSER.has(courant.etat) ? ' a-repasser' : '')}>
      <PastilleEtat etat={courant.etat} />
      <span>
        <b>{ETAT[courant.etat].libelle}</b> · {ilYA(courant.date, maintenant)}
        {courant.par && ` par ${courant.par}`}
      </span>
    </span>
  );
}

/** Envoie un signalement ; renvoie un message d'erreur, ou null si c'est fait.
 *  `onRecompense` reçoit ce qu'il a rapporté (points, tournée, badges). */
export async function envoyerSignalement(
  panelId: string,
  etat: Etat,
  commentaire: string | undefined,
  onSignale: (panelId: string, e: EtatCourant) => void,
  onRecompense?: (r: Recompense | null, etat: Etat) => void,
): Promise<string | null> {
  try {
    const r = await signalerPanneau(panelId, etat, commentaire);
    if (!r.ok) return r.erreur;
    onSignale(panelId, r.etat);
    onRecompense?.(r.recompense, etat);
    return null;
  } catch {
    // Sur le terrain, c'est presque toujours le réseau.
    return 'Pas de connexion : réessaie dans un instant.';
  }
}

/**
 * Feuille qui monte du bas de l'écran : les six états en gros boutons, à
 * portée de pouce, puis l'envoi tout en bas. Un commentaire est possible mais
 * jamais demandé.
 */
export function FeuilleSignalement({
  panneau,
  courant,
  maintenant,
  onSignale,
  onRecompense,
  onFermer,
}: {
  panneau: { id: string; name: string; num: number };
  courant?: EtatCourant;
  maintenant: number;
  onSignale: (panelId: string, e: EtatCourant) => void;
  onRecompense?: (r: Recompense | null, etat: Etat) => void;
  onFermer: () => void;
}) {
  const [choix, setChoix] = useState<Etat | null>(null);
  const [commentaire, setCommentaire] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onFermer]);

  const envoyer = () => {
    if (!choix) return;
    setErreur(null);
    demarrer(async () => {
      const err = await envoyerSignalement(panneau.id, choix, commentaire, onSignale, onRecompense);
      if (err) setErreur(err);
      else onFermer();
    });
  };

  return (
    <div className="voile voile-feuille" onClick={onFermer}>
      <div
        className="feuille-signal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signal-titre"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="poignee" />
        <div className="kicker">Panneau {panneau.num} · Signaler</div>
        <h2 className="signal-titre" id="signal-titre">
          {panneau.name || `Panneau ${panneau.num}`}
        </h2>
        <LigneEtat courant={courant} maintenant={maintenant} />

        <div className="etats-grille" role="group" aria-label="État du panneau">
          {ETATS.map((e) => (
            <button
              key={e}
              type="button"
              className={`etat-choix etat-${e}`}
              aria-pressed={choix === e}
              onClick={() => setChoix(e)}
            >
              <PastilleEtat etat={e} />
              <span className="etat-choix-txt">
                <span className="etat-choix-lib">{ETAT[e].libelle}</span>
                <span className="etat-choix-det">{ETAT[e].detail}</span>
              </span>
            </button>
          ))}
        </div>

        {choix === 'tague' && (
          <p className="signal-aide prose">
            Prends une photo avec ton téléphone avant de recouvrir : elle servira pour porter plainte.
          </p>
        )}
        {choix === 'absent' && (
          <p className="signal-aide prose">
            Signalé plusieurs fois, le panneau remonte au backoffice pour être retiré des tournées.
          </p>
        )}

        <label className="champ signal-commentaire">
          <span>
            Commentaire <span className="aide">facultatif</span>
          </span>
          <textarea
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            maxLength={COMMENTAIRE_MAX}
            rows={2}
            placeholder="Affiche RN par-dessus, panneau tordu…"
          />
        </label>

        {erreur && (
          <p className="erreur" role="alert">
            {erreur}
          </p>
        )}

        <button type="button" className="cta signal-envoyer" disabled={!choix || envoi} onClick={envoyer}>
          {envoi ? 'Envoi…' : choix ? `Signaler : ${ETAT[choix].libelle}` : 'Choisis un état'}
        </button>
        <button type="button" className="lien-sobre signal-annuler" onClick={onFermer}>
          Annuler
        </button>
      </div>
    </div>
  );
}
