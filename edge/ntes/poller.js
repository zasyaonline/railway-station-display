'use strict';

const { fetchStationLive } = require('../../services/ntesClient');
const { atomicWriteJson, readJson } = require('../storage/atomic-file');
const { createLogger } = require('../../shared/logging');
const { ensureRuntimeLayout } = require('../runtime/layout');
const { loadConfig, loadNtesSecrets } = require('../config/config-service');
const { normalizeStationState } = require('./normalizer');
const {
  ntesStatePath,
  ntesStatusPath,
  freshnessPath
} = require('../../shared/paths');

function backoffMs(failures) {
  return Math.min(60_000, 1000 * 2 ** Math.min(failures, 6));
}

function writeStatus(fields) {
  const prev = readJson(ntesStatusPath(), {});
  atomicWriteJson(ntesStatusPath(), {
    lastAttempt: prev.lastAttempt || null,
    lastSuccess: prev.lastSuccess || null,
    lastDataUpdate: prev.lastDataUpdate || null,
    error: null,
    state: 'disconnected',
    ...prev,
    ...fields
  });
}

async function pollOnce({
  stationCode,
  lookAheadHours = 4,
  fetchFn = fetchStationLive,
  masterTrains = [],
  staleAfterSeconds = 180
}) {
  const attemptedAt = new Date().toISOString();
  writeStatus({ lastAttempt: attemptedAt, error: null });
  try {
    const raw = await fetchFn(stationCode, lookAheadHours);
    const state = normalizeStationState(raw, { stationCode, masterTrains, fetchedAt: attemptedAt });
    atomicWriteJson(ntesStatePath(), state);
    writeStatus({
      state: 'connected',
      lastAttempt: attemptedAt,
      lastSuccess: attemptedAt,
      lastDataUpdate: attemptedAt,
      error: null
    });
    atomicWriteJson(freshnessPath(), {
      dataUpdatedAt: attemptedAt,
      sourceStatus: 'fresh',
      staleAfterSeconds
    });
    return { ok: true, state };
  } catch (err) {
    const existing = readJson(ntesStatePath(), null);
    const sourceStatus = existing ? 'stale' : 'error';
    const disconnected =
      /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch/i.test(String(err.message)) ||
      err.name === 'TimeoutError';
    writeStatus({
      state: disconnected ? 'disconnected' : 'error',
      lastAttempt: attemptedAt,
      error: err.message || String(err)
    });
    atomicWriteJson(freshnessPath(), {
      dataUpdatedAt: existing?.fetchedAt || null,
      sourceStatus,
      staleAfterSeconds
    });
    return { ok: false, error: err.message || String(err), stale: Boolean(existing) };
  }
}

async function runPoller(options = {}) {
  ensureRuntimeLayout();
  const log = options.logger || createLogger('ntes');
  const loaded = options.config ? { ok: true, config: options.config } : loadConfig();
  if (!loaded.ok) {
    log.error('NTES poller cannot start', { errors: loaded.errors });
    throw new Error(loaded.errors.join('; '));
  }
  const config = loaded.config;
  const secrets = options.secrets || loadNtesSecrets();
  if (secrets?.endpoint) {
    process.env.NTES_BASE_URL = secrets.endpoint;
  } else if (config.ntes?.endpoint) {
    process.env.NTES_BASE_URL = config.ntes.endpoint;
  }

  const intervalMs = (config.ntes.pollIntervalSeconds || 30) * 1000;
  let failures = 0;
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const result = await pollOnce({
      stationCode: config.stationCode,
      lookAheadHours: config.lookAheadHours,
      fetchFn: options.fetchFn,
      masterTrains: options.masterTrains || [],
      staleAfterSeconds: config.ntes.staleAfterSeconds
    });
    if (result.ok) {
      failures = 0;
      log.info('NTES poll ok', {
        stationCode: config.stationCode,
        trains: result.state.trains.length
      });
      timer = setTimeout(tick, intervalMs);
    } else {
      failures += 1;
      const wait = backoffMs(failures);
      log.warn('NTES poll failed', { error: result.error, backoffMs: wait, failures });
      timer = setTimeout(tick, wait);
    }
  }

  log.info('NTES poller starting', { stationCode: config.stationCode });
  await tick();

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

if (require.main === module) {
  runPoller().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  pollOnce,
  runPoller,
  backoffMs
};
