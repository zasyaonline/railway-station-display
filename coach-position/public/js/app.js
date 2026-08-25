'use strict';

const CONFIG = window.COACH_CONFIG || {};
const API_BASE = CONFIG.API_BASE || '';
const REFRESH_MS = CONFIG.REFRESH_MS || 15000;
const LANG_MS = CONFIG.LANG_ROTATE_MS || 15000;
const SESSION_KEY = 'coach_session_id';
const BOGIE_DEFAULT = 25;
const WALK_SPEED_MPS = 0.65;

let sessionStopped = false;

let languages = ['en', 'te', 'hi'];
let langIndex = 0;
let lastPayload = null;
let typesDoc = { types: {} };
let stationLayout = null;
let stationsByNameMap = {};
let lastPickMinute = -1;

function $(id) { return document.getElementById(id); }
function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
const DEFAULT_STATION = 'BG';
const DEFAULT_DISPLAY = 'entrance-main';
function isLocalHost() {
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
}
function stationCode() {
  return (qs('station') || DEFAULT_STATION).trim().toUpperCase() || DEFAULT_STATION;
}
function displayId() {
  return (qs('display') || DEFAULT_DISPLAY).trim() || DEFAULT_DISPLAY;
}
function displayQuery() {
  return `station=${encodeURIComponent(stationCode())}&display=${encodeURIComponent(displayId())}`;
}
function publicPrefix() {
  if (location.pathname.startsWith('/coach')) return '/coach';
  return '';
}
function liveApiRoot() {
  if (location.pathname.startsWith('/coach') && !isLocalHost()) return null;
  if (API_BASE) return API_BASE;
  if (isLocalHost()) return '';
  return null;
}
function applyDisplay(payload, displaysDoc) {
  if (!payload) return payload;
  const wanted = displayId();
  const display =
    (displaysDoc?.displays || []).find((d) => d.id === wanted) ||
    (displaysDoc?.displays || [])[0] ||
    payload.display;
  if (display) {
    payload.display = {
      id: display.id,
      name: display.name,
      mode: display.mode,
      platformsShown: display.platformsShown || [],
      facing: display.youAreHere?.facing || 'engine_left',
      youAreHere: display.youAreHere || null
    };
  }
  return payload;
}
const THEME = String(
  qs('theme') ||
    (document.body.classList.contains('theme-premium')
      ? 'premium'
      : document.body.classList.contains('theme-chart')
        ? 'chart'
        : 'tv')
).toLowerCase();
if (THEME === 'chart') document.body.classList.add('theme-chart');
if (THEME === 'premium') document.body.classList.add('theme-premium');

function applyViewportMode() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.body.dataset.vh = h < 600 ? 'tiny' : h < 800 ? 'short' : 'full';
}
applyViewportMode();
window.addEventListener('resize', applyViewportMode);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', applyViewportMode);
}
function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s-${Date.now()}`;
  }
}
function clearSessionId() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
function newSessionId() {
  clearSessionId();
  return getSessionId();
}
function isSessionStoppedPayload(data) {
  return data && (data.error === 'session_stopped' || data.sessionStopped === true);
}
function timeToMinutes(timeStr) {
  if (!timeStr || timeStr === '--') return null;
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function clockMinutesUntil(timeStr, now = new Date()) {
  const event = timeToMinutes(timeStr);
  if (event == null) return null;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let diff = event - nowMins;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}
function liveMinutesUntil(train, hideAfter = 0) {
  const arr = clockMinutesUntil(eventTime(train, 'arr'));
  const dep = clockMinutesUntil(eventTime(train, 'dep'));
  if (dep != null && dep < 0 && -dep > hideAfter) return null;
  if (arr != null && arr > 0) return arr;
  if (dep != null && dep >= 0) return 0;
  if (arr != null && arr <= 0 && (dep == null || dep >= 0)) return 0;
  return null;
}
function currentLang() {
  return languages[langIndex] || 'en';
}
function t(key) {
  const pack = window.COACH_I18N || {};
  const dict = pack[currentLang()] || pack.en || {};
  const en = pack.en || {};
  return dict[key] || en[key] || key;
}
function locale() {
  const dict = (window.COACH_I18N && window.COACH_I18N[currentLang()]) || {};
  return dict.locale || 'en-IN';
}
function locStation(name) {
  return window.COACH_localizeStationName
    ? window.COACH_localizeStationName(name, currentLang(), stationsByNameMap)
    : (name || '—');
}
function locTrain(name) {
  return window.COACH_localizeTrainName
    ? window.COACH_localizeTrainName(name, currentLang())
    : (name || '—');
}
function locStatus(status) {
  return window.COACH_translateStatus
    ? window.COACH_translateStatus(status, currentLang())
    : (status || '—');
}

function eventTime(train, kind) {
  if (kind === 'arr') return train?.expectedArrival || train?.scheduledArrival;
  return train?.expectedDeparture || train?.scheduledDeparture;
}

function rowDeparted(row, now, hideAfter) {
  const dep = clockMinutesUntil(eventTime(row, 'dep'), now);
  const arr = clockMinutesUntil(eventTime(row, 'arr'), now);
  const status = String(row.status || '');
  const atPlatform = row.runningState === 'arrived' || /arriv/i.test(status);

  if (row.runningState === 'departed' || /depart/i.test(status)) {
    if (hideAfter > 0 && dep != null && -dep <= hideAfter) return false;
    return true;
  }
  if (atPlatform) {
    return dep != null && dep < 0 && -dep > hideAfter;
  }
  // Late / scheduled: only treat as gone once departure has passed beyond hideAfter
  if (dep != null && dep < 0 && -dep > hideAfter) return true;
  if (arr != null && dep == null && arr < 0 && -arr > hideAfter) return true;
  return false;
}

function cacheAgeMinutes(payload) {
  const ts = payload?.generatedAt || payload?.liveFetchedAt;
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms / 60000;
}

function isStaleCache(payload) {
  const age = cacheAgeMinutes(payload);
  return age != null && age > 10;
}

/** Station board: match PDS — trains in NTES lookahead window (+ brief past departures). */
function boardLookaheadMinutes(payload) {
  const hours = payload?.lookAheadHours;
  if (typeof hours === 'number' && hours > 0) return hours * 60;
  return 240;
}

function rowVisibleOnStationBoard(row, now, hideAfter, lookaheadMinutes) {
  if (row.runningState === 'cancelled' || /cancel/i.test(row.status || '')) return false;
  const arr = clockMinutesUntil(eventTime(row, 'arr'), now);
  const dep = clockMinutesUntil(eventTime(row, 'dep'), now);
  const events = [arr, dep].filter((x) => x != null);
  if (!events.length) return true;
  const minEvent = Math.min(...events);
  const maxEvent = Math.max(...events);
  const recentDepartGrace = Math.max(hideAfter, 20);
  if (minEvent <= lookaheadMinutes && maxEvent >= -recentDepartGrace) return true;
  return false;
}

function trainHasRake(t) {
  return Boolean(
    t?.compositionAvailable ||
    (Array.isArray(t?.coaches) && t.coaches.length) ||
    (Array.isArray(t?.coachCodes) && t.coachCodes.length)
  );
}

function pickLiveFocus(payload, now = new Date()) {
  const showBefore = payload.showBeforeMinutes ?? 10;
  const hideAfter = payload.hideAfterDepartMinutes ?? 0;
  const rows = payload.stationBoard || [];
  const rakes = payload.boardRakes || {};

  function asTrain(r) {
    const rake = rakes[String(r.trainNo)] || {};
    return Object.assign({}, rake, r, { trainNo: r.trainNo });
  }

  const inWindow = [];
  for (const r of rows) {
    const t = asTrain(r);
    if (rowDeparted(t, now, hideAfter)) continue;
    const arr = clockMinutesUntil(eventTime(t, 'arr'), now);
    const dep = clockMinutesUntil(eventTime(t, 'dep'), now);
    const atPlatform = t.runningState === 'arrived' || /arriv/i.test(t.status || '');
    if (atPlatform && (dep == null || dep >= 0)) {
      inWindow.push({ train: t, minutesUntil: 0, inWindow: true });
      continue;
    }
    const soonest = [arr, dep].filter((x) => x != null && x >= 0);
    const minPos = soonest.length ? Math.min(...soonest) : null;
    if (minPos != null && minPos <= showBefore) {
      inWindow.push({ train: t, minutesUntil: minPos, inWindow: true });
    }
  }
  inWindow.sort((a, b) => (a.minutesUntil ?? 999) - (b.minutesUntil ?? 999));
  if (inWindow[0]) return inWindow[0];

  let best = null;
  let bestWithRake = null;
  for (const r of rows) {
    const t = asTrain(r);
    if (rowDeparted(t, now, hideAfter)) continue;
    const arr = clockMinutesUntil(eventTime(t, 'arr'), now);
    const dep = clockMinutesUntil(eventTime(t, 'dep'), now);
    const m = [arr, dep].filter((x) => x != null && x >= 0);
    if (!m.length) continue;
    const minutesUntilEvent = Math.min(...m);
    const cand = { train: t, minutesUntil: minutesUntilEvent, inWindow: false };
    if (!best || minutesUntilEvent < best.minutesUntil) best = cand;
    if (trainHasRake(t) && (!bestWithRake || minutesUntilEvent < bestWithRake.minutesUntil)) {
      bestWithRake = cand;
    }
  }
  return bestWithRake || best;
}

function resolveClientPin(display, platform, coaches, bogie) {
  const cfg = display?.youAreHere;
  if (!cfg || !(coaches || []).length) {
    return { enabled: false, slotIndex: null, platform: String(platform), samePlatform: false };
  }
  const samePlatform = String(cfg.platform) === String(platform);
  const bogieM = bogie || BOGIE_DEFAULT;
  let slot =
    typeof cfg.slotIndex === 'number'
      ? cfg.slotIndex
      : Math.round((Number(cfg.metersFromEngineEnd) || 0) / bogieM);
  slot = Math.max(0, Math.min(coaches.length - 1, slot));
  return {
    enabled: samePlatform,
    slotIndex: samePlatform ? slot : null,
    platform: String(platform),
    configuredPlatform: String(cfg.platform || ''),
    samePlatform,
    facing: cfg.facing || 'engine_left',
    metersFromEngineEnd: cfg.metersFromEngineEnd
  };
}

function rakeFor(payload, trainNo) {
  const key = String(trainNo);
  const fromBoard = (payload.boardRakes || {})[key];
  if (fromBoard && (fromBoard.coaches || []).length) return fromBoard;
  if (payload.focus?.train && String(payload.focus.train.trainNo) === key) {
    return payload.focus;
  }
  return fromBoard || {};
}

function assembleFocus(payload, pick) {
  if (!pick || !pick.train) return null;
  const t = pick.train;
  const rake = rakeFor(payload, t.trainNo);
  const coaches = rake.coaches || [];
  const bogie = payload.bogieLengthMeters || BOGIE_DEFAULT;
  const youAreHere = resolveClientPin(payload.display, t.platform, coaches, bogie);
  return {
    platform: String(t.platform),
    inWindow: pick.inWindow !== false,
    train: {
      trainNo: t.trainNo,
      trainName: t.trainName || rake.trainName,
      platform: String(t.platform),
      from: t.from || rake.from,
      to: t.to || rake.to,
      expectedArrival: t.expectedArrival || rake.expectedArrival,
      expectedDeparture: t.expectedDeparture || rake.expectedDeparture,
      minutesUntil: pick.minutesUntil,
      status: t.status || rake.status,
      delay: t.delay ?? rake.delay ?? 0
    },
    heading: rake.heading,
    compositionAvailable: Boolean(rake.compositionAvailable && coaches.length),
    coaches,
    coachCount: rake.coachCount || coaches.length,
    divyangjanPositions: rake.divyangjanPositions || [],
    divyangjanCoaches: rake.divyangjanCoaches || [],
    youAreHere,
    featured: true
  };
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString(locale(), {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  $('clockDate').textContent = now.toLocaleDateString(locale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  $('langLabel').textContent = t('lang');
  document.documentElement.lang = currentLang();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (lastPayload && minute !== lastPickMinute) {
    lastPickMinute = minute;
    render(lastPayload);
  }
}

function coachAsset(typeId) {
  const id = typeId || 'unknown';
  if (THEME === 'chart') return `/img/chart/${id}.svg`;
  const types = (typesDoc && typesDoc.types) || {};
  const asset = (types[id] && types[id].asset) || `${id}.png`;
  return `/img/coaches/${asset}`;
}

function normStation(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function matchesSide(stationName, labels) {
  const n = normStation(stationName);
  if (!n || !Array.isArray(labels)) return false;
  return labels.some((label) => {
    const L = normStation(label);
    if (!L) return false;
    return n === L || n.includes(L) || L.includes(n);
  });
}

function resolveHeading(train, existing, layout) {
  if (existing && existing.direction && existing.direction !== 'unknown') {
    return existing;
  }
  const from = train?.from || null;
  const to = train?.to || null;
  const axis = layout?.screenAxis || {};
  const leftLabels = axis.leftToward || axis.leftLabels || [];
  const rightLabels = axis.rightToward || axis.rightLabels || [];

  let direction = 'unknown';
  if (matchesSide(to, rightLabels)) direction = 'right';
  else if (matchesSide(to, leftLabels)) direction = 'left';
  else if (matchesSide(from, leftLabels)) direction = 'right';
  else if (matchesSide(from, rightLabels)) direction = 'left';

  return {
    direction,
    toward: to || null,
    from: from || null,
    engineSide: direction === 'right' ? 'right' : 'left'
  };
}

function formatWalk(meters, seconds) {
  if (meters == null) return '';
  if (meters === 0) return t('here');
  return `${Math.round(meters)}${t('meters')}`;
}

function formatWalkTime(meters, seconds) {
  if (meters == null || meters === 0) return '';
  if (seconds < 60) return `${t('walk')} ${seconds} ${t('sec')}`;
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${t('walk')} ${mins} ${t('min')}`;
}

function ensureWalkMetrics(coaches, youAreHere, bogie) {
  const pin = youAreHere?.enabled && youAreHere.slotIndex != null ? youAreHere.slotIndex : null;
  const bogieM = bogie || BOGIE_DEFAULT;
  return (coaches || []).map((c) => {
    if (pin == null) return { ...c, walkMeters: null, walkSeconds: null };
    const slots = Math.abs((c.position != null ? c.position : c.seq - 1) - pin);
    const walkMeters = slots * bogieM;
    return { ...c, walkMeters, walkSeconds: Math.round(walkMeters / WALK_SPEED_MPS) };
  });
}

function coachTile(coach, pinSlot) {
  const pos = coach.position != null ? coach.position : coach.seq - 1;
  const aligned = pinSlot != null && pos === pinSlot;
  const typeId = coach.typeId || 'unknown';
  const typeMeta = (typesDoc.types && typesDoc.types[typeId]) || {};
  const lang = currentLang();
  const kind =
    (lang === 'te' && typeMeta.labelTe) ||
    (lang === 'hi' && typeMeta.labelHi) ||
    typeMeta.label ||
    typeId;
  const code = String(coach.label || coach.code || '');
  const showKind = THEME !== 'chart' && kind && kind.toUpperCase() !== code.toUpperCase();
  const shown = THEME === 'chart' ? pos + 1 : pos;
  const divClass = coach.divyangjan ? ' divyangjan' : '';
  return `
    <div class="coach ${typeId}${aligned ? ' pin-aligned' : ''}${divClass}" data-pos="${pos}">
      <span class="num" title="${t('coachNo')} ${shown}">${shown}</span>
      ${coach.divyangjan ? `<span class="divyang-badge" title="${t('divyangjan')}">♿</span>` : ''}
      <img class="coach-art" src="${coachAsset(typeId)}" alt="${esc(code)}" draggable="false">
      <span class="code">${esc(code)}</span>
      ${showKind ? `<span class="kind">${esc(kind)}</span>` : ''}
    </div>`;
}

function walkStripHtml(coaches, pinEnabled, pinDisplayIndex) {
  if (!pinEnabled || !coaches.length) return '';
  const cells = coaches.map((c, i) => {
    const dist = formatWalk(c.walkMeters, c.walkSeconds);
    const time = formatWalkTime(c.walkMeters, c.walkSeconds);
    const here = c.walkMeters === 0;
    let sideClass = '';
    if (!here && pinDisplayIndex != null) {
      if (i < pinDisplayIndex) sideClass = ' walk-side-left';
      else if (i > pinDisplayIndex) sideClass = ' walk-side-right';
    }
    return `
      <div class="walk-cell${here ? ' is-here' : ''}${sideClass}">
        <span class="walk-labels">
          <span class="walk-dist">${esc(dist)}</span>
          ${time ? `<span class="walk-time">${esc(time)}</span>` : ''}
        </span>
      </div>`;
  }).join('');
  return `<div class="walk-strip" aria-label="Walk distance">${cells}</div>`;
}

const AMENITY_ICON = {
  passenger: 'toilet.svg',
  accessibility: 'toilet-access.svg',
  waiting: 'waiting.svg',
  admin: 'office.svg',
  utility: 'water.svg',
  circulation: 'fob.svg',
  security: 'security.svg'
};

/** Layout amenity id → 3D building sprite (split from Platform_Ameneties_Icons.png). */
const AMENITY_BUILDING_IMG = {
  toilet: 'toilet-building.png',
  'toilet-pf2': 'toilet-building.png',
  'drinking-water': 'water-building.png',
  rpf: 'rpf-building.png',
  'station-master': 'station-master-building.png',
  'upper-class-waiting': 'waiting-room-building.png'
};

const AMENITY_I18N = {
  toilet: 'amenityToilet',
  'toilet-divyang': 'amenityToiletAccess',
  'toilet-pf2': 'amenityToilet',
  'upper-class-waiting': 'amenityWaiting',
  'station-master': 'amenityOffice',
  'drinking-water': 'amenityWater',
  'fob-pf1': 'amenityFob',
  'fob-pf2': 'amenityFob',
  rpf: 'amenitySecurity'
};

function platformMarkerSpan(layout, platformId) {
  const pf = (layout?.platforms || []).find((p) => String(p.id) === String(platformId));
  if (!pf) return { sec: 1, kaz: 26 };
  return {
    sec: pf.secunderabadMarker ?? 1,
    kaz: pf.kazipetMarker ?? 26
  };
}

function amenityMarkerMid(amenity) {
  const from = amenity.markerFrom;
  const to = amenity.markerTo ?? from;
  if (from == null && to == null) return null;
  if (from == null) return Number(to);
  if (to == null) return Number(from);
  return (Number(from) + Number(to)) / 2;
}

function markerToLeftPct(marker, sec, kaz) {
  if (marker == null || Number.isNaN(marker)) return null;
  const span = Math.abs(kaz - sec);
  if (!span) return 50;
  if (sec < kaz) return ((marker - sec) / span) * 100;
  return ((sec - marker) / span) * 100;
}

function pinPlatformMarker(layout, displayId) {
  const mount = (layout?.amenities || []).find(
    (a) => a.displayId === displayId || a.id === 'display-tv'
  );
  const mid = mount ? amenityMarkerMid(mount) : null;
  return mid != null ? mid : 8.5;
}

function amenityMarkerForRake(amenity, engineOnRight) {
  if (amenity.category === 'circulation') {
    if (engineOnRight && amenity.markerFrom != null) return Number(amenity.markerFrom);
    if (!engineOnRight && amenity.markerTo != null) return Number(amenity.markerTo);
  }
  return amenityMarkerMid(amenity);
}

/** Map survey marker to % along the coach rake (aligned with pin + engine side). */
function amenityPctOnRake(markerMid, layout, platformId, coachCount, engineOnRight, youAreHere) {
  const pinMarker = pinPlatformMarker(layout, displayId());
  const pinSlot = youAreHere.slotIndex;
  const engineM = engineOnRight ? pinMarker + pinSlot : pinMarker - pinSlot;
  let compSlot = engineOnRight ? engineM - markerMid : markerMid - engineM;
  compSlot = Math.round(compSlot);
  compSlot = Math.max(0, Math.min(coachCount - 1, compSlot));
  const displaySlot = engineOnRight ? coachCount - 1 - compSlot : compSlot;
  return ((displaySlot + 0.5) / coachCount) * 100;
}

function amenityPositionPct(markerMid, layout, platformId, coachCount, engineOnRight, youAreHere, pinAligned, amenity) {
  const marker = amenity && pinAligned ? amenityMarkerForRake(amenity, engineOnRight) : markerMid;
  if (pinAligned && coachCount > 0 && youAreHere?.slotIndex != null) {
    return amenityPctOnRake(marker, layout, platformId, coachCount, engineOnRight, youAreHere);
  }
  const { sec, kaz } = platformMarkerSpan(layout, platformId);
  return markerToLeftPct(markerMid, sec, kaz);
}

function amenityLabel(amenity) {
  const key = AMENITY_I18N[amenity.id];
  if (key && t(key)) return t(key);
  return amenity.label || amenity.id || '';
}

function amenityIconSrc(amenity) {
  const building = AMENITY_BUILDING_IMG[amenity.id];
  if (building) return `/img/amenities/${building}`;
  const file = AMENITY_ICON[amenity.category] || 'facility.svg';
  return `/img/amenities/${file}`;
}

function amenitiesForPlatform(layout, platformId) {
  if (!layout?.amenities?.length) return [];
  return layout.amenities
    .filter((a) => {
      if (String(a.platform) !== String(platformId)) return false;
      if (a.category === 'display' || a.id === 'display-tv') return false;
      if (a.id === 'toilet-divyang') return false;
      if (a.category === 'circulation') return false;
      return amenityMarkerMid(a) != null;
    })
    .sort((a, b) => amenityMarkerMid(a) - amenityMarkerMid(b));
}

function toiletHasAccessibility(layout, platformId, toiletItem) {
  const divyang = (layout?.amenities || []).find(
    (a) =>
      (a.id === 'toilet-divyang' || a.category === 'accessibility') &&
      String(a.platform) === String(platformId)
  );
  if (!divyang || !toiletItem) return false;
  const tMid = amenityMarkerMid(toiletItem);
  const dMid = amenityMarkerMid(divyang);
  if (tMid == null || dMid == null) return false;
  return Math.abs(tMid - dMid) < 2.5;
}

function displaySidePlatform(youAreHere) {
  return String(youAreHere?.configuredPlatform || '1');
}

function displayPinSlot(youAreHere, bogie) {
  if (youAreHere?.slotIndex != null) return youAreHere.slotIndex;
  if (typeof youAreHere?.metersFromEngineEnd === 'number') {
    return Math.round(youAreHere.metersFromEngineEnd / (bogie || BOGIE_DEFAULT));
  }
  return null;
}

function fobOnDisplaySide(layout, displayPlatform) {
  return (layout?.amenities || []).find(
    (a) => a.category === 'circulation' && String(a.platform) === String(displayPlatform)
  );
}

function fobLinkedTrainPlatforms(layout, displayFob) {
  if (!displayFob) return [];
  if (Array.isArray(displayFob.linksToPlatforms) && displayFob.linksToPlatforms.length) {
    return displayFob.linksToPlatforms.map(String);
  }
  if (displayFob.linksTo) {
    const dest = (layout?.amenities || []).find((a) => a.id === displayFob.linksTo);
    if (dest?.platform) return [String(dest.platform)];
  }
  return [];
}

function crossPlatformFobContext(youAreHere, trainPlatform, layout) {
  if (!youAreHere || youAreHere.samePlatform !== false) return null;
  const tvPf = displaySidePlatform(youAreHere);
  const entry = fobOnDisplaySide(layout, tvPf);
  if (!entry) return null;
  const linked = fobLinkedTrainPlatforms(layout, entry);
  if (!linked.includes(String(trainPlatform))) return null;
  const walkMeters = fobWalkMeters(layout, tvPf);
  return {
    tvPlatform: tvPf,
    entry,
    walkMeters,
    walkSeconds: Math.round(walkMeters / WALK_SPEED_MPS)
  };
}

function fobAmenity(layout, platformId) {
  return (layout?.amenities || []).find(
    (a) => a.category === 'circulation' && String(a.platform) === String(platformId)
  );
}

function fobWalkMeters(layout, platformId) {
  const fob = fobAmenity(layout, platformId) || fobOnDisplaySide(layout, platformId);
  return Number(fob?.walkMetersFromDisplayPin) > 0
    ? Number(fob.walkMetersFromDisplayPin)
    : 178;
}

function shouldShowFobOverlay(trainPlatform, layout, youAreHere) {
  const tvPf = displaySidePlatform(youAreHere);
  if (String(trainPlatform) === String(tvPf)) {
    return Boolean(fobOnDisplaySide(layout, tvPf));
  }
  return crossPlatformFobContext(youAreHere, trainPlatform, layout) != null;
}

function fobAnchorPct(youAreHere, coachCount, engineOnRight, bogie, walkMeters) {
  const bogieM = bogie || BOGIE_DEFAULT;
  let pinSlot = youAreHere?.slotIndex;
  if (pinSlot == null && typeof youAreHere?.metersFromEngineEnd === 'number') {
    pinSlot = Math.round(youAreHere.metersFromEngineEnd / bogieM);
  }
  if (pinSlot == null) pinSlot = 7;
  if (!coachCount) return 50;
  const offset = Math.round(walkMeters / bogieM);
  let targetSlot = pinSlot + offset;
  targetSlot = Math.max(0, Math.min(coachCount - 1, targetSlot));
  const displaySlot = engineOnRight ? coachCount - 1 - targetSlot : targetSlot;
  return ((displaySlot + 0.5) / coachCount) * 100;
}

function fobBridgeOverlayHtml(
  trainPlatform,
  layout,
  youAreHere,
  coachCount,
  engineOnRight,
  bogie,
  pinAligned,
  layoutPin
) {
  if (!shouldShowFobOverlay(trainPlatform, layout, youAreHere)) return '';
  const label = t('amenityFob');
  const tvPf = displaySidePlatform(youAreHere);
  const fob = fobOnDisplaySide(layout, tvPf);
  const crossPlatform = crossPlatformFobContext(youAreHere, trainPlatform, layout) != null;
  let anchor;

  /* Cross-platform: FOB stays at the fixed PF1 survey marker (same as other PF1 amenities). */
  if (crossPlatform && pinAligned && layoutPin?.slotIndex != null && fob && coachCount) {
    const marker = amenityMarkerForRake(fob, engineOnRight);
    anchor = amenityPctOnRake(marker, layout, tvPf, coachCount, engineOnRight, layoutPin);
  } else {
    const walkM = fobWalkMeters(layout, tvPf);
    const pinForAnchor = {
      slotIndex: displayPinSlot(youAreHere, bogie),
      metersFromEngineEnd: youAreHere?.metersFromEngineEnd
    };
    if (coachCount && (pinForAnchor.slotIndex != null || pinForAnchor.metersFromEngineEnd != null)) {
      anchor = fobAnchorPct(pinForAnchor, coachCount, engineOnRight, bogie, walkM);
    } else if (fob) {
      const mid = amenityMarkerMid(fob);
      const { sec, kaz } = platformMarkerSpan(layout, tvPf);
      anchor = markerToLeftPct(mid, sec, kaz) ?? 50;
    } else {
      anchor = 50;
    }
  }

  return `
    <div class="fob-bridge-overlay" style="--fob-anchor:${anchor.toFixed(2)}%" role="img" aria-label="${esc(label)}">
      <img class="fob-bridge-art" src="/img/amenities/fob-transparent.png" alt="" draggable="false">
    </div>`;
}

function amenitiesStripHtml(platformId, layout, youAreHere, coachCount, engineOnRight, pinAligned) {
  const items = amenitiesForPlatform(layout, platformId);
  if (!items.length) return '';
  const tvPlatform = displaySidePlatform(youAreHere);
  const layer = String(platformId) === String(tvPlatform) ? 'building' : 'track';
  const stackBuckets = new Map();
  const pins = items
    .map((a) => {
      const mid = amenityMarkerMid(a);
      const pct = amenityPositionPct(
        mid,
        layout,
        platformId,
        coachCount,
        engineOnRight,
        youAreHere,
        pinAligned,
        a
      );
      if (pct == null) return '';
      const bucket = Math.round(pct / 3);
      const stack = stackBuckets.get(bucket) || 0;
      stackBuckets.set(bucket, stack + 1);
      const stackClass = stack > 0 ? ` amenity-stack-${Math.min(stack, 2)}` : '';
      const label = amenityLabel(a);
      const accessBadge =
        THEME === 'premium' &&
        (a.id === 'toilet' || a.id === 'toilet-pf2' || a.category === 'passenger') &&
        toiletHasAccessibility(layout, platformId, a)
          ? `<span class="amenity-access-badge" title="${esc(t('amenityToiletAccess'))}">♿</span>`
          : '';
      const iconBlock = accessBadge
        ? `<span class="amenity-icon-wrap"><img class="amenity-icon" src="${esc(amenityIconSrc(a))}" alt="" draggable="false">${accessBadge}</span>`
        : `<img class="amenity-icon" src="${esc(amenityIconSrc(a))}" alt="" draggable="false">`;
      return `
        <div class="amenity-pin${stackClass}" style="left:${pct}%" title="${esc(label)}">
          ${iconBlock}
          <span class="amenity-label">${esc(label)}</span>
        </div>`;
    })
    .join('');
  return `
    <div class="amenity-strip amenity-${layer}" aria-label="${esc(t('stationFacilities'))}">
      <div class="amenity-axis" aria-hidden="true"></div>
      ${pins}
    </div>`;
}

function crossPlatformNoteHtml(youAreHere, trainPlatform, layout) {
  const ctx = crossPlatformFobContext(youAreHere, trainPlatform, layout);
  if (!ctx) return '';
  const fobName = amenityLabel(ctx.entry);
  const dist = `${Math.round(ctx.walkMeters)}${t('meters')}`;
  const time = formatWalkTime(ctx.walkMeters, ctx.walkSeconds);
  if (THEME === 'premium') {
    const walkLine = t('wayfindWalkSummary')
      .replace('{dist}', esc(dist))
      .replace('{time}', esc(time));
    const detail = t('wayfindFobDetail')
      .replace('{fob}', esc(fobName))
      .replace('{n}', esc(String(trainPlatform)));
    return `
      <aside class="wayfind-panel" role="status">
        <div class="wayfind-pf"><small>${esc(t('platform'))}</small>${esc(String(trainPlatform))}</div>
        <div class="wayfind-copy">
          <div class="wayfind-walk">${walkLine}</div>
          <div class="wayfind-detail">${detail}</div>
        </div>
      </aside>`;
  }
  const line1 = t('trainOnPlatform').replace('{n}', esc(String(trainPlatform)));
  const line2 = t('useFobToReachWithWalk')
    .replace('{fob}', esc(fobName))
    .replace('{n}', esc(String(trainPlatform)))
    .replace('{dist}', esc(dist))
    .replace('{time}', esc(time));
  return `<p class="pin-note pin-note-cross">${line1}<br>${line2}</p>`;
}

function platformHtml(youAreHere, coaches, engineOnRight, platformId, layout, walkPinSlot, trainPlatform, bogie) {
  const count = coaches.length;
  const pinEnabled = walkPinSlot != null && count;
  let pinDisplayIndex = null;
  let pin = '';
  if (pinEnabled) {
    pinDisplayIndex = engineOnRight
      ? count - 1 - walkPinSlot
      : walkPinSlot;
    const pct = ((pinDisplayIndex + 0.5) / count) * 100;
    pin = `
      <div class="you-pin" style="left:${pct}%">
        <img class="traveler" src="/img/you-are-here.png" alt="" draggable="false">
        <div class="pin-cluster">
          <span class="label">${t('youAreHere')}</span>
        </div>
      </div>`;
  }

  const ticks = coaches.map(() => '<span class="bay-tick"></span>').join('');
  const tvPlatform = displaySidePlatform(youAreHere);
  const amenitiesOnBuilding = String(platformId) === String(tvPlatform);
  const pinAligned = pinEnabled && amenitiesOnBuilding;
  const layoutPin = walkPinSlot != null
    ? {
        ...youAreHere,
        slotIndex: walkPinSlot,
        enabled: true,
        configuredPlatform: tvPlatform
      }
    : youAreHere;
  const amenitiesHtml = amenitiesStripHtml(
    platformId,
    layout,
    layoutPin,
    count,
    engineOnRight,
    pinAligned
  );
  const trackAmenities = amenitiesOnBuilding ? '' : amenitiesHtml;
  const buildingAmenities = amenitiesOnBuilding ? amenitiesHtml : '';
  const fobHtml = fobBridgeOverlayHtml(
    trainPlatform != null ? trainPlatform : platformId,
    layout,
    youAreHere,
    count,
    engineOnRight,
    bogie,
    pinAligned,
    layoutPin
  );

  return `
    <div class="platform" style="--coach-count:${count}">
      <div class="platform-coping" aria-hidden="true"></div>
      <div class="platform-deck">
        <div class="platform-grain" aria-hidden="true"></div>
        <div class="yellow-line" aria-hidden="true"></div>
        ${fobHtml}
        ${trackAmenities}
        <div class="bay-ticks" aria-hidden="true">${ticks}</div>
        <div class="platform-wayfind">
          ${walkStripHtml(coaches, pinEnabled, pinDisplayIndex)}
          <div class="pin-row${pinEnabled ? '' : ' pin-row-empty'}">${pin}</div>
          ${buildingAmenities}
        </div>
      </div>
    </div>`;
}

function divyangjanBanner(p) {
  const list = p.divyangjanCoaches || [];
  if (!list.length) {
    return `<div class="divyangjan-banner muted" role="status">♿ ${esc(t('divyangjanNone'))}</div>`;
  }
  if (THEME === 'chart') {
    const bits = list
      .map((c) => {
        const n = (c.position != null ? c.position : 0) + 1;
        return `${esc(t('divyangjanAtPos').replace('{n}', String(n)))} (${esc(c.code)})`;
      })
      .join(' · ');
    return `<div class="divyangjan-banner" role="status">♿ ${bits}</div>`;
  }
  const bits = list
    .map((c) => `${esc(t('divyangjanAt'))} <strong>${c.position}</strong> (${esc(c.code)})`)
    .join(' · ');
  return `<div class="divyangjan-banner" role="status">♿ ${bits}</div>`;
}

function headingBanner(heading) {
  const destRaw = heading?.toward;
  if (!destRaw) return '';
  const dest = locStation(destRaw);
  const dir = heading.direction === 'left' ? 'left' : heading.direction === 'right' ? 'right' : 'unknown';
  const lang = currentLang();
  const towardBits =
    lang === 'en'
      ? `<span class="towards-label">${esc(t('towards'))}</span><strong class="dest">${esc(dest)}</strong>`
      : `<strong class="dest">${esc(dest)}</strong><span class="towards-label">${esc(t('towards'))}</span>`;

  if (dir === 'left') {
    return `
      <div class="heading-banner heading-left" aria-label="${esc(t('towards'))} ${esc(dest)}">
        <span class="motion" aria-hidden="true">◀◀◀</span>
        ${towardBits}
        <span class="motion trail" aria-hidden="true">◀◀◀</span>
      </div>`;
  }
  if (dir === 'right') {
    return `
      <div class="heading-banner heading-right" aria-label="${esc(t('towards'))} ${esc(dest)}">
        <span class="motion trail" aria-hidden="true">▶▶▶</span>
        ${towardBits}
        <span class="motion" aria-hidden="true">▶▶▶</span>
      </div>`;
  }
  return `<div class="heading-banner heading-unknown">${towardBits}</div>`;
}

function resolveFocusForRender(payload) {
  const pick = pickLiveFocus(payload);
  if (pick) return assembleFocus(payload, pick);

  const serverFocus = payload?.focus;
  if (serverFocus?.train && (serverFocus.coaches?.length || serverFocus.compositionAvailable)) {
  const hideAfter = payload.hideAfterDepartMinutes ?? 0;
    const now = new Date();
    if (!rowDeparted(serverFocus.train, now, hideAfter)) {
      return serverFocus;
    }
  }

  if (isStaleCache(payload)) {
    const relaxed = { ...payload, showBeforeMinutes: boardLookaheadMinutes(payload) };
    const latePick = pickLiveFocus(relaxed);
    if (latePick) return assembleFocus(payload, latePick);
  }

  return null;
}

function renderStationBoard(rows, focusTrainNo) {
  if (!rows || !rows.length) return '';
  const hideAfter = lastPayload?.hideAfterDepartMinutes ?? 0;
  const lookahead = boardLookaheadMinutes(lastPayload || {});
  const now = new Date();
  const visible = rows
    .filter((r) => rowVisibleOnStationBoard(r, now, hideAfter, lookahead))
    .slice(0, 12);
  if (!visible.length) return '';
  const body = visible.map((r) => {
    const active = focusTrainNo && String(r.trainNo) === String(focusTrainNo);
    const delay =
      r.delay > 0
        ? `<span class="delay">${esc(r.delay)} ${t('min')}</span>`
        : `<span class="ontime">—</span>`;
    return `
      <tr class="${active ? 'is-focus' : ''}">
        <td class="mono">${esc(r.trainNo)}</td>
        <td>${esc(locTrain(r.trainName))}</td>
        <td class="pf">${esc(r.platform)}</td>
        <td class="mono">${esc(r.expectedArrival || '—')}</td>
        <td class="mono">${esc(r.expectedDeparture || '—')}</td>
        <td>${delay}</td>
        <td>${esc(locStatus(r.status || '—'))}</td>
      </tr>`;
  }).join('');

  return `
    <section class="station-board-panel">
      <div class="panel-title">${t('stationBoard')}</div>
      <table class="station-board">
        <thead>
          <tr>
            <th>${t('trainNo')}</th>
            <th>${t('trainName')}</th>
            <th>${t('pf')}</th>
            <th>${t('arr')}</th>
            <th>${t('dep')}</th>
            <th>${t('delay')}</th>
            <th>${t('status')}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderFocus(p, bogie, shouldArrive) {
  if (!p) {
    return `<section class="focus-panel"><div class="unavailable">${t('idle')}</div></section>`;
  }

  const train = p.train;
  const heading = resolveHeading(train, p.heading, stationLayout);
  const engineOnRight = heading.engineSide === 'right';
  const hideAfter = lastPayload?.hideAfterDepartMinutes ?? 0;
  const mins = liveMinutesUntil(train, hideAfter);
  const eta =
    mins == null
      ? ''
      : mins <= 0
        ? t('now')
        : `${mins} ${t('min')}`;
  const kicker = p.inWindow ? t('nextArrival') : t('next');

  const header = `
    <div class="focus-header">
      <div class="focus-kicker">${kicker}</div>
      <div class="focus-main">
        <div class="focus-id">
          <strong>${esc(train.trainNo)}</strong>
          <span>${esc(locTrain(train.trainName || ''))}</span>
        </div>
        <div class="focus-meta">
          <span class="pill">${t('platform')} ${esc(p.platform)}</span>
          ${eta ? `<span class="eta">${esc(eta)}</span>` : ''}
        </div>
      </div>
    </div>`;

  if (!p.compositionAvailable || !(p.coaches || []).length) {
    return `<section class="focus-panel">${header}<div class="unavailable">${t('unavailable')}</div></section>`;
  }

  const fobCtx = crossPlatformFobContext(p.youAreHere, p.platform, stationLayout);
  const tvPlatform = fobCtx ? fobCtx.tvPlatform : displaySidePlatform(p.youAreHere);
  const pinSlot = p.youAreHere?.enabled ? p.youAreHere.slotIndex : null;
  const walkPinSlot = pinSlot != null ? pinSlot : (fobCtx ? displayPinSlot(p.youAreHere, bogie) : null);
  const deckPlatform = fobCtx ? fobCtx.tvPlatform : p.platform;
  const deckPin =
    walkPinSlot != null
      ? {
          ...p.youAreHere,
          slotIndex: walkPinSlot,
          enabled: true,
          configuredPlatform: tvPlatform,
          samePlatform: p.youAreHere?.samePlatform
        }
      : p.youAreHere;
  const highlightPin = pinSlot != null ? pinSlot : walkPinSlot;
  const withWalk = ensureWalkMetrics(
    p.coaches,
    walkPinSlot != null ? { enabled: true, slotIndex: walkPinSlot } : { enabled: false, slotIndex: null },
    bogie
  );
  const coaches = engineOnRight ? [...withWalk].reverse() : withWalk;
  const tiles = coaches.map((c) => coachTile(c, highlightPin)).join('');
  const arriveClass = shouldArrive ? 'is-arriving' : '';
  const rakeClass = `rake ${engineOnRight ? 'engine-right' : 'engine-left'} ${arriveClass}`.trim();
  const count = p.coaches.length;
  const pinNote = crossPlatformNoteHtml(p.youAreHere, p.platform, stationLayout);

  return `
    <section class="focus-panel">
      ${header}
      ${headingBanner(heading)}
      ${divyangjanBanner(p)}
      <div class="rake-wrap">
        <div class="rake-stage ${arriveClass}" style="--coach-count:${count}">
          <div class="${rakeClass}">${tiles}</div>
          <div class="track" aria-hidden="true">
            <div class="ballast"></div>
            <div class="sleepers"></div>
            <div class="rail rail-far"></div>
            <div class="rail rail-near"></div>
            <div class="rail-glow"></div>
          </div>
          ${platformHtml(
            deckPin,
            coaches,
            engineOnRight,
            deckPlatform,
            stationLayout,
            walkPinSlot,
            p.platform,
            bogie
          )}
        </div>
        ${pinNote}
      </div>
    </section>`;
}

function render(payload) {
  lastPayload = payload;
  if (Array.isArray(payload.languages) && payload.languages.length) {
    languages = payload.languages;
    if (langIndex >= languages.length) langIndex = 0;
  }

  const title = locStation(payload.stationName || payload.stationCode || 'Station');
  if (THEME === 'chart') {
    $('stationTitle').textContent = `${t('coachPosition')} | ${String(payload.stationCode || title).toUpperCase()}`;
  } else if (THEME === 'premium') {
    $('stationTitle').textContent = String(payload.stationCode || title).toUpperCase();
  } else {
    $('stationTitle').textContent = String(title).toUpperCase();
  }
  document.title = `${title} — Coach Position`;
  document.documentElement.lang = currentLang();
  $('displayName').textContent = payload.display?.name
    ? `${payload.display.name} · ${payload.display.mode}`
    : '';
  const adminLink = document.querySelector('.admin-link');
  if (adminLink) {
    adminLink.textContent = t('admin');
    if (publicPrefix()) adminLink.href = '/admin';
  }
  const q = displayQuery();
  const prefix = publicPrefix();
  const linkCurrent = $('linkCurrentTv');
  const linkPremium = $('linkPremiumTv');
  const linkChart = $('linkChartView');
  if (linkCurrent) {
    linkCurrent.href = `${prefix}/?${q}`;
    linkCurrent.textContent = t('currentTvView');
    linkCurrent.hidden = THEME === 'tv';
  }
  if (linkPremium) {
    linkPremium.href = `${prefix}/premium.html?${q}`;
    linkPremium.textContent = t('premiumView');
    linkPremium.hidden = THEME === 'premium';
  }
  if (linkChart) {
    linkChart.href = `${prefix}/chart.html?${q}`;
    linkChart.textContent = t('chartView');
    linkChart.hidden = THEME === 'chart';
  }
  /* Legacy single themeLink (older HTML) */
  const themeLink = $('themeLink');
  if (themeLink && !linkCurrent && !linkPremium && !linkChart) {
    if (THEME === 'premium') {
      themeLink.href = `/?${q}`;
      themeLink.textContent = t('currentTvView');
    } else if (THEME === 'chart') {
      themeLink.href = `/?${q}`;
      themeLink.textContent = t('tvView');
    } else {
      themeLink.href = `/premium.html?${q}`;
      themeLink.textContent = t('premiumView');
    }
  }

  const focus = resolveFocusForRender(payload);
  lastPickMinute = new Date().getHours() * 60 + new Date().getMinutes();

  $('footerMeta').textContent = `${payload.stationCode || ''} · ${payload.dataSource === 'ntes-live' ? t('live') : (payload.dataSource || 'cache')} · display ${payload.display?.id || '—'}`;
  const cacheAge = cacheAgeMinutes(payload);
  if (cacheAge != null && cacheAge > 10) {
    $('footerMeta').textContent += ` · cache ${Math.round(cacheAge)}m old`;
  }
  $('footerWindow').textContent = t('footerWindow')
    .replace('{before}', String(payload.showBeforeMinutes ?? 10))
    .replace('{bogie}', String(payload.bogieLengthMeters ?? 25))
    .replace('{coaches}', String(focus?.coachCount || '—'));
  const focusKey = focus?.train?.trainNo ? `${focus.train.trainNo}@${focus.platform}` : '';
  const shouldArrive = Boolean(focusKey && focusKey !== window.__coachFocusKey);
  if (focusKey) window.__coachFocusKey = focusKey;

  const board = $('board');
  board.innerHTML = `
    ${renderStationBoard(payload.stationBoard || [], focus?.train?.trainNo)}
    ${renderFocus(focus, payload.bogieLengthMeters, shouldArrive)}
  `;
  board.querySelectorAll('.rake.is-arriving').forEach((el) => {
    el.addEventListener('animationend', () => {
      el.classList.remove('is-arriving');
      el.closest('.rake-stage')?.classList.remove('is-arriving');
    }, { once: true });
  });
}

async function loadTypes() {
  const apiRoot = liveApiRoot();
  if (apiRoot !== null) {
    try {
      const res = await fetch(`${apiRoot}/api/coach-types`);
      if (res.ok) {
        typesDoc = await res.json();
        return;
      }
    } catch { /* fall through */ }
  }
  try {
    const res = await fetch('/data/coach_types.json', { cache: 'no-store' });
    if (res.ok) typesDoc = await res.json();
  } catch { /* ignore */ }
}

async function loadStations() {
  try {
    const res = await fetch('/data/stations.json', { cache: 'no-store' });
    if (res.ok) {
      const master = await res.json();
      stationsByNameMap = window.COACH_stationsByName ? window.COACH_stationsByName(master) : {};
    }
  } catch { /* ignore */ }
}

async function loadLayout() {
  const urls = [
    `/data/stations/${stationCode()}/layout.json`,
    '/data/station_layout.json'
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        stationLayout = await res.json();
        return;
      }
    } catch { /* next */ }
  }
}

let displaysDocCache = null;
async function loadDisplaysDoc() {
  const code = stationCode();
  const urls = [
    `/data/stations/${code}/displays.json`,
    code === DEFAULT_STATION ? '/data/coach_displays.json' : null
  ].filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/json')) continue;
      displaysDocCache = await res.json();
      return displaysDocCache;
    } catch { /* next */ }
  }
  return displaysDocCache;
}

function showSessionStopped() {
  sessionStopped = true;
  $('board').innerHTML = `
    <div class="idle session-stopped">
      ${esc(t('sessionStopped'))}
      <button type="button" id="btnReconnect" class="reconnect">${esc(t('reconnect'))}</button>
    </div>`;
  const btn = $('btnReconnect');
  if (btn) btn.addEventListener('click', reconnectSession);
}

function reconnectSession() {
  sessionStopped = false;
  newSessionId();
  $('board').innerHTML = `<p class="loading">${esc(t('loading'))}</p>`;
  loadBoard();
}

async function loadBoard() {
  if (sessionStopped) return;
  const display = displayId();
  const station = stationCode();
  const sessionId = getSessionId();
  const displaysDoc = await loadDisplaysDoc();

  const apiRoot = liveApiRoot();
  if (apiRoot !== null) {
    try {
      const res = await fetch(
        `${apiRoot}/api/coach-board?station=${encodeURIComponent(station)}&display=${encodeURIComponent(display)}&sessionId=${encodeURIComponent(sessionId)}`,
        {
          cache: 'no-store',
          headers: { 'X-Session-Id': sessionId, Accept: 'application/json' }
        }
      );
      const data = await res.json().catch(() => null);
      if (isSessionStoppedPayload(data) || (res.status === 409 && isSessionStoppedPayload(data))) {
        clearSessionId();
        showSessionStopped();
        return;
      }
      if (res.ok && data && (data.platforms || data.focus || data.stationBoard)) {
        render(applyDisplay(data, displaysDoc));
        return;
      }
    } catch {
      /* fall through to static cache */
    }
  }

  const urls = [
    `/data/stations/${station}/board.json`,
    station === DEFAULT_STATION ? '/data/coach_board_cache.json' : null
  ].filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) continue;
      const data = await res.json();
      if (data.platforms || data.focus || data.stationBoard) {
        render(applyDisplay(data, displaysDoc));
        return;
      }
    } catch {
      /* next */
    }
  }
  $('board').innerHTML = `<div class="idle">Unable to load: no board cache for ${esc(station)}</div>`;
}

if ($('bootLoading')) $('bootLoading').textContent = t('loading');
updateClock();
setInterval(updateClock, 1000);
setInterval(() => {
  if (sessionStopped) return;
  langIndex = (langIndex + 1) % languages.length;
  if (lastPayload) render(lastPayload);
  else updateClock();
}, LANG_MS);

Promise.all([loadTypes(), loadLayout(), loadStations(), loadDisplaysDoc()]).then(loadBoard);
setInterval(loadBoard, REFRESH_MS);
