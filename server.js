'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const createApiRouter = require('./routes/api');
const { fetchLiveBoard, STATION_CODE } = require('./services/railwayService');
const { isAppliance, bindHost } = require('./edge/runtime/mode');
const { readJson } = require('./edge/storage/atomic-file');
const { ntesStatePath, freshnessPath, platformDataDir } = require('./shared/paths');
const { watchJsonFile } = require('./edge/ntes/state-reader');
const { loadConfig } = require('./edge/config/config-service');
const { startHeartbeat } = require('./edge/runtime/heartbeat');
const { ensureRuntimeLayout } = require('./edge/runtime/layout');
const { evaluateFromDisk, isPassengerBlocked } = require('./edge/licence/licence-service');
const { createLogger } = require('./shared/logging');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const log = createLogger('platform');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

let cache = {
  boardTrains: [],
  config: {},
  lastUpdated: null,
  lastError: null,
  sourceStatus: null
};

let refreshTimer = null;
let stopWatch = null;

function getCache() {
  return cache;
}

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(
    path.join(DATA_DIR, 'config.json'),
    JSON.stringify(config, null, 2)
  );
}

function writeLiveStatus(boardTrains) {
  fs.writeFileSync(
    path.join(DATA_DIR, 'live_status.json'),
    JSON.stringify({ lastUpdated: cache.lastUpdated, trains: boardTrains }, null, 2)
  );
}

function applianceConfig() {
  const loaded = loadConfig();
  if (loaded.ok) return loaded.config;
  try {
    return loadJson('config.json');
  } catch {
    return { stationCode: STATION_CODE };
  }
}

function applyNtesState(state) {
  if (!state || !Array.isArray(state.trains)) return;
  const freshness = readJson(freshnessPath(), null);
  cache = {
    boardTrains: state.trains,
    config: {
      ...cache.config,
      stationCode: state.stationCode || cache.config.stationCode,
      stationName: state.stationName || cache.config.stationName
    },
    lastUpdated: state.fetchedAt || new Date().toISOString(),
    lastError: null,
    sourceStatus: freshness?.sourceStatus || 'fresh'
  };
}

function currentLicence() {
  if (!isAppliance()) return { operational: true, blocked: false, state: 'VALID' };
  const cfg = applianceConfig();
  return evaluateFromDisk({
    stationCode: cfg.stationCode,
    gracePeriodHours: cfg.licence?.gracePeriodHours,
    expiringWarningDays: cfg.licence?.expiringWarningDays
  });
}

async function refresh() {
  try {
    const config = loadJson('config.json');
    if (config.refreshEnabled === false) {
      log.info('refresh skipped (disabled)');
      return;
    }

    const master = loadJson('trains.json');
    const stationCode = config.stationCode || STATION_CODE;
    const boardTrains = await fetchLiveBoard(stationCode, master, config);

    cache = {
      boardTrains,
      config,
      lastUpdated: new Date().toISOString(),
      lastError: null,
      sourceStatus: 'fresh'
    };

    writeLiveStatus(boardTrains);
    log.info(`NTES ${stationCode} live board: ${boardTrains.length} trains`);
  } catch (err) {
    cache.lastError = err.message;
    log.error('Refresh failed', { error: err.message });
  }
}

function stopRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  log.info('refresh loop stopped');
}

async function startRefreshLoop() {
  stopRefreshLoop();
  if (isAppliance()) {
    log.info('appliance mode: NTES polling is owned by zasya-railway-ntes');
    return;
  }
  const config = loadJson('config.json');
  cache.config = config;

  if (config.refreshEnabled === false) {
    log.info('refresh disabled in config');
    return;
  }

  await refresh();
  const refreshMs = (config.refreshInterval || 30) * 1000;
  refreshTimer = setInterval(refresh, refreshMs);
  log.info(`refresh loop started (${config.refreshInterval}s)`);
}

function startFileConsumer() {
  const cfg = applianceConfig();
  cache.config = {
    ...(() => {
      try {
        return loadJson('config.json');
      } catch {
        return {};
      }
    })(),
    stationCode: cfg.stationCode,
    stationName: cfg.stationName
  };
  const existing = readJson(ntesStatePath(), null);
  if (existing) applyNtesState(existing);
  stopWatch = watchJsonFile(ntesStatePath(), (state) => applyNtesState(state));
}

if (isAppliance()) {
  ensureRuntimeLayout();
  startHeartbeat('platform');
  startFileConsumer();
} else {
  startRefreshLoop();
}

const publicDir = path.join(__dirname, 'public');
app.use('/platform', express.static(publicDir));
app.get('/platform', (req, res) => res.redirect('/platform/'));
app.use(express.static(publicDir));

const overridesPath = isAppliance()
  ? path.join(platformDataDir(), 'platform_overrides.json')
  : path.join(DATA_DIR, 'platform_overrides.json');
const sessionsPath = isAppliance()
  ? path.join(platformDataDir(), 'sessions.json')
  : path.join(DATA_DIR, 'sessions.json');

app.use('/api', createApiRouter({
  getCache,
  startRefresh: startRefreshLoop,
  stopRefresh: stopRefreshLoop,
  saveConfig,
  overridesPath,
  sessionsPath,
  appliance: isAppliance(),
  getLicence: currentLicence,
  pinnedStation: () => (isAppliance() ? applianceConfig().stationCode : null)
}));

app.get('/health', (req, res) => {
  res.redirect('/api/health');
});

const host = bindHost();
app.listen(PORT, host, () => {
  const config = cache.config.stationCode ? cache.config : loadJson('config.json');
  log.info(`PDS listening on http://${host}:${PORT}`);
  log.info(`Station ${config.stationCode} appliance=${isAppliance()}`);
});

process.on('exit', () => {
  if (stopWatch) stopWatch();
});
