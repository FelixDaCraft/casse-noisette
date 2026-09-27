// Migration : un panneau appartenait à un seul itinéraire ; il devient un lieu
// autonome, relié aux itinéraires par des `Stop` ordonnés.
//
// Idempotente et sans perte : elle ne s'exécute que si l'ancienne structure est
// encore là, et doit tourner AVANT `prisma db push` (qui, seul, supprimerait
// Panel.itineraryId après avoir créé une table Stop vide).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SEUIL_DOUBLON_M = 30;

const existeColonne = async (table, colonne) => {
  const r = await prisma.$queryRawUnsafe(
    `select 1 from information_schema.columns where table_name=$1 and column_name=$2 limit 1`,
    table, colonne,
  );
  return r.length > 0;
};

async function main() {
  const ancienne = await existeColonne('Panel', 'itineraryId');
  if (!ancienne) {
    console.log('[migrate-stops] structure déjà à jour, rien à faire');
    return;
  }
  console.log('[migrate-stops] ancienne structure détectée, migration…');

  await prisma.$executeRawUnsafe(`ALTER TABLE "Panel" ADD COLUMN IF NOT EXISTS "city" TEXT`);
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    CREATE TYPE "ItineraryKind" AS ENUM ('circo','ville');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Itinerary" ADD COLUMN IF NOT EXISTS "kind" "ItineraryKind" NOT NULL DEFAULT 'circo'`);

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Stop" (
    "id" TEXT PRIMARY KEY,
    "itineraryId" TEXT NOT NULL REFERENCES "Itinerary"("id") ON DELETE CASCADE,
    "panelId" TEXT NOT NULL REFERENCES "Panel"("id") ON DELETE CASCADE,
    "position" INTEGER NOT NULL DEFAULT 0
  )`);

  // Un passage par panneau, dans l'ordre d'origine.
  const inseres = await prisma.$executeRawUnsafe(`
    INSERT INTO "Stop" ("id", "itineraryId", "panelId", "position")
    SELECT md5(random()::text || p."id"), p."itineraryId", p."id", p."position"
    FROM "Panel" p
    WHERE NOT EXISTS (SELECT 1 FROM "Stop" s WHERE s."panelId" = p."id")
  `);
  console.log(`[migrate-stops] ${inseres} passages créés`);

  // Panneaux saisis deux fois au même endroit : on garde le plus ancien et on
  // rebranche les passages dessus, plutôt que de laisser un doublon en base.
  const doublons = await prisma.$queryRawUnsafe(`
    SELECT a."id" AS garde, b."id" AS jette
    FROM "Panel" a JOIN "Panel" b
      ON a."id" < b."id" AND a."name" = b."name"
     AND 2 * 6371000 * asin(sqrt(
           power(sin(radians(b."lat" - a."lat") / 2), 2) +
           cos(radians(a."lat")) * cos(radians(b."lat")) *
           power(sin(radians(b."lng" - a."lng") / 2), 2))) < ${SEUIL_DOUBLON_M}
  `);
  for (const d of doublons) {
    await prisma.$executeRawUnsafe(`UPDATE "Stop" SET "panelId" = $1 WHERE "panelId" = $2`, d.garde, d.jette);
    await prisma.$executeRawUnsafe(`DELETE FROM "Panel" WHERE "id" = $1`, d.jette);
  }
  if (doublons.length) console.log(`[migrate-stops] ${doublons.length} panneau(x) en double fusionné(s)`);

  // Deux passages d'un même itinéraire sur un même panneau n'ont pas de sens.
  await prisma.$executeRawUnsafe(`
    DELETE FROM "Stop" s USING "Stop" t
    WHERE s."itineraryId" = t."itineraryId" AND s."panelId" = t."panelId" AND s."id" > t."id"`);

  await prisma.$executeRawUnsafe(`ALTER TABLE "Panel" DROP COLUMN IF EXISTS "itineraryId"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Panel" DROP COLUMN IF EXISTS "position"`);

  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Stop_itineraryId_panelId_key" ON "Stop"("itineraryId","panelId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Stop_itineraryId_position_idx" ON "Stop"("itineraryId","position")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Stop_panelId_idx" ON "Stop"("panelId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Panel_city_idx" ON "Panel"("city")`);

  const [{ panneaux }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS panneaux FROM "Panel"`);
  const [{ passages }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS passages FROM "Stop"`);
  console.log(`[migrate-stops] terminé : ${panneaux} panneaux, ${passages} passages`);
}

main()
  .catch((e) => { console.error('[migrate-stops] échec :', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
