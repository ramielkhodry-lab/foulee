// Toutes les courses (programme, libre, refaite) : distance du segment en cours en direct,
// détail segment par segment dans le bilan et l'historique. iPhone 13 et Pixel 7 émulés.
// Captures dans le dossier passé en argument (par défaut /tmp/foulee-segments).
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-segments';
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
  // Séance de programme : échauffement 60 s, course lente 30 s, marche 60 s, course 30 s, récup 60 s (intro 7 s).
  await page.click('[data-start="test-4"]');
  await page.waitForSelector('[data-ready]:not([disabled])');
  await page.click('[data-ready]');
  await page.waitForSelector('#count');
  const seek = (t) => page.evaluate((x) => { document.getElementById('player').currentTime = x; }, t);
  let lat = 48.897;
  const walk = async (n) => {
    for (let i = 0; i < n; i++) {
      lat += 2 / 111195;
      await context.setGeolocation({ latitude: lat, longitude: 2.253, accuracy: 5 });
      await page.waitForTimeout(400);
    }
  };
  const segKm = async () => parseFloat(((await page.textContent('#segkm b')) || '').replace(',', '.'));
  const introHidden = await page.locator('#segkm').isHidden();
  await seek(20); await page.waitForTimeout(300);
  await walk(6);
  const echKm = await segKm();
  await seek(67.05); await page.waitForTimeout(600);
  const course0 = await segKm();
  await walk(8);
  const courseKm = await segKm();
  const courseTxt = await page.textContent('#segkm');
  const total1 = parseFloat((await page.textContent('#dist')).replace(',', '.'));
  await page.screenshot({ path: `${out}/${name}-1-en-course.png` });
  await seek(97.05); await page.waitForTimeout(600);
  const marche0 = await segKm();
  await walk(5);
  const marcheTxt = await page.textContent('#segkm');
  await page.screenshot({ path: `${out}/${name}-2-en-marche.png` });
  await seek(157.05); await page.waitForTimeout(300);
  await walk(5);
  await seek(187.05); await page.waitForTimeout(300);
  await walk(5);
  await seek(246); await page.waitForTimeout(2500);
  await walk(14);
  const plusTxt = await page.textContent('#segkm');
  await page.click('#livedone');
  await page.waitForSelector('[data-savebilan]');
  const bilanText = await page.textContent('#app');
  const rows = await page.$$eval('.run-segs .segs li', (l) => l.map((x) => x.textContent));
  await page.locator('.run-segs').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-3-bilan.png` });
  await page.click('[data-scale="difficulte"][data-v="2"]');
  await page.click('[data-savebilan]');
  const h = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history.find((x) => x.source === 'guidee'));
  await page.click('[data-tab="accueil"]');
  await page.waitForTimeout(600);
  const det = page.locator(`details.hist[data-hist="${h.id}"]`).first();
  if (!(await det.evaluate((e) => e.open))) await det.locator('summary').click();
  await page.waitForTimeout(400);
  await det.locator('.run-segs').scrollIntoViewIfNeeded();
  const histRows = await det.locator('.run-segs .segs li').count();
  await page.screenshot({ path: `${out}/${name}-4-historique.png` });
  // Sans GPS : la même séance enregistrée sans points → « – », jamais 0 km.
  const noGps = await page.evaluate(async () => {
    const m = await import('./js/libre.js');
    return m.courseSegments([{ kind: 'course', duration: 30 }], [1, 30001], [], [], null);
  });
  const kinds = (h?.segments || []).map((g) => g.kind).join(',');
  const checks = {
    'avant le départ : pas de ligne de segment': introHidden,
    'échauffement : distance du segment': echKm > 0,
    'course : remise à zéro au changement d’étape': course0 < 0.005,
    'course : distance qui avance, plus petite que la séance': courseKm > 0.005 && courseKm < total1,
    'course : « sur cette course »': /sur cette course/.test(courseTxt),
    'marche : remise à zéro, « sur cette marche »': marche0 < 0.005 && /sur cette marche/.test(marcheTxt),
    'après le programme : « en plus »': /en plus/.test(plusTxt),
    'bilan : tableau segment par segment': rows.length === 6 && /Course 1/.test(rows[1]) && /Marche 1/.test(rows[2]) && /Course 2/.test(rows[3]),
    'bilan : totaux': /En courant/.test(bilanText) && /En marchant/.test(bilanText) && /Séance entière/.test(bilanText),
    'enregistré : segments (course lente = course)': kinds === 'echauffement,course,marche,course,recuperation,plus',
    'enregistré : chaque segment mesuré': h.segments.every((g) => typeof g.km === 'number'),
    'historique : même tableau': histRows === 6,
    'sans GPS : km null': noGps?.[0]?.km === null,
    'aucune erreur': errors.length === 0,
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'ok ' : 'ÉCHEC'} ${name} : ${k}`);
    if (!v) failures.push(`${name} : ${k}`);
  }
  if (errors.length) console.log(errors);
  if (process.env.DEBUG) console.log(JSON.stringify(h?.segments), { echKm, course0, courseKm, total1, marche0, rows });
  await context.close();
}
await browser.close();
server.close();
if (failures.length) process.exit(1);
