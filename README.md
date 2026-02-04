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

install({
  onDetection(detection) {
    console.log('Detected:', detection);
  },
});

// Import your app AFTER installing
import('./main.jsx');
```

```html
<!-- index.html -->
<script type="module" src="/setup.js"></script>
```

## Configuration

```js
install({
  // Callback for each detection
  onDetection(detection) {
    console.log(detection);
    // detection.type: 'setState-in-layout-effect' | 'setState-outside-react' | 'lazy-in-render' | 'infinite-loop'
    // detection.pattern: string
    // detection.fiber: React fiber (if available)
    // detection.stack: string (call stack)
  },

  // Infinite loop detection thresholds
  maxCommitsPerTask: 50,    // Max commits in a single JS task (sync loops)
  maxCommitsPerWindow: 50,  // Max commits in time window (async loops)
  windowMs: 1000,           // Time window for async detection

  // What to do when infinite loop detected
  onInfiniteLoop: 'report', // 'report' (default) | 'break'

  // Sample rate for detections (0.0 - 1.0)
  sampleRate: 1.0,
});
```

## Detection Types

| Type | Description |
|------|-------------|
| `setState-in-layout-effect` | `setState` called in `useLayoutEffect`, causing sync re-render |
| `setState-outside-react` | Multiple `setState` calls outside React's batching (legacy mode) |
| `lazy-in-render` | `React.lazy()` created during render |
| `infinite-loop` | Detected runaway render loop |

## Breaking Infinite Loops

Set `onInfiniteLoop: 'break'` to automatically stop infinite loops:

```js
install({
  onDetection(detection) {
    if (detection.type === 'infinite-loop') {
      // Dispatch event for error boundaries to catch
      window.dispatchEvent(
        new CustomEvent('infinite-loop-detected', { detail: detection })
      );
    }
  },
  onInfiniteLoop: 'break',
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
