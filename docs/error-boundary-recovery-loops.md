# Error Boundary Recovery Loops: Deep Analysis

> Deep analysis of React's error boundary recovery mechanism, identifying what's flawed,
> what cases aren't caught, and which are bounded vs unbounded.
>
> Based on analysis of React 18 source at `packages/react-reconciler/src/`.

---

## How Error Boundaries Work: Two APIs, Two Paths

### `getDerivedStateFromError(error)` -- Render-Phase (Safe Path)

- Called **during the render phase** via a `CaptureUpdate` enqueued on the error boundary fiber
  (`ReactFiberThrow.new.js:113-118`)
- The `CaptureUpdate` has `payload = () => getDerivedStateFromError(error)` which runs inside
  `processUpdateQueue` (`ReactFiberClassUpdateQueue.new.js:411-414`)
- State is updated synchronously during re-render -- fallback UI renders in the same render pass
- **No separate commit needed** to transition to error state

### `componentDidCatch(error, info)` -- Commit-Phase (Flawed Path)

- Called **during the commit phase** as a callback on the `CaptureUpdate`
  (`ReactFiberThrow.new.js:128-161`)
- The callback runs during `commitLayoutEffects` (layout effects / lifecycle phase of commit)
- If there's no `getDerivedStateFromError`, the boundary must call `this.setState()` inside
  `componentDidCatch` to render fallback UI
- This `setState` triggers a **new synchronous update** on `SyncLane`
- Creates a full new render + commit cycle

---

## The `legacyErrorBoundariesThatAlreadyFailed` Protection Mechanism

### How it works

At `ReactFiberWorkLoop.new.js:393`:
```js
let legacyErrorBoundariesThatAlreadyFailed: Set<mixed> | null = null;
```

When a `componentDidCatch`-only boundary handles an error, it's added to this set (lines 2550-2554):
```js
export function markLegacyErrorBoundaryAsFailed(instance: mixed) {
  if (legacyErrorBoundariesThatAlreadyFailed === null) {
    legacyErrorBoundariesThatAlreadyFailed = new Set([instance]);
  } else {
    legacyErrorBoundariesThatAlreadyFailed.add(instance);
  }
}
```

When React traverses up looking for error boundaries (`ReactFiberThrow.new.js:551-556`), it
**skips** boundaries in this set:
```js
(typeof instance.componentDidCatch === 'function' &&
  !isAlreadyFailedLegacyErrorBoundary(instance))
```

### When the set gets cleared -- the flaw

At `ReactFiberWorkLoop.new.js:2255-2258`:
```js
if (remainingLanes === NoLanes) {
  legacyErrorBoundariesThatAlreadyFailed = null;
}
```

The TODO comment at lines 2246-2254:

> This is part of the `componentDidCatch` implementation. Its purpose is to detect whether
> something might have called setState inside `componentDidCatch`. The mechanism is known to
> be flawed because `setState` inside `componentDidCatch` is itself flawed -- that's why we
> recommend `getDerivedStateFromError` instead. However, it could be improved by checking if
> remainingLanes includes Sync work, instead of whether there's any work remaining at all
> (which would also include stuff like Suspense retries or transitions).

The check uses `remainingLanes === NoLanes`, but **any** pending work (Suspense retries,
transitions, idle work, offscreen rendering) keeps `remainingLanes` non-zero.

---

## Severity-Ordered Edge Cases

### 1. CRITICAL (UNBOUNDED) -- Commit-phase error in `getDerivedStateFromError` recovery render

**Mode:** Both legacy and concurrent (error recovery always uses `SyncLane`)

**Why it's unbounded:** The `captureCommitPhaseError` path at `ReactFiberWorkLoop.new.js:2581`
enqueues a `CaptureUpdate` via `enqueueUpdate` + `ensureRootIsScheduled` (lines 2622-2626).
This **bypasses `scheduleUpdateOnFiber` entirely**, which is the only place
`checkForNestedUpdates()` is called (line 539). The `nestedUpdateCount` increments each commit
(line 2327), but nobody ever checks it against `NESTED_UPDATE_LIMIT`.

**The loop mechanism:**

1. Child throws -> `getDerivedStateFromError` catches -> renders fallback
2. Fallback's layout effect / ref callback / componentDidMount throws during commit
3. `captureCommitPhaseError` -> `enqueueUpdate` with `CaptureUpdate` at `SyncLane` ->
   `ensureRootIsScheduled`
4. `ensureRootIsScheduled` calls `scheduleSyncCallback` -> pushes to `syncQueue` ->
   schedules microtask
5. Microtask fires `flushSyncCallbacks` -> `performSyncWorkOnRoot` -> render -> commit
6. Fallback commit throws again -> back to step 3
7. Each cycle is one microtask tick -- browser is locked (microtasks run before paint)
8. **No counter ever checks the limit. Loop runs forever.**

**Why `NESTED_UPDATE_LIMIT` doesn't catch it:**

- `checkForNestedUpdates()` exists ONLY in `scheduleUpdateOnFiber` (line 539)
- `captureCommitPhaseError` calls `enqueueUpdate` + `ensureRootIsScheduled` directly,
  never `scheduleUpdateOnFiber`
- `nestedUpdateCount` increments in `commitRootImpl` (line 2327) but is never compared
  to the limit in this path

**Inline processing detail:** When `captureCommitPhaseError` is called during commit
(CommitContext set), the `ensureRootIsScheduled` call at line 2626 schedules via
`scheduleSyncCallback` (line 768). This pushes a callback to the `syncQueue` array. The
`flushSyncCallbacks` for loop at `ReactFiberSyncTaskQueue.new.js:63` uses
`const queue = syncQueue` (a reference to the same array), so new callbacks pushed during
processing extend the loop's iteration range (`i < queue.length` sees the growing array).
The for loop never terminates.

**Reproducer pattern:**
```jsx
class Boundary extends React.Component {
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state?.error) return <Fallback />;
    return this.props.children;
  }
}
function Fallback() {
  useLayoutEffect(() => {
    throw new Error('fallback commit error'); // throws every commit
  });
  return <div>fallback</div>;
}
```

---

### 2–4. SAFE -- React cleanly bails out (no loops in practice)

> **Empirical correction:** Cases 2, 3, and 4 were identified through static source code
> analysis but do NOT produce loops in practice. Testing against React 18 (both
> `createRoot` concurrent mode and legacy `ReactDOM.render` mode) shows React cleanly
> handles all three patterns: the error propagates to the nearest parent boundary with
> no nested update cycles.

#### Case 2: `getDerivedStateFromError` + `componentDidCatch` setState + recovery render throws

```jsx
class Boundary extends React.Component {
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(err) {
    this.setState({ errorLog: err }); // triggers scheduleUpdateOnFiber
  }
  render() {
    if (this.state?.error) throw new Error('recovery also fails');
    return this.props.children;
  }
}
```

**Actual behavior:** `getDerivedStateFromError` is called once, recovery render throws,
error propagates to parent boundary. `componentDidCatch` is **never called** — React
short-circuits when the boundary's own render throws during error recovery. No loop.

#### Case 3: `componentDidCatch`-only boundary + recovery render throws

**Actual behavior:** `componentDidCatch` is called exactly once, `setState` triggers a
re-render, recovery render throws, error propagates to parent boundary. No loop.

#### Case 4: `getDerivedStateFromError` itself throws

**Actual behavior:** `getDerivedStateFromError` throws, error immediately walks up the
fiber tree to the next boundary. Called twice (React retry), then parent catches. No loop.

---

### 5. LOW (Not a loop) -- `componentDidCatch`-only boundary permanently disabled

**Mode:** Both (worse in concurrent due to more pending lanes)

**Not an infinite loop at all** -- it's the opposite problem. Once
`markLegacyErrorBoundaryAsFailed` adds the instance to the set (line 2552), and
`remainingLanes !== NoLanes`, the boundary can never catch errors again. Subsequent errors
bubble past it. If there's no parent boundary, it becomes an uncaught error -> white screen.

**Severity is low for loops** but **high for correctness** -- error recovery silently breaks.

---

### 6. LOW (One-shot, not a loop) -- `componentDidCatch`-only boundary, error escapes to parent

**Mode:** Both

The boundary is in `legacyErrorBoundariesThatAlreadyFailed`, so when the recovery render
throws, `isAlreadyFailedLegacyErrorBoundary` returns true (line 2545-2546), and the error
skips this boundary. It goes to the parent. Not a loop -- it's a one-shot escape.

---

## Summary Table

| # | Severity | Bounded? | Bound | Mode | Pattern |
|---|---|---|---|---|---|
| 1 | **CRITICAL** | **NO** | None -- `checkForNestedUpdates` never called | Both | `getDerivedStateFromError` + commit-phase error in fallback |
| 2 | SAFE | N/A | React bails out cleanly | Both | `getDerivedStateFromError` + `componentDidCatch` setState + render throws |
| 3 | SAFE | N/A | React bails out cleanly | Both | `componentDidCatch`-only + recovery render throws |
| 4 | SAFE | N/A | React bails out cleanly | Both | `getDerivedStateFromError` itself throws |
| 5 | LOW | N/A | N/A | Both (worse concurrent) | `componentDidCatch`-only boundary permanently disabled |
| 6 | LOW | N/A | N/A | Both | Error escapes failed boundary |

## Fundamental Design Gap

The `captureCommitPhaseError` -> `CaptureUpdate` -> `ensureRootIsScheduled` path completely
bypasses `scheduleUpdateOnFiber` where `checkForNestedUpdates` lives. The microtask
scheduling creates a rapid loop that locks the browser before paint. This is the only truly
unbounded infinite loop path in React's error boundary system.
