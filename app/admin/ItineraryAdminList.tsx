'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { MAX_PANELS } from '@/lib/maps';
import { moveItinerary, deleteItinerary, createItinerary } from './actions';
import Confirm from './Confirm';

type Kind = 'circo' | 'ville';
type Item = { id: string; name: string; city: string | null; count: number; kind: Kind };

const VUES: { kind: Kind; label: string }[] = [
  { kind: 'ville', label: 'Par commune' },
  { kind: 'circo', label: '4ᵉ circo' },
];

export default function ItineraryAdminList({
  items,
  total,
}: {
  items: Item[];
  total: { tournees: number; panneaux: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vue, setVue] = useState<Kind>(items.some((i) => i.kind === 'ville') ? 'ville' : 'circo');
  const [nouveau, setNouveau] = useState(false);
  const [kindNeuf, setKindNeuf] = useState<Kind>('ville');
  const [aSupprimer, setASupprimer] = useState<Item | null>(null);

  const visibles = useMemo(() => items.filter((i) => i.kind === vue), [items, vue]);
  const compte = (k: Kind) => items.filter((i) => i.kind === k).length;

  // Groupes par commune, dans l'ordre déjà trié par le serveur.
  const groupes: { city: string; items: Item[] }[] = [];
  for (const it of visibles) {
    const c = it.city?.trim() || 'Sans commune';
    const last = groupes[groupes.length - 1];
    if (last && last.city === c) last.items.push(it);
    else groupes.push({ city: c, items: [it] });
  }

  async function creer(formData: FormData) {
    const id = await createItinerary(formData);
    setNouveau(false);
    if (id) router.push(`/admin/itineraries/${id}`);
  }

  return (
    <>
      <div className="page-tete">
        <div>
          <div className="admin-kicker">
            {total.tournees} tournées · {total.panneaux} panneaux
          </div>
          <h1 className="admin-h1">Tournées</h1>
        </div>
        <button className="btn btn-rouge" onClick={() => setNouveau((v) => !v)}>
          + Nouvelle tournée
        </button>
      </div>

      {nouveau && (
        <form action={creer} className="carte-form">
          <label className="champ" style={{ flex: '2 1 240px' }}>
            Nom de la tournée
            <input name="name" placeholder="ex. Centre-ville Rezé" required />
          </label>
          <label className="champ" style={{ flex: '1 1 160px' }}>
            Commune
            <input name="city" placeholder="Rezé" />
          </label>
          <div className="champ" style={{ flex: '1 1 200px' }}>
            Type
            <div className="seg">
              {VUES.map((v) => (
                <button
                  key={v.kind}
                  type="button"
                  className={kindNeuf === v.kind ? 'actif' : ''}
                  onClick={() => setKindNeuf(v.kind)}
                >
                  {v.kind === 'ville' ? 'Commune' : 'Circo'}
                </button>
              ))}
            </div>
            <input type="hidden" name="kind" value={kindNeuf} />
          </div>
          <button className="btn btn-violet">Créer et placer les panneaux</button>
        </form>
      )}

      <div className="admin-vues" role="tablist">
        {VUES.filter((v) => compte(v.kind) > 0 || v.kind === vue).map((v) => (
          <button
            key={v.kind}
            role="tab"
            className="vue"
            aria-selected={vue === v.kind}
            onClick={() => setVue(v.kind)}
          >
            {v.label}
            <span className="vue-cnt">{compte(v.kind)}</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 && <p className="vide">Aucune tournée de ce type.</p>}

      {groupes.map((g) => (
        <section className="groupe-admin" key={g.city}>
          <h2>{g.city}</h2>
          {g.items.map((it, i) => {
            const plein = it.count >= MAX_PANELS;
            return (
              <div className="ligne" key={it.id}>
                <span className="ligne-num">{i + 1}</span>
                <div className="ligne-txt">
                  <Link className="ligne-titre" href={`/admin/itineraries/${it.id}`}>
                    {it.name}
                  </Link>
                  <div className="ligne-sous">
                    <span className={'prog' + (plein ? ' plein' : '')}>
                      <span style={{ width: `${Math.min(100, (it.count / MAX_PANELS) * 100)}%` }} />
                    </span>
                    <span>
                      {it.count} / {MAX_PANELS} panneaux
                    </span>
                    {!it.city && <span className="badge alerte">sans commune</span>}
                  </div>
                </div>
                <button
                  className="btn btn-carre"
                  disabled={pending || i === 0}
                  onClick={() => start(async () => { await moveItinerary(it.id, 'up'); })}
                  title="Monter"
                >
                  ↑
                </button>
                <button
                  className="btn btn-carre"
                  disabled={pending || i === g.items.length - 1}
                  onClick={() => start(async () => { await moveItinerary(it.id, 'down'); })}
                  title="Descendre"
                >
                  ↓
                </button>
                <Link className="btn btn-sm" href={`/admin/itineraries/${it.id}`}>
                  Éditer
                </Link>
                <button className="btn-texte-danger" onClick={() => setASupprimer(it)}>
                  Supprimer
                </button>
              </div>
            );
          })}
        </section>
      ))}

      {aSupprimer && (
        <Confirm
          titre="Supprimer la tournée"
          texte={`« ${aSupprimer.name} » sera supprimée. Ses ${aSupprimer.count} panneaux sont conservés : ils restent dans le catalogue et dans les autres tournées où ils servent.`}
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={() => {
            const id = aSupprimer.id;
            setASupprimer(null);
            start(async () => {
              await deleteItinerary(id);
            });
          }}
        />
      )}
    </>
  );
}
