const { createDetector } = require('./detector');

function install(config = {}) {
  const {
    sampleRate = 1.0,
    onDetection = null,
  } = config;

  const existingHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const detector = createDetector({ sampleRate, onDetection });

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject(internals) {
      return existingHook?.inject?.(internals) ?? 1;
    },
    onCommitFiberRoot(id, root, priority, didError) {
      try {
        detector.handleCommit(root);
      } catch (_) {
        // Observability must never break the observed application
      }
      existingHook?.onCommitFiberRoot?.(id, root, priority, didError);
    },
    onPostCommitFiberRoot(id, root) {
      existingHook?.onPostCommitFiberRoot?.(id, root);
    },
    onCommitFiberUnmount(id, fiber) {
      existingHook?.onCommitFiberUnmount?.(id, fiber);
    },
  };

  return function uninstall() {
    detector.dispose();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
  };
}

module.exports = { install };
