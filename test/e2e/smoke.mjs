// Parcours complet dans Chromium : démarrer la séance test, vérifier l'affichage,
// passer une étape, terminer, enregistrer le bilan, retrouver la séance au journal.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

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

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 48.897, longitude: 2.253, accuracy: 5 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
await page.goto(base);
await page.waitForFunction(() => navigator.serviceWorker?.controller || true);
await page.screenshot({ path: '/tmp/foulee-accueil.png', fullPage: true });

await page.click('[data-tab="seance"]');
await page.waitForTimeout(800); // chargement des sons
await page.click('[data-start="test-4"]');
await page.waitForSelector('#count');
await page.waitForTimeout(1500);
const t1 = await page.evaluate(() => document.getElementById('player').currentTime);
const now1 = await page.textContent('#now');
await page.click('[data-skip]'); // intro → étape 1
await page.waitForTimeout(300);
const now2 = await page.textContent('#now');
// Course simulée : 3 m toutes les 600 ms vers le nord.
for (let i = 1; i <= 10; i++) {
  await context.setGeolocation({ latitude: 48.897 + (i * 3) / 111195, longitude: 2.253, accuracy: 5 });
  await page.waitForTimeout(600);
}
const gpsLine = await page.textContent('#gps');
// Verrou tactile : un clic ne passe plus, un appui long déverrouille.
await page.click('[data-touchlock]');
const before = await page.evaluate(() => document.getElementById('player').paused);
await page.mouse.click(100, 650);
const lockedStill = await page.locator('#touchlock').count();
await page.mouse.move(195, 400);
await page.mouse.down();
await page.waitForTimeout(2300);
await page.mouse.up();
const unlocked = (await page.locator('#touchlock').count()) === 0;
const after = await page.evaluate(() => document.getElementById('player').paused);
await page.screenshot({ path: '/tmp/foulee-live.png', fullPage: true });
const dur = await page.evaluate(() => document.getElementById('player').duration);
await page.click('[data-finish]');
const bilanText = await page.textContent('#app');
await page.click('[data-scale="difficulte"][data-v="2"]');
await page.fill('#comm', 'Test automatique');
await page.click('[data-savebilan]');
const journal = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-journal.png', fullPage: true });

// Import d'un historique, puis saisie manuelle d'une séance de natation.
await page.click('[data-tab="reglages"]');
await page.setInputFiles('#importfile', new URL('../fixtures/historique.json', import.meta.url).pathname);
await page.waitForSelector('[data-manual="natation"]');
await page.click('[data-manual="natation"]');
await page.fill('#date', '2026-10-28');
await page.fill('#duree', '50');
await page.fill('#longueurs', '30');
await page.dispatchEvent('#longueurs', 'change');
const swimdist = await page.textContent('#swimdist');
await page.check('[data-nage="crawl"]');
await page.click('[data-scale="essoufflement"][data-v="4"]');
await page.click('[data-savemanual]');
const journal2 = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-journal2.png', fullPage: true });
// Réimporter ne doit rien dupliquer.
await page.click('[data-tab="reglages"]');
await page.setInputFiles('#importfile', new URL('../fixtures/historique.json', import.meta.url).pathname);
await page.waitForSelector('[data-manual="natation"]');
const count = await page.locator('#app .card').count();
await browser.close();
server.close();

const checks = {
  'la piste avance': t1 > 1,
  'GPS mesuré pendant la séance': /0,0[23] km/.test(gpsLine),
  'verrou tactile bloque les clics': lockedStill === 1 && before === after,
  'appui long déverrouille': unlocked,
  'distance GPS reprise au bilan': bilanText.includes('GPS : 0,0'),
  'intro affichée': now1 === 'Prépare-toi',
  'étape suivante': now2 === "Marche d'échauffement",
  'durée de piste ≈ 4 min + intro + fin': dur > 250 && dur < 262,
  'bilan au journal': journal.includes('Test automatique') && journal.includes('difficulté 2/5'),
  'distance natation calculée': swimdist.includes('750 m'),
  'natation saisie au journal': journal2.includes('30 × 25 m = 750 m') && journal2.includes('essoufflement 4/5'),
  'historique importé': journal2.includes('3,35 km') && journal2.includes('28 × 25 m = 700 m'),
  'pas de doublon à la réimport': count === 7,
  'aucune erreur hors alertes d\u2019import': errors.filter((e) => !e.includes('séance(s) ajoutée(s)')).length === 0,
};
console.log({ t1, now1, now2, dur, gpsLine, swimdist, count, errors });
for (const [k, v] of Object.entries(checks)) console.log(v ? 'ok  ' : 'FAIL', k);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
