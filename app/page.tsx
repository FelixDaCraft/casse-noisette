import { prisma } from '@/lib/db';
import { requireMilitant } from '@/lib/auth';
import ItineraryList from './ItineraryList';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const militant = await requireMilitant();
  const itineraries = await prisma.itinerary.findMany({
    orderBy: [{ kind: 'asc' }, { city: 'asc' }, { position: 'asc' }],
    include: { stops: { orderBy: { position: 'asc' }, include: { panel: true } } },
  });
  const data = itineraries.map((it) => ({
    id: it.id,
    name: it.name,
    city: it.city,
    kind: it.kind,
    panels: it.stops.map((s) => ({
      name: s.panel.name,
      lat: s.panel.lat,
      lng: s.panel.lng,
      city: s.panel.city,
    })),
  }));
  return (
    <ItineraryList
      itineraries={data}
      moi={{ nom: militant.displayName, image: militant.image }}
    />
  );
}
