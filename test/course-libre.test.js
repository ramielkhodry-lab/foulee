import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseLibreSession, courseLibreCfg } from '../public/js/course-libre.js';
import { buildEvents } from '../public/js/track.js';
import { nextRunLevel } from '../public/js/plan.js';

test('course libre : 3 étapes, mi-séance à la moitié de la course', () => {
  const s = courseLibreSession({ echauf: 5, course: 30, fin: 10 });
  assert.deepEqual(s.steps.map((x) => [x.kind, x.duration]), [['echauffement', 300], ['course', 1800], ['recuperation', 600]]);
  assert.equal(s.halfStep, 1);
  const { events, starts, half } = buildEvents(s.steps, { voice: false, halfStep: s.halfStep });
  assert.equal(half, starts[1] + 900); // 15 min après le début de la course
  const at = (clip) => events.filter((e) => e.clip === clip).map((e) => e.at);
  assert.deepEqual(at('signal_course'), [starts[1]]); // fin de la marche de début
  assert.deepEqual(at('signal_marche'), [starts[0], starts[2]]); // début, puis marche de fin
  assert.deepEqual(at('signal_fin'), [starts[2] + 600]);
});

test('course libre sans marche : une seule étape, mi-course au milieu', () => {
  const s = courseLibreSession({ echauf: 0, course: 20, fin: 0 });
  assert.deepEqual(s.steps.map((x) => x.kind), ['course']);
  const { starts, half } = buildEvents(s.steps, { voice: false, halfStep: s.halfStep });
  assert.equal(half, starts[0] + 600);
});

test('réglages bornés et valeurs par défaut', () => {
  assert.deepEqual(courseLibreCfg(null), { echauf: 5, course: 20, fin: 5 });
  assert.deepEqual(courseLibreCfg({ echauf: -3, course: 1, fin: 99 }), { echauf: 0, course: 5, fin: 30 });
});

test('sans halfStep : mi-séance inchangée', () => {
  const steps = [{ kind: 'echauffement', duration: 300 }, { kind: 'course', duration: 1800 }, { kind: 'recuperation', duration: 600 }];
  const { starts, end, half } = buildEvents(steps, { voice: false });
  assert.equal(half, starts[0] + (end - starts[0]) / 2);
});

test('course libre hors palier : ne change pas le palier', () => {
  const base = [{ id: 'a', sport: 'course', date: '2026-11-10T08:00', level: 4, difficulte: 3 }];
  const s = courseLibreSession({ course: 30 });
  const libre = { id: 'b', sport: 'course', date: '2026-11-12T08:00', level: null, sessionName: s.name, courseLibre: s.courseLibre, difficulte: 1 };
  assert.deepEqual(nextRunLevel([...base, libre]), nextRunLevel(base));
});
