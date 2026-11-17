import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCICES, LIEUX, SEANCES, alternatives, muscuPlan, nextLoad, nextSeance, tonnage, byId } from '../public/js/muscu.js';
import { upcoming } from '../public/js/plan.js';

const goal = { series: 3, min: 8, max: 12 };
const session = (date, exercices, extra = {}) => ({ sport: 'muscu', date, seance: 'A', exercices, ...extra });

test('chaque séance a un exercice par case, quel que soit le lieu', () => {
  for (const lieu of Object.keys(LIEUX)) {
    for (const s of ['A', 'B', 'H', 'L']) {
      const p = muscuPlan(s, [], { lieu, objectifMuscu: 'muscle', niveauMuscu: 'regulier' });
      assert.ok(p.exercices.length >= 4, `${lieu} ${s}`);
      for (const x of p.exercices) assert.ok(LIEUX[lieu].materiel.includes(x.materiel), `${x.nom} disponible ${lieu}`);
    }
  }
  assert.ok(alternatives('pectoraux', 'salle').length >= 4);
  assert.equal(new Set(EXERCICES.map((e) => e.id)).size, EXERCICES.length, 'identifiants uniques');
  for (const s of Object.values(SEANCES)) for (const [m] of s.slots) assert.ok(alternatives(m, 'salle').length, m);
});

test('double progression de la charge', () => {
  const presse = byId('presse-cuisses');
  assert.equal(nextLoad(presse, [], goal).poids, null, 'premier essai : charge à trouver');
  const at = (reps, extra) => [session('2026-11-02', [{ id: 'presse-cuisses', poids: 60, reps }], extra)];
  assert.equal(nextLoad(presse, at([12, 12, 12]), goal).poids, 70, 'tout au maximum : + 10 kg (pas de la machine)');
  assert.equal(nextLoad(presse, at([12, 12, 0]), goal).poids, 60, 'une série non faite : même charge');
  assert.equal(nextLoad(presse, at([10, 9, 9]), goal).poids, 60);
  assert.match(nextLoad(presse, at([10, 9, 9]), goal).reason, /une répétition de plus/);
  assert.match(nextLoad(presse, at([12, 12, 12], { douleur: 'genou' }), goal).reason, /Douleur/);
  const pompes = byId('pompes');
  const p = nextLoad(pompes, [session('2026-11-02', [{ id: 'pompes', min: 8, max: 12, reps: [12, 12, 12] }])], goal);
  assert.deepEqual([p.min, p.max], [10, 14], 'poids du corps : +2 répétitions');
});

test('alternance A/B, haut/bas à partir de 4 jours, adaptation des débutants', () => {
  assert.equal(nextSeance([], 2), 'A');
  assert.equal(nextSeance([session('2026-11-02', [{ id: 'pompes', reps: [5] }])], 2), 'B');
  assert.equal(nextSeance([], 4), 'H');
  assert.equal(muscuPlan('A', [], { niveauMuscu: 'reprise', objectifMuscu: 'muscle' }).exercices[0].series, 2);
  assert.equal(muscuPlan('A', [], { niveauMuscu: 'regulier', objectifMuscu: 'force' }).exercices[0].series, 4);
});

test('programme du frère : course + muscu, jamais de natation, un sport par jour', () => {
  const q = { sports: ['course', 'muscu'], objectifCourse: '10km', niveauCourse: 4, joursCourse: [1, 4], objectifMuscu: 'muscle', lieu: 'salle', niveauMuscu: 'reprise', joursMuscu: [2, 6] };
  const plan = upcoming([], {}, '2026-11-02', 7, q);
  assert.deepEqual(plan.map((p) => [p.date, p.sport]), [['2026-11-02', 'course'], ['2026-11-03', 'muscu'], ['2026-11-05', 'course'], ['2026-11-07', 'muscu']]);
  const [m1, m2] = plan.filter((p) => p.sport === 'muscu');
  assert.deepEqual([m1.seance, m2.seance], ['A', 'B']);
  assert.equal(tonnage({ exercices: [{ poids: 50, reps: [10, 10, 8] }, { poids: null, reps: [15] }] }), 1400);
});

test('maison sans matériel : jamais de tractions, une alternative pour chaque muscle', () => {
  for (const seance of ['A', 'B', 'H', 'L']) {
    const p = muscuPlan(seance, [], { lieu: 'corps', objectifMuscu: 'tonus' });
    assert.ok(!p.exercices.some((x) => x.id === 'tractions'), `${seance} : tractions proposées sans barre`);
    assert.ok(p.exercices.every((x) => x.materiel === 'corps'), seance);
    assert.equal(p.exercices.length, SEANCES[seance].slots.length, `${seance} : un exercice par case`);
  }
  // Même un ancien choix « tractions » enregistré n'est plus proposé à la maison.
  const p = muscuPlan('B', [], { lieu: 'corps' }, { 'B:1': 'tractions' });
  assert.equal(p.exercices[1].muscle, 'dos');
  assert.notEqual(p.exercices[1].id, 'tractions');
  assert.ok(!alternatives('dos', 'halteres').some((e) => e.id === 'tractions'));
  assert.ok(alternatives('dos', 'salle').some((e) => e.id === 'tractions'));
});

test('matériel en plus : alternatives en plus, programme par défaut inchangé', async () => {
  const { alternatives, slotExercise, muscuPlan, nextLoad, GOALS_MUSCU, byId } = await import('../public/js/muscu.js');
  const base = alternatives('biceps', 'corps').map((e) => e.id);
  assert.deepEqual(base, ['curl-serviette']);
  const plus = alternatives('biceps', 'corps', ['halteres', 'elastique']).map((e) => e.id);
  for (const id of ['curl-serviette', 'curl-h', 'curl-marteau', 'curl-elastique']) assert.ok(plus.includes(id), id);
  assert.ok(!plus.includes('curl-poulie'));
  // Défaut inchangé
  assert.equal(slotExercise('B', 4, 'corps', {}, ['halteres']).id, 'curl-serviette');
  // Choix gardé s'il est faisable, sinon retour au défaut
  assert.equal(slotExercise('B', 4, 'corps', { 'B:4': 'curl-marteau' }, ['halteres']).id, 'curl-marteau');
  assert.equal(slotExercise('B', 4, 'corps', { 'B:4': 'curl-marteau' }, []).id, 'curl-serviette');
  assert.equal(slotExercise('B', 4, 'corps', { 'B:4': 'curl-marteau' }).id, 'curl-serviette');
  const p = muscuPlan('B', [], { lieu: 'corps', objectifMuscu: 'tonus' }, { 'B:4': 'curl-elastique' }, ['elastique']);
  assert.equal(p.exercices.find((x) => x.slot === 4).id, 'curl-elastique');
  // Chaque muscle a au moins 2 choix avec haltères + élastiques à la maison
  for (const m of ['pectoraux', 'dos', 'épaules', 'quadriceps', 'ischios et fessiers', 'mollets', 'biceps', 'triceps']) {
    assert.ok(alternatives(m, 'corps', ['halteres', 'elastique']).length >= 2, m);
  }
  // Élastique : pas de kg, progression par élastique plus dur
  const ex = byId('curl-elastique');
  const goal = GOALS_MUSCU.tonus;
  const h = [{ sport: 'muscu', date: '2026-11-10', exercices: [{ id: 'curl-elastique', reps: [15, 15], min: 12, max: 15 }] }];
  const n = nextLoad(ex, h, goal);
  assert.equal(n.poids, null);
  assert.match(n.reason, /élastique plus dur/);
});
