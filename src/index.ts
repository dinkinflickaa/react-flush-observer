import type { InstallConfig, BreakOnLoopConfig, FiberRoot, Fiber, ReactInternals } from './types';
import { createDetector } from './detector';

export type {
  InstallConfig,
  BreakOnLoopConfig,
  FlushReport,
  LoopReport,
  Report,
  FlushPattern,
  LoopPattern,
  SourceInfo,
  FiberInfo,
} from './types';

export interface Observer {
  uninstall(): void;
  setBreakOnLoop(enabled: boolean | BreakOnLoopConfig): void;
}

export function install(config: InstallConfig = {}): Observer {
  const {
    sampleRate = 1.0,
    onFlush,
    onLoop,
    breakOnLoop,
    maxCommitsPerTask,
    maxCommitsPerWindow,
    windowMs,
  } = config;

  const existingHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const detector = createDetector({
    sampleRate,
    onFlush,
    onLoop,
    breakOnLoop,
    maxCommitsPerTask,
    maxCommitsPerWindow,
    windowMs,
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

  return {
    uninstall(): void {
      detector.dispose();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
    },
    setBreakOnLoop(enabled: boolean | BreakOnLoopConfig): void {
      detector.setBreakOnLoop(enabled);
    },
  };
}
