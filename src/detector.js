const { snapshotCommitFibers } = require('./walker');
const { classifyPattern } = require('./classifier');
const { parseUserFrame } = require('./stack-parser');
const {
  DEFAULT_MAX_COMMITS_PER_TASK,
  DEFAULT_MAX_COMMITS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
} = require('./constants');

const SyncLane = 1;

function freezeRootLanes(root) {
  root.__frozenOriginals = {
    pendingLanes: root.pendingLanes,
    callbackPriority: root.callbackPriority,
    callbackNode: root.callbackNode,
  };
  Object.defineProperty(root, 'pendingLanes', {
    get: () => 0,
    set: () => {},
    configurable: true,
  });
  Object.defineProperty(root, 'callbackPriority', {
    get: () => SyncLane,
    set: () => {},
    configurable: true,
  });
  Object.defineProperty(root, 'callbackNode', {
    get: () => null,
    set: () => {},
    configurable: true,
  });
}

function unfreezeRootLanes(root) {
  const originals = root.__frozenOriginals;
  delete root.pendingLanes;
  delete root.callbackPriority;
  delete root.callbackNode;
  root.pendingLanes = 0;
  // Always reset to NoLane (0) so ensureRootIsScheduled won't see a stale
  // priority match and skip scheduling.  The original SyncLane callback was
  // consumed during the loop, so restoring it would trick React into
  // thinking sync work is already scheduled when it isn't.
  root.callbackPriority = 0;
  root.callbackNode = originals?.callbackNode ?? null;
  delete root.__frozenOriginals;
}

function createDetector(config = {}) {
  const {
    sampleRate = 1.0,
    onDetection = null,
    maxCommitsPerTask = DEFAULT_MAX_COMMITS_PER_TASK,
    maxCommitsPerWindow = DEFAULT_MAX_COMMITS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    onInfiniteLoop = 'break',
  } = config;

  const state = {
    commitInCurrentTask: false,
    taskBoundaryPending: false,
    lastCommitTime: 0,
    lastCommitRoot: null,
    // Sync loop tracking
    commitCountInCurrentTask: 0,
    syncLoopFiredThisTask: false,
    // Async loop tracking
    windowCommitCount: 0,
    windowStartTime: 0,
    asyncLoopFiredThisWindow: false,
    // Disposal guard
    disposed: false,
  };

  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    state.commitInCurrentTask = false;
    state.taskBoundaryPending = false;
    state.lastCommitRoot = null;
    state.commitCountInCurrentTask = 0;
    state.syncLoopFiredThisTask = false;
  };

  function buildLoopReport(root, pattern, commitCount, windowDuration) {
    const triggeringFibers = state.lastCommitRoot
      ? snapshotCommitFibers(state.lastCommitRoot)
      : null;
    const forcedFibers = snapshotCommitFibers(root);

    let stack = null;
    let userFrame = null;
    try {
      stack = new Error().stack;
      userFrame = parseUserFrame(stack);
    } catch (_) {
      // Best-effort
    }

    // Extract suspect component names from forcedCommit fibers
    const seen = new Set();
    const suspects = [
      ...forcedFibers.withLayoutEffects,
      ...forcedFibers.withPassiveEffects,
    ]
      .map(f => f.ownerName)
      .filter(name => name && !seen.has(name) && seen.add(name));

    return {
      type: 'infinite-loop',
      pattern,
      commitCount,
      windowMs: windowDuration,
      stack,
      suspects,
      triggeringCommit: triggeringFibers,
      forcedCommit: forcedFibers,
      userFrame,
      timestamp: Date.now(),
    };
  }

  function handleLoopDetection(root, pattern, commitCount, windowDuration) {
    const report = buildLoopReport(root, pattern, commitCount, windowDuration);

    if (onInfiniteLoop === 'break') {
      // For sync blocking loops, freeze root.pendingLanes so React's
      // getNextLanes() returns NoLanes and performSyncWorkOnRoot bails out.
      // The freeze prevents further commits, so handleCommit won't be called
      // during the freeze. The MessageChannel naturally resets counters when
      // the sync cascade unwinds. After setTimeout unfreezes the root and
      // delivers the report, the observer is ready for the next interaction.
      if (pattern === 'infinite-loop-sync') {
        freezeRootLanes(root);
        // Reset async window state so the loop's commit count doesn't bleed
        // into post-recovery commits (e.g. error boundary flushSync).
        state.windowCommitCount = 0;
        state.windowStartTime = 0;
        state.asyncLoopFiredThisWindow = false;
      }
      // After the synchronous cascade unwinds and the event loop resumes,
      // unfreeze the root and deliver the report.
      setTimeout(() => {
        if (pattern === 'infinite-loop-sync') {
          unfreezeRootLanes(root);
        }
        onDetection?.(report);
      }, 0);
    } else {
      // report mode
      onDetection?.(report);
    }
  }

  function handleCommit(root) {
    if (state.disposed) return;

    const now = performance.now();

    // --- Existing forced-flush detection ---
    if (state.commitInCurrentTask && state.lastCommitRoot !== null) {
      if (Math.random() < sampleRate) {
        const triggeringFibers = snapshotCommitFibers(state.lastCommitRoot);
        const forcedFibers = snapshotCommitFibers(root);
        const classification = classifyPattern(triggeringFibers);

        const detection = {
          timestamp: Date.now(),
          pattern: classification.pattern,
          evidence: classification.evidence,
          suspects: classification.suspects,
          flushedEffectsCount: forcedFibers.withPassiveEffects.length,
          blockingDurationMs: now - state.lastCommitTime,
        };

        if (classification.pattern === 'setState-outside-react') {
          try {
            const stack = new Error().stack;
            const frame = parseUserFrame(stack);
            detection.setStateLocation = frame ?? null;
          } catch (_) {
            detection.setStateLocation = null;
          }
        }

        onDetection?.(detection);
      }
    }

    // --- Update state ---
    state.lastCommitTime = now;
    state.lastCommitRoot = root;

    if (state.commitInCurrentTask) {
      state.commitCountInCurrentTask++;
    } else {
      state.commitCountInCurrentTask = 0;
    }

    state.commitInCurrentTask = true;

    if (!state.taskBoundaryPending) {
      state.taskBoundaryPending = true;
      channel.port2.postMessage(null);
    }

    // --- Sync loop check (after state update) ---
    if (
      state.commitCountInCurrentTask >= maxCommitsPerTask &&
      !state.syncLoopFiredThisTask
    ) {
      state.syncLoopFiredThisTask = true;
      handleLoopDetection(
        root,
        'infinite-loop-sync',
        state.commitCountInCurrentTask + 1, // +1 for the initial commit
        null
      );
    }

    // --- Async loop check ---
    if (now - state.windowStartTime > windowMs) {
      state.windowStartTime = now;
      state.windowCommitCount = 0;
      state.asyncLoopFiredThisWindow = false;
    }
    state.windowCommitCount++;

    if (
      state.windowCommitCount >= maxCommitsPerWindow &&
      !state.asyncLoopFiredThisWindow &&
      !state.syncLoopFiredThisTask &&
      state.commitCountInCurrentTask < maxCommitsPerTask - 1
    ) {
      state.asyncLoopFiredThisWindow = true;
      handleLoopDetection(
        root,
        'infinite-loop-async',
        state.windowCommitCount,
        now - state.windowStartTime
      );
    }
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    channel.port1.close();
    channel.port2.close();
  }

  return { handleCommit, dispose };
}

module.exports = { createDetector };
