import { conseils, hasIA } from './conseils.js';

// Conseils de l'IA côté app : ce qu'on envoie au serveur, quand réessayer après un échec,
// et le message qui dit pourquoi l'IA n'a pas répondu et quand elle reprend.

const sportOf = (h) => h.sport || 'course';
const dateOnly = (d) => String(d).slice(0, 10);
const RETRY_MIN = 10; // IA qui ne répond pas : nouvel essai au plus tôt 10 min après
const RECENT_DAYS = 7; // bilans plus anciens : jamais envoyés

// Résumé d'une séance en une ligne, pour l'IA.
export function seanceText(h) {
  const sport = sportOf(h);
  const parts = [];
  if (h.elapsedSec) parts.push(`${Math.round(h.elapsedSec / 60)} min`);
  if (sport === 'natation' && h.swim) {
    if (h.swim.longueurs) parts.push(`${h.swim.longueurs} longueurs de ${h.swim.bassinM || 25} m`);
    if (h.swim.nages?.length) parts.push(`nages : ${h.swim.nages.join(', ')}`);
    if (h.swim.detail) parts.push(h.swim.detail);
  } else if (sport === 'muscu') {
    for (const x of h.exercices || []) parts.push(`${x.nom.split(' (')[0]} ${x.poids ? `${x.poids} kg ` : ''}× ${(x.reps || []).join('/')}`);
  } else {
    parts.push(h.sessionName || h.structure || 'course');
    if (h.structure && h.sessionName) parts.push(h.structure);
    if (h.distanceKm) parts.push(`${h.distanceKm} km`);
    if (h.steps && h.completedSteps !== undefined) parts.push(`${h.completedSteps} étapes faites sur ${h.steps.length}`);
  }
  return parts.join(', ');
}

const notesText = (h) => [h.difficulte && `difficulté ${h.difficulte}/5`, h.essoufflement && `essoufflement ${h.essoufflement}/5`, h.fatigue && `fatigue ${h.fatigue}/5`].filter(Boolean).join(', ');

// Ce qui part vers le serveur : le bilan, la suite décidée par les règles, 4 séances précédentes.
export function iaInput(entry, history, suite, objectif = '') {
  const before = history
    .filter((h) => sportOf(h) === sportOf(entry) && h.id !== entry.id && dateOnly(h.date) <= dateOnly(entry.date))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 4)
    .map((h) => `${dateOnly(h.date)} : ${seanceText(h)}${notesText(h) ? ` (${notesText(h)})` : ''}`);
  return {
    bilan: {
      sport: sportOf(entry),
      seance: seanceText(entry),
      difficulte: entry.difficulte ?? null,
      essoufflement: entry.essoufflement ?? null,
      fatigue: entry.fatigue ?? null,
      douleur: entry.douleur || '',
      ressenti: entry.commentaire || '',
    },
    suite: suite ? `${suite.titre}. ${suite.detail}`.trim() : '',
    objectif,
    base: conseils(entry),
    precedentes: before,
  };
}

// Prochain essai permis après un échec (ms) : la remise à zéro du quota, ou 10 min plus tard.
export const retryAt = (fail) => (fail.resetAt && (fail.code === 'quota' || fail.code === 'limite') ? fail.resetAt : fail.at + RETRY_MIN * 60_000);

// Bilans à faire lire par l'IA : le dernier de chaque sport, récent, sans conseils de l'IA,
// et dont le dernier échec permet un nouvel essai.
export function pendingIA(history, now = Date.now()) {
  const limit = new Date(now - RECENT_DAYS * 86400_000).toLocaleDateString('sv-SE');
  const last = {};
  for (const h of history) {
    const sp = sportOf(h);
    if (!last[sp] || String(h.date) > String(last[sp].date)) last[sp] = h;
  }
  return Object.values(last).filter((h) => dateOnly(h.date) >= limit && !hasIA(h) && (!h.iaEchec || now >= retryAt(h.iaEchec)));
}

// Derniers bilans dont l'IA a échoué (pour l'alerte de l'accueil).
export function failedIA(history, now = Date.now()) {
  const limit = new Date(now - RECENT_DAYS * 86400_000).toLocaleDateString('sv-SE');
  const last = {};
  for (const h of history) {
    const sp = sportOf(h);
    if (!last[sp] || String(h.date) > String(last[sp].date)) last[sp] = h;
  }
  return Object.values(last).filter((h) => dateOnly(h.date) >= limit && !hasIA(h) && h.iaEchec);
}

// « cette nuit à 01:00 », « aujourd'hui à 14:30 », « demain à 09:00 ».
export function whenLabel(t, now = Date.now()) {
  const d = new Date(t);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x).toLocaleDateString('sv-SE');
  if (day(t) === day(now)) return `aujourd'hui à ${hm}`;
  if (day(t) === day(now + 86400_000)) return d.getHours() < 6 ? `cette nuit à ${hm}` : `demain à ${hm}`;
  return `le ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${hm}`;
}

// Pourquoi l'IA n'a pas répondu, et quand elle reprend.
export function failureMessage(fail, now = Date.now()) {
  const when = fail.resetAt ? whenLabel(fail.resetAt, now) : null;
  switch (fail.code) {
    case 'quota':
      return `Quota gratuit de l'IA épuisé pour aujourd'hui (il est commun à tous les comptes Foulée). Il reprend ${when} : l'app redemandera toute seule à la prochaine ouverture après cette heure.`;
    case 'limite':
      return `Tu as utilisé tes 15 analyses IA du jour. Reprise ${when}.`;
    case 'horsligne':
      return "Pas de connexion : l'IA n'a pas pu lire ton bilan. Nouvel essai à la prochaine ouverture de l'app avec du réseau.";
    case 'nonconnecte':
      return "Connecte-toi à ton compte (Profil > Mon compte) pour que l'IA lise ton ressenti.";
    default:
      return `L'IA ne répond pas pour l'instant. Nouvel essai automatique ${whenLabel(retryAt(fail), now)} au plus tôt, à l'ouverture de l'app.`;
  }
}
