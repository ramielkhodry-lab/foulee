// Conseils de l'IA après un bilan : Cloudflare Workers AI, palier gratuit (10 000 neurones
// par jour pour tout le compte, remis à zéro à 00:00 UTC). L'IA écrit les conseils, elle ne
// touche jamais au programme : palier, longueurs et charges restent décidés par les règles.

export const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
// Par personne et par jour : protège le quota commun si un téléphone boucle.
export const USER_DAILY = 15;
const MAX_TEXT = 1200;

export class IaError extends Error {
  // code : 'quota' (quota gratuit du compte épuisé), 'limite' (limite de la personne),
  // 'indisponible' (l'IA ne répond pas ou répond mal).
  constructor(code, message, resetAt = null) {
    super(message);
    this.code = code;
    this.resetAt = resetAt;
  }
}

// Prochaine remise à zéro des quotas : minuit UTC.
export function nextReset(t = Date.now()) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const clip = (s, n = MAX_TEXT) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const note = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

// Seuls ces champs partent vers l'IA, raccourcis : rien d'autre du compte.
export function cleanInput(body = {}) {
  const b = body.bilan || {};
  return {
    sport: ['course', 'natation', 'muscu'].includes(b.sport) ? b.sport : 'course',
    seance: clip(b.seance, 400),
    difficulte: note(b.difficulte),
    essoufflement: note(b.essoufflement),
    fatigue: note(b.fatigue),
    douleur: clip(b.douleur, 200),
    ressenti: clip(b.ressenti),
    suite: clip(body.suite, 400),
    objectif: clip(body.objectif, 120),
    precedentes: (Array.isArray(body.precedentes) ? body.precedentes : []).slice(0, 5).map((s) => clip(s, 200)),
  };
}

const SYSTEM = `Tu es le coach de Foulée, une app de course à pied, natation et musculation pour débutants.
On te donne le bilan d'une séance qui vient d'être faite. Tu écris 2 à 4 conseils pour la prochaine séance du même sport.
Règles :
- Tutoie, français simple, phrases courtes. Chaque conseil fait au plus 280 caractères.
- Pars d'abord de ce que la personne a écrit dans son ressenti : réponds à son problème précis, avec un geste ou un exercice concret qu'elle peut faire.
- Tu ne changes jamais le programme (palier, durée, longueurs, charges) : il est déjà décidé et t'est donné dans « suite ». Tu peux l'expliquer.
- Douleur : aucun diagnostic. Dis de ne pas forcer et de voir un médecin si elle dure plus de 3 jours ou augmente.
- N'invente aucun chiffre que la personne n'a pas donné (pas de fréquence cardiaque, pas d'allure).
- Pas de formule creuse ni de félicitations génériques.
Réponds uniquement avec ce JSON, sans texte autour : {"conseils": ["...", "..."]}`;

export function buildMessages(input) {
  const lignes = [
    `Sport : ${input.sport}`,
    input.objectif && `Objectif : ${input.objectif}`,
    input.seance && `Séance faite : ${input.seance}`,
    input.difficulte && `Difficulté : ${input.difficulte}/5`,
    input.essoufflement && `Essoufflement : ${input.essoufflement}/5`,
    input.fatigue && `Fatigue : ${input.fatigue}/5`,
    input.douleur && `Douleur : ${input.douleur}`,
    input.ressenti && `Ressenti : « ${input.ressenti} »`,
    input.suite && `Suite décidée par le programme : ${input.suite}`,
    input.precedentes.length && `Séances précédentes : ${input.precedentes.join(' | ')}`,
  ].filter(Boolean);
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: lignes.join('\n') },
  ];
}

// Réponse du modèle → liste de conseils, ou null si elle est inutilisable.
export function parseConseils(out) {
  const raw = typeof out?.response === 'object' && out.response ? out.response : out?.response ?? out;
  let obj = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  const list = Array.isArray(obj?.conseils) ? obj.conseils : null;
  if (!list) return null;
  const clean = list.filter((s) => typeof s === 'string').map((s) => clip(s, 400)).filter((s) => s.length >= 10).slice(0, 4);
  return clean.length ? clean : null;
}

// Le quota gratuit épuisé se reconnaît au code 4006 de Workers AI.
const isQuota = (e) => /4006|daily free allocation|neurons/i.test(String(e?.message || e));

async function countUse(env, userId, t) {
  const day = utcDay(t);
  const row = await env.DB.prepare(
    'INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(userId, day).first();
  return row?.n ?? 1;
}

export async function conseilsIA(env, userId, body, t = Date.now()) {
  if (!env.AI) throw new IaError('indisponible', 'IA non configurée sur le serveur');
  const n = await countUse(env, userId, t);
  if (n > USER_DAILY) throw new IaError('limite', `Limite de ${USER_DAILY} analyses par jour atteinte`, nextReset(t));
  const input = cleanInput(body);
  let out;
  try {
    out = await env.AI.run(MODEL, { messages: buildMessages(input), max_tokens: 500, temperature: 0.4 });
  } catch (e) {
    if (isQuota(e)) throw new IaError('quota', 'Quota gratuit de l’IA épuisé pour aujourd’hui', nextReset(t));
    console.error('IA', e);
    throw new IaError('indisponible', 'L’IA ne répond pas');
  }
  const conseils = parseConseils(out);
  if (!conseils) throw new IaError('indisponible', 'Réponse de l’IA illisible');
  return { conseils, model: MODEL.split('/').pop(), at: t };
}
