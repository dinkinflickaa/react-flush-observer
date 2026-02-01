import { install } from 'react-flush-observer';
import { initLog, appendDetection } from './detection-log';

// Init the vanilla DOM detection log
initLog(document.getElementById('detection-log'));

// Install the observer BEFORE React is imported — React reads
// __REACT_DEVTOOLS_GLOBAL_HOOK__ during its module initialization
install({
  onDetection(detection) {
    appendDetection(detection);
    // Dispatch a DOM event so error boundaries can react.
    // For async loops, the detector delivers reports via queueMicrotask,
    // so this fires before React's scheduler processes the next render.
    if (detection.type === 'infinite-loop') {
      window.dispatchEvent(
        new CustomEvent('infinite-loop-detected', { detail: detection })
      );
    }
  },
  maxCommitsPerTask: 50,
  onInfiniteLoop: 'break',
});

// Dynamically import the app AFTER the hook is installed
import('./main.jsx');
