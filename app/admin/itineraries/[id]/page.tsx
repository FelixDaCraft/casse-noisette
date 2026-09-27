import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import Editor from './Editor';

export const dynamic = 'force-dynamic';

export default async function EditItinerary({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const it = await prisma.itinerary.findUnique({
    where: { id },
    include: { stops: { orderBy: { position: 'asc' }, include: { panel: true } } },
  });
  if (!it) notFound();
  return (
    <Editor
      itinerary={{
        id: it.id,
        name: it.name,
        city: it.city,
        kind: it.kind,
        panels: it.stops.map((s) => ({ id: s.panel.id, name: s.panel.name, lat: s.panel.lat, lng: s.panel.lng })),
      }}
    />
  );
}
