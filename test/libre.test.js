import test from 'node:test';
import assert from 'node:assert/strict';
import { libreSession, libreState, libreAction, libreRallonge, libreDone, libreBlocs, libreResume, MARCHE, OPEN } from '../public/js/libre.js';
import { buildEvents, stepStarts } from '../public/js/track.js';
import { nextRunLevel } from '../public/js/plan.js';
import { canReplay, replayRun } from '../public/js/refaire.js';

test('déroulé : échauffement, 5 blocs, 4 marches de 2 min, puis fin', () => {
  let s = libreSession();
  assert.equal(libreState(s, 0).phase, 'echauffement');
  // fin naturelle de l'échauffement : bloc 1 ouvert
  assert.deepEqual(libreState(s, 1), { phase: 'course', bloc: 1, blocs: 5, action: 'Je marche' });
  let i = 1;
  for (let b = 1; b <= 5; b++) {
    s = libreAction(s, i, 200 + b); // s'arrête après ~200 s
    assert.equal(s.steps[i].duration, Math.ceil(200 + b + 0.6));
    if (b < 5) {
      assert.equal(s.steps[i + 1].kind, 'marche');
      assert.equal(s.steps[i + 1].duration, MARCHE);
      assert.equal(libreState(s, i + 1).bloc, b + 1);
      assert.equal(libreState(s, i + 2).bloc, b + 1);
      i += 2;
    } else {
      assert.equal(s.steps.length, i + 1, 'plus rien après le 5e bloc');
      assert.equal(libreState(s, i + 1).phase, 'fin');
    }
  }
  assert.equal(s.steps.filter((x) => x.kind === 'course').length, 5);
  assert.equal(s.steps.filter((x) => x.kind === 'marche').length, 4);
});

test('« Je recours » avant la fin des 2 min et fin d\'échauffement anticipée', () => {
  let s = libreAction(libreSession(), 0, 30); // échauffement écourté
  assert.equal(s.steps[0].duration, 31);
  assert.equal(s.steps[1].kind, 'course');
  s = libreAction(s, 1, 100);
  s = libreAction(s, 2, 50); // marche coupée à 50 s
  assert.equal(s.steps[2].duration, 51);
  assert.equal(s.steps[3].kind, 'course');
  assert.equal(s.steps.length, 4);
  assert.equal(libreState(s, 3).bloc, 2);
});

test('piste : pas de bips sur les étapes coupées ni de mi-séance, bips sur la marche de 2 min', () => {
  let s = libreAction(libreSession(), 1, 120);
  const { events, starts } = buildEvents(s.steps, { voice: false, half: false });
  assert.ok(!events.some((e) => e.clip === 'signal_moitie'));
  const bips = events.filter((e) => e.clip === 'bip').map((e) => e.at);
  const marcheEnd = starts[2] + MARCHE;
  assert.deepEqual(bips.filter((t) => t > starts[1]), [marcheEnd - 3, marcheEnd - 2, marcheEnd - 1]);
  assert.ok(events.some((e) => e.at === starts[2] && e.clip === 'signal_marche'));
  assert.ok(events.some((e) => e.at === marcheEnd && e.clip === 'signal_course'));
});

test('bloc ouvert rallongé seulement près de sa fin', () => {
  const s = libreSession();
  assert.equal(libreRallonge(s, 1, 100), null);
  const r = libreRallonge(s, 1, OPEN - 200);
  assert.equal(r.steps[1].duration, 2 * OPEN);
  assert.equal(libreRallonge(s, 0, 299), null);
  // Dernier bloc arrêté : il reste court, jamais rallongé.
  let f = libreSession();
  let i = 1;
  for (let b = 1; b <= 5; b++) { f = libreAction(f, i, 60); i += 2; }
  assert.equal(libreRallonge(f, f.steps.length - 1, 60), null);
});

test('bilan : étapes faites, blocs, plus longue course, pauses', () => {
  let s = libreAction(libreSession(), 1, 180);
  s = libreAction(s, 3, 300 - 1); // bloc 2 : 300 s
  const { starts } = stepStarts(s.steps);
  const reached = starts[5] + 60; // arrêt pendant le 3e bloc, après 60 s
  const done = libreDone(s.steps, starts, reached);
  assert.deepEqual(done.map((x) => x.duration), [300, 181, 120, 300, 120, 60]);
  const t0 = 1e12;
  const stepMs = [];
  let acc = t0;
  for (const x of done) { stepMs.push(acc); acc += x.duration * 1000; }
  stepMs.push(acc);
  // Points : 1 m/s tout du long (≈ 0,000009° de latitude par mètre).
  const points = [];
  for (let k = 0; k <= (acc - t0) / 10000; k++) points.push([48 + (k * 10) / 111195, 2, t0 + k * 10000]);
  const blocs = libreBlocs(done, stepMs, points);
  assert.equal(blocs.length, 3);
  assert.deepEqual(blocs.map((b) => b.sec), [181, 300, 60]);
  assert.ok(Math.abs(blocs[1].km - 0.3) < 0.02, String(blocs[1].km));
  assert.deepEqual(libreResume({ blocs }), { plusLongue: 300, blocMax: 2, pauses: 2, courseSec: 541, n: 3 });
  assert.equal(libreBlocs(done, null, [])[0].km, null);
});

test('hors palier : un test libre ne change pas nextRunLevel', () => {
  const base = [{ id: 'a', sport: 'course', level: 4, date: '2026-11-13T18:00:00', difficulte: 3 }];
  const withTest = [...base, { id: 'b', sport: 'course', level: null, libre: true, sessionName: 'Test : 5 courses au max', date: '2026-11-20T10:00:00', difficulte: 5, steps: [{ kind: 'course', duration: 60 }], completedSteps: 1 }];
  assert.deepEqual(nextRunLevel(withTest), nextRunLevel(base));
  assert.equal(replayRun(withTest[1]), null);
  assert.equal(canReplay(withTest[1]), true);
});
