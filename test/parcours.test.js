import test from 'node:test';
import assert from 'node:assert/strict';
import { offset, loopWaypoints, decodePolyline, targetKm, planLoop, reroute, DEFAULT_KMH } from '../public/js/parcours.js';
import { footRoute, cleanPoints, ROUTER } from '../worker/src/parcours.js';
import { haversine } from '../public/js/gps.js';

const dist = (a, b) => haversine({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
const START = [48.897, 2.253];

// Encodeur de polyline (précision 5) pour simuler le service.
function encode(points) {
  let out = '';
  let prev = [0, 0];
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>>= 5; }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const cur = [Math.round(p[0] * 1e5), Math.round(p[1] * 1e5)];
    enc(cur[0] - prev[0]);
    enc(cur[1] - prev[1]);
    prev = cur;
  }
  return out;
}

test('offset : 1 km vers le nord puis vers l’est', () => {
  assert.ok(Math.abs(dist(START, offset(START, 1000, 0)) - 1000) < 2);
  const e = offset(START, 1000, 90);
  assert.ok(Math.abs(e[0] - START[0]) < 1e-4 && e[1] > START[1]);
});

test('points de passage sur un cercle qui passe par le départ', () => {
  const km = 5;
  const wps = loopWaypoints(START, km, 30, { detour: 1 });
  assert.equal(wps.length, 3);
  // Polygone départ → 3 points → départ : un peu moins que le périmètre du cercle (5 km).
  const loop = [START, ...wps, START];
  let m = 0;
  for (let i = 1; i < loop.length; i++) m += dist(loop[i - 1], loop[i]);
  assert.ok(m > 4000 && m < 5000, `${m}`);
  // Le point du milieu est à l’opposé du départ, dans la direction choisie (≈ diamètre).
  const r = 5000 / (2 * Math.PI);
  assert.ok(Math.abs(dist(START, wps[1]) - 2 * r) < 5);
});

test('polyline décodée', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  const pts = [[48.897, 2.253], [48.9, 2.26], [48.89512, 2.24]];
  assert.deepEqual(decodePolyline(encode(pts)), pts);
});

test('distance visée : durée × allure de séance des 3 dernières courses', () => {
  const history = [
    { sport: 'course', date: '2026-11-01', distanceKm: 4, elapsedSec: 2400 },
    { sport: 'course', date: '2026-11-10', distanceKm: 4.4, elapsedSec: 2400 },
    { sport: 'course', date: '2026-11-12', distanceKm: 4.2, elapsedSec: 2400 },
    { sport: 'course', date: '2026-11-14', distanceKm: 4.6, elapsedSec: 2400 },
    { sport: 'course', date: '2026-11-15', distanceKm: 9, elapsedSec: 2400, distanceEstimee: true },
    { sport: 'natation', date: '2026-11-16', distanceKm: 1, elapsedSec: 3600 },
  ];
  const t = targetKm(history, 2400);
  assert.equal(t.from, 3);
  assert.equal(t.kmh, 6.6); // 13,2 km en 2 h
  assert.equal(t.km, 4.5); // arrondi au demi-km
  const none = targetKm([], 1800);
  assert.equal(none.from, 0);
  assert.equal(none.kmh, DEFAULT_KMH);
  assert.equal(none.km, 3);
  assert.equal(targetKm([], 60).km, 1); // jamais moins d'1 km
});

test('boucle : cercle réduit si l’itinéraire est trop long, meilleur essai gardé', async () => {
  const calls = [];
  // Rues très sinueuses : 1,8 × la distance à vol d'oiseau.
  const route = async (pts) => {
    calls.push(pts);
    let m = 0;
    for (let i = 1; i < pts.length; i++) m += dist(pts[i - 1], pts[i]);
    return { km: Math.round((m * 1.8) / 10) / 100, poly: encode(pts) };
  };
  const plan = await planLoop(START, 5, 0, route);
  assert.ok(calls.length >= 2 && calls.length <= 3);
  assert.deepEqual(calls[0][0], START);
  assert.deepEqual(calls[0].at(-1), START);
  assert.ok(Math.abs(plan.km - 5) / 5 <= 0.12, `${plan.km}`);
  assert.equal(plan.waypoints.length, 3);
  assert.equal(plan.bearing, 0);
  const moved = await reroute(START, [plan.waypoints[0], offset(START, 300, 200), plan.waypoints[2]], route);
  assert.deepEqual(calls.at(-1)[2], offset(START, 300, 200));
  assert.ok(moved.km > 0);
});

test('serveur : points vérifiés, rien d’autre n’est envoyé que les coordonnées', async () => {
  assert.throws(() => cleanPoints([[48.9, 2.2]]), /invalides/);
  assert.throws(() => cleanPoints([[48.9, 'x'], [48.9, 2.2]]), /invalides/);
  assert.throws(() => cleanPoints(Array(9).fill([48.9, 2.2])), /invalides/);
  assert.throws(() => cleanPoints([[48.9, 2.2], [49.2, 2.2]]), /étendu/);
  let seen;
  const fetcher = async (url, opts) => {
    seen = { url, opts };
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 4567, geometry: 'abc' }] }), { status: 200 });
  };
  const r = await footRoute([[48.897, 2.253], [48.9, 2.26], [48.897, 2.253]], fetcher);
  assert.deepEqual(r, { km: 4.57, poly: 'abc' });
  assert.equal(seen.url, `${ROUTER}2.253,48.897;2.26,48.9;2.253,48.897?overview=full&geometries=polyline&steps=false`);
  assert.ok(!('Authorization' in seen.opts.headers));
});

test('serveur : erreurs du service traduites', async () => {
  const resp = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const pts = [[48.897, 2.253], [48.9, 2.26]];
  await assert.rejects(footRoute(pts, resp(400, { code: 'NoRoute' })), (e) => e.status === 422);
  await assert.rejects(footRoute(pts, resp(429, {})), (e) => e.status === 429);
  await assert.rejects(footRoute(pts, resp(500, {})), (e) => e.status === 503);
  await assert.rejects(footRoute(pts, async () => { throw new Error('réseau'); }), (e) => e.status === 503);
});
