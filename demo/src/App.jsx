import React from 'react';
import LayoutEffectTest from './scenarios/LayoutEffectTest';
import LazyInRenderTest from './scenarios/LazyInRenderTest';
import SetStateOutsideTest from './scenarios/SetStateOutsideTest';
import HappyPathTest from './scenarios/HappyPathTest';
import FlushSyncTest from './scenarios/FlushSyncTest';
import CascadeTest from './scenarios/CascadeTest';
import InfiniteLoopSyncTest from './scenarios/InfiniteLoopSyncTest';
import InfiniteLoopAsyncTest from './scenarios/InfiniteLoopAsyncTest';
import InfiniteLoopHybridTest from './scenarios/InfiniteLoopHybridTest';
import InfiniteLoopErrorBoundary from './scenarios/InfiniteLoopErrorBoundary';

export default function App() {
  return (
    <div className="flex flex-col gap-4">
      <LayoutEffectTest />
      <LazyInRenderTest />
      <SetStateOutsideTest />
      <HappyPathTest />
      <FlushSyncTest />
      <CascadeTest />
      <InfiniteLoopErrorBoundary title="Infinite loop (sync)" pattern="infinite-loop-sync">
        <InfiniteLoopSyncTest />
      </InfiniteLoopErrorBoundary>
      <InfiniteLoopErrorBoundary title="Infinite loop (async)" pattern="infinite-loop-async">
        <InfiniteLoopAsyncTest />
      </InfiniteLoopErrorBoundary>
      <InfiniteLoopErrorBoundary title="Infinite loop (hybrid)" pattern="infinite-loop-sync">
        <InfiniteLoopHybridTest />
      </InfiniteLoopErrorBoundary>
    </div>
  );
}
