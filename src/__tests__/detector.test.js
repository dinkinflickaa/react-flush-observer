// jsdom does not provide MessageChannel; expose Node's built-in implementation
if (typeof globalThis.MessageChannel === 'undefined') {
  const { MessageChannel } = require('worker_threads');
  globalThis.MessageChannel = MessageChannel;
}

const { createDetector } = require('../detector');
const { InfiniteLoopError } = require('../errors');
const {
  FunctionComponent,
  SuspenseComponent,
  Passive,
  LayoutMask,
  DidCapture,
} = require('../constants');

function makeFiber(overrides = {}) {
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

function makeRoot(fiber) {
  return { current: fiber };
}

// Root with a fiber that has layout effects (triggers setState-in-layout-effect)
function makeLayoutEffectRoot() {
  const child = makeFiber({ flags: LayoutMask });
  return makeRoot(makeFiber({ subtreeFlags: LayoutMask, child }));
}

// Root with a fiber that has passive effects
function makePassiveEffectRoot() {
  const child = makeFiber({ flags: Passive });
  return makeRoot(makeFiber({ subtreeFlags: Passive, child }));
}

describe('createDetector', () => {
  let originalPerformanceNow;
  let detectors;

  beforeEach(() => {
    originalPerformanceNow = performance.now;
    detectors = [];
  });

  afterEach(() => {
    performance.now = originalPerformanceNow;
    detectors.forEach((d) => d.dispose());
  });

  function tracked(config) {
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
    const detection = onDetection.mock.calls[0][0];
    expect(detection.pattern).toBe('setState-in-layout-effect');
    expect(detection.blockingDurationMs).toBe(5);
    expect(detection.flushedEffectsCount).toBe(1);
    expect(typeof detection.timestamp).toBe('number');
    expect(typeof detection.evidence).toBe('string');
    expect(Array.isArray(detection.suspects)).toBe(true);
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
    // Use a small delay to ensure the MessageChannel message is delivered
    // before we check, since jsdom's event loop ordering may differ from browsers.
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

  test('includes setStateLocation for setState-outside-react pattern', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    // First commit: no layout effects, no suspense → setState-outside-react
    const root1 = makeRoot(makeFiber({ lanes: 1, childLanes: 0 }));
    detector.handleCommit(root1);
    detector.handleCommit(makePassiveEffectRoot());

    expect(onDetection).toHaveBeenCalledTimes(1);
    const detection = onDetection.mock.calls[0][0];
    expect(detection.pattern).toBe('setState-outside-react');
    // setStateLocation should be present (non-null) — the exact value depends on
    // the runtime stack, but in a test the user frame may be null since all frames
    // are from node_modules/jest. What matters is the field exists.
    expect(detection).toHaveProperty('setStateLocation');
  });

  test('does not include setStateLocation for setState-in-layout-effect pattern', () => {
    const onDetection = jest.fn();
    const detector = tracked({ onDetection, sampleRate: 1.0 });

    detector.handleCommit(makeLayoutEffectRoot());
    detector.handleCommit(makePassiveEffectRoot());

    expect(onDetection).toHaveBeenCalledTimes(1);
    const detection = onDetection.mock.calls[0][0];
    expect(detection.pattern).toBe('setState-in-layout-effect');
    expect(detection.setStateLocation).toBeUndefined();
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
    expect(onDetection.mock.calls[0][0].pattern).toBe('lazy-in-render');
  });

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

      // First 5 commits (including first) should not throw
      for (let i = 0; i < 5; i++) {
        detector.handleCommit(makeLayoutEffectRoot());
        now += 1;
      }

      // 6th commit should throw (exceeds maxCommitsPerTask of 5)
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

    test('async throw mode disposes and delivers report via microtask', (done) => {
      const onDetection = jest.fn();
      const detector = tracked({
        onDetection,
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
        // 3rd commit triggers async detection — disposes but does NOT throw
        // (throwing from onCommitFiberRoot is swallowed by React)
        detector.handleCommit(makeLayoutEffectRoot());

        // onDetection delivered via queueMicrotask — flush with a microtask
        queueMicrotask(() => {
          const loopDetections = onDetection.mock.calls.filter(
            c => c[0].type === 'infinite-loop'
          );
          expect(loopDetections.length).toBe(1);
          expect(loopDetections[0][0].pattern).toBe('infinite-loop-async');

          // Detector is disposed — subsequent commits are no-ops
          now += 10;
          detector.handleCommit(makeLayoutEffectRoot());
          expect(onDetection.mock.calls.filter(c => c[0].type === 'infinite-loop').length).toBe(1);
          done();
        });
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
});
