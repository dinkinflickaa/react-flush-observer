# react-flush-observer

Detect synchronous re-renders and infinite loops in React applications via the DevTools hook.

## Installation

```bash
npm install react-flush-observer
```

## Quick Start

Install the observer **before** React loads:

```js
// setup.js (must be your app's entry point)
import { install } from 'react-flush-observer';

install();

// Import your app AFTER installing
import('./main.jsx');
```

```html
<!-- index.html -->
<script type="module" src="/setup.js"></script>
```

Zero-config `install()` gives you infinite loop protection out of the box.

## Configuration

```js
const observer = install({
  // Sync re-render detected (flush detection)
  onFlush(report) {
    console.log(report);
    // report.type: 'flush'
    // report.pattern: 'setState-in-layout-effect' | 'setState-outside-react' | 'lazy-in-render'
  },

  // Infinite loop detected
  onLoop(report) {
    console.error(report);
    // report.type: 'loop'
    // report.pattern: 'sync' | 'async'
  },

  // Automatically break infinite loops (default: true)
  breakOnLoop: true,

  // Infinite loop detection thresholds
  maxCommitsPerTask: 50,    // Max commits in a single JS task (sync loops)
  maxCommitsPerWindow: 50,  // Max commits in time window (async loops)
  windowMs: 1000,           // Time window for async detection

  // Sample rate for flush detections (0.0 - 1.0)
  sampleRate: 1.0,
});

// Toggle loop breaking at runtime
observer.setBreakOnLoop(false);

// Remove the observer
observer.uninstall();
```

## Flush Patterns

| Pattern | Description |
|---------|-------------|
| `setState-in-layout-effect` | `setState` called in `useLayoutEffect`, causing sync re-render |
| `setState-outside-react` | Multiple `setState` calls outside React's batching (legacy mode) |
| `lazy-in-render` | `React.lazy()` created during render |

## Loop Patterns

| Pattern | Description |
|---------|-------------|
| `sync` | Too many commits in a single JS task (runaway sync loop) |
| `async` | Too many commits within the time window (runaway async loop) |

## Breaking Infinite Loops

With `breakOnLoop: true` (the default), the observer freezes React's root lanes to stop runaway loops, then unfreezes after the current task:

```js
const observer = install({
  onLoop(report) {
    // Dispatch event for error boundaries to catch
    window.dispatchEvent(
      new CustomEvent('infinite-loop-detected', { detail: report })
    );
  },
});
```

Then in your error boundary:

```jsx
class InfiniteLoopErrorBoundary extends React.Component {
  state = { error: null };

  componentDidMount() {
    this.handler = (e) => {
      if (this.shouldCatch(e.detail)) {
        this.setState({ error: e.detail });
      }
    };
    window.addEventListener('infinite-loop-detected', this.handler);
  }

  componentWillUnmount() {
    window.removeEventListener('infinite-loop-detected', this.handler);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div>Infinite loop detected and stopped.</div>;
    }
    return this.props.children;
  }
}
```

## How It Works

The observer installs a custom `__REACT_DEVTOOLS_GLOBAL_HOOK__` that React calls on every commit. It analyzes:

1. **Commit timing** - Multiple commits in a single JS task indicate sync re-renders
2. **Fiber flags** - Layout effects with updates indicate `setState` in `useLayoutEffect`
3. **Commit frequency** - Rapid commits over time indicate async infinite loops

## Requirements

- React 16.8+ (requires hooks and fiber architecture)
- Must be installed before React initializes

## License

MIT
