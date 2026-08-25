'use strict';

/**
 * NTES AppServAnd client — talks to the official Indian Railways mobile API.
 * Endpoint: POST https://enquiry.indianrail.gov.in/crisns/AppServAnd
 */

const { encryptPayload, decryptPayload } = require('./ntesCrypto');

const DEFAULT_BASE_URL = 'https://enquiry.indianrail.gov.in/crisns/AppServAnd';

function ntesBaseUrl() {
  return process.env.NTES_BASE_URL || DEFAULT_BASE_URL;
}
const USER_AGENT = 'Dalvik/2.1.0 (Linux; Android 11)';

async function ntesRequest(payloadStr, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(ntesBaseUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          charset: 'utf-8',
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({ jsonIn: encryptPayload(payloadStr) })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      if (!text.trim()) {
        throw new Error('Empty response from NTES');
      }

      const data = JSON.parse(text);
      const decoded = data.jsonIn ? decryptPayload(data.jsonIn) : data;

      const errorMsg =
        decoded?.AlertMsg ||
        decoded?.alertMsg ||
        decoded?.AlertMsgHindi ||
        decoded?.alertMsgHindi;

      if (errorMsg) {
        throw new Error(errorMsg);
      }

      return decoded;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Live station board — trains arriving/departing at a station within N hours.
 * This is the primary data source for the PDS (current-time trains only).
 */
async function fetchStationLive(stationCode, hours = 4) {
  const payload =
    `service=TrainRunningMob&subService=TrainsAtStationJson` +
    `&jStation=${stationCode}&nHr=${hours}&jToStation=`;
  return ntesRequest(payload);
}

/**
 * Validate station code via NTES and extract an English station name when present.
 * Returns { ok, stationCode, stationName, trainCount } or { ok:false, error }.
 */
async function resolveStationFromNtes(stationCode, hours = 2) {
  const code = String(stationCode || '').trim().toUpperCase();
  if (!code) {
    return { ok: false, error: 'stationCode required' };
  }

  let data;
  try {
    data = await fetchStationLive(code, hours);
  } catch (err) {
    return { ok: false, error: err.message || 'NTES lookup failed' };
  }

  const trains = data?.TrainsAtStation || data?.trainsAtStation || [];
  const name =
    data?.StationName ||
    data?.stationName ||
    data?.StnName ||
    data?.stnName ||
    data?.Station ||
    data?.jStationName ||
    null;

  // NTES may return an empty board for a valid quiet station — still OK
  return {
    ok: true,
    stationCode: code,
    stationName: name ? String(name).trim() : null,
    trainCount: Array.isArray(trains) ? trains.length : 0
  };
}

/**
 * Full running status for a single train (station-by-station timeline).
 */
async function fetchTrainRunning(trainNo, startDate) {
  const payload =
    `service=TrainRunningMob&subService=ShowFullRunJson` +
    `&trainNo=${trainNo}&startDate=${startDate}`;
  return ntesRequest(payload);
}

module.exports = {
  fetchStationLive,
  fetchTrainRunning,
  resolveStationFromNtes,
  ntesRequest,
  ntesBaseUrl,
  DEFAULT_BASE_URL
};
