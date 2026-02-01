# Infinite Loop Detection Design

## Problem

React applications can enter infinite loops in two ways:

1. **Synchronous cascading layout effects** — `useLayoutEffect` sets state, triggering another commit, triggering another layout effect, ad infinitum. This is synchronous and freezes the browser.
2. **Async passive effect cycles** — `useEffect` sets state in a cycle, causing rapid re-renders across tasks. The browser stays responsive but React keeps re-rendering endlessly.

The current `react-flush-observer` detects forced flushes (2+ commits per task) but does not detect or intervene in infinite loops.

## Design

### Configuration & API

The `install(config)` function gets new config options:

```js
install({
  // existing
  sampleRate: 1,
  onDetection: (detection) => {},

  // new
  maxCommitsPerTask: 50,        // sync loop threshold
  maxCommitsPerWindow: 50,      // async loop threshold
  windowMs: 1000,               // async sliding window size (ms)
  onInfiniteLoop: 'throw',      // 'throw' | 'report'
})
```

- **`maxCommitsPerTask`** — Commits in a single task exceeding this triggers sync loop detection. Default 50.
- **`maxCommitsPerWindow`** / **`windowMs`** — Commits across tasks exceeding count within time window triggers async loop detection. Default 50 commits in 1000ms.
- **`onInfiniteLoop`** — `'throw'` throws `InfiniteLoopError` and schedules structured report via `setTimeout`. `'report'` fires `onDetection` without throwing. Default `'throw'`.

The existing `onDetection` callback receives loop detections too, with new pattern types.

### Sync Loop Detection

Builds on the existing `commitInCurrentTask` tracking in the detector.

- New state: `commitCountInCurrentTask` counter
- On each `onCommitFiberRoot`: if `commitInCurrentTask` is true, increment counter
- On `MessageChannel` handler (task boundary): reset counter to 0
- If `commitCountInCurrentTask >= maxCommitsPerTask`: trigger detection

### Async Loop Detection

Sliding time window — minimal overhead.

- New state: `windowCommitCount` (number), `windowStartTime` (timestamp)
- On each `onCommitFiberRoot`:
  1. `const now = performance.now()`
  2. If `now - windowStartTime > windowMs`: reset window (`windowStartTime = now`, `windowCommitCount = 0`)
  3. Increment `windowCommitCount`
  4. If `windowCommitCount >= maxCommitsPerWindow`: trigger detection

Cost per commit: one `performance.now()` call, one subtraction, one comparison, one increment.

Edge case: sync cascades also increment the window counter. Sync detection fires first, so a guard prevents async from double-firing if the observer already threw/uninstalled.

### Intervention Modes

**Throw mode (`onInfiniteLoop: 'throw'`):**

1. Capture the report (fiber snapshot, stack, commit count)
2. Call `dispose()` (close MessageChannel, restore original hook)
3. Schedule `setTimeout(() => onDetection(report))`
4. Throw `new InfiniteLoopError(report)`

Auto-uninstalls to prevent further interference. The app was already in a bad state from the loop.

**Report mode (`onInfiniteLoop: 'report'`):**

1. Fire `onDetection` immediately with structured report
2. Do NOT uninstall — keep observing
3. Stop firing loop detections for the rest of this window (spam guard)
4. Reset after window expires

### InfiniteLoopError

```js
class InfiniteLoopError extends Error {
  constructor(report) {
    super(`React infinite loop detected: ${report.commitCount} commits in one task (pattern: ${report.pattern})`)
    this.name = 'InfiniteLoopError'
    this.report = report
  }
}
```

Thrown from inside `onCommitFiberRoot` (synchronous during React commit phase). Unwinds the call stack and stops the cascade.

### Detection Report Payload

```js
{
  type: 'infinite-loop',
  pattern: 'infinite-loop-sync',   // or 'infinite-loop-async'
  commitCount: 53,
  windowMs: null,                  // null for sync, duration for async
  stack: '...',
  triggeringCommit: { ... },       // fiber snapshot
  forcedCommit: { ... },           // previous commit fiber snapshot
  userFrame: { file, line, col },  // parsed user stack frame if available
}
```

Reuses existing `snapshotCommitFibers` and `parseUserFrame` infrastructure. The `type: 'infinite-loop'` field distinguishes from existing `forced-flush` detections.

## File Changes

### Modified

- **`src/detector.js`** — Add `commitCountInCurrentTask`, `windowCommitCount`, `windowStartTime` state. Threshold checks after each commit. Throw vs report handling. Auto-uninstall on throw.
- **`src/constants.js`** — Add defaults: `DEFAULT_MAX_COMMITS_PER_TASK = 50`, `DEFAULT_MAX_COMMITS_PER_WINDOW = 50`, `DEFAULT_WINDOW_MS = 1000`.
- **`src/index.js`** — Pass new config options to detector. Export `InfiniteLoopError`.

### New

- **`src/errors.js`** — `InfiniteLoopError` class.

### Unchanged

- **`src/classifier.js`** — Loop detection bypasses classifier; has its own pattern names.
- **`src/walker.js`** — Reused as-is for fiber snapshots.
- **`src/stack-parser.js`** — Reused as-is.

## Tests

- Sync loop: 50+ `onCommitFiberRoot` calls without MessageChannel flush. Verify throw and report modes.
- Async loop: 50+ calls with MessageChannel flushes within 1000ms. Verify detection.
- Threshold configurability: `maxCommitsPerTask: 5`, verify fires at 5.
- Auto-uninstall: verify hook restored after throw-mode detection.
- No false positive: 49 commits in one task, no detection.
- Spam guard: report mode fires `onDetection` once per window.

## Demo Scenarios

- **`demo/src/scenarios/InfiniteLoopSyncTest.jsx`** — `useLayoutEffect` that unconditionally calls `setState`. Observer catches at 50 commits and throws.
- **`demo/src/scenarios/InfiniteLoopAsyncTest.jsx`** — `useEffect` that unconditionally calls `setState`. Observer catches when 50 commits land within 1 second.

Both triggered by button press (not on mount). Detection log shows pattern, commit count, and stack.

**`demo/src/App.jsx`** gets two new scenario entries.
