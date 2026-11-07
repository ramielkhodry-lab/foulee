// Séance de musculation guidée : exercice affiché, « Série faite » lance la récup,
// signal à la fin de la récup, puis série ou exercice suivant. Heure de début et de fin
// mesurées : la durée de la séance n'est plus à saisir.
// Tout est dans un objet simple (sérialisable) : la séance survit à une fermeture de l'app.

const MIN_REST = 5;   // s : la récup ne descend jamais sous 5 s avec « −15 s »
const MAX_REST = 600; // s

// exercices : ceux de muscuLog (reps = tableau de null, une case par série).
export function createGuided({ seance, sessionName, exercices, repos }, now = Date.now()) {
  return {
    seance, sessionName, repos,
    exercices: exercices.map((x) => ({ ...x, reps: x.reps.map(() => null) })),
    startedAt: now, endedAt: null,
    ex: 0, set: 0, phase: exercices.length ? 'work' : 'done',
    restEnd: null, restTotal: 0,
  };
}

// Décompte avant la première série (« 3, 2, 1 ») : la séance, donc la durée mesurée,
// commence à la fin du décompte.
export function startCountdown(s, seconds = 3, now = Date.now()) {
  if (s.phase !== 'work' || s.ex || s.set || s.exercices.some((x) => x.reps.some((r) => r > 0))) return s;
  s.phase = 'countdown';
  s.countEnd = now + seconds * 1000;
  s.startedAt = s.countEnd;
  return s;
}
export const countLeft = (s, now = Date.now()) => (s.phase === 'countdown' ? Math.max(0, (s.countEnd - now) / 1000) : 0);
export function endCountdown(s) {
  if (s.phase === 'countdown') { s.phase = 'work'; s.countEnd = null; }
  return s;
}

// Autre exercice du même muscle à la place de l'exercice en cours, tant qu'aucune série n'est faite.
export function swapExercise(s, ex) {
  const x = currentExercise(s);
  if (!x || s.phase !== 'work' || x.reps.some((r) => r > 0)) return s;
  s.exercices[s.ex] = { ...x, ...ex, reps: x.reps.map(() => null) };
  return s;
}

export const currentExercise = (s) => s.exercices[s.ex] || null;

// Répétitions proposées pour la série en cours : celles de la série d'avant, sinon le haut de l'objectif.
export function suggestedReps(s) {
  const x = currentExercise(s);
  if (!x) return 0;
  const prev = x.reps.slice(0, s.set).filter((r) => r > 0).at(-1);
  return prev || x.max;
}

// Position suivante, sans les exercices déjà finis.
function advance(s) {
  const x = currentExercise(s);
  if (x && s.set + 1 < x.reps.length) { s.set += 1; return true; }
  if (s.ex + 1 < s.exercices.length) { s.ex += 1; s.set = 0; return true; }
  return false;
}

// Série faite avec `reps` répétitions (ou secondes) : récup, sauf après la toute dernière série.
export function setDone(s, reps, now = Date.now()) {
  const x = currentExercise(s);
  if (!x || s.phase !== 'work') return s;
  x.reps[s.set] = Math.max(1, Math.round(Number(reps) || 0));
  if (!advance(s)) return finish(s, now);
  s.phase = 'rest';
  s.restTotal = s.repos;
  s.restEnd = now + s.repos * 1000;
  return s;
}

// Passe le reste de cet exercice (séries non faites = vides), sans récup.
export function skipExercise(s, now = Date.now()) {
  if (s.ex + 1 >= s.exercices.length) return finish(s, now);
  s.ex += 1; s.set = 0; s.phase = 'work'; s.restEnd = null;
  return s;
}

export const restLeft = (s, now = Date.now()) => (s.phase === 'rest' ? Math.max(0, (s.restEnd - now) / 1000) : 0);

// ±15 s pendant la récup.
export function adjustRest(s, delta, now = Date.now()) {
  if (s.phase !== 'rest') return s;
  const left = Math.min(MAX_REST, Math.max(MIN_REST, restLeft(s, now) + delta));
  s.restTotal = Math.max(s.restTotal, left);
  s.restEnd = now + left * 1000;
  return s;
}

export function endRest(s) {
  if (s.phase === 'rest') { s.phase = 'work'; s.restEnd = null; }
  return s;
}

export function finish(s, now = Date.now()) {
  s.phase = 'done';
  s.restEnd = null;
  s.endedAt = s.endedAt || now;
  return s;
}

export const elapsedSec = (s, now = Date.now()) => Math.max(0, Math.round(((s.endedAt || now) - s.startedAt) / 1000));
export const setsDone = (s) => s.exercices.reduce((a, x) => a + x.reps.filter((r) => r > 0).length, 0);
export const setsTotal = (s) => s.exercices.reduce((a, x) => a + x.reps.length, 0);

// Piste de récup : silence, bips à −3, −2, −1 s, puis le signal de reprise.
// Jouée dès « Série faite » (dans le geste : iOS l'exige), elle sonne à l'heure même écran éteint.
// bips : forcés pour le décompte de départ (3 s), sinon seulement si la récup dure 6 s ou plus.
export function restTrack(seconds, index, pack, bips = seconds >= 6) {
  const { frameBytes: fb, frameSeconds: fs, clips } = index;
  const go = clips.signal_course;
  const startGo = Math.round(seconds / fs);
  const nFrames = startGo + go.frames + Math.round(0.5 / fs);
  const out = new Uint8Array(nFrames * fb);
  const sil = pack.subarray(clips.silence.offset * fb, (clips.silence.offset + 1) * fb);
  for (let f = 0; f < nFrames; f++) out.set(sil, f * fb);
  const put = (clip, at, max) => {
    const frames = Math.max(0, Math.min(clip.frames, max, nFrames - at));
    if (at >= 0) out.set(pack.subarray(clip.offset * fb, (clip.offset + frames) * fb), at * fb);
  };
  if (bips) for (const d of [3, 2, 1]) put(clips.bip, Math.round((seconds - d) / fs), Math.round(1 / fs));
  put(go, startGo, go.frames);
  return out;
}
