import React from 'react';
import ReactDOM from 'react-dom';
import { InfiniteLoopError } from 'react-flush-observer';

export default class InfiniteLoopErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleLoopDetected = this.handleLoopDetected.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    window.addEventListener('infinite-loop-detected', this.handleLoopDetected);
  }

  componentWillUnmount() {
    window.removeEventListener('infinite-loop-detected', this.handleLoopDetected);
  }

  handleLoopDetected(event) {
    const detection = event.detail;
    if (detection.pattern !== this.props.pattern) return;

    // When suspects is provided, check that at least one suspect name
    // from the detection report matches this boundary's suspects list.
    // When omitted, fall back to pattern-only matching (backward compatible).
    const { suspects } = this.props;
    if (suspects) {
      const reportSuspects = detection.suspects || [];
      const match = reportSuspects.some(name => suspects.includes(name));
      if (!match) return;
    }

    // flushSync forces React to synchronously process this state update,
    // unmounting the looping child BEFORE React's scheduler fires the next
    // render.  Without flushSync, React batches the update and the loop
    // continues because the child keeps re-rendering.
    ReactDOM.flushSync(() => {
      this.setState({
        error: new InfiniteLoopError(detection),
      });
    });
  }

  handleReload = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold">
            {this.props.title}
            <span className="ml-1.5 inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-800">
              {this.props.pattern}
            </span>
          </h2>
          <div className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded">
            <p className="text-xs font-semibold text-rose-800 mb-1">
              {this.state.error.name}
            </p>
            <p className="text-xs text-rose-700 font-mono mb-3">
              {this.state.error.message}
            </p>
            <button
              onClick={this.handleReload}
              className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
            >
              Reload scenario
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
