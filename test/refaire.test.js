import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayRun, replayMuscu, canReplay } from '../public/js/refaire.js';
import { nextRunLevel, levelSteps } from '../public/js/plan.js';
import { GOALS_MUSCU } from '../public/js/muscu.js';

const steps = levelSteps(4);

test('course guidée : mêmes étapes, même palier', () => {
  const r = replayRun({ id: 'a', sport: 'course', source: 'guidee', level: 4, sessionName: 'Palier 4 · x', steps });
  assert.deepEqual(r.steps, steps.map(({ kind, duration }) => ({ kind, duration })));
  assert.equal(r.level, 4);
  assert.equal(r.name, 'Palier 4 · x');
});

test('course prolongée : seules les répétitions finies sont gardées', () => {
  const base = levelSteps(3);
  const recup = base.at(-1);
  const run = base.at(-2);
  const walk = base.at(-3);
  const from = base.length - 1;
  const done = [...base.slice(0, -1), walk, run, walk, run, recup]; // 2 ajoutées
  const r = replayRun({ sport: 'course', level: 3, steps: done, extra: 2, extraFaites: 1, extraFrom: from });
  assert.equal(r.steps.length, base.length + 2);
  assert.equal(r.steps.at(-1).kind, 'recuperation');
});

test('course notée à la main : déroulé reconnu, sinon rien', () => {
  const r = replayRun({ sport: 'course', source: 'manuelle', structure: '6 × (3 min course + 2 min marche)' });
  assert.ok(r && r.steps.length > 3);
  assert.equal(replayRun({ sport: 'course', structure: 'footing' }), null);
  assert.equal(canReplay({ sport: 'natation', swim: { longueurs: 20 } }), false);
});

test('muscu : mêmes exercices, même nombre de séries, charges recalculées', () => {
  const h = { id: 'm1', sport: 'muscu', date: '2026-11-10', seance: 'A', sessionName: 'Corps entier A',
    exercices: [{ slot: 0, id: 'squat-corps', reps: [12, 12, 12] }, { slot: 1, id: 'pompes', reps: [10, 9] }] };
  const p = replayMuscu(h, [h], GOALS_MUSCU.muscle);
  assert.deepEqual(p.exercices.map((x) => [x.id, x.series]), [['squat-corps', 3], ['pompes', 2]]);
  assert.equal(p.refaite, 'm1');
  assert.ok(canReplay(h));
});

const run = (date, level, extra = {}) => ({ sport: 'course', date, level, difficulte: 3, ...extra });

test('course refaite à un palier plus bas : le programme ne redescend pas', () => {
  const h = [run('2026-11-02', 5), run('2026-11-09', 5), run('2026-11-14', 3, { refaite: 'x', difficulte: 2 })];
  assert.equal(nextRunLevel(h).level, 6);
});

test('course refaite au même palier : elle compte comme les autres', () => {
  const h = [run('2026-11-09', 5), run('2026-11-14', 5, { refaite: 'x' })];
  assert.equal(nextRunLevel(h).level, 6); // deux séances réussies
});

test('course refaite plus bas avec douleur : on redescend quand même', () => {
  const h = [run('2026-11-09', 5), run('2026-11-14', 3, { refaite: 'x', douleur: 'genou' })];
  assert.equal(nextRunLevel(h).level, 2);
});
