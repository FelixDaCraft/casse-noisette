import { cookies } from 'next/headers';
import { requireMilitant } from '@/lib/auth';
import { DEP_COOKIE, codeDepartement } from '@/lib/departements';
import { indexFrance } from '@/lib/indexFrance';
import ChoixDepartement from '../ChoixDepartement';

export const dynamic = 'force-dynamic';

/** La carte de France, ouverte depuis la liste pour changer de département. */
export default async function CartePage() {
  const militant = await requireMilitant('/carte');
  const store = await cookies();
  const { stats, lieux } = await indexFrance();
  return (
    <ChoixDepartement
      stats={stats}
      lieux={lieux}
      moi={{ nom: militant.displayName, image: militant.image }}
      monDep={codeDepartement(militant.department)}
      actuel={codeDepartement(store.get(DEP_COOKIE)?.value)}
    />
  );
}
