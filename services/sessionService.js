'use strict';

/** Sessions idle longer than this are treated as gone. */
const STALE_MS = 90_000;
const PRUNE_MS = 24 * 60 * 60 * 1000;
const SESSIONS_KEY = 'data/sessions.json';

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { sessions: {} };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object' || !raw.sessions || typeof raw.sessions !== 'object') {
    return emptyStore();
  }
  return raw;
}

function prune(store, now = Date.now()) {
  for (const [id, session] of Object.entries(store.sessions)) {
    const ref = Date.parse(session.killedAt || session.lastSeenAt || 0);
    if (!Number.isFinite(ref) || now - ref > PRUNE_MS) {
      delete store.sessions[id];
    }
  }
  return store;
}

function touchSession(store, { id, userAgent }) {
  store = prune(normalizeStore(store));
  const existing = store.sessions[id];

  if (existing?.killedAt) {
    return { store, killed: true, session: existing };
  }

  const session = {
    id,
    startedAt: existing?.startedAt || nowIso(),
    lastSeenAt: nowIso(),
    userAgent: userAgent || existing?.userAgent || '',
    killedAt: null
  };
  store.sessions[id] = session;
  return { store, killed: false, session };
}

function annotate(session, now = Date.now()) {
  const started = Date.parse(session.startedAt);
  const lastSeen = Date.parse(session.lastSeenAt);
  return {
    id: session.id,
    startedAt: session.startedAt,
    lastSeenAt: session.lastSeenAt,
    userAgent: session.userAgent || '',
    durationSeconds: Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0,
    idleSeconds: Number.isFinite(lastSeen) ? Math.max(0, Math.floor((now - lastSeen) / 1000)) : 0
  };
}

function listActive(store, now = Date.now()) {
  store = normalizeStore(store);
  return Object.values(store.sessions)
    .filter((session) => {
      if (session.killedAt) return false;
      const lastSeen = Date.parse(session.lastSeenAt);
      return Number.isFinite(lastSeen) && now - lastSeen < STALE_MS;
    })
    .map((session) => annotate(session, now))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

function stopSession(store, id) {
  store = prune(normalizeStore(store));
  const session = store.sessions[id];
  if (!session) {
    return { store, found: false };
  }
  if (!session.killedAt) {
    session.killedAt = nowIso();
  }
  return { store, found: true, session };
}

function stopAll(store) {
  store = prune(normalizeStore(store));
  const stamp = nowIso();
  let count = 0;
  for (const session of Object.values(store.sessions)) {
    if (!session.killedAt) {
      session.killedAt = stamp;
      count += 1;
    }
  }
  return { store, count };
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

module.exports = {
  STALE_MS,
  SESSIONS_KEY,
  emptyStore,
  normalizeStore,
  prune,
  touchSession,
  listActive,
  stopSession,
  stopAll,
  formatDuration
};
