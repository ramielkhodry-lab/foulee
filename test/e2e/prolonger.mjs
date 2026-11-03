// Prolonger en direct : « +1 répétition » à la fin du dernier bloc, avec et sans verrou tactile,
// puis bilan (prévu contre réalisé) et règles d'adaptation. Captures iPhone et Android.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { levelSteps } from '../../public/js/plan.js';

const OUT = process.argv[2] || '/tmp/foulee-prolonger';
await mkdir(OUT, { recursive: true });
const root = new URL('../../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); console.log(`${ok ? 'ok ' : 'KO '} ${what}`); };

const devices = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' },
};
const LAST_RUN = 7 + 300 + 12 * 120; // début de la 7e course du palier 1 dans la piste
const RECUP = LAST_RUN + 120; // début de la récupération

for (const [name, dev] of Object.entries(devices)) {
  const context = await browser.newContext({ ...dev, colorScheme: 'dark', permissions: ['geolocation'], geolocation: { latitude: 48.897, longitude: 2.253, accuracy: 5 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); d.accept(); });
  await page.addInitScript((steps) => {
    if (localStorage.getItem('foulee.v1')) return;
    localStorage.setItem('foulee.v1', JSON.stringify({
      profile: { prenom: 'Rami' },
      sessions: [{ id: 'p1', name: 'Palier 1 · 7 × (2 min course + 2 min marche)', level: 1, steps }],
      history: [],
      settings: { son: 'musique', annonces: 'signaux' },
    }));
  }, levelSteps(1));
  await page.goto(base);
  await page.click('[data-tab="programme"]');
  await page.waitForTimeout(1000);
  await page.click('[data-start="p1"]');
  await page.waitForSelector('#count');
  const player = (js) => page.evaluate(js);
  const seek = async (t, wait = 1800) => { await player(`document.getElementById('player').currentTime = ${t}`); await page.waitForTimeout(wait); };
  const stepno = () => page.textContent('#stepno');
  // Dernière course : pas encore de bouton.
  await seek(LAST_RUN + 35, 700);
  check(await page.locator('#extend').isHidden(), `${name} : pas de bouton pendant la dernière course`);
  // Récupération : le bouton apparaît.
  await seek(RECUP + 30);
  check(await page.locator('[data-extend]').isVisible(), `${name} : bouton pendant la récupération`);
  await page.screenshot({ path: `${OUT}/${name}-1-recuperation.png` });
  const before = await stepno();
  await page.tap('[data-extend]');
  await page.waitForTimeout(900);
  const after = await stepno();
  const t = await player(`document.getElementById('player').currentTime`);
  check(/15\/15/.test(before) && /15\/17 · Marche$/.test(after), `${name} : la récup devient la marche (${before} → ${after})`);
  check(Math.abs(t - (RECUP + 31)) < 2, `${name} : la piste reprend au même instant (${t.toFixed(1)} s)`);
  check(/Course lente · 2 min/.test(await page.textContent('#next')), `${name} : ensuite = course 2 min`);
  check(/^1:/.test(await page.textContent('#count')), `${name} : il reste la fin des 2 min de marche (${await page.textContent('#count')})`);
  check(!(await page.locator('.alert').count()), `${name} : pas d'alerte d'interruption`);
  await page.screenshot({ path: `${OUT}/${name}-2-apres-appui.png` });
  // Annuler puis refaire.
  await page.tap('[data-unextend]');
  await page.waitForTimeout(700);
  check(/15\/15/.test(await stepno()), `${name} : annuler rend la récupération`);
  await page.tap('[data-extend]');
  await page.waitForTimeout(700);
  // Course ajoutée : pas de bouton.
  await seek(RECUP + 120 + 30, 700);
  check(await page.locator('#extend').isHidden() && /16\/17/.test(await stepno()), `${name} : pas de bouton pendant la course ajoutée`);
  // Nouvelle récupération, écran verrouillé : appui court sans effet, appui long = +1, verrou gardé.
  await seek(RECUP + 240 + 20);
  await page.tap('[data-touchlock]');
  await page.waitForTimeout(400);
  check(await page.locator('#touchlock .lock-extend').isVisible(), `${name} : +1 sur le calque du verrou`);
  const box = await page.locator('#touchlock .lock-extend').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForTimeout(300);
  check(/17\/17/.test(await stepno()), `${name} : appui court verrouillé sans effet`);
  await page.mouse.down(); await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/${name}-3-verrou-appui.png` });
  await page.waitForTimeout(1300); await page.mouse.up();
  await page.waitForTimeout(800);
  check(/17\/19 · Marche$/.test(await stepno()), `${name} : appui long verrouillé = +1 (${await stepno()})`);
  check(await page.locator('#touchlock').count() === 1, `${name} : toujours verrouillé`);
  await page.screenshot({ path: `${OUT}/${name}-4-verrou-apres.png` });
  const lb = await page.locator('#touchlock .lock-btn').boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(2300); await page.mouse.up();
  // Dernière récupération : on s'arrête là.
  await seek(RECUP + 480 + 30, 700);
  await page.tap('[data-finish]');
  await page.waitForSelector('[data-savebilan]');
  const bilanText = await page.textContent('#app');
  check(/9 répétitions au lieu de 7/.test(bilanText), `${name} : bilan prévu contre réalisé`);
  await page.screenshot({ path: `${OUT}/${name}-5-bilan.png` });
  await page.tap('[data-scale="difficulte"][data-v="3"]');
  await page.tap('[data-savebilan]');
  await page.waitForTimeout(500);
  const suite = await page.textContent('#app');
  check(/ajouté 2 répétitions/.test(suite) && /palier suivant/.test(suite), `${name} : règles = palier suivant (un seul)`);
  await page.screenshot({ path: `${OUT}/${name}-6-suite.png` });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).history[0]);
  check(stored.extra === 2 && stored.extraFaites === 2 && stored.repsPrevues === 7 && stored.steps.length === 19, `${name} : bilan enregistré (${JSON.stringify({ e: stored.extra, f: stored.extraFaites, p: stored.repsPrevues, n: stored.steps.length })})`);
  check(errors.length === 0, `${name} : aucune erreur (${errors.join(' | ')})`);
  await context.close();
}
await browser.close();
server.close();
if (fails.length) { console.log(`\n${fails.length} échec(s)`); process.exit(1); }
