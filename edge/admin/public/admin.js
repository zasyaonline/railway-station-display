'use strict';

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const key = $('adminKey').value;
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  if (key) headers['X-Admin-Key'] = key;
  const res = await fetch(path, Object.assign({ cache: 'no-store' }, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function refresh() {
  const status = await api('/api/admin/status');
  $('stationCode').textContent = status.stationCode || '—';
  $('stationName').textContent = status.stationName || '—';
  $('licenceState').textContent = status.licenceState || status.licence || '—';
  $('stationLine').textContent = `${status.stationName || ''} (${status.stationCode || ''})`;
  $('systemStatus').textContent = JSON.stringify(status, null, 2);
  const platforms = await api('/api/admin/platforms');
  const list = $('platformList');
  list.innerHTML = (platforms.trains || [])
    .map((t) => `<p>${t.trainNo} ${t.trainName || ''} PF ${t.platform}${t.platformOverridden ? ' (override)' : ''}</p>`)
    .join('') || '<p>No trains</p>';
  try {
    const displays = await api('/api/admin/displays');
    $('coachDisplays').textContent = JSON.stringify(displays, null, 2);
  } catch (err) {
    $('coachDisplays').textContent = err.message;
  }
}

$('btnUnlock').addEventListener('click', async () => {
  $('gateError').hidden = true;
  try {
    await refresh();
    $('gate').hidden = true;
    $('panel').hidden = false;
  } catch (err) {
    $('gateError').hidden = false;
    $('gateError').textContent = err.message;
  }
});

$('btnOverride').addEventListener('click', async () => {
  await api('/api/admin/platforms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trainNo: $('ovTrain').value, platform: $('ovPlatform').value })
  });
  await refresh();
});

$('btnClearAll').addEventListener('click', async () => {
  await api('/api/admin/platforms/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true })
  });
  await refresh();
});
