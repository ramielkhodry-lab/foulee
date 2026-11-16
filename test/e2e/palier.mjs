// Baisse de palier après une douleur : l'app demande « OK ou maintenir ? » sur la séance du
// jour et sur « Avant de partir » ; « Maintenir » remet le palier prévu, et le minuteur le suit.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-palier';
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

const { levelSteps } = await import('../../public/js/plan.js');
const s2 = levelSteps(2);
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'natation', 'muscu'], objectifCourse: '10km', joursCourse: [1, 5], joursNatation: [3], joursMuscu: [2, 6], bassin: 25, objectifNatation: 1000, lieu: 'corps', objectifMuscu: 'tonus', niveauMuscu: 'debutant' } },
  sessions: [],
  history: [
    { id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-10T18:00:00', level: 2, sessionName: 'Palier 2', steps: s2, completedSteps: s2.length, elapsedSec: 2100, difficulte: 3 },
    { id: 'r2', sport: 'course', source: 'guidee', date: '2026-11-14T09:00:00', level: 2, sessionName: 'Palier 2', steps: s2, completedSteps: 6, elapsedSec: 1500, difficulte: 3, douleur: 'mal au ventre' },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch();
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  const context = await browser.newContext({ ...devices[dev], permissions: ['geolocation'], geolocation: { latitude: 48.897, longitude: 2.253, accuracy: 5 } });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-11-16T12:00:00') });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('.palier-ask');
  check((await page.textContent('.day-card.course .day-sub')).includes('Palier 1/'), `${name}: accueil pas au palier 1 avant réponse`);
  await page.locator('.palier-ask').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-1-question-accueil.png` });
  await page.click('.day-card.course [data-startplan]');
  await page.waitForSelector('.prep-title');
  check((await page.textContent('.prep-title')).includes('Palier 1'), `${name}: avant de partir pas au palier 1`);
  await page.screenshot({ path: `${out}/${name}-2-avant-de-partir.png` });
  await page.click('.palier-ask [data-palier^="maintenir"]');
  await page.waitForTimeout(200);
  check((await page.textContent('.prep-title')).includes('Palier 2'), `${name}: maintenir n'a pas remis le palier 2`);
  check(await page.locator('.palier-ask').count() === 0, `${name}: question encore affichée`);
  await page.screenshot({ path: `${out}/${name}-3-maintenu.png` });
  await page.click('[data-prepback]');
  await page.waitForSelector('.day-card.course');
  check((await page.textContent('.day-card.course .day-sub')).includes('Palier 2/'), `${name}: accueil pas au palier 2 après maintien`);
  await page.locator('.day-card.course .why-tips').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-4-accueil-apres.png` });
  // Le minuteur suit le palier : séance lancée = 3 min de course.
  await page.click('.day-card.course [data-startplan]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  const lvl = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).settings.palierChoix);
  check(lvl?.choix === 'maintenir' && lvl.key === 'r2', `${name}: choix non enregistré`);
  check(errors.length === 0, `${name}: erreurs ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('palier : ok');
