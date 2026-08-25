'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('NTES poller writes state, status and freshness on success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-ntes-'));
  process.env.ZASYA_RAILWAY_ROOT = root;
  process.env.ZASYA_RAILWAY_LOG = path.join(root, 'log');
  const { pollOnce } = require('../../edge/ntes/poller');
  const { readJson } = require('../../edge/storage/atomic-file');
  const { ntesStatePath, ntesStatusPath, freshnessPath } = require('../../shared/paths');

  const raw = {
    StationName: 'Bhongir',
    TrainsAtStation: [
      {
        TrainNumber: '12345',
        TrainName: 'Test Express',
        SourceName: 'SC',
        DestinationName: 'BZA',
        STA: '10:00 25-Aug',
        STD: '10:10 25-Aug',
        ETA: '10:05',
        ETD: '10:15',
        Platform: '2',
        DelayArr: 'RT',
        DelayDep: 'RT',
        ArrFlag: '0',
        DepFlag: '0',
        departureCoachPosition: 'ENG-SLR-S1',
        departureCoachClass: 'ENG-SLR-SL'
      }
    ]
  };

  const result = await pollOnce({
    stationCode: 'BG',
    fetchFn: async () => raw
  });
  assert.equal(result.ok, true);
  const state = readJson(ntesStatePath());
  assert.equal(state.stationCode, 'BG');
  assert.equal(state.trains[0].trainNo, '12345');
  assert.ok(state.trains[0].coachCodes.length > 0);
  assert.equal(readJson(ntesStatusPath()).state, 'connected');
  assert.equal(readJson(freshnessPath()).sourceStatus, 'fresh');
});

test('NTES poller keeps last state and marks stale on failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-ntes-'));
  process.env.ZASYA_RAILWAY_ROOT = root;
  process.env.ZASYA_RAILWAY_LOG = path.join(root, 'log');
  delete require.cache[require.resolve('../../edge/ntes/poller')];
  delete require.cache[require.resolve('../../shared/paths')];
  const { pollOnce } = require('../../edge/ntes/poller');
  const { atomicWriteJson, readJson } = require('../../edge/storage/atomic-file');
  const { ntesStatePath, freshnessPath } = require('../../shared/paths');
  const { ensureRuntimeLayout } = require('../../edge/runtime/layout');
  ensureRuntimeLayout();
  atomicWriteJson(ntesStatePath(), {
    stationCode: 'BG',
    fetchedAt: '2026-08-25T10:00:00Z',
    trains: [{ trainNo: '1' }]
  });

  const result = await pollOnce({
    stationCode: 'BG',
    fetchFn: async () => {
      throw new Error('ETIMEDOUT');
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(readJson(ntesStatePath()).trains[0].trainNo, '1');
  assert.equal(readJson(freshnessPath()).sourceStatus, 'stale');
});

test('NTES authentication-style errors are recorded as error state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-ntes-'));
  process.env.ZASYA_RAILWAY_ROOT = root;
  process.env.ZASYA_RAILWAY_LOG = path.join(root, 'log');
  delete require.cache[require.resolve('../../edge/ntes/poller')];
  delete require.cache[require.resolve('../../shared/paths')];
  const { pollOnce } = require('../../edge/ntes/poller');
  const { readJson } = require('../../edge/storage/atomic-file');
  const { ntesStatusPath } = require('../../shared/paths');
  const { ensureRuntimeLayout } = require('../../edge/runtime/layout');
  ensureRuntimeLayout();
  const result = await pollOnce({
    stationCode: 'BG',
    fetchFn: async () => {
      throw new Error('Invalid User');
    }
  });
  assert.equal(result.ok, false);
  assert.equal(readJson(ntesStatusPath()).state, 'error');
});
