// Remplit la ville (`city`) des itinéraires qui n'en ont pas, par géocodage inverse
// du 1ᵉʳ panneau (Nominatim / OpenStreetMap). Idempotent : ne touche que les vides.
// Usage : DATABASE_URL=... node scripts/geocode-cities.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickCity(a = {}) {
  return a.city || a.town || a.village || a.municipality || a.county || null;
}

async function main() {
  const its = await prisma.itinerary.findMany({
    where: { OR: [{ city: null }, { city: '' }] },
    include: { panels: { orderBy: { position: 'asc' }, take: 1 } },
  });
  console.log(`${its.length} itinéraire(s) sans ville.`);
  for (const it of its) {
    const p = it.panels[0];
    if (!p) {
      console.log(`- ${it.name} : aucun panneau, ignoré`);
      continue;
    }
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}&zoom=10&addressdetails=1`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'casse-noisette/1.0 (collage admin)' } });
      const j = await res.json();
      const city = pickCity(j.address);
      if (city) {
        await prisma.itinerary.update({ where: { id: it.id }, data: { city } });
        console.log(`- ${it.name} -> ${city}`);
      } else {
        console.log(`- ${it.name} : ville introuvable`);
      }
    } catch (e) {
      console.log(`- ${it.name} : erreur (${e.message})`);
    }
    await sleep(1100); // respect de la limite Nominatim (1 req/s)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
