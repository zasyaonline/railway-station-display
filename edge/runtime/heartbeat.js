'use strict';

const path = require('path');
const { atomicWriteJson } = require('../storage/atomic-file');
const { runtimeDir } = require('../../shared/paths');

function statusPath(name) {
  return path.join(runtimeDir(), `${name}_status.json`);
}

function startHeartbeat(name, extra = {}) {
  async function beat() {
    try {
      await Promise.resolve(
        atomicWriteJson(statusPath(name), {
          status: 'running',
          pid: process.pid,
          updatedAt: new Date().toISOString(),
          ...extra
        })
      );
    } catch {
      /* ignore */
    }
  }
  beat();
  const timer = setInterval(beat, extra.intervalMs || 5000);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = { startHeartbeat, statusPath };
