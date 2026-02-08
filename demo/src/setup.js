import { install } from "react-flush-observer";
import { initLog, appendDetection } from "./detection-log";

// Init the vanilla DOM detection log
initLog(document.getElementById("detection-log"));

// Install the observer BEFORE React is imported — React reads
// __REACT_DEVTOOLS_GLOBAL_HOOK__ during its module initialization
const observer = install({
  onFlush(report) {
    performance.mark("marking on flush");
    appendDetection(report);
  },
  onLoop(report) {
    appendDetection(report);
    // Dispatch a DOM event so error boundaries can react.
    // For async loops, the detector delivers reports via queueMicrotask,
    // so this fires before React's scheduler processes the next render.
    window.dispatchEvent(
      new CustomEvent("infinite-loop-detected", { detail: report }),
    );
  },
  maxCommitsPerTask: 50,
  maxCommitsPerWindow: 50,
  breakOnLoop: { sync: true, async: false },
});

// Expose setter so demo components can toggle prevention at runtime
window.__FLUSH_OBSERVER__ = observer;

// Dynamically import the app AFTER the hook is installed
import("./main.jsx");
