// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, validateSettings, evaluateBuffer, totalAnswers, ERROR_PENALTY_MS,
} from '../game.js';
import {
  parseImport, buildExport, mergeRuns, personalBest, filterRuns, isValidRun, sortNewestFirst,
} from '../history.js';
import { parseSpokenNumber } from '../speech.js';

function fakeClock(start = 1000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

function typeNumber(game, n) {
  let r;
  for (const d of String(n)) r = game.pressDigit(d);
  return r;
}

function playPerfect(game, now, msPerAnswer) {
  let s = game.snapshot();
  while (s.status === 'running') {
    now.advance(msPerAnswer);
    typeNumber(game, s.expected);
    s = game.snapshot();
  }
}

test('validateSettings accepts defaults and rejects bad input', () => {
  assert.deepEqual(validateSettings({ start: 100, step: 7 }).value, { start: 100, step: 7 });
  assert.deepEqual(validateSettings({ start: '100', step: ' 7 ' }).value, { start: 100, step: 7 });
  assert.equal(validateSettings({ start: 10, step: 0 }).errors.step, 'Must be at least 1.');
  assert.ok(validateSettings({ start: 7, step: 7 }).errors.start);
  assert.ok(validateSettings({ start: 10000, step: 7 }).errors.start);
  assert.ok(validateSettings({ start: 9999, step: 7 }).valid);
  assert.ok(validateSettings({ start: '12.5', step: 7 }).errors.start);
  assert.ok(validateSettings({ start: '-5', step: 2 }).errors.start);
  assert.ok(validateSettings({ start: '', step: '' }).errors.step);
  assert.ok(validateSettings({ start: 100, step: 'abc' }).errors.step);
});

test('spec example: start 100 step 7 gives 14 answers and ends at 2', () => {
  assert.equal(totalAnswers(100, 7), 14);
  const now = fakeClock();
  const g = createGame({ start: 100, step: 7, now });
  g.startCountdown();
  g.begin();
  playPerfect(g, now, 1500);
  const s = g.snapshot();
  assert.equal(s.status, 'finished');
  assert.equal(s.value, 2);
  assert.equal(s.correctCount, 14);
  assert.equal(s.errorCount, 0);
});

test('evaluateBuffer: correct, error, pending and leading zeros', () => {
  assert.equal(evaluateBuffer('93', 93), 'correct');
  assert.equal(evaluateBuffer('9', 93), 'pending');
  assert.equal(evaluateBuffer('94', 93), 'error');
  assert.equal(evaluateBuffer('0', 0), 'correct');
  assert.equal(evaluateBuffer('00', 0), 'error');
  assert.equal(evaluateBuffer('0', 5), 'error');
  assert.equal(evaluateBuffer('09', 9), 'error');
  assert.equal(evaluateBuffer('0', 93), 'pending');
  assert.equal(evaluateBuffer('09', 93), 'error');
});

test('wrong answer does not advance, counts error, clears buffer', () => {
  const now = fakeClock();
  const g = createGame({ start: 100, step: 7, now });
  g.begin();
  assert.equal(g.pressDigit(9).type, 'pending');
  assert.equal(g.pressDigit(4).type, 'error');
  const s = g.snapshot();
  assert.equal(s.value, 100);
  assert.equal(s.buffer, '');
  assert.equal(s.errorCount, 1);
  assert.equal(typeNumber(g, 93).type, 'correct');
  assert.equal(g.snapshot().value, 93);
});

test('backspace removes last digit and is not an error', () => {
  const now = fakeClock();
  const g = createGame({ start: 100, step: 7, now });
  g.begin();
  g.pressDigit(8);
  g.backspace();
  assert.equal(g.snapshot().buffer, '');
  g.backspace(); // on empty buffer: harmless
  assert.equal(g.snapshot().errorCount, 0);
  assert.equal(typeNumber(g, 93).type, 'correct');
});

test('answer of zero is accepted and ends the run when value < step', () => {
  const now = fakeClock();
  const g = createGame({ start: 14, step: 7, now });
  g.begin();
  assert.equal(typeNumber(g, 7).type, 'correct');
  const r = g.pressDigit(0);
  assert.equal(r.type, 'correct');
  assert.equal(r.finished, true);
  assert.equal(g.snapshot().value, 0);
});

test('timing: per-answer times, errors do not reset timer, totals and average', () => {
  const now = fakeClock(5000);
  const g = createGame({ start: 21, step: 7, now }); // 14, 7, 0 -> 3 answers
  g.startCountdown();
  now.advance(3000); // countdown time is not counted
  g.begin();
  now.advance(1000);
  typeNumber(g, 15); // error
  now.advance(500);
  typeNumber(g, 14); // correct at 1500 ms
  now.advance(2000);
  typeNumber(g, 7); // correct at 2000 ms
  now.advance(1000);
  typeNumber(g, 0); // correct at 1000 ms
  const rec = g.toRecord({ id: 'a', finishedAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(rec.answerTimesMs, [1500, 2000, 1000]);
  assert.equal(rec.totalTimeMs, 4500 + rec.errorCount * ERROR_PENALTY_MS);
  assert.equal(rec.correctCount, 3);
  assert.equal(rec.errorCount, 1);
  assert.equal(rec.avgSecPerCorrect, rec.totalTimeMs / 1000 / 3);
  assert.equal(rec.mode, 'typed');
  assert.ok(isValidRun(rec));
});

test('input is ignored outside the running state', () => {
  const now = fakeClock();
  const g = createGame({ start: 100, step: 7, now });
  assert.equal(g.pressDigit(9).type, 'ignored');
  g.startCountdown();
  assert.equal(g.pressDigit(9).type, 'ignored');
  g.begin();
  g.quit();
  assert.equal(g.pressDigit(9).type, 'ignored');
  assert.throws(() => g.toRecord({ id: 'x', finishedAt: '2026-01-01T00:00:00Z' }));
});

test('createGame rejects invalid setup', () => {
  assert.throws(() => createGame({ start: 5, step: 7, now: () => 0 }));
  assert.throws(() => createGame({ start: 100, step: 7 }));
  assert.throws(() => createGame({ start: 100, step: 7, mode: 'other', now: () => 0 }));
});

test('voice: interim mismatch waits, final mismatch is an error, match advances', () => {
  const now = fakeClock();
  const g = createGame({ start: 100, step: 7, mode: 'voice', now });
  g.begin();
  assert.equal(g.submitSpoken('9', false).type, 'pending');
  assert.equal(g.snapshot().errorCount, 0);
  assert.equal(g.submitSpoken('94', true).type, 'error');
  assert.equal(g.snapshot().errorCount, 1);
  assert.equal(g.submitSpoken('93', false).type, 'correct');
  assert.equal(g.snapshot().value, 93);
});

test('parseSpokenNumber handles digits and words', () => {
  assert.equal(parseSpokenNumber('93'), '93');
  assert.equal(parseSpokenNumber('9 3'), '93');
  assert.equal(parseSpokenNumber('ninety-three'), '93');
  assert.equal(parseSpokenNumber('ninety three'), '93');
  assert.equal(parseSpokenNumber('one hundred and five'), '105');
  assert.equal(parseSpokenNumber('two thousand three hundred forty'), '2340');
  assert.equal(parseSpokenNumber('zero'), '0');
  assert.equal(parseSpokenNumber('eight'), '8');
  assert.equal(parseSpokenNumber('it is 86'), '86');
  assert.equal(parseSpokenNumber('hello'), null);
  assert.equal(parseSpokenNumber(''), null);
});

const run = (id, mode, avg, finishedAt, start = 100, step = 7) => ({
  id, schemaVersion: 1, finishedAt, start, step, mode, correctCount: 14, errorCount: 0,
  totalTimeMs: avg * 14000, avgSecPerCorrect: avg, answerTimesMs: [],
});

test('personal best is per mode and filters never mix modes', () => {
  const runs = [
    run('1', 'typed', 2.0, '2026-01-01T00:00:00Z'),
    run('2', 'typed', 1.5, '2026-01-02T00:00:00Z', 50, 3),
    run('3', 'voice', 1.0, '2026-01-03T00:00:00Z'),
  ];
  assert.equal(personalBest(runs, 'typed').id, '2');
  assert.equal(personalBest(runs, 'voice').id, '3');
  assert.equal(personalBest([], 'typed'), null);
  assert.deepEqual(filterRuns(runs, { mode: 'typed' }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(filterRuns(runs, { mode: 'typed', pair: '100/7' }).map((r) => r.id), ['1']);
  assert.deepEqual(sortNewestFirst(runs).map((r) => r.id), ['3', '2', '1']);
});

test('export/import round trip merges by id', () => {
  const a = [run('1', 'typed', 2, '2026-01-01T00:00:00Z'), run('2', 'voice', 3, '2026-01-02T00:00:00Z')];
  const parsed = parseImport(buildExport(a));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.runs.length, 2);
  const merged = mergeRuns([a[0]], parsed.runs);
  assert.equal(merged.runs.length, 2);
  assert.equal(merged.added, 1);
  assert.equal(merged.skipped, 1);
});

test('import rejects bad JSON and drops invalid or extra fields', () => {
  assert.equal(parseImport('{not json').ok, false);
  assert.equal(parseImport('{"foo":1}').ok, false);
  assert.equal(parseImport('{"kind":"other","runs":[]}').ok, false);
  assert.equal(parseImport(JSON.stringify({ runs: [{ id: 'x' }] })).ok, false);
  const good = { ...run('9', 'typed', 2, '2026-01-01T00:00:00Z'), extra: '<script>' };
  const res = parseImport(JSON.stringify({ runs: [good, { id: 'bad' }] }));
  assert.equal(res.ok, true);
  assert.equal(res.runs.length, 1);
  assert.equal(res.invalid, 1);
  assert.equal('extra' in res.runs[0], false);
});
