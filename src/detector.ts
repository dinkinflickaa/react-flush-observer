import type {
  FiberRoot,
  FiberSnapshot,
  FlushReport,
  LoopReport,
  DetectorConfig,
  Detector,
  LoopPattern,
  BreakOnLoopConfig,
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
  lastCommitSnapshot: FiberSnapshot | null;
  commitCountInCurrentTask: number;
  syncLoopFiredThisTask: boolean;
  flushReportsThisTask: number;
  // Sliding window for async loop detection (ring buffer of timestamps)
  windowTimestamps: number[];
  windowWritePos: number;
  windowFilled: boolean;
  lastAsyncLoopFireTime: number;
  lastCommitStack: string | null;
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

/**
 * Check if flushSync appears in the call stack as a standalone function name.
 * Uses word boundary to avoid matching flushSyncCallbacks or
 * flushSyncCallbacksOnlyInLegacyMode.  Works in production builds because
 * React preserves the exported flushSync function name.
 */
function hasFlushSyncInStack(stack: string | null): boolean {
  if (!stack) return false;
  return /\bflushSync\b/.test(stack);
}

function resolveBreakConfig(value: boolean | BreakOnLoopConfig): { sync: boolean; async: boolean } {
  if (typeof value === 'boolean') return { sync: value, async: value };
  return { sync: value.sync ?? true, async: value.async ?? true };
}

export function createDetector(config: Partial<DetectorConfig> = {}): Detector {
  const {
    sampleRate = 1.0,
    onFlush = null,
    onLoop = null,
    maxCommitsPerTask = DEFAULT_MAX_COMMITS_PER_TASK,
    maxCommitsPerWindow = DEFAULT_MAX_COMMITS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    breakOnLoop: initialBreakOnLoop = true,
  } = config;

  let breakConfig = resolveBreakConfig(initialBreakOnLoop);

  const state: DetectorState = {
    commitInCurrentTask: false,
    taskBoundaryPending: false,
    lastCommitTime: 0,
    lastCommitSnapshot: null,
    commitCountInCurrentTask: 0,
    syncLoopFiredThisTask: false,
    flushReportsThisTask: 0,
    windowTimestamps: new Array<number>(maxCommitsPerWindow),
    windowWritePos: 0,
    windowFilled: false,
    lastAsyncLoopFireTime: 0,
    lastCommitStack: null,
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
    state.flushReportsThisTask = 0;
    state.lastCommitStack = null;
  };

  function buildLoopReport(
    root: FiberRoot,
    pattern: LoopPattern,
    commitCount: number,
    windowDuration: number | null
  ): LoopReport {
    const triggeringSnapshot = state.lastCommitSnapshot;
    const forcedSnapshot = snapshotCommitFibers(root);

    const stack = new Error().stack ?? null;
    const userFrame = parseUserFrame(stack);

    const suspects = getComponentNames(forcedSnapshot);

    return {
      type: 'loop',
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
    windowDuration: number | null
  ): void {
    const report = buildLoopReport(root, pattern, commitCount, windowDuration);
    const shouldBreak = pattern === 'sync' ? breakConfig.sync : breakConfig.async;

    if (shouldBreak) {
      // Freeze the root to prevent further commits
      freezeRootLanes(root);

      // Unfreeze and deliver report after current task
      setTimeout(() => {
        unfreezeRootLanes(root);
        onLoop?.(report);
      }, 0);
    } else {
      // Just report, don't break
      queueMicrotask(() => {
        onLoop?.(report);
      });
    }
  }

  function handleCommit(root: FiberRoot): void {
    if (state.disposed) return;

    const now = Date.now();

    // Capture call stack eagerly — stored for the NEXT commit to use as the
    // "triggering" stack.  At forced-flush time the current commit's stack is
    // just React internals, but the PREVIOUS commit's stack traces back through
    // the user code that caused the cascade (e.g. the flushSync call site).
    // Temporarily raise stackTraceLimit — the default of 10 is too shallow
    // when our 2 frames + React internals consume most of the budget.
    let commitStack: string | null = null;
    if (onFlush) {
      const prevLimit = Error.stackTraceLimit;
      Error.stackTraceLimit = 30;
      commitStack = new Error().stack ?? null;
      Error.stackTraceLimit = prevLimit;
    }

    // Check for sync infinite loop (too many commits in one task)
    state.commitCountInCurrentTask++;
    if (
      state.commitCountInCurrentTask > maxCommitsPerTask &&
      !state.syncLoopFiredThisTask
    ) {
      state.syncLoopFiredThisTask = true;
      // Reset the async ring buffer — it's full of timestamps from this sync
      // loop and would falsely trigger async detection in the next task.
      state.windowFilled = false;
      state.windowWritePos = 0;
      state.lastAsyncLoopFireTime = now;
      handleLoopDetection(
        root,
        'sync',
        state.commitCountInCurrentTask,
        null
      );
      return;
    }

    // Check for async infinite loop (sliding window via ring buffer)
    // Skip if sync loop already fired — the ring buffer is polluted with sync timestamps
    if (state.windowFilled && !state.syncLoopFiredThisTask) {
      const oldest = state.windowTimestamps[state.windowWritePos];
      const span = now - oldest;
      if (span < windowMs && now - state.lastAsyncLoopFireTime > windowMs) {
        state.lastAsyncLoopFireTime = now;
        handleLoopDetection(
          root,
          'async',
          maxCommitsPerWindow + 1,
          span
        );
        // Don't return — still record this commit in the ring buffer
      }
    }
    state.windowTimestamps[state.windowWritePos] = now;
    state.windowWritePos = (state.windowWritePos + 1) % maxCommitsPerWindow;
    if (!state.windowFilled && state.windowWritePos === 0) {
      state.windowFilled = true;
    }

    // Detect forced flush (sync re-render in same task)
    const isForcedFlush = state.commitInCurrentTask;

    // Snapshot the current commit eagerly — used both for the flush report
    // (to identify which component is being re-rendered NOW) and stored
    // as the triggering snapshot for the next commit.
    const currentSnapshot = snapshotCommitFibers(root);

    // Cap flush reports per task: enough for cascades (2-3), but stops flooding
    // during sync loops where every iteration is technically a forced flush.
    const MAX_FLUSH_REPORTS_PER_TASK = 3;
    if (isForcedFlush && onFlush && !state.syncLoopFiredThisTask
        && state.flushReportsThisTask < MAX_FLUSH_REPORTS_PER_TASK
        && Math.random() < sampleRate) {
      const triggeringSnapshot = state.lastCommitSnapshot
        ?? currentSnapshot;
      const classification = classifyPattern(triggeringSnapshot);

      // The classifier only sees fiber snapshots — it returns
      // "setState-outside-react" for both flushSync and setTimeout unbatched
      // commits (neither has layout effects).  Distinguish them via the call
      // stack: flushSync appears as a named frame in both dev and prod builds.
      let reportPattern = classification.pattern;
      let reportEvidence = classification.evidence;

      if (classification.pattern === 'setState-outside-react') {
        if (hasFlushSyncInStack(commitStack) || hasFlushSyncInStack(state.lastCommitStack)) {
          reportPattern = 'flushSync';
          reportEvidence = 'flushSync caused synchronous re-render';
        } else {
          // Unbatched setTimeout in legacy mode — not a cascading nested
          // update that blocks the frame.  Skip reporting.
          reportPattern = null!;
        }
      }

      if (reportPattern) {
        const userFrame = parseUserFrame(commitStack)
          ?? parseUserFrame(state.lastCommitStack);

        const report: FlushReport = {
          type: 'flush',
          timestamp: now,
          pattern: reportPattern,
          evidence: reportEvidence,
          suspects: classification.suspects,
          flushedEffectsCount: triggeringSnapshot.withLayoutEffects.length,
          blockingDurationMs: now - state.lastCommitTime,
          setStateLocation:
            (triggeringSnapshot.withLayoutEffects.find(f => f.effectSource)
              ?? triggeringSnapshot.withLayoutEffects[0])?.source ?? null,
          userFrame,
        };

        state.flushReportsThisTask++;
        onFlush(report);
      }
    }

    // Update state for next commit
    state.commitInCurrentTask = true;
    state.lastCommitTime = now;
    state.lastCommitSnapshot = currentSnapshot;
    state.lastCommitStack = commitStack;

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
    setBreakOnLoop(enabled: boolean | BreakOnLoopConfig): void {
      breakConfig = resolveBreakConfig(enabled);
    },
    dispose,
  };
}
