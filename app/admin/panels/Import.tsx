'use client';
import { useState, useTransition } from 'react';
import { parseCoord } from '@/lib/googleLink';
import { importPanels } from '../actions';
import type { Tournee } from './PanelsManager';

type Etape = {
  lat?: number;
  lng?: number;
  q?: string;
  name: string;
  etat: 'pret' | 'recherche' | 'introuvable';
  garde: boolean;
};

/** Centre approximatif de la circonscription, pour repérer une inversion lat/lng. */
const CENTRE = { lat: 47.19, lng: -1.55 };
const loin = (lat: number, lng: number) => {
  const dx = (lng - CENTRE.lng) * 75;
  const dy = (lat - CENTRE.lat) * 111;
  return Math.hypot(dx, dy) > 25;
};

export default function Import({
  itineraries,
  max,
  onFini,
  onFermer,
}: {
  itineraries: Tournee[];
  max: number;
  onFini: (message: string) => void;
  onFermer: () => void;
}) {
  const [onglet, setOnglet] = useState<'gps' | 'lien'>('gps');
  const [pending, start] = useTransition();
  const [cible, setCible] = useState('catalog');
  const [ville, setVille] = useState('');

  // ─── Mode coordonnées ────────────────────────────────────────────────────
  const [saisie, setSaisie] = useState('');
  const [nomGps, setNomGps] = useState('');
  const [nomTouche, setNomTouche] = useState(false);
  const coord = parseCoord(saisie);

  async function nommerDepuis(lat: number, lng: number) {
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
      if (!r.ok) return;
      const j = await r.json();
      if (!nomTouche && j.road) setNomGps(j.road);
      if (!ville && j.city) setVille(j.city);
    } catch {
      /* le nom reste à saisir à la main */
    }
  }

  function maPosition() {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        const lat = +p.coords.latitude.toFixed(6);
        const lng = +p.coords.longitude.toFixed(6);
        setSaisie(`${lat}, ${lng}`);
        nommerDepuis(lat, lng);
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // ─── Mode lien Google Maps ───────────────────────────────────────────────
  const [lien, setLien] = useState('');
  const [etapes, setEtapes] = useState<Etape[]>([]);
  const [erreurLien, setErreurLien] = useState('');

  async function analyser() {
    setErreurLien('');
    setEtapes([]);
    try {
      const r = await fetch('/api/resolve-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: lien }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErreurLien(j.error || 'Lien non reconnu.');
        return;
      }
      const base: Etape[] = j.points.map((p: any, i: number) => ({
        lat: p.lat,
        lng: p.lng,
        q: p.q,
        name: p.name || `Étape ${i + 1}`,
        etat: p.lat ? 'recherche' : 'recherche',
        garde: true,
      }));
      setEtapes(base);

      // Une étape à la fois : le géocodage est limité à une requête par seconde.
      for (let i = 0; i < base.length; i++) {
        const e = base[i];
        try {
          const url = e.lat
            ? `/api/geocode?lat=${e.lat}&lng=${e.lng}`
            : `/api/geocode?q=${encodeURIComponent(e.q || '')}`;
          const g = await fetch(url);
          if (!g.ok) throw new Error('404');
          const d = await g.json();
          setEtapes((prev) => {
            const c = [...prev];
            c[i] = {
              ...c[i],
              lat: c[i].lat ?? d.lat,
              lng: c[i].lng ?? d.lng,
              name: d.road || c[i].name,
              etat: (c[i].lat ?? d.lat) ? 'pret' : 'introuvable',
              garde: Boolean(c[i].lat ?? d.lat),
            };
            return c;
          });
          if (!ville && d.city) setVille(d.city);
        } catch {
          setEtapes((prev) => {
            const c = [...prev];
            c[i] = { ...c[i], etat: c[i].lat ? 'pret' : 'introuvable', garde: Boolean(c[i].lat) };
            return c;
          });
        }
      }
    } catch {
      setErreurLien('Impossible d’analyser ce lien.');
    }
  }

  // ─── Envoi ───────────────────────────────────────────────────────────────
  const retenues = etapes.filter((e) => e.garde && e.lat != null && e.lng != null);
  const placesLibres =
    cible === 'catalog' ? Infinity : cible === 'new' ? max : max - (itineraries.find((i) => i.id === cible)?.count ?? 0);
  const surplus = Math.max(0, (onglet === 'gps' ? (coord ? 1 : 0) : retenues.length) - placesLibres);

  function envoyer() {
    const points =
      onglet === 'gps'
        ? coord
          ? [{ name: nomGps.trim() || 'Nouveau panneau', lat: coord.lat, lng: coord.lng }]
          : []
        : retenues.map((e) => ({ name: e.name.trim() || 'Panneau', lat: e.lat!, lng: e.lng! }));
    if (!points.length) return;

    start(async () => {
      const r = await importPanels(points, cible, { city: ville.trim() || undefined });
      const bouts = [
        r.created ? `${r.created} créé${r.created > 1 ? 's' : ''}` : '',
        r.reused ? `${r.reused} déjà existant${r.reused > 1 ? 's' : ''} réutilisé${r.reused > 1 ? 's' : ''}` : '',
        r.attached ? `${r.attached} ajouté${r.attached > 1 ? 's' : ''} à la tournée` : '',
        r.skipped ? `${r.skipped} non ajouté${r.skipped > 1 ? 's' : ''} (limite ${max})` : '',
      ].filter(Boolean);
      onFini(bouts.join(' · ') || 'Rien à importer');
    });
  }

  return (
    <div className="import">
      <div className="import-tete">
        <div className="seg" style={{ maxWidth: 360 }}>
          <button className={onglet === 'gps' ? 'actif' : ''} onClick={() => setOnglet('gps')}>
            Coordonnées GPS
          </button>
          <button className={onglet === 'lien' ? 'actif' : ''} onClick={() => setOnglet('lien')}>
            Itinéraire Google Maps
          </button>
        </div>
        <button className="btn btn-sm" onClick={onFermer}>
          Fermer
        </button>
      </div>

      {onglet === 'gps' ? (
        <div className="import-corps">
          <label className="champ">
            Coordonnées
            <input
              className="mono"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              onBlur={() => coord && nommerDepuis(coord.lat, coord.lng)}
              placeholder="47.1872, -1.5512  ·  47°11'14&quot;N 1°33'04&quot;W  ·  lien Google"
            />
          </label>
          <div className="import-aide">
            {coord ? (
              <span className="ok">Position reconnue : {coord.lat}, {coord.lng}</span>
            ) : saisie.trim() ? (
              <span className="ko">
                Format non reconnu. Exemples : <code>47.1872, -1.5512</code> ·{' '}
                <code>47°11&apos;14&quot;N 1°33&apos;04&quot;W</code>
              </span>
            ) : (
              <span />
            )}
            <button className="btn btn-sm" onClick={maPosition}>
              Utiliser ma position
            </button>
          </div>
          {coord && loin(coord.lat, coord.lng) && (
            <p className="import-alerte">
              Ce point est à plus de 25 km de la circonscription : latitude et longitude sont
              peut-être inversées.
            </p>
          )}
          <label className="champ">
            Nom du panneau
            <input
              value={nomGps}
              onChange={(e) => {
                setNomGps(e.target.value);
                setNomTouche(true);
              }}
              placeholder="proposé automatiquement"
            />
          </label>
        </div>
      ) : (
        <div className="import-corps">
          <label className="champ">
            Lien de l’itinéraire
            <input
              className="mono"
              value={lien}
              onChange={(e) => setLien(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
            />
            <span className="aide">Dans Google Maps : Itinéraire → Partager → Copier le lien.</span>
          </label>
          <div className="import-aide">
            {erreurLien ? <span className="ko">{erreurLien}</span> : <span />}
            <button className="btn btn-sm" onClick={analyser} disabled={!lien.trim()}>
              Analyser le lien
            </button>
          </div>

          {etapes.length > 0 && (
            <div className="etapes">
              {etapes.map((e, i) => (
                <div className="etape" key={i}>
                  <input
                    type="checkbox"
                    checked={e.garde}
                    disabled={e.etat !== 'pret'}
                    onChange={(ev) =>
                      setEtapes((prev) => {
                        const c = [...prev];
                        c[i] = { ...c[i], garde: ev.target.checked };
                        return c;
                      })
                    }
                  />
                  <span className="etape-num">{i + 1}</span>
                  <input
                    value={e.name}
                    onChange={(ev) =>
                      setEtapes((prev) => {
                        const c = [...prev];
                        c[i] = { ...c[i], name: ev.target.value };
                        return c;
                      })
                    }
                  />
                  <span className={'etape-etat ' + e.etat}>
                    {e.etat === 'pret' ? 'Prêt' : e.etat === 'recherche' ? 'Recherche du nom…' : 'Introuvable'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="import-pied">
        <label className="champ" style={{ flex: '1 1 180px' }}>
          Commune
          <input value={ville} onChange={(e) => setVille(e.target.value)} placeholder="Rezé" />
        </label>
        <label className="champ" style={{ flex: '2 1 260px' }}>
          Ajouter à
          <select value={cible} onChange={(e) => setCible(e.target.value)}>
            <option value="catalog">Catalogue seulement</option>
            {onglet === 'lien' && <option value="new">Nouvelle tournée avec ces étapes</option>}
            {itineraries.map((i) => (
              <option key={i.id} value={i.id} disabled={i.count >= max}>
                {i.name} ({i.count}/{max})
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-violet"
          onClick={envoyer}
          disabled={pending || (onglet === 'gps' ? !coord : retenues.length === 0)}
        >
          {pending ? 'Import…' : 'Ajouter'}
        </button>
      </div>
      {surplus > 0 && (
        <p className="import-alerte">
          {surplus} point{surplus > 1 ? 's' : ''} de trop pour cette tournée (limite {max}) : le
          surplus restera au catalogue.
        </p>
      )}
    </div>
  );
}
