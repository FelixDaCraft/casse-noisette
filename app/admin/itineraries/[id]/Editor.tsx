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
import Confirm from '../../Confirm';

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
  const [kind, setKind] = useState<'circo' | 'ville'>(itinerary.kind);
  const [notice, setNotice] = useState('');
  const [aRetirer, setARetirer] = useState<P | null>(null);
  const [supprTournee, setSupprTournee] = useState(false);
  const [, start] = useTransition();
  const full = panels.length >= MAX_PANELS;
  const modifie =
    name !== itinerary.name || city !== (itinerary.city ?? '') || kind !== itinerary.kind;

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
          `<div class="cn-marker">${i + 1}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
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
    start(async () => { await deletePanel(id, itinerary.id); });
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
    start(async () => { await movePanel(id, dir, itinerary.id); });
  }

  return (
    <div className="admin-xl">
      <Link href="/admin" className="lien-sobre" style={{ marginTop: 0, textDecoration: 'none' }}>
        ← Toutes les tournées
      </Link>

      <div className="carte-form" style={{ marginTop: 14 }}>
        <label className="champ" style={{ flex: '2 1 240px' }}>
          Nom de la tournée
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="champ" style={{ flex: '1 1 160px' }}>
          Commune
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Rezé" />
        </label>
        <div className="champ" style={{ flex: '1 1 200px' }}>
          Type
          <div className="seg">
            <button type="button" className={kind === 'ville' ? 'actif' : ''} onClick={() => setKind('ville')}>
              Commune
            </button>
            <button type="button" className={kind === 'circo' ? 'actif' : ''} onClick={() => setKind('circo')}>
              Circo
            </button>
          </div>
        </div>
        <button
          className={'btn ' + (modifie ? 'btn-violet' : '')}
          disabled={!modifie}
          onClick={() => start(async () => { await updateItinerary(itinerary.id, name, city, kind); })}
        >
          {modifie ? 'Enregistrer' : 'Enregistré ✓'}
        </button>
        <button className="btn-texte-danger" onClick={() => setSupprTournee(true)}>
          Supprimer
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '18px 0 8px' }}>
        <span className={'badge' + (full ? ' alerte' : '')}>
          {panels.length} / {MAX_PANELS} panneaux
        </span>
        <span style={{ fontSize: 13, color: 'var(--gris)' }}>
          {full
            ? `Limite de ${MAX_PANELS} atteinte (limite Google Maps). Retire un panneau pour en ajouter un autre.`
            : 'Clique sur la carte pour ajouter un panneau, glisse un marqueur pour le déplacer.'}
        </span>
        {notice && <span className="erreur">{notice}</span>}
      </div>

      <div className="editeur">
        <div className="editeur-carte" ref={mapEl} />
        <div className="editeur-liste">
          {panels.length === 0 && (
            <p style={{ color: 'var(--gris)', fontSize: 14 }}>
              Aucun panneau. Clique sur la carte pour en ajouter.
            </p>
          )}
          {panels.map((p, i) => (
            <div className="panneau-ligne" key={p.id}>
              <span className="ligne-num">{i + 1}</span>
              <input
                value={p.name}
                onChange={(e) => onNameChange(p.id, e.target.value)}
                onBlur={() => saveName(p.id)}
                aria-label={`Nom du panneau ${i + 1}`}
              />
              <button className="btn btn-carre" disabled={i === 0} onClick={() => onReorder(p.id, 'up')} title="Monter">
                ↑
              </button>
              <button
                className="btn btn-carre"
                disabled={i === panels.length - 1}
                onClick={() => onReorder(p.id, 'down')}
                title="Descendre"
              >
                ↓
              </button>
              <button className="btn btn-carre btn-texte-danger" onClick={() => setARetirer(p)} title="Retirer">
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {aRetirer && (
        <Confirm
          titre="Retirer le panneau"
          action="Retirer"
          texte={`« ${aRetirer.name} » sera retiré de cette tournée. S'il ne sert dans aucune autre tournée, le panneau sera supprimé du catalogue.`}
          onAnnuler={() => setARetirer(null)}
          onConfirmer={() => {
            const id = aRetirer.id;
            setARetirer(null);
            onDelete(id);
          }}
        />
      )}

      {supprTournee && (
        <Confirm
          titre="Supprimer la tournée"
          texte={`« ${itinerary.name} » sera supprimée. Ses panneaux sont conservés dans le catalogue et dans les autres tournées où ils servent.`}
          onAnnuler={() => setSupprTournee(false)}
          onConfirmer={() => {
            setSupprTournee(false);
            start(async () => {
              await deleteItinerary(itinerary.id);
              router.push('/admin');
            });
          }}
        />
      )}
    </div>
  );
}
