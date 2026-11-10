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

test('décompte de 3 s avant la 1re série ; la durée part de la fin du décompte', async () => {
  const { startCountdown, countLeft, endCountdown } = await import('../public/js/muscu-live.js');
  const s = make();
  startCountdown(s, 3, 0);
  assert.equal(s.phase, 'countdown');
  assert.equal(countLeft(s, 1000), 2);
  setDone(s, 12, 1000);
  assert.equal(s.phase, 'countdown', 'pas de série pendant le décompte');
  endCountdown(s);
  assert.equal(s.phase, 'work');
  assert.equal(elapsedSec(s, 13000), 10);
});

test('piste du décompte : 3 bips puis le signal à 3 s', () => {
  const fs = 0.024;
  const index = { frameBytes: 1, frameSeconds: fs, clips: { silence: { offset: 0, frames: 1 }, bip: { offset: 1, frames: 2 }, signal_course: { offset: 3, frames: 2 } } };
  const pack = new Uint8Array([0, 7, 7, 9, 9]);
  const t = restTrack(3, index, pack, true);
  for (const at of [0, 1, 2]) assert.equal(t[Math.round(at / fs)], 7, `bip à ${at} s`);
  assert.equal(t[Math.round(3 / fs)], 9);
  assert.equal(restTrack(3, index, pack)[0], 0, 'récup courte : pas de bips par défaut');
});

test('changer d’exercice avant la 1re série seulement', async () => {
  const { swapExercise } = await import('../public/js/muscu-live.js');
  const s = make();
  swapExercise(s, { id: 'fentes', nom: 'Fentes', min: 10, max: 12 });
  assert.equal(s.exercices[0].id, 'fentes');
  assert.equal(s.exercices[0].reps.length, 2);
  setDone(s, 10, 0); endRest(s);
  swapExercise(s, { id: 'squat', nom: 'Squat' });
  assert.equal(s.exercices[0].id, 'fentes', 'série déjà faite : on garde l’exercice');
});

import { startHold, stopHold, holdOver, holdTrack, cancelHold, HOLD_LEAD } from '../public/js/muscu-live.js';

const gainage = () => createGuided({ seance: 'A', sessionName: 'Gainage', repos: 60, exercices: [
  { id: 'gainage', nom: 'Gainage', unite: 's', min: 30, max: 45, reps: [null, null] },
] }, 0);

test('minuteur : au maximum, série notée au max et récup calée sur l\'heure du max', () => {
  const s = gainage();
  startHold(s, 1000);
  const start = 1000 + HOLD_LEAD * 1000;
  assert.equal(s.phase, 'work');
  assert.equal(holdOver(s, start + 44_000), false);
  assert.equal(holdOver(s, start + 45_000), true);
  stopHold(s, start + 47_000);
  assert.equal(s.exercices[0].reps[0], 45);
  assert.equal(s.phase, 'rest');
  assert.equal(s.restEnd, start + 45_000 + 60_000);
  assert.equal(s.hold, undefined);
});

test('minuteur : arrêt à la main = secondes tenues ; arrêt pendant la mise en place = rien', () => {
  const s = gainage();
  startHold(s, 0);
  stopHold(s, 2000);
  assert.equal(s.exercices[0].reps[0], null);
  assert.equal(s.phase, 'work');
  startHold(s, 0);
  stopHold(s, 3000 + 33_400);
  assert.equal(s.exercices[0].reps[0], 33);
  startHold(s, 0); // en récup : refusé
  assert.equal(s.hold, undefined);
});

test('minuteur : refusé pour un exercice en répétitions ; annulable', () => {
  const s = createGuided({ seance: 'A', sessionName: 'x', repos: 60, exercices: [{ id: 'pompes', unite: 'reps', min: 8, max: 12, reps: [null] }] }, 0);
  startHold(s, 0);
  assert.equal(s.hold, undefined);
  const g = gainage();
  startHold(g, 0);
  cancelHold(g);
  assert.equal(g.hold, undefined);
  assert.equal(g.phase, 'work');
});

test('piste du minuteur : bips de départ, signal au minimum, fin au maximum, puis récup', () => {
  const fs = 0.5;
  const index = { frameBytes: 1, frameSeconds: fs, clips: {
    silence: { offset: 0, frames: 1 }, bip: { offset: 1, frames: 1 }, signal_course: { offset: 2, frames: 1 },
    signal_moitie: { offset: 3, frames: 1 }, signal_fin: { offset: 4, frames: 1 },
  } };
  const pack = new Uint8Array([0, 1, 2, 3, 4]);
  const s = gainage();
  startHold(s, 0);
  const t = holdTrack(s, index, pack, 0);
  const at = (sec) => t[Math.round(sec / fs)];
  assert.equal(at(0), 1); assert.equal(at(1), 1); assert.equal(at(2), 1);
  assert.equal(at(3), 2, 'départ après 3 s');
  assert.equal(at(33), 3, 'signal au minimum (30 s)');
  assert.equal(at(48), 4, 'fin au maximum (45 s)');
  assert.equal(at(48 + 60), 2, 'reprise après la récup');
  assert.equal(at(48 + 57), 1, 'bips avant la reprise');
  // Dernière série : rien après la fin.
  s.set = 1;
  const last = holdTrack(s, index, pack, 0);
  assert.ok(last.length < Math.round(50 / fs));
  // Reprise en cours de maintien : la piste repart de maintenant.
  const mid = holdTrack(s, index, pack, 3000 + 40_000);
  assert.equal(mid[Math.round(5 / fs)], 4);
  assert.equal(mid[0], 0);
});
