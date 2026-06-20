'use client';
import Link from 'next/link';
import { useTransition } from 'react';
import { moveItinerary, deleteItinerary } from './actions';

type Item = { id: string; name: string; city: string | null; count: number };

export default function ItineraryAdminList({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();
  if (items.length === 0) return <p className="muted">Aucun itinéraire. Crée le premier ci-dessus.</p>;
  return (
    <div>
      {items.map((it, idx) => (
        <div className="list-item" key={it.id}>
          <span className="title grow">
            <Link href={`/admin/itineraries/${it.id}`}>{it.name}</Link>
          </span>
          {it.city ? (
            <span className="badge">📍 {it.city}</span>
          ) : (
            <span className="badge warn">sans ville</span>
          )}
          <span className="count">{it.count} panneaux</span>
          <button
            className="btn sm"
            disabled={pending || idx === 0}
            onClick={() => start(async () => { await moveItinerary(it.id, 'up'); })}
            title="Monter"
          >
            ↑
          </button>
          <button
            className="btn sm"
            disabled={pending || idx === items.length - 1}
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
              if (confirm(`Supprimer « ${it.name} » et tous ses panneaux ?`))
                start(async () => { await deleteItinerary(it.id); });
            }}
          >
            Suppr
          </button>
        </div>
      ))}
    </div>
  );
}
