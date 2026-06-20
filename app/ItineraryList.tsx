'use client';
import { useState } from 'react';
import { gmapsUrl, osmUrl, telegramUrl, cleanName, type Mode } from '@/lib/maps';

type Panel = { name: string; lat: number; lng: number };
type It = { id: string; name: string; city: string | null; panels: Panel[] };

const IconNav = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);
const IconOsm = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21" />
    <line x1="8" y1="3" x2="8" y2="18" />
    <line x1="16" y1="6" x2="16" y2="21" />
  </svg>
);
const IconTg = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M21.9 4.3 18.7 19.4c-.2 1-.86 1.26-1.74.78l-4.86-3.58-2.34 2.26c-.26.26-.48.48-.98.48l.35-4.96 9.04-8.17c.4-.35-.08-.55-.6-.2L6.4 13.06l-4.8-1.5c-1.04-.32-1.06-1.04.22-1.54l18.74-7.22c.86-.32 1.62.2 1.34 1.5z" />
  </svg>
);
const IconChev = (
  <svg className="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export default function ItineraryList({ itineraries }: { itineraries: It[] }) {
  const [mode, setMode] = useState<Mode>('driving');
  const total = itineraries.reduce((s, it) => s + it.panels.length, 0);

  // Regroupement par ville (la liste arrive déjà triée : ville puis position).
  const groups: { city: string; items: It[] }[] = [];
  for (const it of itineraries) {
    const c = it.city && it.city.trim() ? it.city.trim() : 'Autres';
    const last = groups[groups.length - 1];
    if (last && last.city === c) last.items.push(it);
    else groups.push({ city: c, items: [it] });
  }

  let order = 0; // index global pour échelonner l'animation d'entrée

  return (
    <>
      <div className="bg" />
      <div className="phi">φ</div>
      <div className="wrap">
        <header className="hd">
          <div className="kicker">
            <span className="dot" /> 4ᵉ circonscription · Loire-Atlantique
          </div>
          <h1>
            Itinéraires de <em>collage</em>
          </h1>
          <p className="sub">
            {itineraries.length} itinéraires · {total} panneaux · {groups.length} ville
            {groups.length > 1 ? 's' : ''}. La navigation démarre depuis ta position GPS.
          </p>
        </header>

        <div className="controls">
          <div className="modes">
            {(['walking', 'bicycling', 'driving'] as Mode[]).map((m) => (
              <button
                key={m}
                className={'mode-btn' + (mode === m ? ' active' : '')}
                onClick={() => setMode(m)}
              >
                {m === 'walking' ? 'À pied' : m === 'bicycling' ? 'Vélo' : 'Voiture'}
              </button>
            ))}
          </div>
        </div>

        {itineraries.length === 0 && <p className="muted">Aucun itinéraire pour le moment.</p>}

        {groups.map((g) => (
          <section key={g.city}>
            <h2 className="city-head">
              <span className="pin">📍</span> {g.city} <span className="cnt">{g.items.length} itin.</span>
            </h2>
            {g.items.map((it, gi) => {
              const gUrl = gmapsUrl(it.panels, mode);
              return (
                <article className="card" key={it.id} style={{ animationDelay: `${order++ * 60}ms` }}>
                  <h3>
                    <span className="num">{gi + 1}</span> {cleanName(it.name)}
                  </h3>
                  <div className="meta">
                    <span className="badge">{it.panels.length} panneaux</span>
                  </div>
                  <a className="cta" href={gUrl} target="_blank" rel="noopener">
                    {IconNav} Ouvrir dans Google Maps
                  </a>
                  <div className="alts">
                    <a className="alt osm" href={osmUrl(it.panels, mode)} target="_blank" rel="noopener">
                      {IconOsm} OpenStreetMap
                    </a>
                    <a className="alt tg" href={telegramUrl(cleanName(it.name), gUrl)} target="_blank" rel="noopener">
                      {IconTg} Partager
                    </a>
                  </div>
                  <details>
                    <summary>
                      {IconChev} Voir les {it.panels.length} panneaux
                    </summary>
                    <ol>
                      {it.panels.map((p, i) => (
                        <li key={i}>{p.name || 'Panneau ' + (i + 1)}</li>
                      ))}
                    </ol>
                  </details>
                </article>
              );
            })}
          </section>
        ))}

        <p className="foot">
          La navigation démarre depuis ta position GPS vers chaque panneau, dans l&apos;ordre.
        </p>
      </div>
    </>
  );
}
