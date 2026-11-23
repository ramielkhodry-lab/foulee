// Course libre : le coureur choisit sa marche de début, sa durée de course et sa marche de
// fin, puis part. Même moteur que toutes les courses (une seule piste gravée d'avance) :
// signal de course à la fin de la marche de début, signal à la moitié de la course (et non
// de la séance), signal de marche au début de la marche de fin, puis signal de fin.
//
// Hors programme : enregistrée comme une course (historique, carte, distance, Progression),
// sans palier (level null), donc ignorée par nextRunLevel.

export const COURSE_LIBRE_ID = 'course-libre';
export const DEFAUT = { echauf: 5, course: 20, fin: 5 }; // minutes
export const BORNES = { echauf: [0, 30], course: [5, 180], fin: [0, 30] };

const clamp = (k, v) => Math.min(BORNES[k][1], Math.max(BORNES[k][0], Math.round(Number(v) || 0)));

// Réglages gardés (settings.courseLibre) ou valeurs par défaut, toujours dans les bornes.
export function courseLibreCfg(saved) {
  const c = { ...DEFAUT, ...(saved || {}) };
  return { echauf: clamp('echauf', c.echauf), course: clamp('course', c.course), fin: clamp('fin', c.fin) };
}

export function courseLibreSession(cfg) {
  const c = courseLibreCfg(cfg);
  const steps = [];
  if (c.echauf) steps.push({ kind: 'echauffement', duration: c.echauf * 60 });
  const halfStep = steps.length;
  steps.push({ kind: 'course', duration: c.course * 60 });
  if (c.fin) steps.push({ kind: 'recuperation', duration: c.fin * 60 });
  return { id: COURSE_LIBRE_ID, name: `Course libre · ${c.course} min`, courseLibre: c, halfStep, steps };
}

export const isCourseLibre = (s) => Boolean(s?.courseLibre);
