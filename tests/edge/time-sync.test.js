'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseChronyTracking, parseTimezone } = require('../../edge/health/time-sync');

test('chrony Leap Normal is treated as healthy', () => {
  const sample = `
Reference ID    : A29FC87B (time.cloudflare.com)
Stratum         : 3
Ref time (UTC)  : Tue Aug 25 10:30:00 2026
System time     : 0.000123456 seconds slow of NTP time
Last offset     : +0.000012345 seconds
RMS offset      : 0.000045678 seconds
Frequency       : 12.345 ppm slow
Residual freq   : +0.001 ppm
Skew            : 0.123 ppm
Root delay      : 0.012345678 seconds
Root dispersion : 0.001234567 seconds
Update interval : 64.0 seconds
Leap status     : Normal
`;
  const parsed = parseChronyTracking(sample);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.lastTimeSync);
});

test('chrony not Normal is not healthy', () => {
  assert.equal(parseChronyTracking('Leap status     : Not synchronized').ok, false);
  assert.equal(parseChronyTracking('').ok, false);
});

test('parses timedatectl Timezone=Asia/Kolkata', () => {
  assert.equal(parseTimezone('Timezone=Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(parseTimezone('Asia/Kolkata'), 'Asia/Kolkata');
});
