import type {
  FiberRoot,
  FiberSnapshot,
  LoopReport,
  DetectorConfig,
  Detector,
  Report,
  LoopPattern,
  InfiniteLoopAction,
} from './types';
import { snapshotCommitFibers } from './walker';
import { classifyPattern } from './classifier';
import { parseUserFrame } from './stack-parser';
import {
  DEFAULT_MAX_COMMITS_PER_TASK,
  DEFAULT_MAX_COMMITS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
  SyncLane,
  NoLane,
} from './constants';

interface DetectorState {
  commitInCurrentTask: boolean;
  taskBoundaryPending: boolean;
  lastCommitTime: number;
  lastCommitRoot: FiberRoot | null;
  commitCountInCurrentTask: number;
  syncLoopFiredThisTask: boolean;
  windowCommitCount: number;
  windowStartTime: number;
  asyncLoopFiredThisWindow: boolean;
  disposed: boolean;
}

function freezeRootLanes(root: FiberRoot): void {
  const originals = {
    pendingLanes: root.pendingLanes,
    callbackPriority: root.callbackPriority,
    callbackNode: root.callbackNode,
  };
  root.__frozenOriginals = originals;

  // Override properties to return frozen values
  Object.defineProperty(root, 'pendingLanes', {
    configurable: true,
    get: () => NoLane,
    set: () => {
      /* suppress writes */
    },
  });
  Object.defineProperty(root, 'callbackPriority', {
    configurable: true,
    get: () => SyncLane,
    set: () => {
      /* suppress writes */
    },
  });
  Object.defineProperty(root, 'callbackNode', {
    configurable: true,
    get: () => null,
    set: () => {
      /* suppress writes */
    },
  });
}

function unfreezeRootLanes(root: FiberRoot): void {
  const originals = root.__frozenOriginals;

  // Remove property descriptors
  delete (root as { pendingLanes?: number }).pendingLanes;
  delete (root as { callbackPriority?: number }).callbackPriority;
  delete (root as { callbackNode?: unknown }).callbackNode;

  // Restore to clean state
  root.pendingLanes = NoLane;
  // Always reset to NoLane (0) so ensureRootIsScheduled won't see a stale
  // priority match and skip scheduling
  root.callbackPriority = NoLane;
  root.callbackNode = originals?.callbackNode ?? null;

  delete root.__frozenOriginals;
}

function getComponentNames(snapshot: FiberSnapshot): string[] {
  const names: string[] = [];

  for (const fiber of snapshot.withLayoutEffects) {
    if (fiber.ownerName) {
      names.push(fiber.ownerName);
    }
  }

  for (const fiber of snapshot.withUpdates) {
    if (fiber.ownerName && !names.includes(fiber.ownerName)) {
      names.push(fiber.ownerName);
    }
  }

  return names;
}

export function createDetector(config: Partial<DetectorConfig> = {}): Detector {
  const {
    sampleRate = 1.0,
    onDetection = null,
    maxCommitsPerTask = DEFAULT_MAX_COMMITS_PER_TASK,
    maxCommitsPerWindow = DEFAULT_MAX_COMMITS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    onInfiniteLoop = 'break',
  } = config;

  const state: DetectorState = {
    commitInCurrentTask: false,
    taskBoundaryPending: false,
    lastCommitTime: 0,
    lastCommitRoot: null,
    commitCountInCurrentTask: 0,
    syncLoopFiredThisTask: false,
    windowCommitCount: 0,
    windowStartTime: 0,
    asyncLoopFiredThisWindow: false,
    disposed: false,
  };

  // MessageChannel for detecting task boundaries
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (state.disposed) return;
    state.commitInCurrentTask = false;
    state.taskBoundaryPending = false;
    state.commitCountInCurrentTask = 0;
    state.syncLoopFiredThisTask = false;
  };

  function buildLoopReport(
    root: FiberRoot,
    pattern: LoopPattern,
    commitCount: number,
    windowDuration: number | null
  ): LoopReport {
    const triggeringSnapshot = state.lastCommitRoot
      ? snapshotCommitFibers(state.lastCommitRoot)
      : null;
    const forcedSnapshot = snapshotCommitFibers(root);

    const stack = new Error().stack ?? null;
    const userFrame = parseUserFrame(stack);

    const suspects = getComponentNames(forcedSnapshot);

    return {
      type: 'infinite-loop',
      pattern,
      commitCount,
      windowMs: windowDuration,
      stack,
      suspects,
      triggeringCommit: triggeringSnapshot,
      forcedCommit: forcedSnapshot,
      userFrame,
      timestamp: Date.now(),
    };
  }

  function handleLoopDetection(
    root: FiberRoot,
    pattern: LoopPattern,
    commitCount: number,
    windowDuration: number | null,
    action: InfiniteLoopAction
  ): void {
    const report = buildLoopReport(root, pattern, commitCount, windowDuration);

    if (action === 'break') {
      // Freeze the root to prevent further commits
      freezeRootLanes(root);

      // Unfreeze and deliver report after current task
      setTimeout(() => {
        unfreezeRootLanes(root);
        onDetection?.(report);
      }, 0);
    } else {
      // Just report, don't break
      queueMicrotask(() => {
        onDetection?.(report);
      });
    }
  }

  function handleCommit(root: FiberRoot): void {
    if (state.disposed) return;

    const now = Date.now();

    // Check for sync infinite loop (too many commits in one task)
    state.commitCountInCurrentTask++;
    if (
      state.commitCountInCurrentTask > maxCommitsPerTask &&
      !state.syncLoopFiredThisTask
    ) {
      state.syncLoopFiredThisTask = true;
      handleLoopDetection(
        root,
        'infinite-loop-sync',
        state.commitCountInCurrentTask,
        null,
        onInfiniteLoop
      );
      return;
    }

    // Check for async infinite loop (too many commits in time window)
    if (now - state.windowStartTime > windowMs) {
      // Reset window
      state.windowStartTime = now;
      state.windowCommitCount = 1;
      state.asyncLoopFiredThisWindow = false;
    } else {
      state.windowCommitCount++;
      if (
        state.windowCommitCount > maxCommitsPerWindow &&
        !state.asyncLoopFiredThisWindow
      ) {
        state.asyncLoopFiredThisWindow = true;
        handleLoopDetection(
          root,
          'infinite-loop-async',
          state.windowCommitCount,
          now - state.windowStartTime,
          onInfiniteLoop
        );
        return;
      }
    }

    // Detect forced flush (sync re-render in same task)
    const isForcedFlush = state.commitInCurrentTask;

    if (isForcedFlush && Math.random() < sampleRate) {
      const triggeringSnapshot = state.lastCommitRoot
        ? snapshotCommitFibers(state.lastCommitRoot)
        : snapshotCommitFibers(root);
      const classification = classifyPattern(triggeringSnapshot);

      const report: Report = {
        timestamp: now,
        pattern: classification.pattern,
        evidence: classification.evidence,
        suspects: classification.suspects,
        flushedEffectsCount: triggeringSnapshot.withLayoutEffects.length,
        blockingDurationMs: now - state.lastCommitTime,
        setStateLocation:
          triggeringSnapshot.withLayoutEffects[0]?.source ?? null,
      };

      onDetection?.(report);
    }

    // Update state for next commit
    state.commitInCurrentTask = true;
    state.lastCommitTime = now;
    state.lastCommitRoot = root;

    // Schedule task boundary detection
    if (!state.taskBoundaryPending) {
      state.taskBoundaryPending = true;
      channel.port2.postMessage(null);
    }
  }

  function dispose(): void {
    state.disposed = true;
    channel.port1.close();
    channel.port2.close();
  }

  return {
    handleCommit,
    dispose,
  };
}
