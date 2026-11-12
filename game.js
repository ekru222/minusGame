// Game rules and state machine. No DOM access: everything here runs in Node tests.

export const ERROR_PENALTY_MS = 0; // added to totalTimeMs per error; 0 = no penalty
export const MAX_START = 9999;
export const DEFAULT_SETTINGS = Object.freeze({ start: 100, step: 7 });
export const MODES = Object.freeze(['typed', 'voice']);

function parseWhole(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Validate settings. Accepts numbers or strings. Returns { valid, errors, value }. */
export function validateSettings(input) {
  const errors = {};
  const start = parseWhole(input?.start);
  const step = parseWhole(input?.step);
  if (step === null) errors.step = 'Enter a whole number.';
  else if (step < 1) errors.step = 'Must be at least 1.';
  if (start === null) errors.start = 'Enter a whole number.';
  else if (start > MAX_START) errors.start = `Must be at most ${MAX_START}.`;
  else if (step !== null && step >= 1 && start <= step) errors.start = 'Must be greater than the step.';
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, value: valid ? { start, step } : null };
}

/** Number of correct answers a full run needs. */
export function totalAnswers(start, step) {
  return Math.floor(start / step);
}

export function digitCount(n) {
  return String(n).length;
}

export function hasLeadingZero(buffer) {
  return buffer.length > 1 && buffer[0] === '0';
}

/** Typed-input rule: 'correct' | 'error' | 'pending'. */
export function evaluateBuffer(buffer, expected) {
  if (buffer === '') return 'pending';
  if (!hasLeadingZero(buffer) && Number(buffer) === expected) return 'correct';
  if (buffer.length >= digitCount(expected)) return 'error';
  return 'pending';
}

/**
 * Create a game. States: idle > countdown > running > finished (or quit).
 * `now` is injected so tests are deterministic; the browser passes performance.now.
 */
export function createGame({ start, step, mode = 'typed', now }) {
  if (typeof now !== 'function') throw new TypeError('now() is required');
  const check = validateSettings({ start, step });
  if (!check.valid) throw new RangeError('Invalid settings');
  if (!MODES.includes(mode)) throw new RangeError(`Unknown mode: ${mode}`);

  const s = {
    status: 'idle',
    start,
    step,
    mode,
    value: start,
    buffer: '',
    correctCount: 0,
    errorCount: 0,
    answerTimesMs: [],
    runStart: null,
    lastShownAt: null,
    lastCorrectAt: null,
  };
  const expected = () => s.value - s.step;
  const IGNORED = Object.freeze({ type: 'ignored', finished: false });

  function startCountdown() {
    if (s.status !== 'idle') throw new Error(`Cannot count down from ${s.status}`);
    s.status = 'countdown';
  }

  /** Call at the moment the first number is displayed. */
  function begin() {
    if (s.status !== 'idle' && s.status !== 'countdown') throw new Error(`Cannot begin from ${s.status}`);
    s.status = 'running';
    s.runStart = now();
    s.lastShownAt = s.runStart;
  }

  function accept() {
    const t = now();
    s.correctCount += 1;
    s.answerTimesMs.push(t - s.lastShownAt);
    s.value = expected();
    s.buffer = '';
    s.lastShownAt = t;
    s.lastCorrectAt = t;
    if (s.value < s.step) s.status = 'finished';
    return { type: 'correct', finished: s.status === 'finished' };
  }

  function reject() {
    s.errorCount += 1;
    s.buffer = '';
    return { type: 'error', finished: false };
  }

  function pressDigit(d) {
    if (s.status !== 'running') return IGNORED;
    const digit = String(d);
    if (!/^[0-9]$/.test(digit)) throw new RangeError(`Not a digit: ${d}`);
    s.buffer += digit;
    const r = evaluateBuffer(s.buffer, expected());
    if (r === 'correct') return accept();
    if (r === 'error') return reject();
    return { type: 'pending', finished: false };
  }

  function backspace() {
    if (s.status !== 'running') return IGNORED;
    s.buffer = s.buffer.slice(0, -1);
    return { type: 'pending', finished: false };
  }

  /**
   * Voice input: a whole recognized number (digit string). Interim results only
   * count when they match; a final result that does not match is an error.
   */
  function submitSpoken(digits, isFinal) {
    if (s.status !== 'running') return IGNORED;
    if (typeof digits !== 'string' || !/^\d+$/.test(digits)) return IGNORED;
    s.buffer = digits;
    if (!hasLeadingZero(digits) && Number(digits) === expected()) return accept();
    if (isFinal) return reject();
    return { type: 'pending', finished: false };
  }

  function quit() {
    s.status = 'quit';
  }

  function snapshot() {
    return {
      ...s,
      answerTimesMs: [...s.answerTimesMs],
      expected: s.status === 'running' ? expected() : null,
      totalAnswers: totalAnswers(s.start, s.step),
      remaining: totalAnswers(s.start, s.step) - s.correctCount,
    };
  }

  /** Build the run record. Only valid once finished. */
  function toRecord({ id, finishedAt }) {
    if (s.status !== 'finished') throw new Error('Run is not finished');
    const totalTimeMs = s.lastCorrectAt - s.runStart + s.errorCount * ERROR_PENALTY_MS;
    return {
      id,
      schemaVersion: 1,
      finishedAt,
      start: s.start,
      step: s.step,
      mode: s.mode,
      correctCount: s.correctCount,
      errorCount: s.errorCount,
      totalTimeMs,
      avgSecPerCorrect: totalTimeMs / 1000 / s.correctCount,
      answerTimesMs: [...s.answerTimesMs],
    };
  }

  return { startCountdown, begin, pressDigit, backspace, submitSpoken, quit, snapshot, toRecord };
}
