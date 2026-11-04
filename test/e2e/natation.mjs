// Natation à la piscine avec l'Apple Watch : longueurs (distance à la nage), mouvements, cardio
// envoyés par le Raccourci, rattachés à la séance saisie à la main (elle n'a pas d'heure).
// Serveur local (wrangler dev + D1 local), app servie en local.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('../../public/', import.meta.url).pathname;
const workerDir = new URL('../../worker/', import.meta.url).pathname;
const APP_PORT = 8788;
const API_PORT = 8787;
const APP = `http://localhost:${APP_PORT}`;
const API = `http://localhost:${API_PORT}`;

// Base locale neuve à chaque exécution.
await rm(join(workerDir, '.wrangler/state'), { recursive: true, force: true });
// Workers AI n'existe qu'à distance : la copie de test de la configuration s'en passe
// (la route des conseils répond alors « IA indisponible »).
const toml = (await readFile(join(workerDir, 'wrangler.toml'), 'utf8')).replace(/\n# Workers AI[^\n]*\n\[ai\]\nbinding = "AI"\n?/, '\n');
await writeFile(join(workerDir, 'wrangler.test.toml'), toml);
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'foulee', '--local', '--config', 'wrangler.test.toml'], { cwd: workerDir, stdio: 'ignore' });
const wrangler = spawn('npx', ['wrangler', 'dev', '--config', 'wrangler.test.toml', '--port', String(API_PORT), '--var', `APP_ORIGIN:${APP}`, '--var', 'RP_ID:localhost', '--var', 'APP_PATH:/'], { cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
// npx lance wrangler qui lance workerd : on arrête tout le groupe de processus.
const stopWrangler = () => { try { process.kill(-wrangler.pid, 'SIGTERM'); } catch {} };
process.on('exit', stopWrangler);
let wranglerLog = '';
wrangler.stdout.on('data', (d) => { wranglerLog += d; });
wrangler.stderr.on('data', (d) => { wranglerLog += d; });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${API}/status`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}

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
}).listen(APP_PORT);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => m.type() === 'error' && !/40[01]|503/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { context, page };
}
const OUT = process.env.SHOTS || '/tmp';
const text = (page) => page.textContent('#app');
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));
// Le Raccourci : « date ISO 8601 avec fuseau;valeur », une ligne par mesure, en JSON {mesures}.
const iso = (t) => {
  const d = new Date(t);
  const off = -d.getTimezoneOffset();
  const p = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
};
const post = (link, lines) => fetch(link, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mesures: lines.join('\n') }) });
// Le Raccourci sans boucle : colonnes « #dates X / #valeurs X / #sources X ».
const cols = (name, pts, src = 'Apple Watch de Rami') => [`#dates ${name}`, ...pts.map((p) => iso(p[0])), `#valeurs ${name}`, ...pts.map((p) => String(p[1]).replace('.', ',')), `#sources ${name}`, ...pts.map(() => src)];
// Une nage : `laps` longueurs de 25 m, une toutes les 75 s, pause de 2 min toutes les 8.
function swim(start, laps) {
  const nage = [];
  const mvt = [];
  let t = start;
  for (let i = 0; i < laps; i++) {
    nage.push([t, 25]);
    mvt.push([t, 19 + (i % 3)]);
    t += 75_000 + (i % 8 === 7 ? 120_000 : 0);
  }
  const fc = [];
  for (let s = start; s <= t; s += 5000) fc.push([s, 128 + Math.round(((s - start) / 1000) % 17)]);
  return { nage, mvt, fc, end: t };
}
const today = new Date().toLocaleDateString('sv-SE');
const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString('sv-SE');
const seed = {
  profile: { prenom: '', questionnaire: { sports: ['course', 'natation'], objectifCourse: '10km', joursCourse: [1, 5], objectifNatation: 1000, bassin: 25, joursNatation: [3], answeredAt: 1 } },
  settings: { son: 'musique', annonces: 'signaux' },
  history: [],
};

const checks = {};
try {
  const { page } = await device('rami');
  await page.goto(APP);
  await page.evaluate((s) => localStorage.setItem('foulee.v1', JSON.stringify(s)), seed);
  await page.goto(`${APP}/`);
  await page.click('[data-tab="profil"]');
  await page.click('[data-tab="compte"]');
  await page.waitForSelector('[data-register]');
  await page.fill('#acc-prenom', 'Rami');
  await page.click('[data-register]');
  await page.waitForSelector('[data-logout]', { timeout: 15000 });
  await page.click('[data-tab="profil"]');
  await page.click('[data-cardiolink]');
  await page.waitForSelector('#cardio-link');
  const link = await page.inputValue('#cardio-link');
  checks['étapes du Raccourci : nage et mouvements'] = (await text(page)).includes('Distance de nage') && (await text(page)).includes('Mouvements de nage');

  // 1. Ancien serveur ou Raccourci mal nommé : « Distance de nage » n'est jamais de la course.
  // 2. Nage d'aujourd'hui envoyée AVANT la saisie : la saisie arrive préremplie.
  const now = Date.now();
  const s1 = swim(now - 2 * 3600_000, 30);
  const msg = await (await post(link, [...s1.fc.map(([t, v]) => `${iso(t)};${v}`), ...cols('nage', s1.nage), ...cols('mouvements', s1.mvt), ...cols('kcal', s1.nage.map(([t]) => [t, 8]))])).text();
  checks['Raccourci : longueurs et mouvements reçus'] = msg.includes('30 de nage') && msg.includes('30 de mouvements de nage');
  await page.click('[data-tab="demarrer"]');
  await page.click('[data-manual="natation"]');
  await page.waitForSelector('.montre-box', { timeout: 8000 });
  const lg = Number(await page.inputValue('#longueurs'));
  const dur = Number(await page.inputValue('#duree'));
  const expMin = Math.round((s1.end - s1.nage[0][0]) / 60000);
  checks['saisie : 30 longueurs préremplies'] = lg === 30;
  checks['saisie : durée de la montre'] = Math.abs(dur - expMin) <= 2;
  const t1 = await text(page);
  checks['saisie : mouvements/longueur, kcal, cardio'] = /20mouvements \/ longueur/.test(t1) && t1.includes('240kcal actives') && t1.includes('bpm de moyenne');
  await page.screenshot({ path: `${OUT}/1-saisie-preremplie.png`, fullPage: true });
  // Correction à la main : elle prime, la montre est rappelée.
  await page.fill('#longueurs', '32');
  await page.dispatchEvent('#longueurs', 'change');
  await page.waitForTimeout(200);
  checks['saisie corrigée à la main : prioritaire'] = (await text(page)).includes('Tu as noté 32 longueurs');
  await page.click('[data-scale="difficulte"][data-v="3"]');
  await page.click('[data-savemanual]');
  await page.waitForSelector('text=Et maintenant');
  let h = (await stored(page)).history.find((x) => x.date === today);
  checks['enregistré : 32 longueurs, cardio, montre, plage'] = h?.swim?.longueurs === 32 && h.cardio?.avg >= 128 && h.montre?.nageM === 750 && h.fenetre?.length === 2;

  // 3. Nage d'hier saisie AVANT le Raccourci : rattachée au retour dans l'app.
  await page.click('[data-tab="demarrer"]');
  await page.click('[data-manual="natation"]');
  await page.waitForSelector('.hr-wait', { timeout: 8000 });
  await page.waitForTimeout(1500);
  checks['nage déjà rattachée : pas proposée une 2e fois'] = !(await page.$('.montre-box')) && !(await page.inputValue('#longueurs'));
  await page.fill('#date', yesterday);
  await page.dispatchEvent('#date', 'change');
  await page.waitForTimeout(1500);
  checks['sans mesures : bouton et explication'] = (await text(page)).includes('Pas encore de longueurs de ta montre');
  await page.screenshot({ path: `${OUT}/2-saisie-en-attente.png`, fullPage: true });
  await page.fill('#duree', '50');
  await page.click('[data-savemanual]');
  await page.waitForSelector('text=Et maintenant');
  const y = new Date(`${yesterday}T19:00:00`).getTime();
  const s2 = swim(y, 24);
  await post(link, [...s2.fc.map(([t, v]) => `${iso(t)};${v}`), ...cols('nage', s2.nage), ...cols('mouvements', s2.mvt)]);
  await page.click('[data-tab="progression"]');
  await page.waitForTimeout(21_000); // une recherche au plus toutes les 20 s
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction((d) => JSON.parse(localStorage.getItem('foulee.v1')).history.some((x) => x.date === d && x.montre), yesterday, { timeout: 8000 }).catch(() => {});
  h = (await stored(page)).history.find((x) => x.date === yesterday);
  checks['après coup : 24 longueurs, cardio ; durée tapée gardée'] = h?.swim?.longueurs === 24 && h.cardio?.n >= 10 && h.elapsedSec === 3000 && h.distanceKm === 0.6;
  await page.locator('details.hist').nth(1).evaluate((el) => { el.open = true; });
  await page.waitForTimeout(300);
  checks['historique : m nagés et mouvements'] = (await text(page)).includes('m nagés');
  await page.screenshot({ path: `${OUT}/3-historique.png`, fullPage: true });
} catch (e) {
  errors.push(`exception: ${e.message}`);
}

await browser.close();
server.close();
stopWrangler();
checks['aucune erreur'] = errors.length === 0;
console.log({ errors });
if (errors.length) console.log(wranglerLog.slice(-3000));
for (const [k, v] of Object.entries(checks)) console.log(v ? 'ok  ' : 'FAIL', k);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
