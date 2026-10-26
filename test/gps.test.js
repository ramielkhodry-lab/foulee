import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, createTrack, addPoint, markGap, summary } from '../public/js/gps.js';

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
