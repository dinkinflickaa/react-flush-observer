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
  if (snapshot.withLayoutEffects.length > 0) {
    return {
      pattern: 'setState-in-layout-effect',
      suspects: snapshot.withLayoutEffects as FiberInfo[],
      evidence: 'Layout effect triggered state update',
    };
  }

  // Default: multiple setState calls outside React batching
  return {
    pattern: 'setState-outside-react',
    suspects: snapshot.withUpdates as FiberInfo[],
    evidence: 'Multiple commits in same task without React batching',
  };
}
