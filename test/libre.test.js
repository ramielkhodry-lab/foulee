import test from 'node:test';
import assert from 'node:assert/strict';
import { libreFinir as finir2, testCfg, libreSession, libreState, libreAction, libreRallonge, libreDone, libreBlocs, libreResume, MARCHE, OPEN } from '../public/js/libre.js';
import { buildEvents, stepStarts } from '../public/js/track.js';
import { nextRunLevel } from '../public/js/plan.js';
import { canReplay, replayRun } from '../public/js/refaire.js';

// Ancien test à 5 blocs (séance sauvegardée avant le 23/11) : comportement inchangé.
const ancien = () => ({ id: 'libre-5-blocs', libre: true, blocs: 5, name: 'Test : 5 courses au max', steps: [{ kind: 'echauffement', duration: 300 }, { kind: 'course', duration: OPEN, libre: true, ouvert: true }] });

test('déroulé : échauffement, 5 blocs, 4 marches de 2 min, puis fin', () => {
  let s = ancien();
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
      assert.deepEqual(s.steps[i + 1], { kind: 'recuperation', duration: 300 }, '5 min de retour au calme');
      assert.equal(libreState(s, i + 1).phase, 'recup');
      assert.equal(libreState(s, i + 2).phase, 'fin');
      const court = libreAction(s, i + 1, 90); // retour au calme écourté
      assert.equal(court.steps.length, i + 2);
      assert.equal(court.steps.at(-1).duration, 91);
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
  assert.equal(libreRallonge(f, f.steps.length - 2, 60), null);
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

import { palierPourTest, palierDesTests, runBlockSec } from '../public/js/plan.js';
import { enCourse } from '../public/js/libre.js';

test('palier d\'un test : course tenue sur 3 blocs', () => {
  assert.equal(runBlockSec(2), 180);
  assert.equal(runBlockSec(5), 420);
  // 6 min tenues 3 fois → palier 4 (5 min), pas 5 (7 min).
  assert.deepEqual(palierPourTest([{ sec: 400 }, { sec: 365 }, { sec: 360 }, { sec: 200 }, { sec: 150 }]), { level: 4, refSec: 360, fois: 3 });
  // Un seul bon bloc ne suffit pas.
  assert.equal(palierPourTest([{ sec: 900 }, { sec: 130 }, { sec: 125 }]).level, 1);
  assert.equal(palierPourTest([{ sec: 60 }]).level, 1);
  assert.equal(palierPourTest([]), null);
  // Plafond du programme.
  assert.equal(palierPourTest([{ sec: 4000 }, { sec: 4000 }, { sec: 4000 }], 12).level, 12);
});

test('2 tests concordants : le plus bas des deux ; un seul : à confirmer', () => {
  const t = (id, date, sec) => ({ id, sport: 'course', libre: true, date, blocs: [sec, sec, sec].map((x) => ({ sec: x })) });
  assert.equal(palierDesTests([]), null);
  assert.deepEqual(palierDesTests([t('a', '2026-11-20', 360)]), { level: 4, confirme: false, levels: [4], lastId: 'a' });
  assert.deepEqual(palierDesTests([t('a', '2026-11-20', 360), t('b', '2026-11-24', 430)]), { level: 4, confirme: true, levels: [4, 5], lastId: 'b' });
  assert.equal(palierDesTests([t('z', '2026-11-01', 100), t('a', '2026-11-20', 430), t('b', '2026-11-24', 430)]).level, 5);
});

test('palier choisi : vaut jusqu\'à la prochaine course du programme', () => {
  const base = [{ id: 'a', sport: 'course', level: 2, date: '2026-11-13T18:00:00', difficulte: 3 }];
  const palierManuel = { level: 4, at: '2026-11-20T11:00:00', test: 'b' };
  const r = nextRunLevel(base, { palierManuel });
  assert.equal(r.level, 4);
  assert.equal(r.manuel, true);
  // Une course au palier 4 faite après le choix : les règles repartent d'elle.
  const after = [...base, { id: 'c', sport: 'course', level: 4, date: '2026-11-21T18:00:00', difficulte: 4 }];
  const r2 = nextRunLevel(after, { palierManuel });
  assert.equal(r2.level, 4);
  assert.equal(r2.manuel, undefined);
  // Plafond.
  assert.equal(nextRunLevel(base, { palierManuel: { level: 30, at: '2026-11-20' }, maxLevel: 12 }).level, 12);
});

test('distance en courant : marche exclue', () => {
  const steps = [{ kind: 'echauffement', duration: 300 }, { kind: 'course_lente', duration: 120 }, { kind: 'marche', duration: 120 }, { kind: 'course_lente', duration: 120 }];
  const t0 = 1e12;
  const stepMs = [t0, t0 + 300e3, t0 + 420e3, t0 + 540e3, t0 + 660e3];
  const points = [];
  const raw = [];
  for (let k = 0; k <= 66; k++) {
    const p = [48 + (k * 10 * 2) / 111195, 2, t0 + k * 10000]; // 2 m/s
    points.push(p);
    raw.push({ lat: p[0], lon: p[1], t: p[2], acc: k < 40 ? 5 : 25 });
  }
  const r = enCourse(steps, stepMs, points, raw);
  assert.equal(r.sec, 240);
  assert.ok(Math.abs(r.km - 0.48) < 0.03, String(r.km));
  assert.equal(r.accM, 18); // moyenne des deux courses : ≈ 10 m puis 25 m
  assert.equal(enCourse(steps, null, points), null);
});

import { libreSegments, segmentTotals } from '../public/js/libre.js';

test('segments : échauffement, courses, marches, retour au calme, marche en plus', () => {
  const steps = [{ kind: 'echauffement', duration: 300 }, { kind: 'course', duration: 100 }, { kind: 'marche', duration: 120 }, { kind: 'course', duration: 80 }, { kind: 'recuperation', duration: 300 }];
  const t0 = 1e12;
  const stepMs = [t0];
  for (const s of steps) stepMs.push(stepMs.at(-1) + s.duration * 1000);
  const finMs = stepMs.at(-1) + 60000;
  const points = [];
  for (let k = 0; k <= (finMs - t0) / 10000; k++) points.push([48 + (k * 10) / 111195, 2, t0 + k * 10000]); // 1 m/s
  const segs = libreSegments(steps, stepMs, points, [], finMs);
  assert.deepEqual(segs.map((g) => [g.kind, g.n, g.sec]), [['echauffement', undefined, 300], ['course', 1, 100], ['marche', 1, 120], ['course', 2, 80], ['recuperation', undefined, 300], ['plus', undefined, 60]]);
  const tot = segmentTotals(segs);
  assert.ok(Math.abs(tot.course - 0.18) < 0.01, String(tot.course));
  assert.ok(Math.abs(tot.marche - 0.78) < 0.01, String(tot.marche));
  assert.equal(tot.seance, Math.round((tot.course + tot.marche) * 100) / 100);
  assert.equal(libreSegments(steps, null, points), null);
  // Terminer juste à la fin : pas de « marche en plus ».
  assert.equal(libreSegments(steps, stepMs, points, [], stepMs.at(-1) + 2000).at(-1).kind, 'recuperation');
});

import { libreFinir } from '../public/js/libre.js';

test('« Terminer » avant la fin : 5 min de marche tout de suite', () => {
  const s = libreFinir(libreSession(), 1, 80);
  assert.deepEqual(s.steps.map((x) => [x.kind, x.duration]), [['echauffement', 300], ['course', 81], ['recuperation', 300]]);
  assert.equal(libreState(s, 2).phase, 'recup');
  assert.equal(libreState(s, 2).action, 'C\'est fini');
  assert.equal(libreFinir(s, 2, 10), null); // déjà au retour au calme
  const m = libreFinir(libreAction(libreSession(), 1, 60), 2, 30); // pendant une marche de 2 min
  assert.deepEqual(m.steps.slice(2).map((x) => [x.kind, x.duration]), [['marche', 31], ['recuperation', 300]]);
});

test('test sans nombre de blocs : marches au choix, « Je marche » toujours, Terminer → marche de fin', () => {
  let s = libreSession({ echauf: 3, fin: 4 });
  assert.equal(s.steps[0].duration, 180);
  let i = 1;
  for (let b = 1; b <= 8; b++) {
    const st = libreState(s, i);
    assert.equal(st.action, 'Je marche');
    assert.equal(st.bloc, b);
    s = libreAction(s, i, 60);
    assert.equal(s.steps[i + 1].kind, 'marche');
    assert.equal(s.steps[i + 1].duration, MARCHE);
    i += 2;
  }
  const f = finir2(s, i, 30);
  assert.deepEqual(f.steps.at(-1), { kind: 'recuperation', duration: 240 });
});

test('test sans marche : course dès le départ, Terminer sans marche de fin', () => {
  const s = libreSession({ echauf: 0, fin: 0 });
  assert.equal(s.steps.length, 1);
  assert.equal(libreState(s, 0).phase, 'course');
  assert.equal(finir2(s, 0, 30), null);
  assert.deepEqual(testCfg({ echauf: 99, fin: -1 }), { echauf: 30, fin: 0 });
});
