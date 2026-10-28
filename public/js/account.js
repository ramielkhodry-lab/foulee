// Compte Foulée : connexion par passkey (Face ID, Touch ID, empreinte Android)
// et synchronisation des données du téléphone avec le serveur.

import { API_URL } from './config.js';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '../vendor/simplewebauthn-browser.js';

const TOKEN_KEY = 'foulee.token';
const USER_KEY = 'foulee.user';

export const serverEnabled = () => Boolean(API_URL);
export const passkeysSupported = () => browserSupportsWebAuthn();

const read = (k) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k, v) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {}
};

export function session() {
  const token = read(TOKEN_KEY);
  if (!token) return null;
  try {
    return { token, user: JSON.parse(read(USER_KEY)) };
  } catch {
    return { token, user: null };
  }
}

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${read(TOKEN_KEY)}`;
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('Serveur injoignable : vérifie ta connexion.'), { code: 'horsligne' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) {
    write(TOKEN_KEY, null);
    write(USER_KEY, null);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status, code: data.code, resetAt: data.resetAt });
  return data;
}

function keep({ token, user }) {
  write(TOKEN_KEY, token);
  write(USER_KEY, JSON.stringify(user));
  return user;
}

const ceremonyError = (e) => {
  if (e?.name === 'NotAllowedError') return new Error('Opération annulée.');
  if (e?.name === 'InvalidStateError') return new Error('Cet appareil a déjà une passkey pour ce compte.');
  return e;
};

export const status = () => api('/status');
export const inviteInfo = (code) => api(`/invite?code=${encodeURIComponent(code)}`);

export async function register(prenom, invite) {
  const { challengeId, options } = await api('/auth/register/options', { method: 'POST', body: { prenom, invite } });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    throw ceremonyError(e);
  }
  return keep(await api('/auth/register/verify', { method: 'POST', body: { challengeId, response } }));
}

export async function login() {
  const { challengeId, options } = await api('/auth/login/options', { method: 'POST', body: {} });
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    throw ceremonyError(e);
  }
  return keep(await api('/auth/login/verify', { method: 'POST', body: { challengeId, response } }));
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST', auth: true }); } catch {}
  write(TOKEN_KEY, null);
  write(USER_KEY, null);
}

export const me = () => api('/me', { auth: true });
export const rename = (prenom) => api('/me', { method: 'PUT', body: { prenom }, auth: true });
export const createInvite = (kind = 'join') => api('/me/invites', { method: 'POST', body: { kind }, auth: true });
export const listInvites = () => api('/me/invites', { auth: true });
export const pullData = () => api('/me/data', { auth: true });
export const askConseils = (input) => api('/me/conseils', { method: 'POST', body: input, auth: true });
export const pushData = (data) => api('/me/data', { method: 'PUT', body: { data }, auth: true });

// Fusion sans perte : séances réalisées et séances perso réunies par identifiant.
// Pour les réglages et le profil, le téléphone l'emporte, sauf s'il est neuf (aucune séance).
// À n'appeler qu'avec des données locales du même compte (voir ownLocal dans app.js).
export function mergeData(local, remote) {
  if (!remote) return local;
  const fresh = !(local.history && local.history.length);
  const pick = (l = {}, r = {}) => (fresh ? { ...l, ...r } : { ...r, ...l });
  const byId = (a = [], b = []) => {
    const out = new Map(b.map((x) => [x.id, x]));
    for (const x of a) out.set(x.id, x);
    return [...out.values()];
  };
  // Questionnaire : la réponse la plus récente l'emporte, quel que soit l'appareil.
  const lq = local.profile?.questionnaire;
  const rq = remote.profile?.questionnaire;
  const questionnaire = (lq?.answeredAt || 0) >= (rq?.answeredAt || 0) ? lq : rq;
  const profile = pick(local.profile, remote.profile);
  if (questionnaire) profile.questionnaire = questionnaire;
  return {
    ...remote,
    ...local,
    profile,
    settings: pick(local.settings, remote.settings),
    history: byId(local.history, remote.history),
    sessions: byId(local.sessions, remote.sessions),
  };
}
