import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recap, project } from '../public/js/share.js';

test('course : km, durée, allure, D+ ; ressenti jamais partagé', () => {
  const r = recap({ sport: 'course', date: '2026-11-20T09:00:00', sessionName: 'Palier 4', elapsedSec: 1930, distanceKm: 5.2, allureSecKm: 371, deniveleM: 40, douleur: 'mollet', commentaire: 'genou qui grince' });
  assert.deepEqual(r.big, { value: '5,2', unit: 'km' });
  assert.deepEqual(r.stats.map((s) => s.label), ['Durée', 'Allure', 'Dénivelé']);
  assert.equal(r.stats[1].value, "6'11");
  assert.ok(!/mollet|grince/.test(r.text + JSON.stringify(r)));
  assert.match(r.text, /^Ma course du .* : 5,2 km · durée 32:10 · allure 6'11 \/km · dénivelé \+40 m\.\nAvec Foulée\.$/);
});

test('distance estimée : pas d\'allure, unité dite estimée', () => {
  const r = recap({ sport: 'course', date: '2026-11-20', elapsedSec: 1800, distanceKm: 4, distanceEstimee: true, allureSecKm: 450 });
  assert.equal(r.big.unit, 'km estimés');
  assert.ok(!r.stats.some((s) => s.label === 'Allure'));
});

test('sans distance : le chiffre principal est la durée, pas répétée', () => {
  const r = recap({ sport: 'course', date: '2026-11-20', elapsedSec: 1500 });
  assert.deepEqual(r.big, { value: '25', unit: 'min' });
  assert.equal(r.stats.length, 0);
});

test('natation : mètres et longueurs', () => {
  const r = recap({ sport: 'natation', date: '2026-11-19', elapsedSec: 2400, swim: { longueurs: 40, bassinM: 25, nages: ['Crawl'] } });
  assert.deepEqual(r.big, { value: '1 000', unit: 'm' });
  assert.equal(r.stats[1].value, '40');
  assert.deepEqual(r.lines, ['Crawl']);
});

test('muscu : kg soulevés et exercices faits', () => {
  const r = recap({ sport: 'muscu', date: '2026-11-18', sessionName: 'Séance A', exercices: [{ nom: 'Squat', poids: 10, reps: [10, 10, 8] }, { nom: 'Gainage', unite: 's', reps: [30, 30] }, { nom: 'Pompes', reps: [0, 0] }] });
  assert.equal(r.big.unit, 'kg soulevés');
  assert.deepEqual(r.lines, ['Squat · 10 kg · 10 / 10 / 8', 'Gainage · 30 / 30 s']);
});

test('cardio et calories seulement s\'ils sont mesurés', () => {
  assert.ok(!recap({ sport: 'course', date: '2026-11-20', elapsedSec: 60 }).stats.some((s) => /Cardio|Calories/.test(s.label)));
  const r = recap({ sport: 'course', date: '2026-11-20', elapsedSec: 600, distanceKm: 2, cardio: { avg: 150 }, montre: { kcal: 200 } });
  assert.ok(r.stats.some((s) => s.label === 'Cardio moy.' && s.value === '150'));
});

test('tracé projeté dans le cadre, proportions gardées', () => {
  const lines = project([[[48.85, 2.35, 0], [48.86, 2.35, 10], [48.86, 2.37, 20]]], { x: 0, y: 0, w: 100, h: 100 });
  const pts = lines.flat();
  for (const [x, y] of pts) assert.ok(x >= -1e-6 && x <= 100 + 1e-6 && y >= -1e-6 && y <= 100 + 1e-6);
  assert.ok(pts[1][1] < pts[0][1], 'le nord est en haut');
});
