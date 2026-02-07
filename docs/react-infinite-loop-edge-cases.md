# React Infinite Loop Edge Cases: Where React Fails to Detect Unresponsive Renders

> Deep analysis of the React reconciler, hooks, scheduler, and commit phase to identify edge cases
> where infinite loops escape React's detection and cause unresponsive browser behavior.
>
> Based on analysis of React source at `packages/react-reconciler/src/` (React 18 codebase).

---

## React's Three Lines of Defense (and their limits)

React has three distinct loop-detection mechanisms, each with significant blind spots:

| Mechanism | Location | Limit | Scope |
|---|---|---|---|
| `RE_RENDER_LIMIT` | `ReactFiberHooks.new.js:213` | 25 | Same-component render-phase dispatches only |
| `NESTED_UPDATE_LIMIT` | `ReactFiberWorkLoop.new.js:407` | 50 | Sync updates on same root during commit |
| `NESTED_PASSIVE_UPDATE_LIMIT` | `ReactFiberWorkLoop.new.js:413` | 50 | **DEV-only warning**, not an error |

---

## Category 1: Passive Effect Loops (useEffect) -- MOST DANGEROUS

### Edge Case 1a: useEffect -> setState loop (production SILENT)

The `NESTED_PASSIVE_UPDATE_LIMIT` check at `ReactFiberWorkLoop.new.js:2799` is gated behind `__DEV__`:

```js
// Line 2798-2809
if (__DEV__) {
  if (nestedPassiveUpdateCount > NESTED_PASSIVE_UPDATE_LIMIT) {
    nestedPassiveUpdateCount = 0;
    console.error(
      'Maximum update depth exceeded. This can happen when a component ' +
        "calls setState inside useEffect, but useEffect either doesn't " +
        'have a dependency array, or one of the dependencies changes on ' +
        'every render.',
    );
  }
}
```

In **production**, this is a `console.error` even in DEV -- never a thrown error. A `useEffect` that unconditionally calls `setState` creating a new reference each time will loop infinitely. The loop goes: render -> commit -> schedule passive effects -> flush passive effects -> setState -> re-render -> commit -> ..., and because each cycle completes a full commit, the `nestedUpdateCount` at line 2326 increments but the effect-driven re-render is scheduled asynchronously via the scheduler, which yields to the browser between cycles. This means:

- In **concurrent mode**, the browser stays responsive but React burns 100% CPU in an infinite cycle
- In **legacy mode with `flushSync`**, it becomes a synchronous infinite loop that freezes the browser

**Example:**
```jsx
function Bug() {
  const [val, setVal] = useState({});
  useEffect(() => {
    setVal({}); // new object ref every time, no dep array escape
  });
  return <div>{JSON.stringify(val)}</div>;
}
```

### Edge Case 1b: useEffect with object/array dependencies that change every render

```jsx
function Bug() {
  const [count, setCount] = useState(0);
  const config = { value: count }; // new ref every render
  useEffect(() => {
    setCount(c => c + 1);
  }, [config]); // config always changes
}
```

The dependency comparison uses `Object.is`, so new object references always trigger the effect. React doesn't detect this pattern at all in production.

---

## Category 2: Cross-Root Update Loops

### Edge Case 2a: Two React roots triggering each other

At `ReactFiberWorkLoop.new.js:2326-2331`, the nested update counter is per-root:

```js
if (root === rootWithNestedUpdates) {
  nestedUpdateCount++;
} else {
  nestedUpdateCount = 0;          // RESETS for different root!
  rootWithNestedUpdates = root;
}
```

If Root A's commit triggers a state update in Root B, and Root B's commit triggers a state update in Root A, the counter resets to 0 each time because the root alternates. This creates an undetected infinite ping-pong.

**Example:**
```jsx
// Root A
function CompA() {
  const [v, setV] = useState(0);
  useLayoutEffect(() => {
    rootBSetState(v + 1); // trigger Root B
  });
}
// Root B
function CompB() {
  const [v, setV] = useState(0);
  useLayoutEffect(() => {
    rootASetState(v + 1); // trigger Root A
  });
}
```

---

## Category 3: Layout Effect Synchronous Loops

### Edge Case 3a: useLayoutEffect -> setState creates 50 synchronous full renders before detection

`useLayoutEffect` callbacks run synchronously during commit (`commitLayoutEffects` at line 2189). When they call `setState`, it schedules a synchronous re-render. This IS caught by `NESTED_UPDATE_LIMIT = 50`, but React allows **50 full synchronous render+commit cycles** before throwing. Each cycle does a complete render pass, commit phase, and DOM mutation. On a complex component tree, 50 full cycles can take seconds, causing visible jank.

### Edge Case 3b: useLayoutEffect with conditional setState that escapes the counter

If the layout effect uses `flushSync` internally, the update gets processed inline. The `flushSync` path at line 1367-1404 calls `flushSyncCallbacks()` which can process the update immediately. If the update processing itself triggers more `flushSync` calls, the nested update counter may not see them as "nested" because `executionContext` flags change.

---

## Category 4: Render-Phase Dispatch Edge Cases

### Edge Case 4a: Cross-component render-phase updates bypass RE_RENDER_LIMIT

The `numberOfReRenders` counter at `ReactFiberHooks.new.js:440` is local to `renderWithHooks` -- it only tracks dispatches that re-render **the same component** during its own render:

```js
// Line 437-452
if (didScheduleRenderPhaseUpdateDuringThisPass) {
  let numberOfReRenders: number = 0;
  do {
    // ...
    if (numberOfReRenders >= RE_RENDER_LIMIT) {
      throw new Error('Too many re-renders...');
    }
    numberOfReRenders += 1;
```

If Component A's render dispatches to Component B's state, and Component B's render dispatches to Component A's state, neither component's `numberOfReRenders` exceeds 25 because each render is a fresh call to `renderWithHooks`. The outer work loop's `NESTED_UPDATE_LIMIT` may catch this eventually, but only after 50 complete cycles.

### Edge Case 4b: deferRenderPhaseUpdateToNextBatch flag

At `ReactFeatureFlags.js:160`:
```js
export const deferRenderPhaseUpdateToNextBatch = false;
```
When this flag is enabled (it's configurable per fork), render-phase updates are deferred to a subsequent render batch. This means the `numberOfReRenders` counter is never incremented for these deferred updates -- they escape the `RE_RENDER_LIMIT` entirely and fall through to the weaker `NESTED_UPDATE_LIMIT`.

---

## Category 5: Scheduler Has No Loop Detection

### Edge Case 5a: The scheduler has zero infinite loop protection

The scheduler's `workLoop` (in `packages/scheduler/src/`) simply processes tasks from a min-heap priority queue. There is no:
- Maximum task count
- Maximum iteration detection
- Queue growth monitoring

If React keeps scheduling new render tasks (via `ensureRootIsScheduled`), the scheduler will process them indefinitely. In concurrent mode, `shouldYieldToHost()` yields every 5ms to the browser, so the page stays technically "responsive" but React runs at 100% CPU forever. Users see a working but extremely sluggish page.

### Edge Case 5b: Priority starvation

Continuous high-priority (sync lane) updates can starve lower-priority work indefinitely. The lane expiration logic at `ReactFiberLane` eventually promotes starved lanes, but if new sync work arrives every frame, concurrent work can be restarted from scratch indefinitely without any detection.

---

## Category 6: Class Component Lifecycle Loops

### Edge Case 6a: componentDidUpdate + setState + shouldComponentUpdate

```jsx
class Bug extends React.Component {
  componentDidUpdate() {
    this.setState({ tick: Date.now() });
  }
  shouldComponentUpdate(nextProps, nextState) {
    return nextState.tick !== this.state.tick; // always true
  }
}
```

This IS caught by `NESTED_UPDATE_LIMIT`, but only after 50 full synchronous renders.

### Edge Case 6b: Error boundary infinite recovery loop

If an error boundary's recovery render (after `componentDidCatch` -> `setState`) throws another error, React processes it as a new error. The `componentDidCatch` -> `setState` -> render -> throw -> `componentDidCatch` cycle is loosely bounded by `NESTED_UPDATE_LIMIT`, but the TODO comment at line 2246 explicitly acknowledges this mechanism is **flawed**:

```js
// Line 2246-2249
// TODO: This is part of the `componentDidCatch` implementation. Its purpose
// is to detect whether something might have called setState inside
// `componentDidCatch`. The mechanism is known to be flawed because `setState`
// inside `componentDidCatch` is itself flawed
```

---

## Category 7: External Triggers (DOM Observers, External Stores)

### Edge Case 7a: MutationObserver watching React's container

```jsx
function Bug() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setCount(c => c + 1); // React DOM mutation triggers observer -> setState
    });
    observer.observe(containerRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <div>{count}</div>;
}
```

React commits DOM changes -> MutationObserver fires -> `setState` -> re-render -> commit -> DOM changes -> MutationObserver fires... This is completely outside React's detection because the `setState` originates from a browser callback, not from React's commit phase.

### Edge Case 7b: useSyncExternalStore with unstable snapshot

If `getSnapshot()` returns a new reference every time and `subscribe` triggers a forced re-render on subscription:

```jsx
const value = useSyncExternalStore(
  (cb) => { cb(); return () => {}; }, // immediate notification
  () => ({ data: 'fresh' }),           // new ref every time
);
```

React detects tearing and re-renders, but the new snapshot is again different, causing another render. This can loop, though React has some internal guards for this specific case.

### Edge Case 7c: flushSync inside effects

```jsx
useLayoutEffect(() => {
  flushSync(() => {
    setState(prev => prev + 1);
  });
});
```

`flushSync` at line 1367 forces synchronous processing. Inside a layout effect, this creates a synchronous infinite loop within the commit phase. The `NESTED_UPDATE_LIMIT` eventually catches it after 50 cycles.

---

## Category 8: Meta's Unreleased Feature Flag -- enableProfilerNestedUpdateScheduledHook

### What it does

At `ReactFeatureFlags.js:260-262`:
```js
// Profiler API accepts a function to be called when a nested update is scheduled.
// This callback accepts the component type (class instance or function) the update is scheduled for.
export const enableProfilerNestedUpdateScheduledHook = false;
```

This is **disabled by default in OSS** but enabled in Meta's www build behind `__PROFILE__` (see `ReactFeatureFlags.www.js:47-48`):

```js
export const enableProfilerNestedUpdateScheduledHook =
  __PROFILE__ && dynamicFeatureFlags.enableProfilerNestedUpdateScheduledHook;
```

### What case it catches

When enabled, React tracks `rootCommittingMutationOrLayoutEffects` (line 397) and calls an `onNestedUpdateScheduled` callback on `<Profiler>` components when a state update is scheduled **during the commit phase** (mutation or layout effects):

```js
// Line 583-601
if (enableProfilerTimer && enableProfilerNestedUpdateScheduledHook) {
  if (
    (executionContext & CommitContext) !== NoContext &&
    root === rootCommittingMutationOrLayoutEffects
  ) {
    if (fiber.mode & ProfileMode) {
      let current = fiber;
      while (current !== null) {
        if (current.tag === Profiler) {
          const {id, onNestedUpdateScheduled} = current.memoizedProps;
          if (typeof onNestedUpdateScheduled === 'function') {
            onNestedUpdateScheduled(id);
          }
        }
        current = current.return;
      }
    }
  }
}
```

This was designed to help Meta **identify** which components schedule cascading updates during commit -- the exact pattern that causes the "Maximum update depth exceeded" error. It's a **diagnostic/profiling** hook, not a prevention mechanism. It was likely never released to OSS because:

1. It's a profiling-only feature (`__PROFILE__` gated), adding overhead
2. It requires wrapping components in `<Profiler>` with the `onNestedUpdateScheduled` callback
3. The `enableProfilerNestedUpdatePhase` flag (line 243, enabled in OSS) already differentiates "cascading-update" from "update" in the `onRender` callback -- providing a simpler public API
4. It was gated behind `__VARIANT__` in `ReactFeatureFlags.www-dynamic.js:23`, meaning Meta was A/B testing it

---

## Summary: The Highest-Risk Undetected Patterns

| Risk | Pattern | Detection | Impact |
|---|---|---|---|
| **CRITICAL** | `useEffect` -> `setState` (new ref each render) | DEV warning only, NO production protection | Silent infinite CPU burn |
| **CRITICAL** | Cross-root update ping-pong | Counter resets per-root, never triggers | Complete browser freeze (sync) or CPU burn (concurrent) |
| **CRITICAL** | DOM observer -> `setState` feedback loop | Completely invisible to React | Browser freeze |
| **HIGH** | Cross-component render-phase dispatch loop | Falls through to weaker 50-cycle limit | 50 full renders before detection |
| **HIGH** | Scheduler priority starvation | No detection at all | Permanent CPU burn, starved updates never render |
| **MEDIUM** | `useLayoutEffect` -> `setState` | Caught after 50 synchronous cycles | Seconds of jank before error |
| **MEDIUM** | `flushSync` inside effects | Caught after 50 cycles | Synchronous freeze then error |
| **LOW** | Error boundary recovery loops | Caught but mechanism is "known to be flawed" (per React's own TODO) | Inconsistent behavior |

---

## Fundamental Design Gap

React's loop detection is **synchronous-commit-centric** -- it only reliably catches loops that create nested sync updates on the same root during the same commit phase. Any pattern that spaces updates across async boundaries (effects, scheduler callbacks, browser APIs) or across different roots largely escapes detection.
