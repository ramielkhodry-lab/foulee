// Construit la piste audio unique d'une séance guidée.
//
// iOS suspend le JavaScript d'une webapp quand l'écran est verrouillé, mais laisse
// jouer un fichier audio. Toute la séance (annonces, bips, silences) est donc gravée
// dans un seul MP3 : le minutage ne dépend d'aucun minuteur.

import { KINDS, startClipId, preClipId } from './phrases.js';

export const LEAD_IN = 7; // secondes d'introduction avant la première étape
const PRE_ANNOUNCE = 10; // pré-annonce « dans dix secondes »
const MIN_STEP_FOR_PRE = 25; // en dessous, pas de pré-annonce (elle couvrirait l'annonce de départ)
const TAIL = 8; // secondes après la fin, pour le message final

// Étapes → début de chaque étape (secondes depuis le début de la piste).
export function stepStarts(steps) {
  const starts = [];
  let t = LEAD_IN;
  for (const s of steps) {
    starts.push(t);
    t += s.duration;
  }
  return { starts, end: t };
}

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('Séance vide');
  for (const s of steps) {
    if (!KINDS[s.kind]) throw new Error(`Type d'étape inconnu : ${s.kind}`);
    if (!Number.isInteger(s.duration) || s.duration < 10 || s.duration > 4 * 3600) {
      throw new Error(`Durée invalide : ${s.duration}`);
    }
  }
}

// Liste des sons à jouer : [{ at: secondes, clip: id }], triée.
export function buildEvents(steps) {
  validateSteps(steps);
  const { starts, end } = stepStarts(steps);
  const events = [{ at: 0.3, clip: 'intro' }];
  steps.forEach((s, i) => {
    events.push({ at: starts[i], clip: 'bip_long' });
    events.push({ at: starts[i] + 0.7, clip: startClipId(s.kind, s.duration) });
    const next = steps[i + 1];
    const stepEnd = starts[i] + s.duration;
    if (next && s.duration >= MIN_STEP_FOR_PRE) events.push({ at: stepEnd - PRE_ANNOUNCE, clip: preClipId(next.kind) });
    if (s.duration >= 15) for (const d of [3, 2, 1]) events.push({ at: stepEnd - d, clip: 'bip' });
  });
  events.push({ at: end, clip: 'bip_long' });
  events.push({ at: end + 0.7, clip: 'end' });
  return { events: events.sort((a, b) => a.at - b.at), starts, end, total: end + TAIL };
}

// Assemble le MP3. `index` et `pack` viennent de public/audio (index.json, pack.mp3).
// Un clip qui déborderait sur le suivant est tronqué : le son suivant reste à l'heure.
export function assemble(steps, index, pack) {
  const { frameBytes: fb, frameSeconds: fs, clips } = index;
  const { events, starts, end, total } = buildEvents(steps);
  const nFrames = Math.ceil(total / fs);
  const out = new Uint8Array(nFrames * fb);
  const sil = clips.silence;
  const silFrame = pack.subarray(sil.offset * fb, (sil.offset + 1) * fb);
  for (let f = 0; f < nFrames; f++) out.set(silFrame, f * fb);

  const placed = events.map((e, i) => {
    const clip = clips[e.clip];
    if (!clip) throw new Error(`Clip manquant : ${e.clip}`);
    const at = Math.round(e.at / fs);
    const nextAt = i + 1 < events.length ? Math.round(events[i + 1].at / fs) : nFrames;
    const frames = Math.max(0, Math.min(clip.frames, nextAt - at, nFrames - at));
    out.set(pack.subarray(clip.offset * fb, (clip.offset + frames) * fb), at * fb);
    return { ...e, frame: at, frames, truncated: frames < clip.frames };
  });
  return { bytes: out, events: placed, starts, end, total: nFrames * fs };
}

// Étape en cours à l'instant t (secondes de piste) : -1 = introduction, steps.length = fin.
export function stepAt(starts, end, t) {
  if (t < starts[0]) return -1;
  if (t >= end) return starts.length;
  let i = 0;
  while (i + 1 < starts.length && t >= starts[i + 1]) i++;
  return i;
}
