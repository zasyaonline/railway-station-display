'use strict';

/**
 * NTES coach composition fetch.
 * Tries known composition-style subservices; falls back to local fixtures.
 */

const path = require('path');
const fs = require('fs');

// Prefer sibling PDS crypto if present
let ntesRequest;
try {
  ({ ntesRequest } = require('../../services/ntesClient'));
} catch {
  ntesRequest = null;
}

const FIXTURE_COMPOSITIONS = {
  '12714': ['ENG', 'SLR', 'S1', 'S2', 'S3', 'PC', 'B1', 'B2', 'A1', 'HA1', 'SLR'],
  '17012': ['ENG', 'GS', 'S1', 'S2', 'B1', 'SLR'],
  '17229': ['ENG', 'SLR', 'S1', 'S2', 'S3', 'S4', 'PC', 'B1', 'B2', 'A1', 'SLR'],
  default: ['ENG', 'SLR', 'S1', 'S2', 'S3', 'PC', 'B1', 'A1', 'SLR']
};

function loadLocalFixture(trainNo) {
  const p = path.join(__dirname, '..', 'data', 'compositions.json');
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (doc[trainNo]) return doc[trainNo];
  } catch {
    /* ignore */
  }
  return FIXTURE_COMPOSITIONS[trainNo] || FIXTURE_COMPOSITIONS.default;
}

function extractCodes(data) {
  if (!data || typeof data !== 'object') return null;
  const arrays = [
    data.CoachList,
    data.coachList,
    data.Coaches,
    data.coaches,
    data.Composition,
    data.composition,
    data.TrainComposition,
    data.trainComposition
  ];
  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length) {
      return arr.map((c) => {
        if (typeof c === 'string') return c;
        return c.CoachCode || c.coachCode || c.Code || c.code || c.Coach || c.name || '';
      }).filter(Boolean);
    }
  }
  // Sometimes a joined string "ENG-SLR-S1-..."
  const joined = data.CoachPosition || data.coachPosition || data.CompositionStr;
  if (typeof joined === 'string' && joined.includes('-')) {
    return joined.split(/[-,]/).map((s) => s.trim()).filter(Boolean);
  }
  return null;
}

async function fetchTrainComposition(trainNo, opts = {}) {
  const useNtes = opts.useNtes !== false && typeof ntesRequest === 'function';
  const code = String(trainNo || '').trim();

  if (useNtes && code) {
    const attempts = [
      `service=TrainSchedule&subService=GetSchedule&trainNo=${code}`,
      `service=TrainRunningMob&subService=TrainComposition&trainNo=${code}`,
      `service=FareEnq&subService=TrainComposition&trainNo=${code}`
    ];
    for (const payload of attempts) {
      try {
        const data = await ntesRequest(payload, 1);
        const codes = extractCodes(data);
        if (codes && codes.length) {
          return { ok: true, source: 'ntes', codes, raw: data };
        }
      } catch {
        /* try next */
      }
    }
  }

  const codes = loadLocalFixture(code);
  return { ok: true, source: 'fixture', codes };
}

module.exports = {
  fetchTrainComposition,
  extractCodes,
  loadLocalFixture,
  FIXTURE_COMPOSITIONS
};
