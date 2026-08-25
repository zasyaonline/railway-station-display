'use strict';

/**
 * Railway PDS — display controller
 * Polls /api/trains, pages 6 rows, rotates EN/TE/HI for the full board.
 */

const CONFIG = window.PDS_CONFIG || {};
const API_BASE = CONFIG.API_BASE || '';
const REFRESH_MS_DEFAULT = CONFIG.REFRESH_MS || 30_000;
const SESSION_KEY = 'pds_session_id';

let refreshTimer = null;
let rotateTimer = null;
let refreshIntervalMs = REFRESH_MS_DEFAULT;
let refreshEnabled = true;
let sessionStopped = false;

let allTrains = [];
let pageIndex = 0;
let pageSize = 6;
let pageIntervalSeconds = 10;
let languageRotateSeconds = 10;
let languages = ['en', 'te', 'hi'];
let langIndex = 0;
let stationNames = { en: null, te: null, hi: null };
let stationsByNameMap = {};
let lastMeta = {};
let lastUpdatedIso = null;

function $(id) {
  return document.getElementById(id);
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
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function newSessionId() {
  clearSessionId();
  return getSessionId();
}

function currentLang() {
  return languages[langIndex] || 'en';
}

function t(key) {
  const dict = (window.PDS_I18N && window.PDS_I18N[currentLang()]) || window.PDS_I18N.en;
  const en = window.PDS_I18N.en;
  return (dict && dict[key]) || (en && en[key]) || key;
}

function currentLocale() {
  const dict = window.PDS_I18N[currentLang()] || window.PDS_I18N.en;
  return dict.locale || 'en-IN';
}

function trainsUrl() {
  return `${API_BASE}/api/trains?sessionId=${encodeURIComponent(getSessionId())}`;
}

function isSessionStoppedPayload(data) {
  return data && (data.error === 'session_stopped' || data.sessionStopped === true);
}

function updateClock() {
  const now = new Date();
  const locale = currentLocale();
  $('clock').textContent = now.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  $('clockDate').textContent = now.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function getStatusClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('cancel')) return 'status-cancelled';
  if (s.includes('arriv')) return 'status-arrived';
  if (s.includes('depart')) return 'status-departed';
  if (s.includes('late') || s.includes('delay')) return 'status-delayed';
  return 'status-on-time';
}

function formatTimeCell(expected, scheduled) {
  if (!expected && !scheduled) return '—';
  if (!expected || expected === scheduled) {
    return `<span class="time-expected">${expected || scheduled || '—'}</span>`;
  }
  return `
    <span class="time-expected">${expected}</span>
    <span class="time-scheduled">${t('sch')}: ${scheduled || '—'}</span>
  `;
}

function applyI18nChrome() {
  document.documentElement.lang = currentLang();

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  const langEl = $('langIndicator');
  if (langEl) {
    const dict = window.PDS_I18N[currentLang()] || window.PDS_I18N.en;
    langEl.textContent = dict.langLabel || currentLang().toUpperCase();
  }

  if (lastUpdatedIso) {
    $('lastUpdated').textContent = new Date(lastUpdatedIso).toLocaleString(currentLocale());
  }

  updateRefreshStatusLabel();
  updateClock();
}

function updateRefreshStatusLabel() {
  const statusEl = $('refreshStatus');
  if (!statusEl) return;
  if (sessionStopped) {
    statusEl.innerHTML = `● <span>${t('stoppedStatus')}</span>`;
    statusEl.className = 'refresh-status paused';
    return;
  }
  if (refreshEnabled) {
    statusEl.innerHTML = `● <span>${t('live')}</span>`;
    statusEl.className = 'refresh-status live';
  } else {
    statusEl.innerHTML = `● <span>${t('paused')}</span>`;
    statusEl.className = 'refresh-status paused';
  }
}

function stationTitleForLang() {
  const lang = currentLang();
  const names = stationNames || {};
  const english = names.en || lastMeta.stationName || 'Railway Station';
  const localized = names[lang] || english;
  return `${String(localized).toUpperCase()} ${t('railwayStation')}`;
}

function updateStationHeading() {
  const title = stationTitleForLang();
  $('stationName').textContent = title;
  const english = stationNames.en || lastMeta.stationName;
  if (english) {
    document.title = `${english} Railway Station`;
  }
}

function pageCount() {
  if (!allTrains.length) return 1;
  return Math.max(1, Math.ceil(allTrains.length / pageSize));
}

function visibleTrains() {
  if (allTrains.length <= pageSize) return allTrains;
  const start = pageIndex * pageSize;
  return allTrains.slice(start, start + pageSize);
}

function updatePageIndicator() {
  const el = $('pageIndicator');
  if (!el) return;
  if (allTrains.length <= pageSize) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = t('pageOf')
    .replace('{n}', String(pageIndex + 1))
    .replace('{total}', String(pageCount()));
}

function localizePlace(name) {
  return window.PDS_localizeStationName
    ? window.PDS_localizeStationName(name, currentLang(), stationsByNameMap)
    : (name || '—');
}

function localizeTrain(name) {
  return window.PDS_localizeTrainName
    ? window.PDS_localizeTrainName(name, currentLang())
    : (name || '—');
}

function syncPageRowsCss() {
  document.documentElement.style.setProperty('--page-rows', String(pageSize || 6));
}

function emptyRowHtml() {
  return `<tr class="row-empty"><td colspan="8">&nbsp;</td></tr>`;
}

function renderTable() {
  syncPageRowsCss();
  const tbody = $('trainBody');
  const trains = visibleTrains();

  if (!allTrains.length) {
    tbody.innerHTML = `
      <tr class="no-trains">
        <td colspan="8">${t('noTrains')}</td>
      </tr>`;
    updatePageIndicator();
    return;
  }

  const rows = trains.map((train) => {
    const statusClass = getStatusClass(train.status);
    const rowClass = train.delay > 0 ? 'row-delayed' : '';
    const statusText = window.PDS_translateStatus
      ? window.PDS_translateStatus(train.status, currentLang())
      : train.status;
    const pfClass = train.platformOverridden ? 'platform-badge overridden' : 'platform-badge';
    const pfTitle = train.platformOverridden ? t('pfOverrideTitle') : '';

    return `
      <tr class="${rowClass}">
        <td class="train-no">${train.trainNo}</td>
        <td>${localizeTrain(train.trainName)}</td>
        <td>${localizePlace(train.from)}</td>
        <td>${localizePlace(train.to)}</td>
        <td>${formatTimeCell(train.expectedArrival, train.scheduledArrival)}</td>
        <td>${formatTimeCell(train.expectedDeparture, train.scheduledDeparture)}</td>
        <td><span class="${pfClass}" title="${pfTitle}">${train.platform || '—'}</span></td>
        <td class="${statusClass}">${statusText}</td>
      </tr>`;
  });

  // Keep a fixed pageSize-row board layout; pad unused slots as blank
  while (rows.length < pageSize) {
    rows.push(emptyRowHtml());
  }

  tbody.innerHTML = rows.join('');
  updatePageIndicator();
}

/**
 * Rotate pages within the current language, then advance language.
 * EN 1 → EN 2 → TE 1 → TE 2 → HI 1 → HI 2 → …
 * With a single page: EN → TE → HI → …
 */
function advanceDisplayRotation() {
  const pages = pageCount();
  if (pages > 1) {
    pageIndex += 1;
    if (pageIndex >= pages) {
      pageIndex = 0;
      if (languages.length) {
        langIndex = (langIndex + 1) % languages.length;
      }
    }
  } else {
    pageIndex = 0;
    if (languages.length) {
      langIndex = (langIndex + 1) % languages.length;
    }
  }
  applyI18nChrome();
  updateStationHeading();
  renderTable();
}

function scheduleDisplayRotation() {
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
  const seconds = pageIntervalSeconds || languageRotateSeconds || 10;
  rotateTimer = setInterval(advanceDisplayRotation, seconds * 1000);
}

function updateRefreshUI(enabled) {
  refreshEnabled = enabled;
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');

  updateRefreshStatusLabel();
  if (enabled) {
    btnStart.disabled = true;
    btnStop.disabled = false;
    scheduleRefresh();
  } else {
    btnStart.disabled = false;
    btnStop.disabled = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
}

function updateMeta(data) {
  lastMeta = data;
  if (data.stationNames) {
    stationNames = data.stationNames;
  } else if (data.stationName) {
    stationNames = { en: data.stationName, te: null, hi: null };
  }
  if (data.stationsByName && typeof data.stationsByName === 'object') {
    stationsByNameMap = data.stationsByName;
  }

  if (data.stationCode) {
    $('stationCode').textContent = data.stationCode;
  }
  if (data.lastUpdated) {
    lastUpdatedIso = data.lastUpdated;
  }
  if (data.refreshInterval) {
    $('refreshInterval').textContent = data.refreshInterval;
    refreshIntervalMs = data.refreshInterval * 1000;
  }
  if (typeof data.pageSize === 'number' && data.pageSize > 0) {
    pageSize = data.pageSize;
    syncPageRowsCss();
  }
  if (typeof data.pageIntervalSeconds === 'number' && data.pageIntervalSeconds > 0) {
    pageIntervalSeconds = data.pageIntervalSeconds;
  }
  if (typeof data.languageRotateSeconds === 'number' && data.languageRotateSeconds > 0) {
    languageRotateSeconds = data.languageRotateSeconds;
  }
  if (Array.isArray(data.languages) && data.languages.length) {
    languages = data.languages;
    if (langIndex >= languages.length) langIndex = 0;
  }
  if (typeof data.refreshEnabled === 'boolean') {
    updateRefreshUI(data.refreshEnabled);
  }

  applyI18nChrome();
  updateStationHeading();
}

function showSessionStopped() {
  sessionStopped = true;
  refreshEnabled = false;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
  updateRefreshStatusLabel();
  $('trainBody').innerHTML = `
    <tr class="no-trains">
      <td colspan="8">
        ${t('stopped')}
        <button type="button" id="btnReconnect" class="btn-refresh btn-start" style="margin-left:1rem">${t('reconnect')}</button>
      </td>
    </tr>`;
  const btn = $('btnReconnect');
  if (btn) btn.addEventListener('click', reconnectSession);
}

function reconnectSession() {
  sessionStopped = false;
  refreshEnabled = true;
  newSessionId();
  updateRefreshUI(true);
  loadTrains();
}

async function loadTrains() {
  if (sessionStopped) return;

  try {
    const res = await fetch(trainsUrl(), {
      headers: {
        'X-Session-Id': getSessionId(),
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    let data = null;
    if (contentType.includes('application/json') || raw.trim().startsWith('{')) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }

    if (!data || isSessionStoppedPayload(data) || res.status === 409 || res.status === 403) {
      if (isSessionStoppedPayload(data) || res.status === 409 || res.status === 403 || (res.ok && !data)) {
        clearSessionId();
        showSessionStopped();
        return;
      }
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!data || !Array.isArray(data.trains)) throw new Error('Invalid trains payload');

    allTrains = data.trains;
    if (pageIndex >= pageCount()) pageIndex = 0;
    updateMeta(data);
    renderTable();
    scheduleDisplayRotation();
  } catch (err) {
    console.error('Failed to load trains:', err);
    if (refreshEnabled && !sessionStopped) {
      $('trainBody').innerHTML = `
        <tr class="no-trains">
          <td colspan="8">${t('unable')}</td>
        </tr>`;
    }
  }
}

async function loadRefreshStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/refresh/status`);
    if (res.ok) {
      const data = await res.json();
      updateRefreshUI(data.refreshEnabled !== false);
    }
  } catch {
    updateRefreshUI(true);
  }
}

async function setRefresh(action) {
  $('btnStart').disabled = true;
  $('btnStop').disabled = true;

  try {
    if (action === 'start') {
      if (sessionStopped) {
        reconnectSession();
        return;
      }
      newSessionId();
    }

    const res = await fetch(`${API_BASE}/api/refresh/${action}`, { method: 'POST', cache: 'no-store' });
    const data = await res.json();
    updateRefreshUI(data.refreshEnabled);
    if (data.refreshEnabled) await loadTrains();
  } catch (err) {
    console.error(`Failed to ${action} refresh:`, err);
    await loadRefreshStatus();
  }
}

function scheduleRefresh() {
  if (!refreshEnabled) return;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadTrains, refreshIntervalMs);
}

$('btnStart').addEventListener('click', () => setRefresh('start'));
$('btnStop').addEventListener('click', () => setRefresh('stop'));

applyI18nChrome();
updateClock();
setInterval(updateClock, 1000);
loadRefreshStatus().then(loadTrains);
