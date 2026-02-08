import type { FiberSnapshot, ClassificationResult, FiberInfo } from './types';

export function classifyPattern(snapshot: FiberSnapshot): ClassificationResult {
  // Suspense with DidCapture = lazy component resolved during render
  if (snapshot.withSuspense.length > 0) {
    return {
      pattern: 'lazy-in-render',
      suspects: snapshot.withSuspense as FiberInfo[],
      evidence: 'Suspense boundary captured during commit',
    };
  }

  // Layout effects with updates = setState in useLayoutEffect
  // Prefer fibers with actual effect source code — filters out reused fibers
  // with stale LayoutMask flags that weren't re-rendered in this commit.
  if (snapshot.withLayoutEffects.length > 0) {
    const withEffectSource = snapshot.withLayoutEffects.filter(f => f.effectSource);
    return {
      pattern: 'setState-in-layout-effect',
      suspects: (withEffectSource.length > 0
        ? withEffectSource
        : snapshot.withLayoutEffects) as FiberInfo[],
      evidence: 'Layout effect triggered state update',
    };
  }

  // Default: multiple setState calls outside React batching.
  // Component fibers have no reliable flags for pure-state updates, so
  // suspects may be empty.  The flush report's userFrame (from call stack)
  // provides the actual setState call site for debugging.
  return {
    pattern: 'setState-outside-react',
    suspects: [],
    evidence: 'Multiple commits in same task without React batching',
  };
}
