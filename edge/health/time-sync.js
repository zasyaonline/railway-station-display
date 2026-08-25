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

function readTimeSync() {
  const systemTime = nowIso();
  const clockAbnormal = isObviouslyInvalidDate(new Date());
  let lastTimeSync = null;
  let timeSyncStatus = 'unknown';

  const timedatectl = run('timedatectl', ['show', '-p', 'NTPSynchronized', '-p', 'LastSynchronizationTimestamp']);
  if (timedatectl) {
    const ntp = /NTPSynchronized=(yes|no)/i.exec(timedatectl);
    const last = /LastSynchronizationTimestamp=(.+)/.exec(timedatectl);
    if (last && last[1] && last[1] !== 'n/a' && last[1] !== '') {
      const parsed = new Date(last[1]);
      if (!Number.isNaN(parsed.getTime())) lastTimeSync = parsed.toISOString();
    }
    if (ntp) {
      timeSyncStatus = ntp[1].toLowerCase() === 'yes' ? 'healthy' : 'unavailable';
    }
  } else {
    const chronyc = run('chronyc', ['tracking']);
    if (chronyc && /Leap status\s*:\s*Normal/i.test(chronyc)) {
      timeSyncStatus = 'healthy';
    } else if (chronyc) {
      timeSyncStatus = 'degraded';
    }
  }

  if (clockAbnormal) timeSyncStatus = 'invalid';
  if (timeSyncStatus === 'unknown') timeSyncStatus = 'unavailable';

  return {
    systemTime,
    lastTimeSync,
    timeSyncStatus,
    clockAbnormal
  };
}

module.exports = { readTimeSync };
