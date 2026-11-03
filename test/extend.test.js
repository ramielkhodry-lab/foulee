import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_EXTRA, extendState, canExtend, canRetract, extend, retract, extraSummary } from '../public/js/extend.js';
import { levelSteps, nextRunLevel } from '../public/js/plan.js';
import { assemble, stepStarts } from '../public/js/track.js';
import { seanceText } from '../public/js/ia.js';

const index = JSON.parse(readFileSync(new URL('../public/audio/index.json', import.meta.url)));
const pack = new Uint8Array(readFileSync(new URL('../public/audio/pack.mp3', import.meta.url)));
const sess = (level) => ({ id: 'x', name: 'p', level, steps: levelSteps(level) });

test('palier 1 : pendant la récup, +1 = la récup devient 2 min de marche, puis 2 min de course, puis récup', () => {
  const s = sess(1); // échauffement, 7 courses + 6 marches, récupération = 15 étapes
  assert.equal(s.steps.length, 15);
  const e = extend(s, 14, 30);
  assert.equal(e.extra, 1);
  assert.deepEqual(e.steps.slice(13).map((x) => [x.kind, x.duration]), [['course_lente', 120], ['marche', 120], ['course_lente', 120], ['recuperation', 300]]);
  assert.equal(e.steps.filter((x) => x.kind === 'course_lente').length, 8);
  assert.deepEqual(retract(e, 14).steps, s.steps);
});

test('récup déjà bien entamée : la course part 5 s après l’appui', () => {
  const e = extend(sess(1), 14, 200);
  assert.deepEqual([e.steps[14].kind, e.steps[14].duration], ['marche', 205]);
  // la répétition suivante reprend la marche du palier, pas 205 s
  const e2 = extend(e, 16, 10);
  assert.equal(e2.steps[16].duration, 120);
  assert.equal(e2.steps[17].duration, 120);
});

test('bouton seulement pendant la récupération, plafonné', () => {
  let s = sess(1);
  assert.equal(canExtend(s, 13), false); // dernière course
  assert.equal(canExtend(s, 14), true); // récupération
  for (let k = 0; k < MAX_EXTRA; k++) s = extend(s, s.steps.length - 1, 0);
  assert.equal(s.extra, MAX_EXTRA);
  assert.equal(canExtend(s, s.steps.length - 1), false);
  assert.equal(extend(s, s.steps.length - 1, 0), s);
});

test('annuler tant que la course ajoutée n’a pas commencé', () => {
  const e = extend(sess(2), 12, 0);
  const st = extendState(e);
  assert.equal(canRetract(e, st.last - 1), true);
  assert.equal(canRetract(e, st.last), false);
});

test('séances continues ou irrégulières : pas de prolongement', () => {
  for (const lvl of [9, 10, 12, 18]) assert.equal(extendState(sess(lvl)), null, `palier ${lvl}`);
  for (const lvl of [1, 2, 3, 4, 5, 6, 7, 8]) assert.ok(extendState(sess(lvl)), `palier ${lvl}`);
});

test('la piste regravée garde la position des étapes déjà passées', () => {
  const s = sess(1);
  const e = extend(s, 14, 0);
  const a = stepStarts(s.steps).starts;
  const b = stepStarts(e.steps).starts;
  assert.deepEqual(b.slice(0, 15), a.slice(0, 15));
  const t = assemble(e.steps, index, pack, { voice: false });
  assert.equal(t.end - assemble(s.steps, index, pack, { voice: false }).end, 240);
});

test('bilan : prévu contre réalisé', () => {
  const e = extend(extend(sess(1), 14, 0), 16, 0); // 7 prévues + 2
  // arrêté pendant la 2e course ajoutée (indice 17) : une seule ajoutée finie
  assert.deepEqual(extraSummary(e, 17), { extra: 2, extraFaites: 1, extraFrom: 14, repsPrevues: 7 });
  assert.equal(extraSummary(e, e.steps.length).extraFaites, 2);
  assert.equal(extraSummary(sess(1), 15), null);
});

const plus = (s, n = 1) => { for (let k = 0; k < n; k++) s = extend(s, s.steps.length - 1, 0); return s; };
const run = (over) => ({ sport: 'course', date: '2026-11-06', level: 1, difficulte: 3, ...over });
const guided = (s, completed, over = {}) => run({ steps: s.steps, completedSteps: completed, ...(extraSummary(s, completed) || {}), ...over });

test('règles : la répétition ajoutée fait monter d’un palier à difficulté 3, jamais plus', () => {
  const e = plus(sess(1));
  const r = nextRunLevel([guided(e, e.steps.length)], { maxLevel: 18 });
  assert.equal(r.level, 2);
  assert.match(r.reason, /ajouté 1 répétition/);
  // Facile + ajout : toujours +1 seulement
  assert.equal(nextRunLevel([guided(plus(e, 2), 21, { difficulte: 1 })], { maxLevel: 18 }).level, 2);
  // Sans ajout, difficulté 3 : on consolide
  assert.equal(nextRunLevel([guided(sess(1), 15)], { maxLevel: 18 }).level, 1);
});

test('règles : l’ajout ne compense ni la difficulté, ni la douleur, ni la fatigue', () => {
  const e = plus(sess(2));
  const done = e.steps.length;
  assert.equal(nextRunLevel([guided(e, done, { level: 2, difficulte: 4 })], { maxLevel: 18 }).level, 2);
  assert.equal(nextRunLevel([guided(e, done, { level: 2, douleur: 'genou' })], { maxLevel: 18 }).level, 1);
  assert.equal(nextRunLevel([guided(e, done, { level: 2, fatigue: 4 })], { maxLevel: 18 }).level, 2);
  // Ajout lancé mais pas fini : pas d'indice positif
  const st = extendState(e);
  assert.equal(nextRunLevel([guided(e, st.last, { level: 2 })], { maxLevel: 18 }).level, 2);
});

test('règles : s’arrêter pendant une répétition ajoutée n’est pas un abandon', () => {
  const e = plus(sess(1));
  const st = extendState(e);
  const r = nextRunLevel([guided(e, st.from + 1, { difficulte: 2 })], { maxLevel: 18 }); // arrêté dans la course ajoutée
  assert.equal(r.level, 2);
  const r2 = nextRunLevel([guided(e, st.plannedLast, { difficulte: 2 })], { maxLevel: 18 }); // arrêté avant la fin du prévu
  assert.equal(r2.level, 1);
  assert.match(r2.reason, /pas fini/);
});

test('IA : la séance dit prévu contre réalisé', () => {
  const e = plus(sess(1));
  assert.match(seanceText(guided(e, e.steps.length, { sessionName: 'Palier 1' })), /1 répétition ajoutée en cours de séance \(8 au lieu de 7\)/);
});
