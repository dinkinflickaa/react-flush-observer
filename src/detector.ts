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
  taskBoundaryPending: boolean;
  lastCommitTime: number;
  lastCommitSnapshot: FiberSnapshot | null;
  commitCountInCurrentTask: number;
  syncLoopFiredThisTask: boolean;
  // Sliding window for async loop detection (ring buffer of timestamps)
  windowTimestamps: number[];
  windowWritePos: number;
  windowFilled: boolean;
  lastAsyncLoopFireTime: number;
  lastCommitStack: string | null;
  disposed: boolean;
  // Forward-looking cascade chain tracking
  cascadeChainActive: boolean;
  cascadeOriginSnapshot: FiberSnapshot | null;
  cascadeOriginStack: string | null;
  cascadeOriginTime: number;
  reportedForCurrentChain: boolean;
  // Backward-looking fallback (for Suspense and non-SyncLane cascades)
  hadCommitInCurrentTask: boolean;
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

function buildFlushReport(
  originSnapshot: FiberSnapshot,
  originStack: string | null,
  currentStack: string | null,
  originTime: number,
  now: number,
): FlushReport | null {
  const classification = classifyPattern(originSnapshot);

  let reportPattern = classification.pattern;
  let reportEvidence = classification.evidence;

  if (classification.pattern === 'setState-outside-react') {
    if (hasFlushSyncInStack(currentStack) || hasFlushSyncInStack(originStack)) {
      reportPattern = 'flushSync';
      reportEvidence = 'flushSync caused synchronous re-render';
    } else {
      return null; // unknown cascade — skip
    }
  }

  return {
    type: 'flush',
    timestamp: now,
    pattern: reportPattern,
    evidence: reportEvidence,
    suspects: classification.suspects,
    flushedEffectsCount: originSnapshot.withLayoutEffects.length,
    blockingDurationMs: now - originTime,
    setStateLocation:
      (originSnapshot.withLayoutEffects.find(f => f.effectSource)
        ?? originSnapshot.withLayoutEffects[0])?.source ?? null,
    userFrame: parseUserFrame(currentStack) ?? parseUserFrame(originStack),
  };
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
    taskBoundaryPending: false,
    lastCommitTime: 0,
    lastCommitSnapshot: null,
    commitCountInCurrentTask: 0,
    syncLoopFiredThisTask: false,
    windowTimestamps: new Array<number>(maxCommitsPerWindow),
    windowWritePos: 0,
    windowFilled: false,
    lastAsyncLoopFireTime: 0,
    lastCommitStack: null,
    disposed: false,
    cascadeChainActive: false,
    cascadeOriginSnapshot: null,
    cascadeOriginStack: null,
    cascadeOriginTime: 0,
    reportedForCurrentChain: false,
    hadCommitInCurrentTask: false,
  };

  // MessageChannel for detecting task boundaries
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (state.disposed) return;
    state.taskBoundaryPending = false;
    state.commitCountInCurrentTask = 0;
    state.syncLoopFiredThisTask = false;
    state.lastCommitStack = null;
    // Flush detection resets
    state.cascadeChainActive = false;
    state.cascadeOriginSnapshot = null;
    state.cascadeOriginStack = null;
    state.cascadeOriginTime = 0;
    state.reportedForCurrentChain = false;
    state.hadCommitInCurrentTask = false;
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

    // Snapshot the current commit eagerly — used both for the flush report
    // (to identify which component is being re-rendered NOW) and stored
    // as the triggering snapshot for the next commit.
    const currentSnapshot = snapshotCommitFibers(root);

    if (onFlush && !state.syncLoopFiredThisTask && Math.random() < sampleRate) {
      // STEP 1: Forward-looking cascade report.
      // If the previous commit predicted a cascade (via pendingLanes & SyncLane),
      // this IS the cascade commit.  Report once using the origin snapshot.
      if (state.cascadeChainActive && !state.reportedForCurrentChain) {
        const report = buildFlushReport(
          state.cascadeOriginSnapshot!,
          state.cascadeOriginStack,
          commitStack,
          state.cascadeOriginTime,
          now,
        );
        if (report) {
          state.reportedForCurrentChain = true;
          onFlush(report);
        }
      }

      // STEP 2: Backward-looking fallback (Suspense, flushSync, edge cases).
      // Handles cases where pendingLanes didn't predict the cascade.
      else if (state.hadCommitInCurrentTask && !state.cascadeChainActive && !state.reportedForCurrentChain) {
        const classification = classifyPattern(state.lastCommitSnapshot ?? currentSnapshot);
        if (classification.pattern === 'lazy-in-render') {
          const report = buildFlushReport(
            state.lastCommitSnapshot ?? currentSnapshot,
            state.lastCommitStack,
            commitStack,
            state.lastCommitTime,
            now,
          );
          if (report) {
            state.reportedForCurrentChain = true;
            onFlush(report);
          }
        } else if (classification.pattern === 'setState-in-layout-effect') {
          // Safety net: layout effect cascade not caught by pendingLanes
          const report = buildFlushReport(
            state.lastCommitSnapshot ?? currentSnapshot,
            state.lastCommitStack,
            commitStack,
            state.lastCommitTime,
            now,
          );
          if (report) {
            state.reportedForCurrentChain = true;
            onFlush(report);
          }
        } else if (classification.pattern === 'setState-outside-react') {
          if (hasFlushSyncInStack(commitStack) || hasFlushSyncInStack(state.lastCommitStack)) {
            const userFrame = parseUserFrame(commitStack)
              ?? parseUserFrame(state.lastCommitStack);
            const report: FlushReport = {
              type: 'flush',
              timestamp: now,
              pattern: 'flushSync',
              evidence: 'flushSync caused synchronous re-render',
              suspects: classification.suspects,
              flushedEffectsCount: (state.lastCommitSnapshot ?? currentSnapshot).withLayoutEffects.length,
              blockingDurationMs: now - state.lastCommitTime,
              setStateLocation:
                ((state.lastCommitSnapshot ?? currentSnapshot).withLayoutEffects.find(f => f.effectSource)
                  ?? (state.lastCommitSnapshot ?? currentSnapshot).withLayoutEffects[0])?.source ?? null,
              userFrame,
            };
            state.reportedForCurrentChain = true;
            onFlush(report);
          }
          // else: timer/unbatched — not a blocking cascade.  Skip reporting.
        }
      }
    }

    // STEP 3: Forward-look — does THIS commit predict a cascade?
    const willCascade = (root.pendingLanes & SyncLane) !== 0;
    if (willCascade) {
      if (!state.cascadeChainActive) {
        // Start of a new cascade chain
        state.cascadeChainActive = true;
        state.cascadeOriginSnapshot = currentSnapshot;
        state.cascadeOriginStack = commitStack;
        state.cascadeOriginTime = now;
        state.reportedForCurrentChain = false;
      }
      // else: chain continues, keep origin
    } else {
      state.cascadeChainActive = false;
      state.cascadeOriginSnapshot = null;
      state.reportedForCurrentChain = false;
    }

    // Update state for next commit
    state.hadCommitInCurrentTask = true;
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
