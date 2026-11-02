// Cardio de l'Apple Watch : le Raccourci iPhone lit la fréquence cardiaque dans Santé et
// l'envoie ici en texte, une mesure par ligne : « <date ISO 8601>;<bpm> ».
// Fonctions pures, testées dans test/cardio.test.js ; les routes sont dans index.js.

export const MAX_BODY = 400_000; // ~10 000 lignes : une journée entière de mesures
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

// Texte → mesures [[t (ms), bpm], …] triées, sans doublon. `reason` explique un échec dans
// les mots du Raccourci, pour que la personne sache quel réglage corriger.
export function parseSamples(text, now = Date.now()) {
  const chunks = String(text ?? '').split(/(?=\d{4}-\d{2}-\d{2})/).filter((c) => ISO.test(c));
  const out = new Map();
  let noTime = 0;
  let noZone = 0;
  let badValue = 0;
  let outside = 0;
  for (const chunk of chunks) {
    const date = chunk.match(ISO)[0];
    if (!date.includes('T')) { noTime++; continue; }
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(date)) { noZone++; continue; }
    const t = Date.parse(date.replace(',', '.').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    const rest = chunk.slice(chunk.indexOf(date) + date.length);
    const m = rest.match(/\d+(?:[.,]\d+)?/);
    const bpm = m ? Math.round(Number(m[0].replace(',', '.'))) : NaN;
    if (!Number.isFinite(t)) { noTime++; continue; }
    if (!(bpm >= BPM_MIN && bpm <= BPM_MAX)) { badValue++; continue; }
    if (t > now + 10 * 60_000 || t < now - PAST_DAYS * 86400_000) { outside++; continue; }
    out.set(t, bpm);
    if (out.size > MAX_SAMPLES) break;
  }
  const samples = [...out.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_SAMPLES);
  let reason = null;
  if (!samples.length) {
    if (!chunks.length) reason = 'Aucune mesure reçue. Vérifie que le Raccourci trouve bien des échantillons de fréquence cardiaque (Santé > Fréquence cardiaque doit avoir des données aujourd’hui).';
    else if (noTime) reason = 'Les dates n’ont pas d’heure. Dans le Raccourci, touche « Date de début », choisis le format ISO 8601 et active « Inclure l’heure ».';
    else if (noZone) reason = 'Les dates n’ont pas de fuseau horaire. Dans le Raccourci, choisis le format de date ISO 8601.';
    else if (badValue) reason = 'Les valeurs ne sont pas des battements par minute. Dans le Raccourci, mets « Valeur » après le point-virgule.';
    else if (outside) reason = 'Mesures trop anciennes (plus de 8 jours) ou dans le futur : rien n’a été gardé.';
  }
  return { samples, rejected: noTime + noZone + badValue + outside, reason };
}

const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

// Message affiché par le Raccourci à la fin.
export function importMessage(samples, added) {
  if (!samples.length) return 'Foulée : aucune mesure de cardio reçue.';
  const first = samples[0][0];
  const last = samples.at(-1)[0];
  const span = day(first) === day(last) ? `${day(first)}, de ${hm(first)} à ${hm(last)}` : `du ${day(first)} ${hm(first)} au ${day(last)} ${hm(last)}`;
  const neuves = added === samples.length ? '' : added === 0 ? ' (déjà reçues avant)' : ` (dont ${added} nouvelles)`;
  return `Foulée : ${samples.length} mesures de cardio reçues${neuves}, ${span}. Ouvre Foulée : elles s’ajoutent toutes seules à ta séance.`;
}
