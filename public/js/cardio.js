// Cardio mesuré par une montre (Apple Watch via Santé et un Raccourci iPhone) et rattaché
// à une séance guidée. Règle de Foulée : rien ne s'affiche s'il n'a pas été mesuré.

import { KINDS } from './phrases.js';

const MIN_SAMPLES = 10; // en dessous, pas assez de mesures pour dire quoi que ce soit
const BUCKET = 30; // courbe gardée : une valeur toutes les 30 s
const HIST_MAX_MS = 10_000;
const RECOVERY_SEC = 180; // cardio après l'effort : les 3 minutes qui suivent la fin
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
  if (h?.fenetre?.length === 2) return h.fenetre; // natation : plage trouvée dans les longueurs de la montre
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
  const c = { avg: mean(bpms), max: Math.max(...bpms), min: Math.min(...bpms), n: inside.length, t0: w[0], t1: w[1], pas: BUCKET, source: 'montre' };
  // Temps passé à chaque bpm (s) : chaque mesure vaut jusqu'à la suivante, 10 s au plus.
  // Sert au temps par zone, recalculable si les zones changent.
  c.hist = {};
  inside.forEach(([t, bpm], i) => {
    const next = inside[i + 1]?.[0];
    const sec = Math.min(next !== undefined ? next - t : 5000, HIST_MAX_MS) / 1000;
    c.hist[bpm] = Math.round(((c.hist[bpm] || 0) + sec) * 10) / 10;
  });
  const ap = recovery(w[1], samples);
  if (ap) c.apres = ap;
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

// Autres mesures de la montre ({ dist, kcal, puiss, pas } : [[t, valeur], …]) pendant la
// séance : distance, énergie active, puissance moyenne, cadence moyenne (pas par minute,
// marche comprise, comme l'app Forme). null si rien n'a été mesuré.
// Version du calcul : une séance résumée avec une version plus ancienne est recalculée (le
// 2/11/2026, les valeurs « 1,2e-05 » km étaient lues 1,2 km par le serveur : 6,93 km au lieu de 4,8).
export const MONTRE_V = 2;
export const montreStale = (m) => Boolean(m) && m.v !== MONTRE_V;
export function summarizeMontre(h, autres) {
  const w = windowOf(h);
  if (!w || !autres) return null;
  const inside = (k) => (autres[k] || []).filter(([t]) => t >= w[0] && t < w[1]).map((x) => x[1]);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const m = {};
  const dist = sum(inside('dist'));
  if (dist >= 0.1) m.distKm = Math.round(dist * 100) / 100;
  const sp = splits((autres.dist || []).filter(([t]) => t >= w[0] && t < w[1]));
  if (sp) m.splits = sp;
  const kcal = sum(inside('kcal'));
  if (kcal >= 1) m.kcal = Math.round(kcal);
  const puiss = inside('puiss').filter((v) => v > 0);
  if (puiss.length >= 3) m.puissance = Math.round(sum(puiss) / puiss.length);
  // Natation en piscine : distance à la nage (m) et mouvements de bras.
  const nage = sum(inside('nage'));
  if (nage >= 10) m.nageM = Math.round(nage);
  const mvt = sum(inside('mvt'));
  if (mvt >= 10) m.mvt = Math.round(mvt);
  const pas = sum(inside('pas'));
  const minutes = (w[1] - w[0]) / 60000;
  if (pas >= 50 && minutes >= 1) m.cadence = Math.round(pas / minutes);
  return Object.keys(m).length ? { ...m, v: MONTRE_V } : null;
}

// Temps de chaque kilomètre (s), d'après la distance de la montre mesure par mesure. Santé
// donne l'heure de début de chaque mesure : sa distance est répartie jusqu'à la mesure
// suivante (60 s au plus, pour ne pas l'étaler sur une pause). Dernier km entamé : sa
// distance et son temps s'il fait au moins 100 m. null s'il n'y a pas un km entier.
const SPLIT_MAX_SEC = 60;
export function splits(dist) {
  if (!dist?.length) return null;
  const km = [];
  let cum = 0;
  let lastCut = dist[0][0];
  let end = lastCut;
  dist.forEach(([t, d], i) => {
    const next = dist[i + 1]?.[0];
    const prevLen = i > 0 ? t - dist[i - 1][0] : 5000;
    end = t + Math.min(next !== undefined ? next - t : prevLen, SPLIT_MAX_SEC * 1000);
    while (d > 0 && cum + d >= km.length + 1) {
      const cut = t + ((km.length + 1 - cum) / d) * (end - t);
      km.push(Math.round((cut - lastCut) / 1000));
      lastCut = cut;
    }
    cum += d;
  });
  if (!km.length) return null;
  const rest = Math.round((cum - km.length) * 100) / 100;
  return { km, ...(rest >= 0.1 ? { fin: { km: rest, sec: Math.round((end - lastCut) / 1000) } } : {}) };
}

// Natation : la séance saisie à la main n'a pas d'heure. La montre enregistre une mesure de
// « distance à la nage » par longueur : leur plage horaire ce jour-là donne celle de la séance
// (pauses au bord comprises). Deux nages à plus de 30 min d'écart sont deux séances : on garde
// la plus longue. [début, fin] en ms, ou null.
const SWIM_GAP = 30 * 60_000;
export function swimWindow(nage, from, to) {
  const pts = (nage || []).filter(([t, v]) => t >= from && t < to && v > 0).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  const groups = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] - pts[i - 1][0] > SWIM_GAP) groups.push([]);
    groups.at(-1).push(pts[i]);
  }
  const best = groups.reduce((a, g) => (g.reduce((x, p) => x + p[1], 0) > a.reduce((x, p) => x + p[1], 0) ? g : a));
  if (best.length < 2) return null;
  // Fin : début de la dernière longueur + durée d'une longueur (écart médian, 2 min au plus).
  const gaps = best.slice(1).map((p, i) => p[0] - best[i][0]).sort((a, b) => a - b);
  const lap = Math.min(gaps[Math.floor(gaps.length / 2)], 120_000);
  return [best[0][0], best.at(-1)[0] + lap];
}

// Journée (heure du téléphone) d'une séance datée « AAAA-MM-JJ » : [début, fin] en ms.
export function dayRange(date) {
  const d = String(date || '').slice(0, 10);
  const start = new Date(`${d}T00:00:00`).getTime();
  return Number.isFinite(start) ? [start, start + 86400_000] : null;
}

// Longueurs et durée lues par la montre, reportées dans la saisie de natation sauf si la
// personne les a tapées elle-même (la montre peut rater une longueur : la saisie prime).
export function applySwim(h) {
  const m = h.montre;
  if (!h.swim || !m?.nageM) return;
  const bassin = h.swim.bassinM || 25;
  if (h.swim.longueursSource !== 'manuelle') {
    h.swim.longueurs = Math.round(m.nageM / bassin);
    h.swim.longueursSource = 'montre';
    h.distanceKm = (h.swim.longueurs * bassin) / 1000;
  }
  if (h.dureeSource !== 'manuelle' && h.fenetre) {
    h.elapsedSec = Math.max(1, Math.round((h.fenetre[1] - h.fenetre[0]) / 60000)) * 60;
    h.dureeSource = 'montre';
  }
}

export function montreLine(m) {
  if (!m) return '';
  return [
    m.distKm && `${m.distKm.toLocaleString('fr-FR')} km`,
    m.kcal && `${m.kcal} kcal`,
    m.puissance && `${m.puissance} W`,
    m.cadence && `${m.cadence} pas/min`,
    m.nageM && `${m.nageM} m nagés`,
    m.mvt && `${m.mvt} mouvements`,
  ].filter(Boolean).join(' · ');
}

// Distance retenue quand le téléphone (GPS) et la montre l'ont mesurée tous les deux : leur
// moyenne si elles concordent (moins de 5 % d'écart) et que le GPS n'a pas été coupé ; sinon
// celle de la montre (une moyenne avec une mesure fausse serait fausse aussi).
const ECART_MAX = 0.05;
export function mergeDistance(gpsKm, gpsIncomplet, montreKm) {
  if (!montreKm) return null;
  if (!gpsKm || gpsIncomplet) return { km: montreKm, source: 'montre' };
  if (Math.abs(gpsKm - montreKm) / montreKm > ECART_MAX) return { km: montreKm, source: 'montre', ecart: true };
  return { km: Math.round(((gpsKm + montreKm) / 2) * 100) / 100, source: 'moyenne' };
}

// Cardio après la séance : [[secondes après la fin, bpm], …] sur 3 min, ou null.
export function recovery(end, samples) {
  const pts = (samples || []).filter(([t]) => t > end && t <= end + RECOVERY_SEC * 1000).sort((a, b) => a[0] - b[0]).map(([t, bpm]) => [Math.round((t - end) / 1000), bpm]);
  return pts.length >= 3 ? pts : null;
}
// Bpm le plus proche de `sec` secondes après la fin (à 20 s près), ou null.
export function recoveryAt(apres, sec) {
  let best = null;
  for (const p of apres || []) if (Math.abs(p[0] - sec) <= 20 && (!best || Math.abs(p[0] - sec) < Math.abs(best[0] - sec))) best = p;
  return best ? best[1] : null;
}

// Zones de l'utilisateur : bornes hautes des zones 1 à 4 (comme l'app Forme : zone 1 < 140,
// zone 2 141–151…). Valides seulement si croissantes et plausibles.
export function zoneLimits(z) {
  const l = (z || []).map(Number);
  if (l.length !== 4 || l.some((v) => !Number.isFinite(v) || v < 60 || v > 230)) return null;
  for (let i = 1; i < 4; i++) if (l[i] <= l[i - 1]) return null;
  return l;
}
export const zoneOf = (bpm, l) => { const i = l.findIndex((v) => bpm <= v); return i < 0 ? 4 : i; };
// Temps (s) dans chaque zone, d'après le temps passé à chaque bpm.
export function zoneTimes(hist, l) {
  if (!hist || !l) return null;
  const out = [0, 0, 0, 0, 0];
  for (const [bpm, sec] of Object.entries(hist)) out[zoneOf(Number(bpm), l)] += sec;
  return out.map(Math.round);
}
