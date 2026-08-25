'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasDeparted, pickTrainForPlatform } = require('../../coach-position/services/windowService');

function nowAt(h, m) {
  return new Date(2026, 7, 25, h, m, 0);
}

test('hasDeparted is true only when NTES marks the train departed', () => {
  const now = nowAt(12, 10);
  assert.equal(
    hasDeparted({
      runningState: 'arrived',
      status: 'Late by 20 mins',
      expectedDeparture: '12:00'
    }, now),
    false
  );
  assert.equal(
    hasDeparted({ runningState: 'departed', status: 'Departed', expectedDeparture: '12:00' }, now),
    true
  );
  assert.equal(
    hasDeparted({ runningState: 'scheduled', status: 'On Time', expectedDeparture: '12:00' }, now),
    false
  );
});

test('delayed train past timetable is still picked until NTES departed', () => {
  const now = nowAt(12, 20);
  const delayed = {
    trainNo: '12757',
    platform: '1',
    runningState: 'arrived',
    status: 'Late by 25 mins',
    expectedArrival: '11:50',
    expectedDeparture: '12:00',
    scheduledDeparture: '12:00'
  };
  const hit = pickTrainForPlatform([delayed], '1', 10, 0, now);
  assert.ok(hit);
  assert.equal(hit.train.trainNo, '12757');
});

test('NTES-departed train is not picked', () => {
  const now = nowAt(12, 20);
  const gone = {
    trainNo: '12757',
    platform: '1',
    runningState: 'departed',
    status: 'Departed',
    expectedDeparture: '12:00'
  };
  assert.equal(pickTrainForPlatform([gone], '1', 10, 0, now), null);
});
