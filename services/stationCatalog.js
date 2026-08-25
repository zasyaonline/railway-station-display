'use strict';

const fs = require('fs');
const path = require('path');

const STATIONS_PATH = path.join(__dirname, '..', 'data', 'stations.json');

function loadStationsMaster() {
  try {
    return JSON.parse(fs.readFileSync(STATIONS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function presetsFromMaster(master) {
  return Object.values(master || {}).map((s) => ({
    code: s.code,
    name: s.en || s.name || s.code,
    en: s.en || s.name || s.code,
    te: s.te || null,
    hi: s.hi || null
  }));
}

function normalizeStationName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[.]/g, '')
    .replace(/\bJUNCTION\b/g, 'JN')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compact lookup map for display localization: normalized English name → {en,te,hi}.
 */
function stationsByName(master) {
  const out = {};
  for (const s of Object.values(master || {})) {
    const entry = {
      code: s.code,
      en: s.en || s.name || s.code,
      te: s.te || null,
      hi: s.hi || null
    };
    const keys = new Set([
      normalizeStationName(entry.en),
      ...(s.aliases || []).map(normalizeStationName)
    ]);
    for (const key of keys) {
      if (key) out[key] = entry;
    }
  }
  return out;
}

/** @deprecated use presetsFromMaster — kept for callers without file access */
const STATION_PRESETS = presetsFromMaster(loadStationsMaster());

function normalizeStationCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function findPreset(code, master) {
  const normalized = normalizeStationCode(code);
  const src = master || loadStationsMaster();
  return src[normalized] || null;
}

/**
 * Resolve station for admin apply.
 * Prefer NTES English name; master TE/HI are separate.
 */
function resolveStationInput({ stationCode, stationName, ntesName }) {
  const code = normalizeStationCode(stationCode);
  if (!code || code.length < 2 || code.length > 6) {
    return { ok: false, error: 'stationCode must be 2–6 letters/digits (NTES code)' };
  }

  const preset = findPreset(code);
  const name = String(ntesName || stationName || '').trim() || preset?.en || code;

  return {
    ok: true,
    stationCode: code,
    stationName: name,
    fromPreset: Boolean(preset),
    te: preset?.te || null,
    hi: preset?.hi || null
  };
}

module.exports = {
  STATIONS_PATH,
  STATION_PRESETS,
  loadStationsMaster,
  presetsFromMaster,
  normalizeStationCode,
  normalizeStationName,
  stationsByName,
  findPreset,
  resolveStationInput
};
