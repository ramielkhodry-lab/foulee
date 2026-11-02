// Cardio mesuré par une montre (Apple Watch via Santé et un Raccourci iPhone) et rattaché
// à une séance guidée. Règle de Foulée : rien ne s'affiche s'il n'a pas été mesuré.

import { KINDS } from './phrases.js';

const MIN_SAMPLES = 10; // en dessous, pas assez de mesures pour dire quoi que ce soit
const BUCKET = 30; // courbe gardée : une valeur toutes les 30 s
const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

// Pendant la séance, on note des repères (position dans la piste en s, heure en ms) à chaque
// lecture, saut et changement d'étape. Ils donnent l'heure réelle de début de chaque étape,
// pauses comprises : stepMs[i] = début de l'étape i, stepMs[n] = fin de la séance.
export function stepTimes(anchors, starts, end, reached) {
  const a = (anchors || []).filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1])).sort((x, y) => x[1] - y[1]);
  if (!a.length) return null;
  const wallAt = (T) => {
    let k = -1;
    for (let i = 0; i < a.length; i++) if (a[i][0] <= T + 0.5) k = i;
    if (k < 0) return a[0][1];
    const w = a[k][1] + (T - a[k][0]) * 1000;
    return k + 1 < a.length ? Math.min(w, a[k + 1][1]) : w;
  };
  const stop = Math.min(reached, end);
  const out = [];
  for (let i = 0; i < starts.length; i++) out.push(Math.round(wallAt(Math.min(starts[i], stop))));
  out.push(Math.round(wallAt(stop)));
  return out;
}

// Plage horaire de la séance (ms), ou null si on ne connaît pas l'heure (séance saisie à la main).
export function windowOf(h) {
  if (h?.stepMs?.length >= 2) return [h.stepMs[0], h.stepMs.at(-1)];
  if (h?.source !== 'guidee' || !/T\d{2}:\d{2}/.test(String(h.date))) return null;
  const start = new Date(h.date).getTime();
  if (!Number.isFinite(start)) return null;
  const end = h.endedAt ? new Date(h.endedAt).getTime() : start + ((h.elapsedSec || 0) + 60) * 1000;
  return [start, end];
}

// Mesures [[t, bpm], …] → résumé gardé sur la séance, ou null si trop peu de mesures.
export function summarize(h, samples) {
  const w = windowOf(h);
  if (!w) return null;
  const inside = (samples || []).filter(([t]) => t >= w[0] && t <= w[1]).sort((x, y) => x[0] - y[0]);
  if (inside.length < MIN_SAMPLES) return null;
  const bpms = inside.map((s) => s[1]);
  const c = { avg: mean(bpms), max: Math.max(...bpms), min: Math.min(...bpms), n: inside.length, t0: w[0], pas: BUCKET, source: 'montre' };
  // Par phase : seulement si on connaît l'heure de chaque étape.
  if (h.stepMs?.length === (h.steps?.length || 0) + 1) {
    const effortAt = (t) => {
      for (let i = 0; i < h.steps.length; i++) if (t >= h.stepMs[i] && t < h.stepMs[i + 1]) return h.steps[i].kind;
      return null;
    };
    const run = [];
    const walk = [];
    for (const [t, bpm] of inside) {
      const kind = effortAt(t);
      if (kind && KINDS[kind]?.effort === 'course') run.push(bpm);
      else if (kind === 'marche') walk.push(bpm); // marches entre deux courses, sans échauffement ni retour au calme
    }
    if (run.length >= 3) c.course = mean(run);
    if (walk.length >= 3) c.marche = mean(walk);
    c.bandes = h.steps
      .map((s, i) => (KINDS[s.kind]?.effort === 'course' && h.stepMs[i + 1] > h.stepMs[i] ? [Math.round((h.stepMs[i] - w[0]) / 1000), Math.round((h.stepMs[i + 1] - w[0]) / 1000)] : null))
      .filter(Boolean);
  }
  // Courbe compacte : moyenne par tranche de 30 s, tranche vide = valeur précédente.
  const nb = Math.max(1, Math.ceil((w[1] - w[0]) / 1000 / BUCKET));
  const sums = Array.from({ length: nb }, () => []);
  for (const [t, bpm] of inside) sums[Math.min(nb - 1, Math.floor((t - w[0]) / 1000 / BUCKET))].push(bpm);
  let prev = bpms[0];
  c.pts = sums.map((b) => (prev = b.length ? mean(b) : prev));
  return c;
}

// Cardio de référence d'une course pour comparer deux séances : en course si connu, sinon moyen.
export const runBpm = (h) => h?.cardio?.course ?? h?.cardio?.avg ?? null;

export function cardioLine(c) {
  if (!c) return '';
  const parts = [`${c.avg} bpm de moyenne`, `max ${c.max}`];
  if (c.course) parts.push(`en course ${c.course}`);
  if (c.marche) parts.push(`en marche ${c.marche}`);
  return parts.join(' · ');
}

// Pour l'IA : ce qui a été mesuré, rien d'autre.
export function cardioText(c) {
  if (!c) return '';
  return `cardio mesuré par la montre : moyenne ${c.avg} bpm, max ${c.max}${c.course ? `, en course ${c.course}` : ''}${c.marche ? `, en marche ${c.marche}` : ''}`;
}

// Courbe du cardio, phases de course en fond. SVG autonome.
export function curveSvg(c, cls = 'course') {
  if (!c?.pts || c.pts.length < 4) return ''; // moins de 2 min : pas de courbe
  const W = 320;
  const H = 96;
  const lo = Math.min(...c.pts) - 5;
  const hi = Math.max(...c.pts) + 5;
  const dur = c.pts.length * c.pas;
  const x = (s) => ((s / dur) * W).toFixed(1);
  const y = (v) => (H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 24)).toFixed(1);
  const line = c.pts.map((v, i) => `${x(i * c.pas + c.pas / 2)},${y(v)}`).join(' ');
  const bands = (c.bandes || []).map(([a, b]) => `<rect x="${x(a)}" y="0" width="${Math.max(1, x(b) - x(a))}" height="${H - 12}" class="hr-band"/>`).join('');
  const iMax = c.pts.indexOf(Math.max(...c.pts));
  const min = Math.round(dur / 60);
  return `<svg class="hr-curve ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe du cardio : de ${c.min} à ${c.max} bpm">
    ${bands}<polyline points="${line}" fill="none" class="hr-line"/>
    <circle cx="${x(iMax * c.pas + c.pas / 2)}" cy="${y(c.pts[iMax])}" r="3" class="hr-dot"/>
    <text x="2" y="${H - 1}" class="hr-axis">0</text><text x="${W - 2}" y="${H - 1}" text-anchor="end" class="hr-axis">${min} min</text>
  </svg>`;
}
