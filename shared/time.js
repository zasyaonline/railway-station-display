'use strict';

function nowIso(date = new Date()) {
  return date.toISOString();
}

function parseIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursBetween(from, to = new Date()) {
  const a = from instanceof Date ? from : parseIso(from);
  if (!a) return null;
  return (to.getTime() - a.getTime()) / 3_600_000;
}

function isObviouslyInvalidDate(date = new Date()) {
  const year = date.getUTCFullYear();
  return year < 2020 || year > 2100;
}

module.exports = {
  nowIso,
  parseIso,
  hoursBetween,
  isObviouslyInvalidDate
};
