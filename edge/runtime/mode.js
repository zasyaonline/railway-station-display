'use strict';

function isAppliance() {
  return process.env.RAILWAY_APPLIANCE === '1' || Boolean(process.env.ZASYA_RAILWAY_ROOT);
}

function bindHost(fallback = '0.0.0.0') {
  if (process.env.BIND_HOST) return process.env.BIND_HOST;
  return isAppliance() ? '127.0.0.1' : fallback;
}

module.exports = { isAppliance, bindHost };
