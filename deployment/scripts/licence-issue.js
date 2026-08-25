#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generateKeyPair, signLicence } = require('../../edge/licence/verifier');

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

if (hasFlag('gen-keys')) {
  const outDir = arg('out-dir', '.');
  fs.mkdirSync(outDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPair();
  const pubPath = path.join(outDir, 'licence-public.pem');
  const privPath = path.join(outDir, 'licence-private.pem');
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  process.stdout.write(`Wrote ${pubPath}\nWrote ${privPath}\n`);
  process.stdout.write('Keep the private key off Railway appliances.\n');
  process.exit(0);
}

const station = String(arg('station', '')).toUpperCase();
const products = String(arg('products', 'platform,coach'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const validFrom = arg('valid-from');
const validUntil = arg('valid-until');
const licenceId = arg('id', `ZSY-${station}-${Date.now()}`);
const keyPath = arg('key');
const out = arg('out', 'licence.json');
const installationId = arg('installation-id', '');

if (!station || !validFrom || !validUntil || !keyPath) {
  process.stderr.write(
    'Usage:\n' +
      '  node licence-issue.js --gen-keys --out-dir ./keys\n' +
      '  node licence-issue.js --station BG --valid-from 2026-08-25 --valid-until 2027-08-24 --key private.pem --out licence.json\n'
  );
  process.exit(1);
}

const unsigned = {
  licenceId,
  stationCode: station,
  products,
  validFrom,
  validUntil,
  installationId
};
const signed = signLicence(unsigned, fs.readFileSync(keyPath, 'utf8'));
fs.writeFileSync(out, `${JSON.stringify(signed, null, 2)}\n`);
process.stdout.write(`Wrote ${out}\n`);
