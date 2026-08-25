'use strict';

/**
 * NTES AppServAnd encryption/decryption.
 * Compatible with the Android app protocol (same keys as ntes-client).
 */

const crypto = require('crypto');

const KEY = Buffer.from('8EA4DB2CC1EB3DC5', 'utf8');
const IV = Buffer.from('7DC5EB3BB4DB6EA8', 'utf8');
const SCKEY = '645fbc1e56e23365f2f3c204ae0899f6';

function encryptPayload(data) {
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final()
  ]);
  const b64 = encrypted.toString('base64');
  const hex = Buffer.from(b64, 'utf8').toString('hex').toUpperCase();
  const hash = crypto.createHash('md5').update(data + SCKEY).digest('hex').toUpperCase();
  return `${hash}#${hex}`;
}

function decryptPayload(enc) {
  let payload = enc;
  if (payload.includes('#')) {
    payload = payload.split('#', 1)[1] || payload.split('#')[1];
  }

  const raw = Buffer.from(payload, 'hex');
  const cipherBytes = Buffer.from(raw.toString('utf8'), 'base64');

  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
  const decrypted = Buffer.concat([
    decipher.update(cipherBytes),
    decipher.final()
  ]);

  const text = decrypted.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

module.exports = { encryptPayload, decryptPayload };
