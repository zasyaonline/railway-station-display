'use strict';

const OVERRIDES_KEY = 'data/platform_overrides.json';

function emptyOverrides() {
  return { overrides: {} };
}

function normalizeOverrides(raw) {
  if (!raw || typeof raw !== 'object') return emptyOverrides();
  if (!raw.overrides || typeof raw.overrides !== 'object') return emptyOverrides();
  return raw;
}

function applyPlatformOverrides(trains, overridesDoc) {
  const overrides = normalizeOverrides(overridesDoc).overrides;
  return (trains || []).map((train) => {
    const key = String(train.trainNo);
    const ov = overrides[key];
    if (!ov || ov.platform == null || ov.platform === '') {
      return { ...train, platformOverridden: false };
    }
    return {
      ...train,
      platform: String(ov.platform),
      ntesPlatform: train.platform,
      platformOverridden: true
    };
  });
}

function pruneOverrides(overridesDoc, activeTrainNos) {
  const doc = normalizeOverrides(overridesDoc);
  const active = new Set((activeTrainNos || []).map(String));
  const next = {};
  for (const [trainNo, value] of Object.entries(doc.overrides)) {
    if (active.has(String(trainNo))) {
      next[trainNo] = value;
    }
  }
  return { overrides: next };
}

function setOverride(overridesDoc, trainNo, platform, note) {
  const doc = normalizeOverrides(overridesDoc);
  const key = String(trainNo).trim();
  if (!key) {
    return { ok: false, error: 'trainNo required' };
  }
  const pf = String(platform || '').trim();
  if (!pf) {
    return { ok: false, error: 'platform required' };
  }
  doc.overrides[key] = {
    platform: pf,
    setAt: new Date().toISOString(),
    note: note ? String(note).slice(0, 120) : undefined
  };
  if (!doc.overrides[key].note) delete doc.overrides[key].note;
  return { ok: true, doc, trainNo: key, override: doc.overrides[key] };
}

function clearOverride(overridesDoc, trainNo) {
  const doc = normalizeOverrides(overridesDoc);
  const key = String(trainNo || '').trim();
  if (!key) {
    return { ok: false, error: 'trainNo required' };
  }
  const existed = Boolean(doc.overrides[key]);
  delete doc.overrides[key];
  return { ok: true, doc, trainNo: key, cleared: existed };
}

function clearAllOverrides() {
  return { ok: true, doc: emptyOverrides() };
}

module.exports = {
  OVERRIDES_KEY,
  emptyOverrides,
  normalizeOverrides,
  applyPlatformOverrides,
  pruneOverrides,
  setOverride,
  clearOverride,
  clearAllOverrides
};
