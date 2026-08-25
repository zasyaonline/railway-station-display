'use strict';

const { readJson, atomicWriteJson } = require('../storage/atomic-file');
const { stationConfigPath, ntesSecretsPath } = require('../../shared/paths');
const { emptyConfig, validateConfig } = require('./schema');

function loadConfig() {
  const raw = readJson(stationConfigPath(), null);
  if (!raw) {
    return { ok: false, errors: ['station configuration missing'], config: emptyConfig() };
  }
  return validateConfig(raw);
}

function loadNtesSecrets() {
  return readJson(ntesSecretsPath(), { endpoint: null, credentials: {} });
}

function saveConfig(config) {
  const checked = validateConfig(config);
  if (!checked.ok) return checked;
  atomicWriteJson(stationConfigPath(), checked.config);
  return checked;
}

module.exports = {
  loadConfig,
  loadNtesSecrets,
  saveConfig
};
