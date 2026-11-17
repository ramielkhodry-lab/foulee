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

// Matériel en plus : cocher haltères + élastiques sur « Avant de commencer », choisir
// un exercice chargé (case kg) ou à l'élastique (pas de kg), au poids du corps sinon.
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['muscu'], joursMuscu: [2, 6], lieu: 'corps', objectifMuscu: 'tonus', niveauMuscu: 'reprise' } },
  sessions: [], settings: { son: 'musique', annonces: 'signaux' },
  history: [{ id: 'm1', sport: 'muscu', date: '2026-11-14', seance: 'A', exercices: [{ slot: 0, id: 'squat-corps', reps: [14, 14] }] }],
};
const devices = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};
const errors = [];
const browser = await chromium.launch();
for (const [name, dev] of Object.entries(devices)) {
  const page = await browser.newPage(dev);
  await page.clock.install({ time: new Date('2026-11-17T11:00:00') });
  page.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('[data-muscugo]');
  await page.clock.runFor(1500);
  await page.click('.hero [data-muscugo], .day-card [data-muscugo]');
  await page.waitForSelector('.mprep-list');
  const opts = async (sel) => page.$$eval(`${sel} option`, (o) => o.map((x) => x.value));
  if (await page.$('[data-mpswap="B:4"]')) errors.push(`${name} : menu biceps sans matériel`);
  await page.click('[data-mmat="halteres"]');
  await page.click('[data-mmat="elastique"]');
  await page.waitForTimeout(100);
  const bic = await opts('[data-mpswap="B:4"]');
  for (const id of ['curl-serviette', 'curl-h', 'curl-marteau', 'curl-elastique']) if (!bic.includes(id)) errors.push(`${name} : ${id} absent (${bic})`);
  if (!/Curl isom/.test(await page.textContent('.mprep-list'))) errors.push(`${name} : défaut changé`);
  await page.selectOption('[data-mpswap="B:4"]', 'curl-marteau');
  await page.selectOption('[data-mpswap="B:0"]', 'sdt-jt-h');
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${name}-1-avant.png`, fullPage: true });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).settings);
  if (st.materiel?.join() !== 'halteres,elastique' || st.muscuChoix['B:4'] !== 'curl-marteau') errors.push(`${name} : réglages ${JSON.stringify(st)}`);
  await page.waitForSelector('[data-mstart]:not([disabled])');
  await page.click('[data-mstart]');
  await page.clock.runFor(3500);
  await page.waitForSelector('.mlive[data-phase="work"]');
  await page.clock.runFor(1600);
  if (!(await page.$('#mkg'))) errors.push(`${name} : pas de case kg sur haltères`);
  await page.fill('#mkg', '6');
  await page.screenshot({ path: `${out}/${name}-2-serie-halteres.png` });
  // Pendant la séance : passer au poids du corps fait disparaître la case kg.
  await page.selectOption('[data-mswap]', 'pont-fessier');
  await page.waitForTimeout(100);
  if (await page.$('#mkg')) errors.push(`${name} : case kg au poids du corps`);
  await page.selectOption('[data-mswap]', 'sdt-elastique');
  await page.waitForTimeout(100);
  if (await page.$('#mkg')) errors.push(`${name} : case kg sur élastique`);
  await page.screenshot({ path: `${out}/${name}-3-serie-elastique.png` });
  await page.close();
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('OK');
