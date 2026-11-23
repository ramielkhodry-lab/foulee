// Test « courses au max » (sans nombre de blocs fixé) : échauffement, 5 blocs au max avec 2 min de marche, bilan avec les blocs.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-seance-libre';
await mkdir(out, { recursive: true });
const root = new URL('../../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');


const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course'], objectifCourse: '10km', joursCourse: [1, 5] } },
  sessions: [],
  history: [{ id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-13T18:00:00', level: 4, sessionName: 'Palier 4', elapsedSec: 2400, distanceKm: 4.1, difficulte: 3 }],
  settings: { son: 'musique', annonces: 'signaux' },
};
const RUNS = [95, 140, 70, 110, 60]; // secondes de course de chaque bloc

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const failures = [];
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  let lat = 48.897;
  const context = await browser.newContext({ ...devices[dev], permissions: ['geolocation'], geolocation: { latitude: lat, longitude: 2.253, accuracy: 5 } });
  const page = await context.newPage();
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  // Le coureur avance de 4 m par seconde d'horloge.
  const mover = setInterval(() => { lat += 4 / 111195; context.setGeolocation({ latitude: lat, longitude: 2.253, accuracy: 5 }).catch(() => {}); }, 1000);
  await page.goto(base);
  await page.waitForSelector('#tabs');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));

  await page.click('#tabs [data-tab="demarrer"]');
  await page.screenshot({ path: `${out}/${name}-0-demarrer.png` });
  await page.click('[data-startlibre]');
  await page.waitForSelector('[data-clgo]');
  await page.screenshot({ path: `${out}/${name}-0b-reglage.png`, fullPage: true });
  await page.click('[data-clgo]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  await page.screenshot({ path: `${out}/${name}-1-avant-de-partir.png`, fullPage: true });
  await page.click('[data-ready]');
  await page.waitForSelector('#librebtn');
  const st = () => page.evaluate(() => ({ now: document.getElementById('now').textContent, stepno: document.getElementById('stepno').textContent, btn: document.getElementById('librebtn').hidden ? null : document.getElementById('librebtn').textContent, count: document.getElementById('count').textContent, next: document.getElementById('next').textContent }));
  const seek = (t) => page.evaluate((x) => { document.getElementById('player').currentTime = x; }, t);
  const pos = () => page.evaluate(() => document.getElementById('player').currentTime);
  await page.waitForTimeout(1500);
  const noSkip = !(await page.isVisible('[data-skip]'));
  // Échauffement laissé à sa fin naturelle (7 s d'intro + 300 s).
  await seek(7 + 297);
  await page.waitForFunction(() => document.getElementById('now').textContent === 'Cours', null, { timeout: 10000 });
  const b1 = await st();
  const log = [];
  let t0 = await pos();
  for (let k = 0; k < 5; k++) {
    // Le bloc dure RUNS[k] secondes : saut dans la piste puis attente de 2 s d'horloge (GPS).
    await seek(t0 + RUNS[k] - 2);
    await page.waitForTimeout(2200);
    const during = await st();
    if (k === 1) await page.screenshot({ path: `${out}/${name}-2-bloc-en-cours.png` });
    if (k === 2) {
      // Écran bloqué : appui long 2 s sur « Je marche ».
      await page.click('[data-touchlock]');
      await page.waitForSelector('#touchlock .lock-libre:not([hidden])');
      await page.screenshot({ path: `${out}/${name}-3-verrou.png` });
      const box = await page.locator('#touchlock .lock-libre').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(2300);
      await page.mouse.up();
      // Débloquer : appui long 2 s sur le cadenas.
      const lk = await page.locator('#touchlock .lock-btn').boundingBox();
      await page.mouse.move(lk.x + lk.width / 2, lk.y + lk.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(2300);
      await page.mouse.up();
      await page.waitForSelector('#touchlock', { state: 'detached' });
    } else if (k === 4) {
      // Plus de fin automatique après 5 blocs : « Terminer » → marche de fin.
      await page.click('[data-finish]');
      await page.waitForSelector('[data-librefinir]');
      await page.click('[data-librefinir]');
    } else {
      await page.click('#librebtn');
    }
    if (k < 4) {
      await page.waitForFunction(() => document.getElementById('now').textContent === 'Marche', null, { timeout: 8000 });
      const walk = await st();
      if (k === 0) { await page.waitForTimeout(1700); await page.screenshot({ path: `${out}/${name}-4-marche.png` }); }
      log.push({ during, walk });
      if (k === 3) {
        // « Je recours » au bout de ~40 s de marche.
        await seek((await pos()) + 38);
        await page.waitForTimeout(500);
        await page.click('#librebtn');
      } else {
        await seek((await pos()) + 115); // fin des 2 min : le signal de course relance
      }
      await page.waitForFunction(() => document.getElementById('now').textContent === 'Cours', null, { timeout: 12000 });
      await page.waitForTimeout(400);
      log[k].restart = (await st()).count;
      t0 = await pos();
    } else {
      log.push({ during });
    }
  }
  await page.waitForFunction(() => document.getElementById('stepno').textContent === 'Retour au calme', null, { timeout: 8000 });
  const recup = await st();
  await page.screenshot({ path: `${out}/${name}-5b-retour-au-calme.png` });
  // On laisse finir les 5 min (puis on continue à marcher : « + »).
  await seek((await pos()) + 296);
  // Fin du programme : le « + » démarre tout de suite et continue sans à-coup après la fin de la piste.
  await page.waitForFunction(() => document.getElementById('stepno').textContent === 'Fin', null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const plusA = await st();
  const elA = await page.textContent('#elapsed');
  await page.waitForTimeout(9000);
  const plusB = await st();
  const elB = await page.textContent('#elapsed');
  await page.waitForSelector('#livedone:not([hidden])', { timeout: 15000 }).catch(async (e) => { console.log(await st(), await pos(), await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.live')).session.steps)); throw e; });
  const fin = await st();
  await page.screenshot({ path: `${out}/${name}-5-fin.png` });
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.live')).session);
  await page.click('#livedone');
  await page.waitForSelector('[data-savebilan]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-6-bilan.png`, fullPage: true });
  const bilanText = await page.textContent('#app');
  await page.click('[data-scale="difficulte"][data-v="4"]');
  await page.click('[data-savebilan]');
  await page.waitForSelector('text=Et maintenant');
  await page.screenshot({ path: `${out}/${name}-7-suite.png`, fullPage: true });
  const afterData = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));
  const h = afterData.history[0];
  await page.click('#tabs [data-tab="progression"]');
  await page.locator('details.hist').first().evaluate((el) => { el.open = true; });
  await page.waitForTimeout(400);
  await page.locator('details.hist').first().screenshot({ path: `${out}/${name}-8-historique.png` });
  const histText = await page.locator('details.hist').first().textContent();

  // 2e test : un seul bloc, puis « Terminer… » → « Finir par 5 min de marche » → « C'est fini ».
  const early = {};
  await page.click('#tabs [data-tab="demarrer"]');
  await page.click('[data-startlibre]');
  await page.click('[data-clgo]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  await page.click('[data-ready]');
  await page.waitForSelector('#librebtn');
  await page.waitForTimeout(800);
  await seek(7 + 297);
  await page.waitForFunction(() => document.getElementById('now').textContent === 'Cours', null, { timeout: 10000 });
  await seek((await pos()) + 80);
  await page.waitForTimeout(1500);
  await page.click('[data-finish]');
  await page.waitForSelector('[data-librefinir]');
  await page.screenshot({ path: `${out}/${name}-9-terminer-avant.png` });
  await page.click('[data-librefinir]');
  await page.waitForFunction(() => document.getElementById('stepno').textContent === 'Retour au calme', null, { timeout: 8000 });
  await page.waitForTimeout(1700);
  early.recup = await st();
  await page.screenshot({ path: `${out}/${name}-10-retour-au-calme.png` });
  await seek((await pos()) + 90);
  await page.waitForTimeout(800);
  await page.click('#librebtn');
  await page.waitForSelector('[data-savebilan]');
  early.bilan = await page.textContent('#app');
  await page.click('[data-savebilan]');
  await page.waitForSelector('text=Et maintenant');
  const h2 = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history[0]);
  early.ok = early.recup.btn === 'C\'est fini' && h2.blocs.length === 1 && h2.steps.at(-1).kind === 'recuperation' && h2.steps.at(-1).duration < 120
    && early.bilan.includes('Retour au calme') && !early.bilan.includes('Course 2') && h2.segments.map((g) => g.kind).join(',') === 'echauffement,course,recuperation';
  if (!early.ok) console.log(name, 'arrêt anticipé', early.recup, h2.blocs, h2.steps, h2.segments?.map((g) => g.kind));
  clearInterval(mover);

  const secs = (h.blocs || []).map((b) => b.sec);
  const close = secs.length === 5 && secs.every((s, k) => s >= RUNS[k] && s <= RUNS[k] + 3) // le test touche ~1 s après la durée voulue;
  const checks = {
    'pas de bouton « Étape suivante »': noSkip,
    'bloc 1 : « Je marche »': b1.btn === 'Je marche' && b1.stepno.startsWith('Bloc 1 ·'),
    'bloc 5 : toujours « Je marche » (pas de nombre de blocs)': log[4].during.btn === 'Je marche',
    'marche : 2 min et bloc suivant annoncé': log[0].walk.stepno === 'Bloc 2 · marche 2 min' && /reste [12]:\d\d/.test(log[0].walk.next),
    'séance : 5 courses, 4 marches': session.steps.filter((x) => x.kind === 'course').length === 5 && session.steps.filter((x) => x.kind === 'marche').length === 4,
    'marche coupée par « Je recours »': session.steps.filter((x) => x.kind === 'marche')[3].duration < 60,
    'distance du bloc en grand pendant la course': log.every((x) => /^\d,\d\dkm$/.test(x.during.count)),
    'remise à zéro au départ du bloc': log.slice(0, 4).every((x) => parseFloat(x.restart.replace(',', '.')) <= 0.01 && parseFloat(x.restart.replace(',', '.')) < parseFloat(x.during.count.replace(',', '.')) + 0.001),

        'retour au calme 5 min après le 5e bloc': recup.btn === 'C\'est fini' && /reste [45]:\d\d/.test(recup.next) && session.steps.at(-1).kind === 'recuperation' && session.steps.at(-1).duration === 300,
    'arrêt anticipé : « Terminer » → 5 min de marche → « C\'est fini »': early.ok,
        'temps en plus : démarre tout de suite': /\+0:0[1-3] en plus/.test(plusA.next),
    'temps en plus : continu après la fin de la piste': /\+0:1[0-3] en plus/.test(plusB.next) && (() => { const sec = (x) => x.split(':').reduce((m, v) => m * 60 + Number(v), 0); return Math.abs(sec(elB) - sec(elA) - 9) <= 1; })(),
        'fin : « Test fini »': fin.now === 'Test fini' || fin.now === 'Programme fini',
    'bilan : blocs affichés': bilanText.includes('Plus longue course continue') && bilanText.includes('Course 5'),
    'bilan : détail segment par segment': ['Échauffement', 'Course 1', 'Marche 1', 'Marche 4', 'Retour au calme', 'Marche en plus', 'En courant', 'En marchant', 'Séance entière'].every((x) => bilanText.includes(x)),
    'enregistré : 11 segments + marche en plus': h.segments?.length === 12 && h.segments.at(-1).kind === 'plus',
    'direct : distance du segment aussi en marche': /^\d,\d\dkm$/.test(log[0].walk.count) && /^\d,\d\dkm$/.test(recup.count),
    'enregistrée hors palier': h.libre === true && h.level === null && h.blocsPrevus === null && h.marches?.echauf === 5,
    'blocs : durées justes (+3 s max)': close,
    'plus longue = bloc 2': bilanText.includes('(bloc 2)'),
    'distance par bloc (GPS)': (h.blocs || []).filter((b) => b.km > 0).length >= 3 && h.distanceKm > 0,
    'historique : max affiché': histText.includes('test 5 courses · max'),
    'palier inchangé': JSON.stringify(afterData.settings.palierChoix ?? null) === JSON.stringify(before.settings.palierChoix ?? null),
    'aucune erreur': errors.length === 0,
  };
  console.log(name, JSON.stringify({ secs, km: h.blocs?.map((b) => b.km), fin, counts: log.map((x) => [x.during.count, x.restart]), plus: [plusA.next, plusB.next, elA, elB] }));
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'ok ' : 'ÉCHEC'} ${name} : ${k}`);
    if (!v) failures.push(`${name} : ${k}`);
  }
  if (errors.length) console.log(errors);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) process.exit(1);
