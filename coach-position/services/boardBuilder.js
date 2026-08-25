'use strict';

const { mapComposition, resolveYouAreHere, attachWalkMetrics } = require('./coachMapper');
const {
  pickTrainForPlatform,
  nextOutsideWindow,
  pickFocusTrain,
  summarizeBoardTrains
} = require('./windowService');
const { resolveTravelHeading } = require('./headingService');

function resolveCoaches(train, typesDoc) {
  const codes = train.coachCodes || [];
  if (!codes.length) {
    return { coaches: [], source: null, pwdPositions: [] };
  }
  const pwdPositions = train.pwdPositions || [];
  const coaches = mapComposition(codes, typesDoc, {
    classes: train.coachClasses || [],
    pwdPositions
  });
  return {
    coaches,
    source: train.compositionSource || 'ntes-live-board',
    pwdPositions
  };
}

function buildPlatformStrip({
  pf,
  picked,
  display,
  typesDoc,
  bogie,
  stationLayout,
  showPin,
  alwaysPin
}) {
  if (!picked) {
    return {
      platform: String(pf),
      inWindow: false,
      train: null,
      compositionAvailable: false,
      coaches: [],
      divyangjanPositions: [],
      youAreHere: resolveYouAreHere(showPin ? display.youAreHere : null, [], bogie),
      nextLabel: null
    };
  }

  const t = picked.train;
  const { coaches: coachesMapped, source, pwdPositions } = resolveCoaches(t, typesDoc);

  const pinCfg =
    showPin &&
    display.youAreHere &&
    (alwaysPin || String(display.youAreHere.platform) === String(pf))
      ? { ...display.youAreHere, facing: display.youAreHere.facing || 'engine_left' }
      : null;

  const youAreHere = resolveYouAreHere(pinCfg, coachesMapped, bogie);
  if (!pinCfg) youAreHere.enabled = false;
  else youAreHere.platform = String(pf);

  const coaches = attachWalkMetrics(coachesMapped, youAreHere, bogie);
  const from = t.from || null;
  const to = t.to || null;
  const heading = resolveTravelHeading(from, to, stationLayout);
  const divyangjan = coaches.filter((c) => c.divyangjan);

  return {
    platform: String(pf),
    inWindow: picked.inWindow !== false,
    train: {
      trainNo: t.trainNo,
      trainName: t.trainName,
      platform: String(t.platform),
      from,
      to,
      expectedArrival: t.expectedArrival || t.scheduledArrival || null,
      expectedDeparture: t.expectedDeparture || t.scheduledDeparture || null,
      minutesUntil: picked.minutesUntil,
      status: t.status || null,
      delay: t.delay ?? 0
    },
    heading,
    compositionAvailable: coaches.length > 0,
    coaches,
    coachCount: coaches.length,
    compositionSource: source,
    divyangjanPositions: pwdPositions,
    divyangjanCoaches: divyangjan.map((c) => ({
      position: c.position,
      code: c.code,
      label: c.label
    })),
    youAreHere,
    nextLabel: null
  };
}

/**
 * Build /api/coach-board payload for a display profile from live (halt) trains only.
 */
async function buildCoachBoard({
  displaysDoc,
  typesDoc,
  displayId,
  boardTrains,
  stationLayout,
  dataSource
}) {
  const display =
    (displaysDoc.displays || []).find((d) => d.id === displayId) ||
    (displaysDoc.displays || [])[0];

  if (!display) {
    return { error: 'display_not_found', status: 404 };
  }

  const showBefore = displaysDoc.showBeforeMinutes ?? 10;
  const hideAfter = displaysDoc.hideAfterDepartMinutes ?? 0;
  const bogie = displaysDoc.bogieLengthMeters ?? 25;
  const platformsShown = display.platformsShown || [];
  const trains = boardTrains || [];

  const stationBoard = summarizeBoardTrains(trains);

  const boardRakes = {};
  for (const t of trains) {
    const { coaches: coachesMapped, source, pwdPositions } = resolveCoaches(t, typesDoc);
    const heading = resolveTravelHeading(t.from || null, t.to || null, stationLayout);
    const divyangjan = coachesMapped.filter((c) => c.divyangjan);
    boardRakes[String(t.trainNo)] = {
      trainNo: t.trainNo,
      trainName: t.trainName,
      platform: String(t.platform),
      from: t.from || null,
      to: t.to || null,
      expectedArrival: t.expectedArrival || t.scheduledArrival || null,
      expectedDeparture: t.expectedDeparture || t.scheduledDeparture || null,
      status: t.status || null,
      delay: t.delay ?? 0,
      runningState: t.runningState || null,
      heading,
      compositionAvailable: coachesMapped.length > 0,
      coaches: coachesMapped,
      coachCount: coachesMapped.length,
      compositionSource: source,
      divyangjanPositions: pwdPositions,
      divyangjanCoaches: divyangjan.map((c) => ({
        position: c.position,
        code: c.code,
        label: c.label
      }))
    };
  }

  const platforms = [];
  for (const pf of platformsShown) {
    const picked = pickTrainForPlatform(trains, pf, showBefore, hideAfter);
    platforms.push(
      buildPlatformStrip({
        pf,
        picked,
        display,
        typesDoc,
        bogie,
        stationLayout,
        showPin: true
      })
    );
  }

  // Next arrival for the whole station (all halting trains), not demo platforms only
  const focusPick = pickFocusTrain(trains, [], showBefore, hideAfter);
  let focus = null;
  if (focusPick) {
    focus = buildPlatformStrip({
      pf: focusPick.train.platform,
      picked: focusPick,
      display,
      typesDoc,
      bogie,
      stationLayout,
      showPin: true,
      alwaysPin: true
    });
    focus.featured = true;
  }

  const body = {
    stationCode: displaysDoc.stationCode,
    stationName: displaysDoc.stationName || displaysDoc.stationCode,
    generatedAt: new Date().toISOString(),
    dataSource: dataSource || 'ntes-live',
    showBeforeMinutes: showBefore,
    hideAfterDepartMinutes: hideAfter,
    lookAheadHours: displaysDoc.lookAheadHours ?? 4,
    bogieLengthMeters: bogie,
    walkSpeedMps: 0.65,
    languages: displaysDoc.languages || ['en', 'te', 'hi'],
    display: {
      id: display.id,
      name: display.name,
      mode: display.mode,
      platformsShown,
      facing: display.youAreHere?.facing || 'engine_left',
      youAreHere: display.youAreHere || null
    },
    stationBoard,
    boardRakes,
    focus,
    platforms
  };

  if (!focus) {
    body.idle = {
      message: 'No train in coach-display window',
      nextTrain: nextOutsideWindow(trains, [], showBefore, hideAfter)
    };
  }

  return { ok: true, body };
}

module.exports = { buildCoachBoard };
