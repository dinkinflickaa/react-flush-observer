const { snapshotCommitFibers } = require('./walker');
const { classifyPattern } = require('./classifier');
const { parseUserFrame } = require('./stack-parser');
const { InfiniteLoopError } = require('./errors');
const {
  DEFAULT_MAX_COMMITS_PER_TASK,
  DEFAULT_MAX_COMMITS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
} = require('./constants');

function createDetector(config = {}) {
  const {
    sampleRate = 1.0,
    onDetection = null,
    maxCommitsPerTask = DEFAULT_MAX_COMMITS_PER_TASK,
    maxCommitsPerWindow = DEFAULT_MAX_COMMITS_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    onInfiniteLoop = 'throw',
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

    return {
      type: 'infinite-loop',
      pattern,
      commitCount,
      windowMs: windowDuration,
      stack,
      triggeringCommit: triggeringFibers,
      forcedCommit: forcedFibers,
      userFrame,
      timestamp: Date.now(),
    };
  }

  function handleLoopDetection(root, pattern, commitCount, windowDuration) {
    const report = buildLoopReport(root, pattern, commitCount, windowDuration);

    if (onInfiniteLoop === 'throw') {
      dispose();
      if (onDetection) {
        setTimeout(() => onDetection(report), 0);
      }
      throw new InfiniteLoopError(report);
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
      !state.syncLoopFiredThisTask
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
