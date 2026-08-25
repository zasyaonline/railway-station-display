'use strict';

/**
 * Resolve on-screen travel direction from train from/to vs station screen axis.
 * Composition is always engine-first; engineSide === 'right' means reverse for display.
 */

function norm(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function matchesSide(stationName, labels) {
  const n = norm(stationName);
  if (!n || !Array.isArray(labels)) return false;
  return labels.some((label) => {
    const L = norm(label);
    if (!L) return false;
    return n === L || n.includes(L) || L.includes(n);
  });
}

/**
 * @param {string|null} from
 * @param {string|null} to
 * @param {object|null} layout station_layout.json
 * @returns {{ direction: 'left'|'right'|'unknown', toward: string|null, from: string|null, engineSide: 'left'|'right' }}
 */
function resolveTravelHeading(from, to, layout) {
  const axis = layout?.screenAxis || {};
  const leftLabels = axis.leftToward || axis.leftLabels || [];
  const rightLabels = axis.rightToward || axis.rightLabels || [];

  let direction = 'unknown';
  if (matchesSide(to, rightLabels)) direction = 'right';
  else if (matchesSide(to, leftLabels)) direction = 'left';
  else if (matchesSide(from, leftLabels)) direction = 'right'; // came from left → continue right
  else if (matchesSide(from, rightLabels)) direction = 'left';

  return {
    direction,
    toward: to || null,
    from: from || null,
    engineSide: direction === 'right' ? 'right' : 'left'
  };
}

module.exports = { resolveTravelHeading, matchesSide, norm };
