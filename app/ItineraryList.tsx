'use client';
import { useState, type ReactNode } from 'react';
import { gmapsUrl, telegramUrl, cleanName, type Mode } from '@/lib/maps';

type Panel = { name: string; lat: number; lng: number };
type It = { id: string; name: string; city: string | null; panels: Panel[] };

const IconNav = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
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

const IconWalk = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z" />
  </svg>
);
const IconBike = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.4-.4-.9-.6-1.4-.6s-1 .2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z" />
  </svg>
);
const IconCar = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
  </svg>
);
const MODE: Record<Mode, { label: string; icon: ReactNode }> = {
  walking: { label: 'À pied', icon: IconWalk },
  bicycling: { label: 'Vélo', icon: IconBike },
  driving: { label: 'Voiture', icon: IconCar },
};

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
                title={MODE[m].label}
                aria-label={MODE[m].label}
                aria-pressed={mode === m}
              >
                {MODE[m].icon}
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
