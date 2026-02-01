# Infinite Loop Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect and intervene when React enters infinite commit loops — both synchronous (cascading layout effects) and async (passive effect cycles).

**Architecture:** Extends the existing detector with commit counters (per-task and sliding time window), a configurable threshold, and two intervention modes (throw or report). New `InfiniteLoopError` class provides structured diagnostics. The `index.js` try-catch is updated to re-throw `InfiniteLoopError` instead of swallowing it.

**Tech Stack:** Plain JavaScript (CommonJS), Jest 29.7, React 18.3.1 demo with Vite 6.0 + Tailwind CSS 3.4

---

### Task 1: Add default constants

**Files:**
- Modify: `src/constants.js:15-26`
- Test: `src/__tests__/constants.test.js`

**Step 1: Write the failing test**

Add to the end of the `describe('constants', ...)` block in `src/__tests__/constants.test.js`:

```js
test('DEFAULT_MAX_COMMITS_PER_TASK is 50', () => {
  expect(DEFAULT_MAX_COMMITS_PER_TASK).toBe(50);
});

test('DEFAULT_MAX_COMMITS_PER_WINDOW is 50', () => {
  expect(DEFAULT_MAX_COMMITS_PER_WINDOW).toBe(50);
});

test('DEFAULT_WINDOW_MS is 1000', () => {
  expect(DEFAULT_WINDOW_MS).toBe(1000);
});
```

Also update the require at the top of the test file to destructure the three new constants:

```js
const {
  FunctionComponent,
  ClassComponent,
  SuspenseComponent,
  OffscreenComponent,
  Placement,
  Passive,
  Update,
  LayoutMask,
  DidCapture,
  Visibility,
  DEFAULT_MAX_COMMITS_PER_TASK,
  DEFAULT_MAX_COMMITS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
} = require('../constants');
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/constants.test.js --verbose`
Expected: FAIL — `DEFAULT_MAX_COMMITS_PER_TASK` is undefined

**Step 3: Write minimal implementation**

Add to `src/constants.js` before the `module.exports`:

```js
// Infinite loop detection defaults
const DEFAULT_MAX_COMMITS_PER_TASK   = 50;
const DEFAULT_MAX_COMMITS_PER_WINDOW = 50;
const DEFAULT_WINDOW_MS              = 1000;
```

Add the three new constants to the `module.exports` object.

**Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/constants.test.js --verbose`
Expected: PASS (all 10 tests)

**Step 5: Commit**

```bash
git add src/constants.js src/__tests__/constants.test.js
git commit -m "feat: add default constants for infinite loop detection thresholds"
```

---

### Task 2: Create InfiniteLoopError class

**Files:**
- Create: `src/errors.js`
- Create: `src/__tests__/errors.test.js`

**Step 1: Write the failing test**

Create `src/__tests__/errors.test.js`:

```js
const { InfiniteLoopError } = require('../errors');

describe('InfiniteLoopError', () => {
  test('is an instance of Error', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync' };
    const err = new InfiniteLoopError(report);
    expect(err).toBeInstanceOf(Error);
  });

  test('has name InfiniteLoopError', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync' };
    const err = new InfiniteLoopError(report);
    expect(err.name).toBe('InfiniteLoopError');
  });

  test('message includes commit count and pattern', () => {
    const report = { commitCount: 53, pattern: 'infinite-loop-async' };
    const err = new InfiniteLoopError(report);
    expect(err.message).toContain('53');
    expect(err.message).toContain('infinite-loop-async');
  });

  test('exposes report on the error object', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync', stack: 'trace' };
    const err = new InfiniteLoopError(report);
    expect(err.report).toBe(report);
  });

  test('has a stack trace', () => {
    const report = { commitCount: 50, pattern: 'infinite-loop-sync' };
    const err = new InfiniteLoopError(report);
    expect(typeof err.stack).toBe('string');
    expect(err.stack.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/errors.test.js --verbose`
Expected: FAIL — Cannot find module '../errors'

**Step 3: Write minimal implementation**

Create `src/errors.js`:

```js
class InfiniteLoopError extends Error {
  constructor(report) {
    super(
      `React infinite loop detected: ${report.commitCount} commits ` +
      `in one task (pattern: ${report.pattern})`
    );
    this.name = 'InfiniteLoopError';
    this.report = report;
  }
}

module.exports = { InfiniteLoopError };
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/errors.test.js --verbose`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/errors.js src/__tests__/errors.test.js
git commit -m "feat: add InfiniteLoopError class"
```

---

### Task 3: Add sync loop detection to detector

**Files:**
- Modify: `src/detector.js` (entire file — adds new config, state, and threshold logic)
- Test: `src/__tests__/detector.test.js`

This is the largest task. The detector's `createDetector` function gets new config params and new state tracking.

**Step 1: Write the failing tests**

Add these tests to the existing `describe('createDetector', ...)` block in `src/__tests__/detector.test.js`. Also add `const { InfiniteLoopError } = require('../errors');` at the top imports.

```js
describe('sync infinite loop detection', () => {
  test('throws InfiniteLoopError when commits in one task exceed maxCommitsPerTask', () => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 5,
      onInfiniteLoop: 'throw',
    });

    let now = 100;
    performance.now = () => now;

    // First 4 extra commits (total 5 including first) should not throw
    for (let i = 0; i < 4; i++) {
      detector.handleCommit(makeLayoutEffectRoot());
      now += 1;
    }

    // 5th extra commit (6th total) should throw
    expect(() => {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }).toThrow(InfiniteLoopError);
  });

  test('does not throw when commits stay below maxCommitsPerTask', () => {
    const detector = tracked({
      sampleRate: 1.0,
      maxCommitsPerTask: 5,
      onInfiniteLoop: 'throw',
    });

    let now = 100;
    performance.now = () => now;

    // 5 commits total (4 extra) — exactly at threshold but not over
    for (let i = 0; i < 5; i++) {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }
    // Should not throw — 4 extra commits, threshold is 5
  });

  test('report mode fires onDetection without throwing', () => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 5,
      onInfiniteLoop: 'report',
    });

    let now = 100;
    performance.now = () => now;

    for (let i = 0; i < 6; i++) {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }

    // Should have been called — once for loop detection, plus normal forced-flush detections
    const loopDetections = onDetection.mock.calls.filter(
      c => c[0].type === 'infinite-loop'
    );
    expect(loopDetections.length).toBe(1);
    expect(loopDetections[0][0].pattern).toBe('infinite-loop-sync');
    expect(loopDetections[0][0].commitCount).toBe(6);
  });

  test('thrown InfiniteLoopError has structured report', () => {
    const detector = tracked({
      sampleRate: 1.0,
      maxCommitsPerTask: 3,
      onInfiniteLoop: 'throw',
    });

    let now = 100;
    performance.now = () => now;

    let caught;
    try {
      for (let i = 0; i < 5; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InfiniteLoopError);
    expect(caught.report.type).toBe('infinite-loop');
    expect(caught.report.pattern).toBe('infinite-loop-sync');
    expect(caught.report.commitCount).toBeGreaterThanOrEqual(4);
    expect(caught.report.stack).toBeDefined();
  });

  test('throw mode schedules onDetection via setTimeout', (done) => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 3,
      onInfiniteLoop: 'throw',
    });

    let now = 100;
    performance.now = () => now;

    try {
      for (let i = 0; i < 5; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }
    } catch (e) {
      // Expected throw
    }

    // onDetection should NOT have been called synchronously for the loop
    const loopDetections = onDetection.mock.calls.filter(
      c => c[0].type === 'infinite-loop'
    );
    expect(loopDetections.length).toBe(0);

    // But it should be called async via setTimeout
    setTimeout(() => {
      const asyncLoopDetections = onDetection.mock.calls.filter(
        c => c[0].type === 'infinite-loop'
      );
      expect(asyncLoopDetections.length).toBe(1);
      done();
    }, 0);
  });

  test('sync loop counter resets at task boundary', (done) => {
    const detector = tracked({
      sampleRate: 1.0,
      maxCommitsPerTask: 5,
      onInfiniteLoop: 'throw',
    });

    let now = 100;
    performance.now = () => now;

    // 3 commits in first task
    for (let i = 0; i < 3; i++) {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }

    // Wait for task boundary (MessageChannel flush)
    setTimeout(() => {
      // 3 more commits in new task — should NOT throw (counter reset)
      for (let i = 0; i < 3; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }
      done();
    }, 0);
  });

  test('report mode spam guard: only fires once per task', () => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 3,
      onInfiniteLoop: 'report',
    });

    let now = 100;
    performance.now = () => now;

    for (let i = 0; i < 10; i++) {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }

    const loopDetections = onDetection.mock.calls.filter(
      c => c[0].type === 'infinite-loop'
    );
    expect(loopDetections.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/detector.test.js --verbose`
Expected: FAIL — `createDetector` doesn't accept the new config params; no infinite loop behavior

**Step 3: Write minimal implementation**

Modify `src/detector.js` to the following complete content:

```js
const { snapshotCommitFibers } = require('./walker');
const { classifyPattern } = require('./classifier');
const { parseUserFrame } = require('./stack-parser');
const { InfiniteLoopError } = require('./errors');
const {
  DEFAULT_MAX_COMMITS_PER_TASK,
  DEFAULT_MAX_COMMITS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
} = require('./constants');

function createDetector(config = {}) {
  const {
    sampleRate = 1.0,
    onDetection = null,
    maxCommitsPerTask = DEFAULT_MAX_COMMITS_PER_TASK,
    maxCommitsPerWindow = DEFAULT_MAX_COMMITS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    onInfiniteLoop = 'throw',
  } = config;

  const state = {
    commitInCurrentTask: false,
    taskBoundaryPending: false,
    lastCommitTime: 0,
    lastCommitRoot: null,
    // Sync loop tracking
    commitCountInCurrentTask: 0,
    syncLoopFiredThisTask: false,
    // Async loop tracking
    windowCommitCount: 0,
    windowStartTime: 0,
    asyncLoopFiredThisWindow: false,
    // Disposal guard
    disposed: false,
  };

  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    state.commitInCurrentTask = false;
    state.taskBoundaryPending = false;
    state.lastCommitRoot = null;
    state.commitCountInCurrentTask = 0;
    state.syncLoopFiredThisTask = false;
  };

  function buildLoopReport(root, pattern, commitCount, windowDuration) {
    const triggeringFibers = state.lastCommitRoot
      ? snapshotCommitFibers(state.lastCommitRoot)
      : null;
    const forcedFibers = snapshotCommitFibers(root);

    let stack = null;
    let userFrame = null;
    try {
      stack = new Error().stack;
      userFrame = parseUserFrame(stack);
    } catch (_) {
      // Best-effort
    }

    return {
      type: 'infinite-loop',
      pattern,
      commitCount,
      windowMs: windowDuration,
      stack,
      triggeringCommit: triggeringFibers,
      forcedCommit: forcedFibers,
      userFrame,
      timestamp: Date.now(),
    };
  }

  function handleLoopDetection(root, pattern, commitCount, windowDuration) {
    const report = buildLoopReport(root, pattern, commitCount, windowDuration);

    if (onInfiniteLoop === 'throw') {
      dispose();
      if (onDetection) {
        setTimeout(() => onDetection(report), 0);
      }
      throw new InfiniteLoopError(report);
    } else {
      // report mode
      onDetection?.(report);
    }
  }

  function handleCommit(root) {
    if (state.disposed) return;

    const now = performance.now();

    // --- Existing forced-flush detection ---
    if (state.commitInCurrentTask && state.lastCommitRoot !== null) {
      if (Math.random() < sampleRate) {
        const triggeringFibers = snapshotCommitFibers(state.lastCommitRoot);
        const forcedFibers = snapshotCommitFibers(root);
        const classification = classifyPattern(triggeringFibers);

        const detection = {
          timestamp: Date.now(),
          pattern: classification.pattern,
          evidence: classification.evidence,
          suspects: classification.suspects,
          flushedEffectsCount: forcedFibers.withPassiveEffects.length,
          blockingDurationMs: now - state.lastCommitTime,
        };

        if (classification.pattern === 'setState-outside-react') {
          try {
            const stack = new Error().stack;
            const frame = parseUserFrame(stack);
            detection.setStateLocation = frame ?? null;
          } catch (_) {
            detection.setStateLocation = null;
          }
        }

        onDetection?.(detection);
      }
    }

    // --- Update state ---
    state.lastCommitTime = now;
    state.lastCommitRoot = root;

    if (state.commitInCurrentTask) {
      state.commitCountInCurrentTask++;
    } else {
      state.commitCountInCurrentTask = 0;
    }

    state.commitInCurrentTask = true;

    if (!state.taskBoundaryPending) {
      state.taskBoundaryPending = true;
      channel.port2.postMessage(null);
    }

    // --- Sync loop check (after state update) ---
    if (
      state.commitCountInCurrentTask >= maxCommitsPerTask &&
      !state.syncLoopFiredThisTask
    ) {
      state.syncLoopFiredThisTask = true;
      handleLoopDetection(
        root,
        'infinite-loop-sync',
        state.commitCountInCurrentTask + 1, // +1 for the initial commit
        null
      );
    }

    // --- Async loop check ---
    if (now - state.windowStartTime > windowMs) {
      state.windowStartTime = now;
      state.windowCommitCount = 0;
      state.asyncLoopFiredThisWindow = false;
    }
    state.windowCommitCount++;

    if (
      state.windowCommitCount >= maxCommitsPerWindow &&
      !state.asyncLoopFiredThisWindow &&
      !state.syncLoopFiredThisTask
    ) {
      state.asyncLoopFiredThisWindow = true;
      handleLoopDetection(
        root,
        'infinite-loop-async',
        state.windowCommitCount,
        now - state.windowStartTime
      );
    }
  }

  function dispose() {
    state.disposed = true;
    channel.port1.close();
    channel.port2.close();
  }

  return { handleCommit, dispose };
}

module.exports = { createDetector };
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/detector.test.js --verbose`
Expected: PASS (all existing + new tests)

**Step 5: Run full test suite**

Run: `npx jest --verbose`
Expected: PASS (all tests across all files — the detector change must not break existing behavior)

**Step 6: Commit**

```bash
git add src/detector.js src/__tests__/detector.test.js
git commit -m "feat: add sync infinite loop detection to detector"
```

---

### Task 4: Add async loop detection tests

**Files:**
- Test: `src/__tests__/detector.test.js`

The async detection logic was included in Task 3's implementation. This task adds focused tests for the async path.

**Step 1: Write the tests**

Add a new `describe('async infinite loop detection', ...)` block inside the main `describe('createDetector', ...)` in `src/__tests__/detector.test.js`:

```js
describe('async infinite loop detection', () => {
  test('fires detection when commits across tasks exceed maxCommitsPerWindow within windowMs', (done) => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 1000,  // high — won't trigger sync detection
      maxCommitsPerWindow: 5,
      windowMs: 1000,
      onInfiniteLoop: 'report',
    });

    let now = 100;
    performance.now = () => now;

    // First task: 2 commits
    detector.handleCommit(makeLayoutEffectRoot());
    now += 1;
    detector.handleCommit(makeLayoutEffectRoot());

    // Wait for task boundary
    setTimeout(() => {
      now += 10;
      // Second task: 2 more commits
      detector.handleCommit(makeLayoutEffectRoot());
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());

      setTimeout(() => {
        now += 10;
        // Third task: 1 more commit — total 5, should trigger
        detector.handleCommit(makeLayoutEffectRoot());

        const loopDetections = onDetection.mock.calls.filter(
          c => c[0].type === 'infinite-loop'
        );
        expect(loopDetections.length).toBe(1);
        expect(loopDetections[0][0].pattern).toBe('infinite-loop-async');
        expect(loopDetections[0][0].commitCount).toBe(5);
        done();
      }, 0);
    }, 0);
  });

  test('async window resets after windowMs elapses', (done) => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 1000,
      maxCommitsPerWindow: 5,
      windowMs: 100,
      onInfiniteLoop: 'report',
    });

    let now = 100;
    performance.now = () => now;

    // 3 commits in first window
    for (let i = 0; i < 3; i++) {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }

    setTimeout(() => {
      // Jump past windowMs
      now += 200;

      // 3 more commits in new window — should NOT trigger (only 3 in this window)
      for (let i = 0; i < 3; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }

      const loopDetections = onDetection.mock.calls.filter(
        c => c[0].type === 'infinite-loop'
      );
      expect(loopDetections.length).toBe(0);
      done();
    }, 0);
  });

  test('async throw mode throws InfiniteLoopError', (done) => {
    const detector = tracked({
      sampleRate: 1.0,
      maxCommitsPerTask: 1000,
      maxCommitsPerWindow: 3,
      windowMs: 1000,
      onInfiniteLoop: 'throw',
    });

    let now = 100;
    performance.now = () => now;

    detector.handleCommit(makeLayoutEffectRoot());
    now += 1;
    detector.handleCommit(makeLayoutEffectRoot());

    setTimeout(() => {
      now += 10;
      expect(() => {
        detector.handleCommit(makeLayoutEffectRoot());
      }).toThrow(InfiniteLoopError);
      done();
    }, 0);
  });

  test('sync detection takes priority over async when both would fire', () => {
    const onDetection = jest.fn();
    const detector = tracked({
      onDetection,
      sampleRate: 1.0,
      maxCommitsPerTask: 3,
      maxCommitsPerWindow: 3,
      windowMs: 1000,
      onInfiniteLoop: 'report',
    });

    let now = 100;
    performance.now = () => now;

    for (let i = 0; i < 5; i++) {
      now += 1;
      detector.handleCommit(makeLayoutEffectRoot());
    }

    const loopDetections = onDetection.mock.calls.filter(
      c => c[0].type === 'infinite-loop'
    );
    // Only sync should fire — guard prevents async double-fire
    expect(loopDetections.length).toBe(1);
    expect(loopDetections[0][0].pattern).toBe('infinite-loop-sync');
  });
});
```

**Step 2: Run tests**

Run: `npx jest src/__tests__/detector.test.js --verbose`
Expected: PASS (all tests including async)

**Step 3: Commit**

```bash
git add src/__tests__/detector.test.js
git commit -m "test: add async infinite loop detection tests"
```

---

### Task 5: Update index.js to pass new config and re-throw InfiniteLoopError

**Files:**
- Modify: `src/index.js`
- Test: `src/__tests__/index.test.js`

The critical change here: the try-catch in `onCommitFiberRoot` currently swallows all errors. It must re-throw `InfiniteLoopError` so the throw actually propagates.

**Step 1: Write the failing tests**

Add `const { InfiniteLoopError } = require('../errors');` to the imports in `src/__tests__/index.test.js`.

Add these tests inside the existing `describe('install', ...)` block:

```js
test('passes infinite loop config to detector', () => {
  delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const onDetection = jest.fn();
  const uninstall = install({
    onDetection,
    maxCommitsPerTask: 3,
    onInfiniteLoop: 'report',
  });
  uninstallFns.push(uninstall);

  let now = 100;
  const origNow = performance.now;
  performance.now = () => now;

  const root = {
    current: {
      tag: 0, type: function Test() {}, flags: 36, subtreeFlags: 36,
      lanes: 0, childLanes: 0, sibling: null,
      child: { tag: 0, type: function Inner() {}, flags: 36, subtreeFlags: 0, lanes: 0, childLanes: 0, child: null, sibling: null },
    },
  };

  for (let i = 0; i < 5; i++) {
    now += 1;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root, 0, false);
  }

  const loopDetections = onDetection.mock.calls.filter(
    c => c[0].type === 'infinite-loop'
  );
  expect(loopDetections.length).toBe(1);
  performance.now = origNow;
});

test('InfiniteLoopError propagates through onCommitFiberRoot', () => {
  delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const uninstall = install({
    maxCommitsPerTask: 3,
    onInfiniteLoop: 'throw',
  });
  uninstallFns.push(uninstall);

  let now = 100;
  const origNow = performance.now;
  performance.now = () => now;

  const root = {
    current: {
      tag: 0, type: function Test() {}, flags: 36, subtreeFlags: 36,
      lanes: 0, childLanes: 0, sibling: null,
      child: { tag: 0, type: function Inner() {}, flags: 36, subtreeFlags: 0, lanes: 0, childLanes: 0, child: null, sibling: null },
    },
  };

  expect(() => {
    for (let i = 0; i < 5; i++) {
      now += 1;
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root, 0, false);
    }
  }).toThrow(InfiniteLoopError);

  performance.now = origNow;
});

test('exports InfiniteLoopError', () => {
  const mod = require('../index');
  expect(mod.InfiniteLoopError).toBeDefined();
  expect(new mod.InfiniteLoopError({ commitCount: 1, pattern: 'test' })).toBeInstanceOf(Error);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/index.test.js --verbose`
Expected: FAIL — config not passed through, InfiniteLoopError swallowed by try-catch

**Step 3: Write minimal implementation**

Replace `src/index.js` with:

```js
const { createDetector } = require('./detector');
const { InfiniteLoopError } = require('./errors');

function install(config = {}) {
  const {
    sampleRate = 1.0,
    onDetection = null,
    maxCommitsPerTask,
    maxCommitsPerWindow,
    windowMs,
    onInfiniteLoop,
  } = config;

  const existingHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const detector = createDetector({
    sampleRate,
    onDetection,
    maxCommitsPerTask,
    maxCommitsPerWindow,
    windowMs,
    onInfiniteLoop,
  });

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject(internals) {
      return existingHook?.inject?.(internals) ?? 1;
    },
    onCommitFiberRoot(id, root, priority, didError) {
      try {
        detector.handleCommit(root);
      } catch (e) {
        if (e instanceof InfiniteLoopError) {
          existingHook?.onCommitFiberRoot?.(id, root, priority, didError);
          throw e;
        }
        // Observability must never break the observed application
      }
      existingHook?.onCommitFiberRoot?.(id, root, priority, didError);
    },
    onPostCommitFiberRoot(id, root) {
      existingHook?.onPostCommitFiberRoot?.(id, root);
    },
    onCommitFiberUnmount(id, fiber) {
      existingHook?.onCommitFiberUnmount?.(id, fiber);
    },
  };

  return function uninstall() {
    detector.dispose();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
  };
}

module.exports = { install, InfiniteLoopError };
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/index.test.js --verbose`
Expected: PASS (all tests)

**Step 5: Run full test suite**

Run: `npx jest --verbose`
Expected: PASS (all tests across all files)

**Step 6: Commit**

```bash
git add src/index.js src/__tests__/index.test.js
git commit -m "feat: pass infinite loop config through install, re-throw InfiniteLoopError"
```

---

### Task 6: Add InfiniteLoopSyncTest demo scenario

**Files:**
- Create: `demo/src/scenarios/InfiniteLoopSyncTest.jsx`
- Modify: `demo/src/App.jsx`
- Modify: `demo/src/detection-log.js` (add styles for new patterns)

**Step 1: Add pattern styles to detection log**

In `demo/src/detection-log.js`, add two entries to the `PATTERN_STYLES` object:

```js
'infinite-loop-sync': {
  bg: 'bg-rose-50',
  border: 'border-rose-600',
  label: 'Infinite Loop (Sync)',
},
'infinite-loop-async': {
  bg: 'bg-rose-50',
  border: 'border-rose-600',
  label: 'Infinite Loop (Async)',
},
```

Also update `appendDetection` to handle the `type: 'infinite-loop'` payload. After the existing `meta` element creation, add:

```js
if (detection.type === 'infinite-loop') {
  const loopMeta = document.createElement('span');
  loopMeta.className = 'text-rose-600 text-xs font-semibold block mt-0.5';
  loopMeta.textContent = `${detection.commitCount} commits detected`;
  entry.appendChild(loopMeta);
}
```

**Step 2: Create the sync test scenario**

Create `demo/src/scenarios/InfiniteLoopSyncTest.jsx`:

```jsx
import React, { useState, useLayoutEffect } from 'react';

function InfiniteLooper({ active }) {
  const [count, setCount] = useState(0);

  useLayoutEffect(() => {
    if (active) {
      // Unconditional setState in layout effect = synchronous infinite loop
      setCount(c => c + 1);
    }
  }, [active, count]);

  return <span className="text-xs text-gray-500 ml-2">renders: {count}</span>;
}

export default function InfiniteLoopSyncTest() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = () => {
    setError(null);
    try {
      setActive(true);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Infinite loop (sync)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-800">
          infinite-loop-sync
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> unconditionally calls setState,
        creating a synchronous cascade. Observer throws <code className="bg-gray-100 px-1 rounded">InfiniteLoopError</code> at
        threshold to stop the freeze.
      </p>
      <button
        onClick={handleClick}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger sync loop
      </button>
      {active && <InfiniteLooper active={active} />}
      {error && (
        <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 font-mono">
          {error}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create the async test scenario**

Create `demo/src/scenarios/InfiniteLoopAsyncTest.jsx`:

```jsx
import React, { useState, useEffect } from 'react';

function AsyncLooper({ active }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (active) {
      // Unconditional setState in passive effect = async infinite loop
      setCount(c => c + 1);
    }
  }, [active, count]);

  return <span className="text-xs text-gray-500 ml-2">renders: {count}</span>;
}

export default function InfiniteLoopAsyncTest() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = () => {
    setError(null);
    setActive(true);
  };

  // Listen for uncaught InfiniteLoopError
  React.useEffect(() => {
    const handler = (event) => {
      if (event.error?.name === 'InfiniteLoopError') {
        event.preventDefault();
        setError(event.error.message);
        setActive(false);
      }
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Infinite loop (async)
        <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-800">
          infinite-loop-async
        </span>
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        <code className="bg-gray-100 px-1 rounded">useEffect</code> unconditionally calls setState,
        creating a rapid async re-render loop. Observer detects when commits exceed threshold
        within the time window.
      </p>
      <button
        onClick={handleClick}
        className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
      >
        Trigger async loop
      </button>
      {active && <AsyncLooper active={active} />}
      {error && (
        <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 font-mono">
          {error}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Update App.jsx**

Add imports and render the two new components. Add after the existing imports:

```jsx
import InfiniteLoopSyncTest from './scenarios/InfiniteLoopSyncTest';
import InfiniteLoopAsyncTest from './scenarios/InfiniteLoopAsyncTest';
```

Add inside the `<div>` after `<CascadeTest />`:

```jsx
<InfiniteLoopSyncTest />
<InfiniteLoopAsyncTest />
```

**Step 5: Update demo setup to pass config**

In `demo/src/setup.js`, update the `install` call to pass the new config:

```js
install({
  onDetection: appendDetection,
  maxCommitsPerTask: 50,
  onInfiniteLoop: 'throw',
});
```

**Step 6: Commit**

```bash
git add demo/src/scenarios/InfiniteLoopSyncTest.jsx demo/src/scenarios/InfiniteLoopAsyncTest.jsx demo/src/App.jsx demo/src/detection-log.js demo/src/setup.js
git commit -m "feat: add infinite loop sync and async demo scenarios"
```

---

### Task 7: Final verification

**Step 1: Run the full test suite**

Run: `npx jest --verbose`
Expected: PASS (all tests — original 56 + new ~20)

**Step 2: Verify demo starts**

Run from the worktree root: `cd demo && npm run dev`
Expected: Vite dev server starts. Open in browser, verify:
- All existing scenarios still work
- "Infinite loop (sync)" button triggers error + detection log entry
- "Infinite loop (async)" button triggers error + detection log entry

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during verification"
```

Only commit if changes were needed. Skip if everything passes clean.
