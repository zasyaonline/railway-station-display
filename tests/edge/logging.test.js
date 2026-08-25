'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, rotateIfNeeded } = require('../../shared/logging');

test('log rotation moves the active file when over maxBytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-log-'));
  const file = path.join(dir, 'edge.log');
  fs.writeFileSync(file, 'x'.repeat(200));
  rotateIfNeeded(file, 100, 3);
  assert.equal(fs.existsSync(`${file}.1`), true);
  assert.equal(fs.existsSync(file), false);
  const log = createLogger('edge', { dir, maxBytes: 50, maxFiles: 3 });
  log.info('hello');
  assert.equal(fs.existsSync(file), true);
});
