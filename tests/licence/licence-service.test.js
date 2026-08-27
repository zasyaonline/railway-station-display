'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair, signLicence } = require('../../edge/licence/verifier');
const { evaluateLicence, LICENCE_STATES } = require('../../edge/licence/licence-service');

function signedLicence(overrides = {}) {
  const { publicKey, privateKey } = generateKeyPair();
  const unsigned = {
    licenceId: 'ZSY-BG-001',
    stationCode: 'BG',
    products: ['platform', 'coach'],
    validFrom: '2026-01-01',
    validUntil: '2027-12-31',
    installationId: '',
    ...overrides
  };
  const licence = signLicence(
    unsigned,
    privateKey.export({ type: 'pkcs8', format: 'pem' })
  );
  return {
    licence,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
  };
}

function persistedNone() {
  return { lastValidAt: null, degradedAt: null, state: 'MISSING' };
}

test('valid licence', () => {
  const { licence, publicKeyPem } = signedLicence();
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'BG',
    now: new Date('2026-08-25T00:00:00Z'),
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.VALID);
  assert.equal(result.operational, true);
});

test('invalid signature is blocked with no grace', () => {
  const { licence, publicKeyPem } = signedLicence();
  licence.signature = Buffer.from('nope').toString('base64');
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'BG',
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.INVALID);
  assert.equal(result.blocked, true);
  assert.equal(result.operational, false);
});

test('wrong station is blocked', () => {
  const { licence, publicKeyPem } = signedLicence();
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'SC',
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.BLOCKED);
});

test('wrong product is blocked', () => {
  const { licence, publicKeyPem } = signedLicence({ products: ['platform'] });
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'BG',
    requiredProducts: ['platform', 'coach'],
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.BLOCKED);
});

test('expired licence is blocked', () => {
  const { licence, publicKeyPem } = signedLicence({
    validFrom: '2020-01-01',
    validUntil: '2020-12-31'
  });
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'BG',
    now: new Date('2026-08-25T00:00:00Z'),
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.BLOCKED);
});

test('licence within warning window is EXPIRING', () => {
  const { licence, publicKeyPem } = signedLicence({
    validFrom: '2026-08-01',
    validUntil: '2026-09-01'
  });
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'BG',
    now: new Date('2026-08-28T00:00:00Z'),
    expiringWarningDays: 7,
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.EXPIRING);
  assert.equal(result.operational, true);
  assert.equal(result.blocked, false);
});

test('missing licence is blocked', () => {
  const result = evaluateLicence({
    licenceRaw: null,
    publicKeyPem: 'x',
    stationCode: 'BG',
    persist: false,
    persisted: persistedNone()
  });
  assert.equal(result.state, LICENCE_STATES.MISSING);
  assert.equal(result.blocked, true);
});

test('previously valid licence enters DEGRADED and stays operational during grace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-lic-'));
  process.env.ZASYA_RAILWAY_ROOT = root;
  const { publicKeyPem } = signedLicence();
  const start = new Date('2026-08-25T10:00:00Z');
  const degraded = evaluateLicence({
    licenceRaw: { licenceId: 'x' },
    publicKeyPem,
    stationCode: 'BG',
    now: start,
    gracePeriodHours: 2,
    persist: false,
    persisted: { lastValidAt: '2026-08-25T09:00:00Z', degradedAt: null, state: 'VALID' }
  });
  assert.equal(degraded.state, LICENCE_STATES.DEGRADED);
  assert.equal(degraded.operational, true);

  const still = evaluateLicence({
    licenceRaw: { licenceId: 'x' },
    publicKeyPem,
    stationCode: 'BG',
    now: new Date('2026-08-25T11:00:00Z'),
    gracePeriodHours: 2,
    persist: false,
    persisted: {
      lastValidAt: '2026-08-25T09:00:00Z',
      degradedAt: degraded.degradedAt,
      state: 'DEGRADED'
    }
  });
  assert.equal(still.state, LICENCE_STATES.DEGRADED);
});

test('grace expiry blocks a previously valid licence', () => {
  const { publicKeyPem } = signedLicence();
  const result = evaluateLicence({
    licenceRaw: { licenceId: 'x' },
    publicKeyPem,
    stationCode: 'BG',
    now: new Date('2026-08-25T13:00:00Z'),
    gracePeriodHours: 2,
    persist: false,
    persisted: {
      lastValidAt: '2026-08-25T09:00:00Z',
      degradedAt: '2026-08-25T10:00:00Z',
      state: 'DEGRADED'
    }
  });
  assert.equal(result.state, LICENCE_STATES.BLOCKED);
  assert.equal(result.operational, false);
});

test('recovery before grace expiry returns VALID', () => {
  const { licence, publicKeyPem } = signedLicence();
  const result = evaluateLicence({
    licenceRaw: licence,
    publicKeyPem,
    stationCode: 'BG',
    now: new Date('2026-08-25T11:00:00Z'),
    persist: false,
    persisted: {
      lastValidAt: '2026-08-25T09:00:00Z',
      degradedAt: '2026-08-25T10:00:00Z',
      state: 'DEGRADED'
    }
  });
  assert.equal(result.state, LICENCE_STATES.VALID);
  assert.equal(result.degradedAt, null);
});
