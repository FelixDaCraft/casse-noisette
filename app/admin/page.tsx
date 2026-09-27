import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ItineraryAdminList from './ItineraryAdminList';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  await requireAdmin();
  const [itineraries, panneaux] = await Promise.all([
    prisma.itinerary.findMany({
      orderBy: [{ kind: 'asc' }, { city: 'asc' }, { position: 'asc' }],
      include: { _count: { select: { stops: true } } },
    }),
    prisma.panel.count(),
  ]);

  return (
    <div className="admin-large">
      <ItineraryAdminList
        total={{ tournees: itineraries.length, panneaux }}
        items={itineraries.map((i) => ({
          id: i.id,
          name: i.name,
          city: i.city,
          kind: i.kind,
          count: i._count.stops,
        }))}
      />
    </div>
  );
}
