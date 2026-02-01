# Infinite Loop Detection — Investigation Findings

## The Problem

We want to detect AND stop infinite loops caused by `setState` in React effects, then surface them via error boundaries. There are three distinct loop patterns:

### Pattern 1: `useLayoutEffect` → setState (sync, blocking)
- Each `useLayoutEffect` setState forces a synchronous re-render
- All commits happen in one macrotask — blocks main thread
- **React's own safeguard**: throws "Maximum update depth exceeded" at ~50 nested updates
- **Error boundary catches React's error** — loop stops

### Pattern 2: `useEffect` → setState after force flush (sync, blocking)
- A `useLayoutEffect` fires once and forces a sync re-render
- React's `flushPassiveEffects()` runs at the start of `renderRootSync`, flushing pending `useEffect` callbacks synchronously
- The `useEffect` calls setState → another sync re-render → flush passive effects again → infinite blocking loop
- **React only WARNS** ("Maximum update depth exceeded") but does NOT throw
- **Error boundary never activates** — loop runs forever until browser kills the tab

### Pattern 3: Pure `useEffect` → setState (async, non-blocking in concurrent mode)
- Each render goes through React's scheduler via MessageChannel → separate macrotask
- Main thread is NOT blocked (in concurrent mode / `createRoot`)
- **In legacy mode (`ReactDOM.render`)**: behaves like Pattern 2 — synchronous and blocking
- **In concurrent mode (`createRoot`)**: truly async, each render in separate macrotask

## Key Finding: React Swallows Our Throws

React wraps ALL devtools hook calls in try-catch:

```
react-dom.development.js, lines 4846-4890:

function onCommitRoot(root, eventPriority) {
  if (injectedHook && typeof injectedHook.onCommitFiberRoot === 'function') {
    try {
      injectedHook.onCommitFiberRoot(rendererID, root, schedulerPriority, didError);
    } catch (err) {
      if (!hasLoggedError) {
        hasLoggedError = true;
        error('React instrumentation encountered an error: %s', err);
      }
    }
  }
}
```

**Verified experimentally**: Setting our threshold to 10, React logs our `InfiniteLoopError` as "instrumentation encountered an error" and continues spinning until its own ~50 limit. Our throw does NOT stop anything. The error boundary catches React's own "Maximum update depth exceeded" error, not ours.

## What Works Today

| Pattern | Detected? | Stopped? | Error Boundary? | Why |
|---------|-----------|----------|-----------------|-----|
| useLayoutEffect sync loop | Yes (sync detection) | No* | Yes* | *React's own mechanism stops it, not ours |
| useEffect after force flush | Yes (sync detection) | No | No | React only warns for useEffect loops |
| Pure useEffect async loop | Yes (async/window detection) | No | No | Async callbacks (setTimeout, queueMicrotask) starved in legacy; non-blocking in concurrent |

## What We've Tried and Why It Failed

### Approach 1: Throw InfiniteLoopError from onCommitFiberRoot
- **Result**: React catches it in try-catch, logs warning, continues
- **Applies to**: All patterns

### Approach 2: queueMicrotask + CustomEvent + Error Boundary setState
- **Idea**: Detect loop → dispose → queueMicrotask(onDetection) → dispatch CustomEvent → error boundary calls setState
- **Result**: For blocking loops (Patterns 1, 2), the microtask never fires because the synchronous cascade starves it. For async loops (Pattern 3), the microtask fires but React's scheduler processes the next render before the error boundary's state update takes effect.
- **Variant with flushSync**: Error boundary uses `ReactDOM.flushSync(() => setState(...))` to force synchronous processing. Still can't fire during a blocking loop.

### Approach 3: Set pendingLoopReport flag, throw on next commit
- **Idea**: On detection, set a flag. Next handleCommit throws InfiniteLoopError.
- **Result**: Same problem — React catches the throw from onCommitFiberRoot.

## React Internals — Available Hooks and APIs

All devtools hooks are wrapped in try-catch (prod and dev):
- `onCommitFiberRoot` — wrapped
- `onPostCommitFiberRoot` — wrapped
- `onCommitFiberUnmount` — wrapped
- `onScheduleFiberRoot` — wrapped

Profiling hooks are NOT wrapped (dev only, NOT available in prod):
- `markCommitStarted/Stopped` — no try-catch
- `markComponentPassiveEffectMountStarted/Stopped` — no try-catch
- **Rejected**: Not available in production builds

`inject(internals)` receives (available in prod and dev):
- `overrideHookState(fiber, hookId, path, value)` — override component state
- `overrideProps(fiber, path, value)` — override component props
- `scheduleUpdate(fiber)` — schedule a React update on a fiber
- `currentDispatcherRef` — ReactCurrentDispatcher reference
- `getCurrentFiber()` — access to current fiber being processed
- `findHostInstanceByFiber(fiber)` — find DOM node for a fiber
- `findFiberByHostInstance(instance)` — find fiber for a DOM node

## Open Questions for Next Session

1. **Can we use `inject()` internals to break the loop?** `scheduleUpdate` and `overrideHookState` are available in prod. Could we modify the looping component's state or schedule an update on the error boundary fiber?

2. **Can we manipulate the root fiber directly?** We have access to `root` (FiberRootNode) in `onCommitFiberRoot`. Could we null out pending work, clear update queues, or modify the fiber tree to break the cycle?

3. **Should we accept detect-only for blocking loops?** Our observer CAN detect the loop (correctly counts commits per task). The limitation is stopping it. For useLayoutEffect loops, React stops them anyway. For useEffect-after-force-flush loops, nothing stops them.

4. **Is there a way to make React's own "Maximum update depth" check throw for useEffect loops instead of just warning?** React's check is in `checkForNestedUpdates()` — could we influence the counter or threshold?

5. **Concurrent mode (`createRoot`) changes the game for Pattern 3**: In concurrent mode, pure useEffect loops are truly async (non-blocking). The queueMicrotask + flushSync approach might work there since microtasks run before the next macrotask. Need to test.

## Current Code State

All source files are in: `/Users/sachinjain/work/react-flush-observer/.worktrees/infinite-loop-detection`

### Modified source files:
- `src/detector.js` — Core detection: sync (per-task commit count) + async (sliding window)
- `src/errors.js` — InfiniteLoopError class
- `src/constants.js` — DEFAULT_MAX_COMMITS_PER_TASK=50, DEFAULT_MAX_COMMITS_PER_WINDOW=50, DEFAULT_WINDOW_MS=1000
- `src/index.js` — Config passthrough, InfiniteLoopError re-throw from hook wrapper

### Test files (78 tests passing):
- `src/__tests__/detector.test.js` — 7 sync + 4 async loop detection tests
- `src/__tests__/errors.test.js` — 5 tests
- `src/__tests__/constants.test.js` — 3 new tests
- `src/__tests__/index.test.js` — 3 new tests

### Demo files:
- `demo/src/main.jsx` — Legacy ReactDOM.render
- `demo/src/setup.js` — Observer install with maxCommitsPerTask: 10, onInfiniteLoop: 'throw'
- `demo/src/scenarios/InfiniteLoopSyncTest.jsx` — useLayoutEffect loop (Pattern 1)
- `demo/src/scenarios/InfiniteLoopAsyncTest.jsx` — useEffect loop (Pattern 3)
- `demo/src/scenarios/InfiniteLoopHybridTest.jsx` — useEffect after force flush (Pattern 2)
- `demo/src/scenarios/InfiniteLoopErrorBoundary.jsx` — Error boundary with getDerivedStateFromError + CustomEvent listener with flushSync
- `demo/src/App.jsx` — All scenarios with error boundary wrappers

### Git status:
- Branch: `main` in worktree `.worktrees/infinite-loop-detection`
- Uncommitted changes (design doc was committed, implementation is not)
