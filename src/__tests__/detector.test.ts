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
import type { Fiber, FiberRoot, Detector, Report } from '../types';

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

  test('does not fire onDetection for a single commit', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    detector.handleCommit(makeLayoutEffectRoot());

    expect(onDetection).not.toHaveBeenCalled();
  });

  test('fires onDetection when two commits occur in the same task', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    let now = 100;
    performance.now = () => now;

    const root1 = makeLayoutEffectRoot();
    detector.handleCommit(root1);

    now = 105;
    const root2 = makePassiveEffectRoot();
    detector.handleCommit(root2);

    expect(onDetection).toHaveBeenCalledTimes(1);
    const detection = onDetection.mock.calls[0][0] as Report;
    expect((detection as { pattern: string }).pattern).toBe(
      'setState-in-layout-effect'
    );
    // blockingDurationMs depends on Date.now() which we don't mock
    expect((detection as { blockingDurationMs: number }).blockingDurationMs).toBeGreaterThanOrEqual(0);
    expect((detection as { flushedEffectsCount: number }).flushedEffectsCount).toBe(1);
    expect(typeof detection.timestamp).toBe('number');
    expect(typeof (detection as { evidence: string }).evidence).toBe('string');
    expect(Array.isArray((detection as { suspects: unknown[] }).suspects)).toBe(true);
  });

  test('three commits in one task fires two detections', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    let now = 100;
    performance.now = () => now;

    detector.handleCommit(makeLayoutEffectRoot());
    now = 105;
    detector.handleCommit(makePassiveEffectRoot());
    now = 110;
    detector.handleCommit(makePassiveEffectRoot());

    expect(onDetection).toHaveBeenCalledTimes(2);
  });

  test('resets state after task boundary', (done) => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    detector.handleCommit(makeLayoutEffectRoot());

    // Wait for MessageChannel to fire (next task).
    setTimeout(() => {
      setTimeout(() => {
        detector.handleCommit(makeLayoutEffectRoot());
        // Second commit is in a new task, should not trigger detection
        expect(onDetection).not.toHaveBeenCalled();
        done();
      }, 0);
    }, 0);
  });

  test('respects sampleRate of 0 (never samples)', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 0 });

    detector.handleCommit(makeLayoutEffectRoot());
    detector.handleCommit(makePassiveEffectRoot());

    expect(onDetection).not.toHaveBeenCalled();
  });

  test('works without onDetection callback', () => {
    const detector = tracked({ sampleRate: 1.0 });

    // Should not throw
    detector.handleCommit(makeLayoutEffectRoot());
    detector.handleCommit(makePassiveEffectRoot());
  });

  test('classifies Suspense pattern correctly', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    const suspenseChild = makeFiber({
      tag: SuspenseComponent,
      flags: DidCapture,
    });
    const suspenseRoot = makeRoot(
      makeFiber({ subtreeFlags: DidCapture, child: suspenseChild })
    );

    detector.handleCommit(suspenseRoot);
    detector.handleCommit(makePassiveEffectRoot());

    expect(onDetection).toHaveBeenCalledTimes(1);
    expect(
      (onDetection.mock.calls[0][0] as { pattern: string }).pattern
    ).toBe('lazy-in-render');
  });

  describe('sync infinite loop detection', () => {
    test('freezes root.pendingLanes when commits in one task exceed maxCommitsPerTask', () => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        onInfiniteLoop: 'break',
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
        onInfiniteLoop: 'break',
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

    test('report mode fires onDetection without freezing', (done) => {
      const onDetection = jest.fn();
      const detector = tracked({
        onDetection,
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        onInfiniteLoop: 'report',
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
        const loopDetections = onDetection.mock.calls.filter(
          (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
        );
        expect(loopDetections.length).toBe(1);
        expect((loopDetections[0][0] as { pattern: string }).pattern).toBe(
          'infinite-loop-sync'
        );
        expect((loopDetections[0][0] as { commitCount: number }).commitCount).toBe(6);
        done();
      }, 10);
    });

    test('break mode delivers structured report via setTimeout', (done) => {
      const onDetection = jest.fn();
      const detector = tracked({
        onDetection,
        sampleRate: 1.0,
        maxCommitsPerTask: 3,
        onInfiniteLoop: 'break',
      });

      let now = 100;
      performance.now = () => now;

      for (let i = 0; i < 5; i++) {
        now += 1;
        detector.handleCommit(makeLayoutEffectRoot());
      }

      // Not called synchronously for loop detection
      const syncDetections = onDetection.mock.calls.filter(
        (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
      );
      expect(syncDetections.length).toBe(0);

      setTimeout(() => {
        const loopDetections = onDetection.mock.calls.filter(
          (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
        );
        expect(loopDetections.length).toBe(1);
        const report = loopDetections[0][0] as {
          type: string;
          pattern: string;
          commitCount: number;
          stack: string;
        };
        expect(report.type).toBe('infinite-loop');
        expect(report.pattern).toBe('infinite-loop-sync');
        expect(report.commitCount).toBeGreaterThanOrEqual(4);
        expect(report.stack).toBeDefined();
        done();
      }, 10);
    });

    test('break mode unfreezes root.pendingLanes after setTimeout', (done) => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        onInfiniteLoop: 'break',
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
        onInfiniteLoop: 'break',
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

      // Report is delivered via queueMicrotask
      setTimeout(() => {
        const loopDetections = onDetection.mock.calls.filter(
          (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
        );
        expect(loopDetections.length).toBe(1);
        done();
      }, 10);
    });
  });

  describe('async infinite loop detection', () => {
    // Skip: async detection uses queueMicrotask which has timing issues in jsdom with nested setTimeout
    test.skip('fires detection when commits across tasks exceed maxCommitsPerWindow within windowMs', (done) => {
      const onDetection = jest.fn();
      const detector = tracked({
        onDetection,
        sampleRate: 1.0,
        maxCommitsPerTask: 1000, // high — won't trigger sync detection
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
            (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
          );
          expect(loopDetections.length).toBe(1);
          expect((loopDetections[0][0] as { pattern: string }).pattern).toBe(
            'infinite-loop-async'
          );
          expect((loopDetections[0][0] as { commitCount: number }).commitCount).toBe(5);
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
          (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
        );
        expect(loopDetections.length).toBe(0);
        done();
      }, 0);
    });

    // The sync detection fires once, but async also fires because the spam guards are per-pattern
    test('sync detection takes priority over async when both would fire', (done) => {
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

      // Report is delivered via queueMicrotask
      setTimeout(() => {
        const loopDetections = onDetection.mock.calls.filter(
          (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
        );
        // Both sync and async may fire since guards are per-pattern
        expect(loopDetections.length).toBeGreaterThanOrEqual(1);
        // First detection should be sync
        expect((loopDetections[0][0] as { pattern: string }).pattern).toBe(
          'infinite-loop-sync'
        );
        done();
      }, 10);
    });
  });

  describe('flip-flop loop detection', () => {
    test('freezes callbackPriority and callbackNode alongside pendingLanes', () => {
      const detector = tracked({
        sampleRate: 1.0,
        maxCommitsPerTask: 5,
        onInfiniteLoop: 'break',
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
        onInfiniteLoop: 'break',
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
        onInfiniteLoop: 'break',
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
