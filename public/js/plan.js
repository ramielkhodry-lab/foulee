// Programme d'entraînement : calculé à partir de l'historique, jamais stocké.
// L'historique n'est donc jamais réécrit, et une séance manquée décale
// simplement la suite. Les règles sont volontairement simples et explicables.

const W = (min) => ({ kind: 'marche', duration: min * 60 });
const R = (min) => ({ kind: 'course_lente', duration: min * 60 });
const rep = (n, run, walk) => Array.from({ length: n }, (_, i) => (i < n - 1 || walk === 0 ? [R(run), W(walk)] : [R(run)])).flat().filter((s) => s.duration > 0);

// Paliers marche/course jusqu'à 30 min en continu.
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
];

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

export function nextRunLevel(history) {
  const runs = history
    .map((h) => ((h.sport || 'course') === 'course' && !h.level && runLevel(h) ? { ...h, level: runLevel(h) } : h))
    .filter((h) => (h.sport || 'course') === 'course' && h.level)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (runs.length === 0) return { level: 1, reason: 'Premier palier : alterner 2 min de course et 2 min de marche.' };
  const last = runs.at(-1);
  const incomplete = last.steps && last.completedSteps !== undefined && last.completedSteps < last.steps.length;
  if (hasPain(last) || last.difficulte === 5) {
    return { level: Math.max(1, last.level - 1), reason: `Ta dernière course était ${hasPain(last) ? 'douloureuse' : 'très dure'} : on redescend d'un palier.` };
  }
  if (last.difficulte === 4 || incomplete) {
    return { level: last.level, reason: incomplete ? "Tu n'as pas fini la dernière séance : on refait le même palier." : 'Dernière course dure : on consolide le même palier.' };
  }
  if (last.difficulte && last.difficulte <= 2) {
    return { level: Math.min(LEVELS.length, last.level + 1), reason: 'Dernière course facile : on passe au palier suivant.' };
  }
  const sameLevel = [];
  for (let i = runs.length - 1; i >= 0 && runs[i].level === last.level; i--) sameLevel.push(runs[i]);
  if (sameLevel.length >= 2) {
    return { level: Math.min(LEVELS.length, last.level + 1), reason: 'Deux séances réussies à ce palier : on passe au suivant.' };
  }
  return {
    level: last.level,
    reason: last.difficulte ? 'Séance correcte : on la refait une fois pour la consolider.' : "Tu n'as pas noté la difficulté : on consolide ce palier une fois avant de monter.",
  };
}

// Natation : +2 longueurs par rapport à la dernière séance (environ +10 %), plafonné à 60.
export function nextSwim(history) {
  const swims = history.filter((h) => h.sport === 'natation' && h.swim?.longueurs).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = swims.at(-1);
  const bassin = last?.swim.bassinM || 25;
  if (!last) return { longueurs: 16, bassin, reason: 'Première séance : 16 longueurs, à ton rythme, avec des pauses.' };
  if (hasPain(last) || last.difficulte >= 4) {
    return { longueurs: last.swim.longueurs, bassin, reason: 'Dernière séance difficile : même volume, plus de pauses.' };
  }
  const longueurs = Math.min(60, last.swim.longueurs + 2);
  return { longueurs, bassin, reason: `Dernière fois ${last.swim.longueurs} longueurs : on ajoute 2 longueurs.` };
}

function swimPlan(longueurs) {
  const echauf = 4;
  const retour = 2;
  const corps = Math.max(0, longueurs - echauf - retour);
  const blocs = Math.floor(corps / 4);
  const reste = corps - blocs * 4;
  return [
    `Échauffement : ${echauf} longueurs tranquilles (brasse ou dos).`,
    blocs ? `${blocs} bloc${blocs > 1 ? 's' : ''} de 4 longueurs : 1 crawl + 1 brasse + 1 crawl + 1 dos, 30 s de pause entre les blocs.` : '',
    reste ? `${reste} longueur${reste > 1 ? 's' : ''} de brasse.` : '',
    `Retour au calme : ${retour} longueurs de dos.`,
    'En crawl : souffle dans l’eau par le nez et la bouche, tourne la tête pour inspirer, sans relever le front.',
  ].filter(Boolean);
}

// Séances prévues de `from` (inclus) sur `days` jours.
// settings.joursCourse / joursNatation : jours de la semaine (0 = dimanche).
export function upcoming(history, settings, from, days = 14) {
  const joursCourse = settings.joursCourse ?? [1, 5];
  const joursNatation = settings.joursNatation ?? [3];
  const done = new Set(history.map((h) => `${dateOnly(h.date)}|${h.sport || 'course'}`));
  const lastRun = history.filter((h) => (h.sport || 'course') === 'course').map((h) => dateOnly(h.date)).sort().at(-1);
  const run = nextRunLevel(history);
  const swim = nextSwim(history);
  const out = [];
  let runPlaced = lastRun || null;
  let level = run.level;
  let reason = run.reason;
  let swimLongueurs = swim.longueurs;
  let swimReason = swim.reason;
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wd = weekday(date);
    if (joursCourse.includes(wd) && !done.has(`${date}|course`)) {
      // Au moins un jour de repos entre deux courses.
      if (runPlaced && daysBetween(runPlaced, date) < 2) {
        out.push({ date, sport: 'repos', reason: 'Course prévue décalée : il faut un jour de repos entre deux courses.' });
      } else {
        const lvl = LEVELS[level - 1];
        out.push({ date, sport: 'course', level, title: lvl.label, steps: levelSteps(level), reason });
        runPlaced = date;
        // Hypothèse pour les séances suivantes : la séance se passe bien (difficulté 3).
        reason = 'Prévu si la séance précédente se passe bien. Recalculé après ton bilan.';
        const sim = [...history, { sport: 'course', date, level, difficulte: 3 }];
        level = nextRunLevel(sim).level;
        history = sim;
      }
    } else if (joursNatation.includes(wd) && !done.has(`${date}|natation`)) {
      out.push({ date, sport: 'natation', longueurs: swimLongueurs, bassin: swim.bassin, distance: swimLongueurs * swim.bassin, plan: swimPlan(swimLongueurs), reason: swimReason });
      swimLongueurs = Math.min(60, swimLongueurs + 2);
      swimReason = 'Prévu si la séance précédente se passe bien. Recalculé après ton bilan.';
    }
  }
  return out;
}
