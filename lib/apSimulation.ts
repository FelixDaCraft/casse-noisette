import type { ProfilAP } from '@/lib/actionPopulaire';

/* Faux comptes Action Populaire pour la simulation. Noms, emails et
   identifiants sont inventés ; les groupes reprennent la forme de l'API d'AP
   (type L = local, D = boucle départementale). Plusieurs comptes en
   Loire-Atlantique, où sont les tournées, et d'autres ailleurs pour préparer
   l'ouverture à toute la France. Le dernier sert à vérifier le refus. */
export const COMPTES_SIMULES: ProfilAP[] = [
  {
    apId: '7b1e2c4a-0001-4d2e-9a10-5c3f00000001',
    email: 'camille.legoff@exemple.fr',
    prenom: 'Camille',
    nom: 'Le Goff',
    nomAffiche: 'Camille L.',
    image: null,
    departement: '44',
    codePostal: '44400',
    commune: 'Rezé',
    groupes: [
      { apId: 'a0000000-0044-4000-8000-000000000001', nom: 'GA Rezé', type: 'L', departement: '44', commune: 'Rezé', role: 'animateur' },
      { apId: 'a0000000-0044-4000-8000-0000000000d0', nom: 'Boucle départementale Loire-Atlantique', type: 'D', departement: '44', commune: 'Nantes', role: 'membre' },
    ],
  },
  {
    apId: '7b1e2c4a-0002-4d2e-9a10-5c3f00000002',
    email: 'yanis.benali@exemple.fr',
    prenom: 'Yanis',
    nom: 'Benali',
    nomAffiche: 'Yanis B.',
    image: null,
    departement: '44',
    codePostal: '44340',
    commune: 'Bouguenais',
    groupes: [
      { apId: 'a0000000-0044-4000-8000-000000000002', nom: 'GA Bouguenais', type: 'L', departement: '44', commune: 'Bouguenais', role: 'gestionnaire' },
    ],
  },
  {
    apId: '7b1e2c4a-0003-4d2e-9a10-5c3f00000003',
    email: 'maelle.guerin@exemple.fr',
    prenom: 'Maëlle',
    nom: 'Guérin',
    nomAffiche: 'Maëlle G.',
    image: null,
    departement: '44',
    codePostal: '44000',
    commune: 'Nantes',
    groupes: [
      { apId: 'a0000000-0044-4000-8000-000000000003', nom: 'GA Nantes Centre', type: 'L', departement: '44', commune: 'Nantes', role: 'membre' },
      { apId: 'a0000000-0044-4000-8000-000000000004', nom: 'GA Nantes Malakoff – Saint-Donatien', type: 'L', departement: '44', commune: 'Nantes', role: 'membre' },
    ],
  },
  {
    apId: '7b1e2c4a-0004-4d2e-9a10-5c3f00000004',
    email: 'ines.moreau@exemple.fr',
    prenom: 'Inès',
    nom: 'Moreau',
    nomAffiche: 'Inès M.',
    image: null,
    departement: '75',
    codePostal: '75011',
    commune: 'Paris',
    groupes: [
      { apId: 'a0000000-0075-4000-8000-000000000001', nom: 'GA Paris 11e – Folie-Méricourt', type: 'L', departement: '75', commune: 'Paris', role: 'animateur' },
    ],
  },
  {
    apId: '7b1e2c4a-0005-4d2e-9a10-5c3f00000005',
    email: 'lucas.fontaine@exemple.fr',
    prenom: 'Lucas',
    nom: 'Fontaine',
    nomAffiche: 'Lucas F.',
    image: null,
    departement: '69',
    codePostal: '69100',
    commune: 'Villeurbanne',
    groupes: [
      { apId: 'a0000000-0069-4000-8000-000000000001', nom: 'GA Villeurbanne Gratte-Ciel', type: 'L', departement: '69', commune: 'Villeurbanne', role: 'membre' },
    ],
  },
  {
    apId: '7b1e2c4a-0006-4d2e-9a10-5c3f00000006',
    email: 'sofia.aitkaci@exemple.fr',
    prenom: 'Sofia',
    nom: 'Aït-Kaci',
    nomAffiche: 'Sofia A.',
    image: null,
    departement: '13',
    codePostal: '13003',
    commune: 'Marseille',
    groupes: [
      { apId: 'a0000000-0013-4000-8000-000000000001', nom: 'GA Marseille 3e – Belle de Mai', type: 'L', departement: '13', commune: 'Marseille', role: 'gestionnaire' },
    ],
  },
  {
    apId: '7b1e2c4a-0007-4d2e-9a10-5c3f00000007',
    email: 'hugo.lambert@exemple.fr',
    prenom: 'Hugo',
    nom: 'Lambert',
    nomAffiche: 'Hugo L.',
    image: null,
    departement: '33',
    codePostal: '33100',
    commune: 'Bordeaux',
    groupes: [
      { apId: 'a0000000-0033-4000-8000-000000000001', nom: 'GA Bordeaux Bastide', type: 'L', departement: '33', commune: 'Bordeaux', role: 'membre' },
    ],
  },
  {
    apId: '7b1e2c4a-0008-4d2e-9a10-5c3f00000008',
    email: 'nadia.vandamme@exemple.fr',
    prenom: 'Nadia',
    nom: 'Vandamme',
    nomAffiche: 'Nadia V.',
    image: null,
    departement: '59',
    codePostal: '59000',
    commune: 'Lille',
    groupes: [
      { apId: 'a0000000-0059-4000-8000-000000000001', nom: 'GA Lille Wazemmes', type: 'L', departement: '59', commune: 'Lille', role: 'membre' },
      { apId: 'a0000000-0059-4000-8000-0000000000d0', nom: 'Boucle départementale Nord', type: 'D', departement: '59', commune: 'Lille', role: 'membre' },
    ],
  },
  {
    // Inscrit sur AP mais membre d'aucun groupe d'action : AP répond
    // `not_a_group_member`, la connexion doit être refusée.
    apId: '7b1e2c4a-0009-4d2e-9a10-5c3f00000009',
    email: 'paul.simon@exemple.fr',
    prenom: 'Paul',
    nom: 'Simon',
    nomAffiche: 'Paul S.',
    image: null,
    departement: '44',
    codePostal: '44800',
    commune: 'Saint-Herblain',
    groupes: [],
  },
];
