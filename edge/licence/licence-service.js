'use strict';

const fs = require('fs');
const { readJson, atomicWriteJson } = require('../storage/atomic-file');
const {
  licenceFilePath,
  licencePublicKeyPath,
  licenceStatePath
} = require('../../shared/paths');
const { hoursBetween, nowIso, isObviouslyInvalidDate } = require('../../shared/time');
const { LICENCE_STATES, parseLicence } = require('./schema');
const { verifySignature } = require('./verifier');

function todayUtcDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function loadPublicKey(explicitPath) {
  const keyPath = explicitPath || licencePublicKeyPath();
  try {
    return fs.readFileSync(keyPath, 'utf8');
  } catch {
    return null;
  }
}

function loadPersistedState() {
  return readJson(licenceStatePath(), {
    lastValidAt: null,
    degradedAt: null,
    state: LICENCE_STATES.MISSING
  });
}

function savePersistedState(state) {
  atomicWriteJson(licenceStatePath(), state);
}

function dateInRange(validFrom, validUntil, today) {
  return today >= validFrom && today <= validUntil;
}

function evaluateLicence({
  licenceRaw,
  publicKeyPem,
  stationCode,
  requiredProducts = ['platform', 'coach'],
  now = new Date(),
  gracePeriodHours = null,
  expiringWarningDays = null,
  persisted = null,
  persist = true
}) {
  const persistedState = persisted || loadPersistedState();
  const clockAbnormal = isObviouslyInvalidDate(now);
  const today = todayUtcDate(now);

  function finish(result) {
    const next = {
      lastValidAt: result.lastValidAt ?? persistedState.lastValidAt,
      degradedAt: result.degradedAt ?? null,
      state: result.state,
      updatedAt: nowIso(now)
    };
    if (persist && result.persist !== false) {
      try {
        savePersistedState(next);
      } catch {
        /* runtime dir may be unavailable in unit tests without layout */
      }
    }
    return {
      ...result,
      clockAbnormal,
      persisted: next
    };
  }

  if (!licenceRaw) {
    if (persistedState.lastValidAt) {
      return gracePath({
        reason: 'licence file unreadable',
        persistedState,
        gracePeriodHours,
        now,
        finish,
        clockAbnormal
      });
    }
    return finish({
      state: LICENCE_STATES.MISSING,
      blocked: true,
      operational: false,
      lastValidAt: null,
      degradedAt: null,
      reason: 'licence missing'
    });
  }

  const parsed = parseLicence(licenceRaw);
  if (!parsed.ok) {
    if (persistedState.lastValidAt) {
      return gracePath({
        reason: parsed.error,
        persistedState,
        gracePeriodHours,
        now,
        finish,
        clockAbnormal
      });
    }
    return finish({
      state: LICENCE_STATES.INVALID,
      blocked: true,
      operational: false,
      lastValidAt: null,
      degradedAt: null,
      reason: parsed.error
    });
  }

  const licence = parsed.licence;
  if (!verifySignature(licence, publicKeyPem)) {
    if (persistedState.lastValidAt) {
      return gracePath({
        reason: 'signature verification failed',
        persistedState,
        gracePeriodHours,
        now,
        finish,
        clockAbnormal
      });
    }
    return finish({
      state: LICENCE_STATES.INVALID,
      blocked: true,
      operational: false,
      lastValidAt: null,
      degradedAt: null,
      reason: 'invalid signature',
      licence
    });
  }

  if (String(stationCode || '').toUpperCase() !== licence.stationCode) {
    return finish({
      state: LICENCE_STATES.BLOCKED,
      blocked: true,
      operational: false,
      lastValidAt: persistedState.lastValidAt,
      degradedAt: null,
      reason: `licence station ${licence.stationCode} does not match ${stationCode}`,
      licence
    });
  }

  const missingProduct = requiredProducts.find((p) => !licence.products.includes(p));
  if (missingProduct) {
    return finish({
      state: LICENCE_STATES.BLOCKED,
      blocked: true,
      operational: false,
      lastValidAt: persistedState.lastValidAt,
      degradedAt: null,
      reason: `licence missing product ${missingProduct}`,
      licence
    });
  }

  if (!dateInRange(licence.validFrom, licence.validUntil, today)) {
    return finish({
      state: LICENCE_STATES.BLOCKED,
      blocked: true,
      operational: false,
      lastValidAt: persistedState.lastValidAt,
      degradedAt: null,
      reason: 'licence not within valid dates',
      licence
    });
  }

  let state = LICENCE_STATES.VALID;
  if (expiringWarningDays != null && Number.isFinite(Number(expiringWarningDays))) {
    const until = new Date(`${licence.validUntil}T23:59:59Z`);
    const daysLeft = (until.getTime() - now.getTime()) / 86_400_000;
    if (daysLeft <= Number(expiringWarningDays)) state = LICENCE_STATES.EXPIRING;
  }

  return finish({
    state,
    blocked: false,
    operational: true,
    lastValidAt: nowIso(now),
    degradedAt: null,
    reason: null,
    licence
  });
}

function gracePath({ reason, persistedState, gracePeriodHours, now, finish, clockAbnormal }) {
  const degradedAt = persistedState.degradedAt || nowIso(now);
  const hours = hoursBetween(degradedAt, now);
  const grace = gracePeriodHours == null ? 0 : Number(gracePeriodHours);
  const expired = hours != null && hours >= grace;
  if (expired && !clockAbnormal) {
    return finish({
      state: LICENCE_STATES.BLOCKED,
      blocked: true,
      operational: false,
      lastValidAt: persistedState.lastValidAt,
      degradedAt,
      reason: `${reason}; grace expired`
    });
  }
  return finish({
    state: LICENCE_STATES.DEGRADED,
    blocked: false,
    operational: true,
    lastValidAt: persistedState.lastValidAt,
    degradedAt,
    reason
  });
}

function daysLeftUntil(validUntil, now = new Date()) {
  if (!validUntil) return null;
  const until = new Date(`${validUntil}T23:59:59Z`);
  const days = (until.getTime() - now.getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return null;
  return Math.ceil(days);
}

function publicLicenceView(evaluation, now = new Date()) {
  if (!evaluation) return null;
  const validUntil = evaluation.licence?.validUntil || null;
  return {
    state: evaluation.state,
    blocked: Boolean(evaluation.blocked) || evaluation.operational === false,
    operational: evaluation.operational !== false,
    validUntil,
    daysLeft: daysLeftUntil(validUntil, now),
    reason: evaluation.reason || null
  };
}

function evaluateFromDisk(options = {}) {
  const publicKeyPem = options.publicKeyPem || loadPublicKey(options.publicKeyPath);
  const licenceRaw = options.licenceRaw !== undefined
    ? options.licenceRaw
    : readJson(licenceFilePath(), null);
  return evaluateLicence({
    ...options,
    licenceRaw,
    publicKeyPem,
    persisted: options.persisted || loadPersistedState(),
    persist: options.persist !== false
  });
}

function isPassengerBlocked(evaluation) {
  return Boolean(evaluation?.blocked) || !evaluation?.operational;
}

module.exports = {
  LICENCE_STATES,
  loadPublicKey,
  loadPersistedState,
  evaluateLicence,
  evaluateFromDisk,
  isPassengerBlocked,
  daysLeftUntil,
  publicLicenceView
};
