// Sans banc : changer un exercice depuis l'aperçu d'une séance à venir. Captures iPhone et Android.
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


// Haltères sans banc : depuis l'aperçu de la séance de demain (Accueil puis Programme), remplacer
// le développé couché haltères par le développé au sol ; le choix est repris au lancement.
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['muscu'], joursMuscu: [2, 6], lieu: 'halteres', objectifMuscu: 'muscle', niveauMuscu: 'reprise' } },
  sessions: [], settings: { son: 'musique', annonces: 'signaux' },
  history: [{ id: 'm1', sport: 'muscu', date: '2026-11-21', seance: 'B', exercices: [{ slot: 0, id: 'sdt-jt-h', poids: 8, reps: [10, 10] }] }],
};
const devices = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' },
};
const errors = [];
const browser = await chromium.launch();
for (const [name, dev] of Object.entries(devices)) {
  const page = await browser.newPage(dev);
  await page.clock.install({ time: new Date('2026-11-23T18:00:00') });
  page.on('pageerror', (e) => errors.push(`${name} : ${e.message}`));
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('[data-pickday="2026-11-24"]');
  await page.click('[data-pickday="2026-11-24"]');
  await page.click('.day-detail.muscu summary');
  const sel = '.day-detail [data-pvswap="A:1"]';
  await page.waitForSelector(sel);
  const ids = await page.$$eval(`${sel} option`, (o) => o.map((x) => x.value));
  for (const id of ['dev-couche-h', 'pompes', 'dev-sol-h']) if (!ids.includes(id)) errors.push(`${name} : ${id} absent (${ids})`);
  if (!/il faut un banc/.test(await page.textContent('.day-detail.muscu'))) errors.push(`${name} : « il faut un banc » absent`);
  await page.selectOption(sel, 'dev-sol-h');
  await page.waitForTimeout(100);
  if (!(await page.$eval('.day-detail.muscu', (d) => d.open))) errors.push(`${name} : détail refermé après le choix`);
  if (!/Développé au sol/.test(await page.textContent('.day-detail.muscu .exos'))) errors.push(`${name} : aperçu non mis à jour`);
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${out}/${name}-1-apercu-demain.png` });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).settings);
  if (st.muscuChoix?.['A:1'] !== 'dev-sol-h') errors.push(`${name} : réglage ${JSON.stringify(st)}`);
  // Programme : même menu, même choix.
  await page.click('#tabs [data-tab="programme"]');
  await page.waitForTimeout(200);
  const progSel = await page.$$('[data-pvswap="A:1"]');
  if (!progSel.length) errors.push(`${name} : pas de menu dans Programme`);
  else if ((await progSel[0].inputValue()) !== 'dev-sol-h') errors.push(`${name} : Programme ne reprend pas le choix`);
  else {
    await page.$eval('[data-pvswap="A:1"]', (el) => { el.closest('details').open = true; el.scrollIntoView({ block: 'center' }); });
    await page.screenshot({ path: `${out}/${name}-2-programme.png` });
  }
  // Le lendemain, « Avant de commencer » reprend le choix.
  await page.clock.setSystemTime(new Date('2026-11-24T10:00:00'));
  await page.reload();
  await page.waitForSelector('[data-muscugo]');
  await page.click('.hero [data-muscugo], .day-card [data-muscugo]');
  await page.waitForSelector('[data-mpswap="A:1"]');
  if ((await page.inputValue('[data-mpswap="A:1"]')) !== 'dev-sol-h') errors.push(`${name} : « Avant de commencer » ne reprend pas le choix`);
  await page.screenshot({ path: `${out}/${name}-3-avant-de-commencer.png` });
  await page.close();
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sans banc : ok');
