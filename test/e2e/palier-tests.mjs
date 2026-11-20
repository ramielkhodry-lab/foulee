// Changer de palier soi-même (après 2 tests, ou dans Programme) et distance en courant.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-palier-tests';
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



const blocs = (secs, acc = 6) => secs.map((sec) => ({ sec, km: Math.round(sec * 2.6) / 1000, accM: acc }));
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course'], objectifCourse: '10km', joursCourse: [1, 3, 5] } },
  sessions: [],
  history: [
    { id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-10T18:00:00', level: 2, sessionName: 'Palier 2', elapsedSec: 2400, distanceKm: 3.9, difficulte: 3,
      enCourse: { km: 2.71, sec: 1080, accM: 24 }, gpsIncomplet: false },
    { id: 't1', sport: 'course', source: 'guidee', libre: true, level: null, sessionName: 'Test : 5 courses au max', date: '2026-11-15T10:00:00', elapsedSec: 1900, distanceKm: 3.1, blocsPrevus: 5, blocs: blocs([420, 380, 365, 300, 240]), enCourse: { km: 4.6, sec: 1705, accM: 6 }, difficulte: 4 },
    { id: 't2', sport: 'course', source: 'guidee', libre: true, level: null, sessionName: 'Test : 5 courses au max', date: '2026-11-18T10:00:00', elapsedSec: 2000, distanceKm: 3.3, blocsPrevus: 5, blocs: [...blocs([450, 400]), ...blocs([370], 28), ...blocs([330, 280])], enCourse: { km: 4.9, sec: 1830, accM: 9 }, difficulte: 4 },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch();
const failures = [];
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  const context = await browser.newContext({ ...devices[dev] });
  const page = await context.newPage();
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('#tabs');
  const level = () => page.evaluate(() => document.querySelector('.level-num')?.firstChild?.textContent?.trim());

  await page.click('#tabs [data-tab="programme"]');
  await page.waitForSelector('.level-num');
  const before = await level();

  // Historique : le dernier test propose le palier 4 (2 tests : 4 et 4).
  await page.click('#tabs [data-tab="progression"]');
  const rows = page.locator('details.hist');
  await rows.first().evaluate((el) => { el.open = true; });
  await page.waitForTimeout(300);
  const testText = await rows.first().textContent();
  await rows.first().screenshot({ path: `${out}/${name}-1-test-historique.png` });
  const runRow = rows.nth(2);
  await runRow.evaluate((el) => { el.open = true; });
  await page.waitForTimeout(300);
  const runText = await runRow.textContent();
  await runRow.screenshot({ path: `${out}/${name}-2-course-distance.png` });
  const oldTest = await rows.nth(1).evaluate((el) => { el.open = true; return el.textContent; });

  await page.click('[data-setpalier="4|t2"]');
  await page.waitForSelector('text=Palier 4 choisi');
  const stored1 = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).settings.palierManuel);
  await page.click('#tabs [data-tab="programme"]');
  await page.waitForSelector('.level-num');
  const afterTest = await level();
  const reasonOk = (await page.textContent('#app')).includes('choisi par toi');
  const autoBtn = await page.isVisible('[data-palierauto]');
  // Choix libre : palier 3.
  await page.click('[data-palierpick]');
  await page.waitForSelector('.palier-list');
  await page.locator('section.level').screenshot({ path: `${out}/${name}-3-choisir-palier.png` });
  const tag = await page.locator('.palier-opt', { hasText: 'tes tests' }).textContent();
  await page.click('[data-setpalier="3|"]');
  await page.waitForTimeout(300);
  const afterPick = await level();
  await page.screenshot({ path: `${out}/${name}-4-programme-palier-3.png` });
  // Retour au calcul automatique.
  await page.click('[data-palierauto]');
  await page.waitForTimeout(300);
  const afterAuto = await level();

  const checks = {
    'palier de départ calculé (2)': before === '2',
    'test : distance en courant (somme des blocs)': testText.includes('Distance en courant') && testText.includes('somme des blocs'),
    'test : GPS imprécis signalé (bloc ≈)': testText.includes('≈') && testText.includes('GPS imprécis'),
    'test : 2 tests concordants, bouton palier 4': testText.includes('Passer au palier 4') && testText.includes('paliers 4 et 4'),
    'ancien test : pas de proposition': !oldTest.includes('Passer au palier'),
    'course : distance en courant + alerte GPS': runText.includes('Distance en courant') && runText.includes('2,71 km') && runText.includes('±24 m'),
    'choix enregistré': stored1?.level === 4 && stored1?.test === 't2',
    'programme : palier 4 après le test': afterTest === '4' && reasonOk && autoBtn,
    'liste : tes tests sur le palier 4': /^4/.test(tag.trim()),
    'choix libre : palier 3': afterPick === '3',
    'retour automatique : palier 2': afterAuto === '2',
    'aucune erreur': errors.length === 0,
  };
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
