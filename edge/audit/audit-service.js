'use strict';

const path = require('path');
const { atomicWrite } = require('../storage/atomic-file');
const { auditDir } = require('../../shared/paths');
const { nowIso } = require('../../shared/time');

function auditLogPath() {
  return path.join(auditDir(), 'admin.jsonl');
}

function recordAudit({ actor = 'local-admin', action, details = {} }) {
  const event = {
    timestamp: nowIso(),
    actor,
    action,
    details
  };
  const line = `${JSON.stringify(event)}\n`;
  const file = auditLogPath();
  const fs = require('fs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
  return event;
}

function readAuditTail(limit = 50) {
  const fs = require('fs');
  try {
    const lines = fs.readFileSync(auditLogPath(), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

module.exports = {
  recordAudit,
  readAuditTail,
  auditLogPath,
  atomicWrite
};
