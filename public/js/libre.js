// Test « 5 courses au max » : 5 blocs de course, chacun aussi long que possible, et 2 min de
// marche après chaque arrêt. Le coureur dit lui-même quand il s'arrête (« Je marche ») et peut
// repartir avant la fin des 2 min (« Je recours »).
//
// Même moteur que les autres courses (une seule piste audio, gravée d'avance) : à chaque appui,
// l'étape en cours est coupée à l'instant présent et la suite est regravée. La course en cours
// est une étape « ouverte » (OPEN s, rallongée tant que le coureur n'a pas dit stop).
// Les étapes marquées `libre` n'ont pas les 3 bips de fin : leur fin n'est pas connue d'avance.
//
// Hors programme : enregistrée comme une course (carte, distance, allure), sans palier
// (level null), donc ignorée par nextRunLevel. Elle sert d'indicateur.

import { kmBetween, accBetween } from './gps.js';
import { KINDS } from './phrases.js';

export const LIBRE_ID = 'libre-5-blocs';
export const BLOCS = 5;
export const MARCHE = 120; // 2 min de marche après chaque arrêt, toujours
export const OPEN = 1200; // durée provisoire d'un bloc de course, rallongée au besoin
export const WARMUP = 300;
export const RECUP = 300; // 5 min de marche de retour au calme après le 5e bloc
const MAX_STEP = 4 * 3600;
const RALLONGE_SOUS = 300; // s restantes sur l'étape ouverte : on rallonge

const openRun = () => ({ kind: 'course', duration: OPEN, libre: true, ouvert: true });

// Test sans nombre de blocs fixé (depuis le 23/11) : marche de début et de fin au choix
// (minutes, 0 = aucune), autant de blocs que le coureur veut, jusqu'à « Terminer ».
// Anciennes séances sauvegardées (blocs: 5, sans illimite) : comportement d'avant inchangé.
export const TEST_DEFAUT = { echauf: 5, fin: 5 };
export function testCfg(saved) {
  const c = { ...TEST_DEFAUT, ...(saved || {}) };
  const b = (v) => Math.min(30, Math.max(0, Math.round(Number(v) || 0)));
  return { echauf: b(c.echauf), fin: b(c.fin) };
}

export function libreSession(cfg) {
  const c = testCfg(cfg);
  return {
    id: LIBRE_ID,
    libre: true,
    illimite: true,
    finSec: c.fin * 60,
    marches: c, // pas « test » : session.test marque la séance de vérification des signaux
    name: 'Test : courses au max',
    steps: [...(c.echauf ? [{ kind: 'echauffement', duration: c.echauf * 60 }] : []), openRun()],
  };
}

const recupSec = (session) => (session.illimite ? session.finSec : RECUP);

export const isLibre = (s) => Boolean(s?.libre);

// « Bloc 3/5 » pour l'ancien test, « Bloc 3 » sans nombre fixé.
export const blocLabel = (st) => (Number.isFinite(st.blocs) ? `${st.bloc}/${st.blocs}` : `${st.bloc}`);

// Numéro du bloc de course (1 à 5) à l'étape i : blocs commencés jusque-là.
const runsUpTo = (steps, i) => steps.slice(0, i + 1).filter((s) => s.kind === 'course').length;

// Où on en est : phase, numéro du bloc (en cours, ou à venir pendant une marche) et bouton.
export function libreState(session, i) {
  const steps = session.steps;
  const blocs = session.illimite ? Infinity : session.blocs || BLOCS;
  if (i < 0) return { phase: 'intro', bloc: 1, blocs, action: null };
  if (i >= steps.length) return { phase: 'fin', bloc: blocs, blocs, action: null };
  const s = steps[i];
  if (s.kind === 'echauffement') return { phase: 'echauffement', bloc: 1, blocs, action: 'Je commence à courir' };
  const n = runsUpTo(steps, i);
  if (s.kind === 'recuperation') return { phase: 'recup', bloc: blocs, blocs, action: 'C\'est fini' }; // écourte et va au bilan
  if (s.kind === 'course') return { phase: 'course', bloc: n, blocs, action: n < blocs ? 'Je marche' : 'J\'arrête : dernier bloc fini' };
  return { phase: 'marche', bloc: n + 1, blocs, action: 'Je recours' };
}

// Coupe l'étape i à `offset` secondes (un peu plus, pour que le signal suivant soit entendu).
const cutAt = (offset) => Math.max(5, Math.ceil(offset + 0.6));

// Appui sur le bouton à l'étape i, `offset` secondes après son début : nouvelle séance.
export function libreAction(session, i, offset) {
  const st = libreState(session, i);
  if (!st.action) return session;
  const steps = session.steps.slice(0, i);
  const { ouvert, ...cut } = session.steps[i];
  steps.push({ ...cut, duration: cutAt(offset), libre: true });
  if (st.phase === 'course') {
    if (st.bloc < st.blocs) steps.push({ kind: 'marche', duration: MARCHE }, openRun());
    else steps.push({ kind: 'recuperation', duration: RECUP }); // ancien test à 5 blocs : retour au calme, puis signal de fin
  } else if (st.phase === 'recup') {
    // Retour au calme écourté : la séance s'arrête ici (signal de fin).
  } else {
    steps.push(openRun()); // fin d'échauffement ou reprise avant les 2 min
  }
  return { ...session, steps };
}

// Bloc ouvert bientôt fini (le coureur court toujours) : on le rallonge. null si rien à faire.
export function libreRallonge(session, i, offset) {
  const s = session.steps[i];
  if (!s || !s.ouvert || i !== session.steps.length - 1) return null; // un bloc coupé ne se rallonge jamais
  if (s.duration - offset > RALLONGE_SOUS || s.duration + OPEN > MAX_STEP) return null;
  const steps = [...session.steps];
  steps[i] = { ...s, duration: s.duration + OPEN };
  return { ...session, steps };
}

// Pour le bilan : les étapes réellement faites, la dernière coupée à l'arrêt (`reached`, en
// secondes de piste ; starts = début de chaque étape dans la piste).
export function libreDone(steps, starts, reached) {
  const out = [];
  for (let k = 0; k < steps.length; k++) {
    if (reached <= starts[k]) break;
    const d = Math.min(steps[k].duration, Math.round(reached - starts[k]));
    if (d > 0) { const { ouvert, ...x } = steps[k]; out.push({ ...x, duration: d }); }
  }
  return out;
}

// Blocs de course : durée (s), distance (km, null sans GPS) et précision moyenne du GPS (m,
// si connue). stepMs = heure de début de chaque étape puis heure de fin (cardio.stepTimes).
// raw = points mesurés en direct, avec leur précision.
export function libreBlocs(steps, stepMs, points, raw = []) {
  const out = [];
  steps.forEach((s, k) => {
    if (s.kind !== 'course') return;
    const a = stepMs?.[k];
    const b = stepMs?.[k + 1];
    const ok = Number.isFinite(a) && Number.isFinite(b);
    const km = points?.length && ok ? kmBetween(points, a, b) : 0;
    const acc = ok ? accBetween(raw, a, b) : null;
    out.push({ sec: s.duration, km: km > 0 ? km : null, ...(acc ? { accM: acc } : {}) });
  });
  return out;
}

// Toute course guidée : distance parcourue en courant seulement (marche exclue), d'après le
// GPS. null si on ne connaît pas l'heure des étapes.
export function enCourse(steps, stepMs, points, raw = []) {
  if (!stepMs?.length) return null;
  let km = 0;
  let sec = 0;
  const accs = [];
  steps.forEach((s, k) => {
    if (KINDS[s.kind]?.effort !== 'course') return;
    const a = stepMs[k];
    const b = stepMs[k + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
    sec += (b - a) / 1000;
    if (points?.length) km += kmBetween(points, a, b);
    const acc = accBetween(raw, a, b);
    if (acc) accs.push(acc);
  });
  if (!sec) return null;
  return { km: Math.round(km * 100) / 100 || null, sec: Math.round(sec), ...(accs.length ? { accM: Math.round(accs.reduce((x, y) => x + y, 0) / accs.length) } : {}) };
}

// Précision du GPS jugée mauvaise au-delà (m, moyenne des points retenus).
export const GPS_FLOU = 15;

// Résumé : plus longue course continue (et son bloc), nombre de pauses marchées entre les blocs.
export function libreResume(h) {
  const b = h?.blocs || [];
  if (!b.length) return null;
  let best = 0;
  b.forEach((x, k) => { if (x.sec > b[best].sec) best = k; });
  const course = b.reduce((a, x) => a + x.sec, 0);
  return { plusLongue: b[best].sec, blocMax: best + 1, pauses: Math.max(0, b.length - 1), courseSec: course, n: b.length };
}

// Détail segment par segment, dans l'ordre : échauffement, course 1, marche 1, course 2…,
// retour au calme, puis la marche faite après la fin du programme (jusqu'à « Terminer »).
// Chaque segment : type, numéro (course n, et la marche qui la suit), durée (s), distance
// (km, GPS) et précision moyenne (m) si connue. null sans heure des étapes.
export function libreSegments(steps, stepMs, points, raw = [], finMs = null) {
  if (!stepMs?.length) return null;
  const out = [];
  let n = 0;
  steps.forEach((s, k) => {
    const a = stepMs[k];
    const b = stepMs[k + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (s.kind === 'course') n++;
    const acc = accBetween(raw, a, b);
    out.push({ kind: s.kind, ...(s.kind === 'course' || s.kind === 'marche' ? { n } : {}), sec: s.duration, km: points?.length ? kmBetween(points, a, b) : 0, ...(acc ? { accM: acc } : {}) });
  });
  const end = stepMs[steps.length];
  if (Number.isFinite(end) && finMs && finMs - end >= 5000) {
    const acc = accBetween(raw, end, finMs);
    out.push({ kind: 'plus', sec: Math.round((finMs - end) / 1000), km: points?.length ? kmBetween(points, end, finMs) : 0, ...(acc ? { accM: acc } : {}) });
  }
  return out;
}

// Totaux des segments : en courant, en marchant (échauffement, marches, retour au calme et
// marche en plus), et la séance entière.
export function segmentTotals(segs) {
  const r = (x) => Math.round(x * 100) / 100;
  let course = 0;
  let marche = 0;
  for (const g of segs || []) if (g.kind === 'course') course += g.km || 0; else marche += g.km || 0;
  return { course: r(course), marche: r(marche), seance: r(course + marche) };
}

// « Terminer » avant la fin : l'étape en cours s'arrête maintenant et la marche de fin (5 min
// pour l'ancien test, celle choisie sinon) commence. null aussi sans marche de fin. null si le retour au calme est déjà commencé (ou fini).
export function libreFinir(session, i, offset) {
  const st = libreState(session, i);
  if (!['echauffement', 'course', 'marche'].includes(st.phase) || !recupSec(session)) return null;
  const { ouvert, ...cut } = session.steps[i];
  return { ...session, steps: [...session.steps.slice(0, i), { ...cut, duration: cutAt(offset), libre: true }, { kind: 'recuperation', duration: recupSec(session) }] };
}
