// « Refaire cette séance » : la course du lundi 9/11 relancée le samedi 14/11 (même étapes,
// guidage), enregistrée avec `refaite` ; la course du lundi 16/11 reste prévue.
// Puis la muscu du mardi 10/11 relancée : mêmes exercices sur l'écran « Avant de commencer ».
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-refaire';
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

const { levelSteps } = await import('../../public/js/plan.js');
const steps4 = levelSteps(4);
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'natation', 'muscu'], objectifCourse: '10km', joursCourse: [1, 5], joursNatation: [3], joursMuscu: [2, 6], bassin: 25, objectifNatation: 1000, lieu: 'corps', objectifMuscu: 'tonus', niveauMuscu: 'debutant' } },
  sessions: [],
  history: [
    { id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-06T18:00:00', level: 4, sessionName: 'Palier 4 · x', steps: steps4, completedSteps: steps4.length, elapsedSec: 2400, distanceKm: 4.1, difficulte: 4 },
    { id: 'r2', sport: 'course', source: 'guidee', date: '2026-11-09T18:00:00', level: 4, sessionName: 'Palier 4 · lundi', steps: steps4, completedSteps: steps4.length, elapsedSec: 2400, distanceKm: 4.3, difficulte: 3 },
    { id: 'm1', sport: 'muscu', source: 'guidee', date: '2026-11-10T19:00:00', seance: 'A', sessionName: 'Corps entier A', elapsedSec: 2400, exercices: [{ slot: 0, id: 'squat-corps', nom: 'Squat au poids du corps', muscle: 'quadriceps', materiel: 'corps', unite: 'reps', reps: [15, 15] }, { slot: 1, id: 'pompes', nom: 'Pompes', muscle: 'pectoraux', materiel: 'corps', unite: 'reps', reps: [10, 9] }] },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const failures = [];
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  const context = await browser.newContext({ ...devices[dev], permissions: ['geolocation'], geolocation: { latitude: 48.897, longitude: 2.253, accuracy: 5 } });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-11-14T09:00:00') });
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('.day-card, .hero');
  await page.click('[data-pickday="2026-11-09"]');
  await page.waitForSelector('[data-replay="r2"]');
  await page.locator('[data-replay="r2"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-1-lundi.png` });
  await page.click('[data-replay="r2"]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  const prepText = await page.textContent('#app');
  const prepTitle = await page.textContent('.prep-title');
  await page.screenshot({ path: `${out}/${name}-2-avant-de-partir.png`, fullPage: true });
  await page.click('[data-ready]');
  await page.waitForSelector('#count');
  const nSegs = await page.$$eval('#bar .seg', (l) => l.length);
  await page.evaluate(() => { const a = document.getElementById('player'); a.currentTime = a.duration - 1; });
  await page.clock.runFor(3000);
  await page.waitForSelector('#livedone:not([hidden])', { timeout: 10000 });
  await page.click('#livedone');
  await page.waitForSelector('[data-savebilan]');
  await page.click('[data-scale="difficulte"][data-v="3"]');
  await page.click('[data-savebilan]');
  await page.waitForTimeout(800);
  const st = await page.evaluate(async () => {
    const d = JSON.parse(localStorage.getItem('foulee.v1'));
    const m = await import('./js/plan.js');
    const plan = m.upcoming(d.history, d.settings, '2026-11-14', 4, d.profile.questionnaire).map((p) => `${p.date} ${p.sport}${p.level ? ` ${p.level}` : ''}`);
    return { h: d.history.find((x) => x.refaite), plan };
  });
  // Ligne de la séance refaite dans le calendrier du jour.
  await page.click('[data-tab="accueil"]');
  await page.waitForTimeout(500);

  // Muscu du mardi refaite.
  await page.click('[data-pickday="2026-11-10"]');
  await page.waitForSelector('[data-replay="m1"]');
  await page.click('[data-replay="m1"]');
  await page.waitForSelector('[data-mstart]');
  const mprep = await page.textContent('#app');
  const mNames = await page.$$eval('.mprep-ex b', (l) => l.map((x) => x.textContent));
  await page.screenshot({ path: `${out}/${name}-3-muscu-avant.png`, fullPage: true });
  await page.click('[data-mprepback]');

  const checks = {
    'bouton sur la course de lundi': true,
    'avant de partir : même séance, note lundi': prepTitle.includes('Palier 4 · lundi') && /La même séance que lundi 9 novembre/.test(prepText),
    'mêmes étapes': nSegs === steps4.length,
    'enregistrée avec refaite + palier 4': st.h && st.h.refaite === 'r2' && st.h.level === 4 && st.h.steps.length === steps4.length,
    'lundi 16 : course toujours prévue': st.plan.some((p) => p.startsWith('2026-11-16 course')),
    'muscu : mêmes exercices': mNames.join() === 'Squat au poids du corps,Pompes' && /Les mêmes exercices que mardi 10 novembre/.test(mprep),
    'aucune erreur': errors.length === 0,
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'ok ' : 'ÉCHEC'} ${name} : ${k}`);
    if (!v) failures.push(`${name} : ${k}`);
  }
  console.log(name, st.plan.join(' | '));
  if (errors.length) console.log(errors);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) process.exit(1);
