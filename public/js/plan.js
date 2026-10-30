// Programme d'entraînement : calculé à partir de l'historique, jamais stocké.
// L'historique n'est donc jamais réécrit, et une séance manquée décale
// simplement la suite. Les règles sont volontairement simples et explicables.

import { muscuPlan, nextSeance, followingSeance } from './muscu.js';
import { tipsOf, tipsSource, breathingIssue, conseils } from './conseils.js';

// Le programme se calcule à la volée sur cet horizon (12 semaines) : il n'a pas de fin,
// la fenêtre avance avec les jours.
export const HORIZON = 84;

const W = (min) => ({ kind: 'marche', duration: min * 60 });
const R = (min) => ({ kind: 'course_lente', duration: min * 60 });
const rep = (n, run, walk) => Array.from({ length: n }, (_, i) => (i < n - 1 || walk === 0 ? [R(run), W(walk)] : [R(run)])).flat().filter((s) => s.duration > 0);

// Paliers marche/course jusqu'à 30 min en continu (palier 12), puis course continue
// jusqu'à 1 h (palier 18) pour qui prépare un 10 km.
export const LEVELS = [
  { id: 1, label: '7 × (2 min course + 2 min marche)', main: rep(7, 2, 2) },
  { id: 2, label: '6 × (3 min course + 2 min marche)', main: rep(6, 3, 2) },
  { id: 3, label: '5 × (4 min course + 2 min marche)', main: rep(5, 4, 2) },
  { id: 4, label: '4 × (5 min course + 2 min marche)', main: rep(4, 5, 2) },
  { id: 5, label: '3 × (7 min course + 2 min marche)', main: rep(3, 7, 2) },
  { id: 6, label: '3 × (8 min course + 1 min 30 marche)', main: [R(8), { kind: 'marche', duration: 90 }, R(8), { kind: 'marche', duration: 90 }, R(8)] },
  { id: 7, label: '2 × (10 min course + 2 min marche)', main: rep(2, 10, 2) },
  { id: 8, label: '2 × (12 min course + 2 min marche)', main: rep(2, 12, 2) },
  { id: 9, label: '15 min course, 2 min marche, 10 min course', main: [R(15), W(2), R(10)] },
  { id: 10, label: '20 min de course continue', main: [R(20)] },
  { id: 11, label: '25 min de course continue', main: [R(25)] },
  { id: 12, label: '30 min de course continue', main: [R(30)] },
  { id: 13, label: '35 min de course continue', main: [R(35)] },
  { id: 14, label: '40 min de course continue', main: [R(40)] },
  { id: 15, label: '45 min de course continue', main: [R(45)] },
  { id: 16, label: '50 min de course continue', main: [R(50)] },
  { id: 17, label: '55 min de course continue', main: [R(55)] },
  { id: 18, label: '1 h de course continue', main: [R(60)] },
];

// Réponses du questionnaire de chaque profil (profile.questionnaire). Seules les
// réponses qui changent le programme sont demandées.
export const GOALS_RUN = {
  '30min': { max: 12, label: 'Courir 30 min sans m’arrêter' },
  '5km': { max: 14, label: 'Courir 5 km', detail: 'jusqu’à 40 min de course continue' },
  '10km': { max: 18, label: 'Préparer un 10 km', detail: 'jusqu’à 1 h de course continue' },
};
export const START_RUN = [
  { level: 1, label: 'Je ne cours pas encore, ou 1 à 2 min' },
  { level: 2, label: 'Environ 3 min' },
  { level: 4, label: 'Environ 5 min' },
  { level: 7, label: 'Environ 10 min' },
  { level: 10, label: 'Environ 20 min' },
  { level: 12, label: '30 min ou plus' },
];
export const GOALS_SWIM = [500, 1000, 1500, 2000]; // mètres par séance
export const START_SWIM = [
  { longueurs: 8, label: 'Moins de 10 longueurs' },
  { longueurs: 16, label: '10 à 20 longueurs' },
  { longueurs: 24, label: '20 à 30 longueurs' },
  { longueurs: 32, label: 'Plus de 30 longueurs' },
];
export const SPORTS = ['course', 'natation', 'muscu'];
// Sans questionnaire : le programme d'origine, course + natation.
const DEFAULT_SPORTS = ['course', 'natation'];

// Options du programme tirées du questionnaire. Sans questionnaire : réglages d'origine
// (course + natation, palier 12 maximum, 16 longueurs pour commencer, 60 au plus).
export function planOptions(q, settings = {}) {
  const sports = q?.sports?.length ? q.sports : DEFAULT_SPORTS;
  const bassin = q?.bassin || 25;
  return {
    sports,
    maxLevel: GOALS_RUN[q?.objectifCourse]?.max ?? 12,
    startLevel: q?.niveauCourse || 1,
    startNote: q?.niveauCourse ? 'D’après ton questionnaire' : null,
    bassin,
    startLongueurs: q?.niveauNatation || 16,
    maxLongueurs: q?.objectifNatation ? Math.max(4, Math.round(q.objectifNatation / bassin)) : 60,
    joursCourse: sports.includes('course') ? (q?.joursCourse ?? settings.joursCourse ?? [1, 5]) : [],
    joursNatation: sports.includes('natation') ? (q?.joursNatation ?? settings.joursNatation ?? [3]) : [],
    joursMuscu: sports.includes('muscu') ? (q?.joursMuscu ?? []) : [],
  };
}

export function levelSteps(levelId) {
  const lvl = LEVELS[Math.min(Math.max(levelId, 1), LEVELS.length) - 1];
  return [{ kind: 'echauffement', duration: 300 }, ...lvl.main, { kind: 'recuperation', duration: 300 }];
}

const dateOnly = (d) => String(d).slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
};
const weekday = (iso) => new Date(`${iso}T12:00:00`).getDay(); // 0 = dimanche
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const hasPain = (h) => Boolean(h.douleur && h.douleur.trim());

// Palier de la prochaine course et la raison, à partir des courses passées.
// - difficulté 5 ou douleur : on redescend d'un palier ;
// - difficulté 4 : on refait le même ;
// - difficulté 1-2 : on monte ;
// - difficulté 3 ou non notée : on monte après deux séances réussies au même palier.
// Palier d'une course : enregistré par l'app, ou déduit d'un déroulé saisi à la main
// comme « 6 × (3 min course + 2 min marche) ».
export function runLevel(h) {
  if (h.level) return h.level;
  const m = /(\d+)\s*[×x]\s*\(\s*(\d+)\s*min\s*(?:de\s*)?course/i.exec(h.structure || h.sessionName || '');
  if (!m) return null;
  const found = LEVELS.find((l) => l.label.startsWith(`${m[1]} × (${m[2]} min course`));
  return found ? found.id : null;
}

export function nextRunLevel(history, opts = {}) {
  const max = opts.maxLevel ?? 12;
  const start = Math.min(max, opts.startLevel ?? 1);
  const runs = history
    .map((h) => ((h.sport || 'course') === 'course' && !h.level && runLevel(h) ? { ...h, level: runLevel(h) } : h))
    .filter((h) => (h.sport || 'course') === 'course' && h.level)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (runs.length === 0) {
    if (start > 1) return { level: start, reason: `${opts.startNote || 'Point de départ'} : ${LEVELS[start - 1].label}.` };
    return { level: 1, reason: 'Premier palier : alterner 2 min de course et 2 min de marche.' };
  }
  const last = runs.at(-1);
  const incomplete = last.steps && last.completedSteps !== undefined && last.completedSteps < last.steps.length;
  if (hasPain(last) || last.difficulte === 5) {
    return { level: Math.min(max, Math.max(1, last.level - 1)), reason: `Ta dernière course était ${hasPain(last) ? 'douloureuse' : 'très dure'} : on redescend d'un palier.` };
  }
  if (last.difficulte === 4 || incomplete) {
    return { level: Math.min(max, last.level), reason: incomplete ? "Tu n'as pas fini la dernière séance : on refait le même palier." : 'Dernière course dure : on consolide le même palier.' };
  }
  if (last.essoufflement === 5 || last.fatigue === 5) {
    return { level: Math.min(max, last.level), reason: `Tu étais ${last.fatigue === 5 ? 'épuisé' : 'à bout de souffle'} : on consolide le même palier.` };
  }
  if (last.difficulte && last.difficulte <= 2) {
    if (last.level >= max) return { level: max, reason: 'Objectif atteint : on garde ce palier.' };
    return { level: Math.min(max, last.level + 1), reason: 'Dernière course facile : on passe au palier suivant.' };
  }
  const sameLevel = [];
  for (let i = runs.length - 1; i >= 0 && runs[i].level === last.level; i--) sameLevel.push(runs[i]);
  if (last.level >= max) return { level: max, reason: 'Objectif atteint : on garde ce palier.' };
  if (sameLevel.length >= 2) {
    return { level: Math.min(max, last.level + 1), reason: 'Deux séances réussies à ce palier : on passe au suivant.' };
  }
  return {
    level: Math.min(max, last.level),
    reason: last.difficulte ? 'Séance correcte : on la refait une fois pour la consolider.' : "Tu n'as pas noté la difficulté : on consolide ce palier une fois avant de monter.",
  };
}

// Natation : +2 longueurs par rapport à la dernière séance (environ +10 %), plafonné
// par l'objectif (60 longueurs sans questionnaire).
// - douleur ou difficulté 5 : 2 longueurs de moins ;
// - difficulté 4, ou essoufflement et fatigue à 4 ou plus : même volume ;
// - sinon : +2 longueurs.
export function nextSwim(history, opts = {}) {
  const cap = opts.maxLongueurs ?? 60;
  const swims = history.filter((h) => h.sport === 'natation' && h.swim?.longueurs).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = swims.at(-1);
  const bassin = last?.swim.bassinM || opts.bassin || 25;
  if (!last) {
    const n = Math.min(cap, opts.startLongueurs ?? 16);
    return { longueurs: n, bassin, reason: `Première séance : ${n} longueurs, à ton rythme, avec des pauses.` };
  }
  const n = last.swim.longueurs;
  if (hasPain(last) || last.difficulte === 5) {
    const longueurs = Math.min(cap, Math.max(4, n - 2));
    return { longueurs, bassin, reason: `Dernière séance ${hasPain(last) ? 'douloureuse' : 'très dure'} (${n} longueurs) : on redescend à ${longueurs}.` };
  }
  if (last.difficulte === 4 || ((last.essoufflement || 0) >= 4 && (last.fatigue || 0) >= 4)) {
    return { longueurs: Math.min(cap, n), bassin, reason: `Dernière séance dure (${n} longueurs) : on garde ${Math.min(cap, n)} longueurs, avec plus de pauses.` };
  }
  if (n >= cap) return { longueurs: cap, bassin, reason: `Objectif atteint : ${cap} longueurs, on garde ce volume.` };
  const longueurs = Math.min(cap, n + 2);
  return { longueurs, bassin, reason: `Dernière fois ${n} longueurs : on ajoute 2 longueurs.` };
}

// focus 'respiration' : la gêne notée au dernier bilan remplace le premier bloc par un éducatif.
function swimPlan(longueurs, focus = null) {
  const echauf = 4;
  const retour = 2;
  const educ = focus === 'respiration' && longueurs >= 14 ? 4 : 0;
  const corps = Math.max(0, longueurs - echauf - retour - educ);
  const blocs = Math.floor(corps / 4);
  const reste = corps - blocs * 4;
  return [
    `Échauffement : ${echauf} longueurs tranquilles (brasse ou dos).`,
    educ ? `Respiration : ${educ} longueurs de crawl lent. Souffle toutes tes bulles sous l’eau, tourne la tête pour inspirer tous les 2 mouvements de bras ; arrête-toi au bord dès que tu bois la tasse.` : '',
    blocs ? `${blocs} bloc${blocs > 1 ? 's' : ''} de 4 longueurs : 1 crawl + 1 brasse + 1 crawl + 1 dos, 30 s de pause entre les blocs.` : '',
    reste ? `${reste} longueur${reste > 1 ? 's' : ''} de brasse.` : '',
    `Retour au calme : ${retour} longueurs de dos.`,
    'En crawl : souffle dans l’eau par le nez et la bouche, tourne la tête pour inspirer, sans relever le front.',
  ].filter(Boolean);
}

// Autre activité faite à la place d'une séance prévue (sport 'autre', champ `remplace`) :
// la séance n'est ni sautée ni rattrapée en double. Elle passe au premier jour libre
// précédé d'un jour sans effort, sauf si le jour habituel de ce sport arrive avant : la séance
// prévue ce jour-là la remplace, au même niveau. Un report non fait à sa date est abandonné.
export function reports(history, opts, from) {
  const jours = { course: opts.joursCourse, natation: opts.joursNatation, muscu: opts.joursMuscu };
  const sportAt = (date) => SPORTS.find((sp) => jours[sp].includes(weekday(date))) || null;
  const busy = new Set(history.map((h) => dateOnly(h.date)));
  const out = [];
  for (const sport of SPORTS) {
    if (!jours[sport].length) continue;
    const swap = history.filter((h) => h.sport === 'autre' && h.remplace === sport).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
    if (!swap) continue;
    const day = dateOnly(swap.date);
    if (addDays(day, 14) < from) continue; // trop ancien
    if (history.some((h) => (h.sport || 'course') === sport && dateOnly(h.date) > day)) continue; // déjà refaite
    let date = null;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(day, i);
      const at = sportAt(d);
      if (at === sport) break; // le jour habituel arrive d'abord
      if (at || busy.has(d)) continue;
      const prev = addDays(d, -1);
      if (prev === day || sportAt(prev) || busy.has(prev) || out.some((r) => r.date === prev)) continue; // pas de jour de repos avant
      date = d;
      break;
    }
    if (date && date < from) continue; // jour du report passé : pas de rattrapage
    out.push({ sport, from: day, activite: swap.activite || 'autre activité', date });
  }
  return out;
}

const SPORT_NOUN = { course: 'Course', natation: 'Natation', muscu: 'Muscu' };
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const reportNote = (r) => `${SPORT_NOUN[r.sport]} du ${shortDay(r.from)} remplacée par : ${r.activite.toLowerCase()}. ${r.date ? 'Décalée ici, après un jour de repos.' : 'Pas de rattrapage : elle reprend ici, au même niveau.'}`;

// Séances prévues de `from` (inclus) sur `days` jours, selon le questionnaire `q`.
// Jours de la semaine : 0 = dimanche.
export function upcoming(history, settings, from, days = 14, q = null) {
  const opts = planOptions(q, settings);
  const { joursCourse, joursNatation, joursMuscu } = opts;
  let seance = joursMuscu.length ? nextSeance(history, joursMuscu.length) : null;
  const firstMuscu = { reason: null };
  const done = new Set(history.map((h) => `${dateOnly(h.date)}|${h.sport === 'autre' ? h.remplace : h.sport || 'course'}`));
  const moved = reports(history, opts, from);
  const extra = Object.fromEntries(moved.filter((r) => r.date).map((r) => [r.date, r.sport]));
  const isDay = (sport, jours, date, wd) => (jours.includes(wd) || extra[date] === sport) && !done.has(`${date}|${sport}`);
  // Note de report sur la première séance du sport remplacé.
  const notes = Object.fromEntries(moved.map((r) => [r.sport, reportNote(r)]));
  const takeNote = (sport, reason) => { const n = notes[sport]; delete notes[sport]; return n ? `${n} ${reason || ''}`.trim() : reason; };
  const lastRun = history.filter((h) => (h.sport || 'course') === 'course').map((h) => dateOnly(h.date)).sort().at(-1);
  const run = nextRunLevel(history, opts);
  const swim = nextSwim(history, opts);
  const out = [];
  let runPlaced = lastRun || null;
  let level = run.level;
  let reason = run.reason;
  let swimLongueurs = swim.longueurs;
  let swimReason = swim.reason;
  // Conseils du dernier bilan de chaque sport, affichés sur la prochaine séance de ce sport.
  const lastOf = (sport) => history.filter((h) => (h.sport || 'course') === sport).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
  const tips = Object.fromEntries(['course', 'natation', 'muscu'].map((sp) => [sp, { tips: tipsOf(lastOf(sp)), tipsSource: tipsSource(lastOf(sp)) }]));
  const takeTips = (sport) => { const t = tips[sport]; tips[sport] = { tips: [] }; return t; };
  const swimFocus = breathingIssue(lastOf('natation')) ? 'respiration' : null;
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wd = weekday(date);
    if (isDay('course', joursCourse, date, wd)) {
      // Au moins un jour de repos entre deux courses.
      if (runPlaced && daysBetween(runPlaced, date) < 2) {
        out.push({ date, sport: 'repos', reason: 'Course prévue décalée : il faut un jour de repos entre deux courses.' });
      } else {
        const lvl = LEVELS[level - 1];
        out.push({ date, sport: 'course', level, max: opts.maxLevel, title: lvl.label, steps: levelSteps(level), reason: takeNote('course', reason), ...takeTips('course') });
        runPlaced = date;
        // Hypothèse pour les séances suivantes : la séance se passe bien (difficulté 3).
        reason = 'Prévu si la séance précédente se passe bien. Recalculé après ton bilan.';
        const sim = [...history, { sport: 'course', date, level, difficulte: 3 }];
        level = nextRunLevel(sim, opts).level;
        history = sim;
      }
    } else if (isDay('natation', joursNatation, date, wd)) {
      out.push({ date, sport: 'natation', longueurs: swimLongueurs, bassin: swim.bassin, distance: swimLongueurs * swim.bassin, plan: swimPlan(swimLongueurs, swimFocus), focus: swimFocus, reason: takeNote('natation', swimReason), ...takeTips('natation') });
      swimLongueurs = Math.min(opts.maxLongueurs, swimLongueurs + 2);
      swimReason = 'Prévu si la séance précédente se passe bien. Recalculé après ton bilan.';
    } else if (isDay('muscu', joursMuscu, date, wd)) {
      const m = muscuPlan(seance, history, q || {}, settings.muscuChoix || {});
      out.push({ date, sport: 'muscu', ...m, reason: takeNote('muscu', firstMuscu.reason ?? m.reason), ...takeTips('muscu') });
      firstMuscu.reason = 'Charges recalculées après chaque séance notée.';
      seance = followingSeance(seance, joursMuscu.length);
    }
  }
  return out;
}

// Ce que change un bilan qu'on vient d'enregistrer : la prochaine séance du même sport,
// comparée à celle qui vient d'être faite, et les conseils pour la faire.
export function afterBilan(history, entry, settings, from, q = null) {
  const sport = entry.sport || 'course';
  if (sport === 'autre') return afterAutre(history, entry, settings, from, q);
  const next = upcoming(history, settings, from, HORIZON, q).find((p) => p.sport === sport) || null;
  const out = { sport, entryId: entry.id, next, conseils: tipsOf(entry), source: tipsSource(entry), titre: 'Bilan enregistré', detail: next?.reason || '' };
  if (!next) return out;
  if (sport === 'course') {
    const was = runLevel(entry);
    out.verdict = !was ? 'suite' : next.level > was ? 'monte' : next.level < was ? 'recul' : 'garde';
    out.titre = { monte: `Palier ${was} → ${next.level}`, recul: `Retour au palier ${next.level}`, garde: `On garde le palier ${next.level}`, suite: `Prochaine course : palier ${next.level}` }[out.verdict];
  } else if (sport === 'natation') {
    const was = entry.swim?.longueurs;
    out.verdict = !was ? 'suite' : next.longueurs > was ? 'monte' : next.longueurs < was ? 'recul' : 'garde';
    out.titre = { monte: `${was} → ${next.longueurs} longueurs`, recul: `On redescend à ${next.longueurs} longueurs`, garde: `On garde ${next.longueurs} longueurs`, suite: `Prochaine séance : ${next.longueurs} longueurs` }[out.verdict];
  } else {
    const ups = next.exercices.filter((x) => x.poids && entry.exercices?.some((e) => e.id === x.id && Number(e.poids) && x.poids > Number(e.poids)));
    out.verdict = ups.length ? 'monte' : 'garde';
    out.titre = ups.length ? `Charge en hausse sur ${ups.length} exercice${ups.length > 1 ? 's' : ''}` : 'Mêmes charges, une répétition de plus';
    out.detail = next.exercices.map((x) => `${x.nom.split(' (')[0]} : ${x.reason}`).join(' ');
  }
  return out;
}

// Après une autre activité : où passe la séance qu'elle remplace.
function afterAutre(history, entry, settings, from, q) {
  const out = { sport: 'autre', entryId: entry.id, next: null, conseils: conseils(entry), source: 'regles', titre: 'Activité enregistrée', detail: 'Elle compte dans ton temps d’activité. Le programme ne bouge pas.' };
  if (!entry.remplace) return out;
  const next = upcoming(history, settings, from, HORIZON, q).find((p) => p.sport === entry.remplace) || null;
  out.next = next;
  out.nextSport = entry.remplace;
  if (!next) return out;
  const r = reports(history, planOptions(q, settings), from).find((x) => x.sport === entry.remplace);
  out.verdict = 'decale';
  out.titre = `${SPORT_NOUN[entry.remplace]} décalée au ${shortDay(next.date)}`;
  out.detail = r?.date
    ? 'Premier jour libre après un jour de repos. Pas de rattrapage en double : le reste du programme suit.'
    : `Aucune place avant : il faut un jour de repos après chaque effort, et pas de séance en plus. ${entry.remplace === 'course' ? 'Même palier' : 'Même niveau'} : une activité hors programme ne le fait pas monter.`;
  return out;
}
