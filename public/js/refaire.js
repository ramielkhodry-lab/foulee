// Refaire une séance déjà faite : la même course (mêmes étapes) ou la même muscu (mêmes
// exercices, objectifs du jour). La nouvelle séance garde l'id de l'ancienne dans `refaite`.
// Natation et autres activités : pas de séance guidée à relancer.

import { levelSteps, runLevel, LEVELS } from './plan.js';
import { byId, nextLoad } from './muscu.js';

// Course : les étapes faites ce jour-là. Répétitions ajoutées en direct : seules les
// répétitions finies sont gardées, suivies de la récupération.
export function replayRun(h) {
  if (!h || (h.sport || 'course') !== 'course') return null;
  const level = runLevel(h);
  let steps = null;
  if (Array.isArray(h.steps) && h.steps.length) {
    steps = h.steps;
    if (h.extra && Number.isInteger(h.extraFrom)) {
      const keep = h.extraFrom + 2 * (h.extraFaites || 0);
      steps = [...h.steps.slice(0, keep), h.steps.at(-1)];
    }
  } else if (level && LEVELS[level - 1]) {
    steps = levelSteps(level); // course notée à la main : son déroulé reconnu
  }
  if (!steps) return null;
  return {
    steps: steps.map((s) => ({ kind: s.kind, duration: s.duration })),
    level: level || null,
    name: h.sessionName || (level ? `Palier ${level} · ${LEVELS[level - 1].label}` : 'Course'),
  };
}

// Muscu : mêmes exercices, même nombre de séries ; charge et objectif recalculés comme
// pour toute séance (double progression).
export function replayMuscu(h, history, goal) {
  if (!h || h.sport !== 'muscu' || !h.exercices?.length) return null;
  const exercices = h.exercices.map((x, i) => {
    const ex = byId(x.id);
    if (!ex) return null;
    return { slot: x.slot ?? i, ...ex, series: x.reps?.length || 3, ...nextLoad(ex, history, goal) };
  }).filter(Boolean);
  if (!exercices.length) return null;
  return { seance: h.seance || null, title: h.sessionName || 'Musculation', exercices, repos: goal.repos, refaite: h.id };
}

export const canReplay = (h) => Boolean(replayRun(h) || (h?.sport === 'muscu' && h.exercices?.some((x) => byId(x.id))));
