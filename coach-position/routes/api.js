'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { buildCoachBoard } = require('../services/boardBuilder');
const { fetchLiveStationBoard } = require('../services/liveBoardService');
const { resolveStationFromNtes } = require('../../services/ntesClient');
const { isAppliance } = require('../../edge/runtime/mode');
const { requireAdmin: requireEdgeAdmin, loadAdminSecret } = require('../../edge/admin/auth');
const { readJson: readRuntimeJson } = require('../../edge/storage/atomic-file');
const { ntesStatePath } = require('../../shared/paths');
const { evaluateFromDisk, publicLicenceView } = require('../../edge/licence/licence-service');
const { loadConfig } = require('../../edge/config/config-service');
const { createLogger } = require('../../shared/logging');
const coachLog = createLogger('coach');
const {
  DEFAULT_STATION,
  INDEX_REL,
  LEGACY_DISPLAYS,
  normalizeStation,
  stationRel,
  emptyDisplaysDoc,
  withDefaultDisplay,
  upsertIndex,
  overlayDisplay
} = require('../services/stationStore');
const {
  emptyStore,
  touchSession,
  listActive,
  stopSession,
  stopAll,
  STALE_MS
} = require('../../services/sessionService');

function createApiRouter(deps) {
  const router = express.Router();
  const { dataDir, adminKey } = deps;
  const pinnedStation = typeof deps.pinnedStation === 'function' ? deps.pinnedStation : () => null;

  function readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  function writeJson(name, doc) {
    const full = path.join(dataDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(doc, null, 2) + '\n');
  }

  function readSessions() {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8'));
    } catch {
      return emptyStore();
    }
  }

  function writeSessions(store) {
    fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify(store, null, 2));
  }

  function registerViewer(req, res) {
    const sessionId = req.get('x-session-id') || req.query.sessionId || req.query.sid;
    if (!sessionId) return true;
    const result = touchSession(readSessions(), {
      id: String(sessionId),
      userAgent: req.get('user-agent') || ''
    });
    writeSessions(result.store);
    if (result.killed) {
      res.set('Cache-Control', 'no-store');
      res.status(409).json({
        error: 'session_stopped',
        message: 'This display session was stopped by an administrator'
      });
      return false;
    }
    return true;
  }

  function resolveCode(requested) {
    const pinned = pinnedStation();
    if (pinned) return normalizeStation(pinned);
    return normalizeStation(requested);
  }

  function currentLicence() {
    if (!isAppliance()) return { operational: true, blocked: false, state: 'VALID' };
    const cfg = loadConfig().config || {};
    return evaluateFromDisk({
      stationCode: cfg.stationCode,
      gracePeriodHours: cfg.licence?.gracePeriodHours,
      expiringWarningDays: cfg.licence?.expiringWarningDays,
      persist: false
    });
  }

  function licenceGate(res) {
    const evaluation = currentLicence();
    if (evaluation.blocked || evaluation.operational === false) {
      const view = publicLicenceView(evaluation);
      res.status(503).json({
        error: 'licence_blocked',
        state: evaluation.state,
        validUntil: view?.validUntil || null,
        daysLeft: view?.daysLeft ?? 0,
        message: evaluation.reason || 'Licence expired'
      });
      return false;
    }
    return true;
  }

  function requireAdmin(req, res) {
    if (isAppliance() || loadAdminSecret()) {
      return requireEdgeAdmin(req, res, coachLog);
    }
    const key = process.env.ADMIN_KEY || adminKey || 'coach-ops';
    const provided = req.get('x-admin-key') || req.query.adminKey || req.query.key || '';
    if (!provided || provided !== key) {
      res.status(401).json({ error: 'Admin key required' });
      return false;
    }
    return true;
  }

  function loadDisplaysDoc(code) {
    const rel = stationRel(code);
    const per = readJson(rel.displays, null);
    if (per) return per;
    if (rel.code === DEFAULT_STATION) {
      const legacy = readJson(LEGACY_DISPLAYS, null);
      if (legacy) return legacy;
    }
    return emptyDisplaysDoc(rel.code);
  }

  function saveDisplaysDoc(doc) {
    const rel = stationRel(doc.stationCode);
    writeJson(rel.displays, doc);
    const index = readJson(INDEX_REL, { stations: [] });
    writeJson(INDEX_REL, upsertIndex(index, rel.code));
    if (rel.code === DEFAULT_STATION) writeJson(LEGACY_DISPLAYS, doc);
  }

  router.get('/health', (req, res) => {
    const displays = loadDisplaysDoc(req.query.station || DEFAULT_STATION);
    const index = readJson(INDEX_REL, { stations: [displays.stationCode].filter(Boolean) });
    res.json({
      status: 'ok',
      app: 'coach-position',
      stationCode: displays.stationCode || null,
      stations: index.stations || [],
      dataSource: 'ntes-live',
      displayCount: (displays.displays || []).length,
      activeSessions: listActive(readSessions()).length
    });
  });

  router.get('/coach-board', async (req, res) => {
    if (!registerViewer(req, res)) return;
    if (!licenceGate(res)) return;
    const code = resolveCode(req.query.station);
    const displaysDoc = withDefaultDisplay(loadDisplaysDoc(code));
    displaysDoc.stationCode = code;
    const typesDoc = readJson('coach_types.json', { types: {}, codeRules: [] });
    const displayId = req.query.display || displaysDoc.displays?.[0]?.id;
    const stationLayout =
      readJson(stationRel(code).layout, null) || readJson('station_layout.json', null);
    const hours = displaysDoc.lookAheadHours || Number(process.env.COACH_LOOKAHEAD_HOURS) || 4;

    let live;
    if (isAppliance()) {
      const state = readRuntimeJson(ntesStatePath(), null);
      if (!state) {
        return res.status(503).json({
          error: 'ntes_state_unavailable',
          message: 'Waiting for NTES runtime state'
        });
      }
      live = {
        stationName: state.stationName,
        trains: state.trains || [],
        fetchedAt: state.fetchedAt
      };
    } else {
      try {
        live = await fetchLiveStationBoard(code, { lookAheadHours: hours });
      } catch (err) {
        return res.status(502).json({
          error: 'ntes_live_unavailable',
          message: err.message || 'Failed to fetch NTES live station board'
        });
      }
    }

    if (live.stationName && (!displaysDoc.stationName || displaysDoc.stationName === displaysDoc.stationCode)) {
      displaysDoc.stationName = live.stationName;
    }

    const result = await buildCoachBoard({
      displaysDoc,
      typesDoc,
      displayId,
      boardTrains: live.trains,
      stationLayout,
      dataSource: 'ntes-live'
    });

    if (result.error) return res.status(result.status || 500).json(result);
    result.body.liveFetchedAt = live.fetchedAt;
    result.body.liveTrainCount = live.trains.length;
    result.body.licence = publicLicenceView(currentLicence());
    writeJson(stationRel(code).board, result.body);
    res.set('Cache-Control', 'no-store');
    res.json(result.body);
  });

  async function resolveStationName(code, fallbackName) {
    const ntes = await resolveStationFromNtes(code);
    const fallback = String(fallbackName || '').trim();
    if (ntes.ok) {
      return {
        ok: true,
        stationCode: ntes.stationCode,
        stationName: ntes.stationName || fallback || code,
        trainCount: ntes.trainCount,
        source: ntes.stationName ? 'ntes' : (fallback ? 'manual' : 'code')
      };
    }
    if (fallback) {
      return {
        ok: true,
        stationCode: code,
        stationName: fallback,
        trainCount: 0,
        source: 'manual',
        warning: ntes.error || 'NTES lookup failed'
      };
    }
    return { ok: false, error: ntes.error || `NTES did not return a name for ${code}` };
  }

  router.get('/admin/station-lookup', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const code = String(req.query.code || req.query.stationCode || '').trim().toUpperCase();
    if (!code || code.length < 2) {
      return res.status(400).json({ error: 'Enter a 2–6 letter station code' });
    }
    const result = await resolveStationName(code);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(result);
  });

  async function handleGetDisplays(req, res) {
    if (!requireAdmin(req, res)) return;
    const code = resolveCode(req.query.station || req.query.stationCode);
    res.json(loadDisplaysDoc(code));
  }

  async function handleSaveDisplays(req, res) {
    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const code = resolveCode(
      body.stationCode || req.query.station || req.query.stationCode
    );
    const doc = withDefaultDisplay(loadDisplaysDoc(code));
    doc.stationCode = code;

    if (!isAppliance() && (body.stationCode || body.stationName)) {
      const resolved = await resolveStationName(code, body.stationName);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      doc.stationCode = resolved.stationCode;
      doc.stationName = resolved.stationName;
    } else if (isAppliance()) {
      const cfg = loadConfig().config || {};
      doc.stationCode = code;
      if (cfg.stationName) doc.stationName = cfg.stationName;
    }
    if (typeof body.bogieLengthMeters === 'number') doc.bogieLengthMeters = body.bogieLengthMeters;
    if (typeof body.showBeforeMinutes === 'number') doc.showBeforeMinutes = body.showBeforeMinutes;
    if (typeof body.hideAfterDepartMinutes === 'number') {
      doc.hideAfterDepartMinutes = body.hideAfterDepartMinutes;
    }
    if (typeof body.lookAheadHours === 'number') doc.lookAheadHours = body.lookAheadHours;
    if (Array.isArray(body.languages)) doc.languages = body.languages;

    if (body.display) {
      const display = body.display;
      if (!display.id) return res.status(400).json({ error: 'display.id required' });
      const id = String(display.id).toLowerCase();
      const next = {
        id,
        name: display.name || id,
        mode: display.mode === 'single' ? 'single' : 'dual',
        platformsShown: (display.platformsShown || []).map(String),
        youAreHere: display.youAreHere || undefined
      };
      const idx = (doc.displays || []).findIndex((d) => d.id === id);
      if (idx >= 0) doc.displays[idx] = { ...doc.displays[idx], ...next };
      else doc.displays.push(next);
    }

    saveDisplaysDoc(doc);
    res.json({
      ok: true,
      stationCode: doc.stationCode,
      stationName: doc.stationName,
      displays: doc.displays
    });
  }

  router.get('/admin/displays', handleGetDisplays);
  router.post('/admin/displays', handleSaveDisplays);
  router.get('/coach/displays', handleGetDisplays);
  router.post('/coach/displays', handleSaveDisplays);

  router.get('/admin/sessions', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sessions = listActive(readSessions());
    res.json({
      activeCount: sessions.length,
      sessions,
      staleAfterSeconds: Math.floor(STALE_MS / 1000)
    });
  });

  router.post('/admin/sessions/stop', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sessionId = req.body?.sessionId || req.body?.id;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const result = stopSession(readSessions(), String(sessionId));
    writeSessions(result.store);
    if (!result.found) return res.status(404).json({ error: 'Session not found' });
    res.json({ stopped: true, sessionId: String(sessionId) });
  });

  router.post('/admin/sessions/stop-all', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = stopAll(readSessions());
    writeSessions(result.store);
    res.json({ stopped: result.count, message: `Stopped ${result.count} session(s)` });
  });

  router.get('/coach-types', (req, res) => {
    res.json(readJson('coach_types.json', {}));
  });

  router.get('/coach/board', (req, res) => {
    const code = resolveCode(req.query.station);
    const rel = stationRel(code);
    const board =
      readJson(rel.board, null) ||
      (code === DEFAULT_STATION ? readJson('coach_board_cache.json', null) : null);
    if (!board) return res.status(404).json({ error: `No board cache for ${code}` });
    res.json(overlayDisplay(board, loadDisplaysDoc(code), req.query.display));
  });

  return router;
}

module.exports = createApiRouter;
