'use strict';

const crypto = require('crypto');

function stableStringify(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort().filter((k) => value[k] !== undefined);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function payloadBytes(licence) {
  const { signature: _signature, ...rest } = licence;
  return Buffer.from(stableStringify(rest), 'utf8');
}

function signLicence(licence, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, payloadBytes(licence), key);
  return {
    ...licence,
    signature: signature.toString('base64')
  };
}

function verifySignature(licence, publicKeyPem) {
  if (!licence?.signature) return false;
  if (!publicKeyPem) return false;
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(
      null,
      payloadBytes(licence),
      key,
      Buffer.from(licence.signature, 'base64')
    );
  } catch {
    return false;
  }
}

function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

module.exports = {
  stableStringify,
  payloadBytes,
  signLicence,
  verifySignature,
  generateKeyPair
};
