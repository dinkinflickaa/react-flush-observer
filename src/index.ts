import type { InstallConfig, FiberRoot, Fiber, ReactInternals } from './types';
import { createDetector } from './detector';

export { InfiniteLoopError } from './errors';
export type {
  InstallConfig,
  DetectorConfig,
  Report,
  DetectionReport,
  LoopReport,
  FiberSnapshot,
  SourceInfo,
  FiberInfo,
  DetailedFiberInfo,
  InfiniteLoopAction,
} from './types';

export function install(config: InstallConfig = {}): () => void {
  const {
    sampleRate = 1.0,
    onDetection = null,
    maxCommitsPerTask,
    maxCommitsPerWindow,
    windowMs,
    onInfiniteLoop,
  } = config;

  const existingHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const detector = createDetector({
    sampleRate,
    onDetection,
    maxCommitsPerTask,
    maxCommitsPerWindow,
    windowMs,
    onInfiniteLoop,
  });

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject(internals: ReactInternals): number {
      return existingHook?.inject?.(internals) ?? 1;
    },
    onCommitFiberRoot(
      id: number,
      root: FiberRoot,
      priority: number,
      didError: boolean
    ): void {
      try {
        detector.handleCommit(root);
      } catch {
        // Observability must never break the observed application
      }
      existingHook?.onCommitFiberRoot?.(id, root, priority, didError);
    },
    onPostCommitFiberRoot(id: number, root: FiberRoot): void {
      existingHook?.onPostCommitFiberRoot?.(id, root);
    },
    onCommitFiberUnmount(id: number, fiber: Fiber): void {
      existingHook?.onCommitFiberUnmount?.(id, fiber);
    },
  };

  return function uninstall(): void {
    detector.dispose();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
  };
}
