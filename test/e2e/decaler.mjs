// Avancer / décaler une séance, pour un proche (course + muscu, questionnaire rempli).
// Mardi 3/11 : muscu du jour décalée au mercredi, puis course du jeudi avancée.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp';
const root = new URL('../../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const data = {
  profile: { prenom: 'Karim', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'muscu'], objectifCourse: '5km', joursCourse: [1, 4], joursMuscu: [2, 6], lieu: 'salle', objectifMuscu: 'tonus', niveauMuscu: 'debutant' } },
  sessions: [],
  history: [{ id: 'r1', sport: 'course', date: '2026-11-02', level: 2, elapsedSec: 2400, difficulte: 3 }],
  settings: { son: 'musique', annonces: 'signaux' },
};

const errors = [];
const browser = await chromium.launch();
for (const [name, dev] of [['iphone', devices['iPhone 13']], ['android', devices['Pixel 7']]]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-11-03T18:00:00'));
  page.on('pageerror', (e) => errors.push(`${name} ${e.message}`));
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('.day-card.muscu');
  await page.locator('.day-card [data-move]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-1-muscu-du-jour.png` });
  await page.click('.day-card [data-move]');
  await page.waitForSelector('.move-sheet');
  await page.screenshot({ path: `${out}/${name}-2-choix-du-jour.png` });
  const days = await page.locator('.move-sheet [data-moveto]').allTextContents();
  if (!days.some((t) => t.includes('Demain'))) errors.push(`${name} jours : ${days}`);
  if (days.some((t) => /jeudi 5/.test(t))) errors.push(`${name} jeudi (course) proposé`);
  await page.click('.move-sheet [data-moveto]:has-text("Demain")');
  await page.waitForSelector('.day-card.muscu');
  await page.screenshot({ path: `${out}/${name}-3-muscu-mercredi.png` });
  const kicker = await page.textContent('.day-card .day-kicker');
  if (!/mercredi 4/.test(kicker)) errors.push(`${name} carte : ${kicker}`);
  await page.click('[data-pickday="2026-11-03"]');
  const rest = await page.textContent('.day-card');
  if (!/Muscu décalée au mercredi 4/.test(rest)) errors.push(`${name} mardi : ${rest}`);
  // Avancer la course du jeudi à aujourd'hui (mardi) : refusé, couru lundi. Jeudi → vendredi possible.
  await page.click('[data-pickday="2026-11-05"]');
  await page.click('.day-card [data-move]');
  const runDays = await page.locator('.move-sheet [data-moveto]').allTextContents();
  if (runDays.some((t) => /Aujourd'hui/.test(t))) errors.push(`${name} course proposée le lendemain d'une course`);
  if (!runDays.some((t) => /vendredi 6/.test(t))) errors.push(`${name} course : ${runDays}`);
  await page.click('[data-moveclose]');
  // Programme : le lien est aussi dans le détail des séances à venir.
  await page.click('[data-tab="programme"]');
  if (!(await page.locator('.timeline [data-move]').count())) errors.push(`${name} pas de lien dans le Programme`);
  await ctx.close();
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('décaler : ok');
