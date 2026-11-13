// UI controller. All rules live in game.js / history.js; this file wires them to the DOM.
import { createGame, validateSettings, totalAnswers } from './game.js';
import {
  sortNewestFirst, sortOldestFirst, filterRuns, personalBest, mergeRuns,
  buildExport, parseImport, pairKey,
} from './history.js';
import * as store from './storage.js';
import { drawLineChart } from './chart.js';
import { parseSpokenNumber } from './speech.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const now = () => performance.now();

const SpeechRecognitionCtor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const VOICE_SUPPORTED = typeof SpeechRecognitionCtor === 'function';

const ui = {
  settings: store.loadSettings(),
  voiceOn: VOICE_SUPPORTED && store.loadVoicePref(),
  historyMode: 'typed',
  historyPair: 'all',
  game: null,
  recognizer: null,
  countdownTimer: null,
  flashTimer: null,
};

// ---------- formatting ----------
const fmtSec = (ms) => `${(ms / 1000).toFixed(2)} s`;
const fmtAvg = (sec) => `${sec.toFixed(2)} s`;
const modeLabel = (m) => (m === 'voice' ? 'Voice' : 'Typed');
const fmtDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const settingsLine = (s) => `Start ${s.start}, subtract ${s.step}`;
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- navigation ----------
function show(name) {
  if (name !== 'game') stopGame();
  $$('.screen').forEach((el) => el.classList.toggle('active', el.id === `screen-${name}`));
  if (name === 'home') renderHome();
  if (name === 'settings') renderSettings();
  if (name === 'history') renderHistory();
}
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) show(nav.dataset.nav);
});

// ---------- home ----------
function renderHome() {
  $('#home-settings').textContent = settingsLine(ui.settings);
  const btn = $('#btn-voice');
  btn.textContent = `Voice: ${ui.voiceOn ? 'On' : 'Off'}`;
  btn.setAttribute('aria-pressed', String(ui.voiceOn));
  btn.disabled = !VOICE_SUPPORTED;
  const note = $('#voice-note');
  note.hidden = VOICE_SUPPORTED;
  if (!VOICE_SUPPORTED) note.textContent = 'Voice input is not supported in this browser.';
}
$('#btn-voice').addEventListener('click', () => {
  if (!VOICE_SUPPORTED) return;
  ui.voiceOn = !ui.voiceOn;
  store.saveVoicePref(ui.voiceOn);
  renderHome();
});
$('#btn-start').addEventListener('click', () => startGame());
$('#btn-again').addEventListener('click', () => startGame());

// ---------- settings ----------
function renderSettings() {
  $('#in-start').value = ui.settings.start;
  $('#in-step').value = ui.settings.step;
  $('#settings-saved').textContent = '';
  validateForm();
}
function validateForm() {
  const res = validateSettings({ start: $('#in-start').value, step: $('#in-step').value });
  for (const f of ['start', 'step']) {
    $(`#err-${f}`).textContent = res.errors[f] || '';
    $(`#in-${f}`).setAttribute('aria-invalid', String(!!res.errors[f]));
  }
  $('#btn-save').disabled = !res.valid;
  $('#settings-preview').textContent = res.valid
    ? `${totalAnswers(res.value.start, res.value.step)} answers per run.`
    : '';
  return res;
}
$('#settings-form').addEventListener('input', () => {
  $('#settings-saved').textContent = '';
  validateForm();
});
$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const res = validateForm();
  if (!res.valid) return;
  ui.settings = res.value;
  store.saveSettings(ui.settings);
  $('#settings-saved').textContent = 'Saved.';
});

// ---------- game ----------
function startGame() {
  stopGame();
  const mode = ui.voiceOn ? 'voice' : 'typed';
  ui.game = createGame({ ...ui.settings, mode, now });
  ui.game.startCountdown();
  show('game');
  $('#game-run').hidden = true;
  $('#quit-confirm').hidden = true;
  $('#mic-status').hidden = mode !== 'voice';
  if (mode === 'voice') startVoice(); // must run inside the Start tap for Safari
  let n = 3;
  const cd = $('#countdown');
  cd.textContent = String(n);
  ui.countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      cd.textContent = String(n);
      return;
    }
    clearInterval(ui.countdownTimer);
    ui.countdownTimer = null;
    cd.textContent = '';
    // Start timing as the first number is put on screen. Starting synchronously (rather than
    // waiting for requestAnimationFrame) means no early keypress can be dropped.
    ui.game.begin();
    $('#game-run').hidden = false;
    renderGame();
    if (mode === 'voice' && !ui.recognizer) startVoice();
  }, 1000);
}

function stopGame() {
  if (ui.countdownTimer) clearInterval(ui.countdownTimer);
  ui.countdownTimer = null;
  stopVoice();
  if (ui.game) ui.game.quit();
  ui.game = null;
}

function renderGame() {
  const s = ui.game.snapshot();
  $('#current-value').textContent = s.value;
  $('#minus-text').textContent = `minus ${s.step}`;
  $('#answer').textContent = s.buffer;
  $('#progress').textContent = `${s.correctCount} done · ~${s.remaining} left`;
}

function flash(kind) {
  const el = $('.game-main');
  el.classList.remove('flash-ok', 'flash-bad');
  void el.offsetWidth; // restart the transition
  el.classList.add(kind === 'correct' ? 'flash-ok' : 'flash-bad');
  clearTimeout(ui.flashTimer);
  ui.flashTimer = setTimeout(() => el.classList.remove('flash-ok', 'flash-bad'), 140);
}

function handleResult(r) {
  if (r.type === 'ignored') return;
  if (r.type === 'correct' || r.type === 'error') flash(r.type);
  if (r.finished) return finishGame();
  renderGame();
}

// pointerdown is faster than click on touch screens.
$('#keypad').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('button[data-key]');
  if (!btn || !ui.game) return;
  e.preventDefault();
  const key = btn.dataset.key;
  handleResult(key === 'back' ? ui.game.backspace() : ui.game.pressDigit(key));
});
// Desktop testing convenience: physical keyboard.
document.addEventListener('keydown', (e) => {
  if (!ui.game || !$('#screen-game').classList.contains('active') || !$('#quit-confirm').hidden) return;
  if (/^[0-9]$/.test(e.key)) handleResult(ui.game.pressDigit(e.key));
  else if (e.key === 'Backspace') handleResult(ui.game.backspace());
});

$('#btn-quit').addEventListener('click', () => { $('#quit-confirm').hidden = false; });
$('#btn-quit-no').addEventListener('click', () => { $('#quit-confirm').hidden = true; });
$('#btn-quit-yes').addEventListener('click', () => {
  $('#quit-confirm').hidden = true;
  show('home'); // stopGame() discards the run
});

function finishGame() {
  const game = ui.game;
  stopVoice();
  const record = game.toRecord({ id: newId(), finishedAt: new Date().toISOString() });
  const previousBest = personalBest(store.loadRuns(), record.mode);
  store.addRun(record);
  ui.game = null;
  renderResults(record, previousBest);
  show('results');
}

// ---------- results ----------
function renderResults(r, prevBest) {
  const rows = [
    ['Total time', fmtSec(r.totalTimeMs)],
    ['Correct', r.correctCount],
    ['Errors', r.errorCount],
    ['Avg per answer', fmtAvg(r.avgSecPerCorrect)],
    ['Input mode', modeLabel(r.mode)],
    ['Start / step', `${r.start} / ${r.step}`],
  ];
  const dl = $('#results-list');
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = String(v);
    return [dt, dd];
  }));
  const isPb = !prevBest || r.avgSecPerCorrect < prevBest.avgSecPerCorrect;
  $('#pb-label').hidden = !isPb;
  $('#pb-compare').textContent = !prevBest
    ? `First ${modeLabel(r.mode).toLowerCase()} run recorded.`
    : isPb
      ? `Previous ${modeLabel(r.mode).toLowerCase()} best: ${fmtAvg(prevBest.avgSecPerCorrect)} (improved by ${(prevBest.avgSecPerCorrect - r.avgSecPerCorrect).toFixed(2)} s).`
      : `${modeLabel(r.mode)} best: ${fmtAvg(prevBest.avgSecPerCorrect)} (${(r.avgSecPerCorrect - prevBest.avgSecPerCorrect).toFixed(2)} s slower).`;
}

// ---------- history ----------
function renderHistory() {
  const runs = store.loadRuns();

  // Personal bests per mode.
  $('#pb-summary').replaceChildren(...['typed', 'voice'].map((m) => {
    const best = personalBest(runs, m);
    const card = document.createElement('div');
    card.className = 'pb-card';
    const label = document.createElement('span');
    label.className = 'note';
    label.textContent = `${modeLabel(m)} best`;
    const val = document.createElement('b');
    val.textContent = best ? fmtAvg(best.avgSecPerCorrect) : '—';
    card.append(label, val);
    return card;
  }));

  // Mode toggle.
  $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ui.historyMode)));

  // Pair filter options (pairs that exist in this mode).
  const pairs = [...new Set(runs.filter((r) => r.mode === ui.historyMode).map(pairKey))].sort((a, b) => {
    const [as, ast] = a.split('/').map(Number);
    const [bs, bst] = b.split('/').map(Number);
    return as - bs || ast - bst;
  });
  if (ui.historyPair !== 'all' && !pairs.includes(ui.historyPair)) ui.historyPair = 'all';
  const sel = $('#pair-filter');
  sel.replaceChildren(
    new Option('All start/step', 'all'),
    ...pairs.map((p) => new Option(`Start ${p.split('/')[0]}, step ${p.split('/')[1]}`, p)),
  );
  sel.value = ui.historyPair;

  // Chart.
  const series = sortOldestFirst(filterRuns(runs, { mode: ui.historyMode, pair: ui.historyPair }));
  const points = series.map((r) => ({
    y: r.avgSecPerCorrect,
    label: new Date(r.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }));
  requestAnimationFrame(() => drawLineChart($('#chart'), points, { empty: `No ${modeLabel(ui.historyMode).toLowerCase()} runs yet.` }));

  // List: all runs, newest first.
  const list = $('#run-list');
  const sorted = sortNewestFirst(runs);
  if (sorted.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No runs yet. Finish a run to see it here.';
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...sorted.map((r) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = `${fmtDate(r.finishedAt)} · ${r.start}/${r.step} · ${modeLabel(r.mode)}`;
      const avg = document.createElement('span');
      avg.className = 'avg';
      avg.textContent = `${fmtAvg(r.avgSecPerCorrect)}/ans`;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = `Total ${fmtSec(r.totalTimeMs)} · ${r.errorCount} error${r.errorCount === 1 ? '' : 's'}`;
      li.append(a, avg, sub);
      return li;
    }));
  }

  $('#export-box').hidden = true;
  $('#clear-confirm').hidden = true;
  $('#import-msg').textContent = '';
}

$$('.seg button').forEach((b) => b.addEventListener('click', () => {
  ui.historyMode = b.dataset.mode;
  renderHistory();
}));
$('#pair-filter').addEventListener('change', (e) => {
  ui.historyPair = e.target.value;
  renderHistory();
});
window.addEventListener('resize', () => {
  if ($('#screen-history').classList.contains('active')) renderHistory();
});

// Export.
$('#btn-export').addEventListener('click', () => {
  const text = buildExport(store.loadRuns());
  $('#export-text').value = text;
  $('#export-box').hidden = false;
  $('#export-msg').textContent = '';
  $('#btn-share').hidden = typeof navigator.share !== 'function';
});
$('#btn-copy').addEventListener('click', async () => {
  const ta = $('#export-text');
  try {
    await navigator.clipboard.writeText(ta.value);
    $('#export-msg').textContent = 'Copied.';
  } catch {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    $('#export-msg').textContent = 'Text selected. Use the system Copy command.';
  }
});
$('#btn-share').addEventListener('click', async () => {
  try {
    await navigator.share({ title: 'Subtraction Speed history', text: $('#export-text').value });
  } catch (err) {
    if (err?.name !== 'AbortError') $('#export-msg').textContent = 'Sharing failed. Use Copy instead.';
  }
});

// Import.
$('#btn-import').addEventListener('click', () => {
  const res = parseImport($('#import-text').value);
  const msg = $('#import-msg');
  if (!res.ok) {
    msg.textContent = res.error;
    return;
  }
  const merged = mergeRuns(store.loadRuns(), res.runs);
  if (!store.saveRuns(merged.runs)) {
    msg.textContent = 'Could not save. Storage may be full.';
    return;
  }
  renderHistory();
  $('#import-text').value = '';
  msg.textContent = `Imported ${merged.added} run(s). Skipped ${merged.skipped} duplicate(s)` +
    (res.invalid ? ` and ${res.invalid} invalid record(s).` : '.');
});

// Clear.
$('#btn-clear').addEventListener('click', () => { $('#clear-confirm').hidden = false; });
$('#btn-clear-no').addEventListener('click', () => { $('#clear-confirm').hidden = true; });
$('#btn-clear-yes').addEventListener('click', () => {
  store.clearRuns();
  renderHistory();
});

// ---------- voice (game screen only) ----------
// Errors that will not fix themselves by restarting: stop and tell the player why.
const VOICE_ERRORS = {
  'not-allowed': 'Mic blocked: allow microphone access',
  'service-not-allowed': 'Speech service blocked',
  'audio-capture': 'No microphone found',
  'network': 'Speech service unreachable',
  'language-not-supported': 'Language not supported',
};
const MAX_RESTARTS = 5; // restarts in a row without a result before giving up

function setMic(state, text) {
  const el = $('#mic-status');
  el.className = `mic-status ${state}`;
  el.textContent = text;
  el.title = state === 'error' ? 'Tap to retry the microphone' : '';
}

// Tapping the status after an error tries again.
$('#mic-status').addEventListener('click', () => {
  if ($('#mic-status').classList.contains('error') && ui.game?.snapshot().mode === 'voice') {
    stopVoice();
    startVoice();
  }
});

/**
 * Called from the Start button tap (Safari only grants the microphone inside a user
 * gesture), so it starts listening during the countdown. Input is ignored until the
 * game is running, because the game rejects input in any other state.
 */
function startVoice() {
  if (!VOICE_SUPPORTED || !ui.game) return;
  let rec;
  try {
    rec = new SpeechRecognitionCtor();
  } catch (err) {
    console.warn('Speech recognition could not be created', err);
    setMic('error', 'Mic error (could not start)');
    return;
  }
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  ui.recognizer = rec;
  let handledIndex = -1; // results at or before this index are already counted
  let restarts = 0;
  let fatal = false;

  rec.onstart = () => setMic('listening', '🎙 Listening');
  rec.onresult = (e) => {
    restarts = 0;
    if (!ui.game) return;
    const running = ui.game.snapshot().status === 'running';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (i <= handledIndex) continue;
      const result = e.results[i];
      if (!running) {
        if (result.isFinal) handledIndex = i; // speech during the countdown is dropped
        continue;
      }
      // Try every alternative; take the first one that matches, else judge the top one.
      let outcome = null;
      for (let a = 0; a < result.length && !outcome; a++) {
        const digits = parseSpokenNumber(result[a].transcript);
        if (digits === null) continue;
        const r = ui.game.submitSpoken(digits, false);
        if (r.type === 'correct') outcome = r;
      }
      if (!outcome && result.isFinal) {
        const digits = parseSpokenNumber(result[0].transcript);
        if (digits !== null) outcome = ui.game.submitSpoken(digits, true);
      }
      if (outcome) {
        handledIndex = i;
        handleResult(outcome);
        if (!ui.game) return;
      } else if (result.isFinal) {
        handledIndex = i;
      }
    }
    if (ui.game) renderGame();
  };
  rec.onerror = (e) => {
    console.warn('Speech recognition error:', e.error, e.message || '');
    if (e.error === 'no-speech' || e.error === 'aborted') return; // harmless; onend restarts
    if (VOICE_ERRORS[e.error]) {
      fatal = true;
      setMic('error', `${VOICE_ERRORS[e.error]} (tap to retry)`);
    } else {
      setMic('error', `Mic error: ${e.error} (tap to retry)`);
    }
  };
  // Recognition stops on its own from time to time; restart while the run is going,
  // but not after a fatal error, and not endlessly.
  rec.onend = () => {
    if (ui.recognizer !== rec || fatal) return;
    const status = ui.game?.snapshot().status;
    if (status !== 'running' && status !== 'countdown') return;
    if (++restarts > MAX_RESTARTS) {
      setMic('error', 'Mic keeps stopping (tap to retry)');
      return;
    }
    handledIndex = -1;
    try { rec.start(); } catch (err) {
      console.warn('Speech recognition restart failed', err);
      setMic('error', 'Mic error (tap to retry)');
    }
  };
  try {
    setMic('', 'Starting mic…');
    rec.start();
  } catch (err) {
    console.warn('Speech recognition start failed', err);
    setMic('error', 'Mic error (tap to retry)');
  }
}

function stopVoice() {
  const rec = ui.recognizer;
  ui.recognizer = null;
  if (rec) {
    rec.onend = null;
    rec.onerror = null;
    try { rec.abort(); } catch { /* ignore */ }
  }
}

// ---------- boot ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopVoice();
  else if (ui.game?.snapshot().status === 'running' && ui.game.snapshot().mode === 'voice' && !ui.recognizer) startVoice();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
renderHome();
