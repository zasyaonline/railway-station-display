'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, readJson } = require('../storage/atomic-file');
const {
  backupDir,
  stationConfigPath,
  licenceFilePath,
  licencePublicKeyPath,
  configDataDir,
  platformDataDir,
  coachDataDir
} = require('../../shared/paths');
const { nowIso } = require('../../shared/time');

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function exportPackage() {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const dest = path.join(backupDir(), `export-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  const copied = {
    config: copyIfExists(stationConfigPath(), path.join(dest, 'config.json')),
    licence: copyIfExists(licenceFilePath(), path.join(dest, 'licence.json')),
    licencePublicKey: copyIfExists(licencePublicKeyPath(), path.join(dest, 'licence-public.pem'))
  };
  copyIfExists(
    path.join(platformDataDir(), 'platform_overrides.json'),
    path.join(dest, 'platform_overrides.json')
  );
  copyIfExists(
    path.join(coachDataDir(), 'displays.json'),
    path.join(dest, 'displays.json')
  );
  const manifest = {
    configurationVersion: 1,
    exportedAt: nowIso(),
    includesSecrets: false,
    copied
  };
  atomicWriteJson(path.join(dest, 'manifest.json'), manifest);
  return { dest, manifest };
}

function restorePackage(srcDir) {
  const manifest = readJson(path.join(srcDir, 'manifest.json'), null);
  if (!manifest) throw new Error('backup manifest missing');
  copyIfExists(path.join(srcDir, 'config.json'), stationConfigPath());
  copyIfExists(path.join(srcDir, 'licence.json'), licenceFilePath());
  copyIfExists(path.join(srcDir, 'licence-public.pem'), licencePublicKeyPath());
  copyIfExists(
    path.join(srcDir, 'platform_overrides.json'),
    path.join(platformDataDir(), 'platform_overrides.json')
  );
  copyIfExists(path.join(srcDir, 'displays.json'), path.join(coachDataDir(), 'displays.json'));
  fs.mkdirSync(configDataDir(), { recursive: true });
  return { ok: true, restoredAt: nowIso(), from: srcDir };
}

module.exports = { exportPackage, restorePackage };
