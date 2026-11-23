// Course libre : réglage des 3 durées, signaux (fin de marche, mi-course, marche de fin), bilan, historique, natation libre.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-course-libre';
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
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'natation'], objectifCourse: '10km', joursCourse: [1, 5], joursNatation: [3] } },
  sessions: [],
  history: [{ id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-13T18:00:00', level: 4, sessionName: 'Palier 4', elapsedSec: 2400, distanceKm: 4.1, difficulte: 3 }],
  settings: { son: 'musique', annonces: 'signaux' },
};

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
  const mover = setInterval(() => { lat += 3 / 111195; context.setGeolocation({ latitude: lat, longitude: 2.253, accuracy: 5 }).catch(() => {}); }, 1000);
  await page.goto(base);
  await page.waitForSelector('#tabs');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));

  await page.click('#tabs [data-tab="demarrer"]');
  await page.locator('[data-courselibre]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-1-demarrer.png` });
  await page.click('[data-courselibre]');
  await page.waitForSelector('[data-clgo]');
  const defauts = await page.evaluate(() => ['echauf', 'course', 'fin'].map((k) => document.querySelector(`#cl-${k} b`).textContent));
  // Réglage : 3 min de marche, 12 min de course, 4 min de marche.
  await page.click('[data-clstep="echauf"][data-cld="-1"]');
  await page.click('[data-clstep="echauf"][data-cld="-1"]');
  await page.click('[data-clstep="course"][data-cld="-5"]');
  await page.click('[data-clstep="course"][data-cld="-1"]');
  await page.click('[data-clstep="course"][data-cld="-1"]');
  await page.click('[data-clstep="course"][data-cld="-1"]');
  await page.click('[data-clstep="fin"][data-cld="-1"]');
  // Butée : la course ne descend pas sous 5 min.
  const regle = await page.evaluate(() => ['echauf', 'course', 'fin'].map((k) => document.querySelector(`#cl-${k} b`).textContent));
  await page.screenshot({ path: `${out}/${name}-2-reglage.png`, fullPage: true });
  await page.click('[data-clgo]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  const prepText = await page.textContent('#app');
  await page.screenshot({ path: `${out}/${name}-3-avant-de-partir.png`, fullPage: true });
  await page.click('[data-ready]');
  await page.waitForSelector('#now');
  const st = () => page.evaluate(() => ({ now: document.getElementById('now').textContent, stepno: document.getElementById('stepno').textContent, half: !document.getElementById('halfway').hidden }));
  const seek = (t) => page.evaluate((x) => { document.getElementById('player').currentTime = x; }, t);
  await page.waitForTimeout(1500);
  const track = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.live')).session);
  const s0 = 7; // intro
  // Fin de la marche de début (3 min) : signal de course.
  await seek(s0 + 180 - 1.5);
  await page.waitForFunction(() => document.getElementById('now').textContent === 'Cours', null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  const enCourse = await st();
  await page.screenshot({ path: `${out}/${name}-4-course.png` });
  // Moitié de la course : 180 + 6 min.
  await seek(s0 + 180 + 360 - 1);
  await page.waitForFunction(() => !document.getElementById('halfway').hidden, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const moitie = await st();
  await page.screenshot({ path: `${out}/${name}-5-moitie-course.png` });
  // Début de la marche de fin.
  await seek(s0 + 180 + 720 - 1.5);
  await page.waitForFunction(() => document.getElementById('now').textContent === 'Marche', null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  const marcheFin = await st();
  await page.screenshot({ path: `${out}/${name}-6-marche-de-fin.png` });
  await seek(s0 + 180 + 720 + 240 - 1);
  await page.waitForSelector('#livedone:not([hidden])', { timeout: 15000 });
  await page.click('#livedone');
  await page.waitForSelector('[data-savebilan]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-7-bilan.png`, fullPage: true });
  await page.click('[data-scale="difficulte"][data-v="2"]');
  await page.click('[data-savebilan]');
  await page.waitForSelector('text=Et maintenant');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));
  const h = after.history.find((x) => x.courseLibre);
  await page.click('#tabs [data-tab="progression"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-8-progression.png`, fullPage: true });
  await page.locator('details.hist').first().evaluate((el) => { el.open = true; });
  await page.waitForTimeout(400);
  await page.locator('details.hist').first().screenshot({ path: `${out}/${name}-9-historique.png` });
  const histText = await page.locator('details.hist').first().textContent();
  // La fois suivante : réglages gardés.
  await page.click('#tabs [data-tab="demarrer"]');
  await page.click('[data-courselibre]');
  await page.waitForSelector('[data-clgo]');
  const garde = await page.evaluate(() => ['echauf', 'course', 'fin'].map((k) => document.querySelector(`#cl-${k} b`).textContent));
  // Natation libre : la saisie de natation.
  await page.click('[data-tab="demarrer"]');
  await page.click('[data-manual="natation"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-10-natation-libre.png`, fullPage: true });
  const swimText = await page.textContent('#app');
  clearInterval(mover);

  const checks = {
    'défauts 5 / 20 / 5': defauts.join() === '5,20,5',
    'réglage 3 / 12 / 4': regle.join() === '3,12,4',
    'séance : 3 étapes, mi-course sur la course': track.steps.map((x) => `${x.kind}:${x.duration}`).join() === 'echauffement:180,course:720,recuperation:240' && track.halfStep === 1,
    'avant de partir : hors programme': prepText.includes('Course libre, hors programme'),
    'signal course après la marche de début': enCourse.now === 'Cours',
    'mi-course : message affiché': moitie.half && moitie.now === 'Cours',
    'marche de fin': marcheFin.now === 'Marche',
    'enregistrée : courseLibre, sans palier': h && h.level === null && h.courseLibre?.course === 12 && h.sport === 'course' && h.distanceKm > 0,
    'palier inchangé (aucun palier sur la course)': h && !h.level,
    'historique : course libre visible': /course libre 12 min/i.test(histText),
    'réglages gardés': garde.join() === '3,12,4' && after.settings.courseLibre?.course === 12,
    'natation libre : saisie de natation': /longueurs/i.test(swimText),
    'données d\'avant intactes': before.history.every((x) => after.history.some((y) => y.id === x.id)),
    'aucune erreur JS': errors.length === 0,
  };
  for (const [k, ok] of Object.entries(checks)) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} · ${k}`); if (!ok) failures.push(`${name} · ${k}`); }
  if (errors.length) console.log(errors);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) { console.log('ÉCHECS', failures); process.exit(1); }
