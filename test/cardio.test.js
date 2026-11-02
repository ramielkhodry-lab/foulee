process.env.TZ = 'Europe/Paris';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyText, parseSamples, importMessage } from '../worker/src/cardio.js';
import { stepTimes, summarize, summarizeMontre, montreLine, splits, mergeDistance, recovery, recoveryAt, zoneLimits, zoneTimes, windowOf, cardioText } from '../public/js/cardio.js';
import { nextRunLevel } from '../public/js/plan.js';
import { seanceText } from '../public/js/ia.js';

const NOW = Date.parse('2026-11-02T19:00:00+01:00');

test('Raccourci : lignes « date ISO;valeur » lues, doublons et valeurs absurdes écartés', () => {
  const text = [
    '2026-11-02T18:00:05+01:00;92',
    '2026-11-02T18:00:10+01:00;95,0',
    '2026-11-02T18:00:10+01:00;95', // doublon
    '2026-11-02T18:00:15+0100;101 bpm',
    '2026-11-02T18:00:20Z;400', // impossible
    '',
  ].join('\n');
  const { samples, rejected } = parseSamples(text, NOW);
  assert.deepEqual(samples, [
    [Date.parse('2026-11-02T17:00:05Z'), 92],
    [Date.parse('2026-11-02T17:00:10Z'), 95],
    [Date.parse('2026-11-02T17:00:15Z'), 101],
  ]);
  assert.equal(rejected, 1);
});

test('Raccourci : corps JSON (champ texte) ou texte brut', () => {
  assert.equal(bodyText('{"mesures":"a\\nb"}'), 'a\nb');
  assert.equal(bodyText('["a","b"]'), 'a\nb');
  assert.equal(bodyText('2026-11-02T18:00:05+01:00;92'), '2026-11-02T18:00:05+01:00;92');
});

test('Raccourci mal réglé : le message dit quel réglage corriger', () => {
  assert.match(parseSamples('2026-11-02;92\n2026-11-02;95', NOW).reason, /Inclure l’heure/);
  assert.match(parseSamples('2026-11-02T18:00:05;92', NOW).reason, /fuseau/);
  assert.match(parseSamples('2 nov. 2026 à 18:00;92', NOW).reason, /Aucune mesure/);
  assert.match(parseSamples('2026-10-01T18:00:05+01:00;92', NOW).reason, /trop anciennes/);
  assert.match(importMessage(parseSamples('2026-11-02T18:00:05+01:00;92\n2026-11-02T18:40:05+01:00;120', NOW).samples, 2), /2 mesures de cardio reçues, lundi 2 novembre, de 18:00 à 18:40/);
});

// Séance de 4 étapes, piste qui commence à 3 s, pause de 60 s au milieu de la 2e étape.
const steps = [{ kind: 'echauffement', duration: 300 }, { kind: 'course_lente', duration: 180 }, { kind: 'marche', duration: 120 }, { kind: 'recuperation', duration: 300 }];
const starts = [3, 303, 483, 603];
const end = 903;
const T0 = Date.parse('2026-11-02T18:00:00+01:00');
const at = (s) => T0 + s * 1000;

test('heure réelle de chaque étape, pause comprise', () => {
  const anchors = [[0, at(0)], [3, at(3)], [303, at(303)], [393, at(453)] /* reprise après 60 s de pause à 393 s */, [483, at(543)], [603, at(663)]];
  const ms = stepTimes(anchors, starts, end, end);
  assert.deepEqual(ms.map((t) => (t - T0) / 1000), [3, 303, 543, 663, 963]);
});

test('étape passée (saut) : durée nulle, pas de temps inventé', () => {
  const anchors = [[0, at(0)], [303, at(303)], [483, at(320)] /* saut à la marche à 320 s */];
  const ms = stepTimes(anchors, starts, end, 700);
  assert.deepEqual(ms.map((t) => (t - T0) / 1000), [3, 303, 320, 440, 537]);
});

const entry = (extra = {}) => ({
  id: 'x', sport: 'course', source: 'guidee', date: '2026-11-02T18:00:00', level: 2, steps, elapsedSec: 900,
  stepMs: [at(3), at(303), at(483), at(603), at(903)], ...extra,
});
// Mesure toutes les 5 s : 100 bpm en marche, 150 en course.
const samplesFor = (h, course = 150, marche = 100) => {
  const out = [];
  for (let s = 0; s <= 960; s += 5) {
    const t = at(s);
    const i = h.stepMs.findIndex((x, k) => t >= x && t < h.stepMs[k + 1]);
    out.push([t, i === 1 ? course : marche]);
  }
  return out;
};

test('résumé : moyenne, max, en course, en marche, courbe compacte', () => {
  const h = entry();
  const c = summarize(h, [[at(-600), 70], ...samplesFor(h), [at(3000), 70]]);
  assert.equal(c.max, 150);
  assert.equal(c.course, 150);
  assert.equal(c.marche, 100);
  assert.ok(c.avg > 100 && c.avg < 150);
  assert.equal(c.pts.length, 30); // 900 s / 30 s
  assert.deepEqual(c.bandes, [[300, 480]]);
  assert.equal(c.n, 180); // de 5 s à 900 s, dans la séance (3 s → 903 s)
  assert.match(cardioText(c), /en course 150, en marche 100/);
});

test('pas de cardio sans mesures pendant la séance, ni sans heure connue', () => {
  const h = entry();
  assert.equal(summarize(h, [[at(-600), 70], [at(5000), 80]]), null);
  assert.equal(summarize(h, samplesFor(h).slice(0, 5)), null);
  assert.equal(windowOf({ sport: 'course', source: 'manuelle', date: '2026-11-02' }), null);
  // Anciennes séances guidées sans heures d'étapes : début + durée, sans phases.
  const old = summarize({ ...entry(), stepMs: undefined }, samplesFor(entry()));
  assert.ok(old.avg && !old.course && !old.bandes);
});

test('le cardio passe dans le résumé envoyé à l’IA', () => {
  const h = entry();
  h.cardio = summarize(h, samplesFor(h));
  assert.match(seanceText(h), /cardio mesuré par la montre : moyenne \d+ bpm, max 150, en course 150, en marche 100/);
});

const withHr = (date, course, extra = {}) => {
  const h = entry({ date, ...extra });
  h.cardio = summarize(h, samplesFor(h, course));
  return h;
};

test('programme : cardio nettement plus haut au même palier → on consolide au lieu de monter', () => {
  const a = withHr('2026-10-30T18:00:00', 150, { difficulte: 3 });
  const b = withHr('2026-11-02T18:00:00', 160, { difficulte: 3 });
  const r = nextRunLevel([a, b], { maxLevel: 18 });
  assert.equal(r.level, 2);
  assert.match(r.reason, /Cardio en course plus haut que la dernière fois à ce palier \(160 bpm contre 150\)/);
  // Même une course notée facile ne monte pas.
  assert.equal(nextRunLevel([a, { ...b, difficulte: 2 }], { maxLevel: 18 }).level, 2);
});

test('programme : cardio stable ou en baisse → les règles habituelles, avec le progrès dit', () => {
  const a = withHr('2026-10-30T18:00:00', 156, { difficulte: 3 });
  const b = withHr('2026-11-02T18:00:00', 150, { difficulte: 3 });
  const r = nextRunLevel([a, b], { maxLevel: 18 });
  assert.equal(r.level, 3);
  assert.match(r.reason, /Cardio en course en baisse à palier égal \(150 bpm contre 156\)/);
  // +5 bpm : variation normale d'un jour à l'autre, ça monte quand même.
  assert.equal(nextRunLevel([a, withHr('2026-11-02T18:00:00', 161, { difficulte: 3 })], { maxLevel: 18 }).level, 3);
});

test('programme : le cardio ne fait jamais redescendre, et rien sans comparaison au même palier', () => {
  const a = withHr('2026-10-30T18:00:00', 140, { level: 1, difficulte: 2 });
  const b = withHr('2026-11-02T18:00:00', 175, { difficulte: 2 });
  assert.equal(nextRunLevel([a, b], { maxLevel: 18 }).level, 3); // palier différent : pas de comparaison
  const c = withHr('2026-11-05T18:00:00', 190, { difficulte: 4 });
  assert.equal(nextRunLevel([b, c], { maxLevel: 18 }).level, 2); // difficulté 4 : même palier, pas moins
});

test('Raccourci : distance, calories, puissance, pas ; ceux de l’iPhone écartés (comptés en double sinon)', () => {
  const text = [
    '2026-11-02T18:00:05+01:00;92',
    'dist;2026-11-02T18:01:00+01:00;0,15;Apple Watch de Rami',
    'dist;2026-11-02T18:01:00+01:00;0,16;iPhone de Rami', // même course vue par le téléphone
    'dist;2026-11-02T18:02:00+01:00;140;Apple Watch de Rami', // en mètres
    'kcal;2026-11-02T18:01:00+01:00;12,5;Apple Watch de Rami',
    'puiss;2026-11-02T18:01:00+01:00;118;Apple Watch de Rami',
    'pas;2026-11-02T18:01:00+01:00;150;Apple Watch de Rami',
    'pas;2026-11-02T18:01:00+01:00;140;iPhone de Rami',
    'Distance de marche et de course;2026-11-02T18:03:00+01:00;0,1',
    'Steps;2026-11-02T18:03:00+01:00;120',
    'Poids;2026-11-02T18:03:00+01:00;80', // type inconnu : ignoré
  ].join('\n');
  const r = parseSamples(text, NOW);
  const t = (hm) => Date.parse(`2026-11-02T${hm}:00+01:00`);
  assert.equal(r.samples.length, 1);
  assert.deepEqual(r.autres.dist, [[t('18:01'), 0.15], [t('18:02'), 0.14], [t('18:03'), 0.1]]);
  assert.deepEqual(r.autres.kcal, [[t('18:01'), 12.5]]);
  assert.deepEqual(r.autres.puiss, [[t('18:01'), 118]]);
  assert.deepEqual(r.autres.pas, [[t('18:01'), 150], [t('18:03'), 120]]);
  assert.equal(r.total, 8);
  assert.equal(r.rejected, 0);
  assert.match(importMessage(r.samples, 1, r.autres), /1 mesures de cardio, 3 de distance, 1 d’énergie, 1 de puissance, 2 de pas reçues/);
  // Sans cardio du tout, les autres mesures passent quand même.
  assert.equal(parseSamples('pas;2026-11-02T18:01:00+01:00;150', NOW).total, 1);
});

test('montre : distance, calories, puissance et cadence de la séance seulement', () => {
  const h = entry(); // 3 s → 903 s, 15 min
  const autres = {
    dist: [[at(-300), 0.5], [at(60), 1.2], [at(400), 1.3], [at(900), 0.3], [at(2000), 2]],
    kcal: [[at(60), 100], [at(500), 50.4]],
    puiss: [[at(100), 110], [at(200), 0], [at(300), 120], [at(400), 130]],
    pas: [[at(100), 1000], [at(600), 800], [at(5000), 3000]],
  };
  const m = summarizeMontre(h, autres);
  assert.deepEqual({ ...m, splits: undefined }, { distKm: 2.8, kcal: 150, puissance: 120, cadence: 120, splits: undefined });
  assert.equal(m.splits.km.length, 2);
  assert.equal(montreLine(m), '2,8 km · 150 kcal · 120 W · 120 pas/min');
  assert.equal(summarizeMontre(h, { pas: [[at(100), 20]] }), null); // trop peu : rien
  assert.equal(summarizeMontre({ sport: 'course', source: 'manuelle', date: '2026-11-02' }, autres), null);
  h.montre = m;
  assert.match(seanceText(h), /puissance moyenne 120 W, cadence 120 pas\/min/);
});

test('splits : temps de chaque km d’après la distance de la montre, pause non étalée', () => {
  // 2,5 km à 6 min/km : 10 m toutes les 3,6 s.
  const d = [];
  for (let i = 0; i < 250; i++) d.push([i * 3600, 0.01]);
  assert.deepEqual(splits(d), { km: [360, 360], fin: { km: 0.5, sec: 180 } });
  // Pause de 5 min après 500 m : le 1er km la compte (temps réel), sans étaler la distance dessus.
  const p = d.slice(0, 50).concat(d.slice(50).map(([t, v]) => [t + 300_000, v]));
  const r = splits(p);
  assert.equal(r.km[0], 660);
  assert.equal(r.km[1], 360);
  assert.equal(splits([[0, 0.5], [3000, 0.3]]), null); // pas un km entier
});

test('distance téléphone + montre : moyenne si elles concordent, sinon la montre', () => {
  assert.deepEqual(mergeDistance(4.70, false, 4.78), { km: 4.74, source: 'moyenne' });
  assert.deepEqual(mergeDistance(4.10, false, 4.78), { km: 4.78, source: 'montre', ecart: true }); // 14 % d'écart
  assert.deepEqual(mergeDistance(4.75, true, 4.78), { km: 4.78, source: 'montre' }); // GPS coupé : pas de moyenne
  assert.deepEqual(mergeDistance(null, false, 4.78), { km: 4.78, source: 'montre' });
  assert.equal(mergeDistance(4.7, false, null), null);
});

test('zones : temps par zone d’après le temps passé à chaque bpm, zones de l’app Forme', () => {
  const h = entry();
  const c = summarize(h, samplesFor(h)); // 150 en course (180 s), 100 sinon (720 s)
  const l = zoneLimits([140, 151, 163, 175]);
  const zt = zoneTimes(c.hist, l);
  assert.equal(zt[0] + zt[1] + zt[2] + zt[3] + zt[4], 900); // mesures de 5 s à 900 s, la dernière compte 5 s
  assert.ok(Math.abs(zt[1] - 180) <= 5, `zone 2 : ${zt[1]}`);
  assert.equal(zt[2] + zt[3] + zt[4], 0);
  assert.equal(zoneLimits([140, 130, 163, 175]), null); // pas croissantes
  assert.equal(zoneLimits([140, 151]), null);
  assert.equal(zoneTimes(c.hist, null), null); // pas de zones : rien d'inventé
});

test('cardio après l’effort : 3 minutes après la fin, valeurs à 0, 1 et 2 min', () => {
  const end = at(903);
  const s = [[end - 5000, 150], [end + 2000, 133], [end + 30_000, 125], [end + 61_000, 110], [end + 119_000, 105], [end + 200_000, 99]];
  const ap = recovery(end, s);
  assert.deepEqual(ap, [[2, 133], [30, 125], [61, 110], [119, 105]]);
  assert.equal(recoveryAt(ap, 0), 133);
  assert.equal(recoveryAt(ap, 60), 110);
  assert.equal(recoveryAt(ap, 120), 105);
  assert.equal(recovery(end, s.slice(0, 2)), null);
  const h = entry();
  assert.deepEqual(summarize(h, [...samplesFor(h).filter(([t]) => t <= end), ...s.slice(1)]).apres, ap);
});
