import { requireAdmin } from '@/lib/auth';
import { panneauxAbsents } from '@/lib/signalements';
import AbsentsManager from './AbsentsManager';

export const dynamic = 'force-dynamic';

/* Panneaux que les militants disent disparus. Le terrain le voit avant nous :
   au-delà d'un signalement, c'est probablement vrai, et le garder dans les
   tournées enverrait chaque équipe coller sur du vide. */
export default async function AbsentsPage() {
  await requireAdmin();
  const absents = await panneauxAbsents();
  return (
    <AbsentsManager
      absents={absents.map((a) => ({ ...a, dernier: a.dernier.toISOString() }))}
      maintenant={Date.now()}
    />
  );
}
