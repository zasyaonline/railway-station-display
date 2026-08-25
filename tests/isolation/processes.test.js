'use strict';

const http = require('http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('killing one process does not stop the other', async () => {
  const a = await start();
  const b = await start();
  const portA = a.address().port;
  const portB = b.address().port;
  a.close();
  const res = await fetch(`http://127.0.0.1:${portB}/`);
  assert.equal(res.status, 200);
  await assert.rejects(() => fetch(`http://127.0.0.1:${portA}/`));
  b.close();
});
