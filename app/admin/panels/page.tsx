import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MAX_PANELS } from '@/lib/maps';
import PanelsManager from './PanelsManager';

export const dynamic = 'force-dynamic';

export default async function PanelsPage() {
  await requireAdmin();
  const [panels, itineraries] = await Promise.all([
    prisma.panel.findMany({
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      include: { stops: { include: { itinerary: { select: { id: true, name: true } } } } },
    }),
    prisma.itinerary.findMany({
      orderBy: [{ kind: 'asc' }, { city: 'asc' }, { position: 'asc' }],
      include: { _count: { select: { stops: true } } },
    }),
  ]);

  return (
    <PanelsManager
      max={MAX_PANELS}
      panels={panels.map((p) => ({
        id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        city: p.city,
        tournees: p.stops.map((s) => ({ id: s.itinerary.id, name: s.itinerary.name })),
      }))}
      itineraries={itineraries.map((i) => ({
        id: i.id,
        name: i.name,
        city: i.city,
        count: i._count.stops,
      }))}
    />
  );
}
