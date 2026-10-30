// « J'ai fait autre chose » : le vendredi 30/10, padel à la place de la course.
// Vérifie que la course passe au lundi au même palier, et fait les captures.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp';
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

const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'natation', 'muscu'], objectifCourse: '10km', joursCourse: [1, 5], joursNatation: [3], joursMuscu: [2, 6], bassin: 25, objectifNatation: 1000, lieu: 'salle', objectifMuscu: 'tonus', niveauMuscu: 'debutant' } },
  sessions: [],
  history: [
    { id: 'r1', sport: 'course', date: '2026-10-23', level: 1, elapsedSec: 1980, distanceKm: 3.35 },
    { id: 'r2', sport: 'course', date: '2026-10-26', level: 2, elapsedSec: 2447, distanceKm: 4.44, difficulte: 3 },
    { id: 'n1', sport: 'natation', date: '2026-10-28', elapsedSec: 3600, swim: { bassinM: 25, longueurs: 30, nages: ['crawl', 'brasse'], detail: '' }, difficulte: 4 },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.clock.setFixedTime(new Date('2026-10-30T19:00:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
await page.goto(base);
await page.waitForSelector('.day-card');
await page.screenshot({ path: `${out}/1-carte-du-jour.png`, fullPage: true });

await page.click('[data-autre="course"]');
await page.click('[data-act="Padel"]');
await page.fill('#duree', '90');
await page.click('[data-scale="difficulte"][data-v="3"]');
await page.click('[data-scale="fatigue"][data-v="3"]');
await page.screenshot({ path: `${out}/2-saisie.png`, fullPage: true });
await page.click('[data-savemanual]');
await page.waitForSelector('.hero.autre');
await page.screenshot({ path: `${out}/3-et-maintenant.png`, fullPage: true });

const titre = await page.textContent('.hero.autre');
if (!/Course décalée au lundi 2 novembre/.test(titre)) errors.push(`titre : ${titre}`);
const plan = await page.evaluate(async () => {
  const m = await import('./js/plan.js');
  const d = JSON.parse(localStorage.getItem('foulee.v1'));
  return m.upcoming(d.history, d.settings, '2026-10-30', 8, d.profile.questionnaire).map((p) => `${p.date} ${p.sport}${p.level ? ` ${p.level}` : ''}`);
});
if (plan.join() !== '2026-10-31 muscu,2026-11-02 course 2,2026-11-03 muscu,2026-11-04 natation,2026-11-06 course 3') errors.push(`plan : ${plan.join()}`);

await page.click('[data-tab="accueil"]');
await page.screenshot({ path: `${out}/4-accueil-apres.png`, fullPage: true });
await page.click('[data-pickday="2026-11-02"]');
await page.locator('.day-card').screenshot({ path: `${out}/5-lundi.png` });

await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok', plan.join(' | '));
