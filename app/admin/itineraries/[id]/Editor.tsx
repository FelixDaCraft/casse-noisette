'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addPanel,
  updatePanel,
  deletePanel,
  movePanel,
  updateItinerary,
  deleteItinerary,
} from '../../actions';
import { MAX_PANELS } from '@/lib/maps';

type P = { id: string; name: string; lat: number; lng: number };

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export default function Editor({
  itinerary,
}: {
  itinerary: { id: string; name: string; city: string | null; kind: 'circo' | 'ville'; panels: P[] };
}) {
  const router = useRouter();
  const [name, setName] = useState(itinerary.name);
  const [city, setCity] = useState(itinerary.city ?? '');
  const [panels, setPanels] = useState<P[]>(itinerary.panels);
  const [notice, setNotice] = useState('');
  const [, start] = useTransition();
  const full = panels.length >= MAX_PANELS;

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const panelsRef = useRef<P[]>(panels);
  panelsRef.current = panels;

  // Initialisation de la carte (une seule fois, côté client uniquement).
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      const L: any = (mod as any).default ?? mod;
      if (cancelled || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const first = panelsRef.current[0];
      const map = L.map(mapEl.current).setView([first?.lat ?? 47.18, first?.lng ?? -1.55], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      map.on('click', (e: any) => onAdd(e.latlng.lat, e.latlng.lng));
      draw();
      if (panelsRef.current.length > 1) {
        map.fitBounds(
          panelsRef.current.map((p) => [p.lat, p.lng]),
          { padding: [30, 30] },
        );
      }
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

  // Redessine les marqueurs à chaque changement de la liste.
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels]);

  function draw() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    panelsRef.current.forEach((p, i) => {
      const icon = L.divIcon({
        className: '',
        html:
          `<div class="cn-pin" style="width:26px;height:26px;border-radius:50%;` +
          `background:linear-gradient(135deg,#e5123b,#a30b29);border:2px solid #fff;color:#fff;` +
          `display:flex;align-items:center;justify-content:center;font:700 12px sans-serif">${i + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const m = L.marker([p.lat, p.lng], { draggable: true, icon }).addTo(layer);
      m.bindTooltip(p.name || `Panneau ${i + 1}`);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onMoveCoord(p.id, ll.lat, ll.lng);
      });
    });
  }

  function onAdd(lat: number, lng: number) {
    if (panelsRef.current.length >= MAX_PANELS) {
      setNotice(`Limite de ${MAX_PANELS} panneaux atteinte (limite Google Maps).`);
      return;
    }
    setNotice('');
    start(async () => {
      const created = await addPanel(itinerary.id, round(lat), round(lng));
      if (created) setPanels((prev) => [...prev, created]);
      else setNotice(`Limite de ${MAX_PANELS} panneaux atteinte (limite Google Maps).`);
    });
  }
  function onMoveCoord(id: string, lat: number, lng: number) {
    const la = round(lat);
    const ln = round(lng);
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, lat: la, lng: ln } : p)));
    start(async () => { await updatePanel(id, { lat: la, lng: ln }); });
  }
  function onNameChange(id: string, nm: string) {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, name: nm } : p)));
  }
  function saveName(id: string) {
    const p = panelsRef.current.find((x) => x.id === id);
    if (p) start(async () => { await updatePanel(id, { name: p.name }); });
  }
  function onDelete(id: string) {
    setPanels((prev) => prev.filter((p) => p.id !== id));
    start(async () => { await deletePanel(id); });
  }
  function onReorder(id: string, dir: 'up' | 'down') {
    setPanels((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const c = [...prev];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
    start(async () => { await movePanel(id, dir); });
  }

  return (
    <>
      <p style={{ margin: '0 0 10px' }}>
        <Link href="/admin" className="muted">
          ← Tous les itinéraires
        </Link>
      </p>

      <div className="panel">
        <div className="row">
          <input
            className="grow"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nom de l'itinéraire"
          />
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Ville"
            aria-label="Ville"
            style={{ maxWidth: 180 }}
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            onClick={() => start(async () => { await updateItinerary(itinerary.id, name, city); })}
          >
            Enregistrer
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Supprimer cet itinéraire et tous ses panneaux ?'))
                start(async () => {
                  await deleteItinerary(itinerary.id);
                  router.push('/admin');
                });
            }}
          >
            Supprimer
          </button>
        </div>
      </div>

      <div className="row" style={{ margin: '4px 0' }}>
        <span className={'badge' + (full ? ' warn' : '')}>
          {panels.length} / {MAX_PANELS} panneaux
        </span>
        {notice && <span className="err" style={{ margin: 0 }}>{notice}</span>}
      </div>
      <p className="muted" style={{ fontSize: '.85rem' }}>
        {full ? (
          <>Limite de {MAX_PANELS} panneaux atteinte (limite Google Maps). Supprime-en un pour en ajouter un autre.</>
        ) : (
          <>
            Clique sur la carte pour <b>ajouter</b> un panneau · glisse un marqueur pour le{' '}
            <b>déplacer</b>. L&apos;ordre des panneaux ci-dessous = l&apos;ordre de la tournée.
          </>
        )}
      </p>

      <div className="editor">
        <div id="map" ref={mapEl} />
        <div>
          {panels.length === 0 && (
            <p className="muted">Aucun panneau. Clique sur la carte pour en ajouter.</p>
          )}
          {panels.map((p, i) => (
            <div className="panel-row" key={p.id}>
              <span className="idx">{i + 1}</span>
              <input
                type="text"
                value={p.name}
                onChange={(e) => onNameChange(p.id, e.target.value)}
                onBlur={() => saveName(p.id)}
                aria-label={`Nom du panneau ${i + 1}`}
              />
              <button className="btn sm" disabled={i === 0} onClick={() => onReorder(p.id, 'up')} title="Monter">
                ↑
              </button>
              <button
                className="btn sm"
                disabled={i === panels.length - 1}
                onClick={() => onReorder(p.id, 'down')}
                title="Descendre"
              >
                ↓
              </button>
              <button
                className="btn sm danger"
                onClick={() => {
                  if (confirm(`Supprimer le panneau « ${p.name} » ?`)) onDelete(p.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
