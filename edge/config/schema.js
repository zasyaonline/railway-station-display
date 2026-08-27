'use strict';

const DEFAULT_NTES_ENDPOINT = 'https://enquiry.indianrail.gov.in/crisns/AppServAnd';

function emptyConfig() {
  return {
    stationCode: '',
    stationName: '',
    installationId: '',
    kioskUrl: 'http://127.0.0.1/platform/',
    lookAheadHours: 4,
    ntes: {
      endpoint: DEFAULT_NTES_ENDPOINT,
      pollIntervalSeconds: 30,
      staleAfterSeconds: 180
    },
    licence: {
      gracePeriodHours: null,
      expiringWarningDays: 7
    },
    ports: {
      platform: 3000,
      coach: 3001,
      admin: 3002
    }
  };
}

function normalizeStationCode(code) {
  return String(code || '').trim().toUpperCase();
}

function validateConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['config must be an object'] };
  }
  const stationCode = normalizeStationCode(raw.stationCode);
  if (!stationCode || stationCode.length < 2) {
    errors.push('stationCode is required');
  }
  const stationName = String(raw.stationName || '').trim();
  if (!stationName) errors.push('stationName is required');

  const lookAheadHours = Number(raw.lookAheadHours ?? 4);
  if (!Number.isFinite(lookAheadHours) || lookAheadHours < 1) {
    errors.push('lookAheadHours must be a positive number');
  }

  const ntes = raw.ntes && typeof raw.ntes === 'object' ? raw.ntes : {};
  const pollIntervalSeconds = Number(ntes.pollIntervalSeconds ?? 30);
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 5) {
    errors.push('ntes.pollIntervalSeconds must be >= 5');
  }

  const licence = raw.licence && typeof raw.licence === 'object' ? raw.licence : {};
  const grace = licence.gracePeriodHours;
  if (grace != null && (!Number.isFinite(Number(grace)) || Number(grace) < 0)) {
    errors.push('licence.gracePeriodHours must be a non-negative number when set');
  }

  if (errors.length) return { ok: false, errors };

  const merged = emptyConfig();
  return {
    ok: true,
    config: {
      ...merged,
      stationCode,
      stationName,
      installationId: String(raw.installationId || ''),
      kioskUrl: String(raw.kioskUrl || merged.kioskUrl),
      lookAheadHours,
      ntes: {
        ...merged.ntes,
        endpoint: String(ntes.endpoint || merged.ntes.endpoint),
        pollIntervalSeconds,
        staleAfterSeconds: Number(ntes.staleAfterSeconds ?? merged.ntes.staleAfterSeconds)
      },
      licence: {
        gracePeriodHours: grace == null ? null : Number(grace),
        expiringWarningDays:
          licence.expiringWarningDays == null
            ? merged.licence.expiringWarningDays
            : Number(licence.expiringWarningDays)
      },
      ports: {
        ...merged.ports,
        ...(raw.ports && typeof raw.ports === 'object' ? raw.ports : {})
      }
    }
  };
}

module.exports = {
  DEFAULT_NTES_ENDPOINT,
  emptyConfig,
  normalizeStationCode,
  validateConfig
};
