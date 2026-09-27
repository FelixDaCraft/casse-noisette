// Renseigne la commune réelle de chaque panneau et ajoute les panneaux fournis
// par les itinéraires Rezé partagés (hors doublons).
//
// La commune vient de l'API officielle du découpage administratif : le champ
// `city` des itinéraires ne la donnait pas — une tournée « Saint-Sébastien »
// contient par exemple 10 panneaux situés à Nantes.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const prisma = new PrismaClient();
const SEUIL_DOUBLON_M = 30;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const hav = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

async function communeDe(lat, lng) {
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=nom`,
      { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j?.[0]?.nom ?? null;
  } catch { return null; }
}

async function main() {
  // 1) Commune réelle de chaque panneau
  const panneaux = await prisma.panel.findMany();
  let maj = 0;
  for (const p of panneaux) {
    if (p.city) continue;
    const c = await communeDe(p.lat, p.lng);
    if (c) { await prisma.panel.update({ where: { id: p.id }, data: { city: c } }); maj++; }
    await pause(120);
  }
  console.log(`[communes] ${maj} panneaux rattachés à leur commune réelle`);

  // 2) Panneaux issus des liens partagés, sans recréer ce qui existe déjà
  const ajouts = JSON.parse(readFileSync(new URL('./panneaux-reze.json', import.meta.url), 'utf8'));
  const tous = await prisma.panel.findMany();
  let crees = 0, ignores = 0;
  for (const a of ajouts) {
    if (tous.some((q) => hav(a, q) < SEUIL_DOUBLON_M)) { ignores++; continue; }
    const cree = await prisma.panel.create({
      data: { name: a.name, lat: a.lat, lng: a.lng, city: a.city ?? (await communeDe(a.lat, a.lng)) },
    });
    tous.push(cree); crees++;
  }
  console.log(`[ajouts] ${crees} panneaux créés, ${ignores} déjà présents (non dupliqués)`);

  const parVille = await prisma.panel.groupBy({ by: ['city'], _count: true });
  for (const v of parVille.sort((a, b) => b._count - a._count)) {
    console.log(`   ${String(v.city).padEnd(28)} ${v._count}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
