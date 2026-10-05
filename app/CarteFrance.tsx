'use client';
import { useRef } from 'react';
import { DEPARTEMENTS } from '@/lib/departements';
import type { StatsDep } from '@/lib/indexFrance';
import carte from './carteFrance.json';

/* Carte de France en SVG inline, générée par scripts/generer-carte-france.mjs.
   Pas de Leaflet ici : il ne s'agit pas de se repérer dans les rues mais de
   toucher son département, et un dessin fixe s'affiche sans tuiles ni réseau.

   Au doigt, un premier toucher sélectionne (on lit le nombre de tournées), le
   second ouvre. À la souris, le survol renseigne et le clic ouvre aussitôt. */

type Forme = { code: string; d: string; encart?: boolean };
type Cadre = { x: number; y: number; w: number; h: number; libelle: string };
const FORMES = carte.formes as Forme[];
const CADRES = carte.cadres as Cadre[];

export const pluriel = (n: number, mot: string, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;

export default function CarteFrance({
  stats,
  choisi,
  survol,
  monDep,
  onChoisir,
  onSurvol,
}: {
  stats: StatsDep;
  choisi: string | null;
  survol: string | null;
  monDep: string | null;
  /** `direct` : clic souris ou second toucher, on ouvre sans attendre. */
  onChoisir: (code: string, direct: boolean) => void;
  onSurvol: (code: string | null) => void;
}) {
  const souris = useRef(false);

  // Le département choisi et celui du militant passent au premier plan : leur
  // contour ne doit pas disparaître sous celui des voisins.
  const devant = (f: Forme) => Number(f.code === choisi) * 2 + Number(f.code === monDep);
  const formes = [...FORMES].sort((a, b) => devant(a) - devant(b));

  const classe = (code: string) =>
    'dep' +
    (stats[code] ? ' avec' : '') +
    (code === choisi ? ' choisi' : '') +
    (code === survol ? ' survol' : '') +
    (code === monDep ? ' moi' : '');

  const libelle = (code: string) => {
    const s = stats[code];
    const nom = `${DEPARTEMENTS[code] ?? code} (${code})`;
    return s ? `${nom} : ${pluriel(s.tournees, 'tournée')}, ${pluriel(s.panneaux, 'panneau', 'panneaux')}` : `${nom} : pas encore de tournée`;
  };

  return (
    <svg
      className="carte-france-svg"
      viewBox={carte.viewBox}
      role="group"
      aria-label="Carte des départements"
      onPointerDown={(e) => (souris.current = e.pointerType === 'mouse')}
      onPointerLeave={() => onSurvol(null)}
    >
      {CADRES.map((c) => (
        <g key={c.libelle} aria-hidden="true">
          <rect className="encart" x={c.x} y={c.y} width={c.w} height={c.h} rx={14} />
          <text className="encart-libelle" x={c.x + c.w / 2} y={c.y + c.h - 11} textAnchor="middle">
            {c.libelle}
          </text>
        </g>
      ))}
      {formes.map((f) => {
        const actif = !!stats[f.code];
        return (
          <path
            key={f.code + (f.encart ? '-encart' : '')}
            className={classe(f.code)}
            d={f.d}
            role="button"
            // Au clavier, seuls les départements qui ont des tournées sont des
            // arrêts : tabuler à travers 101 tracés gris n'aiderait personne.
            tabIndex={actif ? 0 : -1}
            aria-label={libelle(f.code)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onSurvol(f.code)}
            onClick={() => onChoisir(f.code, souris.current || f.code === choisi)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChoisir(f.code, true);
              }
            }}
          >
            <title>{libelle(f.code)}</title>
          </path>
        );
      })}
    </svg>
  );
}
