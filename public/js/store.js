// Stockage local du prototype (un seul appareil, pas encore de compte).
// Les comptes et la synchronisation serveur arrivent en phase 1.

const KEY = 'foulee.v1';

export const PRESETS = [
  {
    id: 'debutant-23',
    name: 'Marche / course, 23 min',
    steps: [
      { kind: 'echauffement', duration: 300 },
      { kind: 'course_lente', duration: 180 },
      { kind: 'marche', duration: 120 },
      { kind: 'course_lente', duration: 180 },
      { kind: 'marche', duration: 120 },
      { kind: 'course_lente', duration: 180 },
      { kind: 'recuperation', duration: 300 },
    ],
  },
  {
    id: 'test-4',
    name: 'Test du guidage, 4 min',
    steps: [
      { kind: 'echauffement', duration: 60 },
      { kind: 'course_lente', duration: 30 },
      { kind: 'marche', duration: 60 },
      { kind: 'course', duration: 30 },
      { kind: 'recuperation', duration: 60 },
    ],
  },
];

const empty = () => ({
  profile: { prenom: '' },
  sessions: structuredClone(PRESETS),
  history: [],
  settings: { son: 'musique', annonces: 'signaux' },
});

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    cache = empty();
  }
  return cache;
}

const listeners = [];
export const onSave = (fn) => listeners.push(fn);

export function save() {
  let ok = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    ok = false;
  }
  for (const fn of listeners) fn(cache);
  return ok;
}

// Remplace toutes les données (après fusion avec le serveur).
export function replace(data) {
  cache = { ...empty(), ...data };
  return save();
}

export function update(fn) {
  fn(load());
  return save();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
