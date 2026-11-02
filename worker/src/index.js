// API Foulée : comptes sur invitation, connexion par passkey, données privées par utilisateur.
//
// Règles de sécurité :
// - toute route sous /me lit l'utilisateur depuis le jeton de session, jamais depuis la requête ;
// - chaque requête SQL sur des données privées filtre sur cet identifiant ;
// - seul le hachage SHA-256 des jetons est stocké.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { conseilsIA, IaError } from './ia.js';
import { bodyText, parseSamples, importMessage, MAX_BODY, KEEP_DAYS } from './cardio.js';

const SESSION_DAYS = 180;
const INVITE_DAYS = 14;
const CHALLENGE_MIN = 5;
const MAX_DATA_BYTES = 1_000_000;

const now = () => Date.now();
const randomId = (bytes = 16) => isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(bytes)));

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return isoBase64URL.fromBuffer(new Uint8Array(buf));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.APP_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const plain = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

function cleanPrenom(p) {
  const s = String(p ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 40) throw new HttpError(400, 'Prénom : 1 à 40 caractères');
  return s;
}

async function currentUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new HttpError(401, 'Non connecté');
  const row = await env.DB.prepare(
    'SELECT u.id, u.prenom, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).bind(await sha256(token), now()).first();
  if (!row) throw new HttpError(401, 'Session expirée');
  return { ...row, tokenHash: await sha256(token) };
}

async function openSession(env, userId) {
  const token = randomId(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now(), now() + SESSION_DAYS * 86400_000).run();
  return token;
}

async function takeChallenge(env, id, purpose) {
  const row = await env.DB.prepare('SELECT * FROM challenges WHERE id = ? AND purpose = ?').bind(String(id), purpose).first();
  // Usage unique : supprimé dès sa lecture, même si la vérification échoue ensuite.
  await env.DB.prepare('DELETE FROM challenges WHERE id = ? OR expires_at < ?').bind(String(id), now()).run();
  if (!row || row.expires_at < now()) throw new HttpError(400, 'Demande expirée, recommence');
  return { challenge: row.challenge, data: row.data ? JSON.parse(row.data) : {} };
}

async function storeChallenge(env, challenge, purpose, data) {
  const id = randomId();
  await env.DB.prepare('INSERT INTO challenges (id, challenge, purpose, data, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, challenge, purpose, JSON.stringify(data ?? {}), now() + CHALLENGE_MIN * 60_000).run();
  return id;
}

async function usersCount(env) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
}

async function validInvite(env, code) {
  if (!code) return null;
  return env.DB.prepare('SELECT * FROM invitations WHERE code = ? AND used_at IS NULL AND expires_at > ?').bind(String(code), now()).first();
}

// --- Routes -------------------------------------------------------------------

const routes = {
  // État public minimal : sert seulement à savoir si le premier compte reste à créer.
  'GET /status': async (req, env) => ({ ok: true, firstAccount: (await usersCount(env)) === 0 }),

  'GET /invite': async (req, env) => {
    const code = new URL(req.url).searchParams.get('code');
    const inv = await validInvite(env, code);
    if (!inv) throw new HttpError(404, 'Invitation invalide ou déjà utilisée');
    const from = await env.DB.prepare('SELECT prenom FROM users WHERE id = ?').bind(inv.created_by).first();
    return { kind: inv.kind, from: from?.prenom ?? null };
  },

  // Inscription. Le tout premier compte n'a pas besoin d'invitation et devient administrateur.
  // Ensuite : invitation obligatoire. Une invitation « recover » ajoute une passkey à un compte existant.
  'POST /auth/register/options': async (req, env) => {
    const body = await readJson(req);
    const first = (await usersCount(env)) === 0;
    const inv = first ? null : await validInvite(env, body.invite);
    if (!first && !inv) throw new HttpError(403, 'Invitation invalide ou déjà utilisée');
    let userId;
    let prenom;
    let exclude = [];
    if (inv?.kind === 'recover') {
      const u = await env.DB.prepare('SELECT id, prenom FROM users WHERE id = ?').bind(inv.for_user).first();
      if (!u) throw new HttpError(404, 'Compte introuvable');
      userId = u.id;
      prenom = u.prenom;
      const creds = await env.DB.prepare('SELECT id, transports FROM credentials WHERE user_id = ?').bind(userId).all();
      exclude = creds.results.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined }));
    } else {
      userId = randomId();
      prenom = cleanPrenom(body.prenom);
    }
    const options = await generateRegistrationOptions({
      rpName: 'Foulée',
      rpID: env.RP_ID,
      userName: prenom,
      userDisplayName: prenom,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      excludeCredentials: exclude,
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challengeId = await storeChallenge(env, options.challenge, 'register', {
      userId, prenom, invite: inv?.code ?? null, recover: inv?.kind === 'recover', first,
    });
    return { challengeId, options };
  },

  'POST /auth/register/verify': async (req, env) => {
    const body = await readJson(req);
    const { challenge, data } = await takeChallenge(env, body.challengeId, 'register');
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: env.APP_ORIGIN,
        expectedRPID: env.RP_ID,
        requireUserVerification: false,
      });
    } catch (e) {
      throw new HttpError(400, `Passkey refusée : ${e.message}`);
    }
    if (!verification.verified) throw new HttpError(400, 'Passkey refusée');
    const { credential } = verification.registrationInfo;

    // L'invitation est consommée de façon atomique : deux inscriptions simultanées ne peuvent pas l'utiliser.
    if (data.first) {
      if ((await usersCount(env)) !== 0) throw new HttpError(403, 'Le premier compte existe déjà : demande une invitation');
    } else {
      const res = await env.DB.prepare('UPDATE invitations SET used_at = ?, used_by = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?')
        .bind(now(), data.userId, data.invite, now()).run();
      if (res.meta.changes !== 1) throw new HttpError(403, 'Invitation déjà utilisée');
    }
    const stmts = [];
    if (!data.recover) {
      stmts.push(env.DB.prepare('INSERT INTO users (id, prenom, is_admin, created_at) VALUES (?, ?, ?, ?)')
        .bind(data.userId, data.prenom, data.first ? 1 : 0, now()));
    }
    stmts.push(env.DB.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(credential.id, data.userId, isoBase64URL.fromBuffer(credential.publicKey), credential.counter,
        JSON.stringify(credential.transports ?? body.response?.response?.transports ?? []), now()));
    await env.DB.batch(stmts);
    const token = await openSession(env, data.userId);
    return { token, user: { id: data.userId, prenom: data.prenom } };
  },

  // Connexion : passkey « découvrable », l'appareil propose lui-même le bon compte.
  'POST /auth/login/options': async (req, env) => {
    const options = await generateAuthenticationOptions({ rpID: env.RP_ID, userVerification: 'preferred', allowCredentials: [] });
    const challengeId = await storeChallenge(env, options.challenge, 'login');
    return { challengeId, options };
  },

  'POST /auth/login/verify': async (req, env) => {
    const body = await readJson(req);
    const { challenge } = await takeChallenge(env, body.challengeId, 'login');
    const cred = await env.DB.prepare('SELECT * FROM credentials WHERE id = ?').bind(String(body.response?.id ?? '')).first();
    if (!cred) throw new HttpError(401, 'Passkey inconnue : crée ton compte avec ton invitation');
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: env.APP_ORIGIN,
        expectedRPID: env.RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: cred.counter,
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
      });
    } catch (e) {
      throw new HttpError(401, `Connexion refusée : ${e.message}`);
    }
    if (!verification.verified) throw new HttpError(401, 'Connexion refusée');
    await env.DB.prepare('UPDATE credentials SET counter = ? WHERE id = ?').bind(verification.authenticationInfo.newCounter, cred.id).run();
    const user = await env.DB.prepare('SELECT id, prenom FROM users WHERE id = ?').bind(cred.user_id).first();
    return { token: await openSession(env, cred.user_id), user };
  },

  'POST /auth/logout': async (req, env) => {
    const u = await currentUser(req, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(u.tokenHash).run();
    return { ok: true };
  },

  'GET /me': async (req, env) => {
    const u = await currentUser(req, env);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(u.id).first();
    return { id: u.id, prenom: u.prenom, admin: Boolean(u.is_admin), passkeys: n.n };
  },

  'PUT /me': async (req, env) => {
    const u = await currentUser(req, env);
    const body = await readJson(req);
    const prenom = cleanPrenom(body.prenom);
    await env.DB.prepare('UPDATE users SET prenom = ? WHERE id = ?').bind(prenom, u.id).run();
    return { id: u.id, prenom };
  },

  'GET /me/data': async (req, env) => {
    const u = await currentUser(req, env);
    const row = await env.DB.prepare('SELECT data, updated_at FROM user_data WHERE user_id = ?').bind(u.id).first();
    return row ? { data: JSON.parse(row.data), updatedAt: row.updated_at } : { data: null, updatedAt: null };
  },

  'PUT /me/data': async (req, env) => {
    const u = await currentUser(req, env);
    const text = await req.text();
    if (text.length > MAX_DATA_BYTES) throw new HttpError(413, 'Données trop volumineuses');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'JSON invalide');
    }
    if (!body || typeof body.data !== 'object') throw new HttpError(400, 'Champ data manquant');
    const t = now();
    await env.DB.prepare('INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(u.id, JSON.stringify(body.data), t).run();
    return { updatedAt: t };
  },

  // Invitation à usage unique, valable 14 jours. kind=recover : nouvel appareil pour son propre compte.
  'POST /me/invites': async (req, env) => {
    const u = await currentUser(req, env);
    const body = await readJson(req).catch(() => ({}));
    const kind = body.kind === 'recover' ? 'recover' : 'join';
    const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM invitations WHERE created_by = ? AND used_at IS NULL AND expires_at > ?').bind(u.id, now()).first();
    if (open.n >= 10) throw new HttpError(429, 'Trop d’invitations en attente');
    const code = randomId(16);
    await env.DB.prepare('INSERT INTO invitations (code, kind, created_by, for_user, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(code, kind, u.id, kind === 'recover' ? u.id : null, now(), now() + INVITE_DAYS * 86400_000).run();
    return { code, kind, url: `${env.APP_ORIGIN}${env.APP_PATH ?? '/foulee/'}?invite=${code}` };
  },

  // Conseils de l'IA sur un bilan. En cas d'échec, l'app garde les conseils des règles et
  // affiche pourquoi (code) et quand réessayer (resetAt, en ms).
  'POST /me/conseils': async (req, env) => {
    const u = await currentUser(req, env);
    return conseilsIA(env, u.id, await readJson(req));
  },

  'GET /me/invites': async (req, env) => {
    const u = await currentUser(req, env);
    const rows = await env.DB.prepare(
      'SELECT i.code, i.kind, i.created_at, i.expires_at, i.used_at, v.prenom AS used_by_prenom FROM invitations i LEFT JOIN users v ON v.id = i.used_by WHERE i.created_by = ? ORDER BY i.created_at DESC LIMIT 20',
    ).bind(u.id).all();
    return { invites: rows.results };
  },

  // Cardio de l'Apple Watch. Le jeton d'import ne sert qu'à ajouter des mesures : il ne lit
  // rien du compte. Il n'est montré qu'une fois ; en créer un nouveau invalide l'ancien.
  'GET /me/cardio/token': async (req, env) => {
    const u = await currentUser(req, env);
    const row = await env.DB.prepare('SELECT created_at, last_used_at, last_count FROM cardio_tokens WHERE user_id = ?').bind(u.id).first();
    return row ? { active: true, createdAt: row.created_at, lastUsedAt: row.last_used_at, lastCount: row.last_count } : { active: false };
  },

  'POST /me/cardio/token': async (req, env) => {
    const u = await currentUser(req, env);
    const token = `fc_${randomId(24)}`;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM cardio_tokens WHERE user_id = ?').bind(u.id),
      env.DB.prepare('INSERT INTO cardio_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), u.id, now()),
    ]);
    return { url: `${new URL(req.url).origin}/cardio?k=${token}`, createdAt: now() };
  },

  'DELETE /me/cardio/token': async (req, env) => {
    const u = await currentUser(req, env);
    await env.DB.prepare('DELETE FROM cardio_tokens WHERE user_id = ?').bind(u.id).run();
    return { active: false };
  },

  // Mesures d'une plage (4 jours au plus), pour les rattacher aux séances sur le téléphone.
  'GET /me/cardio': async (req, env) => {
    const u = await currentUser(req, env);
    const q = new URL(req.url).searchParams;
    const from = Number(q.get('from'));
    const to = Number(q.get('to'));
    if (!q.get('from') || !q.get('to') || !Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 4 * 86400_000) throw new HttpError(400, 'Plage invalide');
    const [rows, other] = await env.DB.batch([
      env.DB.prepare('SELECT t, bpm FROM cardio_samples WHERE user_id = ? AND t >= ? AND t <= ? ORDER BY t LIMIT 20000').bind(u.id, from, to),
      env.DB.prepare('SELECT kind, t, v FROM sante_samples WHERE user_id = ? AND t >= ? AND t <= ? ORDER BY t LIMIT 20000').bind(u.id, from, to),
    ]);
    const autres = {};
    for (const r of other.results) (autres[r.kind] ||= []).push([r.t, r.v]);
    return { samples: rows.results.map((r) => [r.t, r.bpm]), autres };
  },
};

// Import par le Raccourci iPhone : réponse en texte, affichée telle quelle par le Raccourci.
async function importCardio(request, env) {
  if (request.method !== 'POST') return plain('Foulée : le Raccourci doit utiliser la méthode POST.', 405);
  const token = new URL(request.url).searchParams.get('k') || (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const hash = token ? await sha256(token) : null;
  const row = hash ? await env.DB.prepare('SELECT user_id FROM cardio_tokens WHERE token_hash = ?').bind(hash).first() : null;
  if (!row) return plain('Foulée : lien d’import inconnu ou remplacé. Copie le nouveau lien depuis Foulée > Profil > Cardio Apple Watch.', 401);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return plain('Foulée : trop de mesures d’un coup. Dans le Raccourci, garde seulement les mesures d’aujourd’hui.', 413);
  const { samples, autres, total, reason } = parseSamples(bodyText(raw), now());
  if (!total) return plain(`Foulée : ${reason}`, 400);
  const stmts = [];
  for (let i = 0; i < samples.length; i += 30) {
    const part = samples.slice(i, i + 30);
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO cardio_samples (user_id, t, bpm) VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`)
      .bind(...part.flatMap(([t, bpm]) => [row.user_id, t, bpm])));
  }
  const inserts = stmts.length;
  for (const [kind, list] of Object.entries(autres)) {
    for (let i = 0; i < list.length; i += 25) {
      const part = list.slice(i, i + 25);
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO sante_samples (user_id, kind, t, v) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')}`)
        .bind(...part.flatMap(([t, v]) => [row.user_id, kind, t, v])));
    }
  }
  const old = now() - KEEP_DAYS * 86400_000;
  stmts.push(env.DB.prepare('DELETE FROM cardio_samples WHERE user_id = ? AND t < ?').bind(row.user_id, old));
  stmts.push(env.DB.prepare('DELETE FROM sante_samples WHERE user_id = ? AND t < ?').bind(row.user_id, old));
  stmts.push(env.DB.prepare('UPDATE cardio_tokens SET last_used_at = ?, last_count = ? WHERE token_hash = ?').bind(now(), total, hash));
  const res = await env.DB.batch(stmts);
  const added = res.slice(0, inserts).reduce((a, r) => a + (r.meta?.changes || 0), 0);
  return plain(importMessage(samples, added, autres));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const url = new URL(request.url);
    if (url.pathname === '/cardio') {
      try {
        return await importCardio(request, env);
      } catch (e) {
        console.error(e);
        return plain('Foulée : erreur du serveur, réessaie dans un moment.', 500);
      }
    }
    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) return json(env, { error: 'Introuvable' }, 404);
    try {
      return json(env, await handler(request, env));
    } catch (e) {
      if (e instanceof HttpError) return json(env, { error: e.message }, e.status);
      if (e instanceof IaError) return json(env, { error: e.message, code: e.code, resetAt: e.resetAt }, e.code === 'indisponible' ? 503 : 429);
      console.error(e);
      return json(env, { error: 'Erreur serveur' }, 500);
    }
  },
};
