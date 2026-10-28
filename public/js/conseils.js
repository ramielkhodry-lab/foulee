// Conseils pour la prochaine séance, tirés du bilan de la dernière : notes (difficulté,
// essoufflement, fatigue), douleur et mots du ressenti. Des règles fixes et lisibles,
// pas une IA : chaque conseil vient d'une règle ci-dessous.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (h) => norm([h.commentaire, h.douleur, h.swim?.detail, h.structure].join(' '));

// Mots du ressenti qui signalent une gêne de respiration en natation.
const SWIM_BREATH = /aval\w* (de l'?)?eau|bu la tasse|boi\w* la tasse|eau dans le nez|respir|souffle|inspir/;
export const breathingIssue = (h) => (h?.sport === 'natation') && SWIM_BREATH.test(words(h));

const PAIN_TIPS = [
  [/genou/, 'Genou : raccourcis ta foulée et pose le pied sous toi, pas devant. Évite les descentes la prochaine fois.'],
  [/tibia|periost/, 'Tibia : terrain souple si possible (parc, chemin), foulée courte, et pas deux jours de course d’affilée.'],
  [/mollet|achille|tendon/, 'Mollet ou tendon : 2 × 15 montées sur la pointe des pieds chaque jour, et échauffement complet de 5 min de marche.'],
  [/cheville|pied|voute|plante/, 'Pied ou cheville : vérifie tes chaussures (usure, laçage) et reste sur terrain plat.'],
  [/epaule/, 'Épaule : réduis l’amplitude et la charge sur les mouvements qui tirent dessus ; en natation, plus de brasse, moins de crawl.'],
  [/dos|lombaire|nuque|cou/, 'Dos ou nuque : en natation, préfère le dos crawlé à la brasse tête hors de l’eau ; en muscu, baisse la charge et garde le dos neutre.'],
];

// Jusqu'à 4 conseils, du plus important au moins important.
export function conseils(h) {
  if (!h) return [];
  const sport = h.sport || 'course';
  const t = words(h);
  const out = [];
  const pain = Boolean(h.douleur && h.douleur.trim());
  if (pain) {
    const specific = PAIN_TIPS.find(([re]) => re.test(norm(h.douleur)));
    out.push(`Douleur notée (${h.douleur.trim()}) : le programme ne monte pas. Si elle dure plus de 3 jours ou revient à chaque séance, arrête de forcer et vois un médecin.`);
    if (specific) out.push(specific[1]);
  }
  if (sport === 'natation') {
    if (breathingIssue(h)) {
      out.push('Tu avales de l’eau parce que tu inspires avec de l’air encore dans les poumons. Souffle tout sous l’eau, par le nez et la bouche, pendant que le visage est dedans : quand la tête sort, tu n’as plus qu’à inspirer.');
      out.push('En crawl, tourne la tête sur le côté jusqu’à voir le plafond d’un œil, l’oreille reste dans l’eau ; ne relève pas le front. En brasse, inspire quand les mains s’écartent, souffle quand elles reviennent devant.');
    }
    if ((h.essoufflement || 0) >= 4 || (h.fatigue || 0) >= 4) out.push('Essoufflé ou fatigué : arrête-toi 20 à 30 s au bord dès que tu en as besoin. Le nombre de longueurs compte, pas de les enchaîner.');
  } else if (sport === 'course') {
    const incomplete = h.steps && h.completedSteps !== undefined && h.completedSteps < h.steps.length;
    if (incomplete) out.push('Tu as arrêté avant la fin : la prochaine fois, ralentis dès la première course plutôt que de t’arrêter. Finir lentement vaut mieux que finir tôt.');
    if ((h.essoufflement || 0) >= 4 || /souffle|essouffl/.test(t)) out.push('Trop essoufflé : ralentis jusqu’à pouvoir dire une phrase entière en courant. Si ça te paraît trop lent, c’est la bonne allure.');
    if (/point de cote/.test(t)) out.push('Point de côté : ralentis et souffle fort quand le pied gauche touche le sol. Ne mange rien de lourd dans les 2 h avant.');
  } else if (sport === 'muscu') {
    if ((h.difficulte || 0) >= 5) out.push('Séance très dure : si la technique se dégrade sur les dernières répétitions, baisse la charge de 10 % plutôt que de forcer.');
  }
  if (/crampe/.test(t)) out.push('Crampes : bois un grand verre d’eau dans l’heure avant, et étire le muscle doucement dès qu’elle arrive.');
  if ((h.fatigue || 0) >= 4 && out.length < 4) out.push('Grosse fatigue : dors bien la veille et mange un peu 1 à 2 h avant (banane, pain, yaourt). Garde au moins un jour de repos avant la suivante.');
  if (!pain && h.difficulte && h.difficulte <= 2) out.push('Séance facile : la prochaine monte d’un cran. Garde la même allure tranquille, c’est le volume qui augmente.');
  if (!out.length) out.push('Rien à corriger : refais la même chose, au même rythme. C’est la régularité qui fait progresser.');
  return out.slice(0, 4);
}

// Conseils affichés pour un bilan : ceux de l'IA s'ils existent, sinon ceux des règles.
// Version attendue des conseils de l'IA (worker/src/ia.js, VERSION) : ceux d'une version plus
// ancienne ne s'affichent plus et sont redemandés.
export const IA_VERSION = 2;
export const hasIA = (h) => Boolean(h?.conseilsIA?.conseils?.length && h.conseilsIA.v === IA_VERSION);
export const tipsOf = (h) => (hasIA(h) ? h.conseilsIA.conseils : conseils(h));
export const tipsSource = (h) => (hasIA(h) ? 'ia' : 'regles');
