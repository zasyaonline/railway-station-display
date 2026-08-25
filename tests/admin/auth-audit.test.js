'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../../edge/admin/auth');
const { recordAudit, readAuditTail } = require('../../edge/audit/audit-service');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('password hash verifies and rejects mismatches', () => {
  const rec = hashPassword('correct-horse');
  assert.equal(verifyPassword('correct-horse', rec), true);
  assert.equal(verifyPassword('wrong', rec), false);
});

test('audit events are appended as JSONL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-audit-'));
  process.env.ZASYA_RAILWAY_ROOT = root;
  delete require.cache[require.resolve('../../edge/audit/audit-service')];
  delete require.cache[require.resolve('../../shared/paths')];
  const audit = require('../../edge/audit/audit-service');
  audit.recordAudit({
    action: 'platform_override',
    details: { trainNo: '12345', platform: '3' }
  });
  const events = audit.readAuditTail(10);
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, 'local-admin');
  assert.equal(events[0].action, 'platform_override');
});
