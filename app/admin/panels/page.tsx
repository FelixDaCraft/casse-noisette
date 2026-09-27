import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Catalogue des panneaux. Version de base : liste et rattachements.
 * La carte, la recherche et l'import GPS / Google Maps arrivent au lot suivant.
 */
export default async function PanelsPage() {
  await requireAdmin();
  const panels = await prisma.panel.findMany({
    orderBy: [{ city: 'asc' }, { name: 'asc' }],
    include: { stops: { include: { itinerary: { select: { id: true, name: true } } } } },
  });
  const sansTournee = panels.filter((p) => p.stops.length === 0).length;

  const groupes: { city: string; items: typeof panels }[] = [];
  for (const p of panels) {
    const c = p.city?.trim() || 'Sans commune';
    const last = groupes[groupes.length - 1];
    if (last && last.city === c) last.items.push(p);
    else groupes.push({ city: c, items: [p] });
  }

  return (
    <div className="admin-large">
      <div className="page-tete">
        <div>
          <div className="admin-kicker">
            {panels.length} panneaux · {sansTournee} sans tournée
          </div>
          <h1 className="admin-h1">Panneaux</h1>
        </div>
      </div>
      <p className="admin-intro prose">
        Un panneau est un lieu, partagé entre les tournées : le renommer ou le déplacer ici le
        corrige partout.
      </p>

      {groupes.map((g) => (
        <section className="groupe-admin" key={g.city}>
          <h2>
            {g.city} <span style={{ color: 'var(--gris)', fontWeight: 600 }}>{g.items.length}</span>
          </h2>
          {g.items.map((p) => (
            <div className="ligne" key={p.id}>
              <div className="ligne-txt">
                <span className="ligne-titre">{p.name}</span>
                <div className="ligne-sous">
                  {p.stops.length === 0 ? (
                    <span className="badge alerte">Aucune tournée</span>
                  ) : (
                    p.stops.map((s) => (
                      <Link key={s.id} className="badge" href={`/admin/itineraries/${s.itinerary.id}`}>
                        {s.itinerary.name}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
