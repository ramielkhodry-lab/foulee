// Changer de palier soi-même (après 2 tests, ou dans Programme) et distance en courant.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const out = process.argv[2] || '/tmp/foulee-palier-tests';
await mkdir(out, { recursive: true });
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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');



// Bulle de la courbe : total de la semaine + une ligne par séance avec son jour ; toucher une
// ligne ouvre la séance dans l'historique. Muscu : une semaine au poids du corps a son point
// même quand la courbe est en kg.
const ex = (id, nom, poids, reps) => ({ id, nom, poids, reps, max: 12 });
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'muscu'], objectifCourse: '10km', joursCourse: [1, 5] } },
  sessions: [],
  history: [
    { id: 'c1', sport: 'course', source: 'guidee', date: '2026-11-02T18:00:00', level: 2, sessionName: 'Palier 2', elapsedSec: 2340, distanceKm: 4.1 },
    { id: 'c2', sport: 'course', source: 'guidee', date: '2026-11-06T10:00:00', level: 2, sessionName: 'Palier 2', elapsedSec: 2340, distanceKm: 4.3 },
    { id: 'c3', sport: 'course', source: 'guidee', date: '2026-11-17T18:00:00', level: 3, sessionName: 'Palier 3', elapsedSec: 2500, distanceKm: 4.6 },
    { id: 'm1', sport: 'muscu', source: 'guidee', date: '2026-11-10T10:00:00', sessionName: 'Muscu A', elapsedSec: 2400, exercices: [ex('pompes', 'Pompes', 0, [12, 10, 9])] },
    { id: 'm2', sport: 'muscu', source: 'guidee', date: '2026-11-11T10:00:00', sessionName: 'Muscu B', elapsedSec: 2400, exercices: [ex('squat', 'Squat', 0, [15, 15])] },
    { id: 'm3', sport: 'muscu', source: 'guidee', date: '2026-11-18T10:00:00', sessionName: 'Muscu A', elapsedSec: 2700, exercices: [ex('curl', 'Curl haltères', 8, [10, 10, 10])] },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch();
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  const context = await browser.newContext({ ...devices[dev] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((d) => { if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d)); }, data);
  await page.goto(base);
  await page.waitForSelector('#tabs');
  await page.click('#tabs [data-tab="progression"]');
  await page.click('[data-progsport="course"]');
  const pts = page.locator('.prog [data-curvetip]');
  check(await pts.count() === 2, `${name} : 2 semaines de course attendues, ${await pts.count()}`);
  await pts.first().click();
  const tip = page.locator('.ct.on .curve-tip');
  const txt = await tip.innerText();
  check(/Semaine du 2\/11 au 8\/11/i.test(txt), `${name} : titre de semaine absent (${txt})`);
  check(/8,4 km/.test(txt) && /2 séances · 1 h 18 au total/.test(txt), `${name} : total semaine faux (${txt})`);
  check(/lun\. 2 nov\.[\s\S]*4,1 km · 39 min/.test(txt) && /ven\. 6 nov\.[\s\S]*4,3 km · 39 min/.test(txt), `${name} : lignes par séance absentes (${txt})`);
  await page.screenshot({ path: `${out}/${name}-1-bulle-course.png` });
  await tip.locator('[data-openhist="c2"]').click();
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => [...document.querySelectorAll('details.hist[open]')].map((x) => x.dataset.hist));
  check(opened.includes('c2'), `${name} : la séance du 6/11 ne s'ouvre pas (${opened})`);
  const inView = await page.locator('details.hist[data-hist="c2"]').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight; });
  check(inView, `${name} : la séance ouverte n'est pas à l'écran`);
  await page.screenshot({ path: `${out}/${name}-2-detail-ouvert.png` });

  // Une seule séance : toucher la bulle entière ouvre la séance.
  await page.evaluate(() => scrollTo(0, 0));
  await pts.nth(1).click();
  await page.locator('.ct.on .curve-tip').click();
  await page.waitForTimeout(600);
  check(await page.locator('details.hist[data-hist="c3"]').evaluate((el) => el.open), `${name} : bulle à une séance ne l'ouvre pas`);

  // Muscu : 3 séances sur 2 semaines, dont 2 au poids du corps, courbe en kg.
  await page.evaluate(() => scrollTo(0, 0));
  await page.click('[data-progsport="muscu"]');
  const mp = page.locator('.prog [data-curvetip]');
  check(await mp.count() === 2, `${name} : 2 semaines de muscu attendues, ${await mp.count()}`);
  const circles = await page.locator('.prog svg.curve circle[r="3.5"]').count();
  check(circles === 2, `${name} : 2 points muscu attendus, ${circles}`);
  await mp.nth(0).click();
  const mt = await page.locator('.ct.on .curve-tip').innerText();
  check(/2 séances/.test(mt) && /mar\. 10 nov\./.test(mt) && /mer\. 11 nov\./.test(mt), `${name} : bulle muscu (${mt})`);
  await page.screenshot({ path: `${out}/${name}-3-bulle-muscu.png` });
  check(!errors.length, `${name} : erreurs ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('bulle-seances ok');
