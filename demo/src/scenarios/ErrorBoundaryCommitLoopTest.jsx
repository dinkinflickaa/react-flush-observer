import React, { useState, useLayoutEffect } from 'react';
import Tag from './Tags';

// Fallback whose commit phase always errors.
// When the error boundary renders this fallback, the layout effect throws,
// triggering captureCommitPhaseError which enqueues a CaptureUpdate on the
// boundary via enqueueUpdate + ensureRootIsScheduled -- bypassing
// scheduleUpdateOnFiber entirely, so checkForNestedUpdates() (the only place
// NESTED_UPDATE_LIMIT is enforced) is never called.  This creates a truly
// unbounded infinite loop.
function BrokenFallback() {
  useLayoutEffect(() => {
    throw new Error('fallback layout effect error');
  });
  return <div className="text-xs text-gray-500">fallback (should not persist)</div>;
}

// Child that throws on mount when activated
function Thrower({ active }) {
  if (active) throw new Error('child render error');
  return null;
}

// Inner error boundary -- getDerivedStateFromError only, no componentDidCatch.
// This is intentional: getDerivedStateFromError synchronously transitions to
// the fallback UI within the same commit, which is required to trigger the
// commit-phase loop via captureCommitPhaseError.
class CommitLoopBoundary extends React.Component {
  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state?.error) {
      return <BrokenFallback />;
    }
    return this.props.children;
  }
}

export default function ErrorBoundaryCommitLoopTest() {
  const [active, setActive] = useState(false);
  const [prevention, setPrevention] = useState(true);

  function handleToggle() {
    const next = !prevention;
    setPrevention(next);
    window.__FLUSH_OBSERVER__?.setBreakOnLoop(next);
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-sm font-semibold">
        Error boundary commit loop
        <Tag type="commit-phase" />
        <Tag type="no-react-cap" />
        <Tag type="unresponsive" />
      </h2>
      <p className="text-xs text-gray-500 mt-1 mb-2">
        A <code className="bg-gray-100 px-1 rounded">getDerivedStateFromError</code> boundary
        catches a child error and renders a fallback whose{' '}
        <code className="bg-gray-100 px-1 rounded">useLayoutEffect</code> always throws.
        The commit-phase error re-enqueues via{' '}
        <code className="bg-gray-100 px-1 rounded">captureCommitPhaseError</code>.
      </p>
      <p className="text-xs text-gray-400 mb-3">
        <code className="bg-gray-100 px-1 rounded text-gray-500">captureCommitPhaseError</code> enqueues
        updates via <code className="bg-gray-100 px-1 rounded text-gray-500">enqueueUpdate</code> +{' '}
        <code className="bg-gray-100 px-1 rounded text-gray-500">ensureRootIsScheduled</code>, completely
        bypassing <code className="bg-gray-100 px-1 rounded text-gray-500">scheduleUpdateOnFiber</code> where{' '}
        <code className="bg-gray-100 px-1 rounded text-gray-500">NESTED_UPDATE_LIMIT</code> is checked.
        The browser freezes permanently.
        {prevention
          ? ' Prevention ON — react-flush-observer freezes root lanes to break the loop.'
          : ' Prevention OFF — the browser will FREEZE permanently, you will need to kill the tab.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActive(true)}
          className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-sm font-medium rounded cursor-pointer"
        >
          Trigger commit loop
        </button>
        <button
          onClick={handleToggle}
          className={`px-3.5 py-1.5 text-sm font-medium rounded cursor-pointer ${
            prevention
              ? 'bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white'
              : 'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white'
          }`}
        >
          Prevention: {prevention ? 'ON' : 'OFF'}
        </button>
      </div>
      {active && (
        <CommitLoopBoundary>
          <Thrower active={active} />
        </CommitLoopBoundary>
      )}
    </div>
  );
}
