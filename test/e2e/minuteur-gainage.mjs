// Minuteur du gainage : départ après 3 s, signal au minimum, fin au maximum, série notée et récup.
// Captures iPhone et Android.
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
  sessions: [], history: [], settings: { son: 'musique', annonces: 'signaux', muscuChoix: { 'A:5': 'gainage' } },
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
  await page.click('.hero [data-muscugo], .day-card [data-muscugo]');
  await page.waitForSelector('[data-mstart]:not([disabled])');
  await page.click('[data-mstart]');
  await page.clock.runFor(3500);
  await page.waitForSelector('.mlive[data-phase="work"]');
  for (let i = 0; i < 8 && !/Gainage/.test(await page.textContent('.mname')); i++) {
    await page.click('[data-mskip]');
    await page.waitForTimeout(50);
  }
  if (!/Gainage/.test(await page.textContent('.mname'))) { errors.push(`${name} : gainage introuvable`); await page.close(); continue; }
  await page.clock.runFor(1600);
  await page.screenshot({ path: `${out}/${name}-1-gainage.png` });
  // Piste lancée dans le geste : on vérifie qu'un son est bien demandé au clic.
  await page.evaluate(() => { window.__plays = 0; const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays++; return p.call(this).catch(() => {}); }; });
  await page.click('[data-mholdgo]');
  await page.waitForSelector('.mlive[data-phase="hold"]');
  if (!(await page.evaluate(() => window.__plays))) errors.push(`${name} : pas de son lancé au clic`);
  await page.clock.runFor(300);
  if (await page.textContent('#mholdnow') !== 'Mets-toi en place') errors.push(`${name} : mise en place ${await page.textContent('#mholdnow')}`);
  await page.waitForTimeout(2700); // fin du flash (animation CSS en temps réel)
  await page.screenshot({ path: `${out}/${name}-2-mise-en-place.png` });
  await page.clock.runFor(3000 + 12_000 - 2700);
  if (await page.textContent('#mholdnow') !== 'Tiens' || await page.textContent('#mhold') !== '12') errors.push(`${name} : maintien ${await page.textContent('#mholdnow')} ${await page.textContent('#mhold')}`);
  await page.waitForTimeout(2700); // fin du flash (animation CSS en temps réel)
  await page.screenshot({ path: `${out}/${name}-3-tiens.png` });
  await page.clock.runFor(18_500 - 2700);
  if (await page.textContent('#mholdnow') !== 'Dans la tranche') errors.push(`${name} : minimum ${await page.textContent('#mholdnow')}`);
  await page.waitForTimeout(2700); // fin du flash (animation CSS en temps réel)
  await page.screenshot({ path: `${out}/${name}-4-dans-la-tranche.png` });
  await page.clock.runFor(15_000 - 2700);
  await page.waitForSelector('.mlive[data-phase="rest"]');
  const g = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.muscu')));
  if (g.exercices.at(-1).reps[0] !== 45 || g.hold) errors.push(`${name} : série notée ${JSON.stringify(g.exercices.at(-1).reps)}`);
  await page.clock.runFor(1600);
  await page.screenshot({ path: `${out}/${name}-5-recup-auto.png` });
  // Série 2 : arrêt à la main à 38 s.
  await page.click('[data-mrestskip]');
  await page.click('[data-mholdgo]');
  await page.clock.runFor(3000 + 38_300);
  await page.click('[data-mholdstop]');
  // Dernière série : arrêt à la main = bilan prérempli avec 45 puis 38 s.
  await page.waitForTimeout(300);
  const vals = await page.$$eval('input', (els) => els.map((e) => e.value));
  if (!(vals.includes('45') && vals.includes('38'))) errors.push(`${name} : bilan ${vals.join(',')}`);
  await page.screenshot({ path: `${out}/${name}-6-bilan.png`, fullPage: true });
  await page.close();
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('OK');
