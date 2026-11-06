// Séance de course dans Chromium (iPhone 13 et Pixel 7 émulés) : barre colorée par étape,
// signal de mi-séance, puis fin du programme sans arrêt de la séance : chrono, GPS et
// distance continuent jusqu'à « Terminer », et le bilan les compte.
// Captures dans le dossier passé en argument (par défaut /tmp/foulee-fin).
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-fin';
await mkdir(out, { recursive: true });
const root = new URL('../../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const failures = [];
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  const context = await browser.newContext({ ...devices[dev], permissions: ['geolocation'], geolocation: { latitude: 48.897, longitude: 2.253, accuracy: 5 } });
  const page = await context.newPage();
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
  await page.goto(base);
  await page.click('[data-tab="programme"]');
  await page.waitForTimeout(800);
  await page.click('[data-start="test-4"]');
  await page.waitForSelector('[data-ready]:not([disabled])');
  await page.click('[data-ready]');
  await page.waitForSelector('#count');
  const player = (js) => page.evaluate(js);
  let lat = 48.897;
  const walk = async (n) => {
    for (let i = 0; i < n; i++) {
      lat += 4 / 111195; // 4 m vers le nord
      await context.setGeolocation({ latitude: lat, longitude: 2.253, accuracy: 5 });
      await page.waitForTimeout(400);
    }
  };
  await walk(3);
  // Barre : une case par étape, vert = course, blanc = marche.
  const segs = await page.$$eval('#bar .seg', (l) => l.map((x) => x.className));
  // Mi-séance : on se place juste avant, le passage affiche le message.
  await player(() => { const a = document.getElementById('player'); a.currentTime = 7 + 120 - 1.5; });
  await page.waitForTimeout(4000); // après le flash
  const halfShown = await page.isVisible('#halfway');
  await page.screenshot({ path: `${out}/${name}-1-moitie.png` });
  await page.waitForTimeout(7000);
  const halfHidden = !(await page.isVisible('#halfway'));
  // Fin du programme : la piste se termine, la séance non.
  await player(() => { const a = document.getElementById('player'); a.currentTime = a.duration - 1; });
  await page.waitForTimeout(2500);
  const ended = await player(() => document.getElementById('player').ended);
  const distAtEnd = await page.textContent('#dist');
  const t1 = await page.textContent('#elapsed');
  await walk(8);
  const t2 = await page.textContent('#elapsed');
  const distAfter = await page.textContent('#dist');
  const overText = await page.textContent('#live');
  const noControls = (await page.locator('[data-toggle]').count()) === 0;
  await page.screenshot({ path: `${out}/${name}-2-apres-programme.png` });
  await page.click('#livedone');
  await page.waitForSelector('[data-savebilan]');
  const bilanText = await page.textContent('#app');
  await page.screenshot({ path: `${out}/${name}-3-bilan.png`, fullPage: true });
  await page.click('[data-scale="difficulte"][data-v="2"]');
  await page.click('[data-savebilan]');
  const h = await player(() => JSON.parse(localStorage.getItem('foulee.v1')).history.find((x) => x.source === 'guidee'));
  const sec = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
  const checks = {
    'barre : cases course et marche': segs.length === 5 && segs.some((c) => c.includes('course')) && segs.some((c) => c.includes('marche')),
    'mi-séance : message affiché au passage': halfShown,
    'mi-séance : message masqué ensuite': halfHidden,
    'fin du programme : piste finie, toujours sur la séance': ended && overText.includes('Programme fini'),
    'fin du programme : plus de pause ni d’étape suivante': noControls,
    'après le programme : le chrono avance': sec(t2) - sec(t1) >= 2,
    'après le programme : la distance avance': parseFloat(distAfter.replace(',', '.')) > parseFloat(distAtEnd.replace(',', '.')),
    'bilan : temps après le programme indiqué': /dont \d+:\d\d après le programme/.test(bilanText),
    'enregistré : durée, prolongation, distance, heure de fin': h && h.prolongSec >= 2 && h.elapsedSec >= 240 + h.prolongSec - 2 && h.distanceKm > 0 && h.finMs >= h.stepMs.at(-1),
    'aucune erreur': errors.length === 0,
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'ok ' : 'ÉCHEC'} ${name} : ${k}`);
    if (!v) failures.push(`${name} : ${k}`);
  }
  if (errors.length) console.log(errors);
  if (process.env.DEBUG) console.log(JSON.stringify({ e: h?.elapsedSec, p: h?.prolongSec, d: h?.distanceKm, f: h?.finMs, s: h?.stepMs }));
  await context.close();
}
await browser.close();
server.close();
if (failures.length) process.exit(1);
