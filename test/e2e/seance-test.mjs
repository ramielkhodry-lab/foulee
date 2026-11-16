// Séance test (4 × 10 s) : le vrai moteur de séance, et rien n'est enregistré.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-seance-test';
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
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course'], objectifCourse: '10km', joursCourse: [1, 5] } },
  sessions: [],
  history: [{ id: 'r1', sport: 'course', source: 'guidee', date: '2026-11-13T18:00:00', level: 4, sessionName: 'Palier 4', elapsedSec: 2400, distanceKm: 4.1, difficulte: 3 }],
  settings: { son: 'musique', annonces: 'signaux' },
};
// Une course interrompue gardée : la séance test ne doit ni l'écraser ni l'effacer.
const realLive = { session: { id: 'plan-x', name: 'Palier 4 · vendredi', steps: [{ kind: 'marche', duration: 300 }] }, startedAt: '2026-11-16T08:00:00', pos: 100, skipped: [], savedAt: 0 };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const failures = [];
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  const context = await browser.newContext({ ...devices[dev], permissions: ['geolocation'], geolocation: { latitude: 48.897, longitude: 2.253, accuracy: 5 } });
  const page = await context.newPage();
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(([d, l]) => {
    if (!localStorage.getItem('foulee.v1')) {
      localStorage.setItem('foulee.v1', JSON.stringify(d));
      localStorage.setItem('foulee.live', JSON.stringify({ ...l, savedAt: Date.now() - 3600 * 1000 }));
    }
  }, [data, realLive]);
  await page.goto(base);
  await page.waitForSelector('#tabs');
  const before = await page.evaluate(() => [localStorage.getItem('foulee.v1'), localStorage.getItem('foulee.live')]);

  await page.click('#tabs [data-tab="demarrer"]');
  await page.click('[data-starttest]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  const prepNote = await page.isVisible('text=Séance test, elle ne compte nulle part');
  await page.screenshot({ path: `${out}/${name}-1-avant-de-partir.png` });
  await page.click('[data-ready]');
  await page.waitForSelector('#count');
  const segs = await page.locator('#bar .seg').count();
  // Juste avant la mi-séance (48 s de piste), puis on laisse jouer.
  await page.evaluate(() => { document.getElementById('player').currentTime = 46.5; });
  await page.waitForFunction(() => !document.getElementById('halfway').hidden, null, { timeout: 8000 });
  await page.screenshot({ path: `${out}/${name}-2-mi-seance.png` });
  // Pendant le test, aucune sauvegarde de reprise : la course interrompue d'avant reste intacte.
  await page.waitForTimeout(6000);
  const liveDuring = await page.evaluate(() => localStorage.getItem('foulee.live'));
  await page.click('[data-touchlock]');
  const locked = await page.isVisible('#touchlock');
  await page.screenshot({ path: `${out}/${name}-3-verrou.png` });
  await page.evaluate(() => { document.getElementById('touchlock')?.remove(); });
  await page.evaluate(() => { document.getElementById('player').currentTime = 80; });
  await page.waitForSelector('#livedone:not([hidden])', { timeout: 15000 });
  const doneLabel = await page.textContent('#livedone');
  await page.click('#livedone');
  await page.waitForSelector('text=Test terminé');
  await page.screenshot({ path: `${out}/${name}-4-fin.png` });
  const after = await page.evaluate(() => [localStorage.getItem('foulee.v1'), localStorage.getItem('foulee.live'), localStorage.getItem('foulee.bilan')]);

  // Test arrêté en route puis app rouverte : rien à reprendre, rien à faire.
  await page.click('[data-starttest]');
  await page.waitForSelector('[data-ready]:not([disabled])', { timeout: 15000 });
  await page.click('[data-ready]');
  await page.waitForSelector('#count');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector('#tabs');
  await page.click('#tabs [data-tab="demarrer"]');
  const resumeLabels = await page.locator('[data-resume]').allTextContents();
  const pending = await page.isVisible('[data-backbilan]');

  const checks = {
    'avant de partir : séance test annoncée': prepNote,
    'barre : 9 étapes': segs === 9,
    'mi-séance affichée': true,
    'verrou posé': locked,
    'bouton de fin : « Terminer le test »': doneLabel.includes('Terminer le test'),
    'données inchangées (historique, programme, réglages)': after[0] === before[0],
    'sauvegarde de la vraie course intacte pendant et après': liveDuring === before[1] && after[1] === before[1],
    'pas de bilan en attente': after[2] === null && !pending,
    'après fermeture : seule la vraie course est proposée': resumeLabels.every((x) => !x.includes('Séance test')),
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
