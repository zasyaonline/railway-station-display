'use strict';

const { execFileSync } = require('child_process');
const { isObviouslyInvalidDate, nowIso } = require('../../shared/time');

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function parseChronyTracking(text) {
  if (!text) return { ok: false, lastTimeSync: null };
  const ok = /Leap status\s*:\s*Normal/i.test(text);
  let lastTimeSync = null;
  const ref = /Ref time \(UTC\)\s*:\s*(.+)/i.exec(text);
  if (ref && ref[1] && !/unspecified/i.test(ref[1])) {
    const parsed = new Date(ref[1].trim());
    if (!Number.isNaN(parsed.getTime())) lastTimeSync = parsed.toISOString();
  }
  return { ok, lastTimeSync };
}

function parseTimezone(timedatectlShow) {
  if (!timedatectlShow) return null;
  const m = /^Timezone=(.+)$/m.exec(timedatectlShow);
  if (m) return m[1].trim();
  const value = timedatectlShow.trim();
  return value && !value.includes('=') ? value : null;
}

function readTimeSync() {
  const systemTime = nowIso();
  const clockAbnormal = isObviouslyInvalidDate(new Date());
  let lastTimeSync = null;
  let timeSyncStatus = 'unknown';

  const timezone =
    run('timedatectl', ['show', '-p', 'Timezone', '--value']) ||
    parseTimezone(run('timedatectl', ['show', '-p', 'Timezone'])) ||
    null;

  /* Chrony is the appliance NTP client. timedatectl NTPSynchronized often stays
     "no" while chrony Leap status is Normal — treat chrony as source of truth. */
  const chronyc = run('chronyc', ['tracking']);
  const chrony = parseChronyTracking(chronyc);
  if (chrony.ok) {
    timeSyncStatus = 'healthy';
    lastTimeSync = chrony.lastTimeSync;
  } else if (chronyc) {
    timeSyncStatus = 'degraded';
  }

  const timedatectl = run('timedatectl', ['show', '-p', 'NTPSynchronized', '-p', 'LastSynchronizationTimestamp']);
  if (timedatectl) {
    const ntp = /NTPSynchronized=(yes|no)/i.exec(timedatectl);
    const last = /LastSynchronizationTimestamp=(.+)/.exec(timedatectl);
    if (!lastTimeSync && last && last[1] && last[1] !== 'n/a' && last[1] !== '') {
      const parsed = new Date(last[1]);
      if (!Number.isNaN(parsed.getTime())) lastTimeSync = parsed.toISOString();
    }
    if (timeSyncStatus !== 'healthy' && ntp && ntp[1].toLowerCase() === 'yes') {
      timeSyncStatus = 'healthy';
    }
  }

  if (clockAbnormal) timeSyncStatus = 'invalid';
  if (timeSyncStatus === 'unknown') timeSyncStatus = 'unavailable';

  return {
    systemTime,
    lastTimeSync,
    timeSyncStatus,
    clockAbnormal,
    timezone
  };
}

module.exports = { readTimeSync, parseChronyTracking, parseTimezone };
