// Séance interrompue (iOS ferme l'app) : plus jamais perdue avec un seul toucher.
// Course : « Reprendre » / « Terminer et enregistrer » / « Supprimer » (confirmé) ; après 3 h,
// seulement « Terminer et enregistrer ». Muscu : même chose, et la saisie quittée la repropose.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-reprise';
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
  let dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); }); // « Supprimer ? » → Annuler
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('.day-card, .hero');

  // Course refaite, 20 s de piste, puis iOS ferme l'app.
  await page.click('[data-pickday="2026-11-09"]');
  await page.click('[data-replay="r2"]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  await page.click('[data-ready]');
  await page.waitForSelector('#count');
  await page.evaluate(() => { document.getElementById('player').currentTime = 400; });
  await page.clock.runFor(6000);
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('[data-finishsaved]');
  const alert1 = await page.textContent('.alert');
  await page.screenshot({ path: `${out}/${name}-1-course-interrompue.png` });
  await page.click('[data-dropresume]'); // Annuler dans la confirmation
  const kept = dialogs.some((m) => /Supprimer cette séance/.test(m)) && await page.isVisible('[data-finishsaved]');
  // Plus de 3 h après : seulement « Terminer et enregistrer ».
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('foulee.live')); s.savedAt -= 4 * 3600 * 1000; localStorage.setItem('foulee.live', JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector('[data-finishsaved]');
  const staleNoResume = (await page.locator('.alert [data-resume]').count()) === 0;
  await page.click('[data-finishsaved]');
  await page.waitForSelector('[data-savebilan]');
  await page.click('[data-scale="difficulte"][data-v="3"]');
  await page.click('[data-savebilan]');
  await page.waitForTimeout(500);
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history.find((h) => h.refaite === 'r2'));
  const liveGone = await page.evaluate(() => localStorage.getItem('foulee.live') === null);

  // Muscu : une série, iOS ferme l'app.
  await page.click('[data-tab="accueil"]');
  await page.waitForSelector('[data-muscugo]');
  await page.click('.day-card [data-muscugo], .hero [data-muscugo]');
  await page.waitForSelector('[data-mstart]:not([disabled])', { timeout: 15000 });
  await page.click('[data-mstart]');
  await page.clock.runFor(3500);
  await page.waitForSelector('.mlive[data-phase="work"]');
  await page.waitForTimeout(1600);
  await page.click('[data-msetdone]');
  await page.waitForSelector('.mlive[data-phase="rest"]');
  await page.reload();
  await page.waitForSelector('[data-mfinishsaved]');
  const alert2 = await page.textContent('.alert');
  await page.screenshot({ path: `${out}/${name}-2-muscu-interrompue.png` });
  await page.click('[data-mfinishsaved]');
  await page.waitForSelector('[data-savemanual]');
  // Fermée aussi sur la saisie : la muscu revient.
  await page.reload();
  const backAgain = await page.waitForSelector('[data-mfinishsaved]', { timeout: 5000 }).then(() => true).catch(() => false);
  if (backAgain) await page.click('[data-mfinishsaved]');
  await page.waitForSelector('[data-savemanual]');
  await page.click('[data-savemanual]');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ m: JSON.parse(localStorage.getItem('foulee.v1')).history.filter((h) => h.sport === 'muscu' && h.date.startsWith('2026-11-14')), left: localStorage.getItem('foulee.muscu') }));

  const checks = {
    'course : bandeau Reprendre + Terminer + Supprimer': /Ce que tu as fait est gardé/.test(alert1) && /Reprendre/.test(alert1) && /Supprimer cette séance/.test(alert1),
    'course : « Supprimer » demande confirmation, Annuler garde tout': kept,
    'course : après 3 h, plus de « Reprendre »': staleNoResume,
    'course : enregistrée avec le temps fait': run && run.elapsedSec >= 380 && run.elapsedSec <= 400 && run.completedSteps >= 1,
    'course : sauvegarde nettoyée': liveGone,
    'muscu : bandeau avec la série notée': /Muscu interrompue/.test(alert2) && /1 série notée/.test(alert2),
    'muscu : saisie quittée = repropsée': backAgain,
    'muscu : enregistrée une fois, sauvegarde nettoyée': st.m.length === 1 && st.left === null,
    'aucune erreur': errors.length === 0,
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'ok ' : 'ÉCHEC'} ${name} : ${k}`);
    if (!v) failures.push(`${name} : ${k}`);
  }
  if (errors.length) console.log(errors);
  if (process.env.DEBUG) console.log(run?.elapsedSec, run?.completedSteps, alert2, st);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) process.exit(1);
