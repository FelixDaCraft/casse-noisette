import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createItinerary } from './actions';
import ItineraryAdminList from './ItineraryAdminList';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  await requireAdmin();
  const itineraries = await prisma.itinerary.findMany({
    orderBy: { position: 'asc' },
    include: { _count: { select: { panels: true } } },
  });
  return (
    <>
      <h1>Itinéraires</h1>
      <form action={createItinerary} className="panel row">
        <input className="grow" type="text" name="name" placeholder="Nom du nouvel itinéraire" required />
        <input type="text" name="city" placeholder="Ville" style={{ maxWidth: 180 }} />
        <button className="btn primary">+ Ajouter</button>
      </form>
      <ItineraryAdminList
        items={itineraries.map((i) => ({ id: i.id, name: i.name, city: i.city, count: i._count.panels }))}
      />
    </>
  );
}
