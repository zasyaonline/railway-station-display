'use strict';

const DEFAULT_STATION = 'BG';
const DEFAULT_DISPLAY = 'entrance-main';
const INDEX_REL = 'station_index.json';
const LEGACY_DISPLAYS = 'coach_displays.json';
const LEGACY_BOARD = 'coach_board_cache.json';
const TYPES_REL = 'coach_types.json';

function normalizeStation(code) {
  const c = String(code || DEFAULT_STATION).trim().toUpperCase();
  return c || DEFAULT_STATION;
}

function stationRel(code) {
  const c = normalizeStation(code);
  return {
    code: c,
    displays: `stations/${c}/displays.json`,
    board: `stations/${c}/board.json`,
    layout: `stations/${c}/layout.json`
  };
}

function s3Key(rel) {
  return `data/${String(rel).replace(/^data\//, '')}`;
}

function emptyDisplaysDoc(code, name) {
  const stationCode = normalizeStation(code);
  return {
    stationCode,
    stationName: name || stationCode,
    bogieLengthMeters: 25,
    showBeforeMinutes: 10,
    hideAfterDepartMinutes: 0,
    lookAheadHours: 4,
    languages: ['en', 'te', 'hi'],
    displays: []
  };
}

function withDefaultDisplay(doc) {
  if (doc.displays && doc.displays.length) return doc;
  doc.displays = [
    {
      id: DEFAULT_DISPLAY,
      name: 'Main entrance TV',
      mode: 'dual',
      platformsShown: ['1', '2']
    }
  ];
  return doc;
}

function upsertIndex(index, code) {
  const next = new Set(
    (index && index.stations ? index.stations : []).map((s) => String(s).toUpperCase())
  );
  next.add(normalizeStation(code));
  return { stations: [...next].sort() };
}

function overlayDisplay(board, displaysDoc, displayId) {
  if (!board) return board;
  const wanted = String(displayId || DEFAULT_DISPLAY);
  const display =
    (displaysDoc?.displays || []).find((d) => d.id === wanted) ||
    (displaysDoc?.displays || [])[0] ||
    board.display;
  if (!display) return board;
  return {
    ...board,
    display: {
      id: display.id,
      name: display.name,
      mode: display.mode,
      platformsShown: display.platformsShown || [],
      facing: display.youAreHere?.facing || 'engine_left',
      youAreHere: display.youAreHere || null
    }
  };
}

module.exports = {
  DEFAULT_STATION,
  DEFAULT_DISPLAY,
  INDEX_REL,
  LEGACY_DISPLAYS,
  LEGACY_BOARD,
  TYPES_REL,
  normalizeStation,
  stationRel,
  s3Key,
  emptyDisplaysDoc,
  withDefaultDisplay,
  upsertIndex,
  overlayDisplay
};
