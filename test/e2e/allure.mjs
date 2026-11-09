// Allure du moment pendant une séance de course (iPhone 13 et Pixel 7 émulés) : elle suit
// les dernières secondes, pas la moyenne, et affiche « – » quand le GPS ne suit plus ou est
// imprécis. Captures dans le dossier passé en argument (par défaut /tmp/foulee-allure).
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-allure';
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
  let lat = 48.897;
  // `speed` m/s pendant `sec` secondes, une position par seconde.
  const move = async (sec, speed, accuracy = 5) => {
    for (let i = 0; i < sec; i++) {
      lat += speed / 111195;
      await context.setGeolocation({ latitude: lat, longitude: 2.253, accuracy });
      await page.waitForTimeout(1000);
    }
  };
  const pace = () => page.textContent('#pace');
  const secOf = (s) => { const m = /^(\d+)'(\d\d)$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const atStart = await pace();
  await move(16, 1.4); // marche ≈ 11'54/km
  const walkPace = secOf(await pace());
  await page.evaluate(() => { const a = document.getElementById('player'); a.currentTime = 7 + 60 + 1; }); // étape de course
  await move(26, 3); // course ≈ 5'33/km
  const runPace = secOf(await pace());
  const avg = await page.textContent('#paceavg');
  const color = await page.$eval('#pace', (e) => getComputedStyle(e).color);
  await page.screenshot({ path: `${out}/${name}-1-course.png` });
  await page.waitForTimeout(11000); // plus aucune position : GPS perdu ou arrêt
  const stale = await pace();
  await page.screenshot({ path: `${out}/${name}-2-gps-perdu.png` });
  await move(20, 3, 28); // GPS retenu pour la distance mais trop imprécis pour l'allure
  const imprecise = await pace();
  const checks = {
    'au départ : « – »': atStart === '–',
    'marche : allure ≈ 11:54': walkPace && Math.abs(walkPace - 714) < 60,
    'course : allure ≈ 5:33, pas la moyenne': runPace && Math.abs(runPace - 333) < 25,
    'moyenne affichée à part et plus lente': secOf(avg.replace('moy. ', '')) > runPace,
    'allure en vert pendant la course': color === 'rgb(200, 255, 46)',
    'GPS muet 11 s : « – »': stale === '–',
    'GPS imprécis (±28 m) : « – »': imprecise === '–',
    'aucune erreur': errors.length === 0,
  };
  if (process.env.DEBUG) console.log({ atStart, walkPace, runPace, avg, stale, imprecise });
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
