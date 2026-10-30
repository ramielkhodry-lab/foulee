import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS, levelSteps, nextRunLevel, nextSwim, upcoming, afterBilan } from '../public/js/plan.js';
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

test('natation de Rami du 28/10 (4/5 partout, avale de l’eau) : même volume, conseils de respiration', async () => {
  const { afterBilan, HORIZON } = await import('../public/js/plan.js');
  const data = JSON.parse(readFileSync(new URL('./fixtures/historique.json', import.meta.url)));
  const swim = { id: 'n28', sport: 'natation', date: '2026-10-28', swim: { bassinM: 25, longueurs: 30, nages: ['crawl', 'brasse', 'dos'], detail: '' }, difficulte: 4, essoufflement: 4, fatigue: 4, douleur: '', commentaire: 'Très fatigué mais bonne fatigue. Quand j’inspire j’avale de l’eau et ça me coupe le rythme' };
  const history = [...data.history, swim];
  const r = afterBilan(history, swim, {}, '2026-10-28');
  assert.equal(r.verdict, 'garde');
  assert.equal(r.next.longueurs, 30);
  assert.equal(r.next.date, '2026-11-04');
  assert.ok(r.conseils.some((t) => /bulles|souffle tout/i.test(t)), 'conseil respiration');
  assert.equal(r.next.focus, 'respiration');
  assert.ok(r.next.plan.some((l) => l.startsWith('Respiration')));
  assert.deepEqual(r.next.tips, r.conseils, 'conseils repris sur la carte de la prochaine natation');
  // Programme continu : des séances bien après le 9 novembre.
  const plan = upcoming(history, {}, '2026-10-28', HORIZON);
  assert.ok(plan.some((p) => p.date > '2026-12-31' && p.sport === 'natation'));
  assert.ok(plan.filter((p) => p.date >= '2026-11-09' && p.date < '2026-11-16' && p.sport !== 'repos').length >= 3, 'semaine du 9 : 2 courses + 1 natation');
});

test('natation : recul si douleur ou difficulté 5, montée sinon', () => {
  const sw = (l, extra = {}) => ({ sport: 'natation', date: '2026-10-14', swim: { bassinM: 25, longueurs: l }, ...extra });
  assert.equal(nextSwim([sw(30, { difficulte: 5 })]).longueurs, 28);
  assert.equal(nextSwim([sw(30, { douleur: 'épaule' })]).longueurs, 28);
  assert.equal(nextSwim([sw(30, { essoufflement: 4, fatigue: 4, difficulte: 3 })]).longueurs, 30);
  assert.equal(nextSwim([sw(30, { difficulte: 2 })]).longueurs, 32);
});

test('course : palier qui monte, conseils selon le ressenti', async () => {
  const { afterBilan } = await import('../public/js/plan.js');
  const { conseils } = await import('../public/js/conseils.js');
  const easy = run('2026-10-30', 2, { difficulte: 2 });
  const r = afterBilan([easy], easy, {}, '2026-10-30');
  assert.equal(r.verdict, 'monte');
  assert.equal(r.titre, 'Palier 2 → 3');
  assert.equal(nextRunLevel([run('2026-10-30', 3, { difficulte: 3, essoufflement: 5 })]).level, 3);
  assert.ok(conseils(run('d', 2, { douleur: 'genou droit' })).some((t) => /Genou/.test(t)));
  assert.ok(conseils(run('d', 2, { essoufflement: 4 })).some((t) => /phrase entière/.test(t)));
  assert.ok(conseils(run('d', 2, { commentaire: 'gros point de côté' })).some((t) => /Point de côté/.test(t)));
  assert.equal(conseils(run('d', 2, { difficulte: 3 })).length, 1);
});

// Autre activité à la place d'une séance prévue : décalée, jamais sautée ni doublée.
const Q_RAMI = { sports: ['course', 'natation', 'muscu'], joursCourse: [1, 5], joursNatation: [3], joursMuscu: [2, 6], objectifCourse: '10km' };
const padel = (date, remplace = 'course', extra = {}) => ({ id: 'p1', sport: 'autre', activite: 'Padel', elapsedSec: 5400, date, remplace, ...extra });

test('padel le vendredi à la place de la course : la course passe au lundi, même palier', () => {
  const h = [run('2026-10-26', 2), padel('2026-10-30')];
  const plan = upcoming(h, {}, '2026-10-30', 8, Q_RAMI);
  assert.equal(plan.find((p) => p.date === '2026-10-30'), undefined, 'plus de course ce vendredi');
  assert.equal(plan.find((p) => p.date === '2026-10-31').sport, 'muscu');
  assert.equal(plan.find((p) => p.date === '2026-11-01'), undefined, 'dimanche : repos (muscu la veille)');
  const mon = plan.find((p) => p.date === '2026-11-02');
  assert.equal(mon.sport, 'course');
  assert.equal(mon.level, 2, 'le padel ne fait pas monter le palier');
  assert.match(mon.reason, /remplacée par : padel/);
  assert.deepEqual(plan.filter((p) => p.sport === 'course').map((p) => p.date), ['2026-11-02', '2026-11-06'], 'pas de course en double');
});

test('jour libre précédé d’un repos : la séance y est décalée, la suivante attend un jour', () => {
  // Course L+V seulement : padel vendredi → samedi trop proche, dimanche libre après un samedi libre.
  const q = { sports: ['course'], joursCourse: [1, 5] };
  const plan = upcoming([padel('2026-10-30')], {}, '2026-10-30', 5, q);
  const sun = plan.find((p) => p.date === '2026-11-01');
  assert.equal(sun.sport, 'course');
  assert.match(sun.reason, /Décalée ici/);
  assert.equal(plan.find((p) => p.date === '2026-11-02').sport, 'repos', 'lundi : un jour de repos entre deux courses');
});

test('report passé sans être fait : pas de rattrapage', () => {
  const q = { sports: ['course'], joursCourse: [1, 5] };
  const plan = upcoming([padel('2026-10-30')], {}, '2026-11-02', 7, q);
  assert.equal(plan.filter((p) => p.sport === 'course' && p.date < '2026-11-06').map((p) => p.date).join(), '2026-11-02');
});

test('activité sans séance remplacée : le programme ne bouge pas', () => {
  const h = [run('2026-10-26', 2)];
  const a = upcoming(h, {}, '2026-10-30', 14, Q_RAMI);
  const b = upcoming([...h, padel('2026-10-29', null)], {}, '2026-10-30', 14, Q_RAMI);
  assert.deepEqual(b, a);
});

test('afterBilan d’une autre activité : où passe la séance', () => {
  const h = [run('2026-10-26', 2), padel('2026-10-30')];
  const r = afterBilan(h, h[1], {}, '2026-10-30', Q_RAMI);
  assert.equal(r.verdict, 'decale');
  assert.equal(r.next.date, '2026-11-02');
  assert.match(r.titre, /Course décalée au lundi 2 novembre/);
  assert.ok(r.conseils.length);
});
