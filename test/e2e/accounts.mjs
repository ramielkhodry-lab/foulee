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
  // Nouveau compte sans questionnaire : il s'ouvre ; « Plus tard » laisse la bannière.
  await rami.page.waitForSelector('[data-qsave]', { timeout: 15000 });
  await rami.page.click('text=Plus tard');
  checks['bannière tant que le questionnaire n’est pas rempli'] = Boolean(await rami.page.$('.q-banner'));
  await rami.page.click('[data-tab="profil"]');
  await rami.page.click('[data-tab="compte"]');
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
  await femme.page.waitForSelector('[data-qsave]', { timeout: 15000 });
  checks['questionnaire proposé à la création du compte'] = (await text(femme.page)).includes('Ce que tu pratiques');
  checks['le questionnaire de la femme est vierge'] = !(await femme.page.$('.q-sports button.on'));
  // Course seulement, objectif 5 km, 5 min sans s'arrêter, mardi + jeudi + samedi.
  await femme.page.click('[data-qsport="course"]');
  await femme.page.check('input[name="q-objc"][value="5km"]');
  await femme.page.check('input[name="q-nivc"][value="4"]');
  for (const n of [1, 5]) await femme.page.click(`[data-qday="joursCourse"][data-v="${n}"]`);
  for (const n of [2, 4, 6]) await femme.page.click(`[data-qday="joursCourse"][data-v="${n}"]`);
  await femme.page.screenshot({ path: '/tmp/foulee-questionnaire.png', fullPage: true });
  await femme.page.click('[data-qsave]');
  await femme.page.waitForSelector('.level-num');
  const prog = await text(femme.page);
  checks['programme de la femme : palier 4/14, pas de natation'] = (await femme.page.textContent('.level-num')).replace(/\s/g, '') === '4/14' && !/natation/i.test(prog);
  await femme.page.screenshot({ path: '/tmp/foulee-programme-femme.png', fullPage: true });
  await femme.page.waitForTimeout(2600); // envoi différé au serveur
  const femmeToken = await token(femme.page);
  const fq = (await (await call('/me/data', femmeToken)).json()).data?.profile?.questionnaire;
  checks['questionnaire enregistré sur son compte'] = fq?.objectifCourse === '5km' && fq.sports.join() === 'course' && fq.joursCourse.join() === '2,4,6';

  // 4. Isolation : chacun ne lit que ses données.
  const femmeData = await (await call('/me/data', femmeToken)).json();
  checks['la femme ne voit pas les séances de Rami'] = !JSON.stringify(femmeData).includes('r1') && !JSON.stringify(femmeData).includes('mollet');
  const meF = await (await call('/me', femmeToken)).json();
  checks['identité séparée'] = meF.prenom === 'Sarah' && meF.id !== (await (await call('/me', ramiToken)).json()).id;
  checks['sans jeton : refusé'] = (await call('/me/data', null)).status === 401;
  checks['faux jeton : refusé'] = (await call('/me/data', 'abc')).status === 401;
  const ramiQ = (await (await call('/me/data', ramiToken)).json()).data?.profile?.questionnaire;
  checks['le questionnaire de la femme ne touche pas Rami'] = !ramiQ;
  await call('/me/data', femmeToken, { method: 'PUT', body: JSON.stringify({ data: { ...(await (await call('/me/data', femmeToken)).json()).data, history: [{ id: 'f1', sport: 'course', date: '2026-10-27', douleur: 'genou' }] } }) });
  const ramiAfter = await (await call('/me/data', ramiToken)).json();
  checks['écrire chez soi ne touche pas l’autre compte'] = ramiAfter.data.history.some((h) => h.id === 'r1') && !ramiAfter.data.history.some((h) => h.id === 'f1');

  // 5. Invitation à usage unique.
  const code = link.split('invite=')[1];
  const reuse = await (await call('/auth/register/options', null, { method: 'POST', body: JSON.stringify({ prenom: 'X', invite: code }) })).json();
  checks['invitation réutilisée refusée'] = Boolean(reuse.error);

  // 5 bis. Téléphone partagé : la femme se déconnecte, le frère crée son compte sur ce même
  // téléphone. Rien de la femme ne doit partir sur le compte du frère.
  await rami.page.click('[data-invite="join"]');
  await rami.page.waitForTimeout(800);
  const link2 = (await rami.page.textContent('#invite-link')).trim();
  await femme.page.reload();
  await femme.page.waitForTimeout(800);
  await femme.page.click('[data-tab="profil"]');
  await femme.page.click('[data-tab="compte"]');
  const femmeKept = (await (await call('/me/data', femmeToken)).json()).data;
  checks['téléphone partagé : les données de la femme restent sur son compte'] = femmeKept.history.some((h) => h.id === 'f1') && femmeKept.profile.questionnaire.objectifCourse === '5km';
  await femme.page.click('[data-logout]');
  await femme.page.waitForSelector('[data-login]');
  await femme.page.goto(link2);
  await femme.page.waitForSelector('#acc-prenom');
  await femme.page.waitForTimeout(500);
  checks['téléphone partagé : prévenu que le compte démarre vide'] = (await text(femme.page)).includes('ton compte démarre vide');
  await femme.page.fill('#acc-prenom', 'Karim');
  await femme.page.click('[data-register]');
  await femme.page.waitForSelector('[data-qsave]', { timeout: 15000 });
  checks['téléphone partagé : questionnaire vierge pour le frère'] = !(await femme.page.$('.q-sports button.on'));
  await femme.page.waitForTimeout(2600);
  const frereToken = await token(femme.page);
  const frereData = JSON.stringify((await (await call('/me/data', frereToken)).json()).data);
  checks['téléphone partagé : rien de la femme chez le frère'] = !frereData.includes('f1') && !frereData.includes('genou') && !frereData.includes('5km');

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
