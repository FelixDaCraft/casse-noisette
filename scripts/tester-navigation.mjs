// Tests du guidage du mode « Tournée » et de l'export GPX.
//
//   node --test scripts/tester-navigation.mjs
//
// Pas de runner dans le projet : node:test suffit, et Node lit le TypeScript
// des modules purs (lib/guidage.ts, lib/gpx.ts) directement. Le suivi du
// tracé lui-même est celui de Ferrostar, testé chez lui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCROCHE_MAX_M,
  COSTING,
  distanceCourte,
  distanceM,
  dureeCourte,
  estArrive,
  etapeArrivee,
  horsCouverture,
  jusquAuPanneau,
  nettoyerConsigne,
  sansPoint,
} from '../lib/guidage.ts';
import { gpxTournee, nomFichierGpx, xml } from '../lib/gpx.ts';

const A = [47.2184, -1.5600];
const B = [47.2184, -1.5550]; // ~378 m à l'est de A

test('modes -> costing Valhalla', () => {
  assert.deepEqual(COSTING, { walking: 'pedestrian', bicycling: 'bicycle', driving: 'auto' });
});

test('consignes Valhalla nettoyées', () => {
  // Vraies sorties de Valhalla en fr-FR.
  assert.equal(
    nettoyerConsigne('Dans 50 mètres, Tournez à gauche dans Allée Cassard..'),
    'Dans 50 mètres, tournez à gauche dans Allée Cassard.',
  );
  assert.equal(
    nettoyerConsigne("Gardez la droite pour rester sur Allée d'Orléans. Ensuite, Tournez à droite dans Place de l'Écluse."),
    "Gardez la droite pour rester sur Allée d'Orléans. Ensuite, tournez à droite dans Place de l'Écluse.",
  );
  assert.equal(nettoyerConsigne('Tournez à gauche dans l’allée. Ensuite, Votre destination sera sur la droite.'),
    'Tournez à gauche dans l’allée. Ensuite, votre destination sera sur la droite.');
  // Ailleurs, une majuscule après une virgule est un nom de lieu : on n'y touche pas.
  assert.equal(nettoyerConsigne('Prenez la sortie vers A 83, Bordeaux.'), 'Prenez la sortie vers A 83, Bordeaux.');
  assert.equal(sansPoint('Tournez à droite dans Rue de Strasbourg.'), 'Tournez à droite dans Rue de Strasbourg');
});

// Étapes d'un itinéraire à deux panneaux, comme Ferrostar les lit d'une réponse
// Valhalla : l'arrivée au premier panneau est la manœuvre de fin de l'étape 2.
const v = (t) => [{ primaryContent: { maneuverType: t } }];
const etapes = [
  { distance: 100, duration: 70, visualInstructions: v('turn') },
  { distance: 250, duration: 180, visualInstructions: v('turn') },
  { distance: 30, duration: 20, visualInstructions: v('arrive') },
  { distance: 0, duration: 0, visualInstructions: [] }, // « Votre destination est sur la droite. »
  { distance: 400, duration: 290, visualInstructions: v('arrive') },
  { distance: 0, duration: 0, visualInstructions: [] },
];

test('jusqu’au prochain panneau', () => {
  assert.equal(etapeArrivee(etapes), 2);
  assert.equal(etapeArrivee([{ distance: 5, duration: 4, visualInstructions: [] }]), 0);
  // Au départ : toute la première jambe.
  assert.deepEqual(jusquAuPanneau(etapes, 2, 0, 100), { metres: 380, secondes: 270 });
  // À mi-chemin de l'étape 1 : la moitié de sa durée.
  assert.deepEqual(jusquAuPanneau(etapes, 2, 1, 125), { metres: 155, secondes: 110 });
  // Sur la dernière étape avant le panneau.
  assert.deepEqual(jusquAuPanneau(etapes, 2, 2, 12), { metres: 12, secondes: 8 });
  // Panneau dépassé (Ferrostar est passé à la jambe suivante).
  assert.deepEqual(jusquAuPanneau(etapes, 2, 4, 400), { metres: 0, secondes: 0 });
});

test('distances et durées', () => {
  assert.equal(distanceCourte(7), '10 m');
  assert.equal(distanceCourte(84), '80 m');
  assert.equal(distanceCourte(212), '200 m');
  assert.equal(distanceCourte(680), '700 m');
  assert.equal(distanceCourte(1234), '1,2 km');
  assert.equal(distanceCourte(15400), '15 km');
  assert.equal(dureeCourte(20), '1 min');
  assert.equal(dureeCourte(600), '10 min');
  assert.equal(dureeCourte(3900), '1 h 05');
});

test('arrivée et couverture', () => {
  assert.equal(estArrive(35, 'walking'), true);
  assert.equal(estArrive(45, 'walking'), false);
  assert.equal(estArrive(45, 'driving'), true);
  assert.equal(ACCROCHE_MAX_M, 300);
  assert.deepEqual(horsCouverture([31.3, 6.3, 1.6]), []);
  assert.deepEqual(horsCouverture([264751, 6.2]), [0]);
  assert.deepEqual(horsCouverture([5, 301, null]), [1, 2]);
  assert.ok(Math.abs(distanceM(A, B) - 378) < 3);
});

test('GPX : panneaux en waypoints et en route, XML échappé', () => {
  const g = gpxTournee(
    'Nantes · Centre <test> & "co"',
    [
      { name: 'Rue de la Commune — face au n°3', lat: 47.2184, lng: -1.5536 },
      { name: '', lat: 47.216, lng: -1.548 },
    ],
    new Date('2026-10-06T12:00:00Z'),
  );
  assert.ok(g.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1"'));
  assert.equal((g.match(/<wpt /g) ?? []).length, 2);
  assert.equal((g.match(/<rtept /g) ?? []).length, 2);
  assert.ok(g.includes('<wpt lat="47.218400" lon="-1.553600">'));
  assert.ok(g.includes('<name>1. Rue de la Commune — face au n°3</name>'));
  assert.ok(g.includes('<name>2. Panneau 2</name>'));
  assert.ok(g.includes('<name>Nantes · Centre &lt;test&gt; &amp; &quot;co&quot;</name>'));
  assert.ok(g.includes('<time>2026-10-06T12:00:00.000Z</time>'));
  assert.ok(g.trimEnd().endsWith('</gpx>'));
  assert.equal(xml('a\u0001b'), 'ab'); // caractères interdits en XML 1.0
  assert.equal(nomFichierGpx('Nantes · Centre-ville'), 'tournee-nantes-centre-ville.gpx');
  assert.equal(nomFichierGpx('···'), 'tournee-casse-noisette.gpx');
});
