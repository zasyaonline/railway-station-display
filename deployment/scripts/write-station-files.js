'use strict';

const fs = require('fs');
const { stationConfigPath, ntesSecretsPath } = require('../../shared/paths');
const { validateConfig } = require('../../edge/config/schema');
const { atomicWriteJson } = require('../../edge/storage/atomic-file');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? '' : process.argv[idx + 1];
}

const checked = validateConfig({
  stationCode: arg('station-code'),
  stationName: arg('station-name'),
  kioskUrl: arg('kiosk'),
  ntes: {
    endpoint: arg('ntes-endpoint'),
    pollIntervalSeconds: 30,
    staleAfterSeconds: 180
  },
  licence: {
    gracePeriodHours: arg('grace') === '' ? null : Number(arg('grace')),
    expiringWarningDays: arg('expiring-days') === '' ? 7 : Number(arg('expiring-days'))
  }
});
if (!checked.ok) {
  process.stderr.write(`${checked.errors.join('\n')}\n`);
  process.exit(1);
}
atomicWriteJson(stationConfigPath(), checked.config);
atomicWriteJson(ntesSecretsPath(), {
  endpoint: arg('ntes-endpoint'),
  credentials: {
    username: arg('ntes-user') || '',
    password: arg('ntes-pass') || ''
  }
});
fs.writeFileSync(require('path').join(require('../../shared/paths').etcDir(), 'kiosk-url'), `${arg('kiosk')}\n`);
