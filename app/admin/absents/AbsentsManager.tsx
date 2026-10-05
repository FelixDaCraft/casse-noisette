'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePanelEverywhere } from '../actions';
import Confirm from '../Confirm';
import { useToast } from '../Toast';
import { SEUIL_ABSENT as SEUIL, ilYA } from '@/lib/etatsPanneau';

type Absent = {
  id: string;
  name: string;
  city: string | null;
  department: string | null;
  lat: number;
  lng: number;
  signalements: number;
  militants: number;
  dernier: string;
};

export default function AbsentsManager({ absents, maintenant }: { absents: Absent[]; maintenant: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const { toast, element: toastEl } = useToast();
  const [aSupprimer, setASupprimer] = useState<Absent | null>(null);

  // Plusieurs signalements : à traiter. Un seul : à garder à l'œil, ça peut
  // être une erreur de doigt ou un panneau masqué par un camion.
  const surs = absents.filter((a) => a.signalements >= SEUIL);
  const doutes = absents.filter((a) => a.signalements < SEUIL);

  const ligne = (a: Absent) => (
    <div className="ligne" key={a.id}>
      <span className={'ligne-num' + (a.signalements >= SEUIL ? ' ligne-num-rouge' : '')}>{a.signalements}</span>
      <div className="ligne-txt">
        <a
          className="ligne-titre"
          href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=19/${a.lat}/${a.lng}`}
          target="_blank"
          rel="noopener"
        >
          {a.name || 'Panneau sans nom'}
        </a>
        <div className="ligne-sous">
          {[a.city, a.department && `(${a.department})`].filter(Boolean).join(' ')}
          <span>
            · {a.militants} militant{a.militants > 1 ? 's' : ''} · dernier {ilYA(a.dernier, maintenant)}
          </span>
        </div>
      </div>
      <button className="btn-texte-danger" disabled={busy} onClick={() => setASupprimer(a)}>
        Supprimer
      </button>
    </div>
  );

  return (
    <div className="admin-large">
      <div className="page-tete">
        <div>
          <div className="admin-kicker">
            {absents.length} panneau{absents.length > 1 ? 'x' : ''}
          </div>
          <h1 className="admin-h1">Signalés absents</h1>
        </div>
      </div>
      <p className="admin-intro prose">
        Les panneaux que les militants disent disparus. Un signalement « collé » plus récent les
        retire de cette liste. Supprimer un panneau le retire de toutes ses tournées.
      </p>

      <section className="groupe-admin">
        <h2>Signalés {SEUIL} fois ou plus</h2>
        {surs.length === 0 ? <p className="vide">Aucun pour le moment.</p> : surs.map(ligne)}
      </section>

      {doutes.length > 0 && (
        <section className="groupe-admin">
          <h2>Signalés une fois</h2>
          {doutes.map(ligne)}
        </section>
      )}

      {aSupprimer && (
        <Confirm
          titre="Supprimer le panneau"
          texte={`« ${aSupprimer.name} » sera retiré de toutes ses tournées, avec son historique de signalements.`}
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={() => {
            const id = aSupprimer.id;
            setASupprimer(null);
            start(async () => {
              await deletePanelEverywhere(id);
              toast('Panneau supprimé');
              router.refresh();
            });
          }}
        />
      )}
      {toastEl}
    </div>
  );
}
