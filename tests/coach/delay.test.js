'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapNtesLiveTrain,
  delayFromSchedule,
  resolveDelay
} = require('../../coach-position/services/liveBoardService');

test('delayFromSchedule is expected minus scheduled', () => {
  assert.equal(delayFromSchedule('10:00', '10:38'), 38);
  assert.equal(delayFromSchedule('10:00', '10:05'), 5);
  assert.equal(delayFromSchedule('10:00', '10:00'), 0);
});

test('stale DelayArr still uses ETA versus STA (customer 17201 case)', () => {
  const mapped = mapNtesLiveTrain({
    TrainNumber: '17201',
    TrainName: 'GOLCONDA EXP',
    STA: '10:00 27-Aug',
    STD: '10:05 27-Aug',
    ETA: '10:38',
    ETD: '10:43',
    DelayArr: '5 Min',
    DelayDep: '5 Min',
    ArrFlag: '0',
    DepFlag: '0',
    Platform: '1'
  });
  assert.equal(mapped.delay, 38);
  assert.equal(mapped.status, 'Late by 38 mins');
});

test('DelayArr RT with slipped ETA still reports delay', () => {
  const delay = resolveDelay(
    { DelayArr: 'RT', DelayDep: 'RT' },
    '10:00',
    '10:10',
    '10:05',
    '10:15'
  );
  assert.equal(delay, 5);
});
