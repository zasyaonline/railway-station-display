'use strict';

const express = require('express');
const path = require('path');
const createApiRouter = require('./routes/api');
const { isAppliance, bindHost } = require('../edge/runtime/mode');
const { ensureRuntimeLayout } = require('../edge/runtime/layout');
const { startHeartbeat } = require('../edge/runtime/heartbeat');
const { createLogger } = require('../shared/logging');
const { loadConfig } = require('../edge/config/config-service');
const { evaluateFromDisk, publicLicenceView } = require('../edge/licence/licence-service');
const { readJson, atomicWriteJson } = require('../edge/storage/atomic-file');
const { ntesStatePath, coachDataDir } = require('../shared/paths');
const { watchJsonFile } = require('../edge/ntes/state-reader');
const { buildCoachBoard } = require('./services/boardBuilder');
const {
  stationRel,
  withDefaultDisplay,
  emptyDisplaysDoc
} = require('./services/stationStore');

const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const log = createLogger('coach');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const publicDir = path.join(__dirname, 'public');

function chartRedirect(req, res) {
  const prefix = String(req.headers['x-forwarded-prefix'] || '').replace(/\/$/, '')
    || (req.path.startsWith('/coach') ? '/coach' : '');
  res.redirect(302, `${prefix}/chart.html?station=BG&display=entrance-main`);
}

app.get(['/', '/index.html', '/premium.html'], chartRedirect);
app.get(['/coach', '/coach/', '/coach/index.html', '/coach/premium.html'], chartRedirect);
app.use('/coach', express.static(publicDir));
app.use(express.static(publicDir));
app.use('/data', express.static(DATA_DIR));

function pinnedStation() {
  if (!isAppliance()) return null;
  const loaded = loadConfig();
  return loaded.config?.stationCode || 'BG';
}

function coachLicence() {
  if (!isAppliance()) return { operational: true, blocked: false, state: 'VALID' };
  const cfg = loadConfig().config || {};
  return evaluateFromDisk({
    stationCode: cfg.stationCode,
    gracePeriodHours: cfg.licence?.gracePeriodHours,
    expiringWarningDays: cfg.licence?.expiringWarningDays,
    persist: false
  });
}

function loadDisplays(code) {
  const rel = stationRel(code);
  try {
    return JSON.parse(require('fs').readFileSync(path.join(DATA_DIR, rel.displays), 'utf8'));
  } catch {
    return emptyDisplaysDoc(code);
  }
}

async function rebuildBoardFromState(state) {
  if (!state?.trains) return;
  const evaluation = coachLicence();
  if (evaluation.blocked || evaluation.operational === false) return;
  const code = pinnedStation() || state.stationCode;
  const displaysDoc = withDefaultDisplay(loadDisplays(code));
  displaysDoc.stationCode = code;
  if (state.stationName) displaysDoc.stationName = state.stationName;
  let typesDoc = { types: {}, codeRules: [] };
  try {
    typesDoc = JSON.parse(require('fs').readFileSync(path.join(DATA_DIR, 'coach_types.json'), 'utf8'));
  } catch {
    /* ignore */
  }
  const stationLayout = (() => {
    try {
      return JSON.parse(
        require('fs').readFileSync(path.join(DATA_DIR, stationRel(code).layout), 'utf8')
      );
    } catch {
      return null;
    }
  })();
  const displayId = displaysDoc.displays?.[0]?.id;
  const result = await buildCoachBoard({
    displaysDoc,
    typesDoc,
    displayId,
    boardTrains: state.trains,
    stationLayout,
    dataSource: 'ntes-live'
  });
  if (result?.body) {
    result.body.licence = publicLicenceView(evaluation);
    const rel = stationRel(code);
    const full = path.join(DATA_DIR, rel.board);
    require('fs').mkdirSync(path.dirname(full), { recursive: true });
    require('fs').writeFileSync(full, `${JSON.stringify(result.body, null, 2)}\n`);
    try {
      atomicWriteJson(path.join(coachDataDir(), 'board.json'), result.body);
    } catch {
      /* ignore */
    }
  }
}

if (isAppliance()) {
  ensureRuntimeLayout();
  startHeartbeat('coach');
  const existing = readJson(ntesStatePath(), null);
  if (existing) rebuildBoardFromState(existing);
  watchJsonFile(ntesStatePath(), (state) => {
    rebuildBoardFromState(state).catch((err) => log.error(err.message));
  });
}

app.use(
  '/api',
  createApiRouter({
    dataDir: DATA_DIR,
    adminKey: process.env.ADMIN_KEY || 'coach-ops',
    appliance: isAppliance(),
    pinnedStation
  })
);

app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

const host = bindHost();
app.listen(PORT, host, () => {
  log.info(`Coach Position listening on http://${host}:${PORT}/coach`);
  log.info(`appliance=${isAppliance()}`);
});
