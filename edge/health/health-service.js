'use strict';

const { readJson } = require('../storage/atomic-file');
const {
  ntesStatusPath,
  freshnessPath,
  ntesStatePath
} = require('../../shared/paths');
const { statusPath } = require('../runtime/heartbeat');
const { evaluateFromDisk, isPassengerBlocked } = require('../licence/licence-service');
const { loadConfig } = require('../config/config-service');
const { readTimeSync } = require('./time-sync');

const STALE_MS = 15_000;

function heartbeatFresh(doc) {
  if (!doc?.updatedAt) return false;
  const age = Date.now() - new Date(doc.updatedAt).getTime();
  return Number.isFinite(age) && age < STALE_MS;
}

function serviceState(name) {
  const doc = readJson(statusPath(name), null);
  if (heartbeatFresh(doc)) return 'running';
  return doc?.status === 'running' ? 'stale' : 'stopped';
}

function ntesLabel(status, freshness) {
  if (!status) return 'disconnected';
  if (status.state) return status.state;
  if (freshness?.sourceStatus === 'stale') return 'stale';
  return 'disconnected';
}

function licenceLabel(evaluation) {
  if (!evaluation) return 'missing';
  return String(evaluation.state || 'MISSING').toLowerCase();
}

function overallStatus({ ntes, platform, coach, licence, timeSync, blocked }) {
  if (blocked) return 'failed';
  if (platform !== 'running' || coach !== 'running') return 'failed';
  if (ntes === 'error' || ntes === 'disconnected') return 'degraded';
  if (ntes === 'stale') return 'degraded';
  if (licence === 'degraded' || licence === 'expiring') return 'degraded';
  if (timeSync === 'unavailable' || timeSync === 'invalid' || timeSync === 'degraded') {
    return 'degraded';
  }
  return 'healthy';
}

function collectHealth(options = {}) {
  const cfg = options.config || loadConfig();
  const config = cfg.config || {};
  const evaluation = options.licence || evaluateFromDisk({
    stationCode: config.stationCode,
    gracePeriodHours: config.licence?.gracePeriodHours,
    expiringWarningDays: config.licence?.expiringWarningDays,
    persist: false
  });
  const ntesStatus = readJson(ntesStatusPath(), null);
  const freshness = readJson(freshnessPath(), null);
  const ntesState = readJson(ntesStatePath(), null);
  const time = options.timeSync || readTimeSync();
  const platform = options.platform || serviceState('platform');
  const coach = options.coach || serviceState('coach');
  const ntes = ntesLabel(ntesStatus, freshness);
  const licence = licenceLabel(evaluation);
  const blocked = isPassengerBlocked(evaluation);
  const lastNtesUpdate =
    ntesStatus?.lastDataUpdate || ntesState?.fetchedAt || freshness?.dataUpdatedAt || null;

  const status = overallStatus({
    ntes,
    platform,
    coach,
    licence,
    timeSync: time.timeSyncStatus,
    blocked
  });

  return {
    status,
    stationCode: config.stationCode || null,
    stationName: config.stationName || null,
    licence,
    licenceState: evaluation.state,
    licenceReason: evaluation.reason || null,
    ntes,
    platform,
    coach,
    lastNtesUpdate,
    timeSync: time.timeSyncStatus,
    systemTime: time.systemTime,
    lastTimeSync: time.lastTimeSync,
    sourceStatus: freshness?.sourceStatus || null,
    dataUpdatedAt: freshness?.dataUpdatedAt || null
  };
}

module.exports = {
  collectHealth,
  serviceState,
  overallStatus
};
