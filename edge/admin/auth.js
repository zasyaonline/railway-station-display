'use strict';

const crypto = require('crypto');
const { readJson, atomicWriteJson } = require('../storage/atomic-file');
const { adminSecretsPath } = require('../../shared/paths');

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  });
  return {
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  };
}

function verifyPassword(password, record) {
  if (!record?.hash || !record?.salt) return false;
  const check = hashPassword(password, record.salt);
  const a = Buffer.from(check.hash, 'hex');
  const b = Buffer.from(record.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function saveAdminSecret(password, extra = {}) {
  const scrypt = hashPassword(password);
  const doc = {
    actor: 'local-admin',
    scrypt,
    createdAt: new Date().toISOString(),
    ...extra
  };
  atomicWriteJson(adminSecretsPath(), doc);
  return doc;
}

function loadAdminSecret() {
  return readJson(adminSecretsPath(), null);
}

function providedKey(req) {
  return (
    req.get?.('x-admin-key') ||
    req.headers?.['x-admin-key'] ||
    req.query?.adminKey ||
    req.query?.key ||
    ''
  );
}

function authenticate(req) {
  const provided = String(providedKey(req) || '');
  const secret = loadAdminSecret();
  if (secret?.scrypt) {
    if (!provided) return { ok: false, reason: 'missing' };
    if (!verifyPassword(provided, secret.scrypt)) return { ok: false, reason: 'invalid' };
    return { ok: true, actor: secret.actor || 'local-admin' };
  }
  const expected = process.env.ADMIN_KEY;
  if (!expected) return { ok: false, reason: 'unconfigured' };
  if (!provided || provided !== expected) return { ok: false, reason: 'invalid' };
  return { ok: true, actor: 'local-admin' };
}

function requireAdmin(req, res, logger) {
  const result = authenticate(req);
  if (result.ok) {
    req.adminActor = result.actor;
    return true;
  }
  if (logger) {
    logger.warn('admin authentication failed', {
      reason: result.reason,
      path: req.path || req.url
    });
  }
  res.status(401).json({ error: 'Admin authentication required' });
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  saveAdminSecret,
  loadAdminSecret,
  authenticate,
  requireAdmin,
  providedKey
};
