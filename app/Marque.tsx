/**
 * Icône de l'application, en HTML : panneau électoral crème sur deux pieds,
 * emplacement gauche avec le φ, emplacement droit avec le portrait en
 * bichromie violet/crème. Toutes les positions sont en pourcentage, donc une
 * seule taille suffit (`size`).
 *
 * Le filtre `duoViolet` mappe le noir vers #4C0297 et le blanc vers #FFFCF4 ;
 * il est défini une fois par page et référencé par son id.
 */
export function DuoVioletDef() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="duoViolet" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.298 0.298 1" />
            <feFuncG type="table" tableValues="0.008 0.008 0.988" />
            <feFuncB type="table" tableValues="0.592 0.592 0.957" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export default function Marque({ size = 40 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '22.27%',
        background: 'var(--rouge)',
        overflow: 'hidden',
      }}
    >
      {/* pieds du panneau */}
      <div style={{ position: 'absolute', left: '29.3%', top: '62.5%', width: '5.08%', height: '21.48%', background: 'var(--creme)' }} />
      <div style={{ position: 'absolute', left: '65.6%', top: '62.5%', width: '5.08%', height: '21.48%', background: 'var(--creme)' }} />
      {/* plateau */}
      <div style={{ position: 'absolute', left: '15.625%', top: '21.875%', width: '68.75%', height: '43.75%', borderRadius: 1.25, background: 'var(--creme)' }} />
      {/* emplacement gauche : φ */}
      <div style={{ position: 'absolute', left: '20.31%', top: '26.56%', width: '28.52%', height: '34.375%', borderRadius: 0.47, background: 'var(--violet)', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/phi.png" alt="" style={{ position: 'absolute', left: '15.07%', top: '13.07%', width: '69.86%', height: '73.86%', display: 'block' }} />
      </div>
      {/* emplacement droit : portrait bichromie */}
      <div style={{ position: 'absolute', left: '51.17%', top: '26.56%', width: '28.52%', height: '34.375%', borderRadius: 0.47, background: 'var(--violet)', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/jlm.jpeg"
          alt=""
          style={{ position: 'absolute', left: '-26.1%', top: '-4.5%', width: '210.9%', maxWidth: 'none', display: 'block', filter: 'url(#duoViolet)' }}
        />
      </div>
    </div>
  );
}
