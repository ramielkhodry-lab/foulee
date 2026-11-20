// Partage d'une séance avec ses proches (Messages, WhatsApp…) : une image « affiche » et un
// texte court, faits dans le téléphone. Aucun lien public : rien ne quitte l'appareil sauf ce
// que la personne envoie elle-même par la feuille de partage.
// Seuls les chiffres mesurés (ou corrigés par la personne) y figurent. Douleur et ressenti
// restent privés : jamais dans l'image ni dans le texte.

import { tonnage } from './muscu.js';
import { libreResume } from './libre.js';
import { ATTRIBUTION_TEXT } from './mapstyle.js';

export const COLORS = { course: '#C8FF2E', natation: '#2F8CFF', muscu: '#FF7A1A', autre: '#F5F5F7' };
const LABEL = { course: 'Course', natation: 'Natation', muscu: 'Musculation', autre: 'Activité' };

const fr = (n, d = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d });
export const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
const pace = (secKm) => `${Math.floor(secKm / 60)}'${String(Math.round(secKm % 60)).padStart(2, '0')}`;
const dateFr = (d) => new Date(String(d).length === 10 ? `${d}T12:00` : d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const reps = (h) => (h.exercices || []).filter((x) => x.unite !== 's').reduce((a, x) => a + (x.reps || []).reduce((s, r) => s + (Number(r) || 0), 0), 0);
const swimM = (h) => (h.swim?.longueurs ? h.swim.longueurs * (h.swim.bassinM || 25) : Math.round((h.distanceKm || 0) * 1000));

// Ce que dit la carte : le chiffre principal, quelques chiffres secondaires, des lignes de détail.
export function recap(h) {
  const sport = ['course', 'natation', 'muscu', 'autre'].includes(h.sport) ? h.sport : 'course';
  const stats = [];
  const lines = [];
  let big = null;
  let sub = '';
  if (h.elapsedSec) stats.push({ label: 'Durée', value: mmss(h.elapsedSec) });
  if (sport === 'course') {
    if (h.distanceKm) big = { value: fr(h.distanceKm, 2), unit: h.distanceEstimee ? 'km estimés' : 'km' };
    if (h.allureSecKm && !h.distanceEstimee) stats.push({ label: 'Allure', value: pace(h.allureSecKm), unit: '/km' });
    if (h.deniveleM) stats.push({ label: 'Dénivelé', value: `+${h.deniveleM}`, unit: 'm' });
    const r = h.libre ? libreResume(h) : null;
    if (r) {
      sub = 'Test 5 courses au max';
      lines.push(`Plus longue course continue : ${mmss(r.plusLongue)}`);
      lines.push(`${r.n} bloc${r.n > 1 ? 's' : ''} · ${mmss(r.courseSec)} de course en tout`);
    } else if (h.sessionName) sub = h.sessionName;
  } else if (sport === 'natation') {
    const m = swimM(h);
    if (m) big = { value: fr(m), unit: 'm' };
    if (h.swim?.longueurs) stats.push({ label: 'Longueurs', value: String(h.swim.longueurs), unit: `× ${h.swim.bassinM || 25} m` });
    if (h.swim?.nages?.length) lines.push(h.swim.nages.join(', '));
    sub = h.sessionName || '';
  } else if (sport === 'muscu') {
    const kg = tonnage(h);
    const n = reps(h);
    if (kg > 0) big = { value: fr(Math.round(kg)), unit: 'kg soulevés' };
    else if (n) big = { value: fr(n), unit: 'répétitions' };
    if (h.exercices?.length) stats.push({ label: 'Exercices', value: String(h.exercices.length) });
    if (kg > 0 && n) stats.push({ label: 'Répétitions', value: fr(n) });
    for (const x of h.exercices || []) {
      const done = (x.reps || []).filter((r) => r > 0);
      if (!done.length) continue;
      lines.push(`${x.nom} · ${x.poids ? `${String(x.poids).replace('.', ',')} kg · ` : ''}${done.join(' / ')}${x.unite === 's' ? ' s' : ''}`);
    }
    sub = h.sessionName || '';
  } else {
    sub = h.activite || 'Autre activité';
  }
  if (!big && h.elapsedSec) {
    big = { value: String(Math.round(h.elapsedSec / 60)), unit: 'min' };
    stats.shift();
  }
  if (h.cardio?.avg) stats.push({ label: 'Cardio moy.', value: String(h.cardio.avg), unit: 'bpm' });
  if (h.montre?.kcal) stats.push({ label: 'Calories', value: String(h.montre.kcal), unit: 'kcal' });
  if (sub && sub.toLowerCase() === LABEL[sport].toLowerCase()) sub = '';
  return { sport, color: COLORS[sport], label: LABEL[sport], date: dateFr(h.date), big, stats: stats.slice(0, 4), lines, sub, text: shareText(h, sport, big, stats) };
}

function shareText(h, sport, big, stats) {
  const what = { course: 'Ma course', natation: 'Ma natation', muscu: 'Ma séance de muscu', autre: h.activite ? `Mon activité (${h.activite})` : 'Mon activité' }[sport];
  const parts = [];
  if (big) parts.push(`${big.value} ${big.unit}`);
  for (const s of stats) if (s.label !== 'Calories') parts.push(`${s.label.toLowerCase()} ${s.value}${s.unit ? ` ${s.unit}` : ''}`);
  return `${what} du ${dateFr(h.date)} : ${parts.join(' · ')}.\nAvec Foulée.`;
}

// Tracé → coordonnées dans un cadre (x, y, l, h), proportions respectées. Équirectangulaire :
// assez juste à l'échelle d'une course.
export function project(segments, box) {
  const pts = segments.flat();
  if (pts.length < 2) return [];
  const lat0 = (pts.reduce((a, p) => a + p[0], 0) / pts.length) * Math.PI / 180;
  const xy = (p) => [p[1] * Math.cos(lat0), -p[0]];
  const all = pts.map(xy);
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const w = maxX - minX || 1e-9;
  const hh = maxY - minY || 1e-9;
  const k = Math.min(box.w / w, box.h / hh);
  const ox = box.x + (box.w - w * k) / 2;
  const oy = box.y + (box.h - hh * k) / 2;
  return segments.map((seg) => seg.map((p) => { const [x, y] = xy(p); return [ox + (x - minX) * k, oy + (y - minY) * k]; }));
}

// --- Dessin (navigateur) ----------------------------------------------------

const W = 1080;
const H = 1350;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

async function fonts() {
  if (!document.fonts?.load) return;
  await Promise.all(['600 40px', 'italic 700 40px', 'italic 800 40px'].map((f) => document.fonts.load(`${f} "Barlow Condensed"`).catch(() => null)));
}

// Texte réduit jusqu'à tenir dans la largeur.
function fit(ctx, text, font, size, maxW) {
  let s = size;
  ctx.font = `${font} ${s}px ${FONT}`;
  while (s > 20 && ctx.measureText(text).width > maxW) { s -= 4; ctx.font = `${font} ${s}px ${FONT}`; }
  return s;
}

// Fond de carte flat sous le tracé (option « Afficher la carte ») : une carte MapLibre hors écran,
// cadrée sur le tracé, recopiée dans l'image. Renvoie aussi la projection pour y poser le tracé.
async function mapSnapshot(segments, w, h, pad) {
  const [{ loadMaplibre }, { flatStyle }] = await Promise.all([import('./map.js'), import('./mapstyle.js')]);
  const gl = await loadMaplibre();
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;left:${-w - 200}px;top:0;width:${w}px;height:${h}px;pointer-events:none`;
  document.body.appendChild(div);
  const pts = segments.flat();
  const lons = pts.map((p) => p[1]);
  const lats = pts.map((p) => p[0]);
  let map;
  try {
    map = new gl.Map({
      container: div, style: flatStyle(), interactive: false, attributionControl: false, pixelRatio: 1, fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      fitBoundsOptions: { padding: pad, maxZoom: 17 },
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('carte trop lente à charger')), 12000);
      map.once('idle', () => { clearTimeout(t); resolve(); });
      map.on('error', (e) => { if (!map.loaded() && /style|source/i.test(String(e?.error?.message || ''))) { clearTimeout(t); reject(new Error('carte indisponible')); } });
    });
    const img = document.createElement('canvas');
    img.width = w;
    img.height = h;
    img.getContext('2d').drawImage(map.getCanvas(), 0, 0, w, h);
    const proj = (p) => { const q = map.project([p[1], p[0]]); return [q.x, q.y]; };
    return { img, lines: segments.map((seg) => seg.map(proj)) };
  } finally {
    map?.remove();
    div.remove();
  }
}

export async function drawCard(h, segments, { carte = false } = {}) {
  await fonts();
  const r = recap(h);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const P = 72;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // En-tête : marque et date.
  ctx.fillStyle = '#9A9AA1';
  ctx.font = `600 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('FOULÉE', P, P + 30);
  ctx.textAlign = 'right';
  ctx.fillText(r.date.toUpperCase(), W - P, P + 30);
  ctx.textAlign = 'left';

  // Sport et nom de la séance.
  ctx.fillStyle = r.color;
  ctx.font = `italic 800 64px ${FONT}`;
  ctx.fillText(r.label.toUpperCase(), P, 200);
  if (r.sub) {
    ctx.fillStyle = '#F5F5F7';
    fit(ctx, r.sub, '600', 40, W - 2 * P);
    ctx.fillText(r.sub, P, 254);
  }

  // Chiffre principal.
  let y = 520;
  if (r.big) {
    const s = fit(ctx, r.big.value, 'italic 800', 290, W - 2 * P - 260);
    ctx.fillStyle = r.color;
    ctx.fillText(r.big.value, P - 6, y);
    const vw = ctx.measureText(r.big.value).width;
    ctx.fillStyle = '#F5F5F7';
    ctx.font = `italic 700 ${Math.round(Math.min(72, s * 0.28))}px ${FONT}`;
    ctx.fillText(r.big.unit.toUpperCase(), P + vw + 18, y);
  } else y = 300;

  // Bas : chiffres secondaires.
  const statsY = H - P - 20;
  const hasStats = r.stats.length > 0;
  if (hasStats) {
    const colW = (W - 2 * P) / r.stats.length;
    r.stats.forEach((s, i) => {
      const x = P + i * colW;
      ctx.fillStyle = '#9A9AA1';
      ctx.font = `600 30px ${FONT}`;
      ctx.fillText(s.label.toUpperCase(), x, statsY - 74);
      ctx.fillStyle = '#F5F5F7';
      const vs = fit(ctx, s.value, 'italic 700', 76, colW - 20);
      ctx.fillText(s.value, x, statsY);
      if (s.unit) {
        const vw = ctx.measureText(s.value).width;
        ctx.fillStyle = '#9A9AA1';
        ctx.font = `600 ${Math.round(vs * 0.42)}px ${FONT}`;
        if (x + vw + 8 + ctx.measureText(s.unit).width < x + colW) ctx.fillText(s.unit, x + vw + 8, statsY);
      }
    });
    ctx.fillStyle = '#2A2A2E';
    ctx.fillRect(P, statsY - 140, W - 2 * P, 2);
  }

  // Milieu : le tracé, sinon les lignes de détail.
  const top = y + 60;
  const bottom = (hasStats ? statsY - 180 : H - P);
  let lines = [];
  let carteErr = null;
  if (carte && segments?.length && bottom - top > 200) {
    try {
      const snap = await mapSnapshot(segments, W, bottom - top, 70);
      ctx.drawImage(snap.img, 0, top);
      // Fondu vers le noir en haut et en bas : la carte se fond dans l'affiche.
      for (const [y0, y1] of [[top, top + 70], [bottom, bottom - 70]]) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.min(y0, y1), W, 70);
      }
      ctx.fillStyle = '#6E6E76';
      ctx.font = `600 20px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(ATTRIBUTION_TEXT, W - P, bottom - 12);
      ctx.textAlign = 'left';
      lines = snap.lines.map((seg) => seg.map(([x, yy]) => [x, top + yy]));
    } catch (err) { carteErr = err.message; }
  }
  if (!lines.length) lines = project(segments || [], { x: P + 20, y: top, w: W - 2 * P - 40, h: Math.max(0, bottom - top) });
  if (lines.length && bottom - top > 200) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = r.color;
    for (const [width, alpha] of [[26, 0.16], [9, 1]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      for (const seg of lines) {
        if (seg.length < 2) continue;
        ctx.beginPath();
        seg.forEach(([x, yy], i) => (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy)));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // Tronçons sans GPS (écran verrouillé) : pointillés gris, comme sur la carte de l'app.
    ctx.setLineDash([10, 14]);
    ctx.strokeStyle = '#9A9AA1';
    ctx.lineWidth = 4;
    for (let i = 1; i < lines.length; i++) {
      ctx.beginPath();
      ctx.moveTo(...lines[i - 1].at(-1));
      ctx.lineTo(...lines[i][0]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const dot = ([x, yy], fill, rad) => { ctx.beginPath(); ctx.arc(x, yy, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.stroke(); };
    dot(lines[0][0], '#FFFFFF', 14);
    dot(lines.at(-1).at(-1), r.color, 16);
  } else if (r.lines.length) {
    const max = Math.max(1, Math.floor((bottom - top) / 62));
    const shown = r.lines.length > max ? [...r.lines.slice(0, max - 1), `+ ${r.lines.length - max + 1} autre${r.lines.length - max + 1 > 1 ? 's' : ''}`] : r.lines;
    shown.forEach((t, i) => {
      ctx.fillStyle = i === 0 ? '#F5F5F7' : '#C9C9CE';
      fit(ctx, t, '600', 44, W - 2 * P);
      ctx.fillText(t, P, top + 40 + i * 62);
    });
  }
  return { canvas: c, recap: r, carteErr };
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image impossible'))), 'image/png'));
}

export const fileName = (h) => `foulee-${String(h.date || '').slice(0, 10) || 'seance'}.png`;
