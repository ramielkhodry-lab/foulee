import { KINDS } from './phrases.js';
import { assemble, stepAt } from './track.js';
import { load, update, uid, PRESETS } from './store.js';
import { createTrack, addPoint, markGap, summary } from './gps.js';
import { upcoming } from './plan.js';

const app = document.getElementById('app');
const audio = document.getElementById('player');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mmss = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const minutesLabel = (sec) => (sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);
const total = (steps) => steps.reduce((a, s) => a + s.duration, 0);
const JOURS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
const dateLabel = (d) => new Date(String(d).length === 10 ? `${d}T12:00` : d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const allure = (secKm) => `${Math.floor(secKm / 60)}'${String(Math.round(secKm % 60)).padStart(2, '0')}/km`;

// Résumé court d'une séance : « 5 min marche · 6 × (3 min course + 2 min marche) · 5 min marche ».
function stepsSummary(steps) {
  const runs = steps.filter((s) => KINDS[s.kind].effort === 'course');
  const first = steps[0];
  const lastStep = steps.at(-1);
  const middle = steps.slice(1, -1);
  const body = runs.length > 1 && new Set(runs.map((r) => r.duration)).size === 1
    ? `${runs.length} × ${minutesLabel(runs[0].duration)} de course`
    : middle.map((s) => `${minutesLabel(s.duration)} ${KINDS[s.kind].effort}`).join(', ');
  return `${minutesLabel(first.duration)} marche · ${body} · ${minutesLabel(lastStep.duration)} marche`;
}

function planCard(p, isToday, showNow = false) {
  const label = isToday ? "Aujourd'hui" : dateLabel(p.date);
  if (p.sport === 'repos') {
    return `<div class="card"><p><span class="pill" style="background:#E2E9E3">Repos</span> <strong>${label}</strong></p><p class="muted small">${esc(p.reason)}</p></div>`;
  }
  if (p.sport === 'natation') {
    return `
      <div class="card${isToday ? ' dark' : ''}">
        <p><span class="pill">Natation</span> <strong>${label}</strong></p>
        <h2 style="margin-top:8px">${p.longueurs} longueurs · ${p.distance} m</h2>
        ${isToday ? `<ul class="steps">${p.plan.map((l) => `<li><span>${esc(l)}</span></li>`).join('')}</ul>` : ''}
        <p class="muted small" style="margin-top:8px">${esc(p.reason)}</p>
        ${isToday ? `<p style="margin-top:12px"><button class="btn-primary" data-manual="natation">Noter ma séance</button></p>` : ''}
      </div>`;
  }
  const mins = Math.round(total(p.steps) / 60);
  return `
    <div class="card${isToday ? ' dark' : ''}">
      <p><span class="pill">Course</span> <strong>${label}</strong> <span class="muted small">· palier ${p.level}/12</span></p>
      <h2 style="margin-top:8px">${mins} min · ${esc(p.title)}</h2>
      <p class="small">${esc(stepsSummary(p.steps))}</p>
      <p class="muted small">${esc(p.reason)}</p>
      ${isToday ? `<p style="margin-top:12px"><button class="btn-primary" data-startplan="${esc(p.date)}">Démarrer la séance</button></p>` : showNow ? `<p style="margin-top:10px"><button data-startplan="${esc(p.date)}" style="width:100%">La faire maintenant</button></p>` : ''}
    </div>`;
}

function journalCard(h) {
  const sport = h.sport || 'course';
  const parts = [];
  if (h.elapsedSec) parts.push(`${Math.round(h.elapsedSec / 60)} min`);
  if (sport === 'natation' && h.swim?.longueurs) parts.push(`${h.swim.longueurs} × ${h.swim.bassinM} m = ${h.swim.longueurs * h.swim.bassinM} m`);
  if (h.distanceKm && sport !== 'natation') parts.push(`${h.distanceKm.toLocaleString('fr-FR')} km${h.distanceEstimee ? ' (estimé)' : ''}`);
  if (h.allureSecKm) parts.push(`allure ${allure(h.allureSecKm)}`);
  if (h.gpsIncomplet) parts.push('GPS incomplet');
  if (h.steps && h.source === 'guidee') parts.push(`${h.completedSteps}/${h.steps.length} étapes`);
  const feel = [
    h.difficulte && `difficulté ${h.difficulte}/5`,
    h.essoufflement && `essoufflement ${h.essoufflement}/5`,
    h.fatigue && `fatigue ${h.fatigue}/5`,
    h.douleur && `douleur : ${esc(h.douleur)}`,
  ].filter(Boolean);
  return `
    <div class="card">
      <p><span class="pill">${sport === 'natation' ? 'Natation' : 'Course'}</span> <strong>${dateLabel(h.date)}</strong></p>
      <p class="muted">${parts.join(' · ')}</p>
      ${sport === 'natation' && h.swim?.nages?.length ? `<p class="small">${esc(h.swim.nages.join(', '))}${h.swim.detail ? ` · ${esc(h.swim.detail)}` : ''}</p>` : ''}
      ${h.structure ? `<p class="small">${esc(h.structure)}</p>` : ''}
      ${feel.length ? `<p class="muted small">${feel.join(' · ')}</p>` : ''}
      ${h.commentaire ? `<p>« ${esc(h.commentaire)} »</p>` : ''}
    </div>`;
}

// --- Sons -------------------------------------------------------------------

// À changer à chaque régénération des clips : l'URL change, donc aucun ancien cache ne sert.
const AUDIO_VERSION = '3';
let audioAssets = null;
async function loadAudio() {
  if (audioAssets) return audioAssets;
  const get = (f) => fetch(`audio/${f}?v=${AUDIO_VERSION}`).then((r) => {
    if (!r.ok) throw new Error(`${f} : ${r.status}`);
    return r;
  });
  const [index, pack] = await Promise.all([
    get('index.json').then((r) => r.json()),
    get('pack.mp3').then((r) => r.arrayBuffer()),
  ]);
  audioAssets = { index, pack: new Uint8Array(pack) };
  return audioAssets;
}
loadAudio().catch(() => {});

function applyAudioMode() {
  // Musique (défaut) : se superpose à la musique ; écran allumé requis.
  // Exclusif : continue écran verrouillé mais met la musique en pause.
  if (!('audioSession' in navigator)) return;
  try {
    navigator.audioSession.type = load().settings.son === 'exclusif' ? 'playback' : 'ambient';
  } catch {}
}

// --- Séance en cours ----------------------------------------------------------

let live = null; // { session, track, url, skipped:Set, maxTime, lastStep }

const localNow = () => new Date().toLocaleString('sv-SE').replace(' ', 'T'); // AAAA-MM-JJTHH:MM:SS, heure locale

function startSession(session, resume = null) {
  if (!audioAssets) {
    alert('Les sons ne sont pas encore chargés. Vérifie ta connexion et réessaie dans quelques secondes.');
    loadAudio().catch(() => {});
    return;
  }
  // Tout se fait sans attente pour rester dans le geste de l'utilisateur :
  // iOS refuse de lancer l'audio sinon.
  let track;
  try {
    track = assemble(session.steps, audioAssets.index, audioAssets.pack, { voice: load().settings.annonces === 'voix' });
  } catch (e) {
    alert(`Impossible de préparer la séance : ${e.message}. Ferme et rouvre Foulée pour la mettre à jour.`);
    return;
  }
  if (live) URL.revokeObjectURL(live.url);
  const url = URL.createObjectURL(new Blob([track.bytes], { type: 'audio/mpeg' }));
  stopLiveExtras();
  live = {
    session, track, url, skipped: new Set(resume?.skipped || []), maxTime: resume?.pos || 0, lastStep: null,
    startedAt: resume?.startedAt || localNow(), gps: createTrack(), gpsError: null, userPaused: false,
  };
  if (resume) live.gps.gaps = 1; // la mesure d'avant l'interruption est perdue
  applyAudioMode();
  audio.src = url;
  audio.currentTime = resume?.pos || 0;
  audio.play().catch((e) => alert(`Lecture impossible : ${e.message}`));
  if (load().settings.son === 'exclusif') setupMediaSession();
  startGps();
  keepAwake();
  saveLive();
  go('live');
}

// Si iOS ferme l'app pendant la séance (mémoire, appel, fausse manip), on peut reprendre.
const LIVE_KEY = 'foulee.live';
let lastLiveSave = 0;
function saveLive() {
  if (!live) return;
  lastLiveSave = Date.now();
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify({
      session: live.session, startedAt: live.startedAt, pos: audio.currentTime || live.maxTime, skipped: [...live.skipped], savedAt: Date.now(),
    }));
  } catch {}
}
function clearLive() {
  try { localStorage.removeItem(LIVE_KEY); } catch {}
}
function savedLive() {
  try {
    const s = JSON.parse(localStorage.getItem(LIVE_KEY));
    return s && Date.now() - s.savedAt < 3 * 3600 * 1000 ? s : null;
  } catch {
    return null;
  }
}

// GPS : actif tant que la page est à l'écran. Écran verrouillé = coupure notée.
let gpsWatch = null;
function startGps() {
  if (!('geolocation' in navigator)) { live.gpsError = 'GPS indisponible'; return; }
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      if (!live) return;
      live.gpsError = null;
      // Pas de distance pendant une pause : on ne compte que le temps de séance.
      if (audio.paused) return;
      addPoint(live.gps, { lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp, acc: pos.coords.accuracy });
    },
    (err) => { if (live) live.gpsError = err.code === 1 ? 'GPS refusé' : 'GPS en attente'; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}

// Empêche l'iPhone de verrouiller l'écran pendant la séance (Safari 16.4+).
// Repli (anciennes versions d'iOS, webapp d'écran d'accueil) : une vidéo muette en boucle
// empêche aussi la mise en veille, sans toucher à la musique.
let wakeLock = null;
let wakeVideo = null;
async function keepAwake() {
  if (document.visibilityState !== 'visible') return;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      return;
    }
  } catch {}
  if (!wakeVideo) {
    wakeVideo = document.createElement('video');
    Object.assign(wakeVideo, { src: 'media/veille.mp4', muted: true, loop: true, playsInline: true });
    wakeVideo.setAttribute('playsinline', '');
    wakeVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;left:0';
    document.body.appendChild(wakeVideo);
  }
  wakeVideo.play().catch(() => {});
}

function stopLiveExtras() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  wakeVideo?.pause();
  touchLocked = false;
}

document.addEventListener('visibilitychange', () => {
  if (!live || current !== 'live') return;
  if (document.visibilityState === 'hidden') markGap(live.gps);
  else keepAwake();
});

// Verrou tactile : en poche, l'écran allumé ne doit pas réagir au tissu.
let touchLocked = false;
let unlockTimer = null;
function renderTouchLock() {
  let el = document.getElementById('touchlock');
  if (!touchLocked) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'touchlock';
  el.innerHTML = '<div class="lockhint">Écran verrouillé<br><span class="small">Appui long 2 secondes pour déverrouiller</span></div>';
  const cancel = () => { clearTimeout(unlockTimer); el.classList.remove('pressing'); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('pressing');
    unlockTimer = setTimeout(() => { touchLocked = false; renderTouchLock(); }, 2000);
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(el);
}

function seekToStep(i) {
  if (!live) return;
  const { starts, end } = live.track;
  const t = i >= starts.length ? end : starts[Math.max(0, i)];
  audio.currentTime = t;
}

function nextStep() {
  if (!live) return;
  const cur = stepAt(live.track.starts, live.track.end, audio.currentTime);
  if (cur >= 0 && cur < live.session.steps.length) live.skipped.add(cur);
  seekToStep(cur + 1);
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action, fn) => {
    try { ms.setActionHandler(action, fn); } catch {}
  };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('nexttrack', nextStep);
  set('previoustrack', () => seekToStep(stepAt(live.track.starts, live.track.end, audio.currentTime)));
  set('seekforward', null);
  set('seekbackward', null);
  updateMediaMetadata(-1);
}

function updateMediaMetadata(i) {
  if (!('mediaSession' in navigator) || !live) return;
  const steps = live.session.steps;
  const title = i < 0 ? 'Introduction' : i >= steps.length ? 'Séance terminée' : `${KINDS[steps[i].kind].label} · ${minutesLabel(steps[i].duration)}`;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: `Foulée · ${live.session.name}`,
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch {}
}

audio.addEventListener('timeupdate', () => {
  if (!live) return;
  live.maxTime = Math.max(live.maxTime, audio.currentTime);
  if (Date.now() - lastLiveSave > 5000) saveLive();
  const i = stepAt(live.track.starts, live.track.end, audio.currentTime);
  if (i !== live.lastStep) {
    live.lastStep = i;
    updateMediaMetadata(i);
  }
});
audio.addEventListener('ended', () => {
  if (live && current === 'live') go('bilan');
});
audio.addEventListener('pause', () => {
  saveLive();
  if (current === 'live') render();
});
audio.addEventListener('play', () => {
  if (live) live.userPaused = false;
  if (current === 'live') render();
});

// Affichage du lecteur : relu à chaque image depuis la position de la piste, donc sans dérive.
function tick() {
  if (current !== 'live' || !live) return;
  const { starts, end } = live.track;
  const steps = live.session.steps;
  const t = audio.currentTime;
  const i = stepAt(starts, end, t);
  const el = (id) => document.getElementById(id);
  if (!el('count')) return;
  // Changement d'étape : l'écran clignote (citron = course, blanc = marche).
  if (live.shownStep !== undefined && i !== live.shownStep && i >= 0 && i < steps.length) {
    const flash = KINDS[steps[i].kind].effort === 'course' ? 'flash-course' : 'flash-marche';
    document.body.classList.remove('flash-course', 'flash-marche');
    void document.body.offsetWidth;
    document.body.classList.add(flash);
    setTimeout(() => document.body.classList.remove(flash), 1500);
  }
  live.shownStep = i;
  if (i < 0) {
    el('now').textContent = 'Prépare-toi';
    el('count').textContent = mmss(starts[0] - t);
    el('next').textContent = `Ensuite : ${KINDS[steps[0].kind].label}`;
  } else if (i >= steps.length) {
    el('now').textContent = 'Terminé !';
    el('count').textContent = '0:00';
    el('next').textContent = '';
  } else {
    el('now').textContent = KINDS[steps[i].kind].label;
    el('count').textContent = mmss(starts[i] + steps[i].duration - t);
    const n = steps[i + 1];
    el('next').textContent = n ? `Ensuite : ${KINDS[n.kind].label} · ${minutesLabel(n.duration)}` : 'Dernière étape';
  }
  el('stepno').textContent = i < 0 ? '' : `Étape ${Math.min(i + 1, steps.length)} sur ${steps.length}`;
  el('progress').style.width = `${Math.min(100, ((t - starts[0]) / (end - starts[0])) * 100)}%`;
  el('elapsed').textContent = `${mmss(Math.max(0, t - starts[0]))} / ${mmss(end - starts[0])}`;
  const g = summary(live.gps, Math.max(0, t - starts[0]));
  el('gps').textContent = live.gpsError
    ? live.gpsError
    : g.distanceKm
      ? `${g.distanceKm.toLocaleString('fr-FR')} km${g.allureSecKm ? ` · ${allure(g.allureSecKm)}` : ''}${g.gpsIncomplet ? ' · GPS coupé un moment' : ''}`
      : 'GPS : recherche…';
  requestAnimationFrame(tick);
}

// --- Écrans -------------------------------------------------------------------

let current = 'accueil';
let editing = null; // séance en cours d'édition (copie)
let bilan = null; // formulaire de bilan en cours

const screens = {
  accueil() {
    const d = load();
    const last = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const plan = upcoming(d.history, d.settings, today(), 14);
    const todayItem = plan.find((p) => p.date === today());
    const resumable = live ? null : savedLive();
    const next = plan.filter((p) => p.sport !== 'repos' && p.date !== today()).slice(0, 2);
    const hello = d.profile.prenom ? `Bonjour ${esc(d.profile.prenom)} !` : 'Bonjour !';
    return `
      <h1>${hello}</h1>
      ${installed ? '' : '<div class="notice"><strong>Installe Foulée :</strong> dans Safari, touche Partager puis « Sur l\'écran d\'accueil », et ouvre l\'app depuis son icône. Le guidage est plus fiable ainsi.</div>'}
      ${resumable ? `<div class="alert">Séance interrompue : « ${esc(resumable.session.name)} », arrêtée à ${mmss(resumable.pos)}.
        <div class="row" style="margin-top:10px"><button class="btn-dark" data-resume>Reprendre</button><button data-dropresume>Abandonner</button></div></div>` : ''}
      ${todayItem ? planCard(todayItem, true) : `<div class="card dark"><span class="pill">Aujourd'hui</span><h2 style="margin-top:10px">Repos</h2><p class="muted">Le repos fait partie de l'entraînement : c'est là que le corps progresse.</p></div>`}
      ${next.length ? `<h2 style="margin:4px 0 10px">Ensuite</h2>${next.map((p) => planCard(p, false, !todayItem?.steps && p === next.find((x) => x.sport === 'course'))).join('')}` : ''}
      ${last ? `<h2 style="margin:4px 0 10px">Dernière séance</h2>${journalCard(last)}` : ''}`;
  },

  programme() {
    const d = load();
    const plan = upcoming(d.history, d.settings, today(), 14);
    const firstRun = plan.some((p) => p.date === today() && p.sport === 'course') ? null : plan.find((p) => p.sport === 'course');
    return `
      <h1>Programme</h1>
      <p class="muted">Les 2 prochaines semaines, recalculées après chaque bilan selon ton ressenti. Jours modifiables dans Réglages.</p>
      ${plan.length ? plan.map((p) => planCard(p, p.date === today(), p === firstRun)).join('') : '<p class="muted">Aucune séance prévue : choisis tes jours dans Réglages.</p>'}
      <h2 style="margin:20px 0 10px">Séances perso</h2>
      ${screens.seance(true)}`;
  },

  seance(embedded) {
    const d = load();
    return `
      ${embedded ? '' : '<h1>Séances</h1>'}
      ${d.sessions.map((s) => `
        <div class="card">
          <h2>${esc(s.name)}</h2>
          <p class="muted">${minutesLabel(total(s.steps))} · ${s.steps.length} étapes</p>
          <div class="row"><button class="btn-dark" data-start="${esc(s.id)}">Démarrer</button><button data-edit="${esc(s.id)}">Modifier</button></div>
        </div>`).join('')}
      <button data-new style="width:100%">+ Nouvelle séance</button>`;
  },

  edit() {
    const s = editing;
    const opts = (k) => Object.entries(KINDS).map(([id, v]) => `<option value="${id}" ${id === k ? 'selected' : ''}>${v.label}</option>`).join('');
    return `
      <h1>${s.isNew ? 'Nouvelle séance' : 'Modifier la séance'}</h1>
      <div class="card">
        <label for="name">Nom</label>
        <input id="name" value="${esc(s.name)}" maxlength="60">
        <label>Étapes <span class="muted small">(activité · min · s)</span></label>
        ${s.steps.map((st, i) => `
          <div class="edit-step">
            <select data-kind="${i}">${opts(st.kind)}</select>
            <input data-min="${i}" type="number" inputmode="numeric" min="0" max="240" value="${Math.floor(st.duration / 60)}">
            <input data-sec="${i}" type="number" inputmode="numeric" min="0" max="59" step="5" value="${st.duration % 60}">
            <button data-del="${i}" aria-label="Supprimer l'étape">✕</button>
          </div>`).join('')}
        <button data-add style="width:100%;margin-top:6px">+ Ajouter une étape</button>
        <p class="muted small" style="margin-top:10px">Total : ${minutesLabel(total(s.steps))}. Chaque étape dure au moins 10 secondes. Les durées rondes (minutes entières, 30 s, 1 min 30, 2 min 30) sont annoncées à voix haute.</p>
      </div>
      <div class="row"><button data-cancel>Annuler</button><button class="btn-dark" data-save>Enregistrer</button></div>
      ${s.isNew ? '' : '<p style="margin-top:10px"><button class="btn-danger" data-remove style="width:100%">Supprimer cette séance</button></p>'}`;
  },

  live() {
    const playing = !audio.paused;
    const interrupted = !playing && live && !live.userPaused && audio.currentTime < live.track.end;
    return `
      ${interrupted ? '<div class="alert">Séance interrompue (appel, Siri ou autre app). Touche « Reprendre ».</div>' : ''}
      ${load().settings.son !== 'exclusif' ? '<p class="muted small" style="margin:12px 0 0">Mode musique : vérifie que ton iPhone n\'est pas en silencieux, sinon les signaux sont coupés.</p>' : ''}
      <div class="card dark live" style="margin-top:12px">
        <p class="muted small" id="stepno"></p>
        <p class="now" id="now"></p>
        <p class="count" id="count"></p>
        <p class="next muted" id="next"></p>
        <div class="bar"><div id="progress"></div></div>
        <p class="muted small" id="elapsed"></p>
        <p class="gpsline" id="gps"></p>
      </div>
      <div class="live-controls">
        <button class="btn-dark" data-toggle>${playing ? 'Pause' : 'Reprendre'}</button>
        <button data-skip>Étape suivante</button>
      </div>
      <p style="margin-top:10px"><button class="btn-primary" data-touchlock>Verrouiller l'écran (poche)</button></p>
      <p style="margin-top:10px"><button data-finish style="width:100%">Terminer et faire le bilan</button></p>
      <p class="muted small" style="margin-top:12px">Garde l'écran allumé pour mesurer la distance. Si l'iPhone se verrouille, la voix continue mais le GPS s'arrête.</p>`;
  },

  bilan() {
    const b = bilan;
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    return `
      <h1>Bilan de la séance</h1>
      <div class="card">
        <p><strong>${esc(b.sessionName)}</strong></p>
        <p class="muted">${mmss(b.elapsedSec)} de séance · ${b.completedSteps} étape(s) sur ${b.steps.length}${b.skipped.length ? ` · ${b.skipped.length} passée(s)` : ''}</p>
        ${b.distanceSource === 'gps' ? `<p class="small">GPS : ${b.distanceKm.toLocaleString('fr-FR')} km${b.allureSecKm ? ` · ${allure(b.allureSecKm)}` : ''}${b.gpsIncomplet ? ' · <strong>incomplet</strong> (écran verrouillé un moment)' : ''}</p>` : ''}
        <label for="dist">Distance (km${b.distanceSource === 'gps' ? ', corrige si besoin' : ', facultatif'})</label>
        <input id="dist" type="number" inputmode="decimal" step="0.01" min="0" value="${b.distanceKm ?? ''}">
        <label style="font-weight:400"><input id="estim" type="checkbox" style="width:auto" ${b.distanceEstimee ? 'checked' : ''}> C'est une estimation</label>
        <label>Difficulté</label>
        ${scale('difficulte', '1 = très facile · 5 = très dur')}
        <label>Fatigue</label>
        ${scale('fatigue', '1 = en forme · 5 = épuisé')}
        <label for="douleur">Une douleur ?</label>
        <input id="douleur" placeholder="Ex. : mollet droit, légère" value="${esc(b.douleur)}">
        <label for="comm">Ton ressenti</label>
        <textarea id="comm" placeholder="Ex. : assez essoufflé à la fin, mais j'aurais pu continuer deux minutes.">${esc(b.commentaire)}</textarea>
      </div>
      <button class="btn-primary" data-savebilan>Enregistrer</button>
      <p class="muted small" style="margin-top:10px">La douleur et ton ressenti restent privés.</p>`;
  },

  journal() {
    const d = load();
    const sorted = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return `
      <h1>Journal</h1>
      <div class="row" style="margin-bottom:14px"><button data-manual="natation">+ Natation</button><button data-manual="course">+ Course libre</button></div>
      ${sorted.length === 0 ? '<p class="muted">Aucune séance pour l\'instant.</p>' : ''}
      ${sorted.map(journalCard).join('')}
      ${sorted.length ? '<button data-export style="width:100%">Exporter mes données (JSON)</button>' : ''}`;
  },

  saisie() {
    const b = bilan;
    const swim = b.sport === 'natation';
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    const nages = ['crawl', 'brasse', 'dos', 'papillon'];
    return `
      <h1>${swim ? 'Séance de natation' : 'Course libre'}</h1>
      <div class="card">
        <label for="date">Date</label>
        <input id="date" type="date" value="${esc(b.date)}">
        <label for="duree">Durée (minutes)</label>
        <input id="duree" type="number" inputmode="numeric" min="1" max="600" value="${b.elapsedSec ? Math.round(b.elapsedSec / 60) : ''}">
        ${swim ? `
          <label for="bassin">Longueur du bassin (m)</label>
          <select id="bassin">${[25, 50, 33].map((m) => `<option value="${m}" ${b.swim.bassinM === m ? 'selected' : ''}>${m} m</option>`).join('')}</select>
          <label for="longueurs">Nombre de longueurs</label>
          <input id="longueurs" type="number" inputmode="numeric" min="0" max="400" value="${b.swim.longueurs ?? ''}">
          <p class="muted small" id="swimdist">${b.swim.longueurs ? `Distance : ${b.swim.longueurs * b.swim.bassinM} m` : ''}</p>
          <label>Nages</label>
          ${nages.map((n) => `<label style="font-weight:400;margin:4px 0"><input type="checkbox" data-nage="${n}" style="width:auto" ${b.swim.nages.includes(n) ? 'checked' : ''}> ${n}</label>`).join('')}
          <label for="detail">Détail (nages, éducatifs, pauses)</label>
          <textarea id="detail" placeholder="Ex. : les 10 dernières longueurs en dos, pauses de 30 s au bord">${esc(b.swim.detail)}</textarea>
        ` : `
          <label for="structure">Déroulé</label>
          <textarea id="structure" placeholder="Ex. : 5 min marche, 6 × (3 min course + 2 min marche), 6 min marche">${esc(b.structure)}</textarea>
          <label for="dist">Distance (km)</label>
          <input id="dist" type="number" inputmode="decimal" step="0.01" min="0" value="${b.distanceKm ?? ''}">
          <label style="font-weight:400"><input id="estim" type="checkbox" style="width:auto" ${b.distanceEstimee ? 'checked' : ''}> C'est une estimation</label>
        `}
        <label>Difficulté</label>
        ${scale('difficulte', '1 = très facile · 5 = très dur')}
        <label>Essoufflement</label>
        ${scale('essoufflement', '1 = je pouvais parler · 5 = à bout de souffle')}
        <label>Fatigue</label>
        ${scale('fatigue', '1 = en forme · 5 = épuisé')}
        <label for="douleur">Une douleur ?</label>
        <input id="douleur" placeholder="Ex. : épaule gauche, légère" value="${esc(b.douleur)}">
        <label for="comm">Ton ressenti</label>
        <textarea id="comm">${esc(b.commentaire)}</textarea>
      </div>
      <div class="row"><button data-tab="journal">Annuler</button><button class="btn-dark" data-savemanual>Enregistrer</button></div>`;
  },

  reglages() {
    const d = load();
    const supported = 'audioSession' in navigator;
    return `
      <h1>Réglages</h1>
      <div class="card">
        <label for="prenom">Ton prénom</label>
        <input id="prenom" value="${esc(d.profile.prenom)}" maxlength="40">
      </div>
      <div class="card">
        <h2>Mes jours d'entraînement</h2>
        <label>Course</label>
        <div class="days">${JOURS.map(([n, l]) => `<button data-day="joursCourse" data-v="${n}" class="${(d.settings.joursCourse ?? [1, 5]).includes(n) ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label>Natation</label>
        <div class="days">${JOURS.map(([n, l]) => `<button data-day="joursNatation" data-v="${n}" class="${(d.settings.joursNatation ?? [3]).includes(n) ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="muted small" style="margin-top:8px">Laisse au moins un jour entre deux courses : sinon la seconde devient un jour de repos.</p>
      </div>
      <div class="card">
        <h2>Signal de changement d'étape</h2>
        <label style="font-weight:400"><input type="radio" name="annonces" value="signaux" style="width:auto" ${d.settings.annonces !== 'voix' ? 'checked' : ''}> <strong>Signaux sonores</strong> : notes qui montent = cours, notes qui descendent = marche, 3 bips avant chaque changement.</label>
        <label style="font-weight:400"><input type="radio" name="annonces" value="voix" style="width:auto" ${d.settings.annonces === 'voix' ? 'checked' : ''}> <strong>Voix</strong> : annonce chaque étape et sa durée.</label>
      </div>
      <div class="card">
        <h2>Son pendant la séance</h2>
        <label style="font-weight:400"><input type="radio" name="mode" value="musique" style="width:auto" ${d.settings.son !== 'exclusif' ? 'checked' : ''}> <strong>Avec ma musique</strong> : les signaux passent par-dessus ta musique. Garde l'écran allumé.</label>
        <label style="font-weight:400"><input type="radio" name="mode" value="exclusif" style="width:auto" ${d.settings.son === 'exclusif' ? 'checked' : ''}> <strong>Sans musique</strong> : continue même écran verrouillé, mais met ta musique en pause.</label>
        ${supported ? '' : '<p class="muted small">Ce navigateur ne permet pas de choisir : le mode par défaut s\'applique.</p>'}
      </div>
      <div class="card">
        <h2>Mes données</h2>
        <p class="muted small">Importer un fichier d'export Foulée ou un historique préparé. Les séances déjà présentes ne sont pas dupliquées.</p>
        <button data-import style="width:100%">Importer des données (JSON)</button>
        <input id="importfile" type="file" accept="application/json,.json" hidden>
      </div>
      <p class="muted small">Voix : modèle libre « siwis » (Piper, licence CC-BY 4.0, Université d'Édimbourg).</p>`;
  },
};

function render() {
  app.innerHTML = screens[current]();
  for (const b of document.querySelectorAll('#tabs button')) {
    const tab = b.dataset.tab;
    b.classList.toggle('on', tab === current || (tab === 'programme' && ['edit', 'live', 'bilan'].includes(current)));
  }
  if (current === 'live') requestAnimationFrame(tick);
}

function go(screen) {
  if (screen === 'bilan' && live) {
    audio.pause();
    const { starts, end } = live.track;
    const steps = live.session.steps;
    const reached = Math.min(live.maxTime, end);
    const lastIdx = stepAt(starts, end, reached);
    const completed = lastIdx >= steps.length ? steps.length : Math.max(0, lastIdx);
    const elapsedSec = Math.round(Math.max(0, reached - starts[0]));
    const gps = summary(live.gps, elapsedSec);
    stopLiveExtras();
    renderTouchLock();
    bilan = {
      id: uid(),
      sport: 'course',
      source: 'guidee',
      date: live.startedAt,
      sessionName: live.session.name,
      level: live.session.level ?? null,
      steps: steps,
      plannedSec: total(steps),
      elapsedSec,
      completedSteps: completed,
      skipped: [...live.skipped],
      distanceKm: gps.distanceKm,
      distanceEstimee: false,
      distanceSource: gps.distanceKm ? 'gps' : null,
      allureSecKm: gps.allureSecKm,
      gpsIncomplet: gps.gpsIncomplet,
      gpsPoints: gps.points,
      difficulte: null,
      fatigue: null,
      douleur: '',
      commentaire: '',
    };
  }
  current = screen;
  render();
  window.scrollTo(0, 0);
}

// --- Actions ------------------------------------------------------------------

const findSession = (id) => load().sessions.find((s) => s.id === id);

function readEditor() {
  const name = document.getElementById('name');
  if (name) editing.name = name.value.trim() || 'Séance sans nom';
  editing.steps = editing.steps.map((st, i) => {
    const kind = document.querySelector(`[data-kind="${i}"]`)?.value ?? st.kind;
    const m = parseInt(document.querySelector(`[data-min="${i}"]`)?.value, 10) || 0;
    const s = parseInt(document.querySelector(`[data-sec="${i}"]`)?.value, 10) || 0;
    return { kind, duration: Math.max(10, Math.min(4 * 3600, m * 60 + Math.min(59, s))) };
  });
}

function newManual(sport) {
  return {
    id: uid(), sport, source: 'manuelle', date: today(), sessionName: sport === 'natation' ? 'Natation' : 'Course libre',
    elapsedSec: null, distanceKm: null, distanceEstimee: false, structure: '',
    swim: { bassinM: 25, longueurs: null, nages: [], detail: '' },
    difficulte: null, essoufflement: null, fatigue: null, douleur: '', commentaire: '',
  };
}

function readSaisie() {
  const v = (id) => document.getElementById(id);
  if (!v('date')) return;
  bilan.date = v('date').value || today();
  const min = parseInt(v('duree').value, 10);
  bilan.elapsedSec = Number.isFinite(min) && min > 0 ? min * 60 : null;
  bilan.douleur = v('douleur').value.trim();
  bilan.commentaire = v('comm').value.trim();
  if (bilan.sport === 'natation') {
    bilan.swim.bassinM = Number(v('bassin').value);
    const n = parseInt(v('longueurs').value, 10);
    bilan.swim.longueurs = Number.isFinite(n) && n >= 0 ? n : null;
    bilan.swim.nages = [...document.querySelectorAll('[data-nage]')].filter((c) => c.checked).map((c) => c.dataset.nage);
    bilan.swim.detail = v('detail').value.trim();
    bilan.distanceKm = bilan.swim.longueurs ? (bilan.swim.longueurs * bilan.swim.bassinM) / 1000 : null;
  } else {
    bilan.structure = v('structure').value.trim();
    const dist = parseFloat(String(v('dist').value).replace(',', '.'));
    bilan.distanceKm = Number.isFinite(dist) && dist > 0 ? Math.round(dist * 100) / 100 : null;
    bilan.distanceEstimee = v('estim').checked;
  }
}

// Fusionne un export (ou un historique préparé) avec les données du téléphone, sans doublon.
function mergeImport(d, data) {
  const ids = new Set(d.history.map((h) => h.id));
  let added = 0;
  for (const h of data.history || []) {
    if (h && h.id && !ids.has(h.id)) { d.history.push(h); ids.add(h.id); added++; }
  }
  if (data.profile) {
    if (!d.profile.prenom && data.profile.prenom) d.profile.prenom = data.profile.prenom;
    if (data.profile.objectifs) d.profile.objectifs = data.profile.objectifs;
  }
  return added;
}

function readBilan() {
  const v = (id) => document.getElementById(id);
  if (!v('dist')) return;
  const dist = parseFloat(String(v('dist').value).replace(',', '.'));
  const km = Number.isFinite(dist) && dist > 0 ? Math.round(dist * 100) / 100 : null;
  if (km !== bilan.distanceKm) {
    bilan.distanceKm = km;
    bilan.distanceSource = km ? 'manuelle' : null;
    bilan.allureSecKm = km && bilan.elapsedSec ? Math.round(bilan.elapsedSec / km) : null;
  }
  bilan.distanceEstimee = v('estim').checked;
  bilan.douleur = v('douleur').value.trim();
  bilan.commentaire = v('comm').value.trim();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) {
    if (current === 'live' && !audio.paused && !confirm('La séance continue en arrière-plan. Quitter l\'écran ?')) return;
    go(ds.tab);
  } else if (ds.start) {
    startSession(findSession(ds.start));
  } else if ('resume' in ds) {
    const r = savedLive();
    if (r) startSession(r.session, r);
  } else if ('dropresume' in ds) {
    clearLive();
    render();
  } else if (ds.startplan) {
    const p = upcoming(load().history, load().settings, today(), 14).find((x) => x.date === ds.startplan && x.sport === 'course');
    if (p) startSession({ id: `plan-${p.date}`, name: `Palier ${p.level} · ${p.title}`, steps: p.steps, level: p.level });
  } else if (ds.edit) {
    editing = structuredClone(findSession(ds.edit));
    go('edit');
  } else if ('new' in ds) {
    editing = { id: uid(), name: 'Ma séance', isNew: true, steps: [{ kind: 'echauffement', duration: 300 }, { kind: 'course_lente', duration: 120 }, { kind: 'recuperation', duration: 300 }] };
    go('edit');
  } else if ('add' in ds) {
    readEditor();
    editing.steps.push({ kind: 'marche', duration: 120 });
    render();
  } else if (ds.del !== undefined) {
    readEditor();
    if (editing.steps.length > 1) editing.steps.splice(Number(ds.del), 1);
    render();
  } else if ('cancel' in ds) {
    go('programme');
  } else if ('save' in ds) {
    readEditor();
    const { isNew, ...s } = editing;
    update((d) => {
      const i = d.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) d.sessions[i] = s;
      else d.sessions.push(s);
    });
    go('programme');
  } else if ('remove' in ds) {
    if (!confirm('Supprimer cette séance ?')) return;
    update((d) => { d.sessions = d.sessions.filter((x) => x.id !== editing.id); });
    if (load().sessions.length === 0) update((d) => { d.sessions = structuredClone(PRESETS); });
    go('programme');
  } else if ('toggle' in ds) {
    if (audio.paused) audio.play();
    else {
      live.userPaused = true;
      audio.pause();
    }
  } else if ('skip' in ds) {
    nextStep();
  } else if (ds.day) {
    const key = ds.day;
    const n = Number(ds.v);
    update((d) => {
      const cur = new Set(d.settings[key] ?? (key === 'joursCourse' ? [1, 5] : [3]));
      if (cur.has(n)) cur.delete(n); else cur.add(n);
      d.settings[key] = [...cur].sort();
    });
    render();
  } else if ('touchlock' in ds) {
    touchLocked = true;
    renderTouchLock();
  } else if ('finish' in ds) {
    go('bilan');
  } else if (ds.manual) {
    bilan = newManual(ds.manual);
    go('saisie');
  } else if ('savemanual' in ds) {
    readSaisie();
    const entry = bilan;
    update((d) => { d.history.push(entry); });
    bilan = null;
    go('journal');
  } else if ('import' in ds) {
    document.getElementById('importfile').click();
  } else if (ds.scale) {
    if (current === 'saisie') readSaisie(); else readBilan();
    bilan[ds.scale] = Number(ds.v);
    render();
  } else if ('savebilan' in ds) {
    readBilan();
    const entry = bilan;
    update((d) => { d.history.unshift(entry); });
    clearLive();
    if (live) URL.revokeObjectURL(live.url);
    live = null;
    audio.removeAttribute('src');
    audio.load();
    bilan = null;
    go('journal');
  } else if ('export' in ds) {
    const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `foulee-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'annonces') {
    update((d) => { d.settings.annonces = e.target.value; });
  } else if (e.target.name === 'mode') {
    update((d) => { d.settings.son = e.target.value; });
    applyAudioMode();
  } else if (e.target.id === 'importfile') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      let added = 0;
      try {
        const data = JSON.parse(txt);
        update((d) => { added = mergeImport(d, data); });
      } catch {
        alert('Fichier illisible.');
        return;
      }
      alert(`${added} séance(s) ajoutée(s).`);
      go('journal');
    });
  } else if (current === 'saisie') {
    readSaisie();
    if (e.target.id === 'longueurs' || e.target.id === 'bassin') render();
  } else if (e.target.id === 'prenom') {
    update((d) => { d.profile.prenom = e.target.value.trim(); });
  } else if (current === 'edit') {
    readEditor();
    render();
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
render();
