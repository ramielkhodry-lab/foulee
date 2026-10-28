// Conseils de l'IA dans l'app, serveur simulé : réussite, puis quota épuisé (alerte + reprise),
// puis nouvel essai réussi depuis l'alerte de l'accueil.
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
const fixture = JSON.parse(await readFile(new URL('../fixtures/historique.json', import.meta.url)));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Europe/Paris', locale: 'fr-FR' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let mode = 'ok';
const asked = [];
await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const API_URL = 'https://api.test';" }));
await page.route('https://api.test/**', async (r) => {
  const url = new URL(r.request().url());
  const reply = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  if (url.pathname === '/me/conseils') {
    asked.push(JSON.parse(r.request().postData()));
    if (mode === 'quota') return reply({ error: 'Quota gratuit de l’IA épuisé pour aujourd’hui', code: 'quota', resetAt: Date.UTC(2026, 9, 29) }, 429);
    return reply({ model: 'llama-3.3-70b-instruct-fp8-fast', v: 2, at: Date.now(), conseils: [
      'Tu bois la tasse parce que tu inspires trop tôt : souffle longuement par le nez sous l’eau, et ne tourne la tête qu’une fois les poumons vides.',
      'Fais tes 4 longueurs de respiration en crawl très lent, en respirant tous les 2 bras, toujours du même côté pour commencer.',
      '« Bonne fatigue » à 4/5 : garde le même volume mercredi et prends 20 s au bord dès que le rythme se casse.',
    ] });
  }
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  if (url.pathname === '/status') return reply({ ok: true, firstAccount: false });
  if (url.pathname === '/me/invites') return reply({ invites: [] });
  if (url.pathname === '/me/data') return reply(r.request().method() === 'GET' ? { data: null } : { updatedAt: Date.now() });
  return reply({ error: 'Introuvable' }, 404);
});
await page.addInitScript((data) => {
  if (localStorage.getItem('foulee.v1')) return;
  localStorage.setItem('foulee.token', 'jeton');
  localStorage.setItem('foulee.user', JSON.stringify({ id: 'rami', prenom: 'Rami' }));
  localStorage.setItem('foulee.v1', JSON.stringify({ ...data, owner: 'rami', profile: { prenom: 'Rami' } }));
}, fixture);
await page.goto(base);
await page.waitForTimeout(500);

async function noteSwim() {
  await page.click('[data-tab="progression"]');
  await page.click('[data-manual="natation"]');
  await page.fill('#duree', '60');
  await page.fill('#longueurs', '30');
  await page.click('[data-scale="difficulte"][data-v="4"]');
  await page.click('[data-scale="essoufflement"][data-v="4"]');
  await page.click('[data-scale="fatigue"][data-v="4"]');
  await page.fill('#comm', "Très fatigué mais bonne fatigue ça va. J'apprends petit à petit à prendre le rythme de la brasse et du crawl et de comment respirer. Car quand j'inspire j'avale de l'eau et ça me coupe le rythme");
  await page.click('[data-savemanual]');
  await page.waitForTimeout(400);
}

// 1. Quota épuisé : conseils de secours + heure de reprise, alerte à l'accueil.
mode = 'quota';
await noteSwim();
const suiteQuota = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-ia-quota.png', fullPage: true });
await page.click('[data-tab="accueil"]');
const accueilQuota = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-ia-alerte-accueil.png' });

// 2. Le quota revient : « Réessayer maintenant » → conseils de l'IA, alerte disparue.
mode = 'ok';
await page.click('[data-retryia]');
await page.waitForTimeout(500);
const accueilOk = await page.textContent('#app');
await page.click('[data-pickday="2026-11-04"]');
const carte = await page.textContent('#app');
await page.locator('.day-card').screenshot({ path: '/tmp/foulee-ia-carte.png' });
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history.find((h) => h.commentaire?.includes('avale')));

// 3. Bilan suivant, IA disponible : conseils de l'IA directement.
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('foulee.v1')); d.history = d.history.filter((h) => !h.commentaire?.includes('avale')); localStorage.setItem('foulee.v1', JSON.stringify(d)); });
await page.reload();
await page.waitForTimeout(400);
await noteSwim();
await page.waitForTimeout(400);
const suiteOk = await page.textContent('#app');
await page.screenshot({ path: '/tmp/foulee-ia-suite.png', fullPage: true });

// Jour du bilan : conseils du coach derrière un bouton.
await page.click('[data-tab="accueil"]');
await page.click(`[data-pickday="${new Date().toLocaleDateString('sv-SE')}"]`);
await page.click('details.hist[open] .coach summary');
const jourBilan = await page.textContent('#app');
await page.locator('details.hist[open]').first().screenshot({ path: '/tmp/foulee-coach-jour.png' });
// Carte d'une séance future : le détail se déplie sur place.
await page.click('[data-pickday="2026-11-04"]');
await page.click('.day-detail summary');
const detail = await page.textContent('.day-card');
await page.locator('.day-card').screenshot({ path: '/tmp/foulee-detail-longueurs.png' });
// Programme : chaque séance se déplie.
await page.click('[data-tab="programme"]');
await page.click('.timeline details.plan-row:has(.ico.natation) summary');
const progDetail = await page.textContent('.timeline');
// Questionnaire : une partie par sport.
await page.click('[data-questionnaire]');
await page.click('[data-qsport="muscu"]');
const parts = await page.locator('.q-part').count();
await page.screenshot({ path: '/tmp/foulee-questionnaire-parties.png', fullPage: true });

const checks = {
  'jour du bilan : conseils du coach': jourBilan.includes('Conseils du coach suite à ta séance') && jourBilan.includes('Écrits par l’IA'),
  'carte du 4/11 : détail longueur par longueur sur place': detail.includes('Échauffement : 4 longueurs') && detail.includes('Respiration'),
  'programme : détail d’une natation': progDetail.includes('Échauffement : 4 longueurs'),
  'questionnaire : 3 parties': parts === 3,
  'quota : conseils de secours affichés': suiteQuota.includes('Conseils de secours') && suiteQuota.includes('avales de l’eau'),
  'quota : heure de reprise': /reprend (cette nuit|aujourd'hui|demain) à \d\d:\d\d/.test(suiteQuota),
  'alerte à l’accueil': accueilQuota.includes('IA indisponible') && accueilQuota.includes('Réessayer maintenant'),
  'ressenti envoyé à l’IA': asked.some((a) => a.bilan.ressenti.includes("j'avale de l'eau") && a.suite.includes('30 longueurs')),
  'réessai : alerte disparue': !accueilOk.includes('IA indisponible'),
  'carte du 4/11 : conseils de l’IA': carte.includes('Conseils de l’IA sur ton dernier bilan') && carte.includes('inspires trop tôt'),
  'conseils IA gardés sur la séance': stored?.conseilsIA?.conseils.length === 3 && !stored.iaEchec,
  'IA disponible : conseils de l’IA après le bilan': suiteOk.includes('Conseils de l’IA, à partir de ton ressenti') && suiteOk.includes('inspires trop tôt'),
  'aucune erreur': errors.length === 0,
};
let failed = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`); if (!v) failed++; }
if (errors.length) console.log(errors);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
