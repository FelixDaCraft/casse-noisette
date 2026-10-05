'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gmapsUrl, telegramUrl, type Mode } from '@/lib/maps';
import { A_REPASSER, ETAT, type EtatCourant } from '@/lib/etatsPanneau';
import type { Mesure } from './useOptimizedOrder';
import { useToast } from './admin/Toast';
import { useRecompense } from './Recompense';
import { FeuilleSignalement, LigneEtat, bilan, envoyerSignalement, type Etats } from './Signalement';

type Panel = { id: string; name: string; lat: number; lng: number };
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

const IconCheck = (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconDrapeau = (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 22V4c4-2 8 2 12 0v10c-4 2-8-2-12 0" />
  </svg>
);

/** Échappe un nom de rue avant de l'injecter dans le HTML d'une infobulle Leaflet. */
const html = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default function TourneeDetail({
  titre,
  kicker,
  panels,
  mode,
  modes,
  mesure,
  note,
  position,
  etats,
  maintenant,
  onSignale,
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
  /** État courant de chaque panneau (dernier signalement). */
  etats: Etats;
  maintenant: number;
  onSignale: (panelId: string, e: EtatCourant) => void;
  onRetour: () => void;
}) {
  // Panneau dont la feuille de signalement est ouverte (indice dans `panels`).
  const [aSignaler, setASignaler] = useState<number | null>(null);
  // Panneau en cours d'envoi par le bouton « J'ai collé ».
  const [collage, setCollage] = useState<string | null>(null);
  const { toast, element: toastEl } = useToast();
  const { montrer, element: recompenseEl } = useRecompense(toast);

  const jaiColle = async (p: Panel) => {
    setCollage(p.id);
    const err = await envoyerSignalement(p.id, 'colle', undefined, onSignale, (r) =>
      montrer(r, true, 'Merci ! Panneau marqué collé.'),
    );
    setCollage(null);
    if (err) toast(err);
  };

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  // Le tracé se redessine à chaque changement d'ordre : on lit les valeurs
  // courantes dans l'effet de dessin sans recréer la carte.
  const dataRef = useRef({ panels, position, etats });
  dataRef.current = { panels, position, etats };

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
  }, [panels, position, etats]);

  function dessiner() {
    const L = LRef.current;
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    const { panels: pts, position: pos, etats: ets } = dataRef.current;
    layer.clearLayers();

    // Tracé pointillé dans l'ordre de passage.
    if (pts.length > 1) {
      L.polyline(
        pts.map((p) => [p.lat, p.lng]),
        { color: '#4C0297', weight: 4, opacity: 0.9, dashArray: '2 8', lineCap: 'round' },
      ).addTo(layer);
    }

    // Le marqueur prend la couleur de l'état du panneau ; le toucher ouvre
    // directement la feuille de signalement.
    pts.forEach((p, i) => {
      const e = ets[p.id];
      const icon = L.divIcon({
        className: '',
        html: `<div class="cn-marker${e ? ` etat-${e.etat}` : ''}">${i + 1}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const nom = html(p.name || `Panneau ${i + 1}`);
      L.marker([p.lat, p.lng], { icon })
        .addTo(layer)
        .bindTooltip(e ? `${nom}<br><b>${ETAT[e.etat].libelle}</b>` : nom)
        .on('click', () => setASignaler(i));
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
  const etatTournee = bilan(panels.map((p) => p.id), etats);
  const colles = panels.filter((p) => etats[p.id]?.etat === 'colle').length;
  const enCours = aSignaler != null ? panels[aSignaler] : undefined;

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

        {(etatTournee.aRepasser > 0 || colles > 0) && (
          <p className="etat-resume">
            {etatTournee.aRepasser > 0 && (
              <span className="a-repasser">
                {etatTournee.aRepasser} à repasser
              </span>
            )}
            {colles > 0 && <span>{colles} collé{colles > 1 ? 's' : ''}</span>}
          </p>
        )}

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
          {panels.map((p, i) => {
            const e = etats[p.id];
            return (
              <li key={p.id} className="frise-panneau">
                <span className={'frise-rond' + (e ? ` etat-${e.etat}` : '')}>{i + 1}</span>
                <div className="frise-corps">
                  <span className="frise-nom">{p.name || `Panneau ${i + 1}`}</span>
                  <LigneEtat courant={e} maintenant={maintenant} />
                  <div className="frise-gestes">
                    <button
                      type="button"
                      className={'geste geste-colle' + (e?.etat === 'colle' ? ' fait' : '')}
                      onClick={() => jaiColle(p)}
                      disabled={collage === p.id}
                    >
                      {IconCheck}
                      {collage === p.id ? 'Envoi…' : 'J’ai collé'}
                    </button>
                    <button type="button" className="geste" onClick={() => setASignaler(i)}>
                      {IconDrapeau}
                      Signaler
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {enCours && (
        <FeuilleSignalement
          panneau={{ id: enCours.id, name: enCours.name, num: aSignaler! + 1 }}
          courant={etats[enCours.id]}
          maintenant={maintenant}
          onSignale={onSignale}
          onRecompense={(r, etat) =>
            montrer(
              r,
              etat === 'colle',
              A_REPASSER.has(etat) ? 'Signalé : le panneau est à repasser.' : 'Merci, c’est noté.',
            )
          }
          onFermer={() => setASignaler(null)}
        />
      )}
      {recompenseEl ?? toastEl}

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
