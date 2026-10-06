// Tests des consignes de navigation et de la géométrie du guidage.
//
//   node --test scripts/tester-navigation.mjs
//
// Pas de runner dans le projet : node:test suffit, et Node lit le TypeScript
// des modules purs (lib/consignes.ts, lib/guidage.ts) directement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annonce,
  annonceDue,
  avecSuite,
  cardinal,
  consigne,
  distanceCourte,
  distanceParlee,
  dureeCourte,
  estSilencieuse,
  ordinal,
  voie,
} from '../lib/consignes.ts';
import {
  ACCROCHE_MAX_M,
  DetecteurEcart,
  cumul,
  distanceM,
  estArrive,
  horsCouverture,
  prochaineEtape,
  projeter,
  restant,
} from '../lib/guidage.ts';

test('voie : article selon le type de voie', () => {
  assert.equal(voie('Rue de la Commune'), 'la rue de la Commune');
  assert.equal(voie('Boulevard Jean Ingres'), 'le boulevard Jean Ingres');
  assert.equal(voie('Allée Duguay Trouin'), 'l’allée Duguay Trouin');
  assert.equal(voie('Avenue de la Gare'), 'l’avenue de la Gare');
  assert.equal(voie('Cours Franklin Roosevelt'), 'le cours Franklin Roosevelt');
  assert.equal(voie('Place du Commerce'), 'la place du Commerce');
  assert.equal(voie('Les Trois Croissants'), 'Les Trois Croissants');
  assert.equal(voie(''), '');
});

test('consigne : virages, avec et sans nom', () => {
  assert.equal(consigne({ type: 'turn', modifier: 'right', nom: 'Rue X' }), 'Tourne à droite sur la rue X');
  assert.equal(consigne({ type: 'turn', modifier: 'left' }), 'Tourne à gauche');
  assert.equal(consigne({ type: 'turn', modifier: 'slight left', nom: 'Quai de la Fosse' }), 'Tourne légèrement à gauche sur le quai de la Fosse');
  assert.equal(consigne({ type: 'turn', modifier: 'sharp right' }), 'Tourne fortement à droite');
  assert.equal(consigne({ type: 'turn', modifier: 'uturn' }), 'Fais demi-tour');
  assert.equal(consigne({ type: 'turn', modifier: 'straight', nom: 'Rue Y' }), 'Continue tout droit sur la rue Y');
});

test('consigne : départ, arrivée, nouveau nom, continue', () => {
  assert.equal(consigne({ type: 'depart', capApres: 51, nom: 'Rue du Chapeau Rouge' }), 'Pars vers le nord-est sur la rue du Chapeau Rouge');
  assert.equal(consigne({ type: 'depart', capApres: 180 }), 'Pars vers le sud');
  assert.equal(consigne({ type: 'arrive' }), 'Tu arrives au panneau');
  assert.equal(consigne({ type: 'arrive', modifier: 'left' }), 'Tu arrives au panneau, à gauche');
  assert.equal(consigne({ type: 'new name', modifier: 'straight', nom: 'Place du Commerce' }), 'Continue sur la place du Commerce');
  assert.equal(consigne({ type: 'new name', modifier: 'right', nom: 'Place du Commerce' }), 'Continue à droite sur la place du Commerce');
  assert.equal(consigne({ type: 'continue', modifier: 'left', nom: 'Rue de la Commune' }), 'Tourne à gauche pour rester sur la rue de la Commune');
  assert.equal(consigne({ type: 'continue', modifier: 'straight' }), 'Continue tout droit');
});

test('consigne : ronds-points, fourches, bretelles, fin de voie', () => {
  assert.equal(consigne({ type: 'roundabout', exit: 2, nom: 'Route de Vannes' }), 'Au rond-point, prends la deuxième sortie sur la route de Vannes');
  assert.equal(consigne({ type: 'rotary', exit: 1, rondPoint: 'Rond-Point de Paris' }), 'Au rond-point de Paris, prends la première sortie');
  assert.equal(consigne({ type: 'rotary', exit: 3, rondPoint: 'Place Viarme' }), 'Au rond-point Place Viarme, prends la troisième sortie');
  assert.equal(consigne({ type: 'off ramp', modifier: 'right', destinations: 'A 83: Bordeaux, Vertou, Rezé' }), 'Prends la sortie à droite direction Bordeaux, Vertou');
  assert.equal(consigne({ type: 'roundabout turn', modifier: 'right' }), 'Au rond-point, tourne à droite');
  assert.equal(consigne({ type: 'exit roundabout', nom: 'Rue Z' }), 'Sors du rond-point sur la rue Z');
  assert.equal(consigne({ type: 'fork', modifier: 'slight left' }), 'À l’embranchement, garde la gauche');
  assert.equal(consigne({ type: 'on ramp', modifier: 'right', ref: 'N 165' }), 'Prends la bretelle à droite sur N 165');
  assert.equal(consigne({ type: 'off ramp', modifier: 'slight right' }), 'Prends la sortie à droite');
  assert.equal(consigne({ type: 'merge', modifier: 'left', nom: 'Périphérique' }), 'Insère-toi à gauche sur le périphérique');
  assert.equal(consigne({ type: 'end of road', modifier: 'left', nom: 'Allée Duguay Trouin' }), 'Au bout de la voie, tourne à gauche sur l’allée Duguay Trouin');
  assert.equal(consigne({ type: 'notification' }), 'Continue tout droit');
  assert.equal(consigne({ type: 'inconnu-futur', nom: 'Rue A' }), 'Continue sur la rue A');
});

test('étapes silencieuses : tout droit sans changer de cap', () => {
  assert.equal(estSilencieuse('new name', 'straight'), true);
  assert.equal(estSilencieuse('continue'), true);
  assert.equal(estSilencieuse('new name', 'slight right'), false);
  assert.equal(estSilencieuse('turn', 'straight'), false);
  assert.equal(estSilencieuse('arrive'), false);
});

test('ordinaux et points cardinaux', () => {
  assert.equal(ordinal(1), 'première');
  assert.equal(ordinal(3), 'troisième');
  assert.equal(ordinal(12), '12e');
  assert.equal(cardinal(0), 'le nord');
  assert.equal(cardinal(359), 'le nord');
  assert.equal(cardinal(90), 'l’est');
  assert.equal(cardinal(-90), 'l’ouest');
  assert.equal(cardinal(225), 'le sud-ouest');
});

test('distances et durées', () => {
  assert.equal(distanceCourte(7), '10 m');
  assert.equal(distanceCourte(84), '80 m');
  assert.equal(distanceCourte(212), '200 m');
  assert.equal(distanceCourte(680), '700 m');
  assert.equal(distanceCourte(1234), '1,2 km');
  assert.equal(distanceCourte(15400), '15 km');
  assert.equal(distanceParlee(212), '200 mètres');
  assert.equal(distanceParlee(1000), '1 kilomètre');
  assert.equal(distanceParlee(1500), '1,5 kilomètre');
  assert.equal(distanceParlee(3200), '3,2 kilomètres');
  assert.equal(dureeCourte(20), '1 min');
  assert.equal(dureeCourte(600), '10 min');
  assert.equal(dureeCourte(3900), '1 h 05');
});

test('annonce et enchaînement', () => {
  assert.equal(annonce('Tourne à droite sur la rue X', 200), 'Dans 200 mètres, tourne à droite sur la rue X');
  assert.equal(avecSuite('Tourne à droite', 'Tourne à gauche'), 'Tourne à droite, puis tourne à gauche');
  assert.equal(avecSuite('Tourne à droite', null), 'Tourne à droite');
});

test('paliers d’annonce selon le mode', () => {
  // À pied : rien à 300 m, « loin » à 100 m, « proche » à 15 m, une seule fois chacun.
  assert.equal(annonceDue('walking', 300, null), null);
  assert.equal(annonceDue('walking', 100, null), 'loin');
  assert.equal(annonceDue('walking', 90, 'loin'), null);
  assert.equal(annonceDue('walking', 15, 'loin'), 'proche');
  assert.equal(annonceDue('walking', 10, 'proche'), null);
  // Une étape courte n'a pas d'annonce « loin ».
  assert.equal(annonceDue('walking', 30, null, 35), null);
  // En voiture on prévient bien plus tôt.
  assert.equal(annonceDue('driving', 500, null), 'loin');
  assert.equal(annonceDue('driving', 70, 'loin'), 'proche');
  assert.equal(annonceDue('bicycling', 200, null), 'loin');
});

// Tracé de test : une rue est-ouest à Nantes puis un virage vers le nord.
const A = [47.2184, -1.5600];
const B = [47.2184, -1.5550]; // ~378 m à l'est de A
const C = [47.2220, -1.5550]; // ~400 m au nord de B
const ligne = [A, B, C];
const cum = cumul(ligne);

test('géométrie : distances cumulées et projection', () => {
  assert.ok(Math.abs(cum[1] - 378) < 3, `AB ≈ 378 m (${cum[1]})`);
  assert.ok(Math.abs(cum[2] - cum[1] - 400) < 3);
  // Un point 20 m au nord du milieu de AB.
  const p = projeter([47.2184 + 20 / 111_195, -1.5575], ligne, cum);
  assert.equal(p.segment, 0);
  assert.ok(Math.abs(p.ecart - 20) < 1, `écart ≈ 20 m (${p.ecart})`);
  assert.ok(Math.abs(p.parcouru - cum[1] / 2) < 2);
  // Durées : 1 m/s partout -> il reste ~ la distance.
  const r = restant(p, cum, cum);
  assert.ok(Math.abs(r.metres - (cum[2] - cum[1] / 2)) < 2);
  assert.ok(Math.abs(r.secondes - r.metres) < 2);
  // Sur le second segment.
  const q = projeter([47.2200, -1.5552], ligne, cum, 1);
  assert.equal(q.segment, 1);
  assert.ok(q.ecart < 20);
});

test('prochaine étape', () => {
  const debuts = [0, 378, 778];
  assert.equal(prochaineEtape(debuts, 0), 1);
  assert.equal(prochaineEtape(debuts, 376), 2); // à moins de 3 m de la manœuvre : c'est la suivante
  assert.equal(prochaineEtape(debuts, 500), 2);
  assert.equal(prochaineEtape(debuts, 800), 2);
});

test('écart au tracé : il faut être dehors plusieurs secondes, précision correcte', () => {
  const d = new DetecteurEcart(45, 4000);
  assert.equal(d.observer(80, 10, 0), false);
  assert.equal(d.observer(80, 10, 2000), false);
  assert.equal(d.observer(80, 10, 4100), true); // 4 s dehors : on recalcule
  assert.equal(d.observer(80, 10, 4200), false); // et on repart de zéro
  // Un retour sur le tracé annule le compte.
  const e = new DetecteurEcart(45, 4000);
  e.observer(80, 10, 0);
  e.observer(10, 10, 2000);
  assert.equal(e.observer(80, 10, 4100), false);
  // Précision trop mauvaise : on ne décide rien.
  const f = new DetecteurEcart(45, 4000);
  f.observer(200, 120, 0);
  assert.equal(f.observer(200, 120, 10_000), false);
  // Écart à peine au-dessus du seuil mais précision médiocre : bruit.
  const g = new DetecteurEcart(45, 4000);
  g.observer(50, 50, 0);
  assert.equal(g.observer(50, 50, 5000), false);
});

test('arrivée et couverture', () => {
  assert.equal(estArrive(35, 'walking'), true);
  assert.equal(estArrive(45, 'walking'), false);
  assert.equal(estArrive(45, 'driving'), true);
  assert.equal(ACCROCHE_MAX_M, 300);
  assert.deepEqual(horsCouverture([6.2, 8.3, 12]), []);
  assert.deepEqual(horsCouverture([264751, 6.2]), [0]);
  assert.deepEqual(horsCouverture([5, 301, null]), [1, 2]);
  assert.ok(Math.abs(distanceM(A, B) - 378) < 3);
});
