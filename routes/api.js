'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { buildDisplayList } = require('../services/mergeService');
const {
  emptyStore,
  touchSession,
  listActive,
  stopSession,
  stopAll,
  STALE_MS
} = require('../services/sessionService');
const {
  loadStationsMaster,
  presetsFromMaster,
  resolveStationInput,
  findPreset,
  normalizeStationCode,
  stationsByName
} = require('../services/stationCatalog');
const { resolveStationFromNtes } = require('../services/ntesClient');
const {
  emptyOverrides,
  normalizeOverrides,
  pruneOverrides,
  setOverride,
  clearOverride,
  clearAllOverrides
} = require('../services/platformOverrides');

const { isAppliance } = require('../edge/runtime/mode');
const { requireAdmin: requireEdgeAdmin, loadAdminSecret } = require('../edge/admin/auth');
const { createLogger } = require('../shared/logging');
const adminLog = createLogger('platform');

function createApiRouter(deps) {
  const router = express.Router();
  const { getCache, startRefresh, stopRefresh, saveConfig } = deps;
  const dataDir = path.join(__dirname, '..', 'data');
  const sessionsPath = deps.sessionsPath || path.join(dataDir, 'sessions.json');
  const overridesPath = deps.overridesPath || path.join(dataDir, 'platform_overrides.json');
  const adminKey = process.env.ADMIN_KEY || (isAppliance() || loadAdminSecret() ? null : 'chz-ops');
  const getLicence = deps.getLicence || (() => ({ operational: true, blocked: false }));

  function readSessions() {
    try {
      return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    } catch {
      return emptyStore();
    }
  }

  function writeSessions(store) {
    try {
      fs.mkdirSync(path.dirname(sessionsPath), { recursive: true });
      fs.writeFileSync(sessionsPath, JSON.stringify(store, null, 2));
    } catch (err) {
      adminLog.warn('session write failed', { error: err.message, sessionsPath });
    }
  }

  function readOverrides() {
    try {
      return normalizeOverrides(JSON.parse(fs.readFileSync(overridesPath, 'utf8')));
    } catch {
      return emptyOverrides();
    }
  }

  function writeOverrides(doc) {
    fs.writeFileSync(overridesPath, JSON.stringify(normalizeOverrides(doc), null, 2));
  }

  function stationLocales(code, englishName) {
    const row = findPreset(code);
    return {
      en: row?.en || englishName || code,
      te: row?.te || null,
      hi: row?.hi || null
    };
  }

  function requireAdmin(req, res) {
    if (isAppliance() || loadAdminSecret()) {
      return requireEdgeAdmin(req, res, adminLog);
    }
    const provided = req.get('x-admin-key') || req.query.adminKey || req.query.key || '';
    if (!provided || provided !== adminKey) {
      res.status(401).json({ error: 'Admin key required' });
      return false;
    }
    return true;
  }

  function registerViewer(req, res) {
    const sessionId = req.get('x-session-id') || req.query.sessionId || req.query.sid;
    if (!sessionId) return true;

    const store = readSessions();
    const result = touchSession(store, {
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

  router.get('/trains', (req, res) => {
    if (!registerViewer(req, res)) return;

    const licence = getLicence();
    if (licence.blocked || licence.operational === false) {
      return res.status(503).json({
        error: 'licence_blocked',
        state: licence.state,
        message: licence.reason || 'Licence does not allow passenger display'
      });
    }

    const cache = getCache();
    if (!cache.boardTrains) {
      return res.status(503).json({ error: 'Data not yet loaded' });
    }

    let overrides = readOverrides();
    const trains = buildDisplayList(cache.boardTrains, cache.config, overrides);
    const pruned = pruneOverrides(overrides, trains.map((t) => t.trainNo));
    if (Object.keys(pruned.overrides).length !== Object.keys(overrides.overrides || {}).length) {
      writeOverrides(pruned);
      overrides = pruned;
    }

    res.json({
      stationCode: cache.config.stationCode,
      stationName: cache.config.stationName,
      stationNames: stationLocales(cache.config.stationCode, cache.config.stationName),
      stationsByName: stationsByName(loadStationsMaster()),
      lastUpdated: cache.lastUpdated,
      refreshInterval: cache.config.refreshInterval,
      refreshEnabled: cache.config.refreshEnabled !== false,
      pageSize: cache.config.pageSize ?? 6,
      pageIntervalSeconds: cache.config.pageIntervalSeconds ?? 10,
      languageRotateSeconds: cache.config.languageRotateSeconds ?? 10,
      languages: cache.config.languages || ['en', 'te', 'hi'],
      source: cache.sourceStatus === 'stale' ? 'NTES Live Station (stale)' : 'NTES Live Station',
      sourceStatus: cache.sourceStatus || 'fresh',
      trains
    });
  });

  router.get('/refresh/status', (req, res) => {
    const cache = getCache();
    res.json({
      refreshEnabled: cache.config.refreshEnabled !== false,
      refreshInterval: cache.config.refreshInterval || 30
    });
  });

  router.post('/refresh/start', async (req, res) => {
    const cache = getCache();
    cache.config.refreshEnabled = true;
    saveConfig(cache.config);
    await startRefresh();
    res.json({ refreshEnabled: true, message: 'Refresh started' });
  });

  router.post('/refresh/stop', (req, res) => {
    const cache = getCache();
    cache.config.refreshEnabled = false;
    saveConfig(cache.config);
    stopRefresh();
    res.json({ refreshEnabled: false, message: 'Refresh stopped' });
  });

  router.get('/station-lookup', async (req, res) => {
    const code = String(req.query.code || req.query.stationCode || '').trim().toUpperCase();
    if (!code || code.length < 2) {
      return res.status(400).json({ error: 'Enter a 2–6 letter station code' });
    }
    const ntes = await resolveStationFromNtes(code);
    if (!ntes.ok) {
      return res.status(404).json({ error: ntes.error || `NTES did not return a name for ${code}` });
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      stationCode: ntes.stationCode,
      stationName: ntes.stationName || code,
      trainCount: ntes.trainCount,
      source: 'ntes'
    });
  });

  router.get('/health', (req, res) => {
    const cache = getCache();
    const sessions = listActive(readSessions());
    const overrides = readOverrides();
    res.json({
      status: 'ok',
      refreshEnabled: cache.config.refreshEnabled !== false,
      boardTrainCount: cache.boardTrains?.length ?? 0,
      displayTrainCount: buildDisplayList(cache.boardTrains || [], cache.config || {}, overrides).length,
      activeSessions: sessions.length,
      lastUpdated: cache.lastUpdated,
      stationCode: cache.config?.stationCode,
      stationName: cache.config?.stationName
    });
  });

  router.get('/admin/sessions', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const cache = getCache();
    const sessions = listActive(readSessions());
    const stations = loadStationsMaster();
    res.json({
      activeCount: sessions.length,
      sessions,
      refreshEnabled: cache.config.refreshEnabled !== false,
      refreshInterval: cache.config.refreshInterval || 30,
      staleAfterSeconds: Math.floor(STALE_MS / 1000),
      stationCode: cache.config.stationCode || 'CHZ',
      stationName: cache.config.stationName || 'Charlapalli',
      stationPresets: presetsFromMaster(stations),
      stationNames: stationLocales(cache.config.stationCode, cache.config.stationName),
      stationPinned: Boolean(deps.pinnedStation && deps.pinnedStation())
    });
  });

  router.post('/admin/station', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (deps.pinnedStation && deps.pinnedStation()) {
      return res.status(403).json({
        error: 'station_pinned',
        message: 'Station identity is set at installation and cannot be changed at runtime'
      });
    }
    const code = normalizeStationCode(req.body?.stationCode);
    const ntes = await resolveStationFromNtes(code);
    if (!ntes.ok) {
      return res.status(400).json({ error: ntes.error || 'Invalid station code' });
    }

    const master = findPreset(code);
    const englishName = ntes.stationName || master?.en || null;
    if (!englishName) {
      return res.status(400).json({
        error: 'Station code not recognized by NTES (no English name returned)'
      });
    }

    const resolved = resolveStationInput({
      stationCode: code,
      ntesName: englishName
    });
    if (!resolved.ok) {
      return res.status(400).json({ error: resolved.error });
    }

    const cache = getCache();
    cache.config.stationCode = resolved.stationCode;
    cache.config.stationName = resolved.stationName;
    saveConfig(cache.config);

    let refresh = null;
    try {
      if (cache.config.refreshEnabled !== false) {
        await startRefresh();
        refresh = { ok: true, lastUpdated: getCache().lastUpdated };
      } else {
        refresh = { ok: false, reason: 'refresh disabled' };
      }
    } catch (err) {
      refresh = { ok: false, reason: err.message };
    }

    res.json({
      stationCode: cache.config.stationCode,
      stationName: cache.config.stationName,
      stationNames: stationLocales(cache.config.stationCode, cache.config.stationName),
      ntesTrainCount: ntes.trainCount,
      message: `Station set to ${cache.config.stationName} (${cache.config.stationCode})`,
      refresh
    });
  });

  router.get('/admin/platforms', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const cache = getCache();
    let overrides = readOverrides();
    const display = buildDisplayList(cache.boardTrains || [], cache.config || {}, overrides);
    const pruned = pruneOverrides(overrides, display.map((t) => t.trainNo));
    if (Object.keys(pruned.overrides).length !== Object.keys(overrides.overrides || {}).length) {
      writeOverrides(pruned);
      overrides = pruned;
    }
    res.json({
      stationCode: cache.config?.stationCode,
      trains: display.map((t) => ({
        trainNo: t.trainNo,
        trainName: t.trainName,
        ntesPlatform: t.ntesPlatform || t.platform,
        platform: t.platform,
        platformOverridden: Boolean(t.platformOverridden),
        status: t.status
      })),
      overrides: overrides.overrides || {}
    });
  });

  router.post('/admin/platforms', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const current = readOverrides();
    const result = setOverride(current, req.body?.trainNo, req.body?.platform, req.body?.note);
    if (!result.ok) return res.status(400).json({ error: result.error });
    writeOverrides(result.doc);
    res.json({
      ok: true,
      trainNo: result.trainNo,
      override: result.override,
      overrides: result.doc.overrides
    });
  });

  router.post('/admin/platforms/clear', (req, res) => {
    if (!requireAdmin(req, res)) return;
    let doc;
    if (req.body?.all) {
      doc = clearAllOverrides().doc;
    } else {
      const current = readOverrides();
      const result = clearOverride(current, req.body?.trainNo);
      if (!result.ok) return res.status(400).json({ error: result.error });
      doc = result.doc;
    }
    writeOverrides(doc);
    res.json({ ok: true, overrides: doc.overrides });
  });

  router.post('/admin/sessions/stop', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sessionId = req.body?.sessionId || req.body?.id;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    const store = readSessions();
    const result = stopSession(store, String(sessionId));
    writeSessions(result.store);
    if (!result.found) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ stopped: true, sessionId: String(sessionId) });
  });

  router.post('/admin/sessions/stop-all', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const store = readSessions();
    const result = stopAll(store);
    writeSessions(result.store);
    res.json({ stopped: result.count, message: `Stopped ${result.count} session(s)` });
  });

  return router;
}

module.exports = createApiRouter;
