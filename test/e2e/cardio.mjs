// Cardio de la montre de bout en bout : serveur local (wrangler dev + D1 local), app servie en local.
// passkeys simulées par l'authentificateur virtuel de Chromium.
// Lien d'import, envoi par le « Raccourci » (simulé), rattachement à la séance, affichage, conseils.
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
const shortcut = (link, from, to, bpm) => {
  const lines = [];
  for (let t = from, i = 0; t <= to; t += 250, i++) lines.push(`${iso(t)};${bpm(i)}`);
  return fetch(link, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mesures: lines.join('\n') }) });
};
// Séance de test de 4 min, jouée quelques secondes puis amenée à la fin.
async function guidedRun(page) {
  await page.click('[data-tab="programme"]');
  await page.waitForTimeout(800);
  const start = Date.now();
  await page.click('[data-start="test-4"]');
  await page.waitForSelector('#count');
  await page.waitForTimeout(1500);
  await page.click('[data-skip]'); // fin du compte à rebours : étape 1
  await page.waitForTimeout(6000);
  await page.evaluate(() => { const a = document.getElementById('player'); a.currentTime = a.duration - 0.6; });
  await page.waitForSelector('[data-savebilan]', { timeout: 10000 });
  return { start, end: Date.now() };
}

// Deux courses déjà faites au palier 2, cardio mesuré : la tendance de Progression.
const day = (n) => new Date(Date.now() - n * 86400_000).toLocaleDateString('sv-SE');
const pastHr = (avg, course) => ({ avg, max: course + 14, min: 92, course, marche: avg - 12, n: 480, t0: 0, pas: 30, pts: Array.from({ length: 80 }, (_, i) => (i % 10 < 6 ? course : avg - 12)), source: 'montre' });
const seed = {
  profile: { prenom: '', questionnaire: { sports: ['course'], objectifCourse: '10km', joursCourse: [1, 5], answeredAt: 1 } },
  settings: { son: 'musique', annonces: 'signaux' },
  history: [
    { id: 'p1', sport: 'course', source: 'guidee', date: `${day(6)}T18:00:00`, level: 2, elapsedSec: 2400, difficulte: 3, cardio: pastHr(146, 158) },
    { id: 'p2', sport: 'course', source: 'guidee', date: `${day(3)}T18:00:00`, level: 2, elapsedSec: 2400, difficulte: 3, cardio: pastHr(142, 153) },
  ],
};

const checks = {};
try {
  const { context, page } = await device('rami');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  await page.goto(APP);
  await page.evaluate((s) => localStorage.setItem('foulee.v1', JSON.stringify(s)), seed);
  await page.goto(`${APP}/`);
  await page.click('[data-tab="profil"]');
  checks['sans compte : pas d’import, on le dit'] = (await text(page)).includes('Connecte-toi à ton compte pour ajouter à tes courses le cardio');
  await page.click('[data-tab="compte"]');
  await page.waitForSelector('[data-register]');
  await page.fill('#acc-prenom', 'Rami');
  await page.click('[data-register]');
  await page.waitForSelector('[data-logout]', { timeout: 15000 });

  // 1. Activer l'import : un lien, montré une fois, et les étapes du Raccourci.
  await page.click('[data-tab="profil"]');
  await page.waitForSelector('[data-cardiolink]');
  await page.screenshot({ path: `${OUT}/1-profil-activer.png`, fullPage: true });
  await page.click('[data-cardiolink]');
  await page.waitForSelector('#cardio-link');
  const link = await page.inputValue('#cardio-link');
  await page.click('[data-cardiocopy]');
  await page.waitForTimeout(300);
  checks['lien copié'] = (await page.evaluate(() => navigator.clipboard.readText())) === link && (await text(page)).includes('Lien copié');
  await page.locator('.cardio-card').screenshot({ path: `${OUT}/2-profil-lien-et-raccourci.png` });
  checks['lien d’import du compte'] = /\/cardio\?k=fc_/.test(link);
  const ramiToken = await page.evaluate(() => localStorage.getItem('foulee.token'));
  checks['le lien ne lit rien du compte'] = (await fetch(`${API}/me/data`, { headers: { Authorization: `Bearer ${link.split('k=')[1]}` } })).status === 401;

  // 2. Course guidée, bilan enregistré sans cardio ; le Raccourci envoie plus tard ;
  //    au retour dans l'app, le cardio s'ajoute à la séance.
  const run1 = await guidedRun(page);
  await page.click('[data-scale="difficulte"][data-v="3"]');
  checks['bilan : invite à lancer le Raccourci, aucun chiffre inventé'] = (await text(page)).includes('Foulée cardio') && !(await page.$('.hr-box'));
  await page.click('[data-savebilan]');
  await page.waitForSelector('text=Et maintenant');
  // Mesures de la journée : repos avant, la séance (course 150-160), repos après.
  let res = await shortcut(link, run1.start - 600_000, run1.start - 300_000, () => 72);
  res = await shortcut(link, run1.start, run1.end, (i) => 120 + (i % 20));
  const msg = await res.text();
  checks['Raccourci : message clair'] = res.ok && /Foulée : \d+ mesures de cardio reçues/.test(msg);
  const again = await (await shortcut(link, run1.start, run1.end, (i) => 120 + (i % 20))).text();
  checks['Raccourci relancé : pas de doublon'] = again.includes('déjà reçues avant');
  await page.click('[data-tab="progression"]');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('foulee.v1')).history.some((h) => h.sessionName && h.cardio), null, { timeout: 8000 }).catch(() => {});
  const h1 = (await stored(page)).history.find((h) => h.sessionName);
  checks['cardio ajouté à la séance après coup'] = Boolean(h1?.cardio?.avg >= 120 && h1.cardio.max <= 139 && h1.cardio.n >= 10);
  checks['repos hors séance ignoré'] = h1?.cardio?.min >= 120;
  checks['heure réelle des étapes notée'] = h1?.stepMs?.length === h1?.steps?.length + 1;

  // 3. Deuxième course : le Raccourci est lancé avant le bilan, le bouton va chercher le cardio.
  const run2 = await guidedRun(page);
  await shortcut(link, run2.start, run2.end, (i) => (i % 8 < 5 ? 156 : 131));
  await page.click('[data-cardiofetch]');
  await page.waitForSelector('.hr-box', { timeout: 8000 });
  const b = await text(page);
  checks['bilan : cardio affiché'] = /bpm de moyenne/.test(b) && b.includes('max');
  await page.screenshot({ path: `${OUT}/3-bilan-cardio.png`, fullPage: true });
  await page.click('[data-scale="difficulte"][data-v="2"]');
  await page.click('[data-savebilan]');
  await page.waitForSelector('text=Et maintenant');
  const h2 = (await stored(page)).history.filter((h) => h.sessionName).sort((x, y) => String(x.date).localeCompare(String(y.date))).at(-1);
  checks['cardio enregistré avec le bilan'] = h2?.cardio?.max === 156;

  // 4. Historique et Progression.
  await page.click('[data-tab="progression"]');
  await page.waitForSelector('.hr-trend');
  checks['Progression : tendance du cardio en course'] = (await text(page)).includes('Cardio en course') && (await page.locator('.hr-col').count()) === 4;
  await page.locator('details.hist').first().evaluate((el) => { el.open = true; });
  await page.waitForTimeout(300);
  checks['historique : ♥ bpm et courbe'] = (await text(page)).includes('♥') && (await page.locator('details.hist[open] .hr-box').count()) >= 1;
  await page.screenshot({ path: `${OUT}/4-progression.png`, fullPage: true });

  // 5. Sécurité du lien.
  const bad = await fetch(`${API}/cardio?k=fc_faux`, { method: 'POST', body: 'x' });
  checks['faux lien refusé'] = bad.status === 401 && (await bad.text()).includes('lien d’import inconnu');
  const fmt = await fetch(link, { method: 'POST', body: JSON.stringify({ mesures: '2026-11-02;92\n2026-11-02;95' }) });
  checks['Raccourci mal réglé : explication'] = fmt.status === 400 && (await fmt.text()).includes('Inclure l’heure');
  checks['mesures privées : jeton de session exigé'] = (await fetch(`${API}/me/cardio?from=0&to=1`)).status === 401;
  await page.click('[data-tab="profil"]');
  await page.click('[data-cardiolink]');
  await page.waitForSelector('#cardio-link');
  const link2 = await page.inputValue('#cardio-link');
  checks['nouveau lien : l’ancien ne marche plus'] = link2 !== link && (await shortcut(link, run2.start, run2.start + 3000, () => 100)).status === 401;
  checks['jeton de session intact'] = (await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${ramiToken}` } })).ok;
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
