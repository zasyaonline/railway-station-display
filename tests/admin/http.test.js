'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasya-http-'));
process.env.ZASYA_RAILWAY_ROOT = root;
process.env.ZASYA_RAILWAY_ETC = path.join(root, 'etc');
process.env.ZASYA_RAILWAY_LOG = path.join(root, 'log');
fs.mkdirSync(process.env.ZASYA_RAILWAY_ETC, { recursive: true });

const { saveAdminSecret } = require('../../edge/admin/auth');
const { saveConfig } = require('../../edge/config/config-service');
const { createAdminApp } = require('../../edge/admin/server');

saveConfig({ stationCode: 'BG', stationName: 'Bhongir', licence: { gracePeriodHours: 1 } });
saveAdminSecret('test-admin-secret');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('admin mutation without credentials is rejected', async () => {
  const server = await listen(createAdminApp());
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/platforms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trainNo: '12345', platform: '3' })
  });
  assert.equal(res.status, 401);
  server.close();
});

test('health endpoint is public', async () => {
  const server = await listen(createAdminApp());
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.status);
  server.close();
});
