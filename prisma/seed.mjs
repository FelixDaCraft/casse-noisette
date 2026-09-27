// Seed : crée l'admin initial (si aucun) + importe les itinéraires (si base vide).
// Idempotent : ne fait rien si les données existent déjà.
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  // 1) Admin initial
  if ((await prisma.admin.count()) === 0) {
    const email = (process.env.SEED_ADMIN_EMAIL || 'admin@casse-noisette.local').toLowerCase();
    const pw = process.env.SEED_ADMIN_PASSWORD;
    if (!pw) {
      console.error('SEED_ADMIN_PASSWORD requis pour créer le premier admin.');
      process.exit(1);
    }
    await prisma.admin.create({ data: { email, passwordHash: hashPassword(pw) } });
    console.log(`Admin créé : ${email}`);
  } else {
    console.log('Admin(s) déjà présents — pas de création.');
  }

  // 2) Itinéraires (uniquement si la base est vide)
  if ((await prisma.itinerary.count()) === 0) {
    const data = JSON.parse(readFileSync(join(__dirname, 'seed-data.json'), 'utf-8'));
    let pos = 0;
    for (const it of data) {
      // Un panneau est un lieu autonome ; l'itinéraire le référence via un arrêt.
      await prisma.itinerary.create({
        data: {
          name: it.name,
          city: it.city ?? null,
          kind: 'circo',
          position: pos++,
          stops: {
            create: it.panels.map((p, i) => ({
              position: i,
              panel: { create: { name: p.name, lat: p.lat, lng: p.lng, city: it.city ?? null } },
            })),
          },
        },
      });
    }
    console.log(`${data.length} itinéraires importés.`);
  } else {
    console.log('Itinéraires déjà présents — pas d\'import.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
