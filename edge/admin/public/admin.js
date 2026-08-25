'use strict';

const CONFIG = window.PDS_CONFIG || {};
const API_BASE = CONFIG.API_BASE || '';
const KEY_STORAGE = 'pds_admin_key';
const CUSTOM_VALUE = '__custom__';

let adminKey = '';
let pollTimer = null;
let stationPresets = [];
let stationFormDirty = false;
let stationFormReady = false;
let platformDirty = {};
let platformPollInFlight = false;

function $(id) {
  return document.getElementById(id);
}

function isStationFormFocused() {
  const active = document.activeElement;
  return active === $('stationCodeInput')
    || active === $('stationNameInput')
    || active === $('stationPreset');
}

function markStationDirty() {
  stationFormDirty = true;
}

function updateClock() {
  $('clock').textContent = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
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

async function api(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    options.headers || {}
  );
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}adminKey=${encodeURIComponent(adminKey)}`;
  const res = await fetch(url, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function fillStationPresets(presets) {
  const next = presets || [];
  const same = next.length === stationPresets.length
    && next.every((s, i) => s.code === stationPresets[i]?.code && s.name === stationPresets[i]?.name);
  stationPresets = next;
  if (same && $('stationPreset').options.length > 0) {
    return;
  }

  const select = $('stationPreset');
  const previous = select.value;
  select.innerHTML = stationPresets
    .map((s) => `<option value="${s.code}">${s.code} — ${s.name}</option>`)
    .join('') + `<option value="${CUSTOM_VALUE}">Other / custom code…</option>`;
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

function showResolvedPreview(code, name, names) {
  const el = $('stationResolved');
  if (!code) {
    el.hidden = true;
    return;
  }
  const parts = [`Resolved: ${name || '—'} (${code})`];
  if (names?.te) parts.push(`TE: ${names.te}`);
  if (names?.hi) parts.push(`HI: ${names.hi}`);
  el.textContent = parts.join(' · ');
  el.hidden = false;
}

function syncStationForm(code, name, force, names) {
  $('currentStation').textContent = code ? `${code}` : '—';
  if (name) {
    $('currentStation').title = name;
  }
  showResolvedPreview(code, name, names);

  if (!force && (stationFormDirty || isStationFormFocused())) {
    return;
  }

  const preset = stationPresets.find((s) => s.code === code);
  if (preset) {
    $('stationPreset').value = code;
    $('stationCodeInput').value = code;
    $('stationNameInput').value = name || preset.name;
  } else {
    $('stationPreset').value = CUSTOM_VALUE;
    $('stationCodeInput').value = code || '';
    $('stationNameInput').value = name || '';
  }
  stationFormDirty = false;
  stationFormReady = true;
}

function onPresetChange() {
  markStationDirty();
  const value = $('stationPreset').value;
  if (value === CUSTOM_VALUE) {
    $('stationCodeInput').focus();
    return;
  }
  const preset = stationPresets.find((s) => s.code === value);
  if (!preset) return;
  $('stationCodeInput').value = preset.code;
  $('stationNameInput').value = preset.name;
  showResolvedPreview(preset.code, preset.name, {
    te: preset.te,
    hi: preset.hi
  });
}

function setStationStatus(message, isError) {
  const el = $('stationStatus');
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `station-status${isError ? ' error' : ''}`;
}

function setPlatformStatus(message, isError) {
  const el = $('platformStatus');
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `station-status${isError ? ' error' : ''}`;
}

function renderSessions(data) {
  $('activeCount').textContent = String(data.activeCount ?? 0);
  $('refreshState').textContent = data.refreshEnabled ? 'LIVE' : 'PAUSED';
  $('refreshState').className = `stat-value ${data.refreshEnabled ? 'live' : 'paused'}`;

  if (data.stationPinned) {
    $('btnApplyStation').disabled = true;
    $('stationPreset').disabled = true;
    $('stationCodeInput').readOnly = true;
    const pinHelp = $('stationPinnedHelp');
    if (pinHelp) pinHelp.hidden = false;
  }

  if (Array.isArray(data.stationPresets) && data.stationPresets.length) {
    fillStationPresets(data.stationPresets);
  }
  if (data.stationCode) {
    syncStationForm(data.stationCode, data.stationName, !stationFormReady, data.stationNames);
  }

  const tbody = $('sessionBody');
  const sessions = data.sessions || [];
  if (!sessions.length) {
    tbody.innerHTML = `<tr class="no-trains"><td colspan="6">No active sessions</td></tr>`;
    return;
  }

  tbody.innerHTML = sessions.map((s) => `
    <tr>
      <td><code title="${s.id}">${shortId(s.id)}</code></td>
      <td>${new Date(s.startedAt).toLocaleString('en-IN')}</td>
      <td><strong>${formatDuration(s.durationSeconds)}</strong></td>
      <td>${formatDuration(s.idleSeconds)} ago</td>
      <td>${browserLabel(s.userAgent)}</td>
      <td><button type="button" class="btn-refresh btn-stop btn-stop-one" data-id="${s.id}">Stop</button></td>
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
}

function renderPlatforms(data) {
  const tbody = $('platformBody');
  const trains = data.trains || [];
  if (!trains.length) {
    tbody.innerHTML = `<tr class="no-trains"><td colspan="5">No trains on the current board</td></tr>`;
    return;
  }

  const focused = document.activeElement;
  const focusedTrain = focused && focused.dataset && focused.dataset.train
    ? focused.dataset.train
    : null;

  tbody.innerHTML = trains.map((t) => {
    const dirtyVal = platformDirty[t.trainNo];
    const value = dirtyVal != null
      ? dirtyVal
      : (t.platformOverridden ? t.platform : '');
    const mark = t.platformOverridden ? ' <span class="pf-overridden">override</span>' : '';
    return `
      <tr>
        <td class="train-no">${t.trainNo}</td>
        <td>${t.trainName || '—'}</td>
        <td>${t.ntesPlatform || '—'}${mark}</td>
        <td>
          <input
            class="pf-input"
            data-train="${t.trainNo}"
            type="text"
            maxlength="4"
            placeholder="PF"
            value="${String(value).replace(/"/g, '&quot;')}"
            autocomplete="off"
          >
        </td>
        <td class="pf-actions">
          <button type="button" class="btn-refresh btn-start btn-pf-save" data-train="${t.trainNo}">Save</button>
          <button type="button" class="btn-refresh btn-stop btn-pf-clear" data-train="${t.trainNo}">Clear</button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.pf-input').forEach((input) => {
    input.addEventListener('input', () => {
      platformDirty[input.dataset.train] = input.value;
    });
    if (focusedTrain && input.dataset.train === focusedTrain) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  tbody.querySelectorAll('.btn-pf-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const trainNo = btn.dataset.train;
      const input = tbody.querySelector(`.pf-input[data-train="${trainNo}"]`);
      const platform = (input?.value || '').trim();
      if (!platform) {
        setPlatformStatus('Enter a platform number before Save', true);
        return;
      }
      btn.disabled = true;
      try {
        await api('/api/admin/platforms', {
          method: 'POST',
          body: JSON.stringify({ trainNo, platform })
        });
        delete platformDirty[trainNo];
        setPlatformStatus(`Saved PF ${platform} for ${trainNo}`);
        await loadPlatforms();
      } catch (err) {
        setPlatformStatus(err.message, true);
        btn.disabled = false;
      }
    });
  });

  tbody.querySelectorAll('.btn-pf-clear').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const trainNo = btn.dataset.train;
      btn.disabled = true;
      try {
        await api('/api/admin/platforms/clear', {
          method: 'POST',
          body: JSON.stringify({ trainNo })
        });
        delete platformDirty[trainNo];
        setPlatformStatus(`Cleared override for ${trainNo}`);
        await loadPlatforms();
      } catch (err) {
        setPlatformStatus(err.message, true);
        btn.disabled = false;
      }
    });
  });
}

async function loadSessions() {
  const data = await api('/api/admin/sessions');
  renderSessions(data);
}

async function loadPlatforms() {
  if (platformPollInFlight) return;
  platformPollInFlight = true;
  try {
    const data = await api('/api/admin/platforms');
    renderPlatforms(data);
  } finally {
    platformPollInFlight = false;
  }
}

async function loadApplianceStatus() {
  const licenceEl = $('licenceChip');
  if (!licenceEl) return;
  try {
    const status = await api('/api/admin/status');
    licenceEl.textContent = status.licenceState || status.licence || '—';
    licenceEl.className = `stat-value ${(status.licenceState || status.licence) === 'VALID' ? 'live' : 'paused'}`;
    if ($('ntesChip')) {
      const ntes = status.ntes || '—';
      $('ntesChip').textContent = String(ntes).toUpperCase();
      $('ntesChip').className = `stat-value ${ntes === 'connected' ? 'live' : 'paused'}`;
    }
    if (status.ntes === 'connected' && $('refreshState')) {
      $('refreshState').textContent = 'LIVE';
      $('refreshState').className = 'stat-value live';
    }
  } catch {
    /* cloud PDS has no /api/admin/status */
  }
}

async function applyStation() {
  const stationCode = $('stationCodeInput').value.trim();
  const btn = $('btnApplyStation');
  btn.disabled = true;
  setStationStatus('Validating with NTES…');
  try {
    const result = await api('/api/admin/station', {
      method: 'POST',
      body: JSON.stringify({ stationCode })
    });
    setStationStatus(result.message || 'Station updated');
    stationFormDirty = false;
    await loadSessions();
    syncStationForm(result.stationCode, result.stationName, true, result.stationNames);
    await loadPlatforms();
  } catch (err) {
    setStationStatus(err.status === 403
      ? (err.message || 'Station is locked to this installation licence')
      : err.message, true);
  } finally {
    if (!$('stationCodeInput').readOnly) btn.disabled = false;
  }
}

async function unlock() {
  adminKey = $('adminKey').value.trim();
  $('gateError').hidden = true;
  try {
    await loadSessions();
    await loadPlatforms();
    try {
      sessionStorage.setItem(KEY_STORAGE, adminKey);
    } catch {
      /* ignore */
    }
    $('gate').hidden = true;
    $('panel').hidden = false;
    await loadApplianceStatus();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      loadSessions().catch(() => {});
      loadApplianceStatus().catch(() => {});
      const active = document.activeElement;
      const editingPf = active && active.classList && active.classList.contains('pf-input');
      if (!editingPf) {
        loadPlatforms().catch(() => {});
      }
    }, 5000);
  } catch (err) {
    $('gateError').textContent = err.status === 401 ? 'Invalid admin key' : err.message;
    $('gateError').hidden = false;
  }
}

$('btnUnlock').addEventListener('click', unlock);
$('adminKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') unlock();
});

$('stationPreset').addEventListener('change', onPresetChange);
$('btnApplyStation').addEventListener('click', applyStation);
$('stationCodeInput').addEventListener('input', markStationDirty);
$('stationCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyStation();
  }
});
$('stationCodeInput').addEventListener('input', () => {
  $('stationCodeInput').value = $('stationCodeInput').value.toUpperCase();
  const code = $('stationCodeInput').value.trim();
  const preset = stationPresets.find((s) => s.code === code);
  $('stationPreset').value = preset ? code : CUSTOM_VALUE;
  if (preset) {
    $('stationNameInput').value = preset.name;
    showResolvedPreview(preset.code, preset.name, { te: preset.te, hi: preset.hi });
  } else {
    $('stationNameInput').value = '';
    showResolvedPreview(code, null, null);
  }
});

$('btnRefreshList').addEventListener('click', () => {
  Promise.all([loadSessions(), loadPlatforms()]).catch((e) => alert(e.message));
});
$('btnRefreshPlatforms').addEventListener('click', () => {
  loadPlatforms().catch((e) => alert(e.message));
});
$('btnClearAllPlatforms').addEventListener('click', async () => {
  if (!confirm('Clear all platform overrides?')) return;
  try {
    await api('/api/admin/platforms/clear', {
      method: 'POST',
      body: JSON.stringify({ all: true })
    });
    platformDirty = {};
    setPlatformStatus('All platform overrides cleared');
    await loadPlatforms();
  } catch (err) {
    setPlatformStatus(err.message, true);
  }
});

$('btnStopAll').addEventListener('click', async () => {
  if (!confirm('Stop all active display sessions?')) return;
  try {
    await api('/api/admin/sessions/stop-all', { method: 'POST', body: '{}' });
    await loadSessions();
  } catch (err) {
    alert(err.message);
  }
});

$('btnServiceStart').addEventListener('click', async () => {
  try {
    await api('/api/refresh/start', { method: 'POST', body: '{}' });
    await loadSessions();
    await loadPlatforms();
  } catch (err) {
    alert(err.message);
  }
});

$('btnServiceStop').addEventListener('click', async () => {
  try {
    await api('/api/refresh/stop', { method: 'POST', body: '{}' });
    await loadSessions();
  } catch (err) {
    alert(err.message);
  }
});

updateClock();
setInterval(updateClock, 1000);

try {
  const saved = sessionStorage.getItem(KEY_STORAGE);
  if (saved) {
    $('adminKey').value = saved;
    unlock();
  }
} catch {
  /* ignore */
}
