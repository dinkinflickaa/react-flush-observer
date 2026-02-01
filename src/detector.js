const { snapshotCommitFibers } = require('./walker');
const { classifyPattern } = require('./classifier');
const { parseUserFrame } = require('./stack-parser');

function createDetector(config = {}) {
  const {
    sampleRate = 1.0,
    onDetection = null,
  } = config;

  const state = {
    commitInCurrentTask: false,
    taskBoundaryPending: false,
    lastCommitTime: 0,
    lastCommitRoot: null,
  };

  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    state.commitInCurrentTask = false;
    state.taskBoundaryPending = false;
    state.lastCommitRoot = null;
  };

  function handleCommit(root) {
    const now = performance.now();

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
            // Stack capture is best-effort
            detection.setStateLocation = null;
          }
        }

        onDetection?.(detection);
      }
    }

    state.lastCommitTime = now;
    state.lastCommitRoot = root;
    state.commitInCurrentTask = true;

    if (!state.taskBoundaryPending) {
      state.taskBoundaryPending = true;
      channel.port2.postMessage(null);
    }
  }

  function dispose() {
    channel.port1.close();
    channel.port2.close();
  }

  return { handleCommit, dispose };
}

module.exports = { createDetector };
