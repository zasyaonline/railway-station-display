'use strict';

const fs = require('fs');
const { readJson } = require('../storage/atomic-file');

function watchJsonFile(filePath, onChange, { intervalMs = 2000 } = {}) {
  let lastMtimeMs = 0;
  let lastSize = -1;
  let closed = false;
  let watcher = null;

  function emit() {
    if (closed) return;
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (stat.mtimeMs === lastMtimeMs && stat.size === lastSize) return;
    lastMtimeMs = stat.mtimeMs;
    lastSize = stat.size;
    const data = readJson(filePath, null);
    if (data) onChange(data, filePath);
  }

  try {
    watcher = fs.watch(filePath, { persistent: false }, () => emit());
  } catch {
    watcher = null;
  }

  const timer = setInterval(emit, intervalMs);
  if (timer.unref) timer.unref();
  emit();

  return function stop() {
    closed = true;
    clearInterval(timer);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
  };
}

module.exports = { watchJsonFile };
