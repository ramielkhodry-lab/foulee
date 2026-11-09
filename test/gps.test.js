import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, createTrack, addPoint, addAltitude, ascent, markGap, summary, packTrack, restoreTrack, currentPace } from '../public/js/gps.js';

// Point à `m` mètres au nord d'un point de Courbevoie.
const at = (m, t, acc = 5) => ({ lat: 48.897 + m / 111195, lon: 2.253, t: t * 1000, acc });

test('distance de base', () => {
  assert.ok(Math.abs(haversine(at(0, 0), at(1000, 0)) - 1000) < 1);
});

test('une course régulière à 9 min/km donne la bonne distance et allure', () => {
  const tr = createTrack();
  const v = 1000 / 540; // m/s
  for (let s = 0; s <= 540; s += 3) addPoint(tr, at(s * v, s));
  const r = summary(tr, 540);
  assert.equal(r.distanceKm, 1);
  assert.equal(r.allureSecKm, 540);
  assert.equal(r.gpsIncomplet, false);
});

test('points imprécis et sauts GPS ignorés', () => {
  const tr = createTrack();
  addPoint(tr, at(0, 0));
  assert.equal(addPoint(tr, at(10, 5, 80)), false); // précision 80 m
  assert.equal(addPoint(tr, at(500, 10)), false); // 50 m/s
  assert.equal(addPoint(tr, at(10, 15)), true);
  assert.ok(Math.abs(tr.meters - 10) < 0.5);
});

test('bruit à l’arrêt ignoré', () => {
  const tr = createTrack();
  for (let s = 0; s < 60; s++) addPoint(tr, at((s % 2) * 1.5, s));
  assert.equal(summary(tr, 60).distanceKm, null);
});

test('coupure marquée incomplète', () => {
  const tr = createTrack();
  addPoint(tr, at(0, 0));
  markGap(tr);
  addPoint(tr, at(100, 60));
  assert.equal(summary(tr, 60).gpsIncomplet, true);
});

test('tracé compact : aller-retour encodage, coupure GPS, taille', async () => {
  const { encodeTrace, decodeTrace } = await import('../public/js/gps.js');
  const v = 1000 / 540;
  const pts = [];
  for (let s = 0; s <= 1200; s += 2) {
    if (s > 600 && s < 700) continue; // écran verrouillé 100 s
    pts.push([48.897 + (s * v) / 111195, 2.253 + (s % 50) / 1e5, 1761811200000 + s * 1000]);
  }
  const tr = encodeTrace(pts);
  const segs = decodeTrace(tr);
  assert.equal(segs.length, 2);
  const first = segs[0][0];
  assert.ok(Math.abs(first[0] - pts[0][0]) < 1e-5 && Math.abs(first[1] - pts[0][1]) < 1e-5 && first[2] === 0);
  const last = segs[1].at(-1);
  assert.ok(Math.abs(last[0] - pts.at(-1)[0]) < 1e-5 && last[2] === 1200);
  // ~2,2 km : bien moins de 10 Ko une fois en JSON.
  assert.ok(JSON.stringify(tr).length < 10000, `taille ${JSON.stringify(tr).length}`);
  assert.equal(encodeTrace([]), null);
});

test('dénivelé du téléphone : montées comptées, bruit de ± 2 m ignoré', () => {
  const tr = createTrack();
  // Plat bruité (100 ± 2 m), montée de 30 m, descente, plat bruité.
  const alts = [];
  for (let i = 0; i < 40; i++) alts.push(100 + (i % 2 ? 2 : -2));
  for (let i = 1; i <= 30; i++) alts.push(100 + i);
  for (let i = 1; i <= 30; i++) alts.push(130 - i);
  for (let i = 0; i < 40; i++) alts.push(100 + (i % 2 ? 2 : -2));
  alts.forEach((a, i) => addAltitude(tr, a, 5, i * 1000));
  assert.equal(addAltitude(tr, 500, 40, 999_999), false); // altitude imprécise : ignorée
  const up = summary(tr, 600).deniveleM;
  assert.ok(up >= 27 && up <= 33, `dénivelé ${up}`);
  assert.equal(ascent(alts.slice(0, 40).map((a, i) => [i, a])), 0);
  assert.equal(ascent([[0, 1]]), null); // trop peu de mesures : rien
});

test('reprise : mesure gardée, pas de distance inventée pendant la fermeture', () => {
  const t = createTrack();
  addPoint(t, { lat: 48.9, lon: 2.25, t: 0, acc: 5 });
  addPoint(t, { lat: 48.9001, lon: 2.25, t: 10_000, acc: 5 });
  const r = restoreTrack(JSON.parse(JSON.stringify(packTrack(t))));
  assert.equal(r.points.length, 2);
  assert.ok(Math.abs(r.meters - t.meters) < 0.1);
  r.cut = true;
  addPoint(r, { lat: 48.905, lon: 2.25, t: 600_000, acc: 5 }); // 550 m plus loin, app fermée
  assert.ok(Math.abs(r.meters - t.meters) < 0.1);
  addPoint(r, { lat: 48.9051, lon: 2.25, t: 610_000, acc: 5 });
  assert.ok(r.meters > t.meters + 10);
});

test('allure du moment : les ~25 dernières secondes, pas la moyenne de la séance', () => {
  const tr = createTrack();
  // 2 min de marche à 12 min/km puis 1 min de course à 6 min/km, un point par seconde.
  let m = 0;
  for (let s = 0; s <= 180; s++) {
    if (s > 0) m += s <= 120 ? 1000 / 720 : 1000 / 360;
    addPoint(tr, at(m, s));
  }
  const p = currentPace(tr, 180 * 1000);
  assert.ok(Math.abs(p - 360) <= 10, `allure ${p}`);
  assert.ok(summary(tr, 180).allureSecKm > 450); // la moyenne, elle, est bien plus lente
});

test('allure du moment : rien si le GPS ne suit plus, est imprécis ou trop récent', () => {
  const run = (acc, until = 60) => {
    const tr = createTrack();
    for (let s = 0; s <= until; s++) addPoint(tr, at(s * 3, s, acc));
    return tr;
  };
  assert.equal(currentPace(createTrack(), 0), null);
  assert.ok(currentPace(run(5), 60 * 1000) > 0);
  assert.equal(currentPace(run(5), 75 * 1000), null); // plus de point depuis 15 s
  assert.equal(currentPace(run(25), 60 * 1000), null); // précision moyenne 25 m
  assert.equal(currentPace(run(5, 6), 6 * 1000), null); // 6 s de mesure seulement
  // Reprise après une coupure : on n'additionne pas le trajet non mesuré.
  const tr = run(5);
  markGap(tr); tr.cut = true;
  assert.equal(currentPace(tr, 60 * 1000), null);
  addPoint(tr, at(400, 120));
  for (let s = 121; s <= 125; s++) addPoint(tr, at(400 + (s - 120) * 3, s));
  assert.equal(currentPace(tr, 125 * 1000), null); // 5 s depuis la reprise : trop peu
});
