// Partager une séance : bouton « Partager » sur l'historique (course avec tracé, natation, muscu),
// image récap faite dans le téléphone, feuille de partage native (simulée) avec image + texte.
// Repli : téléphone sans partage de fichier → texte seul + image enregistrée.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { routeTuiles } from './tuiles-factices.mjs';

const out = process.argv[2] || '/tmp/foulee-partage';
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

// Boucle de ~5 km : points toutes les 5 s, avec une coupure GPS au milieu.
const { encodeTrace } = await import('../../public/js/gps.js');
const t0 = new Date('2026-11-20T09:00:00').getTime();
const pts = [];
for (let i = 0; i <= 380; i++) {
  if (i > 200 && i < 215) continue;
  const a = (i / 380) * Math.PI * 2;
  pts.push([48.897 + 0.006 * Math.sin(a) + 0.0015 * Math.sin(3 * a), 2.253 + 0.011 * (1 - Math.cos(a)), t0 + i * 5000]);
}
const data = {
  profile: { prenom: 'Rami', questionnaire: { v: 1, answeredAt: 1, sports: ['course', 'natation', 'muscu'], objectifCourse: '10km', joursCourse: [1, 5], joursNatation: [3], joursMuscu: [2, 6], bassin: 25, objectifNatation: 1000, lieu: 'corps', objectifMuscu: 'tonus', niveauMuscu: 'debutant' } },
  sessions: [],
  history: [
    { id: 'c1', sport: 'course', source: 'guidee', date: '2026-11-20T09:00:00', level: 5, sessionName: 'Palier 5 · 3 × 8 min', elapsedSec: 1930, distanceKm: 5.21, distanceSource: 'gps', allureSecKm: 370, deniveleM: 38, trace: encodeTrace(pts), gpsIncomplet: true, cardio: { avg: 152, max: 171, n: 380 }, douleur: 'mollet droit', commentaire: 'SECRET-RESSENTI', difficulte: 3 },
    { id: 'n1', sport: 'natation', source: 'saisie', date: '2026-11-18T12:30:00', sessionName: 'Natation', elapsedSec: 2280, swim: { longueurs: 44, bassinM: 25, nages: ['Crawl', 'Brasse'] } },
    { id: 'm1', sport: 'muscu', source: 'guidee', date: '2026-11-17T19:00:00', seance: 'A', sessionName: 'Corps entier A', elapsedSec: 2520, exercices: [
      { nom: 'Squat goblet', poids: 12, reps: [12, 12, 10] }, { nom: 'Développé couché haltères', poids: 10, reps: [10, 10, 9] },
      { nom: 'Rowing haltère', poids: 12, reps: [10, 10, 10] }, { nom: 'Pompes', reps: [12, 10] }, { nom: 'Gainage', unite: 's', reps: [40, 35] }] },
  ],
  settings: { son: 'musique', annonces: 'signaux' },
};

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const failures = [];
let check0 = true;
for (const [name, dev] of [['iphone', 'iPhone 13'], ['android', 'Pixel 7']]) {
  for (const mode of ['fichier', 'repli']) {
    const context = await browser.newContext({ ...devices[dev], acceptDownloads: true });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-11-20T14:00:00') });
    await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await routeTuiles(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.accept(); });
    await page.addInitScript(([d, m]) => {
      if (!localStorage.getItem('foulee.v1')) localStorage.setItem('foulee.v1', JSON.stringify(d));
      window.__shared = [];
      navigator.share = async (x) => { window.__shared.push({ text: x.text, files: (x.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })) }); };
      navigator.canShare = (x) => m === 'fichier' || !x?.files;
    }, [data, mode]);
    await page.goto(base);
    await page.waitForSelector('[data-tab="progression"]');
    await page.click('[data-tab="progression"]');
    check0 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && innerWidth < 420);
    const check = (ok, msg) => { if (!ok) failures.push(`${name}/${mode}: ${msg}`); };
    check(check0, 'la page déborde de l\'écran');
    for (const [id, label] of [['c1', 'course'], ['n1', 'natation'], ['m1', 'muscu']]) {
      if (mode === 'repli' && id !== 'c1') continue;
      await page.evaluate((i) => { const d = document.querySelector(`[data-partage="${i}"]`).closest('details'); if (!d.open) d.querySelector('summary').click(); }, id);
      await page.evaluate((i) => document.querySelector(`[data-partage="${i}"]`).scrollIntoView({ block: 'center' }), id);
      await page.waitForTimeout(400);
      if (id === 'c1' && mode === 'fichier') {
        // Carte de l'app : fond flat vectoriel (MapLibre) sous le tracé Leaflet.
        await page.evaluate(() => document.querySelector('.map[data-map="c1"]').scrollIntoView({ block: 'center' }));
        await page.waitForSelector('.map[data-map="c1"].map-flat canvas', { timeout: 20000 });
        await page.waitForTimeout(2500);
        check(!(await page.$('.map[data-map="c1"] .map-osm')), 'carte de l\'app : repli OSM au lieu du flat');
        check(/OpenStreetMap/.test(await page.textContent('.map[data-map="c1"] .leaflet-control-attribution')), 'attribution OSM absente');
        await page.screenshot({ path: `${out}/${name}-0-carte-app.png` });
        await page.evaluate(() => document.querySelector('[data-partage="c1"]').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
      }
      if (id === 'c1' && mode === 'fichier') await page.screenshot({ path: `${out}/${name}-1-historique-${label}.png` });
      await page.locator(`[data-partage="${id}"]`).first().dispatchEvent("click"); // clic simulé : Playwright/Pixel mesure la position avant un défilement
      await page.waitForSelector('.partage-img img', { timeout: 10000 });
      await page.waitForFunction(() => document.querySelector('.partage-img img')?.complete);
      const img = await page.evaluate(async () => { const r = await fetch(document.querySelector('.partage-img img').src); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const c of b) s += String.fromCharCode(c); return btoa(s); });
      if (name === 'iphone' && mode === 'fichier') await writeFile(`${out}/image-${label}.png`, Buffer.from(img, 'base64'));
      if (mode === 'fichier') await page.screenshot({ path: `${out}/${name}-2-partage-${label}.png` });
      const sheet = await page.textContent('.partage-sheet');
      check(!/SECRET-RESSENTI|mollet/.test(sheet), 'ressenti visible');
      if (mode === 'fichier') {
        await page.click('[data-partageok]');
        await page.waitForFunction(() => window.__shared.length > 0);
        const sh = await page.evaluate(() => window.__shared.pop());
        check(sh.files.length === 1 && sh.files[0].type === 'image/png' && sh.files[0].size > 20000, `fichier ${label} : ${JSON.stringify(sh.files)}`);
        check(/Avec Foulée/.test(sh.text) && !/SECRET|mollet/.test(sh.text), `texte ${label} : ${sh.text}`);
        if (label === 'course') check(/5,21 km/.test(sh.text) && /6'10/.test(sh.text), `texte course : ${sh.text}`);
      } else {
        check(/joindre l'image directement/.test(sheet), 'repli non expliqué');
        await page.screenshot({ path: `${out}/${name}-3-repli.png` });
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-partageok]')]);
        const sh = await page.evaluate(() => window.__shared.pop());
        check(dl.suggestedFilename() === 'foulee-2026-11-20.png', `téléchargement ${dl.suggestedFilename()}`);
        check(sh && !sh.files.length && /5,21 km/.test(sh.text), `repli texte : ${JSON.stringify(sh)}`);
      }
      // Carte (course, avec tracé) : interrupteur désactivé par défaut, retenu ensuite.
      if (id === 'c1' && mode === 'fichier') {
        check(!(await page.isChecked('[data-partagecarte]')), 'carte cochée par défaut');
        await page.check('[data-partagecarte]');
        await page.waitForSelector('.partage-img img', { timeout: 20000 });
        await page.waitForFunction(() => document.querySelector('.partage-img img')?.complete);
        const alerte = await page.$('.partage-go .alert');
        check(!alerte, `carte non ajoutée : ${alerte ? await alerte.textContent() : ''}`);
        const imgc = await page.evaluate(async () => { const r = await fetch(document.querySelector('.partage-img img').src); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const c of b) s += String.fromCharCode(c); return btoa(s); });
        if (name === 'iphone') await writeFile(`${out}/image-course-carte.png`, Buffer.from(imgc, 'base64'));
        await page.screenshot({ path: `${out}/${name}-4-partage-carte.png` });
        check(await page.evaluate(() => JSON.parse(localStorage.getItem('foulee.v1')).settings.partageCarte === true), 'choix carte non retenu');
        check(/sur la carte/.test(await page.textContent('.partage-note')), 'note carte');
      }
      await page.click('[data-partageclose]');
      check(!(await page.$('.partage-sheet')), 'feuille pas fermée');
    }
    check(!errors.length, errors.join(' | '));
    await context.close();
  }
}
await browser.close();
server.close();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`ok partage : captures dans ${out}`);
