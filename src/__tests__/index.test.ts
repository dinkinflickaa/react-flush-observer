// jsdom does not provide MessageChannel; expose Node's built-in implementation
if (typeof globalThis.MessageChannel === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MessageChannel } = require('worker_threads');
  globalThis.MessageChannel = MessageChannel;
}

import { install, InfiniteLoopError } from '../index';
import type { Fiber, FiberRoot, Report } from '../types';

describe('install', () => {
  let originalHook: typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  let uninstallFns: (() => void)[];

  beforeEach(() => {
    originalHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    uninstallFns = [];
  });

  afterEach(() => {
    // Dispose any detectors created during the test to close MessageChannel ports
    uninstallFns.forEach((fn) => fn());
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = originalHook;
  });

  function tracked(): () => void {
    const uninstall = install();
    uninstallFns.push(uninstall);
    return uninstall;
  }

  function makeFiber(overrides: Partial<Fiber> = {}): Fiber {
    return {
      tag: 0,
      type: null,
      flags: 0,
      subtreeFlags: 0,
      lanes: 0,
      childLanes: 0,
      child: null,
      sibling: null,
      ...overrides,
    };
  }

  test('sets __REACT_DEVTOOLS_GLOBAL_HOOK__ on window', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    tracked();
    expect(window.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
    expect(window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.supportsFiber).toBe(true);
  });

  test('hook has required methods', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    tracked();
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__!;
    expect(typeof hook.inject).toBe('function');
    expect(typeof hook.onCommitFiberRoot).toBe('function');
    expect(typeof hook.onPostCommitFiberRoot).toBe('function');
    expect(typeof hook.onCommitFiberUnmount).toBe('function');
  });

  test('inject delegates to existing hook', () => {
    const mockInject = jest.fn().mockReturnValue(42);
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      inject: mockInject,
      onCommitFiberRoot: jest.fn(),
      onPostCommitFiberRoot: jest.fn(),
      onCommitFiberUnmount: jest.fn(),
    };

    tracked();
    const result = window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.inject!({
      some: 'internals',
    } as Parameters<NonNullable<NonNullable<typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__>['inject']>>[0]);
    expect(mockInject).toHaveBeenCalledWith({ some: 'internals' });
    expect(result).toBe(42);
  });

  test('inject returns 1 when no existing hook', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    tracked();
    const result = window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.inject!({} as Parameters<NonNullable<NonNullable<typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__>['inject']>>[0]);
    expect(result).toBe(1);
  });

  test('onCommitFiberRoot delegates to existing hook', () => {
    const mockOnCommit = jest.fn();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      inject: jest.fn(),
      onCommitFiberRoot: mockOnCommit,
      onPostCommitFiberRoot: jest.fn(),
      onCommitFiberUnmount: jest.fn(),
    };

    tracked();
    const root: FiberRoot = {
      current: makeFiber(),
      pendingLanes: 0,
      callbackPriority: 0,
      callbackNode: null,
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!(1, root, 0, false);
    expect(mockOnCommit).toHaveBeenCalledWith(1, root, 0, false);
  });

  test('onPostCommitFiberRoot delegates to existing hook', () => {
    const mockOnPost = jest.fn();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      inject: jest.fn(),
      onCommitFiberRoot: jest.fn(),
      onPostCommitFiberRoot: mockOnPost,
      onCommitFiberUnmount: jest.fn(),
    };

    tracked();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onPostCommitFiberRoot!(
      1,
      {} as FiberRoot
    );
    expect(mockOnPost).toHaveBeenCalledWith(1, {});
  });

  test('onCommitFiberUnmount delegates to existing hook', () => {
    const mockOnUnmount = jest.fn();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      inject: jest.fn(),
      onCommitFiberRoot: jest.fn(),
      onPostCommitFiberRoot: jest.fn(),
      onCommitFiberUnmount: mockOnUnmount,
    };

    tracked();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberUnmount!(
      1,
      makeFiber()
    );
    expect(mockOnUnmount).toHaveBeenCalledWith(1, expect.any(Object));
  });

  test('returns an uninstall function that restores previous hook', () => {
    const previousHook = {
      inject: jest.fn(),
      onCommitFiberRoot: jest.fn(),
      onPostCommitFiberRoot: jest.fn(),
      onCommitFiberUnmount: jest.fn(),
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previousHook;

    const uninstall = install();
    expect(window.__REACT_DEVTOOLS_GLOBAL_HOOK__).not.toBe(previousHook);

    uninstall();
    expect(window.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(previousHook);
  });

  test('passes infinite loop config to detector', (done) => {
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

    const root: FiberRoot = {
      current: {
        tag: 0,
        type: function Test() {},
        flags: 36,
        subtreeFlags: 36,
        lanes: 0,
        childLanes: 0,
        sibling: null,
        child: {
          tag: 0,
          type: function Inner() {},
          flags: 36,
          subtreeFlags: 0,
          lanes: 0,
          childLanes: 0,
          child: null,
          sibling: null,
        },
      },
      pendingLanes: 0,
      callbackPriority: 0,
      callbackNode: null,
    };

    for (let i = 0; i < 5; i++) {
      now += 1;
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!(
        1,
        root,
        0,
        false
      );
    }

    // Report is delivered via queueMicrotask
    setTimeout(() => {
      const loopDetections = onDetection.mock.calls.filter(
        (c: [Report]) => (c[0] as { type?: string }).type === 'infinite-loop'
      );
      expect(loopDetections.length).toBe(1);
      performance.now = origNow;
      done();
    }, 10);
  });

  test('break mode freezes root.pendingLanes through onCommitFiberRoot', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const uninstall = install({
      maxCommitsPerTask: 3,
      onInfiniteLoop: 'break',
    });
    uninstallFns.push(uninstall);

    let now = 100;
    const origNow = performance.now;
    performance.now = () => now;

    const root: FiberRoot = {
      pendingLanes: 1,
      callbackPriority: 0,
      callbackNode: null,
      current: {
        tag: 0,
        type: function Test() {},
        flags: 36,
        subtreeFlags: 36,
        lanes: 0,
        childLanes: 0,
        sibling: null,
        child: {
          tag: 0,
          type: function Inner() {},
          flags: 36,
          subtreeFlags: 0,
          lanes: 0,
          childLanes: 0,
          child: null,
          sibling: null,
        },
      },
    };

    // Should NOT throw — break mode freezes pendingLanes instead
    for (let i = 0; i < 5; i++) {
      now += 1;
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot!(
        1,
        root,
        0,
        false
      );
    }

    // root.pendingLanes is frozen to 0
    expect(root.pendingLanes).toBe(0);

    performance.now = origNow;
  });

  test('exports InfiniteLoopError', () => {
    expect(InfiniteLoopError).toBeDefined();
    expect(
      new InfiniteLoopError({
        type: 'infinite-loop',
        pattern: 'infinite-loop-sync',
        commitCount: 1,
        windowMs: null,
        stack: null,
        suspects: [],
        triggeringCommit: null,
        forcedCommit: {
          withPassiveEffects: [],
          withLayoutEffects: [],
          withSuspense: [],
          withUpdates: [],
        },
        userFrame: null,
        timestamp: Date.now(),
      })
    ).toBeInstanceOf(Error);
  });
});
