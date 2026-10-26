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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
await page.waitForTimeout(2500);
const t1 = await page.evaluate(() => document.getElementById('player').currentTime);
const now1 = await page.textContent('#now');
await page.screenshot({ path: '/tmp/foulee-live.png', fullPage: true });
await page.click('[data-skip]'); // intro → saute à l'étape 1
await page.waitForTimeout(500);
const now2 = await page.textContent('#now');
const dur = await page.evaluate(() => document.getElementById('player').duration);
await page.click('[data-finish]');
await page.click('[data-scale="difficulte"][data-v="2"]');
await page.fill('#comm', 'Test automatique');
await page.click('[data-savebilan]');
const journal = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-journal.png', fullPage: true });
await browser.close();
server.close();

const checks = {
  'la piste avance': t1 > 1.5,
  'intro affichée': now1 === 'Prépare-toi',
  'étape suivante': now2 === "Marche d'échauffement",
  'durée de piste ≈ 4 min + intro + fin': dur > 250 && dur < 262,
  'bilan au journal': journal.includes('Test automatique') && journal.includes('Difficulté 2/5'),
  'aucune erreur': errors.length === 0,
};
console.log({ t1, now1, now2, dur, errors });
for (const [k, v] of Object.entries(checks)) console.log(v ? 'ok  ' : 'FAIL', k);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
