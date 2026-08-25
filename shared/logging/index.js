'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { logDir } = require('../paths');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function writableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch {
    const fallback = path.join(os.tmpdir(), 'zasya-railway-logs');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function rotateIfNeeded(filePath, maxBytes, maxFiles) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return;
  }
  if (stat.size < maxBytes) return;

  for (let i = maxFiles - 1; i >= 1; i -= 1) {
    const src = `${filePath}.${i}`;
    const dest = `${filePath}.${i + 1}`;
    if (fs.existsSync(src)) {
      if (i + 1 > maxFiles) {
        fs.unlinkSync(src);
      } else {
        fs.renameSync(src, dest);
      }
    }
  }
  if (fs.existsSync(`${filePath}.${maxFiles}`)) {
    fs.unlinkSync(`${filePath}.${maxFiles}`);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function createLogger(name, options = {}) {
  const maxBytes = options.maxBytes || 5 * 1024 * 1024;
  const maxFiles = options.maxFiles || 5;
  const minLevel = LEVELS[options.level || process.env.LOG_LEVEL || 'info'] || LEVELS.info;
  const dir = writableDir(options.dir || logDir());
  const filePath = path.join(dir, `${name}.log`);

  function write(level, message, extra) {
    if (LEVELS[level] < minLevel) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: level.toUpperCase(),
      logger: name,
      message: String(message),
      ...(extra && typeof extra === 'object' ? extra : extra ? { extra } : {})
    });
    try {
      rotateIfNeeded(filePath, maxBytes, maxFiles);
      fs.appendFileSync(filePath, `${line}\n`);
    } catch (err) {
      process.stderr.write(`[${name}] log write failed: ${err.message}\n`);
    }
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }

  return {
    debug: (msg, extra) => write('debug', msg, extra),
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra)
  };
}

module.exports = { createLogger, rotateIfNeeded };
