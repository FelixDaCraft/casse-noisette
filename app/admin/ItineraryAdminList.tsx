'use client';
import Link from 'next/link';
import { useTransition } from 'react';
import { moveItinerary, deleteItinerary } from './actions';

type Item = { id: string; name: string; city: string | null; count: number; kind: 'circo' | 'ville' };

export default function ItineraryAdminList({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();
  if (items.length === 0) return <p className="muted">Aucun itinéraire. Crée le premier ci-dessus.</p>;
  return (
    <div>
      {items.map((it, idx) => {
        const memeGroupe = items.filter((x) => x.kind === it.kind);
        const rang = memeGroupe.findIndex((x) => x.id === it.id);
        return (
        <div className="list-item" key={it.id}>
          <span className="title grow">
            <Link href={`/admin/itineraries/${it.id}`}>{it.name}</Link>
          </span>
          <span className={'badge ' + (it.kind === 'ville' ? 'kind-ville' : 'kind-circo')}>
            {it.kind === 'ville' ? 'commune' : 'circo'}
          </span>
          {it.city ? (
            <span className="badge">📍 {it.city}</span>
          ) : (
            <span className="badge warn">sans ville</span>
          )}
          <span className="count">{it.count} panneaux</span>
          <button
            className="btn sm"
            disabled={pending || rang === 0}
            onClick={() => start(async () => { await moveItinerary(it.id, 'up'); })}
            title="Monter"
          >
            ↑
          </button>
          <button
            className="btn sm"
            disabled={pending || rang === memeGroupe.length - 1}
            onClick={() => start(async () => { await moveItinerary(it.id, 'down'); })}
            title="Descendre"
          >
            ↓
          </button>
          <Link className="btn sm" href={`/admin/itineraries/${it.id}`}>
            Éditer
          </Link>
          <button
            className="btn sm danger"
            disabled={pending}
            onClick={() => {
              if (confirm(`Supprimer la tournée « ${it.name} » ?\n\nLes panneaux utilisés par d'autres tournées sont conservés.`))
                start(async () => { await deleteItinerary(it.id); });
            }}
          >
            Suppr
          </button>
        </div>
        );
      })}
    </div>
  );
}
