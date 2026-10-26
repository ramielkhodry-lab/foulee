// Textes des annonces vocales. Partagé entre le générateur de clips (via export JSON)
// et l'app, qui choisit le clip à jouer pour chaque étape.

export const KINDS = {
  echauffement: { label: "Marche d'échauffement", effort: 'marche' },
  marche: { label: 'Marche', effort: 'marche' },
  course_lente: { label: 'Course lente', effort: 'course' },
  course: { label: 'Course', effort: 'course' },
  recuperation: { label: 'Marche de récupération', effort: 'marche' },
};

const UNITS = ['', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante', 60: 'soixante' };

// Nombre au féminin (« une minute », « vingt et une minutes »), de 1 à 60.
export function nombre(n) {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10) * 10;
  const u = n % 10;
  if (u === 0) return TENS[t];
  return TENS[t] + (u === 1 ? ' et une' : '-' + UNITS[u]);
}

// Durées pour lesquelles un clip avec la durée prononcée existe.
export const SPOKEN_DURATIONS = [30, 90, 150, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 60)];

export function dureeEnMots(sec) {
  if (sec === 30) return 'trente secondes';
  if (sec === 90) return 'une minute trente';
  if (sec === 150) return 'deux minutes trente';
  const m = sec / 60;
  return `${nombre(m)} minute${m > 1 ? 's' : ''}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const START = {
  echauffement: (d) => (d ? `Échauffement. Marche tranquillement pendant ${d}.` : 'Échauffement. Marche tranquillement.'),
  marche: (d) => (d ? `Bien joué ! Marche pendant ${d}.` : 'Bien joué ! Tu peux marcher.'),
  course_lente: (d) => (d ? `C'est parti ! ${cap(d)} de course tranquille.` : "C'est parti ! Course tranquille."),
  course: (d) => (d ? `C'est parti ! ${cap(d)} de course.` : "C'est parti ! À toi de courir."),
  recuperation: (d) => (d ? `Bravo ! Termine par ${d} de marche de récupération.` : 'Bravo ! Termine par une marche de récupération.'),
};

const PRE = {
  echauffement: 'Dans dix secondes, tu passes à la marche.',
  marche: 'Dans dix secondes, tu passes à la marche.',
  course_lente: 'Dans dix secondes, tu commences à courir, tranquillement.',
  course: 'Dans dix secondes, tu commences à courir.',
  recuperation: 'Dans dix secondes, dernière étape : la récupération.',
};

export const INTRO = "C'est parti pour ta séance. Garde ton téléphone en poche, je te guide.";
export const END = 'Séance terminée. Bravo ! Pense à noter ton ressenti dans Foulée.';

export const startClipId = (kind, sec) => (SPOKEN_DURATIONS.includes(sec) ? `start_${kind}_${sec}` : `start_${kind}`);
export const preClipId = (kind) => `pre_${kind}`;

// Tous les clips vocaux à générer : { id: texte }.
export function allPhrases() {
  const out = { intro: INTRO, end: END };
  for (const kind of Object.keys(KINDS)) {
    out[`start_${kind}`] = START[kind](null);
    out[`pre_${kind}`] = PRE[kind];
    for (const sec of SPOKEN_DURATIONS) out[`start_${kind}_${sec}`] = START[kind](dureeEnMots(sec));
  }
  return out;
}
