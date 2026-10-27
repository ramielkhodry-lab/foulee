// Comptes de bout en bout : serveur local (wrangler dev + D1 local), app servie en local,
// passkeys simulées par l'authentificateur virtuel de Chromium.
// Vérifie l'inscription, l'invitation, la connexion et surtout l'isolation entre comptes.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
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
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'foulee', '--local'], { cwd: workerDir, stdio: 'ignore' });
const wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(API_PORT), '--var', `APP_ORIGIN:${APP}`, '--var', 'RP_ID:localhost', '--var', 'APP_PATH:/'], { cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

const browser = await chromium.launch();
const errors = [];

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { context, page };
}
const token = (page) => page.evaluate(() => localStorage.getItem('foulee.token'));
const call = (path, tok, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
const text = (page) => page.textContent('#app');

const checks = {};
try {
  // 1. Rami crée le premier compte, avec une séance déjà sur son téléphone.
  const rami = await device('rami');
  await rami.page.goto(APP);
  await rami.page.evaluate(() => localStorage.setItem('foulee.v1', JSON.stringify({ profile: { prenom: '' }, history: [{ id: 'r1', sport: 'course', date: '2026-10-26', elapsedSec: 2447, distanceKm: 4.44, douleur: 'mollet', commentaire: 'privé' }] })));
  await rami.page.goto(`${APP}/`);
  await rami.page.click('[data-tab="profil"]');
  await rami.page.click('[data-tab="compte"]');
  await rami.page.waitForSelector('[data-register]');
  checks['premier compte proposé sans invitation'] = (await text(rami.page)).includes('Premier compte');
  await rami.page.fill('#acc-prenom', 'Rami');
  await rami.page.click('[data-register]');
  await rami.page.waitForSelector('[data-logout]', { timeout: 15000 });
  const ramiToken = await token(rami.page);
  await rami.page.waitForTimeout(500);
  const ramiData = await (await call('/me/data', ramiToken)).json();
  checks['séance de Rami synchronisée'] = ramiData.data?.history?.some((h) => h.id === 'r1');

  // 2. Un deuxième « premier compte » est refusé.
  const intrus = await (await call('/auth/register/options', null, { method: 'POST', body: JSON.stringify({ prenom: 'Intrus' }) })).json();
  checks['inscription sans invitation refusée'] = intrus.error === 'Invitation invalide ou déjà utilisée';

  // 3. Rami invite sa femme ; elle crée son compte depuis le lien, sur un autre téléphone.
  await rami.page.click('[data-invite="join"]');
  await rami.page.waitForSelector('[data-share]');
  const link = (await rami.page.textContent('#invite-link')).trim();
  const femme = await device('femme');
  await femme.page.goto(link);
  await femme.page.waitForSelector('#acc-prenom');
  await femme.page.waitForTimeout(500);
  checks['invitation reconnue'] = (await text(femme.page)).includes("Rami t'invite");
  await femme.page.fill('#acc-prenom', 'Sarah');
  await femme.page.click('[data-register]');
  await femme.page.waitForSelector('[data-logout]', { timeout: 15000 });
  const femmeToken = await token(femme.page);

  // 4. Isolation : chacun ne lit que ses données.
  const femmeData = await (await call('/me/data', femmeToken)).json();
  checks['la femme ne voit pas les séances de Rami'] = !JSON.stringify(femmeData).includes('r1') && !JSON.stringify(femmeData).includes('mollet');
  const meF = await (await call('/me', femmeToken)).json();
  checks['identité séparée'] = meF.prenom === 'Sarah' && meF.id !== (await (await call('/me', ramiToken)).json()).id;
  checks['sans jeton : refusé'] = (await call('/me/data', null)).status === 401;
  checks['faux jeton : refusé'] = (await call('/me/data', 'abc')).status === 401;
  await call('/me/data', femmeToken, { method: 'PUT', body: JSON.stringify({ data: { history: [{ id: 'f1' }] } }) });
  const ramiAfter = await (await call('/me/data', ramiToken)).json();
  checks['écrire chez soi ne touche pas l’autre compte'] = ramiAfter.data.history.some((h) => h.id === 'r1') && !ramiAfter.data.history.some((h) => h.id === 'f1');

  // 5. Invitation à usage unique.
  const code = link.split('invite=')[1];
  const reuse = await (await call('/auth/register/options', null, { method: 'POST', body: JSON.stringify({ prenom: 'X', invite: code }) })).json();
  checks['invitation réutilisée refusée'] = Boolean(reuse.error);

  // 6. Rami se déconnecte puis se reconnecte avec sa passkey ; ses données reviennent.
  await rami.page.click('[data-logout]');
  await rami.page.waitForSelector('[data-login]');
  await rami.page.evaluate(() => localStorage.removeItem('foulee.v1'));
  await rami.page.click('[data-login]');
  await rami.page.waitForSelector('[data-logout]', { timeout: 15000 });
  await rami.page.waitForTimeout(500);
  const local = await rami.page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')));
  checks['reconnexion par passkey + données récupérées'] = local.history.some((h) => h.id === 'r1') && local.profile.prenom === 'Rami';
  checks['ancien jeton invalidé à la déconnexion'] = (await call('/me', ramiToken)).status === 401;
  await rami.page.screenshot({ path: '/tmp/foulee-compte.png', fullPage: true });
  await femme.page.screenshot({ path: '/tmp/foulee-compte-femme.png', fullPage: true });
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
