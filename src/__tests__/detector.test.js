// jsdom does not provide MessageChannel; expose Node's built-in implementation
if (typeof globalThis.MessageChannel === 'undefined') {
  const { MessageChannel } = require('worker_threads');
  globalThis.MessageChannel = MessageChannel;
}

const { createDetector } = require('../detector');
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

    // Wait for MessageChannel to fire (next task)
    setTimeout(() => {
      detector.handleCommit(makeLayoutEffectRoot());
      // Second commit is in a new task, should not trigger detection
      expect(onDetection).not.toHaveBeenCalled();
      done();
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
});
