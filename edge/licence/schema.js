'use strict';

const LICENCE_STATES = Object.freeze({
  VALID: 'VALID',
  EXPIRING: 'EXPIRING',
  DEGRADED: 'DEGRADED',
  BLOCKED: 'BLOCKED',
  MISSING: 'MISSING',
  INVALID: 'INVALID'
});

function emptyLicence() {
  return {
    licenceId: '',
    stationCode: '',
    products: [],
    validFrom: '',
    validUntil: '',
    installationId: '',
    signature: ''
  };
}

function parseLicence(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'licence is not an object' };
  }
  const licenceId = String(raw.licenceId || '').trim();
  const stationCode = String(raw.stationCode || '').trim().toUpperCase();
  const products = Array.isArray(raw.products) ? raw.products.map(String) : [];
  const validFrom = String(raw.validFrom || '').trim();
  const validUntil = String(raw.validUntil || '').trim();
  if (!licenceId) return { ok: false, error: 'licenceId required' };
  if (!stationCode) return { ok: false, error: 'stationCode required' };
  if (!products.length) return { ok: false, error: 'products required' };
  if (!validFrom || !validUntil) return { ok: false, error: 'validFrom and validUntil required' };
  const licence = {
    licenceId,
    stationCode,
    products,
    validFrom,
    validUntil,
    installationId: String(raw.installationId || ''),
    signature: String(raw.signature || '')
  };
  if (raw.maxInstallations != null) licence.maxInstallations = raw.maxInstallations;
  if (raw.features != null) licence.features = raw.features;
  return {
    ok: true,
    licence
  };
}

module.exports = {
  LICENCE_STATES,
  emptyLicence,
  parseLicence
};
