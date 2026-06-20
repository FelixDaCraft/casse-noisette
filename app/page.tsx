import { prisma } from '@/lib/db';
import ItineraryList from './ItineraryList';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const itineraries = await prisma.itinerary.findMany({
    orderBy: [{ city: 'asc' }, { position: 'asc' }],
    include: { panels: { orderBy: { position: 'asc' } } },
  });
  const data = itineraries.map((it) => ({
    id: it.id,
    name: it.name,
    city: it.city,
    panels: it.panels.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
  }));
  return <ItineraryList itineraries={data} />;
}
