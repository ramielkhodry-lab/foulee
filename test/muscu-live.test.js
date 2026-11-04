import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuided, setDone, skipExercise, adjustRest, restLeft, endRest, finish, elapsedSec, suggestedReps, setsDone, restTrack } from '../public/js/muscu-live.js';

const ex = (id, n = 2) => ({ id, nom: id, min: 12, max: 15, reps: Array(n).fill(null) });
const make = () => createGuided({ seance: 'A', sessionName: 'Corps entier A', repos: 60, exercices: [ex('squat'), ex('pompes')] }, 0);

test('série faite → récup de la durée du programme, puis série suivante', () => {
  const s = make();
  assert.equal(suggestedReps(s), 15);
  setDone(s, 14, 1000);
  assert.equal(s.phase, 'rest');
  assert.equal(restLeft(s, 1000), 60);
  assert.equal(restLeft(s, 31000), 30);
  endRest(s);
  assert.deepEqual([s.ex, s.set, s.phase], [0, 1, 'work']);
  assert.equal(suggestedReps(s), 14, 'reprend la série d’avant');
  setDone(s, 13, 2000);
  assert.deepEqual([s.ex, s.set, s.phase], [1, 0, 'rest'], 'récup aussi entre deux exercices');
});

test('±15 s, jamais sous 5 s', () => {
  const s = make();
  setDone(s, 15, 0);
  adjustRest(s, 15, 0);
  assert.equal(restLeft(s, 0), 75);
  adjustRest(s, -15, 70000);
  assert.equal(restLeft(s, 70000), 5);
});

test('dernière série = fin, durée mesurée du début à la fin', () => {
  const s = make();
  for (let i = 0; i < 4; i++) { setDone(s, 12, i * 1000); endRest(s); }
  assert.equal(s.phase, 'done');
  assert.equal(s.endedAt, 3000);
  assert.equal(elapsedSec(s, 999999), 3);
  assert.equal(setsDone(s), 4);
});

test('passer un exercice : séries vides, pas de récup ; terminer avant la fin', () => {
  const s = make();
  setDone(s, 15, 0); endRest(s);
  skipExercise(s, 0);
  assert.deepEqual([s.ex, s.set, s.phase], [1, 0, 'work']);
  assert.deepEqual(s.exercices[0].reps, [15, null]);
  finish(s, 120000);
  assert.equal(elapsedSec(s), 120);
});

test('piste de récup : signal à la bonne image', () => {
  const index = { frameBytes: 2, frameSeconds: 0.5, clips: { silence: { offset: 0, frames: 1 }, bip: { offset: 1, frames: 1 }, signal_course: { offset: 2, frames: 2 } } };
  const pack = new Uint8Array([0, 0, 1, 1, 9, 9, 9, 9]);
  const out = restTrack(10, index, pack);
  assert.equal(out[20 * 2], 9, 'signal à 10 s');
  assert.equal(out[14 * 2], 1, 'bip à −3 s');
  assert.equal(out[0], 0);
});
