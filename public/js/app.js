import { KINDS } from './phrases.js';
import { assemble, stepAt, sample } from './track.js';
import { MAX_EXTRA, extendState, canExtend, canRetract, extend, retract, extraSummary } from './extend.js';
import { load, update, uid, PRESETS, onSave, replace, empty } from './store.js';
import * as account from './account.js';
import { createTrack, addPoint, addAltitude, markGap, summary, currentPace, encodeTrace, decodeTrace, packTrack, restoreTrack } from './gps.js';
import { drawTrace } from './map.js';
import { stepTimes, summarize, summarizeMontre, montreStale, MONTRE_V, mergeDistance, recovery, recoveryAt, zoneLimits, zoneOf, zoneTimes, cardioLine, curveSvg, windowOf, swimWindow, dayRange, applySwim } from './cardio.js';
import { iaInput, pendingIA, failedIA, failureMessage } from './ia.js';
import { tipsOf, tipsSource, hasIA } from './conseils.js';
import { GOALS_MUSCU, LIEUX, NIVEAUX_MUSCU, MUSCLES, alternatives, byId, muscuPlan, nextSeance, nextLoad, tonnage } from './muscu.js';
import { createGuided, currentExercise, suggestedReps, setDone, skipExercise, restLeft, adjustRest, endRest, finish, elapsedSec as guidedElapsed, setsDone, setsTotal, restTrack, startCountdown, countLeft, endCountdown, swapExercise, startHold, cancelHold, stopHold, holdLead, holdElapsed, holdOver, holdTrack } from './muscu-live.js';
import { replayRun, replayMuscu, canReplay } from './refaire.js';
import { upcoming, moveOptions, planOptions, nextRunLevel, runLevel, afterBilan, HORIZON, GOALS_RUN, START_RUN, GOALS_SWIM, START_SWIM, LEVELS } from './plan.js';

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
// Programme de ce profil, d'après son historique et son questionnaire. Sans date de fin :
// recalculé à chaque affichage sur les 12 semaines qui viennent.
const planFor = (d, days = HORIZON) => upcoming(d.history, d.settings, today(), days, d.profile.questionnaire);
const practiced = (d, sport) => planOptions(d.profile.questionnaire).sports.includes(sport);
// Appareil : les consignes (Safari, silencieux, réglages) ne s'affichent que là où elles s'appliquent.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/i.test(navigator.userAgent);
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
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

// --- Éléments visuels ---------------------------------------------------------

const ICONS = {
  course: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>',
  natation: '<path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>',
  muscu: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  repos: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  autre: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
};
const icon = (sport) => `<span class="ico ${sport}"><svg viewBox="0 0 24 24">${ICONS[sport] || ICONS.course}</svg></span>`;
const SPORT_LABEL = { course: 'Course', natation: 'Natation', muscu: 'Musculation', autre: 'Autre activité' };
// Activités courantes hors programme, proposées d'un toucher.
const ACTIVITES = ['Padel', 'Vélo', 'Foot', 'Tennis', 'Randonnée', 'Marche'];
// « J'ai fait autre chose » : sur la séance du jour, elle est décalée au lieu d'être sautée.
// Muscu du jour : séance guidée (minuteur de récup) ; la saisie libre reste possible.
const muscuCta = () => `<button class="cta muscu" data-muscugo><span>${savedGuided() ? 'Reprendre la séance' : 'Démarrer la séance'}</span><i>›</i></button>
  <button class="day-link" data-logplan="muscu">Déjà faite ? La noter sans guidage ›</button>`;
const autreLink = (p) => `<button class="day-link" data-autre="${p.sport}">J'ai fait autre chose à la place ›</button>`;
// Avancer ou décaler une séance prévue, aujourd'hui ou plus tard, quel que soit le sport.
const moveLink = (p) => `<button class="day-link" data-move="${esc(p.date)}|${p.sport}">${p.moved ? 'Changer de jour ou remettre au ' + esc(shortDayName(p.moved.from)) : 'Avancer ou décaler cette séance'} ›</button>`;
const shortDayName = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' });
const kgLabel = (kg) => `${String(kg).replace('.', ',')} kg`;
// « 3 × 8-12 · 40 kg » : la dose d'un exercice prévu.
const dose = (x) => `${x.series} × ${x.min}–${x.max}${x.unite === 's' ? ' s' : ''}${x.poids ? ` · ${kgLabel(x.poids)}` : x.materiel === 'corps' ? '' : ' · charge à trouver'}`;
const exoList = (p) => `<ol class="exos">${p.exercices.map((x) => `<li><b>${esc(x.nom)}</b><span class="dose">${dose(x)}</span><span class="why">${esc(x.muscle)} · ${esc(x.reason)}</span></li>`).join('')}</ol>`;
const shortDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

// Pourquoi cette séance, et les conseils tirés du dernier bilan du même sport.
const whyTips = (p) => `
  <div class="why-tips ${p.sport}">
    <p>${esc(p.reason)}</p>
    ${p.tips?.length ? `<p class="tips-head">${p.tipsSource === 'ia' ? 'Conseils de l’IA sur ton dernier bilan' : 'Conseils de ton dernier bilan · règles'}</p><ul>${p.tips.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </div>`;

// Séance du jour : le seul bloc mis en vedette de l'accueil et du programme.
function todayHero(p) {
  const isToday = p.date === today();
  const when = isToday ? "Aujourd'hui" : dateLabel(p.date);
  if (p.sport === 'natation') {
    return `
      <section class="hero natation">
        <p class="eyebrow">${when} · natation</p>
        <p class="hero-num">${p.longueurs}<small>longueurs</small></p>
        <p class="hero-sub">${p.distance} m en bassin de ${p.bassin} m</p>
        <ol class="hero-steps">${p.plan.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        ${whyTips(p)}
        ${isToday ? '<button class="btn-swim" data-logplan="natation">Noter ma séance</button>' : ''}
        ${moveLink(p)}
      </section>`;
  }
  if (p.sport === 'muscu') {
    return `
      <section class="hero muscu">
        <p class="eyebrow">${when} · musculation</p>
        <p class="hero-num">${p.exercices.length}<small>exercices</small></p>
        <p class="hero-sub">${esc(p.title)} · ${p.repos} s de repos entre les séries</p>
        ${exoList(p)}
        ${whyTips(p)}
        ${isToday ? `${muscuCta()}${autreLink(p)}` : ''}
        ${moveLink(p)}
      </section>`;
  }
  const mins = Math.round(total(p.steps) / 60);
  const runs = p.steps.filter((s) => KINDS[s.kind].effort === 'course');
  return `
    <section class="hero course">
      <p class="eyebrow">${when} · course · palier ${p.level}/${p.max}</p>
      <p class="hero-num">${mins}<small>min</small></p>
      <p class="hero-sub">${esc(p.title)}</p>
      <div class="effort-bar">${p.steps.map((s) => `<i class="${KINDS[s.kind].effort}" style="flex:${s.duration}"></i>`).join('')}</div>
      <p class="muted small">${runs.length} fois en course, ${Math.round(runs.reduce((a, s) => a + s.duration, 0) / 60)} min au total.</p>
      ${whyTips(p)}
      ${isToday ? `<button class="btn-primary" data-startplan="${esc(p.date)}">Démarrer la séance</button>
      <button class="btn-ghost" data-logplan="course" style="width:100%;margin-top:6px">Faite sans l'app : la noter</button>` : `<button data-startplan="${esc(p.date)}" style="width:100%">La faire maintenant</button>`}
      ${moveLink(p)}
    </section>`;
}

// Séance à venir : une ligne légère, sans cadre.
function planRow(p, showNow = false) {
  if (p.sport === 'repos') {
    return `<div class="li">${icon('repos')}<div class="li-main"><b>${shortDate(p.date)} · repos</b><span>${esc(p.reason)}</span></div></div>`;
  }
  const main = p.sport === 'natation'
    ? `<b>${shortDate(p.date)}</b><span>${p.longueurs} longueurs · ${p.distance} m</span>`
    : p.sport === 'muscu'
      ? `<b>${shortDate(p.date)} <em>${esc(p.title)}</em></b><span>${esc(p.exercices.map((x) => x.nom.split(' (')[0]).join(', '))}</span>`
      : `<b>${shortDate(p.date)} <em>palier ${p.level}/${p.max}</em></b><span>${esc(p.title)}</span>`;
  const side = p.sport === 'natation' ? `${p.distance}<small>m</small>` : p.sport === 'muscu' ? `${p.exercices.length}<small>exos</small>` : `${Math.round(total(p.steps) / 60)}<small>min</small>`;
  // Détail à un toucher : longueur par longueur, exercices, ou déroulé de la course.
  const more = p.sport === 'natation' ? `<ol class="hero-steps">${p.plan.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`
    : p.sport === 'muscu' ? exoList(p)
      : `<p class="small">${esc(stepsSummary(p.steps))}</p>`;
  return `
    <details class="hist plan-row"><summary class="li">${icon(p.sport)}<div class="li-main">${main}</div><span class="li-side ${p.sport}">${side}</span></summary>
      <div class="li-more">${more}<p class="muted small">${esc(p.reason)}</p>${moveLink(p)}</div></details>
    ${showNow ? `<button class="btn-ghost small-btn" data-startplan="${esc(p.date)}">La faire maintenant ›</button>` : ''}`;
}

// Tracé GPS d'une séance (les toutes premières séances gardaient les points bruts).
const traceOf = (h) => (h?.trace ? decodeTrace(h.trace) : h?.gpsPoints?.length ? decodeTrace(encodeTrace(h.gpsPoints)) : []);

// Cartes de l'écran : dessinées une fois visibles (une ligne d'historique fermée attend d'être dépliée).
function mountMaps() {
  for (const el of document.querySelectorAll('.map[data-map]')) {
    if (el.closest('details:not([open])')) continue;
    const id = el.dataset.map;
    drawTrace(el, traceOf(id === 'bilan' ? bilan : load().history.find((h) => h.id === id)));
  }
}
document.addEventListener('toggle', (e) => { if (e.target.open) mountMaps(); }, true);

// Conseils du coach sur une séance faite : ceux de l'IA s'ils existent, sinon ceux des règles.
function coachTips(h) {
  const tips = tipsOf(h);
  if (!tips.length) return '';
  const ia = tipsSource(h) === 'ia';
  return `
    <details class="coach ${sportOf(h)}">
      <summary>Conseils du coach suite à ta séance <i>›</i></summary>
      <p class="coach-src">${ia ? 'Écrits par l’IA à partir de ton ressenti' : 'Conseils des règles de Foulée'}</p>
      <ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </details>`;
}

// Cardio mesuré par la montre : rien du tout s'il n'a pas été mesuré.
const cardioBlock = (c, id) => (c ? `
  <div class="hr-box" data-hrdetail="${esc(id)}" role="button" tabindex="0">
    <p class="hr-head"><span class="hr-heart">♥</span><b>${c.avg}</b><small>bpm de moyenne</small><span class="hr-max">max <b>${c.max}</b></span></p>
    ${c.course || c.marche ? `<p class="hr-phases">${c.course ? `<span class="on">En course <b>${c.course}</b></span>` : ''}${c.marche ? `<span>En marche <b>${c.marche}</b></span>` : ''}</p>` : ''}
    ${curveSvg(c)}
    <p class="muted small" style="margin:4px 0 0">Mesuré par ta montre (${c.n} mesures)${c.bandes?.length ? ', phases de course en fond' : ''}. <span class="hr-more">Détail ›</span></p>
  </div>` : '');

// Saisie de natation : longueurs, durée et cardio lus par la montre (séance « Natation en piscine »).
// Ils préremplissent la saisie ; ce qui est tapé à la main reste prioritaire.
function swimWatch(b) {
  if (!cardioOn()) return '';
  const m = b.montre;
  if (m?.nageM) {
    const bassin = b.swim.bassinM || 25;
    const lg = Math.round(m.nageM / bassin);
    const differ = b.swim.longueursSource === 'manuelle' && b.swim.longueurs !== lg;
    return `<div class="montre-box">
      <div class="montre-cells">
        <span><b>${lg}</b><small>longueurs</small></span>
        ${b.fenetre ? `<span><b>${Math.round((b.fenetre[1] - b.fenetre[0]) / 60000)}</b><small>min</small></span>` : ''}
        ${m.mvt ? `<span><b>${Math.round(m.mvt / Math.max(1, lg))}</b><small>mouvements / longueur</small></span>` : ''}
        ${m.kcal ? `<span><b>${m.kcal}</b><small>kcal actives</small></span>` : ''}
      </div>
      <p class="muted small" style="margin:4px 0 0">Mesuré par ta montre : ${m.nageM} m${b.fenetre ? `, de ${hhmm(b.fenetre[0])} à ${hhmm(b.fenetre[1])}` : ''}. ${differ ? `<b>Tu as noté ${b.swim.longueurs} longueurs</b> : c'est ta saisie qui compte.` : 'Longueurs et durée reportées, corrige si la montre s’est trompée.'}</p>
    </div>
    ${b.cardio ? cardioBlock(b.cardio, 'bilan') : ''}`;
  }
  return `<div class="hr-wait">
    <p class="small" style="margin:0"><b>Ta montre :</b> si tu as nagé avec une séance « Natation en piscine » sur ta montre, les longueurs, la durée et le cardio se remplissent tout seuls après le Raccourci.</p>
    ${cardioUi.message ? `<p class="muted small" style="margin:6px 0 0">${esc(cardioUi.message)}</p>` : ''}
    <button class="btn-ghost" data-cardiofetch style="width:100%;margin-top:8px">${cardioUi.busy ? 'Recherche…' : 'Chercher les mesures de ma montre'}</button>
  </div>`;
}

// Détail du cardio, comme l'app Forme : moyenne, courbe en couleurs de zone, temps par zone,
// cardio après l'effort. Les zones sont celles que l'utilisateur a recopiées (Profil).
const ZONE_COLORS = ['#3D9BFF', '#3DE0D0', '#C8FF2E', '#FF8A1A', '#FF2E8A'];
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function zoneCurve(c, l) {
  if (!c.pts || c.pts.length < 4) return '';
  const W = 320;
  const H = 120;
  const lo = Math.min(...c.pts) - 4;
  const hi = Math.max(...c.pts) + 4;
  const n = c.pts.length;
  const bw = W / n;
  const y = (v) => H - 16 - ((v - lo) / (hi - lo || 1)) * (H - 26);
  const bars = c.pts.map((v, i) => `<rect x="${(i * bw + bw * 0.2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${Math.max(1, bw * 0.6).toFixed(1)}" height="${Math.max(2, H - 16 - y(v)).toFixed(1)}" rx="1" fill="${l ? ZONE_COLORS[zoneOf(v, l)] : 'var(--hr, #FF4D6D)'}"/>`).join('');
  const t1 = c.t1 || c.t0 + n * c.pas * 1000;
  return `<svg class="hr-zonecurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cardio pendant la séance, de ${c.min} à ${c.max} bpm">
    ${bars}
    <text x="${W - 2}" y="10" text-anchor="end" class="hr-axis">${c.max}</text>
    <text x="2" y="${H - 2}" class="hr-axis">${hhmm(c.t0)}</text><text x="${W / 2}" y="${H - 2}" text-anchor="middle" class="hr-axis">${hhmm((c.t0 + t1) / 2)}</text><text x="${W - 2}" y="${H - 2}" text-anchor="end" class="hr-axis">${hhmm(t1)}</text>
  </svg>`;
}
function recoveryCurve(ap) {
  const W = 320;
  const H = 90;
  const vals = ap.map((p) => p[1]);
  const lo = Math.min(...vals) - 4;
  const hi = Math.max(...vals) + 4;
  const x = (s) => ((s / 180) * (W - 8) + 4).toFixed(1);
  const y = (v) => (H - 16 - ((v - lo) / (hi - lo || 1)) * (H - 26)).toFixed(1);
  return `<svg class="hr-zonecurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cardio après l'effort">
    ${ap.map(([sec, v]) => `<rect x="${x(sec) - 1.5}" y="${y(v)}" width="3" height="8" rx="1.5" fill="var(--hr, #FF4D6D)"/>`).join('')}
    <text x="2" y="${H - 2}" class="hr-axis">Fin</text><text x="${x(60)}" y="${H - 2}" text-anchor="middle" class="hr-axis">1 min</text><text x="${x(120)}" y="${H - 2}" text-anchor="middle" class="hr-axis">2 min</text><text x="${W - 2}" y="${H - 2}" text-anchor="end" class="hr-axis">3 min</text>
  </svg>`;
}
function cardioDetail(h) {
  const c = h.cardio;
  const l = zoneLimits(load().settings.zones);
  const zt = zoneTimes(c.hist, l);
  const ranges = l ? [`≤ ${l[0]}`, `${l[0] + 1}–${l[1]}`, `${l[1] + 1}–${l[2]}`, `${l[2] + 1}–${l[3]}`, `> ${l[3]}`] : [];
  const maxZ = zt ? Math.max(...zt, 1) : 1;
  const ap = c.apres;
  const at = [0, 60, 120].map((s) => recoveryAt(ap, s));
  return `
    <div class="hr-sheet" role="dialog" aria-label="Fréquence cardiaque">
      <div class="hr-sheet-in">
        <div class="hr-sheet-top"><h2>Fréquence cardiaque</h2><button class="hr-close" data-hrclose aria-label="Fermer">✕</button></div>
        <p class="muted" style="margin:0">Fréq. cardiaque moy.</p>
        <p class="hr-big">${c.avg} <small>BPM</small></p>
        <p class="hr-phases"><span>Max <b>${c.max}</b></span><span>Min <b>${c.min}</b></span>${c.course ? `<span class="on">En course <b>${c.course}</b></span>` : ''}${c.marche ? `<span>En marche <b>${c.marche}</b></span>` : ''}</p>
        ${zoneCurve(c, l)}
        ${zt ? `<ul class="hr-zones">${zt.map((sec, i) => `<li><span class="z" style="color:${ZONE_COLORS[i]}">Zone ${i + 1}</span><i style="background:${ZONE_COLORS[i]};width:${Math.max(4, Math.round((sec / maxZ) * 100))}px"></i><b>${mmss(sec)}</b><span class="muted">${ranges[i]} bpm</span></li>`).join('')}</ul>
          <p class="muted small">Tes zones, recopiées de l'app Forme (Profil > Cardio Apple Watch). Le temps par zone est mesuré.</p>`
        : c.hist ? `<p class="muted small">Temps par zone : recopie tes zones de l'app Forme dans Profil > Cardio Apple Watch.</p>` : ''}
        ${ap ? `<h3>Fréquence cardiaque après l'effort</h3>${recoveryCurve(ap)}
          <p class="hr-phases">${at[0] ? `<span>Fin <b>${at[0]}</b></span>` : ''}${at[1] ? `<span>1 min <b>${at[1]}</b></span>` : ''}${at[2] ? `<span>2 min <b>${at[2]}</b></span>` : ''}</p>
          ${at[0] && at[1] ? `<p class="muted small">Ton cœur a baissé de ${at[0] - at[1]} bpm la première minute. Plus il redescend vite, plus ta forme progresse.</p>` : ''}`
        : `<p class="muted small">Cardio après l'effort : garde la montre 3 minutes après la séance, puis lance le Raccourci.</p>`}
        <p class="muted small">Mesuré par ta montre (${c.n} mesures), rien n'est estimé.</p>
      </div>
    </div>`;
}
// Avancer ou décaler : les jours possibles, d'un toucher.
function moveSheet(p, opts) {
  const t = today();
  const label = (d) => (d === t ? "Aujourd'hui" : d === addDays(t, 1) ? 'Demain' : dateLabel(d));
  const what = { course: 'Course', natation: 'Natation', muscu: 'Muscu' }[p.sport];
  return `
    <div class="hr-sheet move-sheet ${p.sport}" role="dialog" aria-label="Avancer ou décaler">
      <div class="hr-sheet-in">
        <div class="hr-sheet-top"><h2>${what} · ${esc(label(p.date))}</h2><button class="hr-close" data-moveclose aria-label="Fermer">✕</button></div>
        <p class="muted">Choisis le nouveau jour. La suite du programme se recalcule, rien n'est sauté ni fait en double.</p>
        ${opts.length ? `<div class="move-days">${opts.map((o, i) => `<button class="option${o.back ? ' back' : ''}" data-moveto="${i}"><span><span>${esc(label(o.date))}</span>${o.back ? '<span class="muted">Son jour prévu au départ</span>' : ''}</span><span class="go">›</span></button>`).join('')}</div>`
          : '<p>Aucun jour libre dans les 7 jours qui suivent.</p>'}
        <p class="muted small">Ne sont proposés que les jours sans autre séance${p.sport === 'course' ? ', avec un jour de repos avant et après chaque course' : ''}.</p>
      </div>
    </div>`;
}
let moveCtx = null;
function openMoveSheet(key) {
  const [date, sport] = key.split('|');
  const d = load();
  const p = planFor(d).find((x) => x.date === date && x.sport === sport);
  if (!p) return;
  const opts = moveOptions(d.history, d.settings, today(), d.profile.questionnaire, p);
  moveCtx = { opts };
  closeMoveSheet();
  document.body.insertAdjacentHTML('beforeend', moveSheet(p, opts));
  document.body.classList.add('sheet-open');
}
function closeMoveSheet() {
  document.querySelector('.move-sheet')?.remove();
  document.body.classList.remove('sheet-open');
}
document.addEventListener('click', (e) => {
  const mv = e.target.closest('[data-move]');
  if (mv) { e.stopPropagation(); return openMoveSheet(mv.dataset.move); }
  if (e.target.closest('[data-moveclose]') || e.target.classList?.contains('move-sheet')) return closeMoveSheet();
  const to = e.target.closest('[data-moveto]');
  if (to && moveCtx) {
    const o = moveCtx.opts[Number(to.dataset.moveto)];
    const old = addDays(today(), -14);
    update((d) => { d.settings.decalages = o.decalages.filter((m) => m.to >= old); });
    moveCtx = null;
    closeMoveSheet();
    selDay = o.date;
    weekScroll = null;
    render();
  }
}, true);
function openCardioDetail(id) {
  const h = id === 'bilan' ? bilan : load().history.find((x) => x.id === id);
  if (!h?.cardio) return;
  closeCardioDetail();
  document.body.insertAdjacentHTML('beforeend', cardioDetail(h));
  document.body.classList.add('sheet-open');
}
function closeCardioDetail() {
  document.querySelector('.hr-sheet')?.remove();
  document.body.classList.remove('sheet-open');
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-zonessave]')) {
    const vals = [0, 1, 2, 3].map((i) => Number(document.getElementById(`zone${i}`)?.value));
    const l = zoneLimits(vals);
    cardioUi.zonesOpen = true;
    if (!l) { cardioUi.zonesDraft = vals.map((v) => v || ''); cardioUi.zonesMsg = 'Quatre nombres croissants, entre 60 et 230.'; return render(); }
    cardioUi.zonesDraft = null;
    update((d) => { d.settings.zones = l; });
    cardioUi.zonesMsg = 'Zones enregistrées.';
    return render();
  }
  if (e.target.closest('[data-hrclose]') || e.target.classList?.contains('hr-sheet')) return closeCardioDetail();
  const box = e.target.closest('[data-hrdetail]');
  if (box) openCardioDetail(box.dataset.hrdetail);
});

// Autres mesures de la montre (Santé) : seulement celles qui ont été mesurées.
function montreBlock(h) {
  const m = h?.montre;
  if (!m) return '';
  const fromWatch = h.distanceSource === 'montre' || h.distanceSource === 'moyenne';
  const cells = [
    m.distKm && [(fromWatch ? h.distanceKm : m.distKm).toLocaleString('fr-FR'), 'km'],
    m.distKm && fromWatch && h.allureSecKm && [allure(h.allureSecKm).replace('/km', ''), '/km'],
    m.kcal && [m.kcal, 'kcal actives'],
    m.puissance && [m.puissance, 'W de puissance'],
    m.cadence && [m.cadence, 'pas/min'],
    m.nageM && [m.nageM, 'm nagés'],
    m.mvt && h.swim?.longueurs && [Math.round(m.mvt / h.swim.longueurs), 'mouvements / longueur'],
  ].filter(Boolean);
  const fr = (km) => `${km.toLocaleString('fr-FR')} km`;
  const gps = !h.distanceGpsKm ? ''
    : h.distanceSource === 'moyenne' ? `, sauf la distance : moyenne de la montre (${fr(m.distKm)}) et du téléphone (${fr(h.distanceGpsKm)})`
    : h.distanceSource === 'montre' ? `. Le téléphone donnait ${fr(h.distanceGpsKm)} (${h.gpsIncomplet ? 'GPS coupé un moment' : 'trop d’écart pour faire la moyenne'})`
    : '';
  const sp = m.splits;
  const best = sp ? Math.min(...sp.km) : 0;
  const splitsHtml = sp ? `<ol class="splits">${sp.km.map((sec, i) => `<li class="${sec === best && sp.km.length > 1 ? 'best' : ''}"><span>Km ${i + 1}</span><b>${allure(sec).replace('/km', '')}</b></li>`).join('')}${sp.fin ? `<li><span>${sp.fin.km.toLocaleString('fr-FR')} km</span><b>${mmss(sp.fin.sec)}</b></li>` : ''}</ol>` : '';
  return `<div class="montre-box"><div class="montre-cells">${cells.map(([v, u]) => `<span><b>${v}</b><small>${u}</small></span>`).join('')}</div>
    ${splitsHtml}
    <p class="muted small" style="margin:4px 0 0">Mesuré par ta montre pendant la séance${gps}.</p></div>`;
}

// Progression : cardio des dernières courses mesurées par la montre. Comparer au même palier.
function cardioTrend(runs) {
  const list = runs.filter((h) => h.cardio).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-8);
  if (!list.length) return '';
  const val = (h) => h.cardio.course ?? h.cardio.avg;
  const hi = Math.max(...list.map(val));
  const lo = Math.min(...list.map(val)) - 10;
  return `
    <h3>Cardio en course</h3>
    <div class="hr-trend">${list.map((h) => `<div class="hr-col"><b>${val(h)}</b><i style="height:${Math.round(18 + ((val(h) - lo) / (hi - lo || 1)) * 52)}px"></i><span>${shortDate(h.date).replace(/\.$/, '')}</span><span class="muted">${runLevel(h) ? `P${runLevel(h)}` : ''}</span></div>`).join('')}</div>
    <p class="muted small">Bpm moyens pendant les phases de course (moyenne de la séance si les phases manquent). À palier égal, un cardio qui baisse veut dire que tu progresses. Mesuré par ta montre, rien n'est estimé.</p>`;
}

// Répétitions ajoutées en direct : prévu contre réalisé.
function extraLine(h) {
  const done = h.extraFaites ?? 0;
  const prevues = h.repsPrevues;
  if (!done) return `Répétition${h.extra > 1 ? 's' : ''} ajoutée${h.extra > 1 ? 's' : ''} en direct, mais pas terminée${h.extra > 1 ? 's' : ''} : ${prevues} prévues.`;
  return `<b>${prevues + done} répétitions au lieu de ${prevues}</b> : +${done} ajoutée${done > 1 ? 's' : ''} en direct${done < h.extra ? ` (${h.extra - done} lancée${h.extra - done > 1 ? 's' : ''} sans être finie${h.extra - done > 1 ? 's' : ''})` : ''}.`;
}

const refOf = (h) => load().history.find((x) => x.id === h.refaite) || null;

// Séance passée : ligne dépliable, le détail reste à un toucher.
function historyRow(h, open = false) {
  const sport = sportOf(h);
  const parts = [];
  if (h.elapsedSec) parts.push(`${Math.round(h.elapsedSec / 60)} min`);
  if (sport === 'natation' && h.swim?.longueurs) parts.push(`${h.swim.longueurs} × ${h.swim.bassinM} m = ${h.swim.longueurs * h.swim.bassinM} m`);
  if (h.distanceKm && sport !== 'natation') parts.push(`${h.distanceKm.toLocaleString('fr-FR')} km${h.distanceEstimee ? ' (estimé)' : ''}`);
  if (h.allureSecKm) parts.push(`allure ${allure(h.allureSecKm)}`);
  if (h.gpsIncomplet) parts.push('GPS incomplet');
  if (h.steps && h.source === 'guidee') parts.push(`${h.completedSteps}/${h.steps.length} étapes`);
  if (h.extra) parts.push(`+${h.extraFaites ?? h.extra} répétition${(h.extraFaites ?? h.extra) > 1 ? 's' : ''}`);
  if (h.cardio) parts.push(`♥ ${h.cardio.avg} bpm`);
  if (h.montre?.kcal) parts.push(`${h.montre.kcal} kcal`);
  if (h.deniveleM) parts.push(`D+ ${h.deniveleM} m`);
  if (sport === 'muscu' && h.exercices?.length) parts.unshift(`${h.sessionName} · ${h.exercices.length} exercices`);
  if (sport === 'autre') parts.unshift(`${esc(h.activite || 'Autre activité')}${h.remplace ? ` · à la place de la ${SPORT_LABEL[h.remplace].toLowerCase()}` : ''}`);
  const feel = [
    h.difficulte && `difficulté ${h.difficulte}/5`,
    h.essoufflement && `essoufflement ${h.essoufflement}/5`,
    h.fatigue && `fatigue ${h.fatigue}/5`,
    h.douleur && `douleur : ${esc(h.douleur)}`,
  ].filter(Boolean);
  const side = sport === 'muscu'
    ? (tonnage(h) ? `${Math.round(tonnage(h)).toLocaleString('fr-FR')}<small>kg</small>` : repsOf(h) ? `${repsOf(h)}<small>rép.</small>` : '')
    : sport === 'natation'
    ? (swimMeters(h) ? `${swimMeters(h)}<small>m</small>` : '')
    : h.distanceKm ? `${h.distanceKm.toLocaleString('fr-FR')}<small>km</small>` : h.elapsedSec ? `${Math.round(h.elapsedSec / 60)}<small>min</small>` : '';
  return `
    <details class="hist"${open || h.id === fixedRun ? ' open' : ''}>
      <summary class="li">${icon(sport)}<div class="li-main"><b>${dateLabel(h.date)}</b><span>${parts.length ? parts.join(' · ') : esc(h.structure || h.sessionName || SPORT_LABEL[sport])}</span></div><span class="li-side ${sport}">${side}</span></summary>
      <div class="li-more">
        ${traceOf(h).length ? `<div class="map" data-map="${esc(h.id)}"></div>` : ''}
        ${cardioBlock(h.cardio, h.id)}
        ${montreBlock(h)}
        ${h.deniveleM != null ? `<p class="muted small">Dénivelé : +${h.deniveleM} m, mesuré par le téléphone.</p>` : ''}
        ${h.source === 'guidee' && (h.distanceSource === 'manuelle' || h.dureeSource === 'manuelle') ? `<p class="muted small">Corrigé à la main${h.distanceSource === 'manuelle' ? ` : ${h.distanceKm.toLocaleString('fr-FR')} km` : ''}${h.dureeSource === 'manuelle' ? `${h.distanceSource === 'manuelle' ? ',' : ' :'} ${Math.round(h.elapsedSec / 60)} min` : ''}. C'est ce qui compte.</p>` : ''}
        ${sport === 'muscu' && h.exercices?.length ? `<ul class="steps">${h.exercices.map((x) => `<li><span>${esc(x.nom)}</span><span class="muted small">${x.poids ? `${kgLabel(x.poids)} · ` : ''}${(x.reps || []).filter((r) => r > 0).join(' / ')}${x.unite === 's' ? ' s' : ''}</span></li>`).join('')}</ul>${tonnage(h) ? '<p class="muted small">Total soulevé : charge × répétitions, hors poids du corps.</p>' : ''}` : ''}
        ${sport === 'natation' && h.swim?.nages?.length ? `<p class="small">${esc(h.swim.nages.join(', '))}${h.swim.detail ? ` · ${esc(h.swim.detail)}` : ''}</p>` : ''}
        ${h.structure ? `<p class="small">${esc(h.structure)}</p>` : ''}
        ${feel.length ? `<p class="muted small">${feel.join(' · ')}</p>` : ''}
        ${h.commentaire ? `<p class="small">« ${esc(h.commentaire)} »</p>` : ''}
        ${!feel.length && !h.commentaire && !h.structure ? '<p class="muted small">Pas de ressenti noté.</p>' : ''}
        ${coachTips(h)}
        ${h.refaite ? `<p class="muted small">Séance refaite${refOf(h) ? ` : la même que ${esc(dateLabel(refOf(h).date))}` : ''}.</p>` : ''}
        ${canReplay(h) && !live && !guided ? `<button class="btn-ghost replay ${sport}" data-replay="${esc(h.id)}">↻ Refaire cette séance</button>` : ''}
        ${sport === 'course' ? `<div class="fixrun" data-fixbox="${esc(h.id)}"><button class="day-link" data-fixrun="${esc(h.id)}">Corriger avec les chiffres de ma montre</button></div>` : ''}
      </div>
    </details>`;
}

// Correction après coup d'une course (ex. séance coupée à la fin du programme alors que la
// marche continuait) : durée et distance lues dans l'app Forme. Elles priment ensuite sur
// le GPS et sur l'import de la montre.
let fixedRun = null;
function openFixRun(id) {
  const h = load().history.find((x) => x.id === id);
  const box = document.querySelector(`[data-fixbox="${CSS.escape(id)}"]`);
  if (!h || !box) return;
  box.innerHTML = `
    <p class="small" style="margin:10px 0 6px"><b>Chiffres de ta montre</b> (app Forme, séance du jour)</p>
    <div class="row">
      <label class="small" style="flex:1">Durée (min)<input id="fix-min" type="number" inputmode="numeric" min="1" max="600" value="${h.elapsedSec ? Math.round(h.elapsedSec / 60) : ''}"></label>
      <label class="small" style="flex:1">Distance (km)<input id="fix-km" type="number" inputmode="decimal" step="0.01" min="0" value="${h.distanceKm ?? ''}"></label>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn-primary" data-fixsave="${esc(id)}">Enregistrer</button><button data-fixcancel>Annuler</button></div>`;
}
function saveFixRun(id) {
  const min = parseInt(document.getElementById('fix-min')?.value, 10);
  const km = parseFloat(String(document.getElementById('fix-km')?.value || '').replace(',', '.'));
  if (!(km > 0) && !(min > 0)) { alert('Indique au moins la durée ou la distance.'); return; }
  update((d) => {
    const h = d.history.find((x) => x.id === id);
    if (!h) return;
    if (min > 0 && min * 60 !== h.elapsedSec) { h.elapsedSec = min * 60; h.dureeSource = 'manuelle'; }
    if (km > 0 && km !== h.distanceKm) {
      if (h.distanceSource === 'gps' && h.distanceKm) h.distanceGpsKm = h.distanceKm;
      h.distanceKm = Math.round(km * 100) / 100;
      h.distanceSource = 'manuelle';
      h.distanceEstimee = false;
    }
    h.allureSecKm = h.distanceKm && h.elapsedSec ? Math.round(h.elapsedSec / h.distanceKm) : null;
  });
  fixedRun = id;
  render();
}

// --- Chiffres de progression ---------------------------------------------------

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
};
const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));
const sportOf = (h) => h.sport || 'course';
const swimMeters = (h) => (h.swim?.longueurs ? h.swim.longueurs * (h.swim.bassinM || 25) : Math.round((h.distanceKm || 0) * 1000));
// Répétitions faites (gainage en secondes non compté) : la mesure réelle d'une muscu au poids du corps.
const repsOf = (h) => (h.exercices || []).filter((x) => x.unite !== 's').reduce((a, x) => a + (x.reps || []).reduce((s, r) => s + (Number(r) || 0), 0), 0);
// Musculation : en kg dès qu'une charge a été notée, sinon en répétitions (0 kg au poids du corps ne dit rien).
const muscuKey = (history) => (history.some((h) => sportOf(h) === 'muscu' && tonnage(h) > 0) ? 'kg' : 'reps');
const UNIT_LABEL = { km: 'km', m: 'm', kg: 'kg', reps: 'rép.' };
const fmtKm = (km) => (Math.round(km * 10) / 10).toLocaleString('fr-FR');

// Totaux d'une semaine (lundi → dimanche) : km de course, mètres nagés, nombre de séances.
function weekTotals(history, monday) {
  const end = addDays(monday, 7);
  const inWeek = history.filter((h) => { const d = String(h.date).slice(0, 10); return d >= monday && d < end; });
  return {
    km: inWeek.filter((h) => sportOf(h) === 'course').reduce((a, h) => a + (h.distanceKm || 0), 0),
    m: inWeek.filter((h) => sportOf(h) === 'natation').reduce((a, h) => a + swimMeters(h), 0),
    kg: inWeek.filter((h) => sportOf(h) === 'muscu').reduce((a, h) => a + tonnage(h), 0),
    reps: inWeek.filter((h) => sportOf(h) === 'muscu').reduce((a, h) => a + repsOf(h), 0),
    n: inWeek.length,
  };
}

// Calendrier : 2 semaines passées → 12 à venir, une semaine par écran, chaque jour se touche.
function weekStrip(history, plan, sel) {
  const t = today();
  const first = addDays(mondayOf(t), -14);
  const days = Array.from({ length: 14 * 7 }, (_, i) => addDays(first, i));
  return `<div class="week" id="week">${days.map((d, i) => {
    const done = history.filter((h) => String(h.date).slice(0, 10) === d).map(sportOf);
    const planned = plan.filter((p) => p.date === d && p.sport !== 'repos').map((p) => p.sport);
    const dots = [...new Set([...done, ...planned])].map((sp) => `<span class="dot ${sp}${done.includes(sp) ? ' done' : ''}"></span>`).join('');
    const cls = [d === t && 'today', d < t && 'past', d === sel && 'sel', i % 7 === 0 && 'monday'].filter(Boolean).join(' ');
    return `<button data-pickday="${d}" class="${cls}">${'LMMJVSD'[i % 7]}<b>${Number(d.slice(8))}</b><span class="dots">${dots}</span></button>`;
  }).join('')}</div>`;
}

// Exercices de musculation par muscle, avec la dernière charge notée pour chacun.
function muscuLibrary(d) {
  const lieu = d.profile.questionnaire?.lieu || 'salle';
  const last = {};
  for (const h of [...d.history].filter((x) => x.sport === 'muscu').sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    for (const x of h.exercices || []) if (x.poids || x.reps?.some((r) => r > 0)) last[x.id] = x;
  }
  const info = (e) => {
    const x = last[e.id];
    if (!x) return e.materiel === 'corps' ? 'poids du corps' : { machine: 'machine', poulie: 'poulie', barre: 'barre', halteres: 'haltères' }[e.materiel];
    return `dernière fois : ${x.poids ? `${kgLabel(x.poids)} × ` : ''}${Math.max(...x.reps)}${x.unite === 's' ? ' s' : ''}`;
  };
  return `
    <h3>Exercices par muscle</h3>
    <p class="muted small">${esc(LIEUX[lieu].label)}. Pour changer un exercice du programme, choisis-en un autre du même muscle quand tu notes ta séance.</p>
    <div class="lib">${MUSCLES.map((m) => {
      const list = alternatives(m, lieu);
      if (!list.length) return '';
      return `<details><summary>${esc(m[0].toUpperCase() + m.slice(1))} <span class="muted small" style="margin-left:auto;margin-right:8px">${list.length}</span></summary><ul>${list.map((e) => `<li>${esc(e.nom)}<span>${esc(info(e))}</span></li>`).join('')}</ul></details>`;
    }).join('')}</div>`;
}

// En-tête d'une partie du questionnaire : un sport, sa couleur.
const qPartHead = (sport) => `<div class="q-part-head">${icon(sport)}<h2>${SPORT_LABEL[sport]}</h2></div>`;

// Invitation à répondre au questionnaire, tant que ce profil ne l'a pas fait.
const questionnaireBanner = () => `
  <button class="q-banner" data-questionnaire>
    <span><b>Crée ton programme</b><span>Ce que tu vois est un <strong>programme d'exemple</strong>, pas encore adapté à toi. Tes sports, ton objectif, ton niveau, tes jours : 5 étapes, 1 minute.</span></span><i>›</i>
  </button>`;

// Installer l'app : consigne propre à l'appareil, jamais au-dessus de la séance.
function installNotice() {
  if (standalone()) return '';
  if (IOS) return '<div class="notice small"><strong>Installe Foulée :</strong> dans Safari, touche Partager puis « Sur l\'écran d\'accueil », et ouvre l\'app depuis son icône.</div>';
  if (ANDROID) return '<div class="notice small"><strong>Installe Foulée :</strong> dans Chrome, menu ⋮ puis « Ajouter à l\'écran d\'accueil » (ou « Installer l\'application »).</div>';
  return '';
}

// « + Natation » / « + Course » : seulement les sports de ce profil.
function manualButtons(d, cls, date = null, style = '', courseSuffix = '') {
  const b = (sport, label, color) => (practiced(d, sport) ? `<button data-manual="${sport}"${date ? ` data-mdate="${date}"` : ''} class="${cls}" style="color:var(${color})">+ ${label}</button>` : '');
  const autre = `<button data-manual="autre"${date ? ` data-mdate="${date}"` : ''} class="${cls}" style="color:var(--ink)">+ Autre</button>`;
  return `<div class="row"${style ? ` style="${style}"` : ''}>${b('natation', 'Natation', '--swim')}${b('course', `Course${courseSuffix}`, '--run')}${b('muscu', 'Muscu', '--muscu')}${autre}</div>`;
}

// Ce que montre le jour choisi : la séance faite, la séance prévue, ou rien.
function dayPanel(history, plan, sel) {
  const t = today();
  if (sel < t) {
    const done = history.filter((h) => String(h.date).slice(0, 10) === sel);
    if (done.length) return `<div class="list">${done.map((h) => historyRow(h, true)).join('')}</div>`;
    return `<section class="hero rest"><p class="eyebrow">${dateLabel(sel)}</p><p class="hero-num">Rien</p><p class="muted">Aucune séance notée ce jour-là.</p>
      ${manualButtons(load(), 'btn-ghost', sel)}</section>`;
  }
  const p = plan.find((x) => x.date === sel);
  const doneToday = sel === t ? history.filter((h) => String(h.date).slice(0, 10) === sel) : [];
  // Séance faite aujourd'hui (ex. une course refaite) un jour où autre chose est prévu : on montre les deux.
  if (p && p.sport !== 'repos') return `${doneToday.length ? `<h3 style="margin-top:0">Fait aujourd'hui</h3><div class="list" style="margin-bottom:16px">${doneToday.map((h) => historyRow(h)).join('')}</div>` : ''}${sessionCard(p)}`;
  if (doneToday.length) return `<h3 style="margin-top:0">Aujourd'hui</h3><div class="list">${doneToday.map((h) => historyRow(h, true)).join('')}</div>`;
  return `
    <section class="day-card repos">
      <div class="stripes" aria-hidden="true"></div>
      <p class="day-kicker">${sel === t ? 'Ta journée' : dateLabel(sel)}</p>
      <h2 class="day-title">Repos</h2>
      <p class="day-sub">${p ? esc(p.reason) : "C'est là que le corps progresse"}</p>
    </section>`;
}

const FACT_ICONS = {
  temps: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  effort: '<path d="M2 12h4l2-5 4 10 2-5h8"/>',
  niveau: '<path d="M5 20v-5M10 20v-9M15 20v-13M20 20V4"/>',
};
const fact = (k, text) => `<li><svg viewBox="0 0 24 24">${FACT_ICONS[k]}</svg>${text}</li>`;

// Séance du jour choisi, façon affiche : titre géant, trois repères, un seul bouton.
function sessionCard(p) {
  const isToday = p.date === today();
  // Statut écrit en toutes lettres (pas seulement une couleur) : exemple, décalée.
  const exemple = load().profile.questionnaire ? '' : "Programme d'exemple · ";
  const moved = p.moved ? ` · décalée du ${shortDayName(p.moved.from)}` : '';
  const kicker = `${exemple}${isToday ? 'Ta séance du jour' : `Prévue ${dateLabel(p.date)}`}${moved}`;
  if (p.sport === 'natation') {
    return `
      <section class="day-card natation">
        <div class="stripes" aria-hidden="true"></div>
        <p class="day-kicker">${kicker}</p>
        <h2 class="day-title">Natation</h2>
        <p class="day-sub">${p.longueurs} longueurs · ${p.distance} m</p>
        <ul class="day-facts">
          ${fact('temps', `Bassin de ${p.bassin} m`)}
          ${fact('effort', 'Crawl, brasse et dos en alternance')}
          ${fact('niveau', p.focus === 'respiration' ? '4 longueurs pour travailler ta respiration' : 'Pauses de 30 s entre les blocs')}
        </ul>
        ${whyTips(p)}
        ${isToday ? `<button class="cta swim" data-logplan="natation"><span>Noter ma séance</span><i>›</i></button>${autreLink(p)}` : ''}
        ${moveLink(p)}
        <details class="day-detail natation"><summary>Le détail longueur par longueur <i>›</i></summary>
          <ol class="hero-steps">${p.plan.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>
      </section>`;
  }
  if (p.sport === 'muscu') {
    const muscles = [...new Set(p.exercices.map((x) => x.muscle))];
    return `
      <section class="day-card muscu">
        <div class="stripes" aria-hidden="true"></div>
        <p class="day-kicker">${kicker}</p>
        <h2 class="day-title">Muscu</h2>
        <p class="day-sub">${esc(p.title)}</p>
        <ul class="day-facts">
          ${fact('effort', `${p.exercices.length} exercices · ${p.exercices[0].series} séries chacun`)}
          ${fact('niveau', esc(muscles.slice(0, 4).join(', ') + (muscles.length > 4 ? '…' : '')))}
          ${fact('temps', `${p.repos} s de repos entre les séries`)}
        </ul>
        ${whyTips(p)}
        ${isToday ? `${muscuCta()}${autreLink(p)}` : ''}
        ${moveLink(p)}
        <details class="day-detail muscu"><summary>Exercices, charges et répétitions <i>›</i></summary>${exoList(p)}</details>
      </section>`;
  }
  const mins = Math.round(total(p.steps) / 60);
  const runs = p.steps.filter((s) => KINDS[s.kind].effort === 'course');
  const runText = runs.length === 1 ? `${minutesLabel(runs[0].duration)} de course sans t'arrêter` : `${runs.length} × ${minutesLabel(runs[0].duration)} de course, marche entre`;
  return `
    <section class="day-card course">
      <div class="stripes" aria-hidden="true"></div>
      <p class="day-kicker">${kicker}</p>
      <h2 class="day-title">Course</h2>
      <p class="day-sub">Palier ${p.level}/${p.max} · ${runs.length === 1 ? 'continu' : 'marche-course'}</p>
      <ul class="day-facts">
        ${fact('temps', `${mins} min, échauffement compris`)}
        ${fact('effort', runText)}
        ${fact('niveau', 'Allure où tu peux encore parler')}
      </ul>
      ${whyTips(p)}
      ${isToday
        ? `<button class="cta" data-startplan="${esc(p.date)}"><span>Démarrer ma séance</span><i>›</i></button>
           <button class="day-link" data-logplan="course">Faite sans l'app : la noter ›</button>
           ${autreLink(p)}`
        : `<button class="cta ghost" data-startplan="${esc(p.date)}"><span>La faire maintenant</span><i>›</i></button>`}
      ${moveLink(p)}
    </section>`;
}

// « Mes indicateurs » : la semaine en cours comparée à la précédente.
function miniBars(vals, cls) {
  const max = Math.max(...vals) || 1;
  return `<span class="mini-bars ${cls}">${vals.map((v, i) => `<i class="${i === vals.length - 1 ? 'cur' : ''}" style="height:${Math.max(12, (v / max) * 100)}%"></i>`).join('')}</span>`;
}
function spark(vals) {
  if (vals.length < 2) return '';
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 60},${4 + (max === min ? 10 : ((v - min) / (max - min)) * 20)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 60 28" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
function pct(cur, prev) {
  if (!prev) return cur ? '<em class="up">nouveau</em>' : '<em>–</em>';
  const v = Math.round(((cur - prev) / prev) * 100);
  return `<em class="${v > 0 ? 'up' : ''}">${v > 0 ? '+' : ''}${v} %</em>`;
}
function indicators(history) {
  const monday = mondayOf(today());
  const weeks = Array.from({ length: 5 }, (_, i) => addDays(monday, (i - 4) * 7));
  const km = weeks.map((w) => weekTotals(history, w).km);
  const time = weeks.map((w) => {
    const end = addDays(w, 7);
    return history.filter((h) => { const d = String(h.date).slice(0, 10); return d >= w && d < end; }).reduce((a, h) => a + (h.elapsedSec || 0), 0);
  });
  const t = time.at(-1);
  // Allure : les dernières courses mesurées (marche comprise), de la plus ancienne à la plus récente.
  const paces = history.filter((h) => sportOf(h) === 'course')
    .map((h) => ({ d: String(h.date), v: h.allureSecKm || (h.distanceKm && h.elapsedSec && !h.distanceEstimee ? h.elapsedSec / h.distanceKm : 0) }))
    .filter((x) => x.v).sort((a, b) => a.d.localeCompare(b.d)).slice(-6).map((x) => x.v);
  const lastPace = paces.at(-1);
  const gain = paces.length > 1 ? Math.round(paces.at(-2) - lastPace) : null;
  return `
    <div class="ind-head"><h3>Mes indicateurs</h3><button class="day-link" data-tab="progression">Voir tout ›</button></div>
    <div class="ind">
      <div><span class="ind-label">Semaine</span><b>${fmtKm(km.at(-1))}<small>km</small></b><span class="ind-foot">${miniBars(km, 'course')}${pct(km.at(-1), km.at(-2))}</span></div>
      <div><span class="ind-label">Temps d'activité</span><b>${t >= 3600 ? `${Math.floor(t / 3600)}<small>h</small>` : ''}${Math.round((t % 3600) / 60)}<small>min</small></b><span class="ind-foot">${miniBars(time, 'neutral')}${pct(t, time.at(-2))}</span></div>
      <div><span class="ind-label">Dernière allure</span><b>${lastPace ? allure(lastPace).replace('/km', '') : '–'}<small>/km</small></b><span class="ind-foot">${spark(paces)}${gain === null ? '<em>–</em>' : `<em class="${gain > 0 ? 'up' : ''}">${gain > 0 ? '−' : '+'}${Math.abs(gain)} s</em>`}</span></div>
    </div>`;
}

// Courbe des 8 dernières semaines (km de course ou mètres nagés).
function weekCurve(history, kind, unitKey) {
  const monday = mondayOf(today());
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(monday, (i - 7) * 7));
  const unit = unitKey || { course: 'km', natation: 'm', muscu: 'kg' }[kind];
  const vals = weeks.map((w) => weekTotals(history, w)[unit]);
  const max = Math.max(...vals) || 1;
  const W = 320;
  const H = 130;
  const pts = vals.map((v, i) => [12 + (i * (W - 24)) / 7, 112 - (v / max) * 92]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  const color = { course: 'var(--run)', natation: 'var(--swim)', muscu: 'var(--muscu)' }[kind];
  const [lx, ly] = pts.at(-1);
  // Bulle au toucher d'un point : le récap de la semaine, rien que du mesuré.
  const hit = weeks.map((w, i) => {
    const lines = vals[i] ? curveTip(history, w, kind) : null;
    if (!lines) return '<span></span>';
    const x = (pts[i][0] / W) * 100;
    const y = Math.round((pts[i][1] / H) * 140); // .curve fait 140 px de haut
    return `<button type="button" data-curvetip="${i}" style="--x:${x}%;--y:${y}px" aria-label="${esc(lines.join(', '))}"><span class="curve-tip ${kind}${i < 2 ? ' edge-l' : i > 5 ? ' edge-r' : ''}">${lines.map((l, j) => (j ? `<span>${esc(l)}</span>` : `<b>${esc(l)}</b>`)).join('')}</span></button>`;
  }).join('');
  return `
    <div class="curve-wrap">
    <div class="curve-hit">${hit}</div>
    <svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="area-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${lx},${H} L${pts[0][0]},${H} Z" fill="url(#area-${kind})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      ${pts.map(([x, y], i) => (vals[i] ? `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>` : '')).join('')}
      <circle cx="${lx}" cy="${ly}" r="9" fill="${color}" opacity="0.25"/>
    </svg>
    <div class="curve-x">${weeks.map((w, i) => `<span>${vals[i] ? `<b>${kind === 'course' ? fmtKm(vals[i]) : unit === 'kg' && vals[i] >= 1000 ? `${fmtKm(vals[i] / 1000)}t` : Math.round(vals[i])}</b>` : '<b>·</b>'}${Number(w.slice(8))}/${Number(w.slice(5, 7))}</span>`).join('')}</div>
    </div>`;
}

// Durée lisible : « 45 min », « 1 h 05 ».
const dureeCourte = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

// Récap d'une semaine pour la bulle de la courbe. La durée n'apparaît que si chaque séance l'a.
function curveTip(history, monday, kind) {
  const end = addDays(monday, 7);
  const list = history.filter((h) => { const d = String(h.date).slice(0, 10); return d >= monday && d < end && sportOf(h) === kind; });
  if (!list.length) return null;
  const lines = [`Semaine du ${Number(monday.slice(8))}/${Number(monday.slice(5, 7))}`];
  if (kind === 'natation') {
    const withLg = list.filter((h) => h.swim?.longueurs);
    const lg = withLg.reduce((a, h) => a + h.swim.longueurs, 0);
    const m = list.reduce((a, h) => a + swimMeters(h), 0);
    if (lg && withLg.length === list.length) {
      const bassins = [...new Set(withLg.map((h) => h.swim.bassinM || 25))];
      lines.push(`${lg} longueurs${bassins.length === 1 ? ` · ${bassins[0]} m` : ''}`);
    }
    lines.push(`${m.toLocaleString('fr-FR')} m`);
  } else if (kind === 'course') {
    lines.push(`${fmtKm(list.reduce((a, h) => a + (h.distanceKm || 0), 0))} km`);
  } else {
    const reps = list.reduce((a, h) => a + repsOf(h), 0);
    const kg = list.reduce((a, h) => a + tonnage(h), 0);
    if (reps) lines.push(`${reps} répétitions`);
    if (kg) lines.push(`${Math.round(kg).toLocaleString('fr-FR')} kg soulevés`);
  }
  if (list.every((h) => h.elapsedSec > 0)) lines.push(dureeCourte(list.reduce((a, h) => a + h.elapsedSec, 0)));
  if (list.length > 1) lines.push(`${list.length} séances`);
  return lines;
}

// --- Sons -------------------------------------------------------------------

// À changer à chaque régénération des clips : l'URL change, donc aucun ancien cache ne sert.
const AUDIO_VERSION = '4';
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

// --- Avant de partir ------------------------------------------------------------
// Choisir une séance n'est pas la démarrer : on vérifie d'abord GPS, son et écran,
// puis « Je suis prêt » lance la piste (dans le geste, comme iOS l'exige).

let prep = null; // { session, from, gps, acc, watch, audio, testing }
const testAudio = new Audio();
testAudio.setAttribute('playsinline', '');

function openPrepare(session) {
  if (!session) return;
  stopPrepGps();
  prep = { session, from: current === 'prepare' ? prep?.from : current, gps: 'attente', acc: null, watch: null, audio: audioAssets ? 'ok' : 'chargement', testing: false };
  startPrepGps();
  if (!audioAssets) {
    loadAudio().then(() => { if (prep) prep.audio = 'ok'; }).catch(() => { if (prep) prep.audio = 'erreur'; })
      .finally(() => { if (current === 'prepare') render(); });
  }
  go('prepare');
}

function startPrepGps() {
  if (!prep) return;
  if (!('geolocation' in navigator)) { prep.gps = 'indispo'; return; }
  prep.gps = 'attente';
  prep.watch = navigator.geolocation.watchPosition(
    (pos) => {
      if (!prep) return;
      prep.acc = Math.round(pos.coords.accuracy);
      prep.gps = pos.coords.accuracy <= 30 ? 'ok' : 'faible';
      updatePrepGps();
    },
    (err) => {
      if (!prep) return;
      prep.gps = err.code === 1 ? 'refuse' : 'attente';
      updatePrepGps();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}
function stopPrepGps() {
  if (prep?.watch != null) navigator.geolocation.clearWatch(prep.watch);
  if (prep) prep.watch = null;
}
function updatePrepGps() {
  const el = document.getElementById('prepgps');
  if (el && current === 'prepare') el.outerHTML = prepGpsBlock();
}

// Où réautoriser la localisation : seulement la consigne de l'appareil utilisé.
const gpsSettingsHelp = () => (IOS
  ? (standalone()
    ? 'Pour la réactiver : Réglages > Confidentialité et sécurité > Service de localisation > Sites web Safari > « Lorsque l\'app est active », puis rouvre Foulée.'
    : 'Pour la réactiver : touche « aA » dans la barre d\'adresse de Safari > Réglages du site web > Position > Autoriser. Vérifie aussi Réglages > Confidentialité > Service de localisation > Sites web Safari.')
  : ANDROID
    ? 'Pour la réactiver : touche le cadenas (ou ⓘ) à gauche de l\'adresse dans Chrome > Autorisations > Position > Autoriser. Vérifie que la localisation du téléphone est allumée.'
    : 'Pour la réactiver : autorise la position pour ce site dans les réglages du navigateur.');

function prepGpsBlock() {
  const g = prep?.gps;
  const row = (cls, title, text, extra = '') => `<li id="prepgps" class="prep-item ${cls}"><b>${title}</b><span>${text}</span>${extra}</li>`;
  if (g === 'ok') return row('ok', '✓ GPS prêt', `Précision ±${prep.acc} m : la distance et le tracé seront mesurés.`);
  if (g === 'faible') return row('wait', '… GPS faible', `Précision ±${prep.acc} m. Mets-toi à découvert et attends quelques secondes ; tu peux partir quand même, la distance sera moins juste.`);
  if (g === 'refuse') return row('ko', '✕ GPS refusé', `Pas de distance, d'allure ni de tracé pour cette séance. Le chrono et les signaux marchent normalement. ${gpsSettingsHelp()}`, '<button class="btn-ghost small-btn" data-gpsretry>Réessayer</button>');
  if (g === 'indispo') return row('ko', '✕ GPS indisponible', 'Ce navigateur ne donne pas la position : séance sans distance ni tracé.');
  return row('wait', '… Recherche du GPS', 'Autorise la position si le téléphone la demande. La séance peut démarrer sans attendre.');
}

function prepSoundBlock() {
  const musique = load().settings.son !== 'exclusif';
  const a = prep?.audio;
  if (a === 'erreur') return '<li class="prep-item ko"><b>✕ Sons non chargés</b><span>Vérifie ta connexion puis réessaie : sans les sons, pas de signaux.</span><button class="btn-ghost small-btn" data-soundretry>Réessayer</button></li>';
  if (a !== 'ok') return '<li class="prep-item wait"><b>… Chargement des sons</b><span>Quelques secondes.</span></li>';
  const how = IOS
    ? (musique ? 'Mode « Avec ma musique » : iPhone <strong>hors mode silencieux</strong>, sinon aucun signal. Ta musique continue.' : 'Mode « Sans musique » : ta musique sera mise en pause pendant la séance.')
    : 'Monte le volume média du téléphone avant de partir.';
  return `<li class="prep-item ok"><b>✓ Signaux prêts</b><span>Notes qui montent = cours, qui descendent = marche, 3 bips avant chaque changement. ${how}</span>
    <button class="btn-ghost small-btn" data-testsignal>${prep.testing ? 'Écoute…' : 'Tester les signaux (6 s)'}</button></li>`;
}

// Ce qui marche vraiment écran verrouillé, selon l'appareil et le mode.
function prepScreenBlock() {
  const musique = load().settings.son !== 'exclusif';
  let text;
  if (IOS) {
    text = musique
      ? 'Garde l\'écran allumé : téléphone verrouillé, les signaux <strong>et</strong> le GPS s\'arrêtent. Foulée empêche la mise en veille ; pour la poche, utilise « Bloquer l\'écran ».'
      : 'Téléphone verrouillé : les signaux continuent, mais le GPS s\'arrête (distance incomplète). Pour mesurer la distance, garde l\'écran allumé avec « Bloquer l\'écran ».';
  } else if (ANDROID) {
    text = 'Garde l\'écran allumé : écran éteint, le GPS s\'arrête. Les signaux peuvent continuer selon le téléphone, ce n\'est pas encore vérifié sur Android. Pour la poche, utilise « Bloquer l\'écran ».';
  } else {
    text = 'Garde l\'écran allumé pendant toute la séance : sinon le GPS et parfois les signaux s\'arrêtent.';
  }
  return `<li class="prep-item info"><b>Écran allumé</b><span>${text}</span></li>`;
}

// Bilan pas encore enregistré (onglet quitté) : gardé à part, sur le téléphone, jusqu'à décision.
const PARK_KEY = 'foulee.bilan';
let parkedBilan = null;
try { parkedBilan = JSON.parse(localStorage.getItem(PARK_KEY)); } catch {}
const pendingBilan = () => parkedBilan;
function parkBilan(b) {
  parkedBilan = b;
  try { if (b) localStorage.setItem(PARK_KEY, JSON.stringify(b)); else localStorage.removeItem(PARK_KEY); } catch {}
}
function pendingBilanAlert() {
  const b = pendingBilan();
  if (!b) return '';
  return `<div class="alert pending">Bilan à faire : « ${esc(b.sessionName)} » (${mmss(b.elapsedSec)}) n'est pas encore enregistrée.
    <div class="row" style="margin-top:10px"><button class="btn-dark" data-backbilan>Faire le bilan</button><button data-dropbilan>Ne pas l'enregistrer</button></div></div>`;
}

// Fin de séance avant la dernière étape : confirmation en grand, pour ne rien arrêter par erreur.
function openFinishSheet() {
  if (!live) return;
  const { starts, end } = live.track;
  const steps = live.session.steps;
  const i = stepAt(starts, end, audio.currentTime);
  if (i >= steps.length) { go('bilan'); return; }
  const left = Math.max(0, Math.round(end - Math.max(audio.currentTime, starts[0])));
  const stepsLeft = steps.length - Math.max(0, i);
  closeFinishSheet();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="hr-sheet finish-sheet" role="dialog" aria-label="Terminer la séance">
      <div class="hr-sheet-in">
        <h2>Terminer maintenant ?</h2>
        <p>Il reste <b>${mmss(left)}</b> et ${stepsLeft} étape${stepsLeft > 1 ? 's' : ''}. Ce que tu as déjà fait est gardé pour le bilan.</p>
        <button class="btn-primary" data-finishno>Continuer la séance</button>
        <button class="btn-stop" data-finishok>Terminer et faire le bilan</button>
      </div>
    </div>`);
  document.body.classList.add('sheet-open');
}
function closeFinishSheet() {
  document.querySelector('.finish-sheet')?.remove();
  if (!document.querySelector('.hr-sheet')) document.body.classList.remove('sheet-open');
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
    anchors: [], // repères (position dans la piste, heure) : heure réelle de chaque étape, pour le cardio
  };
  if (resume) {
    // Ce qui a été mesuré avant la fermeture est repris (tracé, distance, heures des étapes) ;
    // le trajet fait pendant que l'app était fermée n'est pas inventé : coupure notée.
    if (resume.gps) live.gps = restoreTrack(resume.gps);
    if (Array.isArray(resume.anchors)) live.anchors = resume.anchors.slice(-900);
    live.gps.gaps++;
    live.gps.cut = true;
  }
  if (resume?.overSec) live.overBase = resume.overSec; // reprise après la fin du programme
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
      overSec: live.overAt ? Math.round(liveElapsed()) : null,
      gps: packTrack(live.gps), anchors: live.anchors,
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
      // Pas de distance pendant une pause : on ne compte que le temps de séance. Après la fin
      // du programme, la piste est finie mais la séance continue jusqu'à « Terminer ».
      if (audio.paused && !live.overAt) return;
      if (pos.coords.accuracy <= 30) addAltitude(live.gps, pos.coords.altitude, pos.coords.altitudeAccuracy, pos.timestamp);
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
// Une webapp ne peut pas verrouiller le téléphone : on pose un calque qui avale tous les touchers.
// Seul un appui long de 2 s sur le bouton cadenas débloque. Le geste est annulé si le doigt bouge,
// sort du bouton ou si un deuxième contact apparaît (le tissu touche en plusieurs points).
let touchLocked = false;
const UNLOCK_MS = 2000;
function renderTouchLock() {
  let el = document.getElementById('touchlock');
  if (!touchLocked) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'touchlock';
  el.innerHTML = `
    <button class="lock-extend" type="button" hidden><i></i><span>+1 répétition</span><small></small><em>Maintiens 2 secondes</em></button>
    <div class="lock-zone">
      <div class="lock-badge">Touches bloquées</div>
      <button class="lock-btn" type="button" aria-label="Maintenir 2 secondes pour débloquer"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="lock-ring" cx="50" cy="50" r="46"/></svg><span>🔒</span></button>
      <p class="lock-label">Maintiens le cadenas 2 secondes pour débloquer</p>
    </div>`;
  // Deux boutons à appui long : le cadenas débloque, « +1 répétition » prolonge sans débloquer.
  const holdable = [
    [el.querySelector('.lock-btn'), () => { touchLocked = false; renderTouchLock(); }],
    [el.querySelector('.lock-extend'), () => { extendLive(); if (live) updateExtend(liveStep()); }],
  ];
  const pointers = new Set();
  let hold = null; // { id, x0, y0, timer, btn }
  const cancel = () => { if (hold) { clearTimeout(hold.timer); hold.btn.classList.remove('holding'); } hold = null; };
  const swallow = (e) => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); };
  for (const type of ['click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'gesturestart', 'wheel']) {
    el.addEventListener(type, swallow, { passive: false });
  }
  el.addEventListener('pointerdown', (e) => {
    swallow(e);
    pointers.add(e.pointerId);
    if (pointers.size > 1) { cancel(); return; } // plusieurs contacts = tissu, pas un doigt
    const target = holdable.find(([b]) => !b.hidden && b.contains(e.target));
    if (!target) return;
    cancel();
    const [btn, action] = target;
    hold = { id: e.pointerId, x0: e.clientX, y0: e.clientY, btn, timer: setTimeout(() => { btn.classList.remove('holding'); hold = null; action(); }, UNLOCK_MS) };
    btn.classList.add('holding');
  });
  el.addEventListener('pointermove', (e) => {
    swallow(e);
    if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > 20) cancel();
  });
  const end = (e) => {
    swallow(e);
    pointers.delete(e.pointerId);
    if (hold && e.pointerId === hold.id) cancel();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
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

// Prolonger en direct : la piste est regravée avec les étapes ajoutées (ou retirées) et
// reprend au même instant. Les étapes déjà passées gardent leur position dans la piste.
function reshapeSession(next) {
  if (!live || next === live.session) return;
  let track;
  try {
    track = assemble(next.steps, audioAssets.index, audioAssets.pack, { voice: load().settings.annonces === 'voix' });
  } catch (e) {
    alert(`Impossible d'ajouter la répétition : ${e.message}`);
    return;
  }
  const pos = audio.currentTime;
  const wasPlaying = !audio.paused;
  const oldUrl = live.url;
  live.session = next;
  live.track = track;
  live.url = URL.createObjectURL(new Blob([track.bytes], { type: 'audio/mpeg' }));
  live.swapping = true;
  audio.src = live.url;
  audio.currentTime = pos;
  const done = () => {
    if (!live || !live.swapping) return;
    if (Math.abs(audio.currentTime - pos) > 0.5) audio.currentTime = pos;
    live.swapping = false;
  };
  audio.addEventListener('loadedmetadata', done, { once: true });
  setTimeout(done, 3000);
  if (wasPlaying) audio.play().catch((e) => { if (e.name !== 'AbortError') alert(`Lecture impossible : ${e.message}`); });
  URL.revokeObjectURL(oldUrl);
  saveLive();
  if (current === 'live') render();
}
// Temps de séance (s) : position dans la piste, puis horloge après la fin du programme.
function liveElapsed() {
  if (!live) return 0;
  if (live.overAt) return live.overBase + (Date.now() - live.overAt) / 1000;
  return Math.max(0, audio.currentTime - live.track.starts[0]);
}
const liveStep = () => (live ? stepAt(live.track.starts, live.track.end, audio.currentTime) : -1);
function extendLive() {
  const i = liveStep();
  if (live && canExtend(live.session, i)) reshapeSession(extend(live.session, i, audio.currentTime - live.track.starts[i]));
}
function retractLive() {
  const i = liveStep();
  if (live && canRetract(live.session, i)) reshapeSession(retract(live.session, i));
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
      artwork: [{ src: 'icons/f-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch {}
}

const anchor = () => {
  if (live && !live.swapping && !live.done && live.anchors.length < 1000) live.anchors.push([audio.currentTime, Date.now()]);
};
audio.addEventListener('seeked', anchor);
audio.addEventListener('playing', anchor);
audio.addEventListener('timeupdate', () => {
  if (!live || live.swapping) return;
  live.maxTime = Math.max(live.maxTime, audio.currentTime);
  if (Date.now() - lastLiveSave > 5000) saveLive();
  const i = stepAt(live.track.starts, live.track.end, audio.currentTime);
  if (i !== live.lastStep) {
    anchor();
    live.lastStep = i;
    updateMediaMetadata(i);
  }
});
// Fin du programme : la piste s'arrête, pas la séance. Chrono, GPS et distance continuent
// (fin de la marche, retour) jusqu'à l'appui sur « Terminer ».
audio.addEventListener('ended', () => {
  if (!live || live.done || live.overAt) return;
  live.overBase ??= Math.max(0, live.maxTime - live.track.starts[0]);
  live.overAt = Date.now();
  saveLive();
  if (current === 'live') render();
});
audio.addEventListener('pause', () => {
  saveLive();
  if (current === 'live') render();
});
audio.addEventListener('play', () => {
  if (live) live.userPaused = false;
  if (current === 'live') render();
});

// Bouton « +1 répétition » : pendant la récupération seulement. Elle devient la marche du
// palier, puis une course, puis une nouvelle récupération.
const repLabel = (st) => `marche ${minutesLabel(st.walk.duration)}, puis ${minutesLabel(st.run.duration)} de course`;
function updateExtend(i) {
  const box = document.getElementById('extend');
  const st = extendState(live.session);
  const can = canExtend(live.session, i);
  const undo = canRetract(live.session, i);
  const show = can || undo;
  if (box) {
    box.hidden = !show || touchLocked; // bloqué : le bouton passe sur le calque (appui long)
    if (show) {
      const done = st.extra ? `<b>+${st.extra} ajoutée${st.extra > 1 ? 's' : ''}</b> · ` : '';
      const info = can
        ? `${done}Tu te sens bien ? Ta récup devient la ${repLabel(st)}.${st.left < MAX_EXTRA ? ` Encore ${st.left} possible${st.left > 1 ? 's' : ''}.` : ''}`
        : `${done}Marche, puis ${minutesLabel(st.run.duration)} de course.`;
      const key = `${can}|${undo}|${info}`;
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = `${can ? '<button class="extend-btn" data-extend>+1 répétition</button>' : ''}
          <p class="extend-info">${info}${undo ? ' <button class="linkbtn" data-unextend>Annuler</button>' : ''}</p>`;
      }
    }
  }
  const lockBtn = document.querySelector('#touchlock .lock-extend');
  if (lockBtn) {
    lockBtn.hidden = !can;
    if (can) lockBtn.querySelector('small').textContent = `Ta récup devient la ${repLabel(st)}${st.extra ? ` · +${st.extra} déjà` : ''}`;
  }
}

// Affichage du lecteur : relu à chaque image depuis la position de la piste, donc sans dérive.
function tick() {
  if (current !== 'live' || !live) return;
  if (live.swapping) { requestAnimationFrame(tick); return; }
  const { starts, end } = live.track;
  const steps = live.session.steps;
  const t = audio.currentTime;
  const i = stepAt(starts, end, t);
  const el = (id) => document.getElementById(id);
  if (!el('count')) return;
  // Changement d'étape : l'écran clignote (vert = course, blanc = marche).
  if (live.shownStep !== undefined && i !== live.shownStep && i >= 0 && i < steps.length) {
    const flash = KINDS[steps[i].kind].effort === 'course' ? 'flash-course' : 'flash-marche';
    document.body.classList.remove('flash-course', 'flash-marche');
    void document.body.offsetWidth;
    document.body.classList.add(flash);
    setTimeout(() => document.body.classList.remove(flash), 1500);
  }
  live.shownStep = i;
  const effort = i >= 0 && i < steps.length ? KINDS[steps[i].kind].effort : 'marche';
  el('live').dataset.effort = effort;
  if (i < 0) {
    el('now').textContent = 'Prépare-toi';
    el('count').textContent = mmss(starts[0] - t);
    el('next').innerHTML = `<span class="muted">Ensuite</span> ${esc(KINDS[steps[0].kind].label)}`;
  } else if (i >= steps.length) {
    el('now').textContent = 'Programme fini';
    el('count').textContent = live.overAt ? `+${mmss((Date.now() - live.overAt) / 1000)}` : '0:00';
    el('count').classList.toggle('over', Boolean(live.overAt));
    el('next').textContent = 'Le chrono et le GPS continuent jusqu\'à « Terminer ».';
  } else {
    el('now').textContent = effort === 'course' ? 'Cours' : 'Marche';
    el('count').textContent = mmss(starts[i] + steps[i].duration - t);
    const n = steps[i + 1];
    el('next').innerHTML = n ? `<span class="muted">Ensuite</span> ${esc(KINDS[n.kind].label)} · ${minutesLabel(n.duration)}` : 'Dernière étape';
  }
  updateExtend(i);
  el('stepno').textContent = i < 0 ? 'Départ' : i >= steps.length ? 'Fin' : `Étape ${i + 1}/${steps.length} · ${KINDS[steps[i].kind].label}`;
  // Barre : chaque étape à sa couleur (vert = course, blanc = marche), passé plein, futur estompé.
  const segs = el('bar')?.querySelectorAll('.seg > i') || [];
  segs.forEach((f, k) => { f.style.width = `${Math.max(0, Math.min(1, (t - starts[k]) / steps[k].duration)) * 100}%`; });
  if (el('cursor')) el('cursor').style.left = `${Math.max(0, Math.min(100, ((t - starts[0]) / (end - starts[0])) * 100))}%`;
  // Mi-séance : même instant que le son gravé dans la piste. Seulement au franchissement
  // (une reprise après la moitié ne le rejoue pas).
  const half = live.track.half;
  if (half && live.lastT !== undefined && live.lastT < half && t >= half && t - live.lastT < 2) {
    document.body.classList.remove('flash-moitie');
    void document.body.offsetWidth;
    document.body.classList.add('flash-moitie');
    setTimeout(() => document.body.classList.remove('flash-moitie'), 2600);
    live.halfShownUntil = Date.now() + 8000;
  }
  live.lastT = t;
  el('halfway').hidden = !(live.halfShownUntil > Date.now());
  el('elapsed').textContent = mmss(liveElapsed());
  const g = summary(live.gps, liveElapsed());
  el('dist').textContent = g.distanceKm ? g.distanceKm.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '0,00';
  // Allure du moment (≈ 25 dernières secondes) ; la moyenne de la séance en dessous.
  const now = currentPace(live.gps, Date.now());
  el('pace').textContent = now ? allure(now).replace('/km', '') : '–';
  el('paceavg').textContent = g.allureSecKm ? `moy. ${allure(g.allureSecKm).replace('/km', '')}` : 'moy. –';
  el('gpsdot').classList.toggle('ok', !live.gpsError && Boolean(g.distanceKm));
  el('gpsstate').textContent = live.gpsError || (g.distanceKm ? 'GPS' : 'GPS…');
  // Message GPS : réécrit seulement s'il change (le bouton « Réessayer » doit rester cliquable).
  const gpsHtml = live.gpsError === 'GPS refusé'
    ? '<p><b>GPS refusé :</b> pas de distance ni de tracé. Le chrono et les signaux continuent.</p><button class="btn-ghost small-btn" data-gpsretry>Réessayer le GPS</button>'
    : live.gpsError ? `<p>${esc(live.gpsError)} : distance pas encore mesurée.</p>`
      : g.gpsIncomplet ? '<p>GPS coupé un moment : distance incomplète.</p>' : '';
  if (live.gpsHtml !== gpsHtml) { el('gps').innerHTML = gpsHtml; live.gpsHtml = gpsHtml; }
  el('livedone').hidden = i < steps.length;
  requestAnimationFrame(tick);
}

// --- Questionnaire de chaque profil -------------------------------------------

let qDraft = null; // réponses en cours (copie), null hors du questionnaire

const sameLevelOpts = { maxLevel: LEVELS.length };
function openQuestionnaire() {
  const d = load();
  const q = d.profile.questionnaire;
  const lastSwim = d.history.filter((h) => sportOf(h) === 'natation' && h.swim?.bassinM).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
  const bassin = q?.bassin || lastSwim?.swim.bassinM || 25;
  // Sans réponse : les sports déjà pratiqués d'après l'historique, sinon rien de coché.
  const fromHistory = [...new Set(d.history.map(sportOf))].filter((x) => SPORTS_ORDER.includes(x));
  qDraft = {
    sports: [...(q?.sports ?? fromHistory)],
    objectifCourse: q?.objectifCourse ?? null,
    niveauCourse: q?.niveauCourse ?? null,
    joursCourse: [...(q?.joursCourse ?? d.settings.joursCourse ?? [1, 5])],
    bassin,
    objectifNatation: q?.objectifNatation ?? null,
    niveauNatation: q?.niveauNatation ?? null,
    joursNatation: [...(q?.joursNatation ?? d.settings.joursNatation ?? [3])],
    objectifMuscu: q?.objectifMuscu ?? null,
    lieu: q?.lieu ?? null,
    niveauMuscu: q?.niveauMuscu ?? null,
    joursMuscu: [...(q?.joursMuscu ?? [])],
    error: null,
    step: 0,
  };
  go('questionnaire');
}

// Niveau déjà connu par l'historique : on ne le redemande pas (et on ne l'écrase pas).
const hasRuns = (d) => d.history.some((h) => sportOf(h) === 'course' && runLevel(h));
const hasSwims = (d) => d.history.some((h) => sportOf(h) === 'natation' && h.swim?.longueurs);

// Parcours en étapes : chaque contrôle appartient à une étape, qui le vérifie avant « Continuer ».
const Q_STEPS = [
  ['sports', 'Tes sports'],
  ['objectifs', 'Tes objectifs'],
  ['niveau', 'Ton niveau'],
  ['jours', 'Tes jours'],
  ['recap', 'Récapitulatif'],
];
function qChecks(q, d) {
  const out = [];
  const need = (step, ok, msg) => { if (!ok) out.push([step, msg]); };
  need('sports', q.sports.length, 'Choisis au moins un sport.');
  if (q.sports.includes('course')) {
    need('objectifs', q.objectifCourse, 'Choisis ton objectif de course.');
    need('niveau', hasRuns(d) || q.niveauCourse, 'Dis combien de temps tu cours sans t’arrêter aujourd’hui.');
    need('jours', q.joursCourse.length, 'Choisis au moins un jour de course.');
  }
  if (q.sports.includes('natation')) {
    need('objectifs', q.objectifNatation, 'Choisis ton objectif de natation.');
    need('niveau', hasSwims(d) || q.niveauNatation, 'Dis combien de longueurs tu nages aujourd’hui.');
    need('jours', q.joursNatation.length, 'Choisis au moins un jour de natation.');
  }
  if (q.sports.includes('muscu')) {
    need('objectifs', q.objectifMuscu, 'Choisis ton objectif en musculation.');
    need('objectifs', q.lieu, 'Dis où tu fais ta musculation.');
    need('niveau', q.niveauMuscu, 'Dis où tu en es en musculation.');
    need('jours', q.joursMuscu.length, 'Choisis au moins un jour de musculation.');
  }
  const jours = q.sports.flatMap((x) => q[DAYS_KEY[x]]);
  need('jours', new Set(jours).size === jours.length, 'Un seul sport par jour : un jour est coché pour deux sports.');
  return out;
}
function questionnaireErrors(q, d) {
  return qChecks(q, d)[0]?.[1] ?? null;
}
const stepError = (q, d, step) => qChecks(q, d).find(([st]) => st === step)?.[1] ?? null;

// Les réponses gardées : celles des sports choisis seulement.
function cleanAnswers(q, d) {
  const out = { v: 1, answeredAt: Date.now(), sports: SPORTS_ORDER.filter((x) => q.sports.includes(x)) };
  if (out.sports.includes('course')) {
    Object.assign(out, { objectifCourse: q.objectifCourse, joursCourse: [...q.joursCourse].sort() });
    if (!hasRuns(d)) out.niveauCourse = q.niveauCourse;
  }
  if (out.sports.includes('natation')) {
    Object.assign(out, { bassin: q.bassin, objectifNatation: q.objectifNatation, joursNatation: [...q.joursNatation].sort() });
    if (!hasSwims(d)) out.niveauNatation = q.niveauNatation;
  }
  if (out.sports.includes('muscu')) {
    Object.assign(out, { objectifMuscu: q.objectifMuscu, lieu: q.lieu, niveauMuscu: q.niveauMuscu, joursMuscu: [...q.joursMuscu].sort() });
  }
  return out;
}
const SPORTS_ORDER = ['course', 'natation', 'muscu'];
const DAYS_KEY = { course: 'joursCourse', natation: 'joursNatation', muscu: 'joursMuscu' };

const radio = (name, value, cur, label, detail) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${String(cur) === String(value) ? 'checked' : ''}><span><strong>${esc(label)}</strong>${detail ? ` : ${esc(detail)}` : ''}</span></label>`;
// Jours d'un sport ; ceux déjà pris par un autre sport choisi sont grisés (un sport par jour).
const qDays = (key, sel, cls = '') => {
  const taken = new Set(qDraft.sports.map((x) => DAYS_KEY[x]).filter((k) => k !== key).flatMap((k) => qDraft[k]));
  return `<div class="days ${cls}">${JOURS.map(([n, l]) => `<button data-qday="${key}" data-v="${n}" class="${sel.includes(n) ? 'on' : ''}" ${taken.has(n) && !sel.includes(n) ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
};

// Résumé des réponses pour le Profil.
function answersSummary(q) {
  const jours = (list) => JOURS.filter(([n]) => list.includes(n)).map(([n]) => ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][n]).join(', ');
  const lines = [];
  if (q.sports.includes('course')) lines.push(['course', `${GOALS_RUN[q.objectifCourse]?.label ?? 'Course'} · ${jours(q.joursCourse)}`]);
  if (q.sports.includes('natation')) lines.push(['natation', `${(q.objectifNatation / 1000).toLocaleString('fr-FR')} km par séance, bassin de ${q.bassin} m · ${jours(q.joursNatation)}`]);
  if (q.sports.includes('muscu')) lines.push(['muscu', `${GOALS_MUSCU[q.objectifMuscu]?.label ?? 'Musculation'}, ${LIEUX[q.lieu]?.label.toLowerCase() ?? ''} · ${jours(q.joursMuscu)}`]);
  return lines;
}

// --- Écrans -------------------------------------------------------------------

let current = 'accueil';
let progSport = 'course'; // courbe affichée dans Progression
let selDay = today(); // jour choisi dans le calendrier de l'accueil
let weekScroll = null; // position du calendrier, gardée entre deux affichages
let editing = null; // séance en cours d'édition (copie)
let bilan = null; // formulaire de bilan en cours
let suite = null; // ce que change le bilan qu'on vient d'enregistrer
let progDays = 14; // jours affichés dans la liste du programme

const screens = {
  accueil() {
    const d = load();
    const last = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const plan = planFor(d);
    const todayItem = plan.find((p) => p.date === today());
    const resumable = live || pendingBilan() ? null : savedLive();
    const next = plan.filter((p) => p.sport !== 'repos' && p.date !== today()).slice(0, 3);
    const prenom = d.profile.prenom || account.session()?.user?.prenom || '';
    // Ordre : qui, quel jour ; ce qui est en suspens ; la séance du jour ; la suite ; les chiffres.
    // Les explications techniques (installation) passent en bas, et seulement là où elles s'appliquent.
    return `
      <header class="hello">
        <button class="avatar" data-tab="profil" aria-label="Profil">${esc((prenom[0] || '?').toUpperCase())}</button>
        <div><span>Bonjour</span><b>${esc(prenom) || 'à toi'}</b><em class="hello-date">${esc(dateLabel(today()))}</em></div>
      </header>
      <p class="motto">Discipline aujourd'hui<br>Progrès demain</p>
      ${pendingBilanAlert()}
      ${resumable ? `<div class="alert">Séance interrompue : « ${esc(resumable.session.name)} », arrêtée à ${mmss(resumable.pos)}.
        <div class="row" style="margin-top:10px"><button class="btn-dark" data-resume>Reprendre</button><button data-dropresume>Abandonner</button></div></div>` : ''}
      ${d.profile.questionnaire ? '' : questionnaireBanner()}
      ${weekStrip(d.history, plan, selDay)}
      ${dayPanel(d.history, plan, selDay)}
      ${iaAlert(d.history)}
      ${next.length ? `<h3>Ensuite</h3><div class="list">${next.map((p) => planRow(p, !todayItem?.steps && p === next.find((x) => x.sport === 'course'))).join('')}</div>` : ''}
      ${indicators(d.history)}
      ${last ? `<h3>Dernière séance</h3><div class="list">${historyRow(last)}</div>` : ''}
      ${installNotice()}`;
  },

  programme() {
    const d = load();
    const plan = planFor(d);
    const todayItem = plan.find((p) => p.date === today() && p.sport !== 'repos');
    const firstRun = todayItem?.sport === 'course' ? null : plan.find((p) => p.sport === 'course');
    const rest = plan.filter((p) => p !== todayItem && p.date < addDays(today(), progDays));
    const run = plan.find((p) => p.sport === 'course');
    return `
      <h1>Programme</h1>
      ${d.profile.questionnaire ? '' : questionnaireBanner()}
      ${run ? `<section class="level">
        <p class="eyebrow" style="margin:0">Ton palier de course</p>
        <p class="level-num">${run.level}<small>/${run.max}</small></p>
        <div class="level-track" style="grid-template-columns:repeat(${run.max},1fr)">${Array.from({ length: run.max }, (_, i) => `<i class="${i < run.level ? 'on' : ''}"></i>`).join('')}</div>
        <p class="muted small" style="margin:8px 0 0">Palier ${run.max} = ${esc(LEVELS[run.max - 1].label.replace(' de course continue', ''))} de course sans marcher. Recalculé après chaque bilan selon ta difficulté, ta fatigue et tes douleurs : des règles fixes, pas un coach humain.</p>
      </section>` : ''}
      ${todayItem ? todayHero(todayItem) : ''}
      <h3>Les ${progDays / 7} prochaines semaines</h3>
      ${rest.length ? `<div class="timeline">${rest.map((p) => planRow(p, p === firstRun)).join('')}</div>
        ${progDays < HORIZON ? '<button class="btn-ghost" data-moreplan style="width:100%;margin-top:8px">Voir 2 semaines de plus</button>' : ''}
        <p class="muted small">Le programme n'a pas de fin : il se recalcule après chaque bilan, et les semaines suivantes partent de là où tu en es.</p>` : '<p class="muted">Aucune séance prévue : choisis tes jours dans Profil > Mon programme.</p>'}
      ${practiced(d, 'muscu') ? muscuLibrary(d) : ''}
      ${practiced(d, 'course') ? `<h3>Mes séances</h3>
      <p class="muted small">Des séances guidées à faire quand tu veux, en dehors du plan.</p>
      ${screens.seance(true)}` : ''}`;
  },

  demarrer() {
    const d = load();
    const todayItem = planFor(d, 1).find((p) => p.date === today() && p.sport !== 'repos');
    const resumable = savedLive();
    return `
      <h1>Démarrer</h1>
      ${pendingBilanAlert()}
      ${resumable && !pendingBilan() ? `<button class="option" data-resume><span><span>Reprendre « ${esc(resumable.session.name)} »</span><span class="muted">Arrêtée à ${mmss(resumable.pos)}</span></span><span class="go">▶</span></button>` : ''}
      ${todayItem?.sport === 'course' ? `<h3 style="margin-top:0">Prévu aujourd'hui</h3>
        <button class="option" data-startplan="${esc(todayItem.date)}"><span><span>Palier ${todayItem.level} · ${Math.round(total(todayItem.steps) / 60)} min</span><span class="muted">${esc(todayItem.title)}</span></span><span class="go">▶</span></button>` : ''}
      ${todayItem?.sport === 'natation' ? `<h3 style="margin-top:0">Prévu aujourd'hui</h3>
        <button class="option natation" data-logplan="natation"><span><span>Natation · ${todayItem.longueurs} longueurs</span><span class="muted">Pas de téléphone dans l'eau : note-la en sortant.</span></span><span class="go">+</span></button>` : ''}
      ${todayItem?.sport === 'muscu' ? `<h3 style="margin-top:0">Prévu aujourd'hui</h3>
        <button class="option muscu" data-muscugo><span><span>${savedGuided() ? 'Reprendre · ' : ''}${esc(todayItem.title)} · ${todayItem.exercices.length} exercices</span><span class="muted">Guidée : minuteur de récup entre les séries, durée mesurée.</span></span><span class="go">▶</span></button>
        <button class="option muscu" data-logplan="muscu"><span><span>La noter sans guidage</span><span class="muted">Séance déjà faite : charges et répétitions à la main.</span></span><span class="go">+</span></button>` : ''}
      <h3>Course guidée</h3>
      ${d.sessions.map((x) => `<button class="option" data-start="${esc(x.id)}"><span><span>${esc(x.name)}</span><span class="muted">${minutesLabel(total(x.steps))} · ${x.steps.length} étapes</span></span><span class="go">▶</span></button>`).join('')}
      <h3>Noter une séance faite</h3>
      ${manualButtons(d, '')}`;
  },

  seance(embedded) {
    const d = load();
    return `
      ${embedded ? '' : '<h1>Séances</h1>'}
      <div class="list">
      ${d.sessions.map((s) => `
        <div class="li">
          <button class="ico course play" data-start="${esc(s.id)}" aria-label="Démarrer ${esc(s.name)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
          <div class="li-main"><b>${esc(s.name)}</b><span>${minutesLabel(total(s.steps))} · ${s.steps.length} étapes</span></div>
          <button class="btn-ghost small-btn" data-edit="${esc(s.id)}">Modifier</button>
        </div>`).join('')}
      </div>
      <button data-new class="btn-ghost" style="width:100%;margin-top:8px">+ Nouvelle séance</button>`;
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

  prepare() {
    const p = prep;
    if (!p) return '';
    const s = p.session;
    const runs = s.steps.filter((x) => KINDS[x.kind].effort === 'course');
    return `
      <p class="eyebrow" style="margin-top:0">Avant de partir</p>
      <h1 class="prep-title">${esc(s.name)}</h1>
      ${s.refaite ? `<p class="notice small replay-note"><strong>La même séance que ${esc(dateLabel(s.refaiteDate))}</strong>, étape par étape. Elle compte comme une course de plus : ${s.refaiteNote}</p>` : ''}
      <section class="prep-sum">
        <p class="hero-num">${Math.round(total(s.steps) / 60)}<small>min</small></p>
        <p class="muted" style="margin:0">${s.steps.length} étapes · ${runs.length} en course</p>
        <div class="effort-bar">${s.steps.map((x) => `<i class="${KINDS[x.kind].effort}" style="flex:${x.duration}"></i>`).join('')}</div>
        <p class="small" style="margin:8px 0 0">${esc(stepsSummary(s.steps))}</p>
      </section>
      <ul class="prep-list">
        ${prepGpsBlock()}
        ${prepSoundBlock()}
        ${prepScreenBlock()}
      </ul>
      <div class="prep-go">
        <button class="cta" data-ready ${p.audio === 'ok' ? '' : 'disabled'}><span>Je suis prêt</span><i>›</i></button>
        <p class="muted small" style="text-align:center;margin:8px 0 0">${p.audio === 'ok' ? '7 secondes d\'introduction, puis la première étape.' : 'Le bouton s\'active quand les sons sont chargés.'}</p>
      </div>
      <button class="day-link" data-prepback style="display:block;margin:6px auto 0">Retour</button>`;
  },

  live() {
    const segmentsBar = () => {
      if (!live) return '<div class="bar"></div>';
      const { starts, end, half } = live.track;
      const span = end - starts[0];
      const pct = (x) => `${((x / span) * 100).toFixed(3)}%`;
      return `<div class="bar" id="bar">${live.session.steps.map((s, i) => `<span class="seg ${KINDS[s.kind].effort}" style="left:${pct(starts[i] - starts[0])};width:${pct(s.duration)}"><i></i></span>`).join('')}${half ? `<b class="halfmark" style="left:${pct(half - starts[0])}"></b>` : ''}<span class="cursor" id="cursor"></span></div>`;
    };
    const playing = !audio.paused;
    const interrupted = !playing && live && !live.userPaused && !live.swapping && audio.currentTime < live.track.end;
    return `
      <div class="live" id="live" data-effort="marche">
        <div class="live-top"><span id="stepno"></span><span><span class="gpsdot" id="gpsdot"></span><span id="gpsstate"></span></span></div>
        ${interrupted ? '<div class="alert">Séance interrompue (appel, Siri ou autre app). Touche « Reprendre ».</div>' : ''}
        <p class="now" id="now"></p>
        <p class="count" id="count"></p>
        <p class="next" id="next"></p>
        <div class="extend" id="extend" hidden></div>
        ${segmentsBar()}
        <p class="halfway" id="halfway" hidden>Moitié de la séance faite</p>
        <div class="live-stats">
          <div><b id="dist">0,00</b><span>km</span></div>
          <div><b id="pace">–</b><span>allure /km</span><small id="paceavg">moy. –</small></div>
          <div><b id="elapsed">0:00</b><span>temps</span></div>
        </div>
        <div class="gpsline" id="gps"></div>
        ${IOS && load().settings.son !== 'exclusif' ? '<p class="muted small" style="margin:0">Mode musique : iPhone hors silencieux, sinon pas de signaux.</p>' : ''}
        <button class="btn-primary live-done" id="livedone" data-finishok hidden>Terminer et faire le bilan</button>
        ${live?.overAt ? '' : `<div class="live-controls">
          <button class="toggle${playing ? '' : ' paused'}" data-toggle>${playing ? 'Pause' : 'Reprendre'}</button>
          <button data-skip>Étape suivante</button>
        </div>`}
        <div class="live-extra">
          <button class="lockbtn" data-touchlock>🔒 Bloquer l'écran</button>
          <button class="btn-stop" data-finish>Terminer…</button>
        </div>
      </div>`;
  },

  // Avant la muscu : exercices du jour, ce qu'il faut, un autre exercice du même muscle si besoin.
  mprep() {
    const d = load();
    const p = todayMuscuPlan(d);
    const lieu = LIEUX[d.profile.questionnaire?.lieu] ? d.profile.questionnaire.lieu : 'salle';
    const a = mprepAudio;
    const besoins = [...new Set(p.exercices.map((x) => x.besoin).filter(Boolean))];
    const sound = a === 'erreur'
      ? '<li class="prep-item ko"><b>✕ Sons non chargés</b><span>Tu peux faire la séance, mais sans signal de fin de récup (le flash reste). Vérifie ta connexion.</span><button class="btn-ghost small-btn" data-msoundretry>Réessayer</button></li>'
      : a !== 'ok'
        ? '<li class="prep-item wait"><b>… Chargement des sons</b><span>Quelques secondes.</span></li>'
        : `<li class="prep-item ok"><b>✓ Signaux prêts</b><span>3 bips puis un signal au départ et à la fin de chaque récup.${IOS && d.settings.son !== 'exclusif' ? ' iPhone <strong>hors mode silencieux</strong>, sinon aucun signal.' : ' Monte le volume média.'}</span></li>`;
    return `
      <p class="eyebrow" style="margin-top:0">Avant de commencer</p>
      <h1 class="prep-title">${esc(p.title)}</h1>
      ${p.refaite ? `<p class="notice small replay-note"><strong>Les mêmes exercices que ${esc(dateLabel(p.refaiteDate))}.</strong> Charges et objectifs recalculés sur ta dernière fois, comme d'habitude.</p>` : ''}
      <p class="muted" style="margin:0 0 12px">${esc(LIEUX[lieu].label)}${LIEUX[lieu].detail ? ` · ${esc(LIEUX[lieu].detail)}` : ''} · ${p.exercices.length} exercices</p>
      ${besoins.length ? `<div class="notice small"><strong>Il te faut :</strong> ${esc(besoins.join(', '))}.</div>` : ''}
      <ul class="mprep-list">${p.exercices.map((x) => {
        const alts = alternatives(x.muscle, lieu);
        return `<li class="mprep-ex">
          <b>${esc(x.nom)}</b>
          <span class="muted small">${esc(x.muscle)} · ${x.series} séries de ${x.min} à ${x.max}${x.unite === 's' ? ' s' : ' répétitions'}${x.besoin ? ` · il faut ${esc(x.besoin)}` : ''}</span>
          ${alts.length > 1 ? `<label class="mprep-alt"><span>Pas le matériel ou pas envie ? Même muscle :</span><select data-mpswap="${p.seance}:${x.slot}" aria-label="Autre exercice pour ${esc(x.muscle)}">${alts.map((e) => `<option value="${e.id}" ${e.id === x.id ? 'selected' : ''}>${esc(e.nom)}${e.besoin ? ` (${esc(e.besoin)})` : ''}</option>`).join('')}</select></label>` : ''}
        </li>`;
      }).join('')}</ul>
      <p class="muted small">${p.refaite ? 'Un changement ici vaut pour cette fois seulement.' : 'Ton choix est gardé pour les prochaines séances. Matériel : Profil > questionnaire.'}</p>
      <ul class="prep-list">${sound}</ul>
      <div class="prep-go">
        <button class="cta muscu" data-mstart ${a === 'chargement' ? 'disabled' : ''}><span>C'est parti</span><i>›</i></button>
        <p class="muted small" style="text-align:center;margin:8px 0 0">${a === 'chargement' ? 'Le bouton s\'active quand les sons sont chargés.' : 'Décompte de 3 secondes, puis le premier exercice.'}</p>
      </div>
      <button class="day-link" data-mprepback style="display:block;margin:6px auto 0">Retour</button>`;
  },

  muscu() {
    const s = guided;
    if (!s) return '';
    const n = s.exercices.length;
    const x = currentExercise(s);
    const unit = (e) => (e.unite === 's' ? 's' : 'répétitions');
    const pct = Math.round((setsDone(s) / setsTotal(s)) * 100);
    const head = `
        <div class="live-top"><span>${esc(s.sessionName)}</span><span>⏱ <b id="mtime">${mmss(guidedElapsed(s))}</b></span></div>
        <div class="bar"><div style="width:${pct}%"></div></div>`;
    const end = '<button data-mfinish>Terminer la séance</button>';
    if (s.phase === 'countdown') {
      return `
      <div class="live mlive" id="mlive" data-phase="countdown">${head}
        <p class="now">Prépare-toi</p>
        <p class="count" id="mcount">${Math.max(1, Math.ceil(countLeft(s)))}</p>
        <p class="next">Premier exercice : <b>${esc(x.nom)}</b></p>
        <p class="muted" style="margin:4px 0 0">${x.min} à ${x.max} ${unit(x)}</p>
      </div>`;
    }
    if (s.phase === 'rest') {
      return `
      <div class="live mlive" id="mlive" data-phase="rest">${head}
        <p class="now">Récup</p>
        <p class="count" id="mrest">${mmss(Math.ceil(restLeft(s)))}</p>
        <p class="next">Ensuite : <b>${esc(x.nom)}</b></p>
        <p class="muted" style="margin:4px 0 0">Série ${s.set + 1}/${x.reps.length} · ${x.min} à ${x.max} ${unit(x)}${x.poids ? ` · ${kgLabel(x.poids)}` : ''}</p>
        ${load().settings.son !== 'exclusif' ? '<p class="muted small" style="margin:10px 0 0">Signal à la fin de la récup : iPhone hors silencieux.</p>' : ''}
        <div class="live-controls">
          <button data-mrest="-15">−15 s</button>
          <button data-mrest="15">+15 s</button>
        </div>
        <div class="live-extra">
          <button class="mgo" data-mrestskip>Reprendre maintenant</button>
          ${end}
        </div>
      </div>`;
    }
    if (s.hold) {
      const lead = holdLead(s);
      const el = Math.floor(holdElapsed(s));
      return `
      <div class="live mlive" id="mlive" data-phase="hold">${head}
        <p class="mstep">Exercice ${s.ex + 1}/${n} · série ${s.set + 1}/${x.reps.length}</p>
        <p class="mname">${esc(x.nom)}</p>
        <p class="now" id="mholdnow">${lead > 0 ? 'Mets-toi en place' : el >= s.hold.min ? 'Dans la tranche' : 'Tiens'}</p>
        <p class="count" id="mhold">${lead > 0 ? Math.max(1, Math.ceil(lead)) : el}</p>
        <p class="next">Signal à <b>${s.hold.min} s</b>, fin à <b>${s.hold.max} s</b></p>
        ${load().settings.son !== 'exclusif' ? '<p class="muted small" style="margin:10px 0 0">iPhone hors silencieux. Au signal de fin, la série est notée et la récup démarre seule.</p>' : ''}
        <div class="live-controls one">
          <button class="mgo" data-mholdstop>J'arrête là</button>
        </div>
        <div class="live-extra">
          <button data-mholdcancel>Annuler le minuteur</button>
          ${end}
        </div>
      </div>`;
    }
    const key = `${s.ex}:${s.set}`;
    if (mDraft.key !== key) mDraft = { key, reps: suggestedReps(s) };
    return `
      <div class="live mlive" id="mlive" data-phase="work">${head}
        <p class="mstep">Exercice ${s.ex + 1}/${n} · série ${s.set + 1}/${x.reps.length}</p>
        <p class="mname">${esc(x.nom)}</p>
        <p class="next">Objectif : ${x.min} à ${x.max} ${unit(x)}</p>
        <p class="muted small" style="margin:4px 0 0">${esc(x.reason || '')}</p>
        ${s.set === 0 && liveAlts(x).length > 1 ? `<select class="mswap" data-mswap aria-label="Autre exercice, même muscle">${liveAlts(x).map((e) => `<option value="${e.id}" ${e.id === x.id ? 'selected' : ''}>${e.id === x.id ? 'Changer d\'exercice (même muscle)…' : esc(e.nom)}</option>`).join('')}</select>` : ''}
        ${x.unite === 's' ? `<div class="live-controls one" style="margin-top:14px"><button class="mgo" data-mholdgo>Lancer le minuteur</button></div><p class="muted small" style="text-align:center;margin:6px 0 0">3 s pour te placer, un signal à ${x.min} s, la fin à ${x.max} s. Ou note tes secondes à la main :</p>` : ''}
        ${x.materiel === 'corps' ? '' : `<div class="kg mkg"><input id="mkg" type="number" inputmode="decimal" step="0.5" min="0" placeholder="?" value="${x.poids ?? ''}"><span>kg${x.materiel === 'halteres' ? ' par haltère' : ''}</span></div>`}
        <div class="mstepper">
          <button data-mreps="-1" aria-label="Une de moins">−</button>
          <b id="mreps">${mDraft.reps}</b>
          <button data-mreps="1" aria-label="Une de plus">+</button>
        </div>
        <p class="muted small" style="text-align:center;margin:0">${x.unite === 's' ? 'secondes tenues' : 'répétitions faites'}</p>
        <div class="live-controls one">
          <button class="${x.unite === 's' ? '' : 'mgo'}" data-msetdone>Série faite${s.set + 1 < x.reps.length || s.ex + 1 < n ? ` · récup ${s.repos} s` : ''}</button>
        </div>
        <div class="live-extra">
          <button data-mskip>Passer l'exercice</button>
          ${end}
        </div>
      </div>`;
  },

  bilan() {
    const b = bilan;
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    return `
      <h1>Bilan de la séance</h1>
      <div class="card">
        <p><strong>${esc(b.sessionName)}</strong></p>
        <p class="muted">${mmss(b.elapsedSec)} de séance${b.prolongSec ? `, dont ${mmss(b.prolongSec)} après le programme` : ''} · ${b.completedSteps} étape(s) sur ${b.steps.length}${b.skipped.length ? ` · ${b.skipped.length} passée(s)` : ''}</p>
        ${b.extra ? `<p class="small">${extraLine(b)}</p>` : ''}
        ${b.trace ? `<div class="map" data-map="bilan"></div>${b.gpsIncomplet ? '<p class="muted small">En pointillés : écran verrouillé, le GPS ne suivait plus.</p>' : ''}` : ''}
        ${b.distanceSource === 'gps' ? `<p class="small">GPS : ${b.distanceKm.toLocaleString('fr-FR')} km${b.allureSecKm ? ` · ${allure(b.allureSecKm)}` : ''}${b.gpsIncomplet ? ' · <strong>incomplet</strong> (écran verrouillé un moment)' : ''}</p>` : ''}
        ${b.deniveleM != null ? `<p class="small">Dénivelé : <b>+${b.deniveleM} m</b> <span class="muted">(mesuré par le téléphone${b.gpsIncomplet ? ', incomplet' : ''})</span></p>` : ''}
        ${montreBlock(b)}
        ${b.cardio ? cardioBlock(b.cardio, 'bilan') : cardioOn() && windowOf(b) ? `<div class="hr-wait">
          <p class="small" style="margin:0"><b>Cardio de ta montre :</b> arrête la séance sur la montre, attends une minute, lance ton Raccourci « Foulée cardio » puis reviens ici.</p>
          ${cardioUi.message ? `<p class="muted small" style="margin:6px 0 0">${esc(cardioUi.message || 'Pas encore de mesures de la montre pour cette séance.')}</p>` : ''}
          <button class="btn-ghost" data-cardiofetch style="width:100%;margin-top:8px">${cardioUi.busy ? 'Recherche…' : 'J’ai lancé le Raccourci'}</button>
        </div>` : ''}
        <label for="dist">Distance (km${['gps', 'montre', 'moyenne'].includes(b.distanceSource) ? ', corrige si besoin' : ', facultatif'})</label>
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

  // Juste après un bilan : ce qui change pour la suite, et pourquoi.
  suite() {
    const r = suite;
    const tag = { monte: '▲ ça monte', garde: '= on consolide', recul: '▼ on lève le pied', suite: 'la suite', decale: '→ décalée, pas sautée' }[r.verdict] || '';
    const nextSport = r.nextSport || r.sport;
    return `
      <h1>Et maintenant ?</h1>
      <section class="hero ${r.sport === 'repos' ? 'rest' : r.sport}">
        <p class="eyebrow">${esc(SPORT_LABEL[r.sport])} · ${esc(tag)}</p>
        <p class="hero-sub" style="font-size:26px;margin:8px 0 6px">${esc(r.titre)}</p>
        <p class="muted small" style="margin:0">${esc(r.detail)}</p>
      </section>
      <h3>Pour la prochaine séance</h3>
      ${r.ia === 'loading' ? '<p class="ia-wait">L’IA lit ton ressenti… En attendant, les conseils des règles :</p>' : ''}
      ${r.ia?.code ? `<div class="alert ia-fail"><strong>Conseils de secours (règles).</strong> ${esc(failureMessage(r.ia))}</div>` : ''}
      ${r.source === 'ia' ? '<p class="ia-ok">Conseils de l’IA, à partir de ton ressenti</p>' : ''}
      <ul class="conseils ${r.sport}">${r.conseils.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${r.next ? `<h3>Prochaine ${nextSport === 'natation' ? 'natation' : nextSport === 'muscu' ? 'muscu' : 'course'}</h3><div class="list">${planRow(r.next)}</div>` : ''}
      <p class="muted small">${r.sport === 'autre'
        ? 'Une activité hors programme compte dans ton temps d’activité, pas dans tes paliers : le programme ne monte que sur ses propres séances.'
        : r.source === 'ia'
        ? 'La suite du programme est décidée par les règles de Foulée. Les conseils sont écrits par une IA gratuite (Llama, via Cloudflare) : elle peut se tromper, ce n’est pas un coach ni un médecin.'
        : 'Règles fixes de Foulée, pas un coach : difficulté, essoufflement, fatigue, douleur et les mots de ton ressenti décident.'}${r.sport === 'autre' ? '' : ' Tes conseils restent affichés sur la carte de la prochaine séance.'}</p>
      <div class="row" style="margin-top:14px"><button data-tab="progression">Mon historique</button><button class="btn-dark" data-tab="programme">Mon programme</button></div>`;
  },

  progression() {
    const d = load();
    const sorted = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const runs = d.history.filter((h) => sportOf(h) === 'course');
    const swims = d.history.filter((h) => sportOf(h) === 'natation');
    const longest = Math.max(0, ...runs.map((h) => h.distanceKm || 0));
    const paces = runs.map((h) => h.allureSecKm || (h.distanceKm && h.elapsedSec && !h.distanceEstimee ? h.elapsedSec / h.distanceKm : 0)).filter(Boolean);
    const bestSwim = Math.max(0, ...swims.map(swimMeters));
    const progSports = ['course', 'natation', 'muscu'].filter((x) => practiced(d, x) || d.history.some((h) => sportOf(h) === x));
    const sp = progSports.includes(progSport) ? progSport : progSports[0] || 'course';
    const key = sp === 'muscu' ? muscuKey(d.history) : { course: 'km', natation: 'm' }[sp];
    const wk = weekTotals(d.history, mondayOf(today()))[key];
    const prev = weekTotals(d.history, addDays(mondayOf(today()), -7))[key];
    const diff = wk - prev;
    const fmt = (v) => (sp === 'course' ? fmtKm(v) : Math.round(v).toLocaleString('fr-FR'));
    // Musculation : meilleure charge par exercice (les 3 plus lourdes).
    const best = {};
    for (const h of d.history.filter((x) => sportOf(x) === 'muscu')) for (const x of h.exercices || []) if (x.poids > (best[x.id]?.poids || 0)) best[x.id] = x;
    const topLifts = Object.values(best).sort((a, b) => b.poids - a.poids).slice(0, 3);
    // Poids du corps : meilleure série (répétitions) par exercice.
    const bestSet = {};
    for (const h of d.history.filter((x) => sportOf(x) === 'muscu')) {
      for (const x of h.exercices || []) {
        const r = Math.max(0, ...(x.reps || []).map(Number).filter(Number.isFinite));
        if (x.unite !== 's' && r > (bestSet[x.id]?.r || 0)) bestSet[x.id] = { nom: x.nom, r };
      }
    }
    const topSets = Object.values(bestSet).sort((a, b) => b.r - a.r).slice(0, 3);
    return `
      <h1>Progression</h1>
      ${d.history.length ? `
        ${progSports.length > 1 ? `<div class="seg">${progSports.map((x) => `<button data-progsport="${x}" class="${sp === x ? `on ${x}` : ''}">${SPORT_LABEL[x]}</button>`).join('')}</div>` : ''}
        <section class="prog ${sp}">
          <p class="eyebrow" style="margin:0">Cette semaine</p>
          <p class="hero-num">${fmt(wk)}<small>${UNIT_LABEL[key]}</small></p>
          <p class="delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${fmt(Math.abs(diff))} ${UNIT_LABEL[key]} par rapport à la semaine dernière</p>
          ${weekCurve(d.history, sp, key)}
        </section>
        ${sp === 'muscu' ? `<p class="muted small" style="margin-top:4px">${key === 'kg' ? 'Total soulevé = charge × répétitions de la semaine, hors poids du corps.' : 'Répétitions faites dans la semaine, toutes séries comprises (gainage non compté). Passe en kg dès que tu notes une charge.'}</p>` : ''}
        <h3>Records</h3>
        ${sp === 'muscu' && key === 'reps' ? `<div class="records">${topSets.length ? topSets.map((x) => `<div class="muscu"><b>${x.r}<small>rép.</small></b><span>${esc(x.nom.split(" (")[0])} · en une série</span></div>`).join('') : '<div class="muscu"><b>–</b><span>aucune série notée</span></div>'}</div>` : sp === 'muscu' ? `<div class="records">${topLifts.length ? topLifts.map((x) => `<div class="muscu"><b>${String(x.poids).replace('.', ',')}<small>kg</small></b><span>${esc(x.nom.split(' (')[0])}</span></div>`).join('') : '<div class="muscu"><b>–</b><span>aucune charge notée</span></div>'}</div>` : `<div class="records">
          ${practiced(d, 'course') || runs.length ? `<div class="course"><b>${longest ? fmtKm(longest) : '–'}<small>km</small></b><span>plus longue course</span></div>
          <div class="course"><b>${paces.length ? allure(Math.min(...paces)).replace('/km', '') : '–'}</b><span>meilleure allure</span></div>` : ''}
          ${practiced(d, 'natation') || swims.length ? `<div class="natation"><b>${bestSwim || '–'}<small>m</small></b><span>plus longue nage</span></div>` : ''}
        </div>`}
        ${sp === 'course' ? '<p class="muted small" style="margin-top:8px">Allure moyenne marche comprise : elle baisse quand tu cours plus longtemps.</p>' : ''}
        ${sp === 'course' ? cardioTrend(runs) : ''}` : ''}
      <h3>Historique</h3>
      ${manualButtons(d, 'btn-ghost', null, 'margin-bottom:10px', ' libre')}
      ${sorted.length === 0 ? '<p class="muted">Aucune séance pour l\'instant.</p>' : `<div class="list">${sorted.map(historyRow).join('')}</div>`}
      <h3>Proches</h3>
      <p class="muted small">Le partage de séances avec tes proches n'existe pas encore : pour l'instant, chacun a son compte et ses données. Inviter quelqu'un : Profil.</p>`;
  },

  saisie() {
    const b = bilan;
    const swim = b.sport === 'natation';
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    const nages = ['crawl', 'brasse', 'dos', 'papillon'];
    const autre = b.sport === 'autre';
    return `
      <h1>${autre ? 'Autre activité' : b.sport === 'muscu' ? esc(b.sessionName) : swim ? 'Séance de natation' : b.fromPlan ? 'Course du programme' : 'Course libre'}</h1>
      ${b.horaires ? `<p class="muted">Séance guidée · ${esc(b.horaires)}, durée mesurée. Séries notées pendant la séance : corrige si besoin, puis note ton ressenti.</p>` : b.fromPlan ? '<p class="muted">Prérempli avec le programme du jour. Corrige ce qui a changé, puis note ton ressenti.</p>' : ''}
      ${autre && b.remplace ? `<p class="muted">À la place de ta ${SPORT_LABEL[b.remplace].toLowerCase()} du jour. Elle sera décalée, pas sautée, et ce que tu notes ici ne fait pas monter ton programme.</p>` : ''}
      <div class="card">
        ${autre ? `<label for="activite" style="margin-top:0">Activité</label>
        <input id="activite" placeholder="Ex. : padel" maxlength="40" value="${esc(b.activite)}">
        <div class="chips">${ACTIVITES.map((a) => `<button data-act="${a}" class="${b.activite === a ? 'on' : ''}">${a}</button>`).join('')}</div>` : ''}
        ${autre && b.remplace ? '' : `<label for="date">Date</label>
        <input id="date" type="date" value="${esc(String(b.date).slice(0, 10))}">`}
        <label for="duree">Durée (minutes)</label>
        <input id="duree" type="number" inputmode="numeric" min="1" max="600" value="${b.elapsedSec ? Math.round(b.elapsedSec / 60) : ''}">
        ${b.sport === 'muscu' || autre ? '' : swim ? `
          <label for="bassin">Longueur du bassin (m)</label>
          <select id="bassin">${[25, 50, 33].map((m) => `<option value="${m}" ${b.swim.bassinM === m ? 'selected' : ''}>${m} m</option>`).join('')}</select>
          <label for="longueurs">Nombre de longueurs</label>
          <input id="longueurs" type="number" inputmode="numeric" min="0" max="400" value="${b.swim.longueurs ?? ''}">
          <p class="muted small" id="swimdist">${b.swim.longueurs ? `Distance : ${b.swim.longueurs * b.swim.bassinM} m` : ''}</p>
          ${swimWatch(b)}
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
      </div>
      ${b.sport === 'muscu' ? muscuForm(b) : ''}
      <div class="card">
        <label style="margin-top:0">Difficulté</label>
        ${scale('difficulte', '1 = très facile · 5 = très dur')}
        ${b.sport === 'muscu' || autre ? '' : `<label>Essoufflement</label>
        ${scale('essoufflement', '1 = je pouvais parler · 5 = à bout de souffle')}`}
        <label>Fatigue</label>
        ${scale('fatigue', '1 = en forme · 5 = épuisé')}
        <label for="douleur">Une douleur ?</label>
        <input id="douleur" placeholder="Ex. : épaule gauche, légère" value="${esc(b.douleur)}">
        <label for="comm">Ton ressenti</label>
        <textarea id="comm">${esc(b.commentaire)}</textarea>
      </div>
      <div class="row"><button data-tab="progression">Annuler</button><button class="btn-dark" data-savemanual>Enregistrer</button></div>`;
  },

  compte() {
    const sess = account.session();
    const a = accountUi;
    if (!account.serverEnabled()) {
      return `
        <h1>Mon compte</h1>
        <div class="card"><h2>Bientôt disponible</h2>
        <p>Les comptes sont prêts, mais le serveur n'est pas encore en service. En attendant, tes séances restent sur ce téléphone.</p></div>
        <button data-tab="profil" style="width:100%">Retour</button>`;
    }
    if (!account.passkeysSupported()) {
      return `<h1>Mon compte</h1><div class="alert">Ce navigateur ne gère pas les passkeys. Mets à jour ton téléphone ou ouvre Foulée dans Safari (iPhone) ou Chrome (Android).</div>`;
    }
    const msg = a.error ? `<div class="alert">${esc(a.error)}</div>` : a.info ? `<div class="notice">${esc(a.info)}</div>` : '';
    if (sess) {
      return `
        <h1>Mon compte</h1>
        ${msg}
        <div class="card">
          <p class="muted small">Connecté</p>
          <h2>${esc(sess.user?.prenom ?? '')}</h2>
          <p class="muted small">${a.sync ? esc(a.sync) : 'Tes séances sont sauvegardées sur ton compte.'}</p>
        </div>
        <div class="card">
          <h2>Inviter un proche</h2>
          <p class="muted small">Un lien à usage unique, valable 14 jours. La personne crée son propre compte : elle ne voit pas tes données.</p>
          <button class="btn-dark" data-invite="join" style="width:100%" ${a.busy ? 'disabled' : ''}>Créer un lien d'invitation</button>
          ${a.lastInvite ? `<p class="small" id="invite-link" style="margin-top:10px;word-break:break-all">${esc(a.lastInvite)}</p><button data-share style="width:100%">Envoyer le lien</button>` : ''}
          ${a.invites?.length ? `<ul class="steps" style="margin-top:10px">${a.invites.map((i) => `<li><span>${i.kind === 'recover' ? 'Nouvel appareil' : 'Invitation'} du ${new Date(i.created_at).toLocaleDateString('fr-FR')}</span><span class="muted small">${i.used_at ? `utilisée${i.used_by_prenom ? ` par ${esc(i.used_by_prenom)}` : ''}` : i.expires_at < Date.now() ? 'expirée' : 'en attente'}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="card">
          <h2>Nouveau téléphone</h2>
          <p class="muted small">Sur iPhone, ta passkey passe d'un appareil à l'autre avec le trousseau iCloud. Sinon, crée ici un lien à ouvrir sur le nouvel appareil.</p>
          <button data-invite="recover" style="width:100%" ${a.busy ? 'disabled' : ''}>Lien pour un nouvel appareil</button>
        </div>
        <button class="btn-danger" data-logout style="width:100%">Se déconnecter</button>`;
    }
    const needsInvite = !a.firstAccount;
    return `
      <h1>${a.invite ? 'Bienvenue sur Foulée' : 'Mon compte'}</h1>
      ${msg}
      ${a.invite && a.inviteFrom ? `<p>${esc(a.inviteFrom)} t'invite à rejoindre Foulée.</p>` : ''}
      ${a.invite || a.firstAccount ? '' : `
        <div class="card">
          <h2>J'ai déjà un compte</h2>
          <button class="btn-primary" data-login ${a.busy ? 'disabled' : ''}>Me connecter</button>
          <p class="muted small" style="margin-top:8px">Avec Face ID, Touch ID ou ton empreinte. Pas de mot de passe.</p>
        </div>`}
      <div class="card">
        <h2>${a.invite?.kind === 'recover' ? 'Ajouter ce téléphone à mon compte' : 'Créer mon compte'}</h2>
        ${a.firstAccount ? '<p class="muted small">Premier compte : il sera administrateur et pourra inviter les autres.</p>' : ''}
        ${a.invite?.kind === 'recover' ? '' : `<label for="acc-prenom">Prénom</label><input id="acc-prenom" maxlength="40" value="${esc(load().profile.prenom)}">`}
        ${needsInvite && !a.invite ? `<label for="acc-invite">Code ou lien d'invitation</label><input id="acc-invite" autocapitalize="off" autocomplete="off">` : ''}
        <p style="margin-top:12px"><button class="btn-dark" data-register style="width:100%" ${a.busy ? 'disabled' : ''}>${a.invite?.kind === 'recover' ? 'Ajouter ce téléphone' : 'Créer mon compte'}</button></p>
        <p class="muted small">Ton téléphone crée une passkey protégée par Face ID ou ton empreinte. ${load().owner ? 'Les séances du compte déjà utilisé sur ce téléphone ne seront pas reprises : ton compte démarre vide.' : 'Tes séances déjà enregistrées ici rejoignent ton compte.'}</p>
      </div>`;
  },

  questionnaire() {
    const d = load();
    const q = qDraft;
    const fresh = !d.profile.questionnaire;
    const step = Math.min(q.step || 0, Q_STEPS.length - 1);
    const [key, title] = Q_STEPS[step];
    const sports = SPORTS_ORDER.filter((x) => q.sports.includes(x));
    const last = step === Q_STEPS.length - 1;
    const steps = `<ol class="q-steps" aria-label="Étape ${step + 1} sur ${Q_STEPS.length}">${Q_STEPS.map(([, t], i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"><span>${i < step ? '✓' : i + 1}</span>${i === step ? `<b>${esc(t)}</b>` : ''}</li>`).join('')}</ol>`;
    let body = '';
    if (key === 'sports') {
      const card = (sp, label, detail) => `<button data-qsport="${sp}" class="q-card ${sp}${q.sports.includes(sp) ? ' on' : ''}" aria-pressed="${q.sports.includes(sp)}">${icon(sp)}<span><b>${label}</b><span>${detail}</span></span><i>${q.sports.includes(sp) ? '✓' : '+'}</i></button>`;
      body = `
        <p class="muted">Plusieurs choix possibles. Chaque sport aura ses propres jours.</p>
        <div class="q-cards">
          ${card('course', 'Course', 'Marche-course guidée, du premier pas au 10 km')}
          ${card('natation', 'Natation', 'Longueurs en bassin, notées en sortant de l’eau')}
          ${card('muscu', 'Musculation', 'Séances guidées, en salle ou au poids du corps')}
        </div>`;
    } else if (key === 'objectifs') {
      body = sports.map((sp) => {
        if (sp === 'course') return `<section class="q-part course">${qPartHead('course')}${Object.entries(GOALS_RUN).map(([k, g]) => radio('q-objc', k, q.objectifCourse, g.label, g.detail)).join('')}</section>`;
        if (sp === 'natation') return `<section class="q-part natation">${qPartHead('natation')}
          <p class="q-sub">Ton bassin</p>
          <div class="seg"><button data-qbassin="25" class="${q.bassin === 25 ? 'on natation' : ''}">25 m</button><button data-qbassin="50" class="${q.bassin === 50 ? 'on natation' : ''}">50 m</button></div>
          <p class="q-sub">Ton objectif</p>
          ${GOALS_SWIM.map((m) => radio('q-objn', m, q.objectifNatation, `Nager ${(m / 1000).toLocaleString('fr-FR')} km par séance`, `${Math.round(m / q.bassin)} longueurs`)).join('')}</section>`;
        return `<section class="q-part muscu">${qPartHead('muscu')}
          <p class="q-sub">Ton objectif</p>
          ${Object.entries(GOALS_MUSCU).map(([k, g]) => radio('q-objm', k, q.objectifMuscu, g.label, `${g.series} séries de ${g.min} à ${g.max} répétitions`)).join('')}
          <p class="q-sub">Où tu t'entraînes</p>
          ${Object.entries(LIEUX).map(([k, l]) => radio('q-lieu', k, q.lieu, l.label, l.detail)).join('')}</section>`;
      }).join('');
    } else if (key === 'niveau') {
      const runFromHistory = hasRuns(d) && nextRunLevel(d.history, sameLevelOpts);
      body = sports.map((sp) => {
        if (sp === 'course') return `<section class="q-part course">${qPartHead('course')}<p class="q-sub">Aujourd'hui, tu cours sans t'arrêter…</p>
          ${runFromHistory ? `<p class="q-known">Déjà connu grâce à tes séances : <b>palier ${runFromHistory.level}</b>, ${esc(LEVELS[runFromHistory.level - 1].label)}. Le programme continue de là.</p>`
            : START_RUN.map((x) => radio('q-nivc', x.level, q.niveauCourse, x.label)).join('')}</section>`;
        if (sp === 'natation') return `<section class="q-part natation">${qPartHead('natation')}<p class="q-sub">Aujourd'hui, en une séance, tu nages…</p>
          ${hasSwims(d) ? '<p class="q-known">Déjà connu grâce à tes séances : le programme repart de ta dernière nage.</p>'
            : START_SWIM.map((x) => radio('q-nivn', x.longueurs, q.niveauNatation, x.label)).join('')}</section>`;
        return `<section class="q-part muscu">${qPartHead('muscu')}<p class="q-sub">Où tu en es</p>
          ${Object.entries(NIVEAUX_MUSCU).map(([k, n]) => radio('q-nivm', k, q.niveauMuscu, n.label, k === 'regulier' ? '' : 'une série de moins les 4 premières séances')).join('')}</section>`;
      }).join('');
    } else if (key === 'jours') {
      body = `<p class="muted">Un seul sport par jour : un jour déjà pris par un autre sport est grisé.</p>` + sports.map((sp) => {
        if (sp === 'course') return `<section class="q-part course">${qPartHead('course')}${qDays('joursCourse', q.joursCourse)}<p class="muted small" style="margin-top:8px">Garde un jour entre deux courses : sinon la seconde devient un jour de repos.</p></section>`;
        if (sp === 'natation') return `<section class="q-part natation">${qPartHead('natation')}${qDays('joursNatation', q.joursNatation, 'natation')}</section>`;
        return `<section class="q-part muscu">${qPartHead('muscu')}${qDays('joursMuscu', q.joursMuscu, 'muscu')}<p class="muted small" style="margin-top:8px">Jusqu'à 3 jours : corps entier, séances A et B en alternance. 4 jours ou plus : haut du corps et bas du corps.</p></section>`;
      }).join('');
    } else {
      const errs = questionnaireErrors(q, d);
      const answers = errs ? null : cleanAnswers(q, d);
      const preview = answers ? upcoming(d.history, d.settings, today(), 14, answers).filter((p) => p.sport !== 'repos').slice(0, 5) : [];
      const what = (p) => (p.sport === 'course' ? `Course · palier ${p.level}/${p.max}, ${esc(p.title)}` : p.sport === 'natation' ? `Natation · ${p.longueurs} longueurs, ${p.distance} m` : `Musculation · ${esc(p.title)}`);
      body = answers ? `
        <ul class="q-summary">${answersSummary(answers).map(([sp, t]) => `<li class="${sp}">${esc(t)}</li>`).join('')}</ul>
        <section class="q-preview">
          <p class="eyebrow" style="margin:0">Tes prochaines séances</p>
          ${preview.map((p) => `<p><b class="${{ course: 'run', natation: 'swim', muscu: 'muscu' }[p.sport]}">${esc(shortDate(p.date))}</b> ${what(p)}</p>`).join('')}
          <p class="muted small" style="margin:0">Des règles fixes, pas un coach humain : ça monte quand tes bilans sont bons, ça redescend si c'est trop dur ou douloureux. Tout reste modifiable dans Profil > Mon programme.</p>
        </section>` : `<div class="alert">${esc(errs)}</div>`;
    }
    return `
      ${accountUi.info && fresh ? `<div class="notice">${esc(accountUi.info)}</div>` : ''}
      <p class="eyebrow" style="margin-top:0">${fresh ? 'Ton programme, à ta mesure' : 'Mon programme'}</p>
      ${steps}
      <h1 class="q-title">${esc(title)}</h1>
      ${body}
      ${q.error ? `<div class="alert" role="alert">${esc(q.error)}</div>` : ''}
      <div class="q-nav">
        ${step > 0 ? '<button class="btn-ghost" data-qback>‹ Retour</button>' : ''}
        ${last ? `<button class="btn-primary" data-qsave>${fresh ? 'Créer mon programme' : 'Enregistrer'}</button>` : '<button class="btn-primary" data-qnext>Continuer</button>'}
      </div>
      ${fresh ? '<button class="day-link" data-tab="accueil" style="display:block;margin:8px auto 0">Plus tard (garder le programme d\'exemple)</button>' : '<button class="day-link" data-tab="profil" style="display:block;margin:8px auto 0">Annuler</button>'}`;
  },

  profil() {
    const d = load();
    const sess = account.session();
    const supported = 'audioSession' in navigator;
    const prenom = d.profile.prenom || sess?.user?.prenom || '';
    return `
      <div class="profile-head">
        <div class="avatar">${esc((prenom[0] || '?').toUpperCase())}</div>
        <div><h1>${esc(prenom) || 'Profil'}</h1><p class="muted small" style="margin:4px 0 0">${!account.serverEnabled() ? 'Séances sur ce téléphone' : sess ? 'Compte connecté' : 'Non connecté : séances sur ce téléphone'}</p></div>
      </div>
      <div class="card">
        <h2>Compte et proches</h2>
        <p class="muted small">${sess ? 'Sauvegarde de tes séances, invitations, nouveau téléphone.' : 'Crée ton compte ou connecte-toi pour sauvegarder tes séances et inviter tes proches.'}</p>
        <button data-tab="compte" style="width:100%">${sess ? 'Gérer mon compte et inviter' : 'Connexion / créer mon compte'}</button>
      </div>
      ${account.serverEnabled() ? cardioCard(sess) : ''}
      <div class="card">
        <label for="prenom" style="margin-top:0">Ton prénom</label>
        <input id="prenom" value="${esc(d.profile.prenom)}" maxlength="40">
      </div>
      <div class="card">
        <h2>Mon programme</h2>
        ${d.profile.questionnaire
          ? `<ul class="q-summary">${answersSummary(d.profile.questionnaire).map(([sp, t]) => `<li class="${sp}">${esc(t)}</li>`).join('')}</ul>`
          : '<p class="muted small">Pas encore personnalisé : tu suis le <strong>programme d\'exemple</strong> (course lundi et vendredi, natation mercredi).</p>'}
        <button data-questionnaire style="width:100%">${d.profile.questionnaire ? 'Modifier mes réponses' : 'Répondre au questionnaire'}</button>
      </div>
      <div class="card">
        <h2>Signal de changement d'étape</h2>
        <label class="choice"><input type="radio" name="annonces" value="signaux" ${d.settings.annonces !== 'voix' ? 'checked' : ''}><span><strong>Signaux sonores</strong> : notes qui montent = cours, notes qui descendent = marche, 3 bips avant chaque changement.</span></label>
        <label class="choice"><input type="radio" name="annonces" value="voix" ${d.settings.annonces === 'voix' ? 'checked' : ''}><span><strong>Voix</strong> : annonce chaque étape et sa durée.</span></label>
      </div>
      <div class="card">
        <h2>Son pendant la séance</h2>
        <label class="choice"><input type="radio" name="mode" value="musique" ${d.settings.son !== 'exclusif' ? 'checked' : ''}><span><strong>Avec ma musique</strong> : les signaux passent par-dessus ta musique sans la couper. L'écran doit rester allumé (sinon plus de signaux ni de GPS) : utilise le bouton « Bloquer l'écran » pendant la séance pour la poche.</span></label>
        <label class="choice"><input type="radio" name="mode" value="exclusif" ${d.settings.son === 'exclusif' ? 'checked' : ''}><span><strong>Sans musique</strong> : les signaux continuent même téléphone verrouillé, mais ta musique est coupée pour toute la séance. Téléphone verrouillé, le GPS s'arrête : pas de distance ni de tracé.</span></label>
        ${supported ? '' : '<p class="muted small">Ce navigateur ne permet pas de choisir : le mode par défaut s\'applique.</p>'}
      </div>
      <div class="card">
        <h2>Mes données</h2>
        <p class="muted small">Importer un fichier d'export Foulée ou un historique préparé. Les séances déjà présentes ne sont pas dupliquées.</p>
        <div class="row"><button data-import>Importer</button>${d.history.length ? '<button data-export>Exporter</button>' : ''}</div>
        <input id="importfile" type="file" accept="application/json,.json" hidden>
      </div>
      <p class="muted small">Voix : modèle libre « siwis » (Piper, licence CC-BY 4.0, Université d'Édimbourg).</p>`;
  },
};

// Calendrier : revient où il était, sinon s'ouvre sur la semaine en cours.
function placeWeek() {
  const strip = document.getElementById('week');
  if (!strip) return;
  const monday = strip.querySelector(`[data-pickday="${mondayOf(today())}"]`);
  strip.scrollLeft = weekScroll ?? monday.offsetLeft - strip.offsetLeft;
}

// Onglet allumé pour chaque écran.
const TAB_OF = { prepare: 'demarrer', mprep: 'demarrer', questionnaire: 'profil', edit: 'programme', live: 'demarrer', muscu: 'demarrer', bilan: 'progression', saisie: 'progression', suite: 'programme', compte: 'profil' };

function render() {
  if (live) live.gpsHtml = null; // l'écran est redessiné : le message GPS aussi
  app.innerHTML = screens[current]();
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === (TAB_OF[current] || current));
  document.body.classList.toggle('is-live', current === 'live' || current === 'muscu');
  mountMaps();
  placeWeek();
  if (current === 'live') requestAnimationFrame(tick);
  guidedLoop();
}

function go(screen) {
  if (screen !== 'live') closeFinishSheet();
  if (screen !== 'prepare' && prep) { stopPrepGps(); testAudio.pause(); prep = null; }
  if (screen === 'bilan' && live && !live.done) {
    if (!audio.paused) anchor();
    audio.pause();
    const { starts, end } = live.track;
    const steps = live.session.steps;
    const reached = Math.min(live.maxTime, end);
    const lastIdx = stepAt(starts, end, reached);
    const completed = lastIdx >= steps.length ? steps.length : Math.max(0, lastIdx);
    // Après la fin du programme, le temps passé jusqu'à « Terminer » compte aussi.
    const elapsedSec = Math.round(live.overAt ? liveElapsed() : Math.max(0, reached - starts[0]));
    const prolongSec = live.overAt ? Math.max(0, elapsedSec - Math.round(end - starts[0])) : 0;
    const gps = summary(live.gps, elapsedSec);
    stopLiveExtras();
    renderTouchLock();
    live.done = true;
    bilan = {
      id: uid(),
      sport: 'course',
      source: 'guidee',
      date: live.startedAt,
      sessionName: live.session.name,
      level: live.session.level ?? null,
      ...(live.session.refaite ? { refaite: live.session.refaite } : {}),
      steps: steps,
      plannedSec: total(steps),
      elapsedSec,
      ...(prolongSec ? { prolongSec } : {}),
      completedSteps: completed,
      skipped: [...live.skipped],
      ...(extraSummary(live.session, completed) || {}),
      distanceKm: gps.distanceKm,
      distanceEstimee: false,
      distanceSource: gps.distanceKm ? 'gps' : null,
      allureSecKm: gps.allureSecKm,
      gpsIncomplet: gps.gpsIncomplet,
      deniveleM: gps.deniveleM,
      trace: encodeTrace(gps.points),
      stepMs: stepTimes(live.anchors, starts, end, reached),
      endedAt: localNow(),
      finMs: Date.now(), // appui sur « Terminer » : la montre est lue jusque-là
      difficulte: null,
      fatigue: null,
      douleur: '',
      commentaire: '',
    };
  }
  if (screen !== 'profil') cardioUi.link = null; // le lien d'import ne reste affiché que sur Profil
  current = screen;
  render();
  window.scrollTo(0, 0);
}

// --- Actions ------------------------------------------------------------------

// « Refaire cette séance » : la même course (mêmes étapes, même guidage) ou la même muscu.
// Elle s'enregistre comme une séance de plus, liée à l'ancienne par `refaite`.
function replaySession(id) {
  const d = load();
  const h = d.history.find((x) => x.id === id);
  if (!h || live || guided) return;
  if (h.sport === 'muscu') {
    const goal = GOALS_MUSCU[d.profile.questionnaire?.objectifMuscu] || GOALS_MUSCU.muscle;
    const p = replayMuscu(h, d.history, goal);
    if (!p) return;
    mReplay = { ...p, refaiteDate: h.date };
    openMuscuPrep();
    return;
  }
  const r = replayRun(h);
  if (!r) return;
  const plan = planFor(d);
  const todayRun = plan.find((p) => p.date === today() && p.sport === 'course');
  const nextRun = plan.find((p) => p.sport === 'course');
  const note = todayRun
    ? `elle remplace la course prévue aujourd'hui (palier ${todayRun.level}).`
    : r.level && nextRun && r.level < nextRun.level
      ? `palier plus bas que ton programme (palier ${nextRun.level}), qui ne redescendra pas à cause d'elle, sauf douleur.`
      : 'ta prochaine course prévue s\'adaptera à ton bilan, comme d\'habitude.';
  openPrepare({ id: `refaire-${h.id}`, name: r.name, steps: r.steps, level: r.level, refaite: h.id, refaiteDate: h.date, refaiteNote: note });
}

function showSuite(entry) {
  const d = load();
  suite = afterBilan(d.history, entry, d.settings, today(), d.profile.questionnaire);
  go('suite');
  askIA(entry.id);
}

// --- Conseils de l'IA ---------------------------------------------------------

// Alerte de l'accueil : l'IA n'a pas lu un bilan récent, pourquoi, et quand elle reprend.
function iaAlert(history) {
  const failed = failedIA(history);
  if (!failed.length) return '';
  const h = failed[0];
  return `<div class="alert ia-fail"><strong>IA indisponible : conseils de secours.</strong> ${esc(failureMessage(h.iaEchec))}
    <div class="row" style="margin-top:10px"><button class="btn-dark" data-retryia="${esc(h.id)}">Réessayer maintenant</button></div></div>`;
}

const asking = new Set();
const OBJECTIFS = { '30min': 'courir 30 min sans s’arrêter', '5km': 'courir 5 km', '10km': 'réussir un 10 km' };

// Fait lire un bilan par l'IA. Réussite : conseils gardés sur la séance (et synchronisés).
// Échec : la raison et l'heure de reprise sont gardées pour l'alerte ; les règles restent.
async function askIA(id, { force = false } = {}) {
  if (asking.has(id)) return;
  const d = load();
  const entry = d.history.find((h) => h.id === id);
  if (!entry || entry.sport === 'autre' || (hasIA(entry) && !force)) return;
  const setState = (ia) => { if (suite?.entryId === id) { suite.ia = ia; if (current === 'suite') render(); } };
  if (!account.serverEnabled()) return; // pas de serveur : les règles seules, sans alerte
  if (!account.session()) { setState({ code: 'nonconnecte' }); return; }
  asking.add(id);
  setState('loading');
  const q = d.profile.questionnaire;
  const ctx = suite?.entryId === id ? suite : afterBilan(d.history, entry, d.settings, today(), q);
  try {
    const res = await account.askConseils(iaInput(entry, d.history, ctx, OBJECTIFS[q?.objectifCourse] || ''));
    update((dd) => { const h = dd.history.find((x) => x.id === id); if (h) { h.conseilsIA = res; delete h.iaEchec; } });
    if (suite?.entryId === id) Object.assign(suite, { conseils: res.conseils, source: 'ia', ia: null });
  } catch (e) {
    const fail = { code: e.code || (e.status === 401 ? 'nonconnecte' : 'indisponible'), resetAt: e.resetAt || null, at: Date.now() };
    update((dd) => { const h = dd.history.find((x) => x.id === id); if (h) h.iaEchec = fail; });
    if (suite?.entryId === id) suite.ia = fail;
  } finally {
    asking.delete(id);
  }
  if (['suite', 'accueil', 'programme'].includes(current)) render();
}

// À l'ouverture : les bilans récents restés sans conseils de l'IA, une fois l'heure de reprise passée.
function retryIA() {
  if (!account.serverEnabled() || !account.session()) return;
  for (const h of pendingIA(load().history)) askIA(h.id);
}

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

// Exercices à noter : ceux d'une séance prévue, avec une case par série.
const muscuLog = (p) => ({
  seance: p.seance,
  sessionName: p.title,
  exercices: p.exercices.map((x) => ({ slot: x.slot, id: x.id, nom: x.nom, muscle: x.muscle, materiel: x.materiel, unite: x.unite, min: x.min, max: x.max, poids: x.poids, reps: Array(x.series).fill(null) })),
});

function newManual(sport) {
  if (sport === 'autre') {
    return { id: uid(), sport, source: 'manuelle', date: today(), activite: '', remplace: null, elapsedSec: null, difficulte: null, fatigue: null, douleur: '', commentaire: '' };
  }
  if (sport === 'muscu') {
    // Séance libre : la prochaine séance du cycle.
    const d = load();
    const q = d.profile.questionnaire || {};
    const p = muscuPlan(nextSeance(d.history, (q.joursMuscu || []).length), d.history, q, d.settings.muscuChoix || {});
    return { id: uid(), sport, source: 'manuelle', date: today(), elapsedSec: null, ...muscuLog(p), difficulte: null, fatigue: null, douleur: '', commentaire: '' };
  }
  return {
    id: uid(), sport, source: 'manuelle', date: today(), sessionName: sport === 'natation' ? 'Natation' : 'Course libre',
    elapsedSec: null, distanceKm: null, distanceEstimee: false, structure: '',
    swim: { bassinM: 25, longueurs: null, nages: [], detail: '' },
    difficulte: null, essoufflement: null, fatigue: null, douleur: '', commentaire: '',
  };
}

function readSaisie() {
  const v = (id) => document.getElementById(id);
  if (!v('duree')) return;
  if (v('date')) {
    // Date inchangée : on garde l'heure (séance guidée), sinon on la perd avec la plage du cardio.
    const day = v('date').value || today();
    if (String(bilan.date).slice(0, 10) !== day) { bilan.date = day; delete bilan.endedAt; }
  }
  const min = parseInt(v('duree').value, 10);
  const sec = Number.isFinite(min) && min > 0 ? min * 60 : null;
  // Tapé à la main : la montre ne le remplace plus.
  if (sec !== (bilan.elapsedSec ? Math.round(bilan.elapsedSec / 60) * 60 : null)) bilan.dureeSource = 'manuelle';
  bilan.elapsedSec = sec;
  bilan.douleur = v('douleur').value.trim();
  bilan.commentaire = v('comm').value.trim();
  if (bilan.sport === 'autre') {
    bilan.activite = v('activite').value.trim();
  } else if (bilan.sport === 'muscu') {
    bilan.exercices.forEach((x, i) => {
      const kg = parseFloat(String(v(`kg-${i}`)?.value ?? '').replace(',', '.'));
      x.poids = Number.isFinite(kg) && kg > 0 ? Math.round(kg * 10) / 10 : null;
      x.reps = x.reps.map((_, j) => {
        const n = parseInt(v(`rep-${i}-${j}`)?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      });
    });
  } else if (bilan.sport === 'natation') {
    bilan.swim.bassinM = Number(v('bassin').value);
    const n = parseInt(v('longueurs').value, 10);
    const lg = Number.isFinite(n) && n >= 0 ? n : null;
    if (lg !== bilan.swim.longueurs) bilan.swim.longueursSource = 'manuelle';
    bilan.swim.longueurs = lg;
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

// Musculation : charge (une pour toutes les séries) et répétitions faites, série par série.
function muscuForm(b) {
  const lieu = load().profile.questionnaire?.lieu || 'salle';
  return `
    <p class="muted small">Note ce que tu as vraiment fait : une série vide = pas faite. La charge de la prochaine séance en dépend.</p>
    ${b.exercices.map((x, i) => {
      const alts = alternatives(x.muscle, lieu);
      const body = x.materiel === 'corps';
      return `
      <section class="exo-log">
        <h2>${esc(x.nom)}</h2>
        <p class="muted small" style="margin:2px 0 0">${esc(x.muscle)} · objectif ${x.min} à ${x.max}${x.unite === 's' ? ' s' : ' répétitions'} par série</p>
        ${alts.length > 1 ? `<select data-swap="${i}" aria-label="Changer d'exercice">${alts.map((e) => `<option value="${e.id}" ${e.id === x.id ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}</select>` : ''}
        ${body ? '' : `<div class="kg"><input id="kg-${i}" type="number" inputmode="decimal" step="0.5" min="0" placeholder="?" value="${x.poids ?? ''}"><span>kg${x.materiel === 'halteres' ? ' par haltère' : x.materiel === 'barre' ? ' au total, barre comprise' : ''}</span></div>`}
        <div class="sets">${x.reps.map((r, j) => `<label>Série ${j + 1}<input id="rep-${i}-${j}" type="number" inputmode="numeric" min="0" max="300" placeholder="${x.max}" value="${r ?? ''}"></label>`).join('')}</div>
        <div class="row" style="margin-top:8px"><button class="btn-ghost small-btn" data-mfill="${i}">${x.max} partout</button><button class="btn-ghost small-btn" data-mset="${i}">+ une série</button></div>
      </section>`;
    }).join('')}`;
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

// Bulle de la courbe : un toucher l'ouvre, un deuxième (ou ailleurs) la ferme. Pas de nouveau rendu.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-curvetip]');
  document.querySelectorAll('[data-curvetip].on').forEach((x) => { if (x !== b) x.classList.remove('on'); });
  if (b) b.classList.toggle('on');
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.pickday) {
    selDay = ds.pickday;
    weekScroll = document.getElementById('week')?.scrollLeft ?? null;
    render();
  } else if (ds.tab) {
    if (ds.tab === 'accueil') { selDay = today(); weekScroll = null; }
    if (current === 'live' && !audio.paused && !confirm('La séance continue en arrière-plan. Quitter l\'écran ?')) return;
    if (current === 'saisie' && bilan?.source === 'guidee' && !confirm('Ta séance guidée ne sera pas enregistrée. Quitter quand même ?')) return;
    // Bilan quitté sans enregistrer : la séance est mise de côté (et l'accueil le dit), jamais perdue en silence.
    if (current === 'bilan' && bilan) { readBilan(); parkBilan(bilan); bilan = null; }
    go(ds.tab === 'demarrer' && live && !live.done ? 'live' : ds.tab);
  } else if (ds.start) {
    openPrepare(findSession(ds.start));
  } else if ('ready' in ds) {
    if (!prep) return;
    const s = prep.session;
    stopPrepGps();
    testAudio.pause();
    prep = null;
    startSession(s);
  } else if ('prepback' in ds) {
    const back = prep?.from && prep.from !== 'prepare' ? prep.from : 'accueil';
    go(back);
  } else if ('gpsretry' in ds) {
    if (current === 'prepare') { stopPrepGps(); startPrepGps(); updatePrepGps(); }
    else if (live) {
      if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
      gpsWatch = null;
      live.gpsError = null;
      startGps();
    }
  } else if ('soundretry' in ds) {
    if (!prep) return;
    prep.audio = 'chargement';
    render();
    loadAudio().then(() => { if (prep) prep.audio = 'ok'; }).catch(() => { if (prep) prep.audio = 'erreur'; }).finally(() => { if (current === 'prepare') render(); });
  } else if ('testsignal' in ds) {
    if (!audioAssets || !prep) return;
    applyAudioMode();
    if (testAudio.src) URL.revokeObjectURL(testAudio.src);
    testAudio.src = URL.createObjectURL(new Blob([sample(audioAssets.index, audioAssets.pack)], { type: 'audio/mpeg' }));
    prep.testing = true;
    testAudio.onended = () => { if (prep) { prep.testing = false; if (current === 'prepare') render(); } };
    testAudio.play().catch((err) => { if (prep) prep.testing = false; alert(`Lecture impossible : ${err.message}`); });
    render();
  } else if ('finishno' in ds) {
    closeFinishSheet();
  } else if ('finishok' in ds) {
    closeFinishSheet();
    go('bilan');
  } else if ('backbilan' in ds) {
    if (!pendingBilan()) return;
    bilan = pendingBilan();
    go('bilan');
  } else if ('dropbilan' in ds) {
    if (!confirm('Ne pas enregistrer cette séance ? Elle n\'apparaîtra pas dans ton historique.')) return;
    parkBilan(null);
    clearLive();
    if (live?.done) { URL.revokeObjectURL(live.url); live = null; }
    render();
  } else if ('resume' in ds) {
    const r = savedLive();
    if (r) startSession(r.session, r);
  } else if ('dropresume' in ds) {
    clearLive();
    render();
  } else if (ds.replay) {
    replaySession(ds.replay);
  } else if (ds.startplan) {
    const p = planFor(load()).find((x) => x.date === ds.startplan && x.sport === 'course');
    if (p) openPrepare({ id: `plan-${p.date}`, name: `Palier ${p.level} · ${p.title}`, steps: p.steps, level: p.level });
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
  } else if ('fixrun' in ds) {
    openFixRun(ds.fixrun);
  } else if ('fixsave' in ds) {
    saveFixRun(ds.fixsave);
  } else if ('fixcancel' in ds) {
    render();
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
  } else if ('extend' in ds) {
    extendLive();
  } else if ('unextend' in ds) {
    retractLive();
  } else if ('questionnaire' in ds) {
    openQuestionnaire();
  } else if (ds.qsport) {
    const set = new Set(qDraft.sports);
    if (set.has(ds.qsport)) set.delete(ds.qsport); else set.add(ds.qsport);
    qDraft.sports = [...set];
    qDraft.error = null;
    render();
  } else if (ds.qday) {
    const n = Number(ds.v);
    const cur = new Set(qDraft[ds.qday]);
    if (cur.has(n)) cur.delete(n); else cur.add(n);
    qDraft[ds.qday] = [...cur].sort();
    qDraft.error = null;
    render();
  } else if (ds.qbassin) {
    qDraft.bassin = Number(ds.qbassin);
    render();
  } else if ('qnext' in ds) {
    const d = load();
    const [key] = Q_STEPS[qDraft.step || 0];
    qDraft.error = stepError(qDraft, d, key);
    if (!qDraft.error) qDraft.step = Math.min(Q_STEPS.length - 1, (qDraft.step || 0) + 1);
    render();
    if (!qDraft.error) window.scrollTo(0, 0);
  } else if ('qback' in ds) {
    qDraft.step = Math.max(0, (qDraft.step || 0) - 1);
    qDraft.error = null;
    render();
    window.scrollTo(0, 0);
  } else if ('qsave' in ds) {
    const d = load();
    qDraft.error = questionnaireErrors(qDraft, d);
    if (qDraft.error) {
      // Renvoie à l'étape où il manque quelque chose.
      const bad = qChecks(qDraft, d)[0][0];
      qDraft.step = Math.max(0, Q_STEPS.findIndex(([k]) => k === bad));
      render();
      return;
    }
    const answers = cleanAnswers(qDraft, d);
    update((x) => { x.profile.questionnaire = answers; });
    qDraft = null;
    accountUi.info = null;
    selDay = today();
    go('programme');
  } else if ('touchlock' in ds) {
    touchLocked = true;
    renderTouchLock();
  } else if ('finish' in ds) {
    openFinishSheet();
  } else if (ds.retryia) {
    askIA(ds.retryia, { force: true });
  } else if ('moreplan' in ds) {
    progDays = Math.min(HORIZON, progDays + 14);
    render();
  } else if (ds.progsport) {
    progSport = ds.progsport;
    render();
  } else if (ds.autre) {
    bilan = newManual('autre');
    bilan.remplace = ds.autre;
    go('saisie');
  } else if (ds.act) {
    readSaisie();
    bilan.activite = ds.act;
    render();
  } else if (ds.manual) {
    bilan = newManual(ds.manual);
    if (ds.mdate) bilan.date = ds.mdate;
    go('saisie');
    if (bilan.sport === 'natation') { cardioUi.message = null; fetchCardio({ force: true }); }
  } else if (ds.logplan) {
    // Saisie préremplie avec la séance prévue aujourd'hui ; tout reste modifiable.
    const p = planFor(load(), 1).find((x) => x.sport === ds.logplan);
    bilan = newManual(ds.logplan);
    bilan.fromPlan = Boolean(p);
    if (p?.sport === 'natation') {
      bilan.sessionName = 'Natation (programme)';
      bilan.swim.bassinM = p.bassin;
      bilan.swim.longueurs = p.longueurs;
      bilan.swim.longueursSource = 'plan';
      bilan.swim.nages = ['crawl', 'brasse', 'dos'].filter((n) => p.plan.some((l) => l.includes(n)));
    } else if (p?.sport === 'muscu') {
      Object.assign(bilan, muscuLog(p));
    } else if (p?.sport === 'course') {
      bilan.sessionName = `Palier ${p.level} · ${p.title}`;
      bilan.structure = stepsSummary(p.steps).replace(/ · /g, ', ').replace(/\d+ × [^,]+ de course/, p.title);
      bilan.elapsedSec = Math.round(total(p.steps) / 60) * 60;
    }
    go('saisie');
    if (bilan.sport === 'natation') { cardioUi.message = null; fetchCardio({ force: true }); }
  } else if (ds.mfill !== undefined || ds.mset !== undefined) {
    readSaisie();
    const x = bilan.exercices[Number(ds.mfill ?? ds.mset)];
    if (ds.mfill !== undefined) x.reps = x.reps.map(() => x.max);
    else if (x.reps.length < 10) x.reps.push(null);
    render();
  } else if ('savemanual' in ds) {
    readSaisie();
    if (bilan.sport === 'muscu') {
      // Séries vides = non faites (0) ; un exercice sans aucune série n'est pas gardé.
      const kept = bilan.exercices.filter((x) => x.reps.some((r) => r > 0)).map((x) => ({ ...x, reps: x.reps.map((r) => r || 0) }));
      if (!kept.length) { alert('Note au moins une série.'); return; }
      bilan.exercices = kept;
    }
    if (bilan.sport === 'autre' && (!bilan.activite || !bilan.elapsedSec)) { alert('Indique l’activité et sa durée.'); return; }
    const entry = bilan;
    update((d) => { d.history.push(entry); });
    if (entry.sport !== 'autre') progSport = entry.sport; // Progression s'ouvre sur le sport qu'on vient de noter
    bilan = null;
    showSuite(entry);
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
    parkBilan(null);
    clearLive();
    if (live) URL.revokeObjectURL(live.url);
    live = null;
    audio.removeAttribute('src');
    audio.load();
    bilan = null;
    showSuite(entry);
  } else if ('export' in ds) {
    const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `foulee-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset.mpswap) {
    // Avant la séance : autre exercice du même muscle, gardé pour les prochaines fois.
    const key = e.target.dataset.mpswap;
    if (mReplay) {
      // Séance refaite : le changement vaut pour cette fois, le programme garde ses choix.
      const slot = Number(key.split(':')[1]);
      const i = mReplay.exercices.findIndex((x) => x.slot === slot);
      const ex = byId(e.target.value);
      if (i >= 0 && ex) {
        const d = load();
        const goal = GOALS_MUSCU[d.profile.questionnaire?.objectifMuscu] || GOALS_MUSCU.muscle;
        mReplay.exercices[i] = { slot, ...ex, series: mReplay.exercices[i].series, ...nextLoad(ex, d.history, goal) };
      }
      render();
      return;
    }
    update((d) => { d.settings.muscuChoix = { ...d.settings.muscuChoix, [key]: e.target.value }; });
    render();
    return;
  }
  if (e.target.dataset.mswap !== undefined && guided) {
    // Pendant la séance, avant la 1re série : on change d'exercice (même muscle).
    const x = currentExercise(guided);
    const ex = byId(e.target.value);
    if (!x || !ex || ex.id === x.id) return;
    const d = load();
    const goal = GOALS_MUSCU[d.profile.questionnaire?.objectifMuscu] || GOALS_MUSCU.muscle;
    const next = nextLoad(ex, d.history, goal);
    swapExercise(guided, { id: ex.id, nom: ex.nom, muscle: ex.muscle, materiel: ex.materiel, unite: ex.unite, min: next.min, max: next.max, poids: next.poids, reason: next.reason });
    if (guided.seance && x.slot !== undefined) update((dd) => { dd.settings.muscuChoix = { ...dd.settings.muscuChoix, [`${guided.seance}:${x.slot}`]: ex.id }; });
    mDraft = { key: null, reps: 0 };
    saveGuided();
    render();
    return;
  }
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
      go('progression');
    });
  } else if (current === 'questionnaire' && e.target.name?.startsWith('q-')) {
    const key = { 'q-objc': 'objectifCourse', 'q-nivc': 'niveauCourse', 'q-objn': 'objectifNatation', 'q-nivn': 'niveauNatation', 'q-objm': 'objectifMuscu', 'q-lieu': 'lieu', 'q-nivm': 'niveauMuscu' }[e.target.name];
    qDraft[key] = ['niveauCourse', 'objectifNatation', 'niveauNatation'].includes(key) ? Number(e.target.value) : e.target.value;
    qDraft.error = null;
    render();
  } else if (current === 'saisie' && e.target.dataset.swap !== undefined) {
    // Autre exercice du même muscle : gardé pour les prochaines séances.
    readSaisie();
    const i = Number(e.target.dataset.swap);
    const x = bilan.exercices[i];
    const ex = byId(e.target.value);
    const d = load();
    const goal = GOALS_MUSCU[d.profile.questionnaire?.objectifMuscu] || GOALS_MUSCU.muscle;
    const next = nextLoad(ex, d.history, goal);
    bilan.exercices[i] = { ...x, id: ex.id, nom: ex.nom, materiel: ex.materiel, unite: ex.unite, min: next.min, max: next.max, poids: next.poids };
    if (bilan.seance && x.slot !== undefined) update((dd) => { dd.settings.muscuChoix = { ...dd.settings.muscuChoix, [`${bilan.seance}:${x.slot}`]: ex.id }; });
    render();
  } else if (current === 'saisie') {
    readSaisie();
    // Autre bassin : les longueurs lues par la montre sont recomptées (même distance).
    if (e.target.id === 'bassin' && bilan.swim?.longueursSource === 'montre') applySwim(bilan);
    if (e.target.id === 'date' && bilan.sport === 'natation') {
      // Autre jour : ce que la montre avait rempli ne vaut plus.
      delete bilan.fenetre; delete bilan.montre; delete bilan.cardio;
      if (bilan.swim.longueursSource === 'montre') { bilan.swim.longueurs = null; bilan.swim.longueursSource = null; bilan.distanceKm = null; }
      if (bilan.dureeSource === 'montre') { bilan.elapsedSec = null; bilan.dureeSource = null; }
      cardioUi.message = null;
      fetchCardio({ force: true });
      render();
    }
    if (e.target.id === 'longueurs' || e.target.id === 'bassin') render();
  } else if (e.target.id === 'prenom') {
    update((d) => { d.profile.prenom = e.target.value.trim(); });
  } else if (current === 'edit') {
    readEditor();
    render();
  }
});

// --- Musculation guidée -------------------------------------------------------
// « Démarrer » note l'heure de début, « Série faite » lance la récup, un signal (et un flash)
// marque sa fin, « Terminer » note l'heure de fin et ouvre le bilan prérempli.

const MUSCU_KEY = 'foulee.muscu';
let guided = null;
let mDraft = { key: null, reps: 0 };
const restAudio = new Audio();
restAudio.setAttribute('playsinline', '');
let restUrl = null;
let guidedTimer = null;

function saveGuided() {
  try {
    if (guided && guided.phase !== 'done') localStorage.setItem(MUSCU_KEY, JSON.stringify(guided));
    else localStorage.removeItem(MUSCU_KEY);
  } catch {}
}
function savedGuided() {
  if (guided && guided.phase !== 'done') return guided;
  try {
    const s = JSON.parse(localStorage.getItem(MUSCU_KEY));
    return s && s.phase !== 'done' && Date.now() - s.startedAt < 4 * 3600 * 1000 ? s : null;
  } catch {
    return null;
  }
}

function stopRestAudio() {
  restAudio.pause();
  if (restUrl) URL.revokeObjectURL(restUrl);
  restUrl = null;
}
// Lancée dans le geste (« C'est parti », « Série faite », ±15 s) : iOS refuse un son lancé plus
// tard par une minuterie. Le décompte de départ joue le premier son de la séance : le lecteur
// et la session audio sont actifs dès le départ, pas seulement à la première récup.
function playRest() {
  stopRestAudio();
  if (!guided || (guided.phase !== 'rest' && guided.phase !== 'countdown' && !guided.hold)) return;
  if (!audioAssets) { loadAudio().catch(() => {}); return; }
  try {
    const bytes = guided.hold ? holdTrack(guided, audioAssets.index, audioAssets.pack)
      : guided.phase === 'countdown'
      ? restTrack(countLeft(guided), audioAssets.index, audioAssets.pack, true)
      : restTrack(restLeft(guided), audioAssets.index, audioAssets.pack);
    restUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    applyAudioMode();
    restAudio.src = restUrl;
    restAudio.currentTime = 0;
    restAudio.play().catch(() => {});
  } catch {}
}

function flashMuscu() {
  document.body.classList.remove('flash-muscu');
  void document.body.offsetWidth;
  document.body.classList.add('flash-muscu');
  setTimeout(() => document.body.classList.remove('flash-muscu'), 1500);
}

// Minimum atteint : flash double (comme le signal mi-séance), distinct du flash de fin.
function flashHold() {
  document.body.classList.remove('flash-tranche');
  void document.body.offsetWidth;
  document.body.classList.add('flash-tranche');
  setTimeout(() => document.body.classList.remove('flash-tranche'), 2600);
}

function guidedLoop() {
  clearInterval(guidedTimer);
  guidedTimer = null;
  if (current !== 'muscu' || !guided) return;
  guidedTimer = setInterval(() => {
    if (current !== 'muscu' || !guided) return guidedLoop();
    const t = document.getElementById('mtime');
    if (t) t.textContent = mmss(guidedElapsed(guided));
    if (guided.phase === 'countdown') {
      const c = countLeft(guided);
      if (c <= 0) {
        endCountdown(guided);
        saveGuided();
        flashMuscu();
        render();
        return;
      }
      const el = document.getElementById('mcount');
      if (el) el.textContent = Math.max(1, Math.ceil(c));
      return;
    }
    if (guided.hold) {
      if (holdOver(guided)) {
        stopHold(guided); // noté au maximum ; la récup est déjà dans la piste en cours
        if (guided.phase === 'done') { flashMuscu(); return finishGuided(); }
        saveGuided();
        flashMuscu();
        render();
        return;
      }
      const lead = holdLead(guided);
      const el = Math.floor(holdElapsed(guided));
      const now = document.getElementById('mholdnow');
      const label = lead > 0 ? 'Mets-toi en place' : el >= guided.hold.min ? 'Dans la tranche' : 'Tiens';
      if (now && now.textContent !== label) {
        if (now.textContent === 'Mets-toi en place') flashMuscu();
        else if (label === 'Dans la tranche') flashHold();
        now.textContent = label;
      }
      const c = document.getElementById('mhold');
      if (c) c.textContent = lead > 0 ? Math.max(1, Math.ceil(lead)) : el;
      return;
    }
    if (guided.phase !== 'rest') return;
    const left = restLeft(guided);
    if (left <= 0) {
      endRest(guided);
      saveGuided();
      flashMuscu();
      render();
      return;
    }
    const r = document.getElementById('mrest');
    if (r) r.textContent = mmss(Math.ceil(left));
  }, 250);
}

// Séance de muscu du jour (ou la suivante du cycle), avec les exercices choisis.
let mReplay = null; // séance de muscu refaite (plan prêt), le temps de l'écran « Avant de commencer »
function todayMuscuPlan(d) {
  if (mReplay) return mReplay;
  const q = d.profile.questionnaire || {};
  return planFor(d, 1).find((x) => x.sport === 'muscu' && x.date === today())
    || muscuPlan(nextSeance(d.history, (q.joursMuscu || []).length), d.history, q, d.settings.muscuChoix || {});
}

// Exercices du même muscle pour le matériel déclaré.
const liveAlts = (x) => alternatives(x.muscle, load().profile.questionnaire?.lieu || 'salle');

// « Démarrer » : d'abord l'écran « Avant de commencer » (une séance en cours reprend directement).
let mprepAudio = null;
function openMuscuPrep() {
  if (savedGuided()) { mReplay = null; return startGuided(); }
  mprepAudio = audioAssets ? 'ok' : 'chargement';
  if (!audioAssets) {
    loadAudio().then(() => { mprepAudio = 'ok'; }).catch(() => { mprepAudio = 'erreur'; })
      .finally(() => { if (current === 'mprep') render(); });
  }
  go('mprep');
}

function startGuided() {
  if (!audioAssets) loadAudio().catch(() => {});
  const resume = savedGuided();
  if (resume) {
    guided = resume;
  } else {
    const p = todayMuscuPlan(load());
    const log = muscuLog(p);
    guided = createGuided({ ...log, exercices: log.exercices.map((x, i) => ({ ...x, reason: p.exercices[i].reason })), repos: p.repos });
    if (p.refaite) guided.refaite = p.refaite;
    mReplay = null;
    startCountdown(guided, 3);
  }
  mDraft = { key: null, reps: 0 };
  saveGuided();
  keepAwake();
  go('muscu');
  if (guided.phase === 'rest' || guided.phase === 'countdown' || guided.hold) playRest();
}

function finishGuided() {
  finish(guided);
  stopRestAudio();
  stopLiveExtras();
  const g = guided;
  const b = newManual('muscu');
  const hm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  Object.assign(b, {
    source: 'guidee',
    fromPlan: true,
    // Heure de début et de fin : la plage où le cardio de la montre est rattaché.
    date: new Date(g.startedAt).toLocaleString('sv-SE').replace(' ', 'T'),
    endedAt: new Date(g.endedAt).toLocaleString('sv-SE').replace(' ', 'T'),
    seance: g.seance,
    sessionName: g.sessionName,
    ...(g.refaite ? { refaite: g.refaite } : {}),
    exercices: g.exercices.map(({ reason, ...x }) => ({ ...x, reps: [...x.reps] })),
    elapsedSec: Math.max(60, Math.round(guidedElapsed(g) / 60) * 60),
    horaires: `${hm(g.startedAt)} → ${hm(g.endedAt)}`,
  });
  guided = null;
  saveGuided();
  bilan = b;
  go('saisie');
}

document.addEventListener('visibilitychange', () => {
  if (current === 'muscu' && guided && document.visibilityState === 'visible') { keepAwake(); render(); }
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if ('muscugo' in ds) return openMuscuPrep();
  if ('mstart' in ds) return startGuided();
  if ('mprepback' in ds) { mReplay = null; return go('accueil'); }
  if ('msoundretry' in ds) {
    mprepAudio = 'chargement';
    render();
    loadAudio().then(() => { mprepAudio = 'ok'; }).catch(() => { mprepAudio = 'erreur'; }).finally(() => { if (current === 'mprep') render(); });
    return;
  }
  if (current !== 'muscu' || !guided) return;
  if ('mholdgo' in ds) {
    startHold(guided);
    saveGuided();
    render();
    playRest(); // dans le geste : départ, minimum, fin et récup sont dans la même piste
    keepAwake();
  } else if ('mholdcancel' in ds) {
    cancelHold(guided);
    stopRestAudio();
    saveGuided();
    render();
  } else if ('mholdstop' in ds) {
    stopHold(guided);
    if (guided.phase === 'done') return finishGuided();
    saveGuided();
    render();
    if (guided.phase === 'rest') playRest(); else stopRestAudio();
  } else if (ds.mreps) {
    const x = currentExercise(guided);
    const step = x.unite === 's' ? 5 : 1;
    mDraft.reps = Math.max(1, Math.min(300, mDraft.reps + Number(ds.mreps) * step));
    document.getElementById('mreps').textContent = mDraft.reps;
  } else if ('msetdone' in ds) {
    const x = currentExercise(guided);
    const kg = parseFloat(String(document.getElementById('mkg')?.value ?? '').replace(',', '.'));
    if (Number.isFinite(kg) && kg > 0) x.poids = Math.round(kg * 10) / 10;
    setDone(guided, mDraft.reps);
    if (guided.phase === 'done') return finishGuided();
    saveGuided();
    render();
    playRest();
    keepAwake(); // écran qui se verrouille pendant la récup = plus de signal : on redemande à chaque série
  } else if (ds.mrest) {
    adjustRest(guided, Number(ds.mrest));
    saveGuided();
    render();
    playRest();
  } else if ('mrestskip' in ds) {
    endRest(guided);
    stopRestAudio();
    saveGuided();
    render();
  } else if ('mskip' in ds) {
    if (!confirm('Passer les séries restantes de cet exercice ?')) return;
    skipExercise(guided);
    if (guided.phase === 'done') return finishGuided();
    saveGuided();
    render();
  } else if ('mfinish' in ds) {
    if (!setsDone(guided)) {
      if (!confirm('Aucune série faite. Abandonner la séance ?')) return;
      stopRestAudio();
      stopLiveExtras();
      guided = null;
      saveGuided();
      return go('accueil');
    }
    if (!confirm('Terminer la séance maintenant ?')) return;
    finishGuided();
  }
});

// --- Compte et synchronisation -----------------------------------------------

let accountUi = { busy: false, error: null, info: null, invite: null, inviteFrom: null, firstAccount: false, invites: null, lastInvite: null, sync: null };
let syncing = false;
let pushTimer = null;

// Les données du téléphone appartiennent-elles au compte connecté ? `owner` est posé
// à la première synchronisation. Des données sans propriétaire (utilisées avant tout
// compte) rejoignent le compte ; celles d'un autre compte ne sont jamais envoyées.
const ownLocal = () => {
  const owner = load().owner;
  const id = account.session()?.user?.id;
  return !owner || !id || owner === id;
};

async function syncNow() {
  if (!account.serverEnabled() || !account.session()) return;
  syncing = true;
  try {
    const { data } = await account.pullData();
    const user = account.session()?.user;
    const merged = account.mergeData(ownLocal() ? load() : empty(), data);
    if (user?.id) merged.owner = user.id;
    if (user?.prenom && !merged.profile?.prenom) merged.profile = { ...merged.profile, prenom: user.prenom };
    replace(merged);
    await account.pushData(load());
    accountUi.sync = `Synchronisé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
  } catch (e) {
    accountUi.sync = `Synchronisation en attente : ${e.message}`;
  } finally {
    syncing = false;
  }
  if (current !== 'live') render();
}

onSave(() => {
  if (syncing || !account.serverEnabled() || !account.session() || !ownLocal()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!ownLocal()) return;
    account.pushData(load())
      .then(() => { accountUi.sync = `Synchronisé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`; })
      .catch((e) => { accountUi.sync = `Synchronisation en attente : ${e.message}`; });
  }, 2000);
});

async function refreshAccount() {
  if (!account.serverEnabled()) return;
  try {
    accountUi.firstAccount = (await account.status()).firstAccount;
    if (account.session()) accountUi.invites = (await account.listInvites()).invites;
  } catch (e) {
    accountUi.error = e.message;
  }
  if (current === 'compte') render();
  refreshCardio();
}

async function accountAction(fn) {
  accountUi.busy = true;
  accountUi.error = null;
  accountUi.info = null;
  render();
  try {
    await fn();
  } catch (e) {
    accountUi.error = e.message;
  }
  accountUi.busy = false;
  render();
}

const inviteFromText = (txt) => {
  const t = String(txt || '').trim();
  const m = /[?&]invite=([A-Za-z0-9_-]+)/.exec(t);
  return m ? m[1] : t;
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if ('register' in ds) {
    const prenom = document.getElementById('acc-prenom')?.value.trim() || load().profile.prenom;
    const code = accountUi.invite?.code || inviteFromText(document.getElementById('acc-invite')?.value);
    accountAction(async () => {
      const user = await account.register(prenom, code || undefined);
      accountUi.invite = null;
      await syncNow();
      update((d) => { d.profile.prenom = user.prenom; });
      const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
      accountUi.info = installed
        ? `Compte créé. Bienvenue ${user.prenom} !`
        : `Compte créé. Installe maintenant Foulée sur ton écran d'accueil (Partager > Sur l'écran d'accueil sur iPhone, menu ⋮ > Installer sur Android), ouvre-la et touche « Me connecter ».`;
      await refreshAccount();
      if (!load().profile.questionnaire) openQuestionnaire();
    });
  } else if ('login' in ds) {
    accountAction(async () => {
      const user = await account.login();
      await syncNow();
      accountUi.info = `Bon retour ${user.prenom} !`;
      await refreshAccount();
    });
  } else if ('logout' in ds) {
    accountAction(async () => {
      clearTimeout(pushTimer);
      if (ownLocal()) await account.pushData(load()).catch(() => {});
      await account.logout();
      accountUi.invites = null;
      accountUi.lastInvite = null;
      accountUi.info = 'Déconnecté. Tes séances restent sur ce téléphone.';
    });
  } else if (ds.invite) {
    accountAction(async () => {
      const inv = await account.createInvite(ds.invite);
      accountUi.lastInvite = inv.url;
      accountUi.info = ds.invite === 'recover' ? 'Ouvre ce lien sur ton nouvel appareil.' : 'Lien prêt : envoie-le à ton proche.';
      accountUi.invites = (await account.listInvites()).invites;
    });
  } else if ('share' in ds) {
    const url = accountUi.lastInvite;
    if (navigator.share) navigator.share({ title: 'Foulée', text: 'Rejoins-moi sur Foulée, mon coach de course et de natation :', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => { accountUi.info = 'Lien copié.'; render(); });
  }
});

// --- Cardio de l'Apple Watch ----------------------------------------------------
// Le Raccourci iPhone envoie au serveur la fréquence cardiaque lue dans Santé ; l'app
// récupère les mesures de la plage horaire de chaque séance guidée récente et les y rattache.

let cardioUi = { status: null, link: null, busy: false, message: null, lastTry: 0, copied: false };
const cardioOn = () => Boolean(account.serverEnabled() && account.session() && load().settings.cardio);
const hm = (t) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Étapes du Raccourci, à faire une seule fois dans l'app Raccourcis de l'iPhone.
const AUTRES_MESURES = [
  ['Distance de marche et de course', 'dist'],
  ['Énergie active', 'kcal'],
  ['Puissance de course', 'puiss'],
  ['Pas', 'pas'],
  ['Distance de nage', 'nage'],
  ['Mouvements de nage', 'mouvements'],
];
const raccourciSteps = () => `
  <ol class="steps-guide">
    <li>Ouvre l'app <b>Raccourcis</b>, touche <b>+</b> en haut à droite, nomme le raccourci <b>Foulée cardio</b>.</li>
    <li>Ajoute l'action <b>Rechercher des échantillons de santé</b>.
      Règle : <b>Type</b> est <b>Fréquence cardiaque</b> · <b>Date de début</b> est <b>aujourd'hui</b> · Trier par <b>Date de début</b>, <b>Plus ancien d'abord</b> · <b>Limite</b> désactivée.</li>
    <li>Ajoute l'action <b>Répéter avec chaque élément</b> (elle prend les échantillons de santé toute seule).</li>
    <li>À l'intérieur de la boucle, ajoute l'action <b>Texte</b> et mets dedans les deux variables séparées par un point-virgule :
      <span class="code">Élément de répétition;Élément de répétition</span>
      <ul>
        <li>Pour insérer <b>Élément de répétition</b> : touche le champ, puis « Élément de répétition » dans la barre au-dessus du clavier.</li>
        <li>Touche le 1er, choisis <b>Date de début</b>, puis <b>Format de date : ISO 8601</b> et active <b>Inclure l'heure</b>.</li>
        <li>Touche le 2e, choisis <b>Valeur</b>.</li>
      </ul></li>
    <li>Toujours dans la boucle, sous le Texte : <b>Ajouter à la variable</b>, avec <b>Texte</b>, variable nommée <span class="code">Mesures</span>.</li>
    <li>Distance, calories, puissance, cadence (facultatif), <b>sans boucle</b> (une boucle ferait un tour par mesure : des milliers pour une course, le Raccourci bloque) : après <b>Fin de la répétition</b>, pour chaque mesure ci-dessous :
      <ul>
        <li>Ajoute <b>Rechercher des échantillons de santé</b> : <b>Type</b> (ci-dessous) · <b>Date de début</b> est <b>aujourd'hui</b> · <b>Limite</b> désactivée.</li>
        <li>Juste dessous, ajoute un <b>Texte</b> sur 6 lignes (touche Retour entre chaque) :
          <span class="code">#dates dist</span> · <b>Échantillons de Santé</b> (touche-le : <b>Date de début</b>, ISO 8601 avec l'heure) · <span class="code">#valeurs dist</span> · <b>Échantillons de Santé</b> (<b>Valeur</b>) · <span class="code">#sources dist</span> · <b>Échantillons de Santé</b> (<b>Source</b>).</li>
        <li>Dessous : <b>Ajouter à la variable</b>, <b>Texte</b> à <span class="code">Mesures</span>.</li>
      </ul>
      Remplace <span class="code">dist</span> par le petit mot de chaque mesure :
      <ul>${AUTRES_MESURES.map(([t, k]) => `<li><b>${t}</b> → <span class="code">${k}</span></li>`).join('')}</ul>
      La Source sert à ne pas compter deux fois les pas et la distance, déjà comptés par l'iPhone.</li>
    <li>Tout en bas, ajoute <b>Combiner le texte</b> : <b>Mesures</b> avec <b>Nouvelles lignes</b>.</li>
    <li>Ajoute <b>Obtenir le contenu de l'URL</b>. Colle ton lien Foulée à la place de l'URL. Touche la flèche pour déplier :
      <b>Méthode : POST</b> · <b>Corps de la requête : JSON</b> · <b>Ajouter un champ</b> → <b>Texte</b>, clé <span class="code">mesures</span>, valeur <b>Texte combiné</b>.</li>
    <li>Ajoute <b>Afficher le contenu</b> (avec <b>Contenu de l'URL</b>). Touche <b>OK</b>.</li>
    <li>Lance-le une fois : accepte l'accès à <b>Santé</b> pour chaque mesure et la connexion au serveur Foulée (<b>Toujours autoriser</b>). Il affiche « Foulée : … reçues ».</li>
    <li>Si le Raccourci s'arrête sur « grande quantité de données » : Réglages > Apps > Raccourcis > Avancé > <b>Autoriser le partage de grandes quantités de données</b>.</li>
    <li>Pratique : dans le raccourci, ⓘ → <b>Ajouter à l'écran d'accueil</b>.</li>
  </ol>`;

const raccourciUsage = `
  <ol class="steps-guide">
    <li>Avant de partir : lance une séance <b>Course extérieure</b> sur ta montre, puis ta séance dans Foulée.</li>
    <li>À la fin : arrête la séance sur la montre, attends une minute (le temps qu'elle passe le cardio à l'iPhone).</li>
    <li>Lance <b>Foulée cardio</b>, puis reviens dans Foulée : le cardio et les autres mesures s'ajoutent tout seuls à la séance.</li>
  </ol>
  <p class="small"><b>À la piscine :</b> lance une séance <b>Natation en piscine</b> sur ta montre (longueur du bassin réglée, 25 m). En sortant, arrête-la, laisse le Raccourci tourner, puis « Noter ma séance » dans Foulée : longueurs, durée et cardio sont déjà remplis.</p>
  <p class="muted small">Oublié ? Lance-le plus tard dans la journée, ça marche aussi. Le relancer ne crée pas de doublon.</p>`;

// Zones de l'app Forme recopiées à la main : Foulée ne les invente pas (elles dépendent de la
// FC max et de repos que l'iPhone connaît).
function zonesForm() {
  const z = cardioUi.zonesDraft || zoneLimits(load().settings.zones) || [];
  return `<details${cardioUi.zonesOpen ? ' open' : ''}><summary>Mes zones cardio${z.length ? '' : ' (à remplir)'}</summary>
    <p class="muted small">Dans l'app Forme, ouvre une course > Fréquence cardiaque : recopie la limite haute des zones 1 à 4 (exemple : zone 1 « &lt;140 » → 140, zone 2 « 141–151 » → 151).</p>
    <div class="zones-in">${[0, 1, 2, 3].map((i) => `<label>Zone ${i + 1}<input id="zone${i}" type="number" inputmode="numeric" min="60" max="230" value="${z[i] ?? ''}"></label>`).join('')}</div>
    <button class="btn-dark" data-zonessave style="width:100%;margin-top:8px">Enregistrer mes zones</button>
    ${cardioUi.zonesMsg ? `<p class="muted small">${esc(cardioUi.zonesMsg)}</p>` : ''}
  </details>`;
}

function cardioCard(sess) {
  if (!sess) {
    return `<div class="card"><h2>Cardio Apple Watch</h2><p class="muted small">Connecte-toi à ton compte pour ajouter à tes courses le cardio mesuré par ta montre.</p></div>`;
  }
  const st = cardioUi.status;
  const link = cardioUi.link;
  return `
    <div class="card cardio-card">
      <h2>Cardio Apple Watch</h2>
      ${link ? `
        <p class="small"><b>Ton lien d'import.</b> Il n'est affiché qu'une fois : copie-le maintenant et colle-le dans le Raccourci (étape 8).</p>
        <input id="cardio-link" readonly value="${esc(link)}">
        <div class="row"><button class="btn-dark" data-cardiocopy>${cardioUi.copied ? 'Lien copié ✓' : 'Copier le lien'}</button></div>
        <p class="muted small">Ce lien sert seulement à envoyer les mesures de ta montre sur ton compte, il ne lit rien. Garde-le pour toi : ne l'envoie à personne, pas de capture d'écran.</p>
        <details open><summary>Créer le Raccourci (une seule fois, 5 min)</summary>${raccourciSteps()}</details>`
      : st?.active ? `
        <p class="small">Import activé.${st.lastUsedAt ? ` Dernier envoi : ${esc(hm(st.lastUsedAt))} (${st.lastCount} mesures).` : ' Aucun envoi reçu pour l’instant.'}</p>
        <details><summary>Après chaque course</summary>${raccourciUsage}</details>
        ${zonesForm()}
        <details><summary>Créer le Raccourci</summary>${raccourciSteps()}<p class="muted small">Lien perdu ? « Nouveau lien » ci-dessous : l'ancien cesse de marcher, colle le nouveau dans le Raccourci.</p></details>
        <div class="row"><button data-cardiolink>Nouveau lien</button><button data-cardiooff>Désactiver</button></div>`
      : `
        <p class="muted small">Ta montre mesure ton cardio pendant la course, l'iPhone le range dans Santé. Un Raccourci l'envoie à Foulée : cardio (moyenne, maximum, en course et en marche, courbe), et si tu veux distance, calories actives, puissance et cadence. Le programme s'en sert : si ton cœur travaille nettement plus que la dernière fois au même palier, on consolide avant de monter.</p>
        <p class="muted small">Sans montre, rien ne change et aucun cardio n'est affiché.</p>
        <button class="btn-dark" data-cardiolink style="width:100%">Activer l'import du cardio</button>`}
      ${cardioUi.message && current === 'profil' ? `<p class="muted small">${esc(cardioUi.message)}</p>` : ''}
    </div>`;
}

// Séances guidées des 3 derniers jours sans cardio ou sans les autres mesures de la montre (et
// le bilan en cours) : on demande les mesures de leur plage horaire et on les y rattache.
const missing = (h) => !h.cardio || !h.montre || montreStale(h.montre) || !h.cardio.apres;
async function fetchCardio({ force = false } = {}) {
  if (!cardioOn() || cardioUi.busy) return;
  if (!force && Date.now() - cardioUi.lastTry < 20_000) return;
  const limit = Date.now() - 3 * 86400_000;
  // Natation saisie à la main : pas d'heure. On cherche les longueurs de la montre sur la
  // journée, elles donnent la plage de la séance (swimWindow).
  const swimTodo = (h) => sportOf(h) === 'natation' && !h.fenetre && Boolean(dayRange(h.date)) && dayRange(h.date)[0] < Date.now();
  // Une nage déjà rattachée à une séance ne l'est pas une 2e fois (deux saisies le même jour).
  const taken = load().history.filter((h) => h.fenetre).map((h) => h.fenetre);
  const swimOf = (h) => swimWindow((autres.nage || []).filter(([t]) => !taken.some(([a, b]) => t >= a && t <= b)), ...dayRange(h.date));
  const rangeOf = (h) => windowOf(h) || (swimTodo(h) ? dayRange(h.date) : null);
  const saved = load().history.filter((h) => missing(h) && rangeOf(h) && rangeOf(h)[1] > limit);
  const editing = bilan && (current === 'bilan' || (current === 'saisie' && bilan.sport === 'natation'));
  const pending = editing && missing(bilan) && rangeOf(bilan) && rangeOf(bilan)[1] > limit ? [bilan] : [];
  const all = [...saved, ...pending];
  if (!all.length) return;
  const from = Math.max(limit, Math.min(...all.map((h) => rangeOf(h)[0])));
  // Jusqu'à 4 min après la fin : le cardio après l'effort.
  const to = Math.min(from + 4 * 86400_000 - 1, Math.max(...all.map((h) => rangeOf(h)[1])) + 4 * 60_000);
  // La saisie en cours est lue AVANT de rattacher les mesures de la montre : la lire après
  // prendrait la distance (ou les longueurs) de la montre pour une valeur tapée à la main.
  const readForm = () => { if (current === 'bilan') readBilan(); else if (current === 'saisie') readSaisie(); };
  readForm();
  cardioUi.busy = true;
  cardioUi.lastTry = Date.now();
  if (editing) render();
  let samples = [];
  let autres = {};
  try {
    ({ samples, autres = {} } = await account.cardioSamples(from, to));
    cardioUi.message = null;
  } catch (e) {
    cardioUi.message = `Cardio non récupéré : ${e.message}`;
  }
  cardioUi.busy = false;
  readForm(); // ce qui a été tapé pendant la recherche
  const found = [];
  for (const h0 of saved) {
    const fen = swimTodo(h0) ? swimOf(h0) : null;
    if (fen) taken.push(fen);
    if (!windowOf(h0) && !fen) continue;
    const h = fen ? { ...h0, fenetre: fen } : h0;
    const c = h.cardio ? null : summarize(h, samples);
    // Mesures de la montre résumées par un ancien calcul : recalculées avec les données du serveur.
    const stale = montreStale(h.montre);
    // Serveur injoignable : on ne touche à rien. Plus rien sur le serveur : l'ancien résumé reste,
    // marqué à jour pour ne pas le redemander sans fin.
    const m = h.montre && !stale ? null : stale && cardioUi.message ? null : summarizeMontre(h, autres) || (stale ? { ...h.montre, v: MONTRE_V } : null);
    const ap = h.cardio && !h.cardio.apres ? recovery(windowOf(h)[1], samples) : null;
    if (c || m || ap || fen) found.push([h.id, c, m, ap, fen]);
  }
  if (found.length) {
    const fresh = found.some(([, c, m]) => c || m);
    update((d) => {
      for (const [id, c, m, ap, fen] of found) {
        const h = d.history.find((x) => x.id === id);
        if (!h) continue;
        if (fen) h.fenetre = fen;
        if (ap && h.cardio && !c && !m) { h.cardio.apres = ap; continue; } // rien de neuf pour les conseils
        if (c) h.cardio = c;
        if (m) attachMontre(h, m);
        if (m && sportOf(h) === 'natation') applySwim(h);
        // Les conseils de l'IA du dernier bilan ont été écrits sans ces mesures : ils sont redemandés.
        const latest = d.history.every((x) => sportOf(x) !== sportOf(h) || String(x.date) <= String(h.date));
        if (latest) { delete h.conseilsIA; delete h.iaEchec; }
      }
    });
    for (const [id, c, m] of found) {
      if ((c || m) && suite?.entryId === id) {
        const d = load();
        const entry = d.history.find((x) => x.id === id);
        suite = { ...afterBilan(d.history, entry, d.settings, today(), d.profile.questionnaire), ia: null };
        askIA(id);
      }
    }
    if (fresh) retryIA();
  }
  if (pending.length) {
    const swim = sportOf(bilan) === 'natation';
    if (swimTodo(bilan)) {
      const fen = swimOf(bilan);
      if (fen) bilan.fenetre = fen;
    }
    const c = windowOf(bilan) ? bilan.cardio || summarize(bilan, samples) : null;
    const m = windowOf(bilan) ? bilan.montre || summarizeMontre(bilan, autres) : null;
    if (c) bilan.cardio = c;
    if (m && !bilan.montre) {
      attachMontre(bilan, m);
      if (swim) applySwim(bilan);
    }
    if (swim && !bilan.fenetre && !cardioUi.message) cardioUi.message = 'Pas encore de longueurs de ta montre ce jour-là. Arrête la séance « Natation en piscine » sur la montre, attends une minute que l’iPhone la reçoive, lance ton Raccourci puis touche le bouton ci-dessous.';
    else if (!c && !swim && !cardioUi.message) cardioUi.message = samples.length ? 'Des mesures sont arrivées, mais aucune pendant cette séance. La montre a-t-elle bien suivi la séance ?' : 'Pas encore de mesures de la montre pour cette séance. Relance le Raccourci dans une minute.';
  }
  if (current !== 'live') render();
}

// Distance de la montre : elle remplace celle du GPS du téléphone (la montre suit la course
// au poignet), jamais une distance tapée à la main. Celle du téléphone reste notée.
function attachMontre(h, m) {
  h.montre = m;
  if (!m.distKm || h.distanceSource === 'manuelle') return;
  if (h.distanceSource === 'gps' && h.distanceKm) h.distanceGpsKm = h.distanceKm;
  const d = mergeDistance(h.distanceGpsKm, h.gpsIncomplet, m.distKm);
  h.distanceKm = d.km;
  h.distanceSource = d.source;
  h.distanceEstimee = false;
  h.allureSecKm = h.elapsedSec ? Math.round(h.elapsedSec / d.km) : null;
}

async function refreshCardio() {
  if (!account.serverEnabled() || !account.session()) return;
  try {
    cardioUi.status = await account.cardioStatus();
    // Le réglage suit le serveur : un import activé depuis un autre téléphone s'applique ici.
    if (Boolean(load().settings.cardio) !== cardioUi.status.active) update((d) => { d.settings.cardio = cardioUi.status.active; });
  } catch {}
  if (current === 'profil') render();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if ('cardiolink' in ds) {
    if (cardioUi.status?.active && !confirm('Un nouveau lien remplace l’ancien : le Raccourci devra utiliser le nouveau. Continuer ?')) return;
    cardioUi.busy = true;
    account.cardioNewLink()
      .then((r) => {
        cardioUi.link = r.url;
        cardioUi.copied = false;
        cardioUi.message = null;
        cardioUi.status = { active: true };
        update((d) => { d.settings.cardio = true; });
      })
      .catch((err) => { cardioUi.message = err.message; })
      .finally(() => { cardioUi.busy = false; render(); });
  } else if ('cardiocopy' in ds) {
    const input = document.getElementById('cardio-link');
    const done = () => { cardioUi.copied = true; render(); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cardioUi.link).then(done, () => { input.select(); });
    else { input.select(); document.execCommand?.('copy'); done(); }
  } else if ('cardiooff' in ds) {
    if (!confirm('Désactiver l’import ? Le lien du Raccourci cessera de marcher. Le cardio déjà ajouté à tes séances reste.')) return;
    account.cardioDisable()
      .then(() => { cardioUi = { ...cardioUi, status: { active: false }, link: null }; update((d) => { d.settings.cardio = false; }); })
      .catch((err) => { cardioUi.message = err.message; })
      .finally(() => render());
  } else if ('cardiofetch' in ds) {
    fetchCardio({ force: true });
  }
});

// Lien d'invitation : ?invite=CODE ouvre directement la création de compte.
const inviteParam = new URLSearchParams(location.search).get('invite');
if (inviteParam && account.serverEnabled()) {
  history.replaceState(null, '', location.pathname);
  current = 'compte';
  account.inviteInfo(inviteParam)
    .then((info) => { accountUi.invite = { code: inviteParam, kind: info.kind }; accountUi.inviteFrom = info.from; })
    .catch((e) => { accountUi.error = e.message; })
    .finally(() => render());
}
refreshAccount();
// Muscu guidées notées avant le 3/11 après-midi : seule la date était gardée, sans heure, donc
// sans plage pour le cardio de la montre. Les horaires affichés au bilan la redonnent.
function fixGuidedTimes() {
  const re = /^(\d{2}):(\d{2}) → (\d{2}):(\d{2})$/;
  const todo = (h) => h.sport === 'muscu' && h.source === 'guidee' && String(h.date).length === 10 && re.test(h.horaires || '');
  if (!load().history.some(todo)) return;
  update((d) => {
    for (const h of d.history.filter(todo)) {
      const [, h1, m1, h2, m2] = h.horaires.match(re);
      h.endedAt = `${h.date}T${h2}:${m2}:00`;
      h.date = `${h.date}T${h1}:${m1}:00`;
    }
  });
}
fixGuidedTimes();
syncNow().then(() => fixGuidedTimes()).then(retryIA).then(() => fetchCardio());
// Retour dans l'app (après le Raccourci, par exemple) : cardio et conseils en attente.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || current === 'live') return;
  retryIA();
  fetchCardio({ force: current === 'bilan' });
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
render();
