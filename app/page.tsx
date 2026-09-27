import { prisma } from '@/lib/db';
import ItineraryList from './ItineraryList';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const itineraries = await prisma.itinerary.findMany({
    orderBy: [{ kind: 'asc' }, { city: 'asc' }, { position: 'asc' }],
    include: { stops: { orderBy: { position: 'asc' }, include: { panel: true } } },
  });
  const data = itineraries.map((it) => ({
    id: it.id,
    name: it.name,
    city: it.city,
    kind: it.kind,
    panels: it.stops.map((s) => ({ name: s.panel.name, lat: s.panel.lat, lng: s.panel.lng })),
  }));
  return <ItineraryList itineraries={data} />;
}
