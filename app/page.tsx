import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { requireMilitant } from '@/lib/auth';
import { DEPARTEMENTS, DEP_COOKIE, codeDepartement } from '@/lib/departements';
import { indexFrance } from '@/lib/indexFrance';
import { etatsCourants } from '@/lib/signalements';
import ItineraryList from './ItineraryList';
import ChoixDepartement from './ChoixDepartement';

export const dynamic = 'force-dynamic';

type Params = { [cle: string]: string | string[] | undefined };
const un = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/* Un département à la fois : à l'échelle du pays, charger toutes les tournées
   ferait des mégaoctets pour n'en afficher qu'une poignée. Le département vient
   de l'URL (choisi sur la carte), sinon du dernier consulté sur cet appareil,
   sinon de celui du militant. S'il n'a encore aucune tournée, on ouvre la carte
   de France avec un mot d'explication plutôt qu'une liste vide. */
export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const militant = await requireMilitant();
  const sp = await searchParams;
  const store = await cookies();
  const dep =
    codeDepartement(un(sp.dep)) ??
    codeDepartement(store.get(DEP_COOKIE)?.value) ??
    codeDepartement(militant.department);
  const moi = { nom: militant.displayName, image: militant.image };

  const itineraries = dep
    ? await prisma.itinerary.findMany({
        where: { department: dep, stops: { some: {} } },
        orderBy: [{ kind: 'asc' }, { city: 'asc' }, { position: 'asc' }],
        include: { stops: { orderBy: { position: 'asc' }, include: { panel: true } } },
      })
    : [];

  if (!dep || itineraries.length === 0) {
    const { stats, lieux } = await indexFrance();
    return (
      <ChoixDepartement
        stats={stats}
        lieux={lieux}
        moi={moi}
        monDep={codeDepartement(militant.department)}
        sansTournee={dep}
      />
    );
  }

  const data = itineraries.map((it) => ({
    id: it.id,
    name: it.name,
    city: it.city,
    kind: it.kind,
    panels: it.stops.map((s) => ({
      id: s.panel.id,
      name: s.panel.name,
      lat: s.panel.lat,
      lng: s.panel.lng,
      city: s.panel.city,
    })),
  }));
  // État courant de chaque panneau du département : la liste en tire ses
  // compteurs « à repasser », le détail ses pastilles.
  const etats = await etatsCourants([...new Set(data.flatMap((it) => it.panels.map((p) => p.id)))]);
  const vue = un(sp.vue);
  return (
    <ItineraryList
      // Changer de département ou suivre un résultat de recherche remet la
      // liste à zéro (vue, commune, détail) sur ce qui a été demandé.
      key={`${dep}|${vue ?? ''}|${un(sp.lieu) ?? ''}|${un(sp.filtre) ?? ''}`}
      itineraries={data}
      etats={etats}
      maintenant={Date.now()}
      moi={moi}
      departement={{ code: dep, nom: DEPARTEMENTS[dep] }}
      initial={{
        vue: vue === 'ville' || vue === 'circo' ? vue : undefined,
        lieu: un(sp.lieu),
        repasser: un(sp.filtre) === 'repasser',
      }}
    />
  );
}
