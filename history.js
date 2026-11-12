// Run history helpers: validation, filtering, personal bests, export/import. No DOM access.
import { MODES } from './game.js';

export const EXPORT_KIND = 'subtraction-speed-history';
export const EXPORT_VERSION = 1;

const isInt = (n) => Number.isInteger(n);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function isValidRun(r) {
  return (
    !!r && typeof r === 'object' &&
    typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 100 &&
    typeof r.finishedAt === 'string' && !Number.isNaN(Date.parse(r.finishedAt)) &&
    isInt(r.start) && isInt(r.step) && r.step >= 1 && r.start > r.step &&
    MODES.includes(r.mode) &&
    isInt(r.correctCount) && r.correctCount >= 1 &&
    isInt(r.errorCount) && r.errorCount >= 0 &&
    isNum(r.totalTimeMs) && r.totalTimeMs >= 0 &&
    isNum(r.avgSecPerCorrect) && r.avgSecPerCorrect >= 0 &&
    (r.answerTimesMs === undefined ||
      (Array.isArray(r.answerTimesMs) && r.answerTimesMs.every((t) => isNum(t) && t >= 0)))
  );
}

/** Keep only known fields, so imported data cannot carry extra content. */
export function normalizeRun(r) {
  return {
    id: r.id,
    schemaVersion: 1,
    finishedAt: r.finishedAt,
    start: r.start,
    step: r.step,
    mode: r.mode,
    correctCount: r.correctCount,
    errorCount: r.errorCount,
    totalTimeMs: r.totalTimeMs,
    avgSecPerCorrect: r.avgSecPerCorrect,
    answerTimesMs: Array.isArray(r.answerTimesMs) ? [...r.answerTimesMs] : [],
  };
}

export const pairKey = (r) => `${r.start}/${r.step}`;

export const sortNewestFirst = (runs) =>
  [...runs].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));

export const sortOldestFirst = (runs) =>
  [...runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));

/** Filter by mode (required: series are never mixed) and optional start/step pair. */
export function filterRuns(runs, { mode, pair = 'all' }) {
  return runs.filter((r) => r.mode === mode && (pair === 'all' || pairKey(r) === pair));
}

/** Best (lowest) average seconds per correct answer for a mode, or null. */
export function personalBest(runs, mode) {
  let best = null;
  for (const r of runs) {
    if (r.mode !== mode) continue;
    if (!best || r.avgSecPerCorrect < best.avgSecPerCorrect) best = r;
  }
  return best;
}

/** Merge by id. Existing runs win on conflict. */
export function mergeRuns(existing, incoming) {
  const ids = new Set(existing.map((r) => r.id));
  const added = [];
  for (const r of incoming) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    added.push(r);
  }
  return { runs: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
}

export function buildExport(runs, exportedAt = new Date().toISOString()) {
  return JSON.stringify(
    { kind: EXPORT_KIND, version: EXPORT_VERSION, exportedAt, runs: sortOldestFirst(runs) },
    null,
    2,
  );
}

/** Parse exported JSON (or a bare array of runs). Returns { ok, runs, invalid } or { ok:false, error }. */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.runs) ? data.runs : null;
  if (!list) return { ok: false, error: 'Expected an exported history with a "runs" list.' };
  if (!Array.isArray(data)) {
    if (data.kind !== undefined && data.kind !== EXPORT_KIND) {
      return { ok: false, error: 'This JSON is not a Subtraction Speed export.' };
    }
    if (isInt(data.version) && data.version > EXPORT_VERSION) {
      return { ok: false, error: 'This export comes from a newer version of the app.' };
    }
  }
  const valid = list.filter(isValidRun).map(normalizeRun);
  if (list.length > 0 && valid.length === 0) return { ok: false, error: 'No valid runs were found.' };
  return { ok: true, runs: valid, invalid: list.length - valid.length };
}
