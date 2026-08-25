'use strict';

const API_BASE = (window.COACH_CONFIG && window.COACH_CONFIG.API_BASE) || '';
const LOOKUP_BASE = (window.COACH_CONFIG && window.COACH_CONFIG.LOOKUP_BASE) || API_BASE;
const KEY_STORAGE = 'coach_admin_key';
const DEFAULT_STATION = 'BG';
const DEFAULT_DISPLAY = 'entrance-main';
let adminKey = '';
let doc = null;

function $(id) { return document.getElementById(id); }

function isLocalHost() {
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
}

function writeApiBase() {
  if (API_BASE) return API_BASE;
  if (isLocalHost()) return '';
  return LOOKUP_BASE || '';
}

function previewHref(station, display) {
  const code = (station || doc?.stationCode || DEFAULT_STATION).trim().toUpperCase();
  const id = display || DEFAULT_DISPLAY;
  return `/?station=${encodeURIComponent(code)}&display=${encodeURIComponent(id)}`;
}

function showStatus(msg, ok = true) {
  const status = $('status');
  status.textContent = msg;
  status.style.color = ok ? '#4ade80' : '#f87171';
  status.hidden = false;
}

function showStationHint(msg, ok = true) {
  const el = $('stationHint');
  el.textContent = msg;
  el.style.color = ok ? '#4ade80' : '#f87171';
  el.hidden = false;
}

function localAdminUrl() {
  return 'http://localhost:3001/admin.html';
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function shortId(id) {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function browserLabel(ua) {
  if (!ua) return '—';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return ua.slice(0, 40);
}

let sessionPoll = null;
let hasApi = false;
let searchedCode = '';

async function api(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    options.headers || {}
  );
  const sep = path.includes('?') ? '&' : '?';
  const base = writeApiBase();
  const url = `${base}${path}${sep}adminKey=${encodeURIComponent(adminKey)}`;
  const res = await fetch(url, Object.assign({}, options, { headers }));
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const err = new Error('Coach API is not available on this host');
    err.status = res.status;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function syncStationFields() {
  $('fStationCode').value = doc.stationCode || '';
  $('fStationName').value = doc.stationName || '';
  searchedCode = doc.stationCode || '';
  $('stationCode').textContent =
    `${doc.stationCode || '—'}${doc.stationName ? ` · ${doc.stationName}` : ''}`;
}

function renderList() {
  syncStationFields();
  const list = $('list');
  list.innerHTML = (doc.displays || []).map((d) => `
    <div class="card" data-id="${d.id}">
      <strong>${d.id}</strong> — ${d.name}<br>
      <span style="color:#94a3b8">${d.mode} · PF ${(d.platformsShown || []).join(',')}
      ${d.youAreHere ? ` · pin PF${d.youAreHere.platform} @ ${d.youAreHere.metersFromEngineEnd ?? d.youAreHere.slotIndex}m` : ''}</span>
    </div>
  `).join('') || '<p>No displays yet</p>';

  list.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => {
      const d = doc.displays.find((x) => x.id === el.dataset.id);
      if (!d) return;
      $('fId').value = d.id;
      $('fName').value = d.name || '';
      $('fMode').value = d.mode || 'dual';
      $('fPlatforms').value = (d.platformsShown || []).join(',');
      $('fPinPf').value = d.youAreHere?.platform || '';
      $('fMetres').value = d.youAreHere?.metersFromEngineEnd ?? '';
      $('fFacing').value = d.youAreHere?.facing || 'engine_left';
      $('previewLink').href = previewHref(doc.stationCode, d.id);
    });
  });
}

async function loadStaticDisplays() {
  const code = ($('fStationCode')?.value || DEFAULT_STATION).trim().toUpperCase() || DEFAULT_STATION;
  const urls = [
    `/data/stations/${code}/displays.json`,
    code === DEFAULT_STATION ? '/data/coach_displays.json' : null,
    '/data/coach_displays.json'
  ].filter(Boolean);
  for (const url of urls) {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return res.json();
  }
  throw new Error('No display config found');
}

async function unlock() {
  adminKey = $('adminKey').value.trim();
  $('gateError').hidden = true;
  hasApi = false;
  try {
    doc = await api(`/api/coach/displays?station=${encodeURIComponent($('fStationCode').value.trim() || DEFAULT_STATION)}`);
    if (!doc || !Array.isArray(doc.displays)) {
      throw Object.assign(new Error('Coach API is not available on this host'), { status: 503 });
    }
    hasApi = true;
  } catch (err) {
    if (err.status === 401) {
      $('gateError').textContent = 'Invalid admin key';
      $('gateError').hidden = false;
      return;
    }
    try {
      doc = await loadStaticDisplays();
      hasApi = false;
    } catch {
      $('gateError').textContent = err.message;
      $('gateError').hidden = false;
      return;
    }
  }
  try { sessionStorage.setItem(KEY_STORAGE, adminKey); } catch { /* ignore */ }
  $('gate').hidden = true;
  $('panel').hidden = false;
  renderList();
  loadSessions();
  if (sessionPoll) clearInterval(sessionPoll);
  sessionPoll = setInterval(loadSessions, 10000);
  if (!hasApi) {
    showStationHint(
      'NTES lookup works here. Save needs the cloud Coach API (PDS Lambda) or local :3001.',
      false
    );
  }
}

$('btnUnlock').addEventListener('click', unlock);
$('adminKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

$('fStationCode').addEventListener('input', () => {
  $('fStationCode').value = $('fStationCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if ($('fStationCode').value !== searchedCode) {
    $('fStationName').value = '';
  }
});
$('fStationCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchStation();
  }
});

async function searchStation() {
  const code = $('fStationCode').value.trim().toUpperCase();
  $('fStationCode').value = code;
  if (!code || code.length < 2) {
    showStationHint('Enter a 2–6 letter NTES station code', false);
    return;
  }
  if (!hasApi && !LOOKUP_BASE) {
    showStationHint(
      `Search needs the local API. Open ${localAdminUrl()}, enter ${code}, then Search.`,
      false
    );
    return;
  }
  const btn = $('btnSearchStation');
  btn.disabled = true;
  showStationHint('Looking up NTES…');
  try {
    let data;
    const useRemoteLookup = Boolean(LOOKUP_BASE) && (!hasApi || !API_BASE);
    if (hasApi && !useRemoteLookup) {
      data = await api(`/api/admin/station-lookup?code=${encodeURIComponent(code)}`);
    } else {
      const res = await fetch(
        `${LOOKUP_BASE}/api/station-lookup?code=${encodeURIComponent(code)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } }
      );
      const contentType = res.headers.get('content-type') || '';
      data = contentType.includes('application/json')
        ? await res.json().catch(() => ({}))
        : {};
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    }
    const name = data.stationName || data.StationName || data.name || '';
    if (!name) {
      throw new Error(data.error || `NTES did not return a name for ${code}`);
    }
    $('fStationName').value = name;
    searchedCode = data.stationCode || code;
    $('fStationCode').value = searchedCode;
    const trains = data.trainCount != null ? ` · ${data.trainCount} trains on the live board` : '';
    showStationHint(`Found ${name}${trains}. Click Save station, then Open display.`);
  } catch (err) {
    $('fStationName').value = '';
    searchedCode = '';
    showStationHint(err.message, false);
  } finally {
    btn.disabled = false;
  }
}

$('btnSearchStation').addEventListener('click', searchStation);

$('btnSaveStation').addEventListener('click', async () => {
  const code = $('fStationCode').value.trim().toUpperCase();
  $('fStationCode').value = code;
  if (!code) {
    showStationHint('Enter a station code and click Search first', false);
    return;
  }
  if (!hasApi) {
    showStationHint(
      'Name is filled from NTES. Save still needs the cloud Coach API (PDS Lambda) or local :3001.',
      false
    );
    return;
  }
  if (! $('fStationName').value.trim()) {
    await searchStation();
    if (!$('fStationName').value.trim()) return;
  }
  try {
    const result = await api('/api/coach/displays', {
      method: 'POST',
      body: JSON.stringify({
        stationCode: code,
        stationName: $('fStationName').value.trim()
      })
    });
    doc.stationCode = result.stationCode;
    doc.stationName = result.stationName;
    if (result.displays) doc.displays = result.displays;
    $('fStationName').value = result.stationName || '';
    searchedCode = result.stationCode || code;
    renderList();
    showStationHint(`Saved ${result.stationCode} · ${result.stationName}. Open display to see this station.`);
    showStatus(`Station saved: ${result.stationCode} · ${result.stationName}`);
  } catch (err) {
    showStationHint(err.message, false);
    showStatus(err.message, false);
  }
});

$('btnSave').addEventListener('click', async () => {
  try {
    const platforms = $('fPlatforms').value.split(',').map((s) => s.trim()).filter(Boolean);
    const pinPf = $('fPinPf').value.trim();
    const metres = $('fMetres').value === '' ? undefined : Number($('fMetres').value);
    const display = {
      id: $('fId').value.trim(),
      name: $('fName').value.trim(),
      mode: $('fMode').value,
      platformsShown: platforms,
      youAreHere: pinPf
        ? {
            platform: pinPf,
            metersFromEngineEnd: metres,
            facing: $('fFacing').value
          }
        : undefined
    };
    const result = await api('/api/coach/displays', {
      method: 'POST',
      body: JSON.stringify({
        stationCode: $('fStationCode').value.trim(),
        stationName: $('fStationName').value.trim(),
        display
      })
    });
    doc.displays = result.displays;
    doc.stationCode = result.stationCode || doc.stationCode;
    doc.stationName = result.stationName || doc.stationName;
    renderList();
    showStatus('Saved');
    $('previewLink').href = previewHref(doc.stationCode, display.id);
  } catch (err) {
    showStatus(err.message, false);
  }
});

async function loadSessions() {
  const tbody = $('sessionBody');
  try {
    const data = await api('/api/admin/sessions');
    $('activeCount').textContent = String(data.activeCount ?? 0);
    const sessions = data.sessions || [];
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="6">No active sessions</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map((s) => `
      <tr>
        <td><code title="${s.id}">${shortId(s.id)}</code></td>
        <td>${new Date(s.startedAt).toLocaleString('en-IN')}</td>
        <td><strong>${formatDuration(s.durationSeconds)}</strong></td>
        <td>${formatDuration(s.idleSeconds)} ago</td>
        <td>${browserLabel(s.userAgent)}</td>
        <td><button type="button" class="btn btn-stop btn-stop-one" data-id="${s.id}">Stop</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.btn-stop-one').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api('/api/admin/sessions/stop', {
            method: 'POST',
            body: JSON.stringify({ sessionId: btn.dataset.id })
          });
          await loadSessions();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
  } catch {
    $('activeCount').textContent = '0';
    tbody.innerHTML = '<tr><td colspan="6">Sessions unavailable (no API on this host)</td></tr>';
  }
}

$('btnRefreshSessions').addEventListener('click', loadSessions);
$('btnStopAll').addEventListener('click', async () => {
  if (!confirm('Stop all active display sessions?')) return;
  try {
    await api('/api/admin/sessions/stop-all', { method: 'POST', body: '{}' });
    await loadSessions();
    showStatus('Stopped all sessions');
  } catch (err) {
    showStatus(err.message, false);
  }
});

try {
  const saved = sessionStorage.getItem(KEY_STORAGE);
  if (saved) {
    $('adminKey').value = saved;
    unlock();
  }
} catch { /* ignore */ }
