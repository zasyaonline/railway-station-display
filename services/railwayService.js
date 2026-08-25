'use strict';

/**
 * Railway Service — fetches live data from NTES (Indian Railways).
 *
 * Primary source: NTES Live Station board for CHZ.
 * Returns only trains relevant to the current time window (next N hours).
 * No simulated data.
 */

const { fetchStationLive } = require('./ntesClient');

const STATION_CODE = 'CHZ';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeToMinutes(timeStr) {
  if (!timeStr || timeStr === '--') return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Extract "HH:MM" from NTES datetime strings like "00:04 01-Jul" */
function extractTime(ntesDateTime) {
  if (!ntesDateTime) return null;
  const match = ntesDateTime.match(/(\d{1,2}:\d{2})/);
  return match ? match[1].padStart(5, '0').replace(/^(\d):/, '0$1:') : null;
}

/** Parse NTES delay strings: "RT" = on time, "15 Min", "1:30 Hr" */
function parseDelay(delayStr) {
  if (!delayStr || delayStr === 'RT' || delayStr === 'On Time') return 0;
  const minMatch = String(delayStr).match(/(\d+)\s*Min/i);
  if (minMatch) return parseInt(minMatch[1], 10);
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

  const delayArr = parseDelay(ntesTrain.DelayArr);
  const delayDep = parseDelay(ntesTrain.DelayDep);
  const delay = Math.max(delayArr, delayDep);

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

// ---------------------------------------------------------------------------
// Map NTES Live Station row → display record
// ---------------------------------------------------------------------------

function mapNtesTrain(ntesTrain, masterMap) {
  const trainNo = String(ntesTrain.TrainNumber);
  const master = masterMap[trainNo];

  const delayArr = parseDelay(ntesTrain.DelayArr);
  const delayDep = parseDelay(ntesTrain.DelayDep);
  const delay = Math.max(delayArr, delayDep);

  const scheduledArrival = extractTime(ntesTrain.STA);
  const scheduledDeparture = extractTime(ntesTrain.STD);

  return {
    trainNo,
    trainName: master?.trainName || ntesTrain.TrainName,
    from: master?.from || ntesTrain.SourceName,
    to: master?.to || ntesTrain.DestinationName,
    scheduledArrival: scheduledArrival || (master?.arrival !== '--' ? master?.arrival : null) || null,
    scheduledDeparture: scheduledDeparture || (master?.departure !== '--' ? master?.departure : null) || null,
    expectedArrival: ntesTrain.ETA || scheduledArrival || null,
    expectedDeparture: ntesTrain.ETD || scheduledDeparture || null,
    platform: ntesTrain.Platform || master?.defaultPlatform || '-',
    status: buildStatus(ntesTrain),
    delay,
    runningState: getRunningState(ntesTrain),
    startDate: ntesTrain.StartDate || null,
    lastUpdated: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch live station board from NTES and map to display records.
 * Only returns trains in the current time window (NTES filters by hours).
 *
 * @param {string} stationCode - e.g. "CHZ"
 * @param {object[]} masterTrains - static master for name/route enrichment
 * @param {object} config - station config (lookAheadHours, etc.)
 * @returns {Promise<object[]>} Mapped train records
 */
async function fetchLiveBoard(stationCode, masterTrains, config = {}) {
  const hours = config.lookAheadHours || 4;
  const data = await fetchStationLive(stationCode, hours);

  const masterMap = {};
  for (const t of masterTrains) {
    masterMap[t.trainNo] = t;
  }

  const ntesTrains = data.TrainsAtStation || [];
  return ntesTrains.map((t) => mapNtesTrain(t, masterMap));
}

module.exports = {
  STATION_CODE,
  fetchLiveBoard,
  timeToMinutes,
  parseDelay,
  buildStatus,
  extractTime
};
