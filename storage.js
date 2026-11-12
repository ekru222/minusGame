// localStorage persistence. Falls back to memory if storage is unavailable.
import { DEFAULT_SETTINGS, validateSettings } from './game.js';
import { isValidRun } from './history.js';

const KEYS = { settings: 'ssg.settings.v1', runs: 'ssg.runs.v1', voice: 'ssg.voice.v1' };
const memory = new Map();

function backend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key, fallback) {
  try {
    const ls = backend();
    const raw = ls ? ls.getItem(key) : memory.get(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  const raw = JSON.stringify(value);
  try {
    const ls = backend();
    if (ls) ls.setItem(key, raw);
    else memory.set(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  const saved = read(KEYS.settings, null);
  const check = saved && validateSettings(saved);
  return check && check.valid ? check.value : { ...DEFAULT_SETTINGS };
}
export const saveSettings = (s) => write(KEYS.settings, { start: s.start, step: s.step });

export function loadRuns() {
  const runs = read(KEYS.runs, []);
  return Array.isArray(runs) ? runs.filter(isValidRun) : [];
}
export const saveRuns = (runs) => write(KEYS.runs, runs);
export const addRun = (run) => saveRuns([...loadRuns(), run]);
export const clearRuns = () => write(KEYS.runs, []);

export const loadVoicePref = () => read(KEYS.voice, false) === true;
export const saveVoicePref = (on) => write(KEYS.voice, !!on);
