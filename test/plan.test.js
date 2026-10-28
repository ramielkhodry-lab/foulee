import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS, levelSteps, nextRunLevel, nextSwim, upcoming } from '../public/js/plan.js';
import { validateSteps } from '../public/js/track.js';

const run = (date, level, extra = {}) => ({ sport: 'course', date, level, ...extra });

test('tous les paliers sont des séances valides', () => {
  for (const l of LEVELS) validateSteps(levelSteps(l.id));
  const s = levelSteps(2);
  assert.equal(s.filter((x) => x.kind === 'course_lente').length, 6);
  assert.equal(s.reduce((a, x) => a + x.duration, 0), 38 * 60); // 5 + 6×3 + 5×2 + 5
});

test('règles de progression', () => {
  assert.equal(nextRunLevel([]).level, 1);
  assert.equal(nextRunLevel([run('2026-10-26', 2)]).level, 2, 'difficulté non notée : on consolide');
  assert.equal(nextRunLevel([run('2026-10-23', 2), run('2026-10-26', 2)]).level, 3, 'deux réussites : on monte');
  assert.equal(nextRunLevel([run('2026-10-26', 2, { difficulte: 2 })]).level, 3);
  assert.equal(nextRunLevel([run('2026-10-26', 3, { difficulte: 4 })]).level, 3);
  assert.equal(nextRunLevel([run('2026-10-26', 3, { difficulte: 5 })]).level, 2);
  assert.equal(nextRunLevel([run('2026-10-26', 3, { douleur: 'genou' })]).level, 2);
  assert.equal(nextRunLevel([run('2026-10-26', 1, { douleur: 'genou' })]).level, 1);
  assert.equal(nextRunLevel([run('2026-10-26', 12, { difficulte: 1 })]).level, 12);
  const incomplete = run('2026-10-26', 3, { difficulte: 2, steps: levelSteps(3), completedSteps: 4 });
  assert.equal(nextRunLevel([incomplete]).level, 3, 'séance pas finie : on refait');
});

test('historique de Rami : vendredi = 6 × (3+2), mercredi = 30 longueurs', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/historique.json', import.meta.url)));
  const plan = upcoming(data.history, {}, '2026-10-27', 7);
  const wed = plan.find((p) => p.date === '2026-10-28');
  const fri = plan.find((p) => p.date === '2026-10-30');
  assert.equal(wed.sport, 'natation');
  assert.equal(wed.longueurs, 30);
  assert.equal(fri.sport, 'course');
  assert.equal(fri.level, 2);
  assert.match(fri.reason, /pas noté la difficulté/);
  const mon = plan.find((p) => p.date === '2026-11-02');
  assert.equal(mon.level, 3, 'lundi suivant : palier 3 si vendredi se passe bien');
});

test('deux jours de course consécutifs : le second devient du repos', () => {
  const plan = upcoming([], { joursCourse: [1, 2], joursNatation: [] }, '2026-11-02', 2);
  assert.deepEqual(plan.map((p) => p.sport), ['course', 'repos']);
});

test('une séance déjà faite ce jour-là disparaît du programme', () => {
  const plan = upcoming([run('2026-10-30', 2)], {}, '2026-10-30', 1);
  assert.deepEqual(plan, []);
});

test('natation : +2 longueurs, maintien si difficile', () => {
  const sw = (l, extra = {}) => ({ sport: 'natation', date: '2026-10-14', swim: { bassinM: 25, longueurs: l }, ...extra });
  assert.equal(nextSwim([sw(28)]).longueurs, 30);
  assert.equal(nextSwim([sw(28, { difficulte: 4 })]).longueurs, 28);
  assert.equal(nextSwim([]).longueurs, 16);
});

test('palier déduit d’un déroulé saisi à la main', async () => {
  const { runLevel } = await import('../public/js/plan.js');
  assert.equal(runLevel({ structure: '5 min marche, 6 × (3 min course + 2 min marche), 6-7 min marche.' }), 2);
  assert.equal(runLevel({ structure: '5 min marche, 7 × (2 min course + 2 min marche)' }), 1);
  assert.equal(runLevel({ structure: 'footing libre' }), null);
  const sansPalier = [{ sport: 'course', date: '2026-10-23', structure: '7 × (2 min course + 2 min marche)' }, { sport: 'course', date: '2026-10-26', structure: '6 × (3 min course + 2 min marche)' }];
  assert.equal(nextRunLevel(sansPalier).level, 2);
});

test('questionnaire : sports, objectif, niveau de départ et jours de chaque profil', () => {
  // Frère : course seulement, 10 min sans s'arrêter, objectif 10 km, mardi + samedi.
  const frere = { sports: ['course'], objectifCourse: '10km', niveauCourse: 7, joursCourse: [2, 6] };
  const plan = upcoming([], {}, '2026-11-02', 14, frere);
  assert.ok(plan.length && plan.every((p) => p.sport === 'course'), 'jamais de natation');
  assert.deepEqual([...new Set(plan.map((p) => new Date(`${p.date}T12:00`).getDay()))].sort(), [2, 6]);
  assert.equal(plan[0].level, 7);
  assert.equal(plan[0].max, 18);
  assert.match(plan[0].reason, /questionnaire/);
  // Natation seule, bassin de 50 m, objectif 1 km = 20 longueurs, départ à 24 : plafonné.
  const swim = upcoming([], {}, '2026-11-02', 7, { sports: ['natation'], bassin: 50, objectifNatation: 1000, niveauNatation: 24, joursNatation: [4] });
  assert.deepEqual(swim.map((p) => [p.sport, p.longueurs, p.distance]), [['natation', 20, 1000]]);
});

test('questionnaire : l’historique prime sur le niveau déclaré, l’objectif plafonne', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/historique.json', import.meta.url)));
  const q = { sports: ['course', 'natation'], objectifCourse: '10km', niveauCourse: 12, joursCourse: [1, 5], bassin: 25, objectifNatation: 1500, joursNatation: [3] };
  const avant = upcoming(data.history, {}, '2026-10-27', 14);
  const apres = upcoming(data.history, {}, '2026-10-27', 14, q);
  assert.deepEqual(apres.map((p) => [p.date, p.sport, p.level, p.longueurs]), avant.map((p) => [p.date, p.sport, p.level, p.longueurs]), 'le programme de Rami ne bouge pas');
  assert.equal(nextRunLevel([run('2026-10-26', 12, { difficulte: 1 })], { maxLevel: 18 }).level, 13, '10 km : on continue après 30 min');
  assert.equal(nextRunLevel([run('2026-10-26', 14, { difficulte: 1 })], { maxLevel: 12 }).level, 12, 'objectif abaissé : on reste au plafond');
  for (const l of LEVELS) validateSteps(levelSteps(l.id));
});
