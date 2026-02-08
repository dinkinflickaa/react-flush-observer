// jsdom does not provide MessageChannel; expose Node's built-in implementation
if (typeof globalThis.MessageChannel === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MessageChannel } = require('worker_threads');
  globalThis.MessageChannel = MessageChannel;
}

import { createDetector } from '../detector';
import {
  FunctionComponent,
  SuspenseComponent,
  Passive,
  LayoutMask,
  DidCapture,
} from '../constants';
import type { Fiber, FiberRoot, Detector, FlushReport, LoopReport } from '../types';

function makeFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: FunctionComponent,
    type: overrides.type ?? function Mock() {},
    flags: 0,
    subtreeFlags: 0,
    lanes: 0,
    childLanes: 0,
    child: null,
    sibling: null,
    ...overrides,
  };
}

function makeRoot(fiber: Fiber): FiberRoot {
  return {
    current: fiber,
    pendingLanes: 0,
    callbackPriority: 0,
    callbackNode: null,
  };
}

// Root with a fiber that has layout effects (triggers setState-in-layout-effect)
function makeLayoutEffectRoot(): FiberRoot {
  const child = makeFiber({ flags: LayoutMask });
  return makeRoot(makeFiber({ subtreeFlags: LayoutMask, child }));
}

// Root with a fiber that has passive effects
function makePassiveEffectRoot(): FiberRoot {
  const child = makeFiber({ flags: Passive });
  return makeRoot(makeFiber({ subtreeFlags: Passive, child }));
}

describe('createDetector', () => {
  let originalPerformanceNow: typeof performance.now;
  let detectors: Detector[];

  beforeEach(() => {
    originalPerformanceNow = performance.now;
    detectors = [];
  });

  afterEach(() => {
    performance.now = originalPerformanceNow;
    detectors.forEach((d) => d.dispose());
  });

  function tracked(config: Parameters<typeof createDetector>[0] = {}): Detector {
    const detector = createDetector(config);
    detectors.push(detector);
    return detector;
  }

  test('does not fire onFlush for a single commit', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    detector.handleCommit(makeLayoutEffectRoot());

    expect(onFlush).not.toHaveBeenCalled();
  });

  test('fires onFlush when two commits occur in the same task', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    let now = 100;
    performance.now = () => now;

    const root1 = makeLayoutEffectRoot();
    detector.handleCommit(root1);

    now = 105;
    const root2 = makePassiveEffectRoot();
    detector.handleCommit(root2);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const report = onFlush.mock.calls[0][0] as FlushReport;
    expect(report.type).toBe('flush');
    expect(report.pattern).toBe('setState-in-layout-effect');
    expect(report.blockingDurationMs).toBeGreaterThanOrEqual(0);
    expect(report.flushedEffectsCount).toBe(1);
    expect(typeof report.timestamp).toBe('number');
    expect(typeof report.evidence).toBe('string');
    expect(Array.isArray(report.suspects)).toBe(true);
  });

  test('three commits in one task fires two flush reports for cascading layout effects', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    let now = 100;
    performance.now = () => now;

    // Models a 3-commit cascade: each commit has layout effects that trigger
    // the next setState, producing a genuine cascading nested update.
    detector.handleCommit(makeLayoutEffectRoot());
    now = 105;
    detector.handleCommit(makeLayoutEffectRoot());
    now = 110;
    detector.handleCommit(makeLayoutEffectRoot());

    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  test('resets state after task boundary', (done) => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    detector.handleCommit(makeLayoutEffectRoot());

    // Wait for MessageChannel to fire (next task).
    setTimeout(() => {
      setTimeout(() => {
        detector.handleCommit(makeLayoutEffectRoot());
        // Second commit is in a new task, should not trigger detection
        expect(onFlush).not.toHaveBeenCalled();
        done();
      }, 0);
    }, 0);
  });

  test('respects sampleRate of 0 (never samples)', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 0 });

    detector.handleCommit(makeLayoutEffectRoot());
    detector.handleCommit(makePassiveEffectRoot());

    expect(onFlush).not.toHaveBeenCalled();
  });

  test('works without onFlush callback', () => {
    const detector = tracked({ sampleRate: 1.0 });

    // Should not throw
    detector.handleCommit(makeLayoutEffectRoot());
    detector.handleCommit(makePassiveEffectRoot());
  });

  test('does not fire for unbatched setTimeout-style commits (no layout effects, no flushSync)', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    // Two passive-effect roots — classified as setState-outside-react,
    // no flushSync in the call stack → skip reporting
    detector.handleCommit(makePassiveEffectRoot());
    detector.handleCommit(makePassiveEffectRoot());

    expect(onFlush).not.toHaveBeenCalled();
  });

  test('fires with flushSync pattern when flushSync is in the call stack', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    // Wrap in a function named flushSync so it appears in Error().stack
    function flushSync() {
      detector.handleCommit(makePassiveEffectRoot());
    }

    flushSync(); // commit 1 — stack contains "flushSync"
    flushSync(); // commit 2 — forced flush, stack still has "flushSync"

    expect(onFlush).toHaveBeenCalledTimes(1);
    const report = onFlush.mock.calls[0][0] as FlushReport;
    expect(report.pattern).toBe('flushSync');
    expect(report.evidence).toBe('flushSync caused synchronous re-render');
  });

  test('classifies Suspense pattern correctly', () => {
    const onFlush = jest.fn();
    const detector = tracked({ onFlush, sampleRate: 1.0 });

    const suspenseChild = makeFiber({
      tag: SuspenseComponent,
      flags: DidCapture,
    });
    const suspenseRoot = makeRoot(
      makeFiber({ subtreeFlags: DidCapture, child: suspenseChild })
    );

    detector.handleCommit(suspenseRoot);
    detector.handleCommit(makePassiveEffectRoot());

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(
      (onFlush.mock.calls[0][0] as FlushReport).pattern
    ).toBe('lazy-in-render');
  });

  describe('sync infinite loop detection', () => {
    test('freezes root.pendingLanes when commits in one task exceed maxCommitsPerTask', () => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1; // SyncLane

      // 6 commits: detection fires on the 6th
      for (let i = 0; i < 6; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // root.pendingLanes is frozen to 0
      expect(root.pendingLanes).toBe(0);
      // Writes are absorbed by the frozen setter
      root.pendingLanes = 42;
      expect(root.pendingLanes).toBe(0);
    });

    test('does not freeze when commits stay at maxCommitsPerTask', () => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;

      // 5 commits — below threshold
      for (let i = 0; i < 5; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // Should NOT be frozen
      expect(root.pendingLanes).toBe(1);
    });

    test('report mode fires onLoop without freezing', (done) => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: false,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;

      for (let i = 0; i < 6; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // root NOT frozen in report mode
      expect(root.pendingLanes).toBe(1);

      // Report is delivered via queueMicrotask, so check after a tick
      setTimeout(() => {
        expect(onLoop).toHaveBeenCalledTimes(1);
        const report = onLoop.mock.calls[0][0] as LoopReport;
        expect(report.type).toBe('loop');
        expect(report.pattern).toBe('sync');
        expect(report.commitCount).toBe(6);
        done();
      }, 10);
    });

    test('break mode delivers structured report via setTimeout', (done) => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 3,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      for (let i = 0; i < 5; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }

      // Not called synchronously for loop detection
      expect(onLoop).not.toHaveBeenCalled();

      setTimeout(() => {
        expect(onLoop).toHaveBeenCalledTimes(1);
        const report = onLoop.mock.calls[0][0] as LoopReport;
        expect(report.type).toBe('loop');
        expect(report.pattern).toBe('sync');
        expect(report.commitCount).toBeGreaterThanOrEqual(4);
        expect(report.stack).toBeDefined();
        done();
      }, 10);
    });

    test('break mode unfreezes root.pendingLanes after setTimeout', (done) => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;

      for (let i = 0; i < 6; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // Frozen immediately
      expect(root.pendingLanes).toBe(0);

      setTimeout(() => {
        // Unfrozen — pendingLanes is a normal property again (set to 0)
        expect(root.pendingLanes).toBe(0);
        root.pendingLanes = 42;
        expect(root.pendingLanes).toBe(42); // writes work again
        done();
      }, 10);
    });

    test('sync loop counter resets at task boundary', (done) => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;

      // 3 commits in first task
      for (let i = 0; i < 3; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // Wait for task boundary (MessageChannel flush)
      setTimeout(() => {
        // 3 more commits in new task — should NOT freeze (counter reset)
        for (let i = 0; i < 3; i++) {
          now += 1;
          detector.handleCommit(root);
        }
        // Not frozen
        expect(root.pendingLanes).toBe(1);
        done();
      }, 0);
    });

    test('report mode spam guard: only fires once per task', (done) => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 3,
        breakOnLoop: false,
      });

      let now = 100;
      performance.now = () => now;

      for (let i = 0; i < 10; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }

      // Report is delivered via queueMicrotask
      setTimeout(() => {
        expect(onLoop).toHaveBeenCalledTimes(1);
        done();
      }, 10);
    });
  });

  describe('async infinite loop detection (sliding window)', () => {
    test('fires when commits across tasks exceed maxCommitsPerWindow within windowMs', () => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 1000, // high — won't trigger sync detection
        maxCommitsPerWindow: 5,
        windowMs: 1000,
        breakOnLoop: false,
      });

      // Ring buffer fills after 5 commits, 6th triggers detection
      // All within < 1000ms of each other (synchronous = ~0ms apart)
      for (let i = 0; i < 6; i++) {
        detector.handleCommit(makeLayoutEffectRoot());
      }

      // Sliding window fires synchronously (inline, not via queueMicrotask)
      // because handleLoopDetection doesn't return early for async — it still
      // records the commit. The onLoop callback is queued via queueMicrotask.
      // But the detection itself happens on the 6th commit.
      // In breakOnLoop: false mode, report is delivered via queueMicrotask.
      // We need to wait for it.
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(onLoop).toHaveBeenCalledTimes(1);
          const report = onLoop.mock.calls[0][0] as LoopReport;
          expect(report.type).toBe('loop');
          expect(report.pattern).toBe('async');
          expect(report.commitCount).toBe(6);
          expect(report.windowMs).toBeLessThan(1000);
          resolve();
        }, 10);
      });
    });

    test('does not fire when commits are spread beyond windowMs', () => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 1000,
        maxCommitsPerWindow: 5,
        windowMs: 100,
        breakOnLoop: false,
      });

      // Mock Date.now to control timing
      const originalDateNow = Date.now;
      let now = 1000;
      Date.now = () => now;

      try {
        // 3 commits in first batch
        for (let i = 0; i < 3; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        // Jump past windowMs
        now += 200;

        // 3 more commits — the ring buffer now has 6 entries total but the
        // oldest (from first batch) is >200ms ago, so no detection
        for (let i = 0; i < 3; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        expect(onLoop).not.toHaveBeenCalled();
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('sliding window catches bursts that straddle tumbling window boundaries', () => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 1000,
        maxCommitsPerWindow: 5,
        windowMs: 100,
        breakOnLoop: false,
      });

      const originalDateNow = Date.now;
      let now = 1000;
      Date.now = () => now;

      try {
        // 4 commits near the end of one hypothetical "window"
        for (let i = 0; i < 4; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        // Small gap (still within 100ms of the first commit)
        now += 10;

        // 2 more commits — total 6 within ~14ms, all within windowMs
        // A tumbling window might miss this if the boundary fell between batches
        for (let i = 0; i < 2; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        // Should have fired — 6 > 5 commits within 100ms
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(onLoop).toHaveBeenCalledTimes(1);
            const report = onLoop.mock.calls[0][0] as LoopReport;
            expect(report.pattern).toBe('async');
            resolve();
          }, 10);
        });
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('spam guard: only fires once per windowMs', () => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 1000,
        maxCommitsPerWindow: 3,
        windowMs: 100,
        breakOnLoop: false,
      });

      const originalDateNow = Date.now;
      let now = 1000;
      Date.now = () => now;

      try {
        // 10 commits rapidly — should only fire once due to spam guard
        for (let i = 0; i < 10; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        return new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(onLoop).toHaveBeenCalledTimes(1);
            resolve();
          }, 10);
        });
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('fires again after spam guard cooldown', () => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 1000,
        maxCommitsPerWindow: 3,
        windowMs: 100,
        breakOnLoop: false,
      });

      const originalDateNow = Date.now;
      let now = 1000;
      Date.now = () => now;

      try {
        // First burst: 4 commits triggers detection
        for (let i = 0; i < 4; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        // Jump past windowMs (spam guard cooldown)
        now += 200;

        // Second burst: another 4 commits should trigger again
        for (let i = 0; i < 4; i++) {
          now += 1;
          detector.handleCommit(makeLayoutEffectRoot());
        }

        return new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(onLoop).toHaveBeenCalledTimes(2);
            resolve();
          }, 10);
        });
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('sync detection takes priority over async when both would fire', (done) => {
      const onLoop = jest.fn();
      const detector = tracked({
        onLoop,
        sampleRate: 1.0,
        maxCommitsPerTask: 3,
        maxCommitsPerWindow: 3,
        windowMs: 1000,
        breakOnLoop: false,
      });

      for (let i = 0; i < 5; i++) {
        detector.handleCommit(makeLayoutEffectRoot());
      }

      // Reports are delivered via queueMicrotask
      setTimeout(() => {
        // First detection should be sync (fires at commit 4, before async at commit 4)
        expect(onLoop.mock.calls.length).toBeGreaterThanOrEqual(1);
        const report = onLoop.mock.calls[0][0] as LoopReport;
        expect(report.pattern).toBe('sync');
        done();
      }, 10);
    });
  });

  describe('flip-flop loop detection', () => {
    test('freezes callbackPriority and callbackNode alongside pendingLanes', () => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;
      root.callbackPriority = 1;
      root.callbackNode = { callback: () => {} };

      // 6 commits triggers detection
      for (let i = 0; i < 6; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // All three properties are frozen
      expect(root.pendingLanes).toBe(0);
      expect(root.callbackPriority).toBe(1); // SyncLane
      expect(root.callbackNode).toBe(null);

      // Writes are absorbed by frozen setters
      root.pendingLanes = 42;
      root.callbackPriority = 0;
      root.callbackNode = { callback: () => {} };
      expect(root.pendingLanes).toBe(0);
      expect(root.callbackPriority).toBe(1);
      expect(root.callbackNode).toBe(null);
    });

    test('unfreezes all three properties after setTimeout', (done) => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;
      root.callbackPriority = 2;
      root.callbackNode = { callback: () => {} };

      for (let i = 0; i < 6; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // Frozen immediately
      expect(root.pendingLanes).toBe(0);
      expect(root.callbackPriority).toBe(1);
      expect(root.callbackNode).toBe(null);

      setTimeout(() => {
        // All properties are writable again after unfreeze
        expect(root.pendingLanes).toBe(0);
        expect(root.callbackPriority).toBe(0);
        expect(root.callbackNode).not.toBe(null);

        // Confirm writes work
        root.pendingLanes = 99;
        root.callbackPriority = 7;
        root.callbackNode = null;
        expect(root.pendingLanes).toBe(99);
        expect(root.callbackPriority).toBe(7);
        expect(root.callbackNode).toBe(null);
        done();
      }, 10);
    });

    test('freeze handles roots without callbackPriority or callbackNode', () => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        breakOnLoop: true,
      });

      let now = 100;
      performance.now = () => now;

      // Minimal root — no callbackPriority or callbackNode properties
      const root = makeLayoutEffectRoot();
      root.pendingLanes = 1;

      for (let i = 0; i < 6; i++) {
        now += 1;
        detector.handleCommit(root);
      }

      // Should still freeze all three without throwing
      expect(root.pendingLanes).toBe(0);
      expect(root.callbackPriority).toBe(1); // SyncLane
      expect(root.callbackNode).toBe(null);
    });
  });
});
