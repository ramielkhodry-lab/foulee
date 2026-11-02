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
// distance (km, ou m si > 5), énergie active (kcal), puissance de course (W), pas.
export const KINDS = {
  dist: { re: /^(dist|distance)/, min: 0, max: 5000 },
  kcal: { re: /^(kcal|energie|énergie|cal)/, min: 0, max: 500 },
  puiss: { re: /^(puiss|power|watt)/, min: 0, max: 1500 },
  pas: { re: /^(pas|steps?)/, min: 0, max: 10000 },
};
// Préfixe de la ligne : vide = cardio, ou le type écrit par le Raccourci (« Type » de
// l'échantillon, en français ou en anglais : « Distance de marche et de course », « Steps »…).
const kindOf = (prefix) => {
  const p = prefix.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[;|,]/g, ' ').trim();
  if (!p || /frequence|cardio|heart|^fc\b|bpm/.test(p)) return 'fc';
  if (/distance|^dist\b/.test(p)) return 'dist';
  if (/energie|energy|kcal|calor/.test(p)) return 'kcal';
  if (/puissance|power|^puiss\b/.test(p)) return 'puiss';
  if (/\bpas\b|step/.test(p)) return 'pas';
  return null;
};

// Texte → mesures triées, sans doublon. Cardio : `samples` [[t (ms), bpm], …] (une ligne
// « date;bpm », sans préfixe). Le reste : `autres` { dist, kcal, puiss, pas }. `reason`
// explique un échec dans les mots du Raccourci, pour savoir quel réglage corriger.
export function parseSamples(text, now = Date.now()) {
  const items = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
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
  for (const { kind, chunk } of items) {
    if (!kind) continue; // type inconnu : ignoré
    const date = chunk.match(ISO)[0];
    if (!date.includes('T')) { noTime++; continue; }
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(date)) { noZone++; continue; }
    const t = Date.parse(date.replace(',', '.').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    const rest = chunk.slice(chunk.indexOf(date) + date.length);
    const m = rest.match(/\d+(?:[.,]\d+)?/);
    const v = m ? Number(m[0].replace(',', '.')) : NaN;
    // Source après la valeur (« ;iPhone de Rami ») : Santé garde les pas et la distance de
    // l'iPhone ET de la montre, les deux additionnés compteraient tout en double. On garde la montre.
    const source = m ? rest.slice(m.index + m[0].length) : '';
    if (kind !== 'fc' && /iphone/i.test(source)) { fromPhone++; continue; }
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
      const val = kind === 'dist' && v > 5 ? v / 1000 : v;
      if (others[kind].size < MAX_SAMPLES) others[kind].set(t, Math.round(val * 1000) / 1000);
    }
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => a[0] - b[0]);
  const samples = sorted(out);
  const autres = Object.fromEntries(Object.entries(others).map(([k, m]) => [k, sorted(m)]));
  const total = samples.length + Object.values(autres).reduce((a, l) => a + l.length, 0);
  let reason = null;
  if (!total) {
    if (!items.length) reason = 'Aucune mesure reçue. Vérifie que le Raccourci trouve bien des échantillons de fréquence cardiaque (Santé > Fréquence cardiaque doit avoir des données aujourd’hui).';
    else if (noTime) reason = 'Les dates n’ont pas d’heure. Dans le Raccourci, touche « Date de début », choisis le format ISO 8601 et active « Inclure l’heure ».';
    else if (noZone) reason = 'Les dates n’ont pas de fuseau horaire. Dans le Raccourci, choisis le format de date ISO 8601.';
    else if (badValue) reason = 'Les valeurs ne sont pas des battements par minute. Dans le Raccourci, mets « Valeur » après le point-virgule.';
    else if (outside) reason = 'Mesures trop anciennes (plus de 8 jours) ou dans le futur : rien n’a été gardé.';
  }
  return { samples, autres, total, rejected: noTime + noZone + badValue + outside, reason };
}

const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

// Message affiché par le Raccourci à la fin.
const NOMS = { dist: 'de distance', kcal: 'd’énergie', puiss: 'de puissance', pas: 'de pas' };
export function importMessage(samples, added, autres = {}) {
  const all = [...samples, ...Object.values(autres).flat()].map((x) => x[0]).sort((a, b) => a - b);
  if (!all.length) return 'Foulée : aucune mesure reçue.';
  const first = all[0];
  const last = all.at(-1);
  const span = day(first) === day(last) ? `${day(first)}, de ${hm(first)} à ${hm(last)}` : `du ${day(first)} ${hm(first)} au ${day(last)} ${hm(last)}`;
  const neuves = added === samples.length ? '' : added === 0 ? ' (déjà reçues avant)' : ` (dont ${added} nouvelles)`;
  const extra = Object.entries(autres).filter(([, l]) => l.length).map(([k, l]) => `${l.length} ${NOMS[k]}`);
  const parts = [samples.length ? `${samples.length} mesures de cardio${neuves}` : '', ...extra].filter(Boolean);
  return `Foulée : ${parts.join(', ')} reçues, ${span}. Ouvre Foulée : elles s’ajoutent toutes seules à ta séance.`;
}
