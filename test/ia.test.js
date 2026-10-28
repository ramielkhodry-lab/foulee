import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conseilsIA, parseConseils, buildMessages, cleanInput, nextReset, IaError, USER_DAILY } from '../worker/src/ia.js';
import { iaInput, pendingIA, failedIA, failureMessage, whenLabel, retryAt } from '../public/js/ia.js';
import { tipsOf } from '../public/js/conseils.js';
import { upcoming } from '../public/js/plan.js';

// Base D1 et Workers AI simulés.
function fakeEnv(run) {
  const usage = new Map();
  return {
    AI: run && { run },
    DB: { prepare: () => ({ bind: (user, day) => ({ first: async () => { const n = (usage.get(user + day) || 0) + 1; usage.set(user + day, n); return { n }; } }) }) },
  };
}
const swim = { id: 'n28', sport: 'natation', date: '2026-10-28', swim: { bassinM: 25, longueurs: 30, nages: ['crawl', 'brasse', 'dos'], detail: 'dos de la 16e à la 26e' }, difficulte: 4, essoufflement: 4, fatigue: 4, douleur: '', commentaire: "Quand j'inspire j'avale de l'eau et ça me coupe le rythme" };
const T = Date.UTC(2026, 9, 28, 19, 0);

test('IA : conseils lus dans la réponse du modèle, ressenti transmis', async () => {
  let sent;
  const env = fakeEnv(async (model, opts) => { sent = opts.messages; return { response: '{"conseils": ["Expire tout sous l’eau avant de tourner la tête.", "Fais 4 longueurs de crawl très lent."]}' }; });
  const r = await conseilsIA(env, 'u1', iaInput(swim, [swim], { titre: 'On garde 30 longueurs', detail: 'Dernière séance dure' }), T);
  assert.equal(r.conseils.length, 2);
  assert.match(sent[1].content, /avale de l'eau/);
  assert.match(sent[1].content, /On garde 30 longueurs/);
  assert.match(sent[0].content, /ne changes jamais le programme/);
});

test('IA : quota épuisé → code quota et reprise à minuit UTC', async () => {
  const env = fakeEnv(async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); });
  await assert.rejects(conseilsIA(env, 'u1', {}, T), (e) => e instanceof IaError && e.code === 'quota' && e.resetAt === Date.UTC(2026, 9, 29));
});

test('IA : panne, réponse illisible, limite par personne', async () => {
  await assert.rejects(conseilsIA(fakeEnv(async () => { throw new Error('timeout'); }), 'u1', {}, T), (e) => e.code === 'indisponible' && e.resetAt === null);
  await assert.rejects(conseilsIA(fakeEnv(async () => ({ response: 'Bonne séance !' })), 'u1', {}, T), (e) => e.code === 'indisponible');
  await assert.rejects(conseilsIA(fakeEnv(null), 'u1', {}, T), (e) => e.code === 'indisponible');
  const env = fakeEnv(async () => ({ response: '{"conseils":["Un conseil assez long pour passer."]}' }));
  for (let i = 0; i < USER_DAILY; i++) await conseilsIA(env, 'u1', {}, T);
  await assert.rejects(conseilsIA(env, 'u1', {}, T), (e) => e.code === 'limite');
  assert.ok(await conseilsIA(env, 'u2', {}, T), 'les autres comptes ne sont pas bloqués');
});

test('IA : réponse en JSON mode, texte autour, entrée nettoyée', () => {
  assert.deepEqual(parseConseils({ response: { conseils: ['Respire tous les 3 temps.'] } }), ['Respire tous les 3 temps.']);
  assert.deepEqual(parseConseils({ response: 'Voici : {"conseils":["Ralentis dès le départ."]} voilà' }), ['Ralentis dès le départ.']);
  assert.equal(parseConseils({ response: '{"conseils":[]}' }), null);
  const c = cleanInput({ bilan: { sport: 'x', difficulte: 9, ressenti: 'a'.repeat(5000) }, precedentes: Array(20).fill('s') });
  assert.equal(c.sport, 'course');
  assert.equal(c.difficulte, null);
  assert.equal(c.ressenti.length, 1200);
  assert.equal(c.precedentes.length, 5);
  assert.equal(buildMessages(c).length, 2);
  assert.equal(nextReset(Date.UTC(2026, 9, 28, 23, 59)), Date.UTC(2026, 9, 29));
});

test('app : conseils de l’IA prioritaires, sinon règles', () => {
  assert.match(tipsOf(swim)[0], /avales de l’eau/);
  const withIA = { ...swim, conseilsIA: { conseils: ['Conseil de l’IA sur la respiration.'] } };
  assert.deepEqual(tipsOf(withIA), ['Conseil de l’IA sur la respiration.']);
  const next = upcoming([withIA], {}, '2026-10-29', 14).find((p) => p.sport === 'natation');
  assert.equal(next.tipsSource, 'ia');
  assert.deepEqual(next.tips, ['Conseil de l’IA sur la respiration.']);
});

test('app : quand réessayer, et le message d’alerte', () => {
  const now = new Date('2026-10-28T20:10:00').getTime();
  const quota = { ...swim, iaEchec: { code: 'quota', resetAt: Date.UTC(2026, 9, 29), at: now } };
  assert.deepEqual(pendingIA([quota], now), [], 'quota : pas avant la reprise');
  assert.equal(pendingIA([quota], Date.UTC(2026, 9, 29) + 1000).length, 1, 'après la reprise : on redemande');
  assert.equal(failedIA([quota], now).length, 1);
  assert.match(failureMessage(quota.iaEchec, now), /Quota gratuit.*reprend/);
  const panne = { code: 'indisponible', at: now };
  assert.equal(retryAt(panne), now + 600_000);
  assert.match(failureMessage(panne, now), /ne répond pas/);
  assert.deepEqual(pendingIA([{ ...swim, date: '2026-10-01' }], now), [], 'vieux bilan : jamais envoyé');
  assert.equal(pendingIA([swim], now).length, 1, 'bilan récent sans conseils IA : à envoyer');
  assert.match(whenLabel(new Date('2026-10-29T01:00:00').getTime(), now), /cette nuit à 01:00/);
});
