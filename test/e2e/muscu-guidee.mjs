// Musculation guidée : démarrer, série faite → récup 60 s → signal, ±15 s, passer, terminer → bilan
// prérempli (séries et durée mesurée). Captures iPhone et Android.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp';
const root = new URL('../../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'natation', 'muscu'], objectifCourse: '10km', joursCourse: [1, 5], joursNatation: [3], joursMuscu: [2, 6], bassin: 25, objectifNatation: 1000, lieu: 'corps', objectifMuscu: 'tonus', niveauMuscu: 'reprise' } },
  sessions: [], history: [], settings: { son: 'musique', annonces: 'signaux' },
};
const devices = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' },
};
const errors = [];
const browser = await chromium.launch();
for (const [name, dev] of Object.entries(devices)) {
  const page = await browser.newPage(dev);
  await page.clock.install({ time: new Date('2026-11-03T12:30:00') });
  page.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('[data-muscugo]');
  await page.clock.runFor(1500);
  await page.screenshot({ path: `${out}/${name}-1-accueil.png` });
  await page.click('.hero [data-muscugo], .day-card [data-muscugo]');
  await page.waitForSelector('.mlive[data-phase="work"]');
  await page.click('[data-mreps="-1"]');
  await page.click('[data-mreps="-1"]');
  if (await page.textContent('#mreps') !== '13') errors.push(`${name} : stepper ${await page.textContent('#mreps')}`);
  await page.screenshot({ path: `${out}/${name}-2-serie.png` });
  await page.click('[data-msetdone]');
  await page.waitForSelector('.mlive[data-phase="rest"]');
  await page.clock.runFor(18000);
  await page.screenshot({ path: `${out}/${name}-3-recup.png` });
  await page.click('[data-mrest="15"]');
  const r = await page.textContent('#mrest');
  if (r !== '0:57') errors.push(`${name} : récup après +15 s = ${r}`);
  await page.clock.runFor(57500);
  await page.waitForSelector('.mlive[data-phase="work"]');
  if (!(await page.evaluate(() => document.body.classList.contains('flash-muscu')))) errors.push(`${name} : pas de flash`);
  await page.clock.runFor(2000);
  await page.screenshot({ path: `${out}/${name}-4-serie2.png` });
  if (!/série 2\/2/i.test(await page.textContent('.mstep'))) errors.push(`${name} : ${await page.textContent('.mstep')}`);
  await page.click('[data-msetdone]');
  await page.click('[data-mrestskip]');
  await page.waitForSelector('.mlive[data-phase="work"]');
  // Reprise après fermeture de l'app
  await page.reload();
  await page.waitForSelector('[data-muscugo]');
  if (!/Reprendre/.test(await page.textContent('[data-muscugo]'))) errors.push(`${name} : pas de reprise`);
  await page.click('.hero [data-muscugo], .day-card [data-muscugo]');
  await page.waitForSelector('.mlive');
  if (!/Exercice 2\/6/.test(await page.textContent('.mstep'))) errors.push(`${name} : reprise ${await page.textContent('.mstep')}`);
  await page.clock.runFor(30 * 60 * 1000);
  await page.click('[data-mfinish]');
  await page.waitForSelector('[data-savemanual]');
  await page.screenshot({ path: `${out}/${name}-5-bilan.png`, fullPage: true });
  const duree = await page.inputValue('#duree');
  const r00 = await page.inputValue('#rep-0-0');
  const r01 = await page.inputValue('#rep-0-1');
  if (r00 !== '13' || r01 !== '13') errors.push(`${name} : séries ${r00}/${r01}`);
  if (Number(duree) !== 31) errors.push(`${name} : durée ${duree}`);
  await page.click('[data-scale="difficulte"][data-v="3"]');
  await page.click('[data-savemanual]');
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history.at(-1));
  if (h?.source !== 'guidee' || h.exercices.length !== 1 || h.exercices[0].reps.join() !== '13,13') errors.push(`${name} : historique ${JSON.stringify(h?.exercices)}`);
  if (await page.evaluate(() => localStorage.getItem('foulee.muscu'))) errors.push(`${name} : séance guidée pas effacée`);
  if (!h.date.startsWith('2026-11-03T12:30:') || !h.endedAt.startsWith('2026-11-03T13:01:')) errors.push(`${name} : horaires ${h.date} → ${h.endedAt}`);
  await page.click('[data-tab="progression"]');
  await page.waitForSelector('.prog.muscu');
  const prog = await page.textContent('.prog.muscu .hero-num');
  if (prog !== '26rép.') errors.push(`${name} : progression ${prog}`);
  if (!/13rép\.Squat/.test(await page.textContent('.records'))) errors.push(`${name} : records ${await page.textContent('.records')}`);
  await page.screenshot({ path: `${out}/${name}-6-progression.png` });
  // Séance guidée enregistrée sans heure (version du 3/11 midi) : l'heure est retrouvée.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('foulee.v1'));
    d.history.push({ id: 'old', sport: 'muscu', source: 'guidee', date: '2026-11-02', horaires: '13:12 → 13:31', exercices: [] });
    localStorage.setItem('foulee.v1', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForTimeout(500);
  const old = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history.find((x) => x.id === 'old'));
  if (old.date !== '2026-11-02T13:12:00' || old.endedAt !== '2026-11-02T13:31:00') errors.push(`${name} : migration ${old.date} ${old.endedAt}`);
  await page.close();
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('OK');
