'use strict';

/**
 * Map NTES coach codes → typeId using coach_types.json codeRules.
 * Positions are 0-based to match NTES Coach Position / Divyangjan indices.
 */

function matchRule(code, rule) {
  const raw = String(code || '').trim().toUpperCase();
  const m = String(rule.match || '');
  if (m.startsWith('re:')) {
    try {
      return new RegExp(m.slice(3), 'i').test(raw);
    } catch {
      return false;
    }
  }
  return raw === m.toUpperCase();
}

function resolveTypeId(code, typesDoc) {
  const fallback = typesDoc.fallbackTypeId || 'unknown';
  const rules = typesDoc.codeRules || [];
  for (const rule of rules) {
    if (matchRule(code, rule)) return rule.typeId || fallback;
  }
  return fallback;
}

/**
 * @param {string[]} codes
 * @param {object} typesDoc
 * @param {{ classes?: string[], pwdPositions?: number[] }} [opts]
 */
function mapComposition(codes, typesDoc, opts = {}) {
  const list = Array.isArray(codes) ? codes : [];
  const classes = Array.isArray(opts.classes) ? opts.classes : [];
  const pwdSet = new Set(opts.pwdPositions || []);

  return list.map((code, i) => {
    const c = String(code || '').trim().toUpperCase() || `C${i}`;
    const classCode = classes[i] ? String(classes[i]).trim().toUpperCase() : null;
    let typeId = resolveTypeId(c, typesDoc);
    if (typeId === (typesDoc.fallbackTypeId || 'unknown') && classCode) {
      typeId = resolveTypeId(classCode, typesDoc);
    }
    const divyangjan = pwdSet.has(i) || /^SLRD$/i.test(c);
    return {
      seq: i + 1,
      position: i,
      code: c,
      classCode,
      typeId,
      label: c,
      divyangjan: Boolean(divyangjan)
    };
  });
}

function resolveYouAreHere(youAreHere, coaches, bogieLengthMeters) {
  if (!youAreHere || !youAreHere.platform) {
    return {
      enabled: false,
      slotIndex: null,
      metersFromEngineEnd: null,
      alignedCoachCode: null,
      facing: youAreHere?.facing || 'engine_left'
    };
  }

  const bogie = bogieLengthMeters || 25;
  let slotIndex =
    typeof youAreHere.slotIndex === 'number'
      ? youAreHere.slotIndex
      : Math.round((Number(youAreHere.metersFromEngineEnd) || 0) / bogie);

  if (coaches.length) {
    slotIndex = Math.max(0, Math.min(coaches.length - 1, slotIndex));
  } else {
    slotIndex = null;
  }

  return {
    enabled: true,
    slotIndex,
    metersFromEngineEnd:
      typeof youAreHere.metersFromEngineEnd === 'number'
        ? youAreHere.metersFromEngineEnd
        : slotIndex != null
          ? slotIndex * bogie
          : null,
    alignedCoachCode: slotIndex != null && coaches[slotIndex] ? coaches[slotIndex].code : null,
    facing: youAreHere.facing || 'engine_left'
  };
}

const WALK_SPEED_MPS = 0.65;

function attachWalkMetrics(coaches, youAreHere, bogieLengthMeters) {
  const bogie = bogieLengthMeters || 25;
  const pin = youAreHere?.enabled && youAreHere.slotIndex != null ? youAreHere.slotIndex : null;
  return (coaches || []).map((c) => {
    if (pin == null) {
      return { ...c, walkMeters: null, walkSeconds: null };
    }
    const slots = Math.abs((c.position ?? c.seq - 1) - pin);
    const walkMeters = slots * bogie;
    const walkSeconds = Math.round(walkMeters / WALK_SPEED_MPS);
    return { ...c, walkMeters, walkSeconds };
  });
}

module.exports = {
  resolveTypeId,
  mapComposition,
  resolveYouAreHere,
  attachWalkMetrics,
  WALK_SPEED_MPS
};
