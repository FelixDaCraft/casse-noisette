'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createPanel, deletePanelEverywhere, updatePanel } from '../actions';
import Confirm from '../Confirm';
import { useToast } from '../Toast';
import Import from './Import';

export type Tournee = { id: string; name: string; city: string | null; count: number };
export type Panneau = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  tournees: { id: string; name: string }[];
};

/** Insensible aux accents et à la casse, pour la recherche. */
const plat = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function PanelsManager({
  panels,
  itineraries,
  max,
}: {
  panels: Panneau[];
  itineraries: Tournee[];
  max: number;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const { toast, element: toastEl } = useToast();
  const [q, setQ] = useState('');
  const [commune, setCommune] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [aSupprimer, setASupprimer] = useState<Panneau | null>(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [noms, setNoms] = useState<Record<string, string>>({});

  const communes = useMemo(
    () =>
      [...new Set(panels.map((p) => p.city?.trim() || 'Sans commune'))].sort((a, b) =>
        a.localeCompare(b, 'fr'),
      ),
    [panels],
  );
  const visibles = useMemo(() => {
    const t = plat(q.trim());
    return panels.filter(
      (p) =>
        (!commune || (p.city?.trim() || 'Sans commune') === commune) &&
        (!t || plat(p.name).includes(t) || plat(p.city ?? '').includes(t)),
    );
  }, [panels, q, commune]);
  const sansTournee = panels.filter((p) => p.tournees.length === 0).length;

  // ─── Carte ───────────────────────────────────────────────────────────────
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const etatRef = useRef({ visibles, selection });
  etatRef.current = { visibles, selection };

  useEffect(() => {
    let mort = false;
    import('leaflet').then((mod) => {
      const L: any = (mod as any).default ?? mod;
      if (mort || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(mapEl.current).setView([47.19, -1.55], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      map.on('click', (e: any) => ajouterAuPoint(e.latlng.lat, e.latlng.lng));
      dessiner();
      const pts = etatRef.current.visibles;
      if (pts.length > 1) map.fitBounds(pts.map((p) => [p.lat, p.lng]), { padding: [30, 30] });
    });
    return () => {
      mort = true;
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
  }, [visibles, selection]);

  function dessiner() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    const { visibles: pts, selection: sel } = etatRef.current;
    for (const p of pts) {
      const choisi = p.id === sel;
      const sans = p.tournees.length === 0;
      const html = choisi
        ? `<div class="pin-sel">${p.tournees.length || ''}</div>`
        : sans
          ? '<div class="pin-orphelin"></div>'
          : `<div class="pin-catalogue">${p.tournees.length}</div>`;
      const m = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: L.divIcon({ className: '', html, iconSize: [choisi ? 30 : 22, choisi ? 30 : 22], iconAnchor: [choisi ? 15 : 11, choisi ? 15 : 11] }),
      }).addTo(layer);
      m.bindTooltip(p.name);
      m.on('click', () => setSelection(p.id));
      m.on('dragend', () => {
        const ll = m.getLatLng();
        const lat = Math.round(ll.lat * 1e6) / 1e6;
        const lng = Math.round(ll.lng * 1e6) / 1e6;
        start(async () => {
          await updatePanel(p.id, { lat, lng });
          toast('Position enregistrée');
          router.refresh();
        });
      });
    }
  }

  function ajouterAuPoint(lat: number, lng: number) {
    const arrondi = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    start(async () => {
      const r = await createPanel({ name: 'Nouveau panneau', ...arrondi, city: commune === 'Sans commune' ? null : commune });
      toast(r.reused ? 'Un panneau existait déjà ici : réutilisé' : 'Panneau créé');
      setSelection(r.id);
      router.refresh();
    });
  }

  // Centre la carte sur le panneau sélectionné depuis la liste.
  useEffect(() => {
    const p = panels.find((x) => x.id === selection);
    if (p && mapRef.current) mapRef.current.panTo([p.lat, p.lng]);
  }, [selection, panels]);

  return (
    <div className="admin-xl">
      <div className="page-tete">
        <div>
          <div className="admin-kicker">
            {panels.length} panneaux · {sansTournee} sans tournée
          </div>
          <h1 className="admin-h1">Panneaux</h1>
        </div>
        <button className="btn btn-rouge" onClick={() => setImportOuvert((v) => !v)}>
          + Ajouter des panneaux
        </button>
      </div>
      <p className="admin-intro prose">
        Un panneau est un lieu, partagé entre les tournées : le renommer ou le déplacer ici le
        corrige partout.
      </p>

      {importOuvert && (
        <Import
          itineraries={itineraries}
          max={max}
          onFini={(msg) => {
            setImportOuvert(false);
            toast(msg);
            router.refresh();
          }}
          onFermer={() => setImportOuvert(false)}
        />
      )}

      <div style={{ margin: '18px 0 10px' }}>
        <input
          className="recherche"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une rue, une place…"
          aria-label="Rechercher un panneau"
        />
        <div className="chips" style={{ margin: '12px 0 0', padding: 0 }}>
          <button className={'chip' + (commune === null ? ' actif' : '')} onClick={() => setCommune(null)}>
            Toutes
          </button>
          {communes.map((c) => (
            <button key={c} className={'chip' + (commune === c ? ' actif' : '')} onClick={() => setCommune(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="legende">
          <span>
            <i className="pin-catalogue petit">2</i> dans des tournées (le chiffre = leur nombre)
          </span>
          <span>
            <i className="pin-orphelin petit" /> sans tournée
          </span>
        </div>
      </div>

      <div className="editeur">
        <div className="editeur-carte" ref={mapEl} />
        <div className="catalogue">
          {visibles.length === 0 && <p style={{ color: 'var(--gris)', fontSize: 14 }}>Aucun panneau.</p>}
          {visibles.map((p) => (
            <div
              key={p.id}
              className={'panneau-ligne' + (selection === p.id ? ' choisi' : '')}
              onClick={() => setSelection(p.id)}
            >
              <span className={p.tournees.length ? 'pin-catalogue petit' : 'pin-orphelin petit'}>
                {p.tournees.length || ''}
              </span>
              <input
                value={noms[p.id] ?? p.name}
                onChange={(e) => setNoms((n) => ({ ...n, [p.id]: e.target.value }))}
                onBlur={() => {
                  const v = noms[p.id];
                  if (v === undefined || v === p.name) return;
                  start(async () => {
                    await updatePanel(p.id, { name: v });
                    toast('Nom enregistré');
                    router.refresh();
                  });
                }}
                aria-label={`Nom de ${p.name}`}
              />
              <span className="panneau-ville">{p.city || '—'}</span>
              <span className="panneau-tournees">
                {p.tournees.length === 0 ? (
                  <span className="badge alerte">Aucune tournée</span>
                ) : (
                  <>
                    {p.tournees.slice(0, 2).map((t) => (
                      <Link
                        key={t.id}
                        className="badge"
                        href={`/admin/itineraries/${t.id}`}
                        title={t.name}
                      >
                        {t.name.replace(/^Itinéraire de\s+/i, '').split(' à ')[0]}
                      </Link>
                    ))}
                    {p.tournees.length > 2 && (
                      <span className="badge neutre">+{p.tournees.length - 2}</span>
                    )}
                  </>
                )}
              </span>
              <button className="btn btn-carre btn-texte-danger" onClick={() => setASupprimer(p)} title="Supprimer partout">
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {aSupprimer && (
        <Confirm
          titre="Supprimer le panneau"
          texte={
            aSupprimer.tournees.length
              ? `« ${aSupprimer.name} » sera retiré de ${aSupprimer.tournees.length} tournée${aSupprimer.tournees.length > 1 ? 's' : ''} et supprimé du catalogue.`
              : `« ${aSupprimer.name} » sera supprimé du catalogue.`
          }
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
