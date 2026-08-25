'use strict';

const { timeToMinutes } = require('./railwayService');

/**
 * Determine if a train has departed and should be hidden from the board.
 */
function hasDeparted(train, hideAfterMinutes, now = new Date()) {
  const eventTime =
    train.expectedDeparture ||
    train.scheduledDeparture ||
    train.expectedArrival ||
    train.scheduledArrival;

  if (!eventTime) return false;

  const eventMins = timeToMinutes(eventTime);
  if (eventMins === null) return false;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const diff = eventMins - nowMins;

  // Tomorrow's train (late night board)
  if (diff < -720) return false;

  // Still within grace window — keep showing
  if (diff >= -hideAfterMinutes) return false;

  // Past grace window — hide departed or missed trains
  return true;
}

/**
 * Sort key — use expected departure, then arrival.
 */
function getSortMinutes(train, now = new Date()) {
  const time =
    train.expectedDeparture ??
    train.expectedArrival ??
    train.scheduledDeparture ??
    train.scheduledArrival;

  const mins = timeToMinutes(time);
  if (mins === null) return 99999;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  if (mins < nowMins - 720) return mins + 1440;
  return mins;
}

/**
 * Build the filtered display list from NTES live board data.
 * NTES already returns only current-window trains; we further:
 *   - hide departed trains after grace period
 *   - sort by next event time
 *   - limit to displayCount
 */
function buildDisplayList(boardTrains, config, overridesDoc) {
  const now = new Date();
  const hideAfter = config.hideDepartedAfterMinutes ?? 15;
  const displayCount = config.displayCount ?? 10;

  let list = boardTrains
    .filter((t) => t.status !== 'Cancelled')
    .filter((t) => !hasDeparted(t, hideAfter, now))
    .sort((a, b) => getSortMinutes(a, now) - getSortMinutes(b, now))
    .slice(0, displayCount);

  if (overridesDoc) {
    const { applyPlatformOverrides } = require('./platformOverrides');
    list = applyPlatformOverrides(list, overridesDoc);
  }

  return list;
}

module.exports = { buildDisplayList, hasDeparted, getSortMinutes };
