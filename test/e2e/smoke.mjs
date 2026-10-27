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
// Fond de carte : tuiles servies vides en test (pas d'accès réseau garanti).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
await page.route('**/*.basemaps.cartocdn.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
await page.goto(base);
await page.waitForFunction(() => navigator.serviceWorker?.controller || true);
await page.screenshot({ path: '/tmp/foulee-accueil.png', fullPage: true });

await page.click('[data-tab="programme"]');
await page.waitForTimeout(800); // chargement des sons
await page.click('[data-start="test-4"]');
await page.waitForSelector('#count');
await page.waitForTimeout(1500);
const t1 = await page.evaluate(() => document.getElementById('player').currentTime);
const now1 = await page.textContent('#now');
await page.click('[data-skip]'); // intro → étape 1
await page.waitForTimeout(300);
const now2 = await page.textContent('#stepno');
// Course simulée : 3 m toutes les 600 ms vers le nord.
for (let i = 1; i <= 10; i++) {
  await context.setGeolocation({ latitude: 48.897 + (i * 3) / 111195, longitude: 2.253, accuracy: 5 });
  await page.waitForTimeout(600);
}
const gpsLine = await page.textContent('#dist');
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
await page.waitForSelector('.map.leaflet-container', { timeout: 5000 }).catch(() => {});
const bilanMap = await page.locator('.map.leaflet-container path.leaflet-interactive').count();
await page.screenshot({ path: '/tmp/foulee-bilan.png', fullPage: true });
await page.click('[data-scale="difficulte"][data-v="2"]');
await page.fill('#comm', 'Test automatique');
await page.click('[data-savebilan]');
const journal = await page.textContent('#app');
await page.click('details.hist summary');
await page.waitForTimeout(800);
const histMap = await page.locator('details.hist[open] .map.leaflet-container').count();
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history[0]);
await page.screenshot({ path: '/tmp/foulee-journal.png', fullPage: true });

// Import d'un historique, puis saisie manuelle d'une séance de natation.
await page.click('[data-tab="profil"]');
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
await page.click('[data-tab="profil"]');
await page.setInputFiles('#importfile', new URL('../fixtures/historique.json', import.meta.url).pathname);
await page.waitForSelector('[data-manual="natation"]');
const count = await page.locator('#app details.hist').count();
await page.click('[data-tab="accueil"]');
const accueil = await page.textContent('#app');
// Calendrier : un jour passé montre la séance faite, un jour à venir la séance prévue.
await page.click('[data-pickday="2026-10-23"]');
const dayPast = await page.textContent('#app');
const futureRun = page.locator('.week button:not(.past):has(.dot.course:not(.done))').last();
await futureRun.click();
const dayFuture = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-calendrier.png', fullPage: true });
await page.click('[data-tab="accueil"]');
await page.screenshot({ path: '/tmp/foulee-accueil2.png', fullPage: true });
await page.click('[data-tab="programme"]');
const programme = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-programme.png', fullPage: true });
await page.click('[data-tab="progression"]');
await page.screenshot({ path: '/tmp/foulee-progression.png', fullPage: true });
await page.click('[data-tab="demarrer"]');
await page.screenshot({ path: '/tmp/foulee-demarrer.png', fullPage: true });
await page.click('[data-tab="profil"]');
await page.screenshot({ path: '/tmp/foulee-profil.png', fullPage: true });
// Reprise après fermeture de l'app en pleine séance.
await page.click('[data-tab="programme"]');
await page.click('[data-start="test-4"]');
await page.waitForTimeout(6500);
await page.reload();
await page.waitForSelector('[data-resume]');
const resumeText = await page.textContent('#app');
await page.waitForTimeout(800);
await page.click('[data-resume]');
await page.waitForSelector('#count');
await page.waitForTimeout(500);
const resumedAt = await page.evaluate(() => document.getElementById('player').currentTime);
// Pause non voulue (simulée) : bandeau d'interruption.
await page.evaluate(() => document.getElementById('player').pause());
await page.waitForTimeout(300);
const interruptedText = await page.textContent('#app');
await browser.close();
server.close();

const checks = {
  'la piste avance': t1 > 1,
  'GPS mesuré pendant la séance': /^0,0[23]$/.test(gpsLine),
  'verrou tactile bloque les clics': lockedStill === 1 && before === after,
  'appui long déverrouille': unlocked,
  'distance GPS reprise au bilan': bilanText.includes('GPS : 0,0'),
  'intro affichée': now1 === 'Prépare-toi',
  'étape suivante': now2.endsWith("Marche d'échauffement"),
  'durée de piste ≈ 4 min + intro + fin': dur > 250 && dur < 262,
  'tracé affiché au bilan': bilanMap >= 2,
  'tracé enregistré compact': Boolean(stored.trace?.seg?.length) && !stored.gpsPoints,
  'tracé dans l\u2019historique': histMap === 1,
  'bilan au journal': journal.includes('Test automatique') && journal.includes('difficulté 2/5'),
  'distance natation calculée': swimdist.includes('750 m'),
  'natation saisie au journal': journal2.includes('30 × 25 m = 750 m') && journal2.includes('essoufflement 4/5'),
  'historique importé': journal2.includes('3,35 km') && journal2.includes('28 × 25 m = 700 m'),
  'pas de doublon à la réimport': count === 7,
  'reprise proposée après fermeture': resumeText.includes('Séance interrompue') && resumeText.includes('Test du guidage'),
  'reprise au bon endroit': resumedAt > 5,
  'bandeau si pause non voulue': interruptedText.includes('Séance interrompue (appel'),
  'calendrier : jour passé = séance faite': dayPast.includes('3,35 km') && dayPast.includes('vendredi 23 octobre'),
  'calendrier : jour à venir = séance prévue': /course · palier \d+\/12/.test(dayFuture) && dayFuture.includes('La faire maintenant'),
  'programme calculé (course + natation)': /palier [23]\/12/.test(programme) && programme.includes('32 longueurs'),
  'accueil : dernière séance = la plus récente': accueil.includes('mercredi 28 octobre') && !accueil.includes('30 septembre'),
  'aucune erreur hors alertes d\u2019import': errors.filter((e) => !e.includes('séance(s) ajoutée(s)')).length === 0,
};
console.log({ resumedAt, t1, now1, now2, dur, gpsLine, swimdist, count, errors });
for (const [k, v] of Object.entries(checks)) console.log(v ? 'ok  ' : 'FAIL', k);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
