'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../../edge/config/schema');

test('validateConfig requires station identity', () => {
  const missing = validateConfig({});
  assert.equal(missing.ok, false);
  const ok = validateConfig({ stationCode: 'bg', stationName: 'Bhongir' });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.stationCode, 'BG');
  assert.equal(ok.config.licence.gracePeriodHours, null);
  assert.equal(ok.config.licence.expiringWarningDays, 7);
});

test('ensureRuntimeLayout creates expected directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-layout-'));
  process.env.ZASYA_RAILWAY_ROOT = root;
  process.env.ZASYA_RAILWAY_LOG = path.join(root, 'log');
  delete require.cache[require.resolve('../../edge/runtime/layout')];
  delete require.cache[require.resolve('../../shared/paths')];
  const { ensureRuntimeLayout } = require('../../edge/runtime/layout');
  ensureRuntimeLayout();
  for (const name of ['runtime', 'config', 'licence', 'platform', 'coach', 'backup', 'audit']) {
    assert.equal(fs.existsSync(path.join(root, name)), true);
  }
});
