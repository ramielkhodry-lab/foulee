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

// Piste : silence et clips posés aux secondes données (événements { at, clip }, bip coupé à 1 s).
function buildTrack(events, endSec, index, pack) {
  const { frameBytes: fb, frameSeconds: fs, clips } = index;
  const nFrames = Math.round(endSec / fs);
  const out = new Uint8Array(nFrames * fb);
  const sil = pack.subarray(clips.silence.offset * fb, (clips.silence.offset + 1) * fb);
  for (let f = 0; f < nFrames; f++) out.set(sil, f * fb);
  for (const { at, clip: name, max } of events) {
    const clip = clips[name];
    const pos = Math.round(at / fs);
    if (!clip || pos < 0) continue;
    const frames = Math.max(0, Math.min(clip.frames, max ? Math.round(max / fs) : clip.frames, nFrames - pos));
    out.set(pack.subarray(clip.offset * fb, (clip.offset + frames) * fb), pos * fb);
  }
  return out;
}
const clipSec = (index, name) => (index.clips[name]?.frames || 0) * index.frameSeconds;

// Bips à −3, −2, −1 s puis le signal de reprise, à `at` secondes du début de la piste.
const goEvents = (at, bips) => [
  ...(bips ? [3, 2, 1].map((d) => ({ at: at - d, clip: 'bip', max: 1 })) : []),
  { at, clip: 'signal_course' },
];

// Piste de récup : silence, bips à −3, −2, −1 s, puis le signal de reprise.
// Jouée dès « Série faite » (dans le geste : iOS l'exige), elle sonne à l'heure même écran éteint.
// bips : forcés pour le décompte de départ (3 s), sinon seulement si la récup dure 6 s ou plus.
export function restTrack(seconds, index, pack, bips = seconds >= 6) {
  return buildTrack(goEvents(seconds, bips), seconds + clipSec(index, 'signal_course') + 0.5, index, pack);
}

// --- Minuteur des exercices en secondes (gainage) ---------------------------------
// « Lancer le minuteur » : 3 s pour se mettre en place (bips + signal de départ), puis
// un signal au minimum (« tu es dans la tranche ») et le signal de fin au maximum.
// Au maximum, la série est notée au maximum et la récup démarre seule : la piste lancée
// dans le geste contient déjà la récup, pour qu'elle sonne sans toucher au téléphone.
// La phase reste « work » (s.hold en plus) : une ancienne version qui relit la séance
// sauvegardée retombe sur l'écran de série normal.
export const HOLD_LEAD = 3;

export function startHold(s, now = Date.now()) {
  const x = currentExercise(s);
  if (!x || x.unite !== 's' || s.phase !== 'work' || s.hold) return s;
  s.hold = { start: now + HOLD_LEAD * 1000, min: x.min, max: x.max };
  return s;
}
export const holdLead = (s, now = Date.now()) => (s.hold ? Math.max(0, (s.hold.start - now) / 1000) : 0);
export const holdElapsed = (s, now = Date.now()) => (s.hold ? Math.max(0, (now - s.hold.start) / 1000) : 0);
export const isLastSet = (s) => {
  const x = currentExercise(s);
  return !x || (s.set + 1 >= x.reps.length && s.ex + 1 >= s.exercices.length);
};

export function cancelHold(s) {
  delete s.hold;
  return s;
}

// Fin du maintien : à la main (secondes tenues, au moins 1) ou au maximum (heure du maximum,
// pour que la récup tombe juste avec la piste déjà lancée).
export function stopHold(s, now = Date.now()) {
  if (!s.hold) return s;
  const { start, max } = s.hold;
  const end = Math.min(now, start + max * 1000);
  const held = now < start ? 0 : (end - start) / 1000;
  delete s.hold;
  if (held <= 0) return s; // arrêté pendant la mise en place : rien de noté
  return setDone(s, held, end);
}
export const holdOver = (s, now = Date.now()) => !!s.hold && now >= s.hold.start + s.hold.max * 1000;

// Piste du minuteur, depuis `now` : départ, minimum, maximum, puis la récup qui suit
// (rien après la dernière série). Recalculée à la reprise de l'app.
export function holdTrack(s, index, pack, now = Date.now()) {
  if (!s.hold) return null;
  const t0 = (s.hold.start - now) / 1000; // secondes avant le départ (négatif : déjà parti)
  const atMax = t0 + s.hold.max;
  const events = [];
  if (t0 > 0) events.push(...goEvents(t0, true));
  if (s.hold.min < s.hold.max) events.push({ at: t0 + s.hold.min, clip: 'signal_moitie' });
  events.push({ at: atMax, clip: 'signal_fin' });
  let end = atMax + clipSec(index, 'signal_fin') + 0.5;
  if (!isLastSet(s)) {
    const restAt = atMax + s.repos;
    events.push(...goEvents(restAt, s.repos >= 6));
    end = restAt + clipSec(index, 'signal_course') + 0.5;
  }
  return buildTrack(events.filter((e) => e.at >= 0), Math.max(0.5, end), index, pack);
}
