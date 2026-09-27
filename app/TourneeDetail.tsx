'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, type ReactNode } from 'react';
import { gmapsUrl, telegramUrl, type Mode } from '@/lib/maps';
import type { Mesure } from './useOptimizedOrder';

type Panel = { name: string; lat: number; lng: number };
type Coord = { lat: number; lng: number };

/** Note affichée à droite de « Ordre de passage ». */
export type NoteOrdre = { texte: string; ton: 'ok' | 'neutre' | 'attente' };

const km = (m: number) =>
  m < 950 ? `${Math.round(m / 10) * 10}` : `${(m / 1000).toFixed(1).replace('.', ',')}`;
const kmUnite = (m: number) => (m < 950 ? 'mètres environ' : 'km environ');
// En dessous d'une heure et demie, les minutes restent plus parlantes qu'un
// « 1,1 heures » qu'il faut convertir de tête.
const dureeVal = (s: number) =>
  s < 5400 ? `${Math.max(1, Math.round(s / 60))}` : `${(s / 3600).toFixed(1).replace('.', ',')}`;
const dureeUnite = (s: number) => (s < 5400 ? 'minutes' : 'heures');

export default function TourneeDetail({
  titre,
  kicker,
  panels,
  mode,
  modes,
  mesure,
  note,
  position,
  onRetour,
}: {
  titre: string;
  kicker: string;
  panels: Panel[];
  mode: Mode;
  modes: ReactNode;
  mesure?: Mesure;
  note: NoteOrdre;
  position: Coord | null;
  onRetour: () => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  // Le tracé se redessine à chaque changement d'ordre : on lit les valeurs
  // courantes dans l'effet de dessin sans recréer la carte.
  const dataRef = useRef({ panels, position });
  dataRef.current = { panels, position };

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      const L: any = (mod as any).default ?? mod;
      if (cancelled || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView(
        [panels[0]?.lat ?? 47.18, panels[0]?.lng ?? -1.55],
        14,
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      dessiner();
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dessiner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, position]);

  function dessiner() {
    const L = LRef.current;
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    const { panels: pts, position: pos } = dataRef.current;
    layer.clearLayers();

    // Tracé pointillé dans l'ordre de passage.
    if (pts.length > 1) {
      L.polyline(
        pts.map((p) => [p.lat, p.lng]),
        { color: '#4C0297', weight: 4, opacity: 0.9, dashArray: '2 8', lineCap: 'round' },
      ).addTo(layer);
    }

    pts.forEach((p, i) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="cn-marker">${i + 1}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      L.marker([p.lat, p.lng], { icon })
        .addTo(layer)
        .bindTooltip(p.name || `Panneau ${i + 1}`);
    });

    if (pos) {
      L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({ className: '', html: '<div class="cn-moi"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
        interactive: false,
      }).addTo(layer);
    }

    const bounds = [...pts.map((p) => [p.lat, p.lng] as [number, number])];
    if (pos) bounds.push([pos.lat, pos.lng]);
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
  }

  const url = gmapsUrl(panels, mode);

  return (
    <div className="detail">
      <div className="detail-carte">
        <div ref={mapEl} className="detail-map" />
        <div className="detail-actions">
          <button type="button" className="rond" onClick={onRetour} aria-label="Retour">
            <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <a className="partage" href={telegramUrl(titre, url)} target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
              <path d="M21.9 4.3 18.7 19.4c-.2 1-.86 1.26-1.74.78l-4.86-3.58-2.34 2.26c-.26.26-.48.48-.98.48l.35-4.96 9.04-8.17c.4-.35-.08-.55-.6-.2L6.4 13.06l-4.8-1.5c-1.04-.32-1.06-1.04.22-1.54l18.74-7.22c.86-.32 1.62.2 1.34 1.5z" />
            </svg>
            Partager
          </a>
        </div>
      </div>

      <div className="feuille">
        <div className="poignee" />
        <div className="kicker">{kicker}</div>
        <h1 className="detail-titre">{titre}</h1>

        <div className="stats">
          <div className="stat">
            <div className="stat-val">{panels.length}</div>
            <div className="stat-lib">panneaux</div>
          </div>
          <div className="stat">
            <div className="stat-val">{mesure ? km(mesure.meters) : '—'}</div>
            <div className="stat-lib">{mesure ? kmUnite(mesure.meters) : 'km environ'}</div>
          </div>
          <div className="stat">
            <div className="stat-val">{mesure?.seconds != null ? dureeVal(mesure.seconds) : '—'}</div>
            <div className="stat-lib">{mesure?.seconds != null ? dureeUnite(mesure.seconds) : 'minutes'}</div>
          </div>
        </div>

        <div className="modes-compact">{modes}</div>

        <div className="ordre-tete">
          <h2>Ordre de passage</h2>
          <span className={'note note-' + note.ton}>{note.texte}</span>
        </div>

        <ol className="frise">
          <div className="frise-ligne" />
          <li className="frise-moi">
            <span className="frise-rond-moi">
              <span />
            </span>
            <span className="frise-nom">Ta position</span>
          </li>
          {panels.map((p, i) => (
            <li key={i}>
              <span className="frise-rond">{i + 1}</span>
              <span className="frise-nom">{p.name || `Panneau ${i + 1}`}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="cta-zone">
        <div className="cta-inner">
          <a className="cta" href={url} target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            Lancer le GPS
          </a>
        </div>
      </div>
    </div>
  );
}
