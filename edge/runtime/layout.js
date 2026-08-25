'use strict';

const fs = require('fs');
const {
  dataRoot,
  runtimeDir,
  configDataDir,
  licenceDataDir,
  platformDataDir,
  coachDataDir,
  backupDir,
  auditDir,
  logDir
} = require('../../shared/paths');

function ensureRuntimeLayout() {
  for (const dir of [
    dataRoot(),
    runtimeDir(),
    configDataDir(),
    licenceDataDir(),
    platformDataDir(),
    coachDataDir(),
    backupDir(),
    auditDir()
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    fs.mkdirSync(logDir(), { recursive: true });
  } catch {
    /* /var/log may be unwritable in local tests */
  }
}

module.exports = { ensureRuntimeLayout };
