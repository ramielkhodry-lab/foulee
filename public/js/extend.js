// Prolonger une séance guidée en direct : « +1 répétition » pendant la marche de récupération.
//
// La récupération en cours devient la marche du palier (le temps déjà marché compte), puis
// vient une course de la durée du palier, puis une nouvelle récupération complète. Pendant
// cette nouvelle récupération, on peut recommencer, au plus MAX_EXTRA fois.
// Seulement pour les séances fractionnées : deux dernières courses de même durée séparées
// par une marche, et une récupération à la fin.

import { KINDS } from './phrases.js';

export const MAX_EXTRA = 3;
const HEADS_UP = 5; // secondes d'avance minimum avant la course, pour entendre le signal
const effort = (s) => KINDS[s.kind]?.effort;
const lastRunIdx = (steps) => steps.reduce((acc, s, i) => (effort(s) === 'course' ? i : acc), -1);

// Bloc du palier, lu sur la séance prévue (gardé ensuite dans session.rep).
export function repeatBlock(steps) {
  const last = lastRunIdx(steps);
  const recup = steps.at(-1);
  if (last < 2 || recup?.kind !== 'recuperation' || last !== steps.length - 2) return null;
  const walk = steps[last - 1];
  const prevRun = steps[last - 2];
  if (walk.kind !== 'marche' || effort(prevRun) !== 'course' || prevRun.duration !== steps[last].duration) return null;
  return { run: { ...steps[last] }, walk: { ...walk }, recup: { ...recup } };
}

// Où en est le prolongement : null si la séance ne s'y prête pas.
// from = indice de la première étape ajoutée (= la récupération prévue, devenue marche).
export function extendState(session) {
  const rep = session.rep || repeatBlock(session.steps);
  if (!rep) return null;
  const extra = session.extra || 0;
  const last = lastRunIdx(session.steps);
  const plannedLast = last - 2 * extra;
  return { ...rep, extra, last, plannedLast, from: plannedLast + 1, recupIdx: session.steps.length - 1, left: MAX_EXTRA - extra };
}

// Le bouton est proposé pendant la récupération (la prévue ou celle d'après un ajout).
export function canExtend(session, i) {
  const st = extendState(session);
  return Boolean(st && st.left > 0 && i === st.recupIdx);
}

// i = étape en cours (la récupération), offset = secondes déjà passées dedans.
export function extend(session, i, offset = 0) {
  if (!canExtend(session, i)) return session;
  const st = extendState(session);
  const walk = Math.max(st.walk.duration, Math.ceil(offset) + HEADS_UP);
  const steps = [...session.steps.slice(0, i), { kind: 'marche', duration: walk }, { ...st.run }, { ...st.recup }];
  return { ...session, steps, extra: st.extra + 1, rep: { run: st.run, walk: st.walk, recup: st.recup } };
}

// Annuler la dernière répétition ajoutée : tant que sa course n'a pas commencé.
// La marche redevient la récupération, au même point.
export function canRetract(session, i) {
  const st = extendState(session);
  return Boolean(st && st.extra > 0 && i === st.last - 1);
}

export function retract(session, i) {
  if (!canRetract(session, i)) return session;
  const st = extendState(session);
  const steps = [...session.steps.slice(0, st.last - 1), { ...st.recup }];
  return { ...session, steps, extra: st.extra - 1 };
}

// Pour le bilan : prévu contre réalisé. completed = nombre d'étapes terminées.
export function extraSummary(session, completed) {
  const st = extendState(session);
  if (!st || !st.extra) return null;
  const runsBefore = session.steps.slice(0, st.from).filter((s) => effort(s) === 'course').length;
  let done = 0;
  for (let k = 0; k < st.extra; k++) if (completed > st.from + 2 * k + 1) done++;
  return { extra: st.extra, extraFaites: done, extraFrom: st.from, repsPrevues: runsBefore };
}

// Séance guidée non finie. Avec des répétitions ajoutées, la séance prévue est finie dès la
// fin de la dernière course prévue : s'arrêter pendant un ajout ou la récupération n'est pas un abandon.
export function unfinished(h) {
  if (!h.steps || h.completedSteps === undefined) return false;
  return h.completedSteps < (h.extra ? h.extraFrom : h.steps.length);
}
