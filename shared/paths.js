'use strict';

const path = require('path');

function etcDir() {
  return process.env.ZASYA_RAILWAY_ETC || '/etc/zasya/railway';
}

function dataRoot() {
  return process.env.ZASYA_RAILWAY_ROOT || '/var/lib/zasya/railway';
}

function logDir() {
  return process.env.ZASYA_RAILWAY_LOG || '/var/log/zasya/railway';
}

function runtimeDir() {
  return path.join(dataRoot(), 'runtime');
}

function configDataDir() {
  return path.join(dataRoot(), 'config');
}

function licenceDataDir() {
  return path.join(dataRoot(), 'licence');
}

function platformDataDir() {
  return path.join(dataRoot(), 'platform');
}

function coachDataDir() {
  return path.join(dataRoot(), 'coach');
}

function backupDir() {
  return path.join(dataRoot(), 'backup');
}

function auditDir() {
  return path.join(dataRoot(), 'audit');
}

function ntesStatePath() {
  return process.env.NTES_STATE_FILE || path.join(runtimeDir(), 'ntes_state.json');
}

function ntesStatusPath() {
  return path.join(runtimeDir(), 'ntes_status.json');
}

function freshnessPath() {
  return path.join(runtimeDir(), 'freshness.json');
}

function stationConfigPath() {
  return path.join(etcDir(), 'config.json');
}

function ntesSecretsPath() {
  return path.join(etcDir(), 'ntes.json');
}

function adminSecretsPath() {
  return path.join(etcDir(), 'admin.json');
}

function licenceFilePath() {
  return path.join(etcDir(), 'licence.json');
}

function licencePublicKeyPath() {
  return path.join(etcDir(), 'licence-public.pem');
}

function licenceStatePath() {
  return path.join(runtimeDir(), 'licence_state.json');
}

module.exports = {
  etcDir,
  dataRoot,
  logDir,
  runtimeDir,
  configDataDir,
  licenceDataDir,
  platformDataDir,
  coachDataDir,
  backupDir,
  auditDir,
  ntesStatePath,
  ntesStatusPath,
  freshnessPath,
  stationConfigPath,
  ntesSecretsPath,
  adminSecretsPath,
  licenceFilePath,
  licencePublicKeyPath,
  licenceStatePath
};
