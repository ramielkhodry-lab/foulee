import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble, buildEvents, stepAt, LEAD_IN } from '../public/js/track.js';
import { allPhrases, nombre } from '../public/js/phrases.js';

const index = JSON.parse(readFileSync(new URL('../public/audio/index.json', import.meta.url)));
const pack = new Uint8Array(readFileSync(new URL('../public/audio/pack.mp3', import.meta.url)));

const EXEMPLE = [
  { kind: 'echauffement', duration: 300 },
  { kind: 'course_lente', duration: 180 },
  { kind: 'marche', duration: 120 },
  { kind: 'course_lente', duration: 180 },
  { kind: 'marche', duration: 120 },
  { kind: 'course_lente', duration: 180 },
  { kind: 'recuperation', duration: 300 },
];

test('nombres en français', () => {
  assert.equal(nombre(1), 'une');
  assert.equal(nombre(21), 'vingt et une');
  assert.equal(nombre(25), 'vingt-cinq');
  assert.equal(nombre(60), 'soixante');
});

test('chaque phrase a son clip', () => {
  for (const id of Object.keys(allPhrases())) assert.ok(index.clips[id], id);
});

test('les annonces tombent à la bonne seconde', () => {
  const { events, starts } = buildEvents(EXEMPLE);
  assert.deepEqual(starts, [7, 307, 487, 607, 787, 907, 1087]);
  const pre = events.filter((e) => e.clip.startsWith('pre_')).map((e) => [e.at, e.clip]);
  assert.deepEqual(pre[0], [297, 'pre_course_lente']);
  assert.deepEqual(pre.at(-1), [1077, 'pre_recuperation']);
  assert.ok(events.some((e) => e.clip === 'start_course_lente_180' && e.at === 307.7));
});

test('durée non prononçable : annonce générique', () => {
  const { events } = buildEvents([{ kind: 'course', duration: 200 }]);
  assert.ok(events.some((e) => e.clip === 'start_course'));
});

test('étapes invalides refusées', () => {
  assert.throws(() => buildEvents([]));
  assert.throws(() => buildEvents([{ kind: 'nage', duration: 60 }]));
  assert.throws(() => buildEvents([{ kind: 'course', duration: 2.5 }]));
});

test('aucun clip important tronqué dans la séance exemple', () => {
  const { events } = assemble(EXEMPLE, index, pack);
  const cut = events.filter((e) => e.truncated);
  assert.deepEqual(cut, []);
});

test('étape en cours selon le temps de piste', () => {
  const { starts, end } = buildEvents(EXEMPLE);
  assert.equal(stepAt(starts, end, 0), -1);
  assert.equal(stepAt(starts, end, LEAD_IN), 0);
  assert.equal(stepAt(starts, end, 306.9), 0);
  assert.equal(stepAt(starts, end, 307), 1);
  assert.equal(stepAt(starts, end, end), EXEMPLE.length);
});

test('le MP3 assemblé se décode et dure exactement la séance', () => {
  const { bytes, total, end } = assemble(EXEMPLE, index, pack);
  const dir = mkdtempSync(join(tmpdir(), 'foulee-'));
  const f = join(dir, 'seance.mp3');
  writeFileSync(f, bytes);
  const err = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(err, '');
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));
  assert.ok(Math.abs(dur - total) < 0.1, `durée ${dur} vs ${total}`);
  assert.ok(total >= end);
  // 25 min de séance : moins de 10 Mo à garder en mémoire sur le téléphone.
  assert.ok(bytes.length < 10e6, `${bytes.length} octets`);
});

test('le son est bien à sa place dans la piste décodée', () => {
  // Vérifie par analyse du signal qu'il y a du son au départ de l'étape 2 (305 s)
  // et du silence au milieu de l'étape 1.
  const { bytes } = assemble(EXEMPLE, index, pack);
  const dir = mkdtempSync(join(tmpdir(), 'foulee-'));
  const f = join(dir, 'seance.mp3');
  writeFileSync(f, bytes);
  const level = (ss) => {
    const r = execFileSync('sh', ['-c', `ffmpeg -v info -ss ${ss} -t 1 -i ${f} -af volumedetect -f null - 2>&1 | grep max_volume`], { encoding: 'utf8' });
    return Number(r.match(/max_volume: (-?[\d.]+|-inf)/)[1].replace('-inf', '-200'));
  };
  assert.ok(level(307) > -20, 'bip de départ à 307 s');
  assert.ok(level(150) < -60, 'silence à 150 s');
  assert.ok(level(304) > -20, 'bip à 3 s de la fin de l’étape 1');
});

test('séances aléatoires : annonces de départ et pré-annonces jamais coupées', () => {
  const kinds = ['echauffement', 'marche', 'course_lente', 'course', 'recuperation'];
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let run = 0; run < 300; run++) {
    const steps = Array.from({ length: 1 + rnd(12) }, () => ({ kind: kinds[rnd(5)], duration: 30 + rnd(40) * 15 }));
    const { events } = assemble(steps, index, pack);
    const cut = events.filter((e) => e.truncated && (e.clip.startsWith('start_') || e.clip.startsWith('pre_') || e.clip === 'intro' || e.clip === 'end'));
    assert.deepEqual(cut, [], JSON.stringify(steps));
  }
});
