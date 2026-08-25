'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-bak-'));
process.env.ZASYA_RAILWAY_ROOT = root;
process.env.ZASYA_RAILWAY_ETC = path.join(root, 'etc');
fs.mkdirSync(process.env.ZASYA_RAILWAY_ETC, { recursive: true });

const { atomicWriteJson } = require('../../edge/storage/atomic-file');
const { stationConfigPath, licenceFilePath } = require('../../shared/paths');
const { exportPackage, restorePackage } = require('../../edge/backup/backup-service');
const { ensureRuntimeLayout } = require('../../edge/runtime/layout');

test('backup excludes ntes and admin secrets', () => {
  ensureRuntimeLayout();
  atomicWriteJson(stationConfigPath(), { stationCode: 'BG', stationName: 'Bhongir' });
  atomicWriteJson(licenceFilePath(), { licenceId: 'x' });
  atomicWriteJson(path.join(process.env.ZASYA_RAILWAY_ETC, 'ntes.json'), { credentials: { password: 'secret' } });
  atomicWriteJson(path.join(process.env.ZASYA_RAILWAY_ETC, 'admin.json'), { scrypt: {} });
  const { dest, manifest } = exportPackage();
  assert.equal(manifest.includesSecrets, false);
  assert.equal(fs.existsSync(path.join(dest, 'ntes.json')), false);
  assert.equal(fs.existsSync(path.join(dest, 'admin.json')), false);
  assert.equal(fs.existsSync(path.join(dest, 'licence.json')), true);
  fs.unlinkSync(stationConfigPath());
  restorePackage(dest);
  assert.equal(fs.existsSync(stationConfigPath()), true);
});
