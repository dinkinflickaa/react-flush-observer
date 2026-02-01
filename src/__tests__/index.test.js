// jsdom does not provide MessageChannel; expose Node's built-in implementation
if (typeof globalThis.MessageChannel === 'undefined') {
  const { MessageChannel } = require('worker_threads');
  globalThis.MessageChannel = MessageChannel;
}

const { install } = require('../index');

describe('install', () => {
  let originalHook;
  let uninstallFns;

  beforeEach(() => {
    originalHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    uninstallFns = [];
  });

  afterEach(() => {
    // Dispose any detectors created during the test to close MessageChannel ports
    uninstallFns.forEach((fn) => fn());
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = originalHook;
  });

  function tracked() {
    const uninstall = install();
    uninstallFns.push(uninstall);
    return uninstall;
  }

  test('sets __REACT_DEVTOOLS_GLOBAL_HOOK__ on window', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    tracked();
    expect(window.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
    expect(window.__REACT_DEVTOOLS_GLOBAL_HOOK__.supportsFiber).toBe(true);
  });

  test('hook has required methods', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    tracked();
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
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
    const result = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({ some: 'internals' });
    expect(mockInject).toHaveBeenCalledWith({ some: 'internals' });
    expect(result).toBe(42);
  });

  test('inject returns 1 when no existing hook', () => {
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    tracked();
    const result = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({});
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
    const root = { current: { tag: 0, type: null, flags: 0, subtreeFlags: 0, lanes: 0, childLanes: 0, child: null, sibling: null } };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, root, 0, false);
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
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onPostCommitFiberRoot(1, {});
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
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount(1, { tag: 0 });
    expect(mockOnUnmount).toHaveBeenCalledWith(1, { tag: 0 });
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
});
