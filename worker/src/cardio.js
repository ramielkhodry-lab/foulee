// Cardio de l'Apple Watch : le Raccourci iPhone lit la fréquence cardiaque dans Santé et
// l'envoie ici en texte, une mesure par ligne : « <date ISO 8601>;<bpm> ».
// Fonctions pures, testées dans test/cardio.test.js ; les routes sont dans index.js.

export const MAX_BODY = 1_000_000; // ~15 000 lignes : une journée de cardio, pas, distance…
export const MAX_SAMPLES = 10_000;
export const KEEP_DAYS = 60; // mesures plus anciennes effacées à chaque import
const PAST_DAYS = 8; // le Raccourci envoie la journée : rien de plus vieux n'est accepté
const BPM_MIN = 25;
const BPM_MAX = 250;

const ISO = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;

// Le corps envoyé par le Raccourci : du texte brut, ou du JSON dont on prend le premier
// champ texte (ou une liste de lignes).
export function bodyText(raw) {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return s;
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map(String).join('\n');
    if (v && typeof v === 'object') {
      const first = Object.values(v).find((x) => typeof x === 'string' || Array.isArray(x));
      return Array.isArray(first) ? first.map(String).join('\n') : String(first ?? '');
    }
  } catch {}
  return s;
}

// Autres mesures de la montre lues dans Santé, une ligne « type;date;valeur;source » :
// distance (km, ou m si > 5), énergie active (kcal), puissance de course (W), pas, natation.
export const KINDS = {
  dist: { re: /^(dist|distance)/, min: 0, max: 5000 },
  kcal: { re: /^(kcal|energie|énergie|cal)/, min: 0, max: 500 },
  puiss: { re: /^(puiss|power|watt)/, min: 0, max: 1500 },
  pas: { re: /^(pas|steps?)/, min: 0, max: 10000 },
  // Natation en piscine : distance à la nage (m, ou km si < 2 : une mesure par longueur) et
  // mouvements de nage (bras), mesurés seulement par la montre.
  nage: { min: 0, max: 5000 },
  mvt: { min: 0, max: 2000 },
};
// Préfixe de la ligne : vide = cardio, ou le type écrit par le Raccourci (« Type » de
// l'échantillon, en français ou en anglais : « Distance de marche et de course », « Steps »…).
const kindOf = (prefix) => {
  const p = prefix.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[;|,]/g, ' ').trim();
  if (!p || /frequence|cardio|heart|^fc\b|bpm/.test(p)) return 'fc';
  // Avant « distance » : « Distance de nage » est une distance de natation, pas de course.
  if (/mouvement|stroke|^mvt\b/.test(p)) return 'mvt';
  if (/\bnage\b|natation|swim/.test(p)) return 'nage';
  if (/distance|^dist\b/.test(p)) return 'dist';
  if (/energie|energy|kcal|calor/.test(p)) return 'kcal';
  if (/puissance|power|^puiss\b/.test(p)) return 'puiss';
  if (/\bpas\b|step/.test(p)) return 'pas';
  return null;
};

// Format « en colonnes », sans boucle dans le Raccourci (une boucle fait un tour par mesure :
// des milliers pour une course, plusieurs minutes, voire bloqué). Le Raccourci insère les
// listes entières dans un seul Texte, une valeur par ligne :
//   #dates dist      ← puis une date par ligne (Date de début, ISO 8601)
//   #valeurs dist    ← puis une valeur par ligne, dans le même ordre
//   #sources dist    ← (facultatif) puis une source par ligne
// On recolle ligne à ligne en « dist;date;valeur;source ». Une colonne se termine au titre
// suivant ou dès qu'une ligne n'a pas la forme attendue (date dans les dates, pas de date ailleurs).
const COL = /^\s*#\s*(dates?|valeurs?|values?|sources?)\s+(.+?)\s*$/i;
function expandColumns(lines) {
  const rest = [];
  const blocks = new Map(); // nom du type → { dates, valeurs, sources }
  let cur = null;
  for (const line of lines) {
    const h = line.match(COL);
    if (h) {
      const col = /^d/i.test(h[1]) ? 'dates' : /^s/i.test(h[1]) ? 'sources' : 'valeurs';
      const name = h[2].toLowerCase();
      if (!blocks.has(name)) blocks.set(name, { dates: [], valeurs: [], sources: [] });
      cur = blocks.get(name)[col];
      cur.col = col;
      continue;
    }
    if (cur && line.trim() === '') continue;
    if (cur) {
      const hasDate = ISO.test(line);
      if (cur.col === 'dates' ? hasDate : !hasDate) { cur.push(line.trim()); continue; }
      cur = null; // ligne d'une autre forme : fin de la colonne
    }
    rest.push(line);
  }
  const out = [];
  let mismatch = 0;
  for (const [name, b] of blocks) {
    if (b.dates.length !== b.valeurs.length) { mismatch++; continue; }
    const withSource = b.sources.length === b.dates.length;
    b.dates.forEach((d, i) => {
      const v = b.valeurs[i].replace(/[\s  ]/g, ''); // « 1 234 » → « 1234 »
      out.push(`${name};${d.match(ISO)[0]};${v}${withSource ? `;${b.sources[i]}` : ''}`);
    });
  }
  return { lines: [...rest, ...out], mismatch };
}

// Texte → mesures triées, sans doublon. Cardio : `samples` [[t (ms), bpm], …] (une ligne
// « date;bpm », sans préfixe). Le reste : `autres` { dist, kcal, puiss, pas }. `reason`
// explique un échec dans les mots du Raccourci, pour savoir quel réglage corriger.
export function parseSamples(text, now = Date.now()) {
  const items = [];
  const { lines, mismatch } = expandColumns(String(text ?? '').split(/\r?\n/));
  for (const line of lines) {
    const n = (line.match(new RegExp(ISO.source, 'g')) || []).length;
    if (!n) continue;
    if (n === 1) {
      const i = line.search(ISO);
      items.push({ kind: kindOf(line.slice(0, i)), chunk: line.slice(i) });
    } else {
      for (const c of line.split(/(?=\d{4}-\d{2}-\d{2})/)) if (ISO.test(c)) items.push({ kind: 'fc', chunk: c });
    }
  }
  const out = new Map();
  const others = Object.fromEntries(Object.keys(KINDS).map((k) => [k, new Map()]));
  let noTime = 0;
  let noZone = 0;
  let badValue = 0;
  let outside = 0;
  let fromPhone = 0;
  const cand = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  for (const { kind, chunk } of items) {
    if (!kind) continue; // type inconnu : ignoré
    const date = chunk.match(ISO)[0];
    if (!date.includes('T')) { noTime++; continue; }
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(date)) { noZone++; continue; }
    const t = Date.parse(date.replace(',', '.').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    const rest = chunk.slice(chunk.indexOf(date) + date.length);
    // Santé écrit les toutes petites valeurs en notation scientifique (« 1,2e-05 » km) : sans
    // l'exposant, on lisait 1,2 km pour un bout de foulée, d'où des km en double et des splits en 0'01.
    const m = rest.match(/\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?/);
    const v = m ? Number(m[0].replace(',', '.')) : NaN;
    // Source après la valeur (« ;iPhone de Rami ») : Santé garde les pas et la distance de
    // l'iPhone ET de la montre, les deux additionnés compteraient tout en double. On garde la montre.
    const source = m ? rest.slice(m.index + m[0].length).replace(/^[\s;]+/, '').trim() : '';
    if (!Number.isFinite(t)) { noTime++; continue; }
    if (t > now + 10 * 60_000 || t < now - PAST_DAYS * 86400_000) { outside++; continue; }
    if (kind === 'fc') {
      const bpm = Math.round(v);
      if (!(bpm >= BPM_MIN && bpm <= BPM_MAX)) { badValue++; continue; }
      if (out.size < MAX_SAMPLES) out.set(t, bpm);
    } else {
      const k = KINDS[kind];
      if (!(v >= k.min && v <= k.max)) { badValue++; continue; }
      // Distance : en km ; une valeur au-delà de 5 par mesure ne peut être qu'en mètres.
      // Nage : en mètres ; moins de 2 par mesure (une longueur) ne peut être qu'en km.
      const val = kind === 'dist' && v > 5 ? v / 1000 : kind === 'nage' && v > 0 && v < 2 ? v * 1000 : v;
      cand[kind].push({ t, v: Math.round(val * 1e6) / 1e6, source });
    }
  }
  // Par type : si des mesures viennent d'une montre, on ne garde qu'elles (le nom de l'iPhone
  // est libre, « iPhone » n'y figure pas toujours) ; sinon on écarte au moins l'iPhone.
  const sources = {};
  for (const [kind, list] of Object.entries(cand)) {
    if (!list.length) continue;
    const watch = list.some((x) => /watch/i.test(x.source));
    const keep = (x) => (watch ? /watch/i.test(x.source) : !/iphone/i.test(x.source));
    sources[kind] = { sans: list.filter((x) => !x.source).length, noms: [...new Set(list.map((x) => x.source).filter(Boolean))] };
    for (const x of list) {
      if (!keep(x)) { fromPhone++; continue; }
      if (others[kind].size < MAX_SAMPLES) others[kind].set(x.t, x.v);
    }
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => a[0] - b[0]);
  const samples = sorted(out);
  const autres = Object.fromEntries(Object.entries(others).map(([k, m]) => [k, sorted(m)]));
  const total = samples.length + Object.values(autres).reduce((a, l) => a + l.length, 0);
  let reason = null;
  if (!total) {
    if (mismatch && !items.length) reason = 'Les colonnes « #dates » et « #valeurs » n’ont pas le même nombre de lignes. Dans le Raccourci, les deux doivent venir du même « Échantillons de Santé ».';
    else if (!items.length) reason = 'Aucune mesure reçue. Vérifie que le Raccourci trouve bien des échantillons de fréquence cardiaque (Santé > Fréquence cardiaque doit avoir des données aujourd’hui).';
    else if (noTime) reason = 'Les dates n’ont pas d’heure. Dans le Raccourci, touche « Date de début », choisis le format ISO 8601 et active « Inclure l’heure ».';
    else if (noZone) reason = 'Les dates n’ont pas de fuseau horaire. Dans le Raccourci, choisis le format de date ISO 8601.';
    else if (badValue) reason = 'Les valeurs ne sont pas des battements par minute. Dans le Raccourci, mets « Valeur » après le point-virgule.';
    else if (outside) reason = 'Mesures trop anciennes (plus de 8 jours) ou dans le futur : rien n’a été gardé.';
  }
  return { samples, autres, total, rejected: noTime + noZone + badValue + outside, reason, fromPhone, sources, mismatch };
}

const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

// Message affiché par le Raccourci à la fin.
const NOMS = { dist: 'de distance', kcal: 'd’énergie', puiss: 'de puissance', pas: 'de pas', nage: 'de nage', mvt: 'de mouvements de nage' };
export function importMessage(samples, added, autres = {}, diag = {}) {
  const all = [...samples, ...Object.values(autres).flat()].map((x) => x[0]).sort((a, b) => a - b);
  if (!all.length) return 'Foulée : aucune mesure reçue.';
  const first = all[0];
  const last = all.at(-1);
  const span = day(first) === day(last) ? `${day(first)}, de ${hm(first)} à ${hm(last)}` : `du ${day(first)} ${hm(first)} au ${day(last)} ${hm(last)}`;
  const neuves = added === samples.length ? '' : added === 0 ? ' (déjà reçues avant)' : ` (dont ${added} nouvelles)`;
  const extra = Object.entries(autres).filter(([, l]) => l.length).map(([k, l]) => `${l.length} ${NOMS[k]}`);
  const parts = [samples.length ? `${samples.length} mesures de cardio${neuves}` : '', ...extra].filter(Boolean);
  // Diagnostic : d'où viennent les mesures, pour repérer un Raccourci mal réglé.
  const notes = [];
  if (diag.fromPhone) notes.push(`${diag.fromPhone} d’un autre appareil que la montre écartées`);
  const sansSource = Object.entries(diag.sources || {}).filter(([, s]) => s.sans && !s.noms.length).map(([k]) => NOMS[k]);
  if (sansSource.length) notes.push(`attention, mesures ${sansSource.join(', ')} sans « Source » : celles de l’iPhone ne peuvent pas être écartées`);
  if (diag.mismatch) notes.push(`attention, ${diag.mismatch} type(s) refusé(s) : « #dates » et « #valeurs » n’ont pas le même nombre de lignes`);
  const noms = [...new Set(Object.values(diag.sources || {}).flatMap((s) => s.noms))];
  if (noms.length) notes.push(`appareils vus : ${noms.join(', ')}`);
  const info = notes.length ? ` (${notes.join(' ; ')})` : '';
  return `Foulée : ${parts.join(', ')} reçues, ${span}${info}. Ouvre Foulée : elles s’ajoutent toutes seules à ta séance.`;
}
