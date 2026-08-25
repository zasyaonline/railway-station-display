'use strict';

const express = require('express');
const path = require('path');
const { createLogger } = require('../../shared/logging');
const { bindHost, isAppliance } = require('../runtime/mode');
const { ensureRuntimeLayout } = require('../runtime/layout');
const { startHeartbeat } = require('../runtime/heartbeat');
const { loadConfig } = require('../config/config-service');
const { collectHealth } = require('../health/health-service');
const { evaluateFromDisk, isPassengerBlocked } = require('../licence/licence-service');
const { requireAdmin, providedKey } = require('./auth');
const { recordAudit, readAuditTail } = require('../audit/audit-service');
const { exportPackage, restorePackage } = require('../backup/backup-service');

const log = createLogger('admin');

function platformPort(config) {
  return Number(process.env.PLATFORM_PORT || config.ports?.platform || 3000);
}

function coachPort(config) {
  return Number(process.env.COACH_PORT || config.ports?.coach || 3001);
}

async function proxyTo(port, reqPath, { method = 'GET', body, adminKey }) {
  const url = `http://127.0.0.1:${port}${reqPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Admin-Key': adminKey || ''
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function licenceEvaluation(config) {
  return evaluateFromDisk({
    stationCode: config.stationCode,
    gracePeriodHours: config.licence?.gracePeriodHours,
    expiringWarningDays: config.licence?.expiringWarningDays
  });
}

function createAdminApp() {
  ensureRuntimeLayout();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/admin', express.static(path.join(__dirname, 'public')));
  app.get('/admin', (req, res) => {
    res.redirect('/admin/');
  });

  app.get('/health', (req, res) => {
    res.json(collectHealth());
  });

  app.get('/api/edge/status', (req, res) => {
    res.json(collectHealth());
  });

  app.get('/api/licence/status', (req, res) => {
    const loaded = loadConfig();
    const evaluation = licenceEvaluation(loaded.config || {});
    res.json({
      state: evaluation.state,
      operational: evaluation.operational,
      blocked: isPassengerBlocked(evaluation),
      reason: evaluation.reason,
      stationCode: evaluation.licence?.stationCode || null,
      products: evaluation.licence?.products || [],
      validUntil: evaluation.licence?.validUntil || null
    });
  });

  app.get('/api/admin/status', (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    const loaded = loadConfig();
    const health = collectHealth({ config: loaded });
    res.json({
      ...health,
      actor: 'local-admin',
      appliance: isAppliance()
    });
  });

  app.get('/api/admin/audit', (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    res.json({ events: readAuditTail(100) });
  });

  app.get('/api/admin/platforms', async (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    const loaded = loadConfig();
    try {
      const result = await proxyTo(platformPort(loaded.config), '/api/admin/platforms', {
        adminKey: providedKey(req)
      });
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/admin/platforms', async (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    const loaded = loadConfig();
    try {
      const result = await proxyTo(platformPort(loaded.config), '/api/admin/platforms', {
        method: 'POST',
        body: req.body,
        adminKey: providedKey(req)
      });
      if (result.status < 400) {
        recordAudit({
          action: 'platform_override',
          details: { trainNo: req.body?.trainNo, platform: req.body?.platform }
        });
      }
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/admin/platforms/clear', async (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    const loaded = loadConfig();
    try {
      const result = await proxyTo(platformPort(loaded.config), '/api/admin/platforms/clear', {
        method: 'POST',
        body: req.body,
        adminKey: providedKey(req)
      });
      if (result.status < 400) {
        recordAudit({
          action: 'platform_override_clear',
          details: { trainNo: req.body?.trainNo, all: Boolean(req.body?.all) }
        });
      }
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/admin/displays', async (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    const loaded = loadConfig();
    const code = loaded.config?.stationCode || '';
    try {
      const result = await proxyTo(
        coachPort(loaded.config),
        `/api/admin/displays?station=${encodeURIComponent(code)}`,
        { adminKey: providedKey(req) }
      );
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/admin/displays', async (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    const loaded = loadConfig();
    const body = { ...req.body, stationCode: loaded.config?.stationCode };
    try {
      const result = await proxyTo(coachPort(loaded.config), '/api/admin/displays', {
        method: 'POST',
        body,
        adminKey: providedKey(req)
      });
      if (result.status < 400) {
        recordAudit({ action: 'coach_display_update', details: { display: body.display } });
      }
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/admin/backup', (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    try {
      const result = exportPackage();
      recordAudit({ action: 'config_export', details: { dest: result.dest } });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/restore', (req, res) => {
    if (!requireAdmin(req, res, log)) return;
    if (!req.body?.path) return res.status(400).json({ error: 'path required' });
    try {
      const result = restorePackage(req.body.path);
      recordAudit({ action: 'config_restore', details: { path: req.body.path } });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return app;
}

function startAdminServer() {
  const loaded = loadConfig();
  const port = Number(process.env.ADMIN_PORT || loaded.config?.ports?.admin || 3002);
  const host = bindHost('127.0.0.1');
  const app = createAdminApp();
  startHeartbeat('admin');
  app.listen(port, host, () => {
    log.info(`Admin listening on http://${host}:${port}/admin`);
  });
}

if (require.main === module) {
  startAdminServer();
}

module.exports = { createAdminApp, startAdminServer };
