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
    include: { panels: { orderBy: { position: 'asc' } } },
  });
  if (!it) notFound();
  return (
    <Editor
      itinerary={{
        id: it.id,
        name: it.name,
        city: it.city,
        panels: it.panels.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
      }}
    />
  );
}
