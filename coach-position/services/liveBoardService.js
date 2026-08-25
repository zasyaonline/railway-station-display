'use strict';

/**
 * Live NTES station board for Coach Position.
 * TrainsAtStation only lists trains that halt at the station (not pass-through).
 * Coach rake + Divyangjan positions come from the same live row.
 */

const { fetchStationLive } = require('../../services/ntesClient');

function extractTime(ntesDateTime) {
  if (!ntesDateTime) return null;
  if (/^\d{1,2}:\d{2}$/.test(String(ntesDateTime).trim())) {
    return String(ntesDateTime).trim().padStart(5, '0');
  }
  const match = String(ntesDateTime).match(/(\d{1,2}:\d{2})/);
  return match ? match[1].padStart(5, '0').replace(/^(\d):/, '0$1:') : null;
}

function parseDelay(delayStr) {
  if (!delayStr || delayStr === 'RT' || delayStr === 'On Time') return 0;
  const minMatch = String(delayStr).match(/(\d+)\s*Min/i);
  if (minMatch) return parseInt(minMatch[1], 10);
  const colonMin = String(delayStr).match(/^(\d+):(\d+)$/);
  if (colonMin) return parseInt(colonMin[1], 10) * 60 + parseInt(colonMin[2], 10);
  const hrMatch = String(delayStr).match(/(\d+):(\d+)\s*Hr/i);
  if (hrMatch) return parseInt(hrMatch[1], 10) * 60 + parseInt(hrMatch[2], 10);
  const numMatch = String(delayStr).match(/^(\d+)$/);
  if (numMatch) return parseInt(numMatch[1], 10);
  return 0;
}

function buildStatus(ntesTrain) {
  if (ntesTrain.Cancel === 1) return 'Cancelled';
  if (ntesTrain.ArrCancelFlag === 1 || ntesTrain.DepCancelFlag === 1) return 'Cancelled';
  if (ntesTrain.Diverted === 1) return 'Diverted';
  const delay = Math.max(parseDelay(ntesTrain.DelayArr), parseDelay(ntesTrain.DelayDep));
  if (ntesTrain.DepFlag === '1') return 'Departed';
  if (ntesTrain.ArrFlag === '1') return 'Arrived';
  if (delay > 0) return `Late by ${delay} mins`;
  return 'On Time';
}

function getRunningState(ntesTrain) {
  if (ntesTrain.Cancel === 1) return 'cancelled';
  if (ntesTrain.DepFlag === '1') return 'departed';
  if (ntesTrain.ArrFlag === '1') return 'arrived';
  return 'scheduled';
}

function parseCoachPositionString(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(/[-,/|]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** NTES uses 0-based coach indices, e.g. "22" or "1,15". */
function parsePwdPositions(str) {
  if (str == null || str === '') return [];
  return String(str)
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function pickComposition(ntesTrain) {
  const departed = ntesTrain.DepFlag === '1';
  const arrived = ntesTrain.ArrFlag === '1';
  let codes = [];
  let classes = [];
  let pwd = [];

  if (departed || (!arrived && ntesTrain.departureCoachPosition)) {
    codes = parseCoachPositionString(ntesTrain.departureCoachPosition);
    classes = parseCoachPositionString(ntesTrain.departureCoachClass);
    pwd = parsePwdPositions(ntesTrain.depPWDCoachPosition);
  }
  if (!codes.length) {
    codes = parseCoachPositionString(ntesTrain.arrivalCoachPosition);
    classes = parseCoachPositionString(ntesTrain.arrivalCoachClass);
    pwd = parsePwdPositions(ntesTrain.arrPWDCoachPosition);
  }
  if (!pwd.length) {
    pwd = parsePwdPositions(ntesTrain.depPWDCoachPosition || ntesTrain.arrPWDCoachPosition);
  }

  return { codes, classes, pwdPositions: pwd };
}

function mapNtesLiveTrain(ntesTrain) {
  const delay = Math.max(parseDelay(ntesTrain.DelayArr), parseDelay(ntesTrain.DelayDep));
  const scheduledArrival = extractTime(ntesTrain.STA);
  const scheduledDeparture = extractTime(ntesTrain.STD);
  const expectedArrival = extractTime(ntesTrain.ETA) || scheduledArrival;
  const expectedDeparture = extractTime(ntesTrain.ETD) || scheduledDeparture;
  const { codes, classes, pwdPositions } = pickComposition(ntesTrain);

  return {
    trainNo: String(ntesTrain.TrainNumber),
    trainName: ntesTrain.TrainName || '',
    from: ntesTrain.SourceName || ntesTrain.Source || null,
    to: ntesTrain.DestinationName || ntesTrain.Destination || null,
    scheduledArrival,
    scheduledDeparture,
    expectedArrival,
    expectedDeparture,
    platform: ntesTrain.Platform != null && ntesTrain.Platform !== '' ? String(ntesTrain.Platform) : '-',
    status: buildStatus(ntesTrain),
    delay,
    runningState: getRunningState(ntesTrain),
    startDate: ntesTrain.StartDate || null,
    coachCodes: codes,
    coachClasses: classes,
    pwdPositions,
    compositionSource: codes.length ? 'ntes-live-board' : null,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * @param {string} stationCode
 * @param {{ lookAheadHours?: number }} [opts]
 */
async function fetchLiveStationBoard(stationCode, opts = {}) {
  const code = String(stationCode || '').trim().toUpperCase();
  if (!code) throw new Error('stationCode required');
  const hours = opts.lookAheadHours || 4;
  const data = await fetchStationLive(code, hours);
  const rows = data.TrainsAtStation || data.trainsAtStation || [];
  const trains = rows
    .map(mapNtesLiveTrain)
    .filter((t) => t.runningState !== 'cancelled');

  return {
    stationCode: data.Station || code,
    stationName: data.StationName || null,
    trains,
    rawCount: rows.length,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  fetchLiveStationBoard,
  mapNtesLiveTrain,
  parseCoachPositionString,
  parsePwdPositions,
  extractTime,
  parseDelay
};
