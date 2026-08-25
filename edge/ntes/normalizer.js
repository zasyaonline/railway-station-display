'use strict';

const { mapNtesLiveTrain } = require('../../coach-position/services/liveBoardService');

function masterMapFrom(masterTrains = []) {
  const map = {};
  for (const t of masterTrains) {
    if (t?.trainNo) map[String(t.trainNo)] = t;
  }
  return map;
}

function enrichWithMaster(train, master) {
  if (!master) return train;
  return {
    ...train,
    trainName: master.trainName || train.trainName,
    from: master.from || train.from,
    to: master.to || train.to,
    platform:
      train.platform && train.platform !== '-'
        ? train.platform
        : master.defaultPlatform || train.platform
  };
}

function normalizeStationState(raw, { stationCode, masterTrains = [], fetchedAt } = {}) {
  const code = String(stationCode || raw?.Station || '').trim().toUpperCase();
  const rows = raw?.TrainsAtStation || raw?.trainsAtStation || [];
  const masters = masterMapFrom(masterTrains);
  const trains = rows.map((row) => {
    const mapped = mapNtesLiveTrain(row);
    return enrichWithMaster(mapped, masters[mapped.trainNo]);
  });
  return {
    stationCode: code,
    stationName: raw?.StationName || raw?.stationName || null,
    fetchedAt: fetchedAt || new Date().toISOString(),
    source: 'NTES',
    rawCount: rows.length,
    trains
  };
}

module.exports = {
  normalizeStationState,
  enrichWithMaster
};
