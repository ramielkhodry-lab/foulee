// Musculation : bibliothèque d'exercices par muscle, séances A/B (ou haut/bas) et
// progression de la charge à partir de ce qui a été noté. Comme pour la course,
// rien n'est stocké : le programme se recalcule depuis l'historique.

// Matériel : machine et poulie = salle ; barre = salle (ou maison équipée) ;
// halteres = maison avec haltères ; corps = poids du corps, partout.
// pas = la plus petite hausse de charge réaliste (kg).
const E = (id, nom, muscle, materiel, pas = 0, unite = 'reps') => ({ id, nom, muscle, materiel, pas, unite });

export const EXERCICES = [
  E('presse-pec', 'Presse pectorale', 'pectoraux', 'machine', 5),
  E('dev-couche', 'Développé couché à la barre', 'pectoraux', 'barre', 2.5),
  E('dev-couche-h', 'Développé couché haltères', 'pectoraux', 'halteres', 2),
  E('ecarte-poulie', 'Écarté à la poulie', 'pectoraux', 'poulie', 2.5),
  E('pompes', 'Pompes', 'pectoraux', 'corps'),

  E('tirage-vertical', 'Tirage vertical', 'dos', 'machine', 5),
  E('rowing-assis', 'Rowing assis', 'dos', 'machine', 5),
  E('rowing-h', 'Rowing haltère à un bras', 'dos', 'halteres', 2),
  E('rowing-barre', 'Rowing à la barre', 'dos', 'barre', 2.5),
  E('superman', 'Superman au sol', 'dos', 'corps'),
  E('tractions', 'Tractions (barre fixe ou machine assistée)', 'dos', 'corps'),

  E('dev-epaules-m', 'Développé épaules à la machine', 'épaules', 'machine', 5),
  E('dev-militaire-h', 'Développé épaules haltères', 'épaules', 'halteres', 2),
  E('elevations', 'Élévations latérales haltères', 'épaules', 'halteres', 1),
  E('face-pull', 'Face pull à la poulie', 'épaules', 'poulie', 2.5),
  E('pompes-piquees', 'Pompes piquées', 'épaules', 'corps'),

  E('presse-cuisses', 'Presse à cuisses', 'quadriceps', 'machine', 10),
  E('leg-extension', 'Leg extension', 'quadriceps', 'machine', 5),
  E('squat', 'Squat à la barre', 'quadriceps', 'barre', 2.5),
  E('goblet', 'Goblet squat (haltère contre la poitrine)', 'quadriceps', 'halteres', 2),
  E('fentes-h', 'Fentes haltères', 'quadriceps', 'halteres', 2),
  E('squat-corps', 'Squat au poids du corps', 'quadriceps', 'corps'),
  E('fentes', 'Fentes au poids du corps', 'quadriceps', 'corps'),

  E('leg-curl', 'Leg curl', 'ischios et fessiers', 'machine', 5),
  E('hip-thrust', 'Hip thrust à la barre', 'ischios et fessiers', 'barre', 5),
  E('sdt-jt-h', 'Soulevé de terre jambes tendues haltères', 'ischios et fessiers', 'halteres', 2),
  E('pont-fessier', 'Pont fessier', 'ischios et fessiers', 'corps'),

  E('mollets-m', 'Mollets debout à la machine', 'mollets', 'machine', 5),
  E('mollets-marche', 'Mollets sur une marche', 'mollets', 'corps'),

  E('curl-pupitre', 'Curl pupitre à la machine', 'biceps', 'machine', 2.5),
  E('curl-h', 'Curl haltères', 'biceps', 'halteres', 1),
  E('curl-poulie', 'Curl à la poulie', 'biceps', 'poulie', 2.5),

  E('ext-poulie', 'Extension triceps à la poulie haute', 'triceps', 'poulie', 2.5),
  E('dips-m', 'Dips à la machine', 'triceps', 'machine', 5),
  E('ext-h', 'Extension haltère au-dessus de la tête', 'triceps', 'halteres', 1),
  E('dips-banc', 'Dips sur un banc ou une chaise', 'triceps', 'corps'),

  E('crunch-m', 'Crunch à la machine', 'abdos', 'machine', 5),
  E('releves', 'Relevés de jambes allongé', 'abdos', 'corps'),
  E('gainage', 'Gainage (planche)', 'abdos', 'corps', 0, 's'),
];
export const MUSCLES = [...new Set(EXERCICES.map((e) => e.muscle))];
export const byId = (id) => EXERCICES.find((e) => e.id === id);

// Où l'on s'entraîne → matériel disponible, du plus guidé au plus libre.
export const LIEUX = {
  salle: { label: 'En salle', detail: 'machines, poulies, barres et haltères', materiel: ['machine', 'poulie', 'barre', 'halteres', 'corps'] },
  halteres: { label: 'À la maison avec des haltères', materiel: ['halteres', 'corps'] },
  corps: { label: 'À la maison sans matériel', detail: 'poids du corps', materiel: ['corps'] },
};

// Objectif → séries, fourchette de répétitions, repos.
export const GOALS_MUSCU = {
  muscle: { label: 'Prendre du muscle', series: 3, min: 8, max: 12, repos: 90 },
  tonus: { label: 'Me raffermir, perdre du gras', series: 3, min: 12, max: 15, repos: 60 },
  force: { label: 'Gagner en force', series: 4, min: 5, max: 8, repos: 150 },
};
export const NIVEAUX_MUSCU = {
  debutant: { label: 'Je débute' },
  reprise: { label: 'Je reprends après une pause' },
  regulier: { label: 'Je pratique régulièrement' },
};
// Débutant ou reprise : une série de moins pendant les 4 premières séances, le temps que le corps s'habitue.
const ADAPTATION = 4;

// Séances : une liste de muscles ; la variante choisit le 1er ou le 2e exercice du muscle.
export const SEANCES = {
  A: { titre: 'Corps entier A', slots: [['quadriceps', 0], ['pectoraux', 0], ['dos', 0], ['épaules', 0], ['ischios et fessiers', 0], ['abdos', 0]] },
  B: { titre: 'Corps entier B', slots: [['ischios et fessiers', 1], ['dos', 1], ['pectoraux', 1], ['quadriceps', 1], ['biceps', 0], ['triceps', 0]] },
  H: { titre: 'Haut du corps', slots: [['pectoraux', 0], ['dos', 0], ['épaules', 0], ['dos', 1], ['biceps', 0], ['triceps', 0]] },
  L: { titre: 'Bas du corps', slots: [['quadriceps', 0], ['ischios et fessiers', 0], ['quadriceps', 1], ['mollets', 0], ['abdos', 0]] },
};

export const alternatives = (muscle, lieu = 'salle') => EXERCICES.filter((e) => e.muscle === muscle && LIEUX[lieu].materiel.includes(e.materiel));

// Exercice d'une case de séance : le choix de la personne s'il existe, sinon le n-ième disponible.
export function slotExercise(seance, i, lieu = 'salle', choix = {}) {
  const [muscle, variante] = SEANCES[seance].slots[i];
  const list = alternatives(muscle, lieu);
  const chosen = list.find((e) => e.id === choix[`${seance}:${i}`]);
  return chosen || list[Math.min(variante, list.length - 1)] || null;
}

const sortByDate = (list) => [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)));
const muscuSessions = (history) => sortByDate(history.filter((h) => h.sport === 'muscu' && h.exercices?.length));
const hasPain = (h) => Boolean(h.douleur && h.douleur.trim());
const fmtKg = (kg) => `${String(kg).replace('.', ',')} kg`;

// Charge et objectif de la prochaine fois pour un exercice (double progression) :
// - toutes les séries au haut de la fourchette → on ajoute le plus petit pas de charge ;
// - une série sous le bas de la fourchette → même charge, on vise le bas ;
// - sinon même charge, une répétition de plus par série.
// Poids du corps : on monte la fourchette de 2 répétitions (ou 10 s) quand tout est fait.
export function nextLoad(ex, history, goal) {
  const lastSession = muscuSessions(history).reverse().find((h) => h.exercices.some((x) => x.id === ex.id && x.reps?.some((r) => r > 0)));
  const last = lastSession?.exercices.find((x) => x.id === ex.id);
  const min = ex.unite === 's' ? 30 : goal.min;
  const max = ex.unite === 's' ? 45 : goal.max;
  const unit = ex.unite === 's' ? 's' : 'répétitions';
  if (!last) {
    if (ex.materiel === 'corps') return { poids: null, min, max, reason: `Premier essai : fais ce que tu peux, sans dépasser ${max} ${unit}.` };
    return { poids: null, min, max, reason: `Premier essai : prends une charge que tu peux soulever ${max} fois en gardant 2 répétitions en réserve.` };
  }
  const done = last.reps.map((r) => Number(r) || 0); // série non faite = 0
  if (ex.materiel === 'corps') {
    // On repart de la fourchette visée la dernière fois.
    const lmin = last.min || min;
    const lmax = last.max || max;
    if (done.every((r) => r >= lmax)) {
      const step = ex.unite === 's' ? 10 : 2;
      return { poids: null, min: lmin + step, max: lmax + step, reason: `Tout fait la dernière fois : +${step} ${ex.unite === 's' ? 's' : 'répétitions'}.` };
    }
    return { poids: null, min: lmin, max: lmax, reason: 'Même objectif : vise le haut de la fourchette sur chaque série.' };
  }
  const poids = Number(last.poids) || null;
  if (!poids) return { poids: null, min, max, reason: 'Charge non notée la dernière fois : note-la cette fois pour que la suite s’adapte.' };
  if (hasPain(lastSession)) return { poids, min, max, reason: `Douleur notée la dernière fois : on garde ${fmtKg(poids)}, sans forcer.` };
  if (done.every((r) => r >= max)) {
    const next = Math.round((poids + ex.pas) * 10) / 10;
    return { poids: next, min, max, reason: `Toutes tes séries à ${max} répétitions avec ${fmtKg(poids)} : on passe à ${fmtKg(next)}.` };
  }
  if (done.some((r) => r < min)) return { poids, min, max, reason: `Moins de ${min} répétitions sur une série : on garde ${fmtKg(poids)}.` };
  return { poids, min, max, reason: `Même charge (${fmtKg(poids)}) : une répétition de plus par série.` };
}

// Séance qui suit la dernière faite : A ↔ B (jusqu'à 3 jours par semaine), haut ↔ bas au-delà.
export function nextSeance(history, joursParSemaine) {
  const last = muscuSessions(history).at(-1);
  return followingSeance(last?.seance, joursParSemaine);
}
export function followingSeance(seance, joursParSemaine) {
  const cycle = joursParSemaine >= 4 ? ['H', 'L'] : ['A', 'B'];
  return cycle[(cycle.indexOf(seance) + 1) % cycle.length];
}

// Détail d'une séance de musculation pour ce profil.
export function muscuPlan(seance, history, q = {}, choix = {}) {
  const goal = GOALS_MUSCU[q.objectifMuscu] || GOALS_MUSCU.muscle;
  const lieu = LIEUX[q.lieu] ? q.lieu : 'salle';
  const adapting = q.niveauMuscu !== 'regulier' && muscuSessions(history).length < ADAPTATION;
  const series = Math.max(2, goal.series - (adapting ? 1 : 0));
  const exercices = SEANCES[seance].slots.map((_, i) => {
    const ex = slotExercise(seance, i, lieu, choix);
    if (!ex) return null;
    return { slot: i, ...ex, series, ...nextLoad(ex, history, goal) };
  }).filter(Boolean);
  return {
    seance,
    title: SEANCES[seance].titre,
    exercices,
    repos: goal.repos,
    adapting,
    reason: adapting
      ? `Séances d'adaptation (${muscuSessions(history).length + 1}/${ADAPTATION}) : ${series} séries au lieu de ${goal.series}, charges modérées.`
      : `${goal.label} : ${series} séries de ${goal.min} à ${goal.max} répétitions, ${goal.repos} s de repos.`,
  };
}

// Tonnage d'une séance notée : charge × répétitions, poids du corps exclu (non mesuré).
export const tonnage = (h) => (h.exercices || []).reduce((a, x) => a + (Number(x.poids) || 0) * (x.reps || []).reduce((s, r) => s + (Number(r) || 0), 0), 0);
