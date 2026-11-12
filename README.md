# Subtraction Speed (PWA)

A mental-subtraction speed game. It uses plain HTML, CSS and ES modules, with no build step and no dependencies. All data stays in `localStorage` on the device.

## Files
| File | Role |
|---|---|
| `game.js` | Rules, auto-advance matching, timing, state machine (no DOM, unit tested) |
| `history.js` | Personal bests, filters, export/import validation and merge (no DOM, tested) |
| `speech.js` | Converts a spoken transcript ("ninety-three") to digits (tested) |
| `storage.js` | `localStorage` wrapper with an in-memory fallback |
| `chart.js` | Canvas line chart, no library |
| `app.js` | UI controller for the screens |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install |

## Test (Windows, Node 18+)
```
node --test tests/game.test.js
```

## Run locally
```
python -m http.server 8080
```
Open http://localhost:8080 in Chrome. Open DevTools, turn on device emulation (iPhone), and select portrait. A physical keyboard also works on the game screen. The service worker registers only over HTTPS.

## Deploy (GitHub Pages or any static HTTPS host)
Push this folder to the repository root and enable Pages. All paths are relative, so a sub-path such as `/repo-name/` works. **Bump `CACHE` in `sw.js` on every release**, or installed phones will keep the old files.

## Install on iPhone
Open the URL in Safari, then choose Share > Add to Home Screen.

## Run record (stored per finished run)
```json
{ "id": "uuid", "schemaVersion": 1, "finishedAt": "ISO-8601", "start": 100, "step": 7,
  "mode": "typed|voice", "correctCount": 14, "errorCount": 1, "totalTimeMs": 21000,
  "avgSecPerCorrect": 1.5, "answerTimesMs": [1500, ...] }
```
`totalTimeMs` includes `errorCount * ERROR_PENALTY_MS`, which is currently 0.

## Voice notes
Voice uses the Web Speech API (`webkitSpeechRecognition`). Support in iOS standalone mode varies, so test it on the device. Interim results that match the answer count as correct immediately. A final result that does not match counts as an error. The recognizer restarts automatically if Safari stops it during a run.
