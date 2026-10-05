// Activité de démonstration : des signalements réalistes sur quelques
// semaines, pour que classements, profils et badges aient l'air vivants.
//
//   node prisma/generer-activite-demo.mjs [--dry] [--supprimer]
//
// BASE DE DEV UNIQUEMENT : le script refuse de tourner si DATABASE_URL ne
// pointe pas sur une base locale dont le nom finit par « _dev ».
//
// - Les comptes simulés de Loire-Atlantique (Camille, Yanis, Maëlle, ceux de
//   lib/apSimulation.ts) sont créés s'ils n'existent pas encore, comme à leur
//   première connexion ; d'autres militants de démo (apId « demo-… ») et
//   quelques groupes d'action (apId « demo-… ») s'y ajoutent.
// - Les signalements générés ont un id « demo-… » : relancer le script les
//   efface puis les recrée (même graine, mêmes tirages) ; --supprimer efface
//   tout ce que le script a créé — signalements, militants et groupes de
//   démo — sans toucher aux comptes simulés ni aux vrais signalements.
//
// Chaque militant a ses communes, un rythme de sorties (plus le week-end),
// et un tempérament : couche-tard, vigie (signale les tags), gardien·ne
// (repasse chaque semaine au même panneau). Une sortie de collage suit une
// tournée dans l'ordre, 4 à 10 minutes entre deux panneaux, et ne va pas
// toujours au bout ; une sortie de vérification constate l'état des
// affiches. Les points ne sont pas écrits : ils se recalculent des
// signalements (lib/points.ts), comme pour les vrais.
import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry');
const SUPPRIMER = process.argv.includes('--supprimer');
const PREFIXE = 'demo-';
const JOURS = 35;

// Prisma lit .env tout seul, mais la garde ci-dessous doit le lire avant lui.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
  } catch {}
}
const url = process.env.DATABASE_URL ?? '';
const base = url.match(/@([^:/]+)(?::\d+)?\/([^?]+)/);
if (!base || !['127.0.0.1', 'localhost'].includes(base[1]) || !base[2].endsWith('_dev')) {
  console.error(`Refusé : DATABASE_URL ne désigne pas une base de dev locale (${base ? `${base[1]}/${base[2]}` : 'illisible'}).`);
  process.exit(1);
}

const { COMPTES_SIMULES } = await import('../lib/apSimulation.ts');
const prisma = new PrismaClient();

/* Tirages reproductibles (mulberry32) : relancer donne la même activité. */
let graine = 2027;
function hasard() {
  graine = (graine + 0x6d2b79f5) | 0;
  let t = graine;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a, b) => a + hasard() * (b - a);
const parmi = (l) => l[Math.floor(hasard() * l.length)];

const GA = {
  reze: 'a0000000-0044-4000-8000-000000000001',
  bouguenais: 'a0000000-0044-4000-8000-000000000002',
  nantesCentre: 'a0000000-0044-4000-8000-000000000003',
};
const GROUPES_DEMO = [
  { apId: 'demo-ga-saint-nazaire', name: 'GA Saint-Nazaire Centre', city: 'Saint-Nazaire' },
  { apId: 'demo-ga-saint-herblain', name: 'GA Saint-Herblain Bourg', city: 'Saint-Herblain' },
  { apId: 'demo-ga-coueron', name: 'GA Couëron', city: 'Couëron' },
  { apId: 'demo-ga-nantes-nord', name: 'GA Nantes Nord', city: 'Nantes' },
];

// rythme : probabilité d'une sortie un jour de semaine ; nuit : part des
// sorties après 22 h ; vigie : probabilité de trouver (et signaler) un tag.
const PERSONNES = [
  { apId: '7b1e2c4a-0001-4d2e-9a10-5c3f00000001', communes: ['Rezé', 'Bouaye'], rythme: 0.32, nuit: 0.1, vigie: 0.03, gardien: true },
  { apId: '7b1e2c4a-0002-4d2e-9a10-5c3f00000002', communes: ['Bouguenais', 'Indre', 'Saint-Jean-de-Boiseau'], rythme: 0.28, nuit: 0.6, vigie: 0.02 },
  { apId: '7b1e2c4a-0003-4d2e-9a10-5c3f00000003', communes: ['Nantes · Centre-ville', 'Nantes · Malakoff - Saint-Donatien'], rythme: 0.22, nuit: 0.15, vigie: 0.06 },
  { apId: 'demo-m-01', prenom: 'Léa', nom: 'Kerboul', groupes: [['demo-ga-saint-nazaire', 'animateur']], communes: ['Saint-Nazaire'], rythme: 0.38, nuit: 0.1, vigie: 0.03 },
  { apId: 'demo-m-02', prenom: 'Mathis', nom: 'Le Bihan', groupes: [['demo-ga-saint-nazaire', 'membre']], communes: ['Saint-Nazaire'], rythme: 0.18, nuit: 0.4, vigie: 0.02 },
  { apId: 'demo-m-03', prenom: 'Aminata', nom: 'Diallo', groupes: [['demo-ga-saint-herblain', 'animateur']], communes: ['Saint-Herblain', 'Orvault'], rythme: 0.3, nuit: 0.05, vigie: 0.05, gardien: true },
  { apId: 'demo-m-04', prenom: 'Thomas', nom: 'Riou', groupes: [['demo-ga-saint-herblain', 'membre']], communes: ['Saint-Herblain'], rythme: 0.12, nuit: 0.2, vigie: 0.02 },
  { apId: 'demo-m-05', prenom: 'Jules', nom: 'Perrin', groupes: [[GA.reze, 'membre']], communes: ['Rezé'], rythme: 0.18, nuit: 0.2, vigie: 0.02 },
  { apId: 'demo-m-06', prenom: 'Inaya', nom: 'Chérif', groupes: [[GA.reze, 'membre']], communes: ['Rezé', 'Les Sorinières'], rythme: 0.14, nuit: 0.5, vigie: 0.04 },
  { apId: 'demo-m-07', prenom: 'Rose', nom: 'Garnier', groupes: [[GA.bouguenais, 'membre']], communes: ['Bouguenais'], rythme: 0.1, nuit: 0, vigie: 0.02 },
  { apId: 'demo-m-08', prenom: 'Malik', nom: 'Haddad', groupes: [[GA.nantesCentre, 'gestionnaire']], communes: ['Nantes · Centre-ville', 'Nantes · Île de Nantes'], rythme: 0.28, nuit: 0.25, vigie: 0.12 },
  { apId: 'demo-m-09', prenom: 'Chloé', nom: 'Tessier', groupes: [[GA.nantesCentre, 'membre']], communes: ['Nantes · Hauts-Pavés - Saint-Félix'], rythme: 0.14, nuit: 0.1, vigie: 0.02 },
  { apId: 'demo-m-10', prenom: 'Bastien', nom: 'Morvan', groupes: [['demo-ga-coueron', 'animateur']], communes: ['Couëron'], rythme: 0.3, nuit: 0.3, vigie: 0.02 },
  { apId: 'demo-m-11', prenom: 'Sarah', nom: 'Ben Youssef', groupes: [['demo-ga-nantes-nord', 'animateur']], communes: ['Nantes · Nantes Nord', 'Nantes · Nantes Erdre'], rythme: 0.24, nuit: 0.1, vigie: 0.06 },
  { apId: 'demo-m-12', prenom: 'Kevin', nom: 'Le Floch', groupes: [['demo-ga-nantes-nord', 'membre']], communes: ['Nantes · Nantes Nord'], rythme: 0.08, nuit: 0.3, vigie: 0.02 },
];

/** Heure de Paris -> Date. Approximation suffisante pour une démo : UTC+2
 *  jusqu'au dernier dimanche d'octobre, UTC+1 ensuite. */
function aParis(jour, heureDecimale) {
  const [a, m, j] = jour;
  const ete = m < 10 || (m === 10 && j < 25);
  return new Date(Date.UTC(a, m - 1, j) + (heureDecimale - (ete ? 2 : 1)) * 3600_000);
}

async function militants() {
  const groupes = new Map();
  for (const g of COMPTES_SIMULES.flatMap((c) => c.groupes)) {
    groupes.set(g.apId, { apId: g.apId, name: g.nom, type: g.type, department: g.departement, city: g.commune });
  }
  for (const g of GROUPES_DEMO) groupes.set(g.apId, { ...g, type: 'L', department: '44' });

  const idGroupe = new Map();
  const ids = new Map();
  for (const p of PERSONNES) {
    const simule = COMPTES_SIMULES.find((c) => c.apId === p.apId);
    const fiche = simule
      ? {
          email: simule.email, firstName: simule.prenom, lastName: simule.nom, displayName: simule.nomAffiche,
          department: simule.departement, postalCode: simule.codePostal, city: simule.commune,
        }
      : {
          email: null, firstName: p.prenom, lastName: p.nom, displayName: `${p.prenom} ${p.nom[0]}.`,
          department: '44', postalCode: null, city: p.communes[0].split(' · ')[0],
        };
    const liens = simule ? simule.groupes.map((g) => [g.apId, g.role]) : p.groupes;
    if (DRY) {
      ids.set(p.apId, p.apId);
      continue;
    }
    // Un compte simulé déjà connecté n'est pas modifié : AP fait foi.
    const m = await prisma.militant.upsert({ where: { apId: p.apId }, create: { apId: p.apId, ...fiche }, update: {} });
    ids.set(p.apId, m.id);
    for (const [apId, role] of liens) {
      if (!idGroupe.has(apId)) {
        const g = groupes.get(apId);
        const { apId: _, ...data } = g;
        const row = await prisma.actionGroup.upsert({ where: { apId }, create: { apId, ...data }, update: {} });
        idGroupe.set(apId, row.id);
      }
      await prisma.membership.upsert({
        where: { militantId_groupId: { militantId: m.id, groupId: idGroupe.get(apId) } },
        create: { militantId: m.id, groupId: idGroupe.get(apId), role },
        update: {},
      });
    }
  }
  return ids;
}

function generer(personnes, toursParCommune) {
  const maintenant = Date.now();
  const aujourdHui = new Date();
  const evts = [];
  for (const p of personnes) {
    const tours = p.communes.flatMap((c) => toursParCommune.get(c) ?? []);
    if (!tours.length) {
      console.warn(`  ${p.apId} : aucune tournée pour ${p.communes.join(', ')}`);
      continue;
    }
    const colleesPar = new Set();
    const ajoute = (panelId, status, t, comment = null) => {
      if (t.getTime() < maintenant - 20 * 60_000) evts.push({ militant: p.apId, panelId, status, createdAt: t, comment });
    };
    for (let d = JOURS; d >= 0; d--) {
      const date = new Date(aujourdHui.getTime() - d * 86400_000);
      const jour = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
      const weekEnd = [0, 6].includes(date.getUTCDay());
      const r = hasard();
      const rythme = p.rythme * (weekEnd ? 1.6 : 1);

      if (r < rythme) {
        // Sortie de collage, dans l'ordre de la tournée.
        const tour = parmi(tours);
        const nuit = hasard() < p.nuit;
        let t = aParis(jour, nuit ? entre(22, 23.6) : entre(17.5, 20.5)).getTime();
        const complete = hasard() < 0.7;
        const n = complete ? tour.length : Math.max(1, Math.floor(entre(1, tour.length)));
        for (let i = 0; i < n; i++) {
          if (i) t += entre(4, 10) * 60_000;
          const panelId = tour[i];
          const x = hasard();
          if (x < p.vigie) {
            ajoute(panelId, 'tague', new Date(t), parmi([null, 'Croix gammée, photo prise', 'Tag « RN » sur l’affiche', 'Insulte, photographiée']));
            t += entre(3, 6) * 60_000;
          } else if (x < p.vigie + 0.1) {
            ajoute(panelId, 'vide', new Date(t));
            t += entre(2, 4) * 60_000;
          } else if (x < p.vigie + 0.18) {
            ajoute(panelId, 'recouvert', new Date(t), parmi([null, 'Affiche RN par-dessus', 'Concert recouvert']));
            t += entre(2, 4) * 60_000;
          } else if (x < p.vigie + 0.2) {
            ajoute(panelId, 'arrache', new Date(t));
            t += entre(2, 4) * 60_000;
          } else if (x < p.vigie + 0.21) {
            ajoute(panelId, 'absent', new Date(t), 'Plus de panneau, juste les poteaux');
            continue;
          }
          ajoute(panelId, 'colle', new Date(t));
          colleesPar.add(tour);
        }
      } else if (r < rythme * 1.4 && colleesPar.size) {
        // Vérification d'une tournée déjà collée : l'affiche tient-elle ?
        const tour = parmi([...colleesPar]);
        let t = aParis(jour, entre(8, 19)).getTime();
        for (const panelId of tour) {
          t += entre(3, 7) * 60_000;
          if (hasard() < 0.25) continue;
          const x = hasard();
          const st = x < p.vigie ? 'tague' : x < 0.6 ? 'colle' : x < 0.8 ? 'recouvert' : x < 0.9 ? 'arrache' : 'vide';
          ajoute(panelId, st, new Date(t));
        }
      }

      // Gardien·ne : chaque jeudi midi, le même panneau.
      if (p.gardien && date.getUTCDay() === 4) {
        ajoute(tours[0][0], hasard() < 0.75 ? 'colle' : 'recouvert', aParis(jour, entre(12, 13.5)));
      }
    }
  }
  return evts.sort((a, b) => a.createdAt - b.createdAt);
}

async function main() {
  const avant = await prisma.report.count({ where: { id: { startsWith: PREFIXE } } });
  if (!DRY) {
    await prisma.report.deleteMany({ where: { id: { startsWith: PREFIXE } } });
  }
  console.log(`${avant} signalement(s) de démo ${DRY ? 'à effacer' : 'effacé(s)'}.`);

  if (SUPPRIMER) {
    if (!DRY) {
      const m = await prisma.militant.deleteMany({ where: { apId: { startsWith: PREFIXE } } });
      const g = await prisma.actionGroup.deleteMany({ where: { apId: { startsWith: PREFIXE } } });
      console.log(`${m.count} militant(s) et ${g.count} groupe(s) de démo supprimés.`);
    }
    return;
  }

  const its = await prisma.itinerary.findMany({
    where: { department: '44', kind: 'ville' },
    orderBy: [{ city: 'asc' }, { position: 'asc' }],
    select: { city: true, stops: { orderBy: { position: 'asc' }, select: { panelId: true } } },
  });
  const toursParCommune = new Map();
  for (const it of its) {
    if (!toursParCommune.has(it.city)) toursParCommune.set(it.city, []);
    toursParCommune.get(it.city).push(it.stops.map((s) => s.panelId));
  }

  const ids = await militants();
  const evts = generer(PERSONNES, toursParCommune);
  const data = evts.map((e, i) => ({
    id: `${PREFIXE}${String(i + 1).padStart(5, '0')}`,
    panelId: e.panelId,
    militantId: ids.get(e.militant),
    status: e.status,
    comment: e.comment,
    createdAt: e.createdAt,
  }));

  const parEtat = {};
  for (const d of data) parEtat[d.status] = (parEtat[d.status] ?? 0) + 1;
  console.log(`${data.length} signalements sur ${JOURS} jours, ${PERSONNES.length} militants :`, parEtat);
  if (DRY) return console.log('(--dry : rien écrit)');
  for (let i = 0; i < data.length; i += 500) await prisma.report.createMany({ data: data.slice(i, i + 500) });
  console.log('Écrit. Effacer : node prisma/generer-activite-demo.mjs --supprimer');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
