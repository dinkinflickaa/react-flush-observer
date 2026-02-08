import React, { useState } from 'react';
import LayoutEffectTest from './scenarios/LayoutEffectTest';
import LazyInRenderTest from './scenarios/LazyInRenderTest';
import SetStateOutsideTest from './scenarios/SetStateOutsideTest';
import HappyPathTest from './scenarios/HappyPathTest';
import FlushSyncTest from './scenarios/FlushSyncTest';
import CascadeTest from './scenarios/CascadeTest';
import ResizeObserverTest from './scenarios/ResizeObserverTest';
import InfiniteLoopSyncTest from './scenarios/InfiniteLoopSyncTest';
import InfiniteLoopAsyncTest from './scenarios/InfiniteLoopAsyncTest';
import ErrorBoundaryCommitLoopTest from './scenarios/ErrorBoundaryCommitLoopTest';
import DOMObserverLoopTest from './scenarios/DOMObserverLoopTest';
import InfiniteLoopErrorBoundary from './scenarios/InfiniteLoopErrorBoundary';

const TABS = [
  { id: 'nested', label: 'Nested Updates' },
  { id: 'loops', label: 'Infinite Loops' },
];

export default function App() {
  const [tab, setTab] = useState('nested');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 bg-white rounded-lg p-1 shadow-sm">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
              tab === id
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'nested' && (
        <>
          <LayoutEffectTest />
          <LazyInRenderTest />
          <SetStateOutsideTest />
          <HappyPathTest />
          <FlushSyncTest />
          <CascadeTest />
          <ResizeObserverTest />
        </>
      )}

      {tab === 'loops' && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-800">
              <strong>How React handles infinite loops:</strong>{' '}
              React's <code className="bg-blue-100 px-1 rounded">NESTED_UPDATE_LIMIT</code> (50)
              catches loops that go through <code className="bg-blue-100 px-1 rounded">scheduleUpdateOnFiber</code> —
              like setState in render or useLayoutEffect. But several patterns bypass this check entirely,
              leaving the browser with no protection. react-flush-observer catches all of them.
            </p>
          </div>
          <InfiniteLoopErrorBoundary title="Sync setState loop" pattern="sync" suspects={['InfiniteLooper']}>
            <InfiniteLoopSyncTest />
          </InfiniteLoopErrorBoundary>
          <InfiniteLoopErrorBoundary title="Async setState loop" pattern="async" suspects={['AsyncLooper']}>
            <InfiniteLoopAsyncTest />
          </InfiniteLoopErrorBoundary>
          <InfiniteLoopErrorBoundary title="Error boundary commit loop (unbounded)" pattern="sync" suspects={['CommitLoopBoundary']}>
            <ErrorBoundaryCommitLoopTest />
          </InfiniteLoopErrorBoundary>
          <InfiniteLoopErrorBoundary title="DOM MutationObserver loop" pattern="sync" suspects={['DOMObserverLooper']}>
            <DOMObserverLoopTest />
          </InfiniteLoopErrorBoundary>
        </>
      )}
    </div>
  );
}
