// Parcours proposé (iPhone 13 et Pixel 7 émulés) : boucle de la longueur de la séance avant de
// partir, autre boucle, ± 0,5 km, point glissé, puis la boucle sous le tracé pendant la séance.
// Le serveur Foulée et le service d'itinéraire sont simulés (les rues sont des lignes droites).
// Captures dans le dossier passé en argument (par défaut /tmp/foulee-parcours).
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-parcours';
await mkdir(out, { recursive: true });
const root = new URL('../../public/', import.meta.url).pathname;
const API = 'http://api.foulee.test';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/js/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(`export const API_URL = '${API}';`);
  }
  const path = join(root, pathname.replace(/\/$/, '/index.html'));
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const hav = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
function encode(points) {
  let o = '';
  let prev = [0, 0];
  const enc = (v) => { let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 0x20) { o += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>>= 5; } o += String.fromCharCode(n + 63); };
  for (const p of points) { const c = [Math.round(p[0] * 1e5), Math.round(p[1] * 1e5)]; enc(c[0] - prev[0]); enc(c[1] - prev[1]); prev = c; }
  return o;
}
// « Rues » : on passe en escalier (d'abord la latitude, puis la longitude) entre deux points.
function fakeRoute(pts) {
  const line = [pts[0]];
  for (let i = 1; i < pts.length; i++) line.push([pts[i][0], pts[i - 1][1]], pts[i]);
  let m = 0;
  for (let i = 1; i < line.length; i++) m += hav(line[i - 1], line[i]);
  return { km: Math.round(m / 10) / 100, poly: encode(line) };
}

const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course'], objectifCourse: '10km', joursCourse: [1, 5] } },
  sessions: [],
  history: [
    { id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-09T18:00:00', level: 4, sessionName: 'Palier 4', elapsedSec: 2447, distanceKm: 4.44, difficulte: 3 },
    { id: 'r2', sport: 'course', source: 'guidee', date: '2026-11-13T18:00:00', level: 4, sessionName: 'Palier 4', elapsedSec: 2400, distanceKm: 4.3, difficulte: 3 },
    { id: 'r3', sport: 'course', source: 'guidee', date: '2026-11-16T18:00:00', level: 4, sessionName: 'Palier 4', elapsedSec: 2460, distanceKm: 4.6, difficulte: 3 },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const failures = [];
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  let lat = 48.897;
  const lon = 2.253;
  const context = await browser.newContext({ ...devices[dev], permissions: ['geolocation'], geolocation: { latitude: lat, longitude: lon, accuracy: 5 } });
  const page = await context.newPage();
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const calls = [];
  let failNext = false;
  await page.route(`${API}/**`, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST, PUT' } });
    if (path === '/me/parcours') {
      const body = JSON.parse(req.postData());
      calls.push({ points: body.points, auth: req.headers().authorization });
      if (failNext) { failNext = false; return r.fulfill({ status: 503, headers, body: JSON.stringify({ error: 'Service d’itinéraire indisponible, réessaie dans un moment.' }) }); }
      return r.fulfill({ status: 200, headers, body: JSON.stringify(fakeRoute(body.points)) });
    }
    if (path === '/status') return r.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true }) });
    return r.fulfill({ status: 200, headers, body: JSON.stringify({}) });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
  await page.addInitScript((d) => {
    if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d));
    localStorage.setItem('foulee.token', 'jeton-test');
    localStorage.setItem('foulee.user', JSON.stringify({ id: 'u1', prenom: 'Rami' }));
  }, data);
  await page.goto(base);
  await page.waitForSelector('#tabs');
  const before = await page.evaluate(() => localStorage.getItem('foulee.v1'));

  await page.click('[data-tab="programme"]');
  await page.waitForTimeout(800);
  const startBtn = await page.$('[data-start^="plan-"], [data-startplan]');
  if (await page.$('[data-start="test-4"]')) await page.click('[data-start="test-4"]');
  else await startBtn.click();
  await page.waitForSelector('#prepparcours');
  await page.waitForSelector('[data-parfind]:not([disabled])', { timeout: 10000 });
  const intro = await page.textContent('#prepparcours');
  const minutes = await page.evaluate(() => Math.round(Number(document.querySelector('.prep-sum .hero-num').firstChild.textContent)));
  await page.locator('#prepparcours').screenshot({ path: `${out}/${name}-1-avant.png` });
  await page.click('[data-parfind]');
  await page.waitForSelector('#parmap.leaflet-container');
  await page.waitForTimeout(500);
  const km1 = await page.textContent('.par-km b');
  const firstCall = calls[0];
  await page.screenshot({ path: `${out}/${name}-2-boucle.png`, fullPage: true });

  const n0 = calls.length;
  await page.click('[data-parmore]');
  await page.waitForSelector('#parmap.leaflet-container');
  const target2 = await page.textContent('.par-km span');
  await page.click('[data-parother]');
  await page.waitForSelector('#parmap.leaflet-container');
  await page.waitForTimeout(300);
  const otherCalls = calls.length - n0;

  // Glisser le point 2 vers l'ouest : un seul calcul, qui passe par le nouveau point.
  const n1 = calls.length;
  const pin = page.locator('.wp-pin').nth(1);
  const box = await pin.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((n) => document.querySelector('#parmap.leaflet-container') && true, n1);
  await page.waitForTimeout(800);
  const dragCalls = calls.length - n1;
  await page.screenshot({ path: `${out}/${name}-3-point-deplace.png`, fullPage: true });

  // Service en panne : message et « Réessayer ».
  failNext = true;
  await page.click('[data-parother]');
  await page.waitForSelector('[data-parfind]');
  const errText = await page.textContent('#prepparcours');
  await page.screenshot({ path: `${out}/${name}-4-erreur.png` });
  await page.click('[data-parfind]');
  await page.waitForSelector('#parmap.leaflet-container');
  const kmFinal = await page.textContent('.par-km b');

  // Départ : la boucle suit la séance ; « Mon parcours » montre la boucle et le tracé.
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  await page.click('[data-ready]');
  await page.waitForSelector('[data-livepar]');
  const liveSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.live') || 'null')?.session?.parcours);
  await page.click('[data-livepar] summary');
  await page.waitForSelector('#livemap.leaflet-container');
  for (let i = 0; i < 12; i++) {
    lat += 3 / 111195;
    await context.setGeolocation({ latitude: lat, longitude: lon + i * 0.00002, accuracy: 5 });
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3200);
  const drawn = await page.evaluate(() => [...document.querySelectorAll('#livemap path.leaflet-interactive')].map((p) => p.getAttribute('stroke')));
  await page.screenshot({ path: `${out}/${name}-5-seance.png`, fullPage: true });

  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));
  const checks = {
    'distance visée = durée × allure des 3 dernières courses': /tes 3 dernières courses/.test(intro) && new RegExp(`${minutes} min à 6,6 km/h`).test(intro),
    'premier calcul : départ = position, boucle fermée, jeton envoyé': firstCall && firstCall.points[0][0] === 48.897 && firstCall.points.at(-1)[0] === 48.897 && firstCall.auth === 'Bearer jeton-test' && firstCall.points.length === 5,
    'distance de la boucle affichée': /^\d+,\d$/.test(km1.trim()),
    '+ 0,5 km : la cible augmente': /tu vises \d+,5|tu vises \d+,0/.test(target2),
    'autre boucle : nouveaux calculs (3 au plus)': otherCalls >= 2 && otherCalls <= 6,
    'point glissé : un seul calcul': dragCalls === 1,
    'service en panne : message lisible': /indisponible/.test(errText),
    'réessayer : boucle revenue': /^\d+,\d$/.test(kmFinal.trim()),
    'parcours gardé avec la séance en cours (reprise)': Boolean(liveSaved?.poly) && liveSaved.km > 0,
    'pendant la séance : boucle blanche + tracé vert': drawn.includes('#FFFFFF') && drawn.includes('#C8FF2E'),
    'historique inchangé (rien du parcours dedans)': JSON.stringify(after.history) === JSON.stringify(JSON.parse(before).history),
    'aucune erreur JS': errors.length === 0,
  };
  for (const [k, ok] of Object.entries(checks)) {
    console.log(`${ok ? '✓' : '✗'} ${name} : ${k}`);
    if (!ok) failures.push(`${name} : ${k}`);
  }
  if (errors.length) console.log(errors);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) { console.log(`\n${failures.length} échec(s)`); process.exit(1); }
console.log('\nTout est bon.');
