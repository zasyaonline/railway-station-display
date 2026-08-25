'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { atomicWriteJson, readJson } = require('../../edge/storage/atomic-file');

test('atomicWriteJson replaces the target via rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-atomic-'));
  const file = path.join(dir, 'state.json');
  atomicWriteJson(file, { n: 1 });
  atomicWriteJson(file, { n: 2 });
  assert.deepEqual(readJson(file), { n: 2 });
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.tmp'));
  assert.equal(leftovers.length, 0);
});

test('interrupted temp write leaves the previous file intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-atomic-'));
  const file = path.join(dir, 'state.json');
  atomicWriteJson(file, { ok: true });
  const tmp = path.join(dir, '.state.json.partial.tmp');
  fs.writeFileSync(tmp, '{broken');
  assert.deepEqual(readJson(file), { ok: true });
  assert.equal(fs.existsSync(tmp), true);
});
