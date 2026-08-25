'use strict';

/**
 * Live-board window: feature coaches from T−showBefore until departure.
 * Once departure time has passed, the train is gone (hideAfterDepartMinutes = 0).
 */

function timeToMinutes(timeStr) {
  if (!timeStr || timeStr === '--') return null;
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesUntil(timeStr, now = new Date()) {
  const event = timeToMinutes(timeStr);
  if (event === null) return null;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let diff = event - nowMins;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

function hasDeparted(train, now = new Date()) {
  if (train.runningState === 'departed' || /depart/i.test(train.status || '')) return true;
  const dep = minutesUntil(train.expectedDeparture || train.scheduledDeparture, now);
  return dep != null && dep < 0;
}

/**
 * Pick primary train for a platform that is in the T−showBefore approach window
 * (or standing at the platform before departure).
 */
function pickTrainForPlatform(boardTrains, platform, showBeforeMinutes, hideAfterDepartMinutes, now = new Date()) {
  const pf = String(platform);
  const hideAfter = Number(hideAfterDepartMinutes) || 0;
  const candidates = (boardTrains || []).filter((t) => String(t.platform) === pf);

  const scored = [];
  for (const t of candidates) {
    const arr = minutesUntil(t.expectedArrival || t.scheduledArrival, now);
    const dep = minutesUntil(t.expectedDeparture || t.scheduledDeparture, now);
    const atPlatform = t.runningState === 'arrived' || /arriv/i.test(t.status || '');
    const departed = hasDeparted(t, now);

    let inWindow = false;
    let minutesUntilEvent = null;

    if (departed) {
      if (hideAfter > 0 && dep != null && -dep <= hideAfter) {
        inWindow = true;
        minutesUntilEvent = dep;
      }
    } else if (atPlatform && (dep == null || dep >= 0)) {
      inWindow = true;
      minutesUntilEvent = 0;
    } else {
      const soonest = [arr, dep].filter((x) => x != null && x >= 0);
      const minPos = soonest.length ? Math.min(...soonest) : null;
      if (minPos != null && minPos <= showBeforeMinutes) {
        inWindow = true;
        minutesUntilEvent = minPos;
      }
    }

    if (!inWindow) continue;

    scored.push({
      train: t,
      minutesUntil: minutesUntilEvent,
      priority: atPlatform ? 0 : 1,
      inWindow: true
    });
  }

  scored.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (a.minutesUntil ?? 999) - (b.minutesUntil ?? 999);
  });

  return scored[0] || null;
}

function hasRake(train) {
  if (!train) return false;
  if (train.compositionAvailable === true) return true;
  if (Array.isArray(train.coaches) && train.coaches.length) return true;
  if (Array.isArray(train.coachCodes) && train.coachCodes.length) return true;
  return false;
}

function nextOutsideWindow(boardTrains, platforms, showBeforeMinutes, hideAfterDepartMinutes, now = new Date()) {
  const shown = new Set();
  for (const pf of platforms) {
    const hit = pickTrainForPlatform(boardTrains, pf, showBeforeMinutes, hideAfterDepartMinutes, now);
    if (hit) shown.add(hit.train.trainNo);
  }

  const future = [];
  for (const t of boardTrains || []) {
    if (shown.has(t.trainNo)) continue;
    if (platforms.length && !platforms.includes(String(t.platform))) continue;
    if (hasDeparted(t, now)) continue;
    const arr = minutesUntil(t.expectedArrival || t.scheduledArrival, now);
    const dep = minutesUntil(t.expectedDeparture || t.scheduledDeparture, now);
    const m = [arr, dep].filter((x) => x != null && x >= 0);
    if (!m.length) continue;
    future.push({
      train: t,
      minutesUntil: Math.min(...m),
      hasRake: hasRake(t)
    });
  }
  future.sort((a, b) => a.minutesUntil - b.minutesUntil);
  const picked = future.find((x) => x.hasRake) || future[0];
  if (!picked) return null;
  const t = picked.train;
  return {
    trainNo: t.trainNo,
    trainName: t.trainName,
    platform: String(t.platform),
    expectedArrival: t.expectedArrival || t.scheduledArrival || null,
    expectedDeparture: t.expectedDeparture || t.scheduledDeparture || null,
    minutesUntil: picked.minutesUntil
  };
}

/**
 * Next train to feature: prefer T−showBefore (inWindow), else soonest future halt.
 */
function pickFocusTrain(boardTrains, platforms, showBeforeMinutes, hideAfterDepartMinutes, now = new Date()) {
  const list = boardTrains || [];
  const pfFilter = (platforms || []).map(String);
  const inWindow = [];
  const platformsToScan = pfFilter.length
    ? pfFilter
    : [...new Set(list.map((t) => String(t.platform)))];

  for (const pf of platformsToScan) {
    const hit = pickTrainForPlatform(list, pf, showBeforeMinutes, hideAfterDepartMinutes, now);
    if (hit) inWindow.push(hit);
  }
  inWindow.sort((a, b) => (a.minutesUntil ?? 999) - (b.minutesUntil ?? 999));
  if (inWindow[0]) return inWindow[0];

  const next = nextOutsideWindow(list, platformsToScan, showBeforeMinutes, hideAfterDepartMinutes, now);
  if (!next) return null;
  const train = list.find((t) => String(t.trainNo) === String(next.trainNo));
  return train
    ? { train, minutesUntil: next.minutesUntil, priority: 3, inWindow: false }
    : null;
}

function summarizeBoardTrains(boardTrains, now = new Date()) {
  const rows = (boardTrains || []).map((t) => {
    const arr = minutesUntil(t.expectedArrival || t.scheduledArrival, now);
    const dep = minutesUntil(t.expectedDeparture || t.scheduledDeparture, now);
    const positive = [arr, dep].filter((x) => x != null && x >= 0);
    const minutesUntilEvent = positive.length ? Math.min(...positive) : (dep ?? arr);
    return {
      trainNo: t.trainNo,
      trainName: t.trainName || '',
      from: t.from || t.source || null,
      to: t.to || t.destination || null,
      platform: String(t.platform),
      expectedArrival: t.expectedArrival || t.scheduledArrival || null,
      expectedDeparture: t.expectedDeparture || t.scheduledDeparture || null,
      status: t.status || '—',
      delay: t.delay ?? 0,
      runningState: t.runningState || null,
      minutesUntil: minutesUntilEvent,
      ad: t.expectedArrival || t.scheduledArrival ? (t.expectedDeparture || t.scheduledDeparture ? 'A/D' : 'A') : 'D'
    };
  });
  rows.sort((a, b) => (a.minutesUntil ?? 9999) - (b.minutesUntil ?? 9999));
  return rows;
}

module.exports = {
  timeToMinutes,
  minutesUntil,
  hasDeparted,
  hasRake,
  pickTrainForPlatform,
  nextOutsideWindow,
  pickFocusTrain,
  summarizeBoardTrains
};
