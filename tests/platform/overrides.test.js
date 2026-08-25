'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setOverride, clearOverride } = require('../../services/platformOverrides');

test('platform override requires train and platform', () => {
  const missing = setOverride({ overrides: {} }, '', '3');
  assert.equal(missing.ok, false);
  const ok = setOverride({ overrides: {} }, '12345', '3');
  assert.equal(ok.ok, true);
  assert.equal(ok.doc.overrides['12345'].platform, '3');
  const cleared = clearOverride(ok.doc, '12345');
  assert.equal(cleared.doc.overrides['12345'], undefined);
});
